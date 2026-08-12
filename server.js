const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

const EMPLOYER_DATA_PATH = path.join(__dirname, 'employerData.json');
const SEEKER_DATA_PATH = path.join(__dirname, 'seekerData.json');
const META_PATH = path.join(__dirname, '.cache-meta.json');

const HN_USER_SUBMISSIONS_URL = 'https://hacker-news.firebaseio.com/v0/user/whoishiring.json';
const HN_ITEM_URL = id => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const ALGOLIA_ITEM_URL = id => `https://hn.algolia.com/api/v1/items/${id}`;
const ITEM_FETCH_CONCURRENCY = 6;
const REFRESH_DATA_VERSION = 'official-hn-whoishiring-v3-direct-parent-top-level-comments';

let cache = {
  employerData: [],
  seekerData: []
};

let refreshState = {
  lastRefreshDateKey: null,
  lastRefreshDataVersion: null,
  lastAttemptDateKey: null,
  lastAttemptDataVersion: null,
  inFlight: null
};

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readMeta() {
  try {
    const raw = await fs.readFile(META_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastRefreshDateKey: typeof parsed?.lastRefreshDateKey === 'string' ? parsed.lastRefreshDateKey : null,
      lastRefreshDataVersion: typeof parsed?.lastRefreshDataVersion === 'string' ? parsed.lastRefreshDataVersion : null,
      lastAttemptDateKey: typeof parsed?.lastAttemptDateKey === 'string' ? parsed.lastAttemptDateKey : null,
      lastAttemptDataVersion: typeof parsed?.lastAttemptDataVersion === 'string' ? parsed.lastAttemptDataVersion : null
    };
  } catch (_) {
    return {
      lastRefreshDateKey: null,
      lastRefreshDataVersion: null,
      lastAttemptDateKey: null,
      lastAttemptDataVersion: null
    };
  }
}

async function writeMeta(lastRefreshDateKey, lastRefreshDataVersion, lastAttemptDateKey, lastAttemptDataVersion) {
  await writeJson(META_PATH, {
    lastRefreshDateKey,
    lastRefreshDataVersion,
    lastAttemptDateKey,
    lastAttemptDataVersion
  });
}

function buildMonthEntryFromItem(item, count) {
  const date = new Date(item.time * 1000);
  return {
    id: item.id,
    label: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
    month: date.getMonth(),
    year: date.getFullYear(),
    ts: date.getTime(),
    count
  };
}

