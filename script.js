// Range selection logic for dashboard
window.currentRange = 24;
function setRange(months) {
  window.currentRange = months;
  // Update button active state
  document.getElementById('btn-12').classList.toggle('active', months === 12);
  document.getElementById('btn-24').classList.toggle('active', months === 24);
  document.getElementById('btn-all').classList.toggle('active', months === 0);
  renderAll();
}

// Patch renderAll to respect currentRange
const _renderAll = renderAll;
renderAll = function() {
  let data = window.allData.slice().sort((a, b) => a.ts - b.ts);
  if (window.currentRange && data.length > window.currentRange) {
    data = data.slice(-window.currentRange);
  }
  window.filteredData = data;
  _renderAll.call(this);
}

// On DOMContentLoaded, set initial range
window.addEventListener('DOMContentLoaded', () => {
  setRange(window.currentRange);
});

// HN Hiring Pulse: Initialize from data.json, fetch only new months
const HN_ITEM_URL = id => `https://hn.algolia.com/api/v1/items/${id}`;
const HN_SEARCH_URL = `https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN:+Who+is+hiring?&tags=story&hitsPerPage=50`;
const HN_SEARCH_AUTHOR = `https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN+Who+is+hiring&tags=story,author_whoishiring&hitsPerPage=50`;

window.allData = [];

async function loadDataJson() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('No data.json');
    return await res.json();
  } catch (e) {
    return [];
  }
}

