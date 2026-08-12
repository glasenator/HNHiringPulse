const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

const EMPLOYER_DATA_PATH = path.join(__dirname, 'employerData.json');
const SEEKER_DATA_PATH = path.join(__dirname, 'seekerData.json');
const META_PATH = path.join(__dirname, '.cache-meta.json');

const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN:+Who+is+hiring?&tags=story&hitsPerPage=50';
const HN_WANTSHIRED_URL = 'https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN:+Who+wants+to+be+hired&tags=story&hitsPerPage=50';

let cache = {
  employerData: [],
  seekerData: []
};

let refreshState = {
  lastRefreshDateKey: null,
  lastAttemptDateKey: null,
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
      lastAttemptDateKey: typeof parsed?.lastAttemptDateKey === 'string' ? parsed.lastAttemptDateKey : null
    };
  } catch (_) {
    return { lastRefreshDateKey: null, lastAttemptDateKey: null };
  }
}

async function writeMeta(lastRefreshDateKey, lastAttemptDateKey) {
  await writeJson(META_PATH, { lastRefreshDateKey, lastAttemptDateKey });
}

function buildMonthEntryFromHit(hit) {
  const date = new Date(hit.created_at);
  return {
    id: hit.objectID,
    label: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
    month: date.getMonth(),
    year: date.getFullYear(),
    ts: date.getTime(),
    count: hit.num_comments || 0
  };
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

async function fetchMonthlyThreadData(url, titleMatcher, disallowMatchers = [], minComments = 0) {
  const pages = [0, 1];
  let hits = [];

  for (const page of pages) {
    const res = await fetch(`${url}&page=${page}`);
    if (!res.ok) {
      throw new Error(`Algolia request failed: ${res.status}`);
    }
    const data = await res.json();
    hits = hits.concat(data.hits || []);
  }

  const latestByMonth = new Map();

  hits.forEach(hit => {
    if (!hit.title) return;
    if (!titleMatcher.test(hit.title)) return;
    if (disallowMatchers.some(re => re.test(hit.title))) return;
    if ((hit.num_comments || 0) < minComments) return;

    const monthEntry = buildMonthEntryFromHit(hit);
    const key = monthKey(monthEntry);
    const current = latestByMonth.get(key);

    if (!current || monthEntry.count > current.count) {
      latestByMonth.set(key, monthEntry);
    }
  });

  return [...latestByMonth.values()].sort((a, b) => a.ts - b.ts);
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
  refreshState.lastAttemptDateKey = meta.lastAttemptDateKey;
}

async function refreshCacheFromAlgolia() {
  const [freshEmployer, freshSeeker] = await Promise.all([
    fetchMonthlyThreadData(HN_SEARCH_URL, /who is hiring/i, [/wants to be hired/i, /freelancer/i], 50),
    fetchMonthlyThreadData(HN_WANTSHIRED_URL, /who wants to be hired/i, [/hiring/i], 10)
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

async function ensureDailyRefresh() {
  const today = getDateKey();

  if (refreshState.lastAttemptDateKey === today) {
    return { refreshed: false, attempted: false, dateKey: today, error: null };
  }

  if (!refreshState.inFlight) {
    refreshState.inFlight = (async () => {
      refreshState.lastAttemptDateKey = today;
      await writeMeta(refreshState.lastRefreshDateKey, refreshState.lastAttemptDateKey);

      try {
        await refreshCacheFromAlgolia();
        refreshState.lastRefreshDateKey = today;
        await writeMeta(refreshState.lastRefreshDateKey, refreshState.lastAttemptDateKey);
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
    lastAttemptDateKey: refreshState.lastAttemptDateKey,
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

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