async function fetchJson(url, errorPrefix) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${errorPrefix}: ${res.status}`);
  }

  return res.json();
}

async function fetchItem(itemId) {
  return fetchJson(HN_ITEM_URL(itemId), `HN item request failed for ${itemId}`);
}

async function fetchAlgoliaItem(itemId) {
  return fetchJson(ALGOLIA_ITEM_URL(itemId), `Algolia item request failed for ${itemId}`);
}

function collectUniqueCommentNodes(children, seenIds, nodes) {
  for (const child of children) {
    if (!child || typeof child.id !== 'number' || seenIds.has(child.id)) {
      continue;
    }

    seenIds.add(child.id);
    nodes.push(child);

    if (Array.isArray(child.children) && child.children.length > 0) {
      collectUniqueCommentNodes(child.children, seenIds, nodes);
    }
  }
}

async function countTopLevelComments(itemId) {
  try {
    const algoliaItem = await fetchAlgoliaItem(itemId);
    const rootChildren = Array.isArray(algoliaItem.children) ? algoliaItem.children : [];
    const uniqueNodes = [];

    collectUniqueCommentNodes(rootChildren, new Set(), uniqueNodes);

    return uniqueNodes.filter(child => child.type === 'comment' && child.parent_id === itemId).length;
  } catch (err) {
    const item = await fetchItem(itemId);
    const kids = Array.isArray(item.kids) ? item.kids : [];
    return kids.length;
  }
}

async function fetchWhoIsHiringSubmittedIds() {
  const user = await fetchJson(HN_USER_SUBMISSIONS_URL, 'HN user request failed');
  return Array.isArray(user.submitted) ? user.submitted : [];
}

async function fetchRelevantMonthlyThreadItems() {
  const submittedIds = await fetchWhoIsHiringSubmittedIds();
  const submittedItems = await mapWithConcurrency(submittedIds, ITEM_FETCH_CONCURRENCY, fetchItem);

  return submittedItems.filter(item => item && item.type === 'story' && typeof item.title === 'string');
}

async function buildMonthlyThreadData(submittedItems, titleMatcher, disallowMatchers = []) {
  const matchingItems = submittedItems.filter(item => {
    if (!titleMatcher.test(item.title)) return;
    if (disallowMatchers.some(re => re.test(item.title))) return;

    return true;
  });

  const resolvedEntries = await mapWithConcurrency(
    matchingItems,
    ITEM_FETCH_CONCURRENCY,
    async item => {
      const topLevelCount = await countTopLevelComments(item.id);
      return buildMonthEntryFromItem(item, topLevelCount);
    }
  );

  const latestByMonth = new Map();

  resolvedEntries.forEach(monthEntry => {
    if (!monthEntry) return;

    const key = monthKey(monthEntry);
    const current = latestByMonth.get(key);

    if (!current || monthEntry.count > current.count) {
      latestByMonth.set(key, monthEntry);
    }
  });

  return [...latestByMonth.values()].sort((a, b) => a.ts - b.ts);
}

async function mapWithConcurrency(items, limit, iteratee) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function monthKey(entry) {
  return `${entry.year}-${entry.month}`;
}

function mergeMonthlyData(existingData, freshEntries) {
  const byMonth = new Map();
  (existingData || []).forEach(item => byMonth.set(monthKey(item), item));
  (freshEntries || []).forEach(item => byMonth.set(monthKey(item), item));
  return [...byMonth.values()].sort((a, b) => a.ts - b.ts);
}

async function loadCacheFromDisk() {
  const [employerData, seekerData, meta] = await Promise.all([
    readJsonArray(EMPLOYER_DATA_PATH),
    readJsonArray(SEEKER_DATA_PATH),
    readMeta()
  ]);

  cache.employerData = employerData.sort((a, b) => a.ts - b.ts);
  cache.seekerData = seekerData.sort((a, b) => a.ts - b.ts);
  refreshState.lastRefreshDateKey = meta.lastRefreshDateKey;
  refreshState.lastRefreshDataVersion = meta.lastRefreshDataVersion;
  refreshState.lastAttemptDateKey = meta.lastAttemptDateKey;
  refreshState.lastAttemptDataVersion = meta.lastAttemptDataVersion;
}

async function refreshCacheFromHnUserSubmissions() {
  const submittedItems = await fetchRelevantMonthlyThreadItems();
  const [freshEmployer, freshSeeker] = await Promise.all([
    buildMonthlyThreadData(submittedItems, /who is hiring/i, [/who wants to be hired/i, /freelancer/i]),
    buildMonthlyThreadData(submittedItems, /who wants to be hired/i, [/freelancer/i])
  ]);

  const mergedEmployer = mergeMonthlyData(cache.employerData, freshEmployer);
  const mergedSeeker = mergeMonthlyData(cache.seekerData, freshSeeker);

  await Promise.all([
    writeJson(EMPLOYER_DATA_PATH, mergedEmployer),
    writeJson(SEEKER_DATA_PATH, mergedSeeker)
  ]);

  cache.employerData = mergedEmployer;
  cache.seekerData = mergedSeeker;
}

async function refreshDataFiles() {
  await loadCacheFromDisk();
  await refreshCacheFromHnUserSubmissions();

  const today = getDateKey();
  refreshState.lastRefreshDateKey = today;
  refreshState.lastRefreshDataVersion = REFRESH_DATA_VERSION;
  refreshState.lastAttemptDateKey = today;
  refreshState.lastAttemptDataVersion = REFRESH_DATA_VERSION;

  await writeMeta(
    refreshState.lastRefreshDateKey,
    refreshState.lastRefreshDataVersion,
    refreshState.lastAttemptDateKey,
    refreshState.lastAttemptDataVersion
  );
}

async function ensureDailyRefresh() {
  const today = getDateKey();
  const alreadyAttemptedCurrentVersion =
    refreshState.lastAttemptDateKey === today &&
    refreshState.lastAttemptDataVersion === REFRESH_DATA_VERSION;

  if (alreadyAttemptedCurrentVersion) {
    return { refreshed: false, attempted: false, dateKey: today, error: null };
  }

  if (!refreshState.inFlight) {
    refreshState.inFlight = (async () => {
      refreshState.lastAttemptDateKey = today;
      refreshState.lastAttemptDataVersion = REFRESH_DATA_VERSION;
      await writeMeta(
        refreshState.lastRefreshDateKey,
        refreshState.lastRefreshDataVersion,
        refreshState.lastAttemptDateKey,
        refreshState.lastAttemptDataVersion
      );

      try {
        await refreshCacheFromHnUserSubmissions();
        refreshState.lastRefreshDateKey = today;
        refreshState.lastRefreshDataVersion = REFRESH_DATA_VERSION;
        await writeMeta(
          refreshState.lastRefreshDateKey,
          refreshState.lastRefreshDataVersion,
          refreshState.lastAttemptDateKey,
          refreshState.lastAttemptDataVersion
        );
        return { refreshed: true, attempted: true, dateKey: today, error: null };
      } catch (err) {
        return {
          refreshed: false,
          attempted: true,
          dateKey: today,
          error: err instanceof Error ? err.message : 'Unknown refresh error'
        };
      }
    })()
      .finally(() => {
        refreshState.inFlight = null;
      });
  }

  return refreshState.inFlight;
}

app.use(express.static(path.join(__dirname)));

app.get('/api/dashboard-data', async (req, res) => {
  const result = await ensureDailyRefresh();
  if (result.error) {
    console.error('Dashboard data refresh failed:', result.error);
  }

  res.json({
    employerData: cache.employerData,
    seekerData: cache.seekerData,
    lastRefreshDateKey: refreshState.lastRefreshDateKey,
    lastRefreshDataVersion: refreshState.lastRefreshDataVersion,
    lastAttemptDateKey: refreshState.lastAttemptDateKey,
    lastAttemptDataVersion: refreshState.lastAttemptDataVersion,
    refreshedOnRequest: result.refreshed,
    attemptedOnRequest: result.attempted,
    refreshError: result.error
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function startServer() {
  await loadCacheFromDisk();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (process.argv.includes('--refresh-data')) {
  refreshDataFiles()
    .then(() => {
      console.log('Local data files refreshed.');
    })
    .catch(err => {
      console.error('Failed to refresh local data files:', err);
      process.exit(1);
    });
} else {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