function renderAll() {
  // Render stats, chart, and table using filtered data by range
  let data = window.allData.slice().sort((a, b) => a.ts - b.ts);
  if (window.currentRange && data.length > window.currentRange) {
    data = data.slice(-window.currentRange);
  }
  if (!data.length) return;

  // Stats
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const peak = data.reduce((max, d) => d.count > max.count ? d : max, data[0]);
  const low = data.reduce((min, d) => d.count < min.count ? d : min, data[0]);
  document.getElementById('stat-months').textContent = data.length;
  document.getElementById('stat-months-sub').textContent = `${data.length} shown`;
  document.getElementById('stat-latest').textContent = latest.count.toLocaleString();
  document.getElementById('stat-latest-sub').textContent = latest.label;
  document.getElementById('stat-peak').textContent = peak.count.toLocaleString();
  document.getElementById('stat-peak-sub').textContent = peak.label;
  document.getElementById('stat-low').textContent = low.count.toLocaleString();
  document.getElementById('stat-low-sub').textContent = low.label;
  if (prev) {
    const delta = latest.count - prev.count;
    const pct = Math.round((delta / prev.count) * 100);
    const el = document.getElementById('stat-mom');
    const sub = document.getElementById('stat-mom-sub');
    const isUp = delta >= 0;
    el.textContent = (isUp ? '+' : '') + delta.toLocaleString();
    el.className = 'stat-value ' + (isUp ? 'green' : 'red');
    // Show both month and year for previous month
    const prevMonthYear = prev.label;
    sub.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(pct)}% vs ${prevMonthYear}`;
    sub.className = 'stat-delta ' + (isUp ? 'up' : 'down');
  }

  // Chart
  const container = document.getElementById('chart-container');
  const chartCanvas = document.getElementById('chart');
  const dpr = window.devicePixelRatio || 1;
  const W = container.clientWidth - 48;
  const H = 280;
  chartCanvas.width = W * dpr;
  chartCanvas.height = H * dpr;
  chartCanvas.style.width = W + 'px';
  chartCanvas.style.height = H + 'px';
  const ctx = chartCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  const padL = 52, padR = 20, padT = 20, padB = 48;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const counts = data.map(d => d.count);
  const chartMaxCount = Math.max(...counts) || 1;
  const minCount = 0;
  ctx.clearRect(0, 0, W, H);
  // Grid lines
  const steps = 5;
  ctx.strokeStyle = 'rgba(42,42,42,0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (let i = 0; i <= steps; i++) {
    const y = padT + chartH - (i / steps) * chartH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
    ctx.fillStyle = '#444';
    ctx.font = '10px IBM Plex Mono';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((i / steps) * chartMaxCount), padL - 8, y + 4);
  }
  ctx.setLineDash([]);
  // 12-month rolling average
  const window12 = 12;
  const avgs = counts.map((_, idx) => {
    if (idx < window12 - 1) return null;
    const slice = counts.slice(idx - window12 + 1, idx + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const xPos = i => padL + (i / (data.length - 1)) * chartW;
  const yPos = v => padT + chartH - ((v - minCount) / (chartMaxCount - minCount)) * chartH;
  // Area fill under main line
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(counts[0]));
  counts.forEach((c, i) => { if (i > 0) ctx.lineTo(xPos(i), yPos(c)); });
  ctx.lineTo(xPos(data.length - 1), padT + chartH);
  ctx.lineTo(xPos(0), padT + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(255,102,0,0.18)');
  grad.addColorStop(1, 'rgba(255,102,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  // Rolling average line
  ctx.beginPath();
  let started = false;
  avgs.forEach((avg, i) => {
    if (avg === null) return;
    if (!started) { ctx.moveTo(xPos(i), yPos(avg)); started = true; }
    else ctx.lineTo(xPos(i), yPos(avg));
  });
  ctx.strokeStyle = 'rgba(255,102,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Main line
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(counts[0]));
  counts.forEach((c, i) => { if (i > 0) ctx.lineTo(xPos(i), yPos(c)); });
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Dots
  counts.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(xPos(i), yPos(c), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6600';
    ctx.fill();
    ctx.strokeStyle = '#0d0d0d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // X axis labels — show every Nth
  const step = Math.ceil(data.length / 16);
  ctx.fillStyle = '#555';
  ctx.font = '9px IBM Plex Mono';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    if (i % step === 0 || i === data.length - 1) {
      const label = d.label.replace(/(\w{3})\w+ (\d{4})/, '$1 $2');
      ctx.fillText(label, xPos(i), padT + chartH + 18);
    }
  });

  // Table
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';
  const sorted = data.slice().sort((a, b) => b.ts - a.ts);
  const tableMaxCount = Math.max(...sorted.map(d => d.count)) || 1;
  sorted.forEach((d, i) => {
    const prev = sorted[i + 1];
    let deltaHTML = '<span class="delta-badge neutral">—</span>';
    if (prev) {
      const delta = d.count - prev.count;
      const pct = Math.round((delta / prev.count) * 100);
      const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
      const sign = delta > 0 ? '+' : '';
      deltaHTML = `<span class="delta-badge ${cls}">${sign}${pct}%</span>`;
    }
    const pct = Math.round((d.count / tableMaxCount) * 100);
    const row = document.createElement('div');
    row.className = 'table-row';
    row.innerHTML = `
      <div class="td month">${d.label}</div>
      <div class="td bar-cell">
        <div class="mini-bar-track">
          <div class="mini-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="td count">${d.count.toLocaleString()}</div>
      <div class="td">${deltaHTML}</div>
      <div class="td">
        <a href="https://news.ycombinator.com/item?id=${d.id}" target="_blank"
           style="color:var(--muted);font-size:11px;text-decoration:none;"
           onmouseover="this.style.color='var(--hn-orange)'"
           onmouseout="this.style.color='var(--muted)'">
          #${d.id} ↗
        </a>
      </div>
    `;
    tbody.appendChild(row);
  });
}



// Utility to check if new months are available and enable/disable fetch button
async function checkFetchAvailability() {
  const minMonth = 4; // May (0-based)
  const minYear = 2026;
  const existing = window.allData || [];

  function isNewMonth(t) {
    return (
      t.year > minYear ||
      (t.year === minYear && t.month >= minMonth)
    ) && !existing.some(e => e.year === t.year && e.month === t.month);
  }

  // Fetch thread list but do not fetch post counts
  let res = await fetch(HN_SEARCH_AUTHOR + '&page=0');
  let data = await res.json();
  let hits = data.hits || [];
  let res2 = await fetch(HN_SEARCH_AUTHOR + '&page=1');
  let data2 = await res2.json();
  hits = hits.concat(data2.hits || []);
  let res3 = await fetch(HN_SEARCH_URL + '&page=0');
  let data3 = await res3.json();
  hits = hits.concat(data3.hits || []);
  let res4 = await fetch(HN_SEARCH_URL + '&page=1');
  let data4 = await res4.json();
  hits = hits.concat(data4.hits || []);
  const validTitles = hits.filter(h =>
    h.title &&
    /who is hiring/i.test(h.title) &&
    !/wants to be hired/i.test(h.title) &&
    !/freelancer/i.test(h.title) &&
    h.num_comments > 50
  );
  const threads = validTitles.map(h => {
    const date = new Date(h.created_at);
    return {
      id: h.objectID,
      month: date.getMonth(),
      year: date.getFullYear(),
    };
  });
  const newThreads = threads.filter(isNewMonth);
  const fetchBtn = document.getElementById('fetch-btn');
  if (fetchBtn) {
    if (newThreads.length === 0) {
      fetchBtn.disabled = true;
      fetchBtn.innerHTML = '<span>✔</span> ALL DATA FETCHED';
    } else {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = '<span>▶</span> Fetch Data';
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  window.allData = await loadDataJson();
  renderAll();
  checkFetchAvailability();
});


window.startFetch = async function startFetch() {
  const minMonth = 4; // May (0-based)
  const minYear = 2026;
  const existing = window.allData || [];

  function isNewMonth(t) {
    return (
      t.year > minYear ||
      (t.year === minYear && t.month >= minMonth)
    ) && !existing.some(e => e.year === t.year && e.month === t.month);
  }

  async function fetchThreadList() {
    let res = await fetch(HN_SEARCH_AUTHOR + '&page=0');
    let data = await res.json();
    let hits = data.hits || [];
    let res2 = await fetch(HN_SEARCH_AUTHOR + '&page=1');
    let data2 = await res2.json();
    hits = hits.concat(data2.hits || []);
    let res3 = await fetch(HN_SEARCH_URL + '&page=0');
    let data3 = await res3.json();
    hits = hits.concat(data3.hits || []);
    let res4 = await fetch(HN_SEARCH_URL + '&page=1');
    let data4 = await res4.json();
    hits = hits.concat(data4.hits || []);
    const validTitles = hits.filter(h =>
      h.title &&
      /who is hiring/i.test(h.title) &&
      !/wants to be hired/i.test(h.title) &&
      !/freelancer/i.test(h.title) &&
      h.num_comments > 50
    );
    return validTitles.map(h => {
      const date = new Date(h.created_at);
      const label = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      return {
        id: h.objectID,
        label,
        month: date.getMonth(),
        year: date.getFullYear(),
        ts: date.getTime()
      };
    });
  }

  async function fetchJobPostCount(threadId) {
    try {
      const res = await fetch(HN_ITEM_URL(threadId));
      const data = await res.json();
      const children = data.children || [];
      const valid = children.filter(c =>
        c.type === 'comment' &&
        !c.deleted &&
        !c.dead
      );
      return valid.length;
    } catch(e) {
      return 0;
    }
  }

  const threads = await fetchThreadList();
  const newThreads = threads.filter(isNewMonth);
  if (!newThreads.length) {
    // No alert, just disable fetch button and update text/icon
    const fetchBtn = document.getElementById('fetch-btn');
    if (fetchBtn) {
      fetchBtn.disabled = true;
      fetchBtn.innerHTML = '<span>✔</span> ALL DATA FETCHED';
    }
    return;
  }
  for (let i = 0; i < newThreads.length; i++) {
    const t = newThreads[i];
    const count = await fetchJobPostCount(t.id);
    window.allData.push({ ...t, count });
    console.log(`Fetched ${t.label}: ${count} posts`);
  }
  renderAll();
  // Automatically save updated data.json
  const blob = new Blob([JSON.stringify(window.allData, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);

  alert('Fetch complete! New months have been added and data.json has been downloaded.');
  // Re-check fetch availability after fetching
  checkFetchAvailability();
}

window.downloadData = function downloadData() {
  if (!window.allData || !window.allData.length) {
    alert('No data loaded yet. Please fetch data first.');
    return;
  }
  const blob = new Blob([JSON.stringify(window.allData, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
