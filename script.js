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



// HN Hiring Pulse: initialize from server-provided shared cache

window.allData = [];
window.wantsHiredData = [];
window.seekerDataLoaded = false;

async function loadSeekerDataJson() {
  try {
    const res = await fetch('seekerData.json');
    if (!res.ok) throw new Error('No seekerData.json');
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function loadDataJson() {
  try {
    const res = await fetch('employerData.json');
    if (!res.ok) throw new Error('No employerData.json');
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function loadDashboardDataFromServer() {
  const fetchInfo = document.getElementById('fetch-info');

  try {
    if (fetchInfo) {
      fetchInfo.innerHTML = '<span>⏳</span> Loading shared daily cache…';
    }

    const res = await fetch('/api/dashboard-data');
    if (!res.ok) throw new Error(`API error ${res.status}`);

    const payload = await res.json();
    window.allData = (payload.employerData || []).slice().sort((a, b) => a.ts - b.ts);
    window.wantsHiredData = (payload.seekerData || []).slice().sort((a, b) => a.ts - b.ts);
    window.seekerDataLoaded = true;

    if (fetchInfo) {
      if (payload.refreshError) {
        fetchInfo.innerHTML = '<span style="color:#ff4444">●</span> Refresh failed today, using shared cache';
      } else if (payload.refreshedOnRequest) {
        fetchInfo.innerHTML = '<span style="color:green">✔</span> Daily server refresh complete';
      } else {
        fetchInfo.innerHTML = '<span style="color:green">✔</span> Using shared daily cache';
      }
    }
  } catch (err) {
    console.error('Failed loading server data, falling back to local JSON files:', err);
    window.allData = await loadDataJson();
    window.wantsHiredData = await loadSeekerDataJson();
    window.seekerDataLoaded = true;

    if (fetchInfo) {
      fetchInfo.innerHTML = '<span style="color:#ff4444">●</span> Server cache unavailable, using local data';
    }
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
  const totalTrackedMonths = (window.allData || []).length;
  const shownMonths = data.length;
  document.getElementById('stat-months').textContent = totalTrackedMonths;
  document.getElementById('stat-months-sub').textContent = `${shownMonths} shown`;
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
  // Overlay seeker data
  const seekerData = (window.wantsHiredData || []).slice().sort((a, b) => a.ts - b.ts);
  const seekerCounts = seekerData.map(d => d.count);
  // Use the larger of the two for scaling
  const chartMaxCount = Math.max(...counts, ...seekerCounts) || 1;
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
  // Main line (employer)
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(counts[0]));
  counts.forEach((c, i) => { if (i > 0) ctx.lineTo(xPos(i), yPos(c)); });
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Dots (employer)
  counts.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(xPos(i), yPos(c), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6600';
    ctx.fill();
    ctx.strokeStyle = '#0d0d0d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // Overlay seeker line if available
  if (seekerData.length > 0) {
    // Align seeker data to employer data by month/year
    const employerKeys = data.map(d => `${d.year}-${d.month}`);
    const seekerMap = {};
    seekerData.forEach(d => { seekerMap[`${d.year}-${d.month}`] = d; });
    const seekerAligned = employerKeys.map(key => seekerMap[key] || null);
    // Draw seeker line
    ctx.beginPath();
    let started2 = false;
    seekerAligned.forEach((d, i) => {
      if (!d) return;
      if (!started2) { ctx.moveTo(xPos(i), yPos(d.count)); started2 = true; }
      else ctx.lineTo(xPos(i), yPos(d.count));
    });
    ctx.strokeStyle = '#4aa8ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Dots for seeker
    seekerAligned.forEach((d, i) => {
      if (d) {
        ctx.beginPath();
        ctx.arc(xPos(i), yPos(d.count), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4aa8ff';
        ctx.fill();
        ctx.strokeStyle = '#0d0d0d';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }
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
  const employerData = data.slice().sort((a, b) => b.ts - a.ts);
  // Use the global max count from allData, not just filtered data
  const globalMaxCount = Math.max(...window.allData.map(d => d.count)) || 1;
  // Use a local map for seeker data by year-month
  const seekerMap = Object.create(null);
  (window.wantsHiredData || []).forEach(d => { seekerMap[`${d.year}-${d.month}`] = d; });
  // Compute all ratios for color mapping
  const ratios = employerData.map(d => {
    const seeker = seekerMap[`${d.year}-${d.month}`];
    return (seeker && seeker.count > 0) ? d.count / seeker.count : null;
  }).filter(r => r !== null && isFinite(r));
  const minRatio = Math.min(...ratios);
  const maxRatio = Math.max(...ratios);

  employerData.forEach((d, i) => {
    const prev = employerData[i + 1];
    let deltaHTML = '<span class="delta-badge neutral">—</span>';
    if (prev) {
      const delta = d.count - prev.count;
      const pct = Math.round((delta / prev.count) * 100);
      const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
      const sign = delta > 0 ? '+' : '';
      deltaHTML = `<span class="delta-badge ${cls}">${sign}${pct}%</span>`;
    }
    let pct = Math.round((d.count / globalMaxCount) * 100);
    pct = Math.min(100, pct);
    // Find matching seeker data
    const seeker = seekerMap[`${d.year}-${d.month}`];
    const seekerCount = seeker ? seeker.count : '—';
    // Ratio (posts to seekers)
    let ratio = '—';
    let ratioColor = '#fff';
    if (seeker && seeker.count > 0) {
      const r = d.count / seeker.count;
      ratio = r.toFixed(2);
      // 1.0 = yellow (hue 50), below 1.0 = red to yellow, above 1.0 = yellow to green
      if (r === 1) {
        ratioColor = 'hsl(50, 100%, 50%)';
      } else if (r < 1) {
        // Red (hue 0) to yellow (hue 50)
        // t = 0 at r = minRatio, t = 1 at r = 1
        const t = (r - minRatio) / (1 - minRatio);
        const hue = 0 + t * 50;
        ratioColor = `hsl(${hue}, 100%, 50%)`;
      } else {
        // Yellow (hue 50) to green (hue 120)
        // t = 0 at r = 1, t = 1 at r = maxRatio
        const t = (r - 1) / (maxRatio - 1);
        const hue = 50 + t * (120 - 50);
        ratioColor = `hsl(${hue}, 100%, 45%)`;
      }
    }
    let seekerPct = seeker && globalMaxCount ? Math.round((seeker.count / globalMaxCount) * 100) : 0;
    seekerPct = Math.min(100, seekerPct);
    const row = document.createElement('div');
    row.className = 'table-row';
    let seekerThreadId = seeker ? seeker.id : null;
    row.innerHTML = `
      <div class="td month">
        <span style="color:var(--muted);font-weight:500;">${d.label}</span>
      </div>
      <div class="td bar-cell combined-bar-cell" style="flex-direction:column;align-items:flex-start;">
        <div style="display:flex;align-items:center;width:100%">
          <span style="margin-left:4px;margin-right:4px;font-size:11px;color:#ff6600;">${d.count.toLocaleString()}</span>
          <div class="mini-bar-track" style="display:inline-block;width:24%;margin-right:2%;vertical-align:middle;">
            <div class="mini-bar-fill" style="width:${pct}%;background:#ff6600"></div>
          </div>
        </div>
        <a href="https://news.ycombinator.com/item?id=${d.id}" target="_blank" style="color:var(--hn-orange);text-decoration:underline;font-size:10px;margin-top:2px;">#${d.id}</a>
      </div>
      <div class="td bar-cell combined-bar-cell" style="flex-direction:column;align-items:flex-start;">
        <div style="display:flex;align-items:center;width:100%">
          <span style="margin-left:4px; margin-right:4px;font-size:11px;color:#4aa8ff;">${seekerCount !== '—' ? seekerCount.toLocaleString() : '—'}</span>
          <div class="mini-bar-track" style="display:inline-block;width:24%;vertical-align:middle;">
            <div class="mini-bar-fill" style="width:${seekerPct}%;background:#4aa8ff"></div>
          </div>
        </div>
        ${seekerThreadId ? `<a href="https://news.ycombinator.com/item?id=${seekerThreadId}" target="_blank" style="color:#4aa8ff;text-decoration:underline;font-size:10px;margin-top:2px;">#${seekerThreadId}</a>` : `<span style=\"color:#666;font-size:10px;margin-top:2px;\">-</span>`}
      </div>
      <div class="td"style="margin-left:16px;">${deltaHTML}</div>
      <div class="td"><span style="color:${ratioColor}">${ratio}</span></div>
    `;
    tbody.appendChild(row);
  });
}



window.refreshData = async function refreshData() {
  await loadDashboardDataFromServer();
  renderAll();
};

window.addEventListener('DOMContentLoaded', async () => {
  await loadDashboardDataFromServer();
  renderAll();
});

window.downloadData = function downloadData() {
  if (!window.allData || !window.allData.length) {
    alert('No data loaded yet. Please fetch data first.');
    return;
  }
  const blob = new Blob([JSON.stringify(window.allData, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'employerData.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
