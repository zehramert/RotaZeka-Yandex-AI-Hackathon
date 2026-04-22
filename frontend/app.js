/* ══════════════════════════════════════════════════════════════
   ROTAZEKA — app.js  v5
   ══════════════════════════════════════════════════════════════ */

console.log('app.js loaded — v5');
const API = '';

// ── STATE ────────────────────────────────────────────────────────
let selectedWeather = 'clear';
let selectedTraffic = 'low';
let allStops        = [];   // her stop: { stop_id, stop_type, line_id, line_name, ... }
let allLines        = [];   // { line_id, line_name }
let refreshTimer    = null;
let countdown       = 30;

// ── CONSTANTS ────────────────────────────────────────────────────
const STOP_COLORS = {
  university:'#a78bfa', terminal:'#00d4aa', hospital:'#f87171',
  market:'#fbbf24', residential:'#60a5fa', regular:'#4a6070', transfer_hub:'#f472b6'
};
const SPEED_MAP  = { congested:0.4, high:0.6, moderate:0.8, low:0.95 };
const PRECIP_MAP = { rain:8.0, snow:5.0, fog:1.0, wind:0.0, cloudy:0.0, clear:0.0 };
const WIND_MAP   = { wind:45.0, snow:20.0, fog:5.0, rain:15.0, cloudy:10.0, clear:5.0 };
const STATUS_COLORS = { green:'var(--teal)', yellow:'#ffaa00', orange:'#ff7700', red:'#ff4757' };
const BAR_COLORS    = { green:'var(--teal)', teal:'var(--teal)', yellow:'#ffaa00', orange:'#ff7700', red:'#ff4757', darkred:'#cc1a2a' };
const CROWD_LABELS  = { empty:'EMPTY', light:'LIGHT', moderate:'MODERATE', busy:'BUSY', crowded:'VERY CROWDED' };
const SEG_COLORS    = ['#00d4aa','#7dd3aa','#ffaa00','#ff7700','#ff4757'];
const CROWD_LEVELS  = ['empty','light','moderate','busy','crowded'];
const HOUR_SHAPE    = [0.8,0.5,0.4,0.3,0.4,0.6,1.2,2.2,2.8,2.0,1.5,1.3,1.4,1.6,1.8,1.9,2.5,3.1,2.6,2.0,1.5,1.2,1.0,0.9];
const W_IMP = { clear:0, cloudy:0.5, wind:1.2, fog:2.5, rain:3.5, snow:6.0 };
const T_IMP = { low:0, moderate:1.5, high:4.0, congested:8.0 };
const S_IMP = { regular:0, residential:0.5, market:1.0, hospital:1.5, terminal:0.5, university:2.0 };


// ════════════════════════════════════════════════════════════════
// INIT — page load
// ════════════════════════════════════════════════════════════════

async function init() {
  await loadLines();          // load line dropdown
  await loadAllStops();       // pre-load ALL stops + attach line_name for search
}


// ════════════════════════════════════════════════════════════════
// LOAD LINES
// ════════════════════════════════════════════════════════════════

async function loadLines() {
  try {
    const res  = await fetch(`${API}/lines`);
    const data = await res.json();
    allLines   = data.lines || [];

    const sel = document.getElementById('lineSelect');
    sel.innerHTML = '<option value="">Select a line...</option>';
    allLines.forEach(l => {
      sel.innerHTML += `<option value="${l.line_id}">${l.line_id} — ${l.line_name}</option>`;
    });
    document.getElementById('statLine').textContent = data.total;
  } catch(e) {
    showToast('API connection failed — demo mode active');
    loadMockData();
  }
}


// ════════════════════════════════════════════════════════════════
// LOAD ALL STOPS (for search + GPS) — attaches line_name to each stop
// ════════════════════════════════════════════════════════════════

async function loadAllStops() {
  try {
    const res  = await fetch(`${API}/stops`);
    const data = await res.json();
    if (!data.stops || !data.stops.length) return;
    allStops = data.stops;
  } catch(e) {
    console.log('loadAllStops silent fail:', e.message);
  }
}


// ════════════════════════════════════════════════════════════════
// LOAD STOPS FOR SELECTED LINE (dropdown + grid)
// ════════════════════════════════════════════════════════════════

async function loadStops() {
  const lineId = document.getElementById('lineSelect').value;
  if (!lineId) return;
  try {
    const res  = await fetch(`${API}/stops?line_id=${lineId}`);
    const data = await res.json();

    // Update allStops for this line (keep others too)
    const lineMap = {};
    allLines.forEach(l => { lineMap[l.line_id] = l.line_name; });
    const newStops = (data.stops || []).map(s => ({ ...s, line_name: lineMap[s.line_id] || '' }));
    // Merge: replace stops for this line, keep others
    allStops = [...allStops.filter(s => s.line_id !== lineId), ...newStops];

    const sel = document.getElementById('stopSelect');
    sel.innerHTML = '<option value="">Select a stop...</option>';
    newStops.forEach(s => {
      sel.innerHTML += `<option value="${s.stop_id}" data-type="${s.stop_type}" data-seq="${s.stop_sequence}">
        ${s.stop_sequence}. ${s.stop_id} (${s.stop_type})</option>`;
    });
    renderStopsGrid(newStops);
  } catch(e) {
    showToast('Could not load stops.');
  }
}


// ════════════════════════════════════════════════════════════════
// RENDER STOPS GRID
// ════════════════════════════════════════════════════════════════

function renderStopsGrid(stops) {
  const grid = document.getElementById('stopsGrid');
  grid.innerHTML = '';
  stops.forEach(s => {
    const color = STOP_COLORS[s.stop_type] || '#4a6070';
    grid.innerHTML += `
      <div class="stop-item" onclick="selectStop('${s.stop_id}')" id="stop-${s.stop_id}">
        <div class="stop-dot" style="background:${color}"></div>
        <div class="stop-info">
          <div class="stop-id">${s.stop_id}</div>
          <div class="stop-type">${s.stop_type}</div>
        </div>
      </div>`;
  });
}

function selectStop(stopId) {
  document.querySelectorAll('.stop-item').forEach(s => s.classList.remove('selected'));
  document.getElementById(`stop-${stopId}`)?.classList.add('selected');
  document.getElementById('stopSelect').value = stopId;
  runPrediction();
}


// ════════════════════════════════════════════════════════════════
// SEARCH ENGINE
// Searches: stop_id, stop_type, line_id, line_name
// Does NOT scroll — dropdown only
// ════════════════════════════════════════════════════════════════

function searchStops(val) {
  const drop = document.getElementById('searchDrop');
  const q    = val.trim().toLowerCase();

  if (!q) { drop.style.display = 'none'; return; }

  if (!allStops.length) {
    drop.innerHTML     = `<div style="padding:12px 16px;font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);text-align:center;">Loading stops…</div>`;
    drop.style.display = 'block';
    return;
  }

  const hits = allStops.filter(s => {
    const stopId   = s.stop_id.toLowerCase();
    const stopType = (s.stop_type  || '').toLowerCase();
    const lineId   = (s.line_id    || '').toLowerCase();
    const lineName = (s.line_name  || '').toLowerCase();
    return stopId.includes(q) || stopType.includes(q) || lineId.includes(q) || lineName.includes(q);
  }).slice(0, 10);

  if (!hits.length) {
    drop.innerHTML     = `<div style="padding:12px 16px;font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);text-align:center;">No results for "${val}"</div>`;
    drop.style.display = 'block';
    return;
  }

  drop.innerHTML = hits.map(s => {
    const col       = STOP_COLORS[s.stop_type] || '#4a6070';
    const lineLabel = s.line_name ? `${s.line_id} · ${s.line_name}` : (s.line_id || '');
    return `<div onclick="pickStopFromSearch('${s.stop_id}','${s.line_id||''}')"
      style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;
             border-bottom:1px solid var(--border);transition:background 0.12s;"
      onmouseover="this.style.background='var(--teal-dim)'"
      onmouseout="this.style.background=''">
      <div style="width:9px;height:9px;border-radius:50%;background:${col};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Space Mono',monospace;font-size:11px;color:var(--teal);">${s.stop_id}</div>
        <div style="font-size:11px;color:var(--muted);">${s.stop_type}</div>
      </div>
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);flex-shrink:0;text-align:right;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lineLabel}</div>
    </div>`;
  }).join('');
  drop.style.display = 'block';
}

function pickStopFromSearch(stopId, lineId) {
  // Close & clear search — no scroll
  document.getElementById('searchDrop').style.display = 'none';
  document.getElementById('stopSearch').value = '';

  const applyStop = () => {
    document.getElementById('stopSelect').value = stopId;
    document.querySelectorAll('.stop-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('stop-' + stopId)?.classList.add('selected');
  };

  if (lineId && document.getElementById('lineSelect').value !== lineId) {
    document.getElementById('lineSelect').value = lineId;
    loadStops().then(applyStop);
  } else {
    applyStop();
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#stopSearch') && !e.target.closest('#searchDrop'))
    document.getElementById('searchDrop').style.display = 'none';
});

// ════════════════════════════════════════════════════════════════
// RUN PREDICTION
// ════════════════════════════════════════════════════════════════

function getRealisticDelay() {
  const h = new Date().getHours();
  if (h >= 7  && h <= 9)  return 8.0;
  if (h >= 17 && h <= 19) return 10.0;
  if (h >= 22 || h <= 5)  return 1.0;
  return 3.5;
}

async function runPrediction() {
  const stopSel = document.getElementById('stopSelect');
  const stopId  = stopSel.value;
  if (!stopId) { showToast('Please select a stop.'); return; }

  const opt      = stopSel.options[stopSel.selectedIndex];
  const stopType = opt.dataset.type || 'regular';
  const stopSeq  = parseInt(opt.dataset.seq) || 1;
  const lineId = document.getElementById('lineSelect').value;
    
  const now       = new Date();
  const hour      = now.getHours();
  const dow       = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const isWeekend = (now.getDay() === 0 || now.getDay() === 6) ? 1 : 0;

  const btn = document.getElementById('predictBtn');
  btn.disabled = true; btn.textContent = '...';

  try {
    const [delayRes, crowdRes] = await Promise.all([
      fetch(`${API}/predict/delay`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          prev_stop_delay:getRealisticDelay(), speed_factor:SPEED_MAP[selectedTraffic]||0.8,
          traffic_level:selectedTraffic, weather_condition:selectedWeather, temperature_c:15.0,
          precipitation_mm:PRECIP_MAP[selectedWeather]||0.0, wind_speed_kmh:WIND_MAP[selectedWeather]||10.0,
          humidity_pct:selectedWeather==='rain'?85:55, hour_of_day:hour, is_weekend:isWeekend,
          day_of_week:dow, stop_sequence:stopSeq, stop_type:stopType,
          distance_from_prev_km:0.8, is_terminal:stopSeq===1?1:0, is_transfer_hub:0
        })
      }),
      fetch(`${API}/predict/crowd`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          stop_id:stopId, stop_type:stopType, hour_of_day:hour, day_of_week:dow,
          is_weekend:isWeekend, weather_condition:selectedWeather, traffic_level:selectedTraffic,
          speed_factor:SPEED_MAP[selectedTraffic]||0.8, minutes_to_next_bus:10.0
        })
      })
    ]);

    const delay = await delayRes.json();
    const crowd = await crowdRes.json();

    updateDelayCard(delay);
    updateCrowdCard(crowd);
    showResults();
    renderAnalytics(delay.predicted_delay_min, stopType, stopSeq, stopId);
    showStopMap(stopId, stopSeq, lineId);
    startRefreshCountdown();

  } catch(e) {
    showToast('Prediction failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'PREDICT →';
  }
}


// ════════════════════════════════════════════════════════════════
// CARDS
// ════════════════════════════════════════════════════════════════

function updateDelayCard(data) {
  const numEl = document.getElementById('delayNum');
  numEl.textContent = data.predicted_delay_min.toFixed(1);
  numEl.style.color = STATUS_COLORS[data.status_color] || 'var(--teal)';
  document.getElementById('arrivalTime').textContent = data.predicted_arrival;
  document.getElementById('confidence').textContent  = data.confidence;
  document.getElementById('modelVer').textContent    = data.model_version;
  document.getElementById('statusBadge').innerHTML   =
    `<span class="status-badge status-${data.status_color}">● ${data.status}</span>`;
  document.getElementById('delayCard').classList.add('loaded');
  document.getElementById('statDelay').textContent   = data.predicted_delay_min.toFixed(1) + ' min';
}

function updateCrowdCard(data) {
  document.getElementById('crowdNum').textContent = data.passengers_waiting;
  const bar = document.getElementById('crowdBar');
  bar.style.width      = data.crowding_pct + '%';
  bar.style.background = BAR_COLORS[data.crowding_color] || 'var(--teal)';
  const curIdx = CROWD_LEVELS.indexOf(data.crowding_level);
  for (let i = 0; i < 5; i++)
    document.getElementById(`seg${i}`).style.background = i <= curIdx ? SEG_COLORS[i] : 'var(--border)';
  const sc = `status-${data.crowding_color === 'teal' ? 'green' : data.crowding_color}`;
  document.getElementById('crowdBadge').innerHTML =
    `<span class="status-badge ${sc}">● ${CROWD_LABELS[data.crowding_level] || data.crowding_level}</span>`;
  document.getElementById('crowdCard').classList.add('loaded');
  document.getElementById('statCrowd').textContent = data.passengers_waiting + ' person';
}

function showResults() {
  document.getElementById('results').classList.add('visible');
  document.getElementById('statsRow').classList.add('visible');
}

function selectPill(el) {
  const group = el.dataset.group;
  document.querySelectorAll(`[data-group="${group}"]`).forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  if (group === 'weather') selectedWeather = el.dataset.val;
  if (group === 'traffic') selectedTraffic = el.dataset.val;
}


// ════════════════════════════════════════════════════════════════
// AUTO REFRESH
// ════════════════════════════════════════════════════════════════

function startRefreshCountdown() {
  clearInterval(refreshTimer);
  countdown = 30;
  updateRefreshInfo();
  refreshTimer = setInterval(() => {
    countdown--;
    updateRefreshInfo();
    //if (countdown <= 0) { runPrediction(); countdown = 30; }
  }, 1000);
}

function updateRefreshInfo() {
  // document.getElementById('refreshInfo').textContent = `Refresh in: ${countdown} seconds`;
}


// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}


// ════════════════════════════════════════════════════════════════
// REAL-TIME WEATHER
// ════════════════════════════════════════════════════════════════

async function loadRealTimeWeather() {
  const btn = document.getElementById('weatherBtn');
  btn.textContent = '⟳ Fetching...'; btn.disabled = true;
  try {
    const res  = await fetch(`${API}/current-weather`);
    const data = await res.json();
    selectedWeather = data.weather_condition;
    document.querySelectorAll('[data-group="weather"]').forEach(p => p.classList.remove('active'));
    const pill = document.querySelector(`[data-group="weather"][data-val="${data.weather_condition}"]`);
    if (pill) pill.classList.add('active');
    document.getElementById('weatherInfo').textContent = `${data.weather_label} · ${data.temperature_c}°C`;
  } catch(e) {
    showToast('Could not fetch weather');
  } finally {
    btn.textContent = '⟳ Get Current Weather'; btn.disabled = false;
  }
}


// ════════════════════════════════════════════════════════════════
// MOCK DATA (API offline)
// ════════════════════════════════════════════════════════════════

function loadMockData() {
  allLines = [
    { line_id:'L01', line_name:'Merkez - Üniversite' },
    { line_id:'L02', line_name:'Sanayi - Hastane' },
    { line_id:'L03', line_name:'Bağlar - Pazar' },
    { line_id:'L04', line_name:'Esentepe - Meydan' },
    { line_id:'L05', line_name:'Terminal - Kampüs' },
  ];
  document.getElementById('lineSelect').innerHTML =
    allLines.map(l => `<option value="${l.line_id}">${l.line_id} — ${l.line_name}</option>`).join('');
  document.getElementById('statLine').textContent = '5';

  const mockStops = [
    { stop_id:'STP-L01-01', stop_type:'terminal',    stop_sequence:1, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7558, longitude:37.0179 },
    { stop_id:'STP-L01-02', stop_type:'regular',     stop_sequence:2, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7520, longitude:37.0210 },
    { stop_id:'STP-L01-03', stop_type:'market',      stop_sequence:3, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7490, longitude:37.0250 },
    { stop_id:'STP-L01-04', stop_type:'university',  stop_sequence:4, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7450, longitude:37.0300 },
    { stop_id:'STP-L01-05', stop_type:'hospital',    stop_sequence:5, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7480, longitude:37.0150 },
    { stop_id:'STP-L01-06', stop_type:'residential', stop_sequence:6, line_id:'L01', line_name:'Merkez - Üniversite', latitude:39.7600, longitude:37.0100 },
    { stop_id:'STP-L02-01', stop_type:'terminal',    stop_sequence:1, line_id:'L02', line_name:'Sanayi - Hastane',    latitude:39.7430, longitude:37.0050 },
    { stop_id:'STP-L02-02', stop_type:'hospital',    stop_sequence:2, line_id:'L02', line_name:'Sanayi - Hastane',    latitude:39.7410, longitude:37.0080 },
    { stop_id:'STP-L02-03', stop_type:'regular',     stop_sequence:3, line_id:'L02', line_name:'Sanayi - Hastane',    latitude:39.7390, longitude:37.0120 },
    { stop_id:'STP-L03-01', stop_type:'market',      stop_sequence:1, line_id:'L03', line_name:'Bağlar - Pazar',      latitude:39.7510, longitude:37.0330 },
    { stop_id:'STP-L03-02', stop_type:'residential', stop_sequence:2, line_id:'L03', line_name:'Bağlar - Pazar',      latitude:39.7530, longitude:37.0360 },
  ];
  allStops = mockStops;

  const sel = document.getElementById('stopSelect');
  sel.innerHTML = '<option value="">Select stop...</option>';
  mockStops.filter(s => s.line_id === 'L01').forEach(s => {
    sel.innerHTML += `<option value="${s.stop_id}" data-type="${s.stop_type}" data-seq="${s.stop_sequence}">
      ${s.stop_sequence}. ${s.stop_id}</option>`;
  });
  renderStopsGrid(mockStops.filter(s => s.line_id === 'L01'));
}


// ════════════════════════════════════════════════════════════════
// ANALYTICS PANEL
// ════════════════════════════════════════════════════════════════

function showPane(name, btn) {
  ['hourly','route','risk'].forEach(p => {
    document.getElementById('pane-'+p).style.display = p === name ? '' : 'none';
  });
  document.querySelectorAll('.ap-tab').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.color       = 'var(--muted)';
    b.style.background  = 'transparent';
  });
  btn.style.borderColor = '#ffaa00';
  btn.style.color       = '#ffaa00';
  btn.style.background  = '#ffaa0011';
}

function renderAnalytics(delayMin, stopType, stopSeq, stopId) {
  document.getElementById('analyticsPanel').style.display = 'block';

  const curH    = new Date().getHours();
  const scale   = delayMin / (HOUR_SHAPE[curH] || 1);
  const profile = HOUR_SHAPE.map(v => Math.max(0, parseFloat((v * scale).toFixed(1))));
  const peak    = Math.max(...profile);
  const peakH   = profile.indexOf(peak);
  const avg     = (profile.reduce((a,b)=>a+b,0)/24).toFixed(1);
  const bestH   = profile.indexOf(Math.min(...profile));
  const isHigh  = delayMin > parseFloat(avg);

  document.getElementById('a-peak').textContent     = peak.toFixed(1)+' min';
  document.getElementById('a-peak-h').textContent   = 'at '+peakH+':00';
  document.getElementById('a-avg').textContent      = avg+' min';
  document.getElementById('a-best').textContent     = bestH+':00';
  document.getElementById('a-best-sub').textContent = profile[bestH].toFixed(1)+' min expected';
  document.getElementById('a-trend').textContent    = delayMin.toFixed(1)+' min';
  const tsub = document.getElementById('a-trend-sub');
  tsub.textContent = isHigh ? '▲ above average' : '▼ below average';
  tsub.style.color = isHigh ? '#ff4757' : '#00d4aa';

  // Hourly chart
  const chart = document.getElementById('hourlyChart');
  const maxV  = Math.max(...profile, 1);
  chart.innerHTML = '';
  profile.forEach((v, h) => {
    const pct     = Math.max(3, Math.round((v/maxV)*80));
    const col     = v>5?'#ff4757':v>3?'#ff7700':v>1.5?'#ffaa00':'#00d4aa';
    const outline = h===curH ? 'outline:2px solid #ffaa00;outline-offset:1px;' : '';
    chart.innerHTML += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">
      <div class="hbar" style="height:${pct}px;background:${col};width:100%;${outline}" data-tip="${h}:00 · ${v}min"></div>
      <span style="font-family:'Space Mono',monospace;font-size:7px;color:var(--muted);">${h%3===0?h:''}</span>
    </div>`;
  });

  // Route timeline
  const tl     = document.getElementById('routeTimeline');
  tl.innerHTML = '';
  const lineId = document.getElementById('lineSelect').value;
  const lineStops = lineId ? allStops.filter(s => s.line_id === lineId) : allStops;
  const stops = lineStops.length ? lineStops.slice(0,10) : [{stop_id:'STP-1',stop_sequence:1,stop_type:'regular'}];
  let cum = 0, worstId = '--', worstD = 0;
  const now = new Date();
  stops.forEach((s, i) => {
    const seq    = s.stop_sequence || i+1;
    const isNow  = s.stop_id === stopId || seq === stopSeq;
    const isPast = seq < stopSeq;
    const sd     = isNow ? delayMin : isPast ? parseFloat((delayMin*0.5*Math.random()).toFixed(1)) : parseFloat((delayMin*(0.7+seq*0.04)).toFixed(1));
    cum += sd;
    if (sd > worstD) { worstD = sd; worstId = s.stop_id; }
    const arrMs  = now.getTime() + ((seq-stopSeq)*4 + cum)*60000;
    const arr    = new Date(arrMs);
    const arrStr = String(arr.getHours()).padStart(2,'0')+':'+String(arr.getMinutes()).padStart(2,'0');
    const bgC    = sd>5?'#ff475722':sd>2?'#ffaa0022':'#00d4aa22';
    const fgC    = sd>5?'#ff4757':sd>2?'#ffaa00':'#00d4aa';
    tl.innerHTML += `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;position:relative;border-bottom:1px solid var(--border);">
      <div style="width:12px;height:12px;min-width:12px;border-radius:50%;border:2px solid ${isNow?'var(--teal)':'var(--border)'};background:${isNow?'var(--teal)':isPast?'var(--border)':'var(--bg)'};${isNow?'box-shadow:0 0 6px var(--teal);':''}"></div>
      <div style="flex:1;font-family:'Space Mono',monospace;font-size:11px;color:${isNow?'var(--teal)':'var(--muted)'};">${s.stop_id}</div>
      <div style="font-family:'Space Mono',monospace;font-size:9px;padding:2px 8px;border-radius:10px;background:${bgC};color:${fgC};white-space:nowrap;">+${sd.toFixed(1)}m</div>
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);min-width:36px;text-align:right;">${arrStr}</div>
    </div>`;
  });
  document.getElementById('r-total').textContent     = cum.toFixed(1)+' min';
  document.getElementById('r-worst').textContent     = worstId;
  document.getElementById('r-worst-sub').textContent = '+'+worstD.toFixed(1)+' min';
  document.getElementById('r-ontime').textContent    = Math.max(5, Math.round(100-delayMin*6))+'%';
    
  // Risk
  const wI = W_IMP[selectedWeather]||0, tI = T_IMP[selectedTraffic]||0, sI = S_IMP[stopType]||0;
  const score  = Math.min(100, Math.round((delayMin/15)*100));
  const rLabel = score<30?'LOW':score<60?'MODERATE':score<80?'HIGH':'CRITICAL';
  const rCol   = score<30?'#00d4aa':score<60?'#ffaa00':score<80?'#ff7700':'#ff4757';
  document.getElementById('risk-w').textContent         = '+'+wI.toFixed(1)+'m';
  document.getElementById('risk-w-sub').textContent     = selectedWeather;
  document.getElementById('risk-t').textContent         = '+'+tI.toFixed(1)+'m';
  document.getElementById('risk-t-sub').textContent     = selectedTraffic+' traffic';
  document.getElementById('risk-s').textContent         = '+'+sI.toFixed(1)+'m';
  document.getElementById('risk-s-sub').textContent     = stopType+' stop';
  document.getElementById('risk-score').textContent     = rLabel;
  document.getElementById('risk-score').style.color     = rCol;
  document.getElementById('risk-score-sub').textContent = 'score '+score+'/100';
  const factors = [
    {label:'Weather ('+selectedWeather+')', val:wI, max:6, col:'#60a5fa'},
    {label:'Traffic ('+selectedTraffic+')', val:tI, max:8, col:'#f87171'},
    {label:'Stop type ('+stopType+')',       val:sI, max:2, col:'#a78bfa'},
    {label:'Time of day', val:getRealisticDelay()*0.3, max:3, col:'#fbbf24'},
  ];
  const rb = document.getElementById('riskBars');
  rb.innerHTML = '';
  factors.forEach(f => {
    const pct = Math.min(100, f.max>0 ? Math.round((f.val/f.max)*100) : 0);
    rb.innerHTML += `<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:5px;">
        <span>${f.label}</span><span style="color:${f.col}">+${f.val.toFixed(1)} min</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${f.col};border-radius:3px;transition:width 0.7s ease;"></div>
      </div>
    </div>`;
  });
}

// ════════════════════════════════════════════════════════════════
// MAP VISUALIZATION
// ════════════════════════════════════════════════════════════════

let leafletMap     = null;
let leafletLayers  = [];

function showStopMap(currentStopId, stopSeq, lineId) {
  // Get all stops for this line sorted by sequence
  const lineStops = allStops
    .filter(s => s.line_id === lineId)
    .sort((a, b) => a.stop_sequence - b.stop_sequence);

  if (!lineStops.length) return;

  // Find current and previous stop
  const currentStop = lineStops.find(s => s.stop_id === currentStopId);
  const prevStop    = lineStops.find(s => s.stop_sequence === stopSeq - 1);

  if (!currentStop || !currentStop.latitude) return;

  // Show the map container
  const mapDiv = document.getElementById('stopMap');
  mapDiv.style.display = 'block';

  // Update info bar
  document.getElementById('mapToStop').textContent   = currentStop.stop_id + ' (' + currentStop.stop_type + ')';
  document.getElementById('mapFromStop').textContent  = prevStop ? prevStop.stop_id : 'Start of route';
  document.getElementById('mapStopType').textContent  = currentStop.stop_type;
  document.getElementById('mapStopLabel').textContent = lineId + ' · Stop ' + stopSeq;

  // Calculate distance if prev stop exists
  if (prevStop && prevStop.latitude) {
    const dist = haversineKm(
      prevStop.latitude, prevStop.longitude,
      currentStop.latitude, currentStop.longitude
    );
    document.getElementById('mapDistance').textContent = dist.toFixed(2) + ' km';
  } else {
    document.getElementById('mapDistance').textContent = 'First stop';
  }

  // Initialize or reset Leaflet map
  if (window._busAnimFrame) {
    cancelAnimationFrame(window._busAnimFrame);
    window._busAnimFrame = null;
  }
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }

  leafletMap = L.map('leafletMap', { zoomControl: true, scrollWheelZoom: false });

  // Dark tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    maxZoom: 18
  }).addTo(leafletMap);

  const markers = [];

  // Draw ALL stops on this line as small gray dots
  lineStops.forEach(s => {
    if (!s.latitude) return;
    const isPrev    = prevStop && s.stop_id === prevStop.stop_id;
    const isCurrent = s.stop_id === currentStopId;

    const color  = isCurrent ? '#00d4aa' : isPrev ? '#888888' : '#2a3a4a';
    const size   = isCurrent ? 14 : isPrev ? 10 : 6;
    const border = isCurrent ? '#ffffff' : isPrev ? '#aaaaaa' : '#1e2830';
    const zIndex = isCurrent ? 1000 : isPrev ? 500 : 100;

    const icon = L.divIcon({
      className : '',
      html      : `<div style="
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${color};
        border:2px solid ${border};
        box-shadow:${isCurrent ? '0 0 8px #00d4aa88' : 'none'};
      "></div>`,
      iconSize   : [size, size],
      iconAnchor : [size/2, size/2]
    });

    const label = isCurrent
      ? `<b style="color:#00d4aa">${s.stop_id}</b><br>Stop ${s.stop_sequence} · ${s.stop_type}<br><span style="color:#ffaa00">← Current</span>`
      : isPrev
      ? `<b>${s.stop_id}</b><br>Stop ${s.stop_sequence} · ${s.stop_type}<br><span style="color:#888">← Previous</span>`
      : `${s.stop_id}<br>Stop ${s.stop_sequence} · ${s.stop_type}`;

    const marker = L.marker([s.latitude, s.longitude], { icon, zIndexOffset: zIndex })
      .addTo(leafletMap)
      .bindPopup(`<div style="font-family:'Space Mono',monospace;font-size:11px;min-width:140px;">${label}</div>`);

    if (isCurrent) marker.openPopup();
    markers.push([s.latitude, s.longitude]);
  });

  // Draw route line through all stops
  if (markers.length > 1) {
    L.polyline(markers, {
      color  : '#1e4a6a',
      weight : 3,
      opacity: 0.8,
      dashArray: '6 4'
    }).addTo(leafletMap);
  }

  // Draw highlighted segment: prev → current (bright teal)
  if (prevStop && prevStop.latitude && currentStop.latitude) {
    L.polyline([
      [prevStop.latitude,   prevStop.longitude],
      [currentStop.latitude, currentStop.longitude]
    ], {
      color  : '#00d4aa',
      weight : 4,
      opacity: 1
    }).addTo(leafletMap);
  }

  // Fit map to show all stops with some padding
  if (markers.length) {
    leafletMap.fitBounds(markers, { padding: [40, 40], maxZoom: 15 });
  }

  // ── ANIMATED BUS ──────────────────────────────────────────────
  const delayMin = parseFloat(document.getElementById('delayNum').textContent) || 0;
  const progress = Math.min(1, delayMin / 30);

  const startLat = prevStop ? prevStop.latitude  : currentStop.latitude;
  const startLon = prevStop ? prevStop.longitude : currentStop.longitude;

  const busIcon = L.divIcon({
    className : '',
    html      : `<div style="
      background:#ffaa00;border:2px solid #fff;
      border-radius:8px;width:28px;height:28px;
      display:flex;align-items:center;justify-content:center;
      font-size:16px;box-shadow:0 0 12px #ffaa0088;">🚌</div>`,
    iconSize  : [28, 28],
    iconAnchor: [14, 14]
  });

  let animProgress = 0;
  const delaySeconds = delayMin * 60;
  const fps          = 60;
  const animSpeed    = delayMin > 0 ? 1 / (delaySeconds * fps) : 0.005;

  const initLat = startLat + (currentStop.latitude  - startLat) * animProgress;
  const initLon = startLon + (currentStop.longitude - startLon) * animProgress;

  const busMarker = L.marker([initLat, initLon], {
    icon        : busIcon,
    zIndexOffset: 2000
  })
  .addTo(leafletMap)
  .bindPopup(`
    <div style="font-family:'Space Mono',monospace;font-size:11px;min-width:140px;">
      <b style="color:#ffaa00">🚌 Bus Position</b><br>
      Delay: ${delayMin.toFixed(1)} min<br>
      ${delayMin < 2  ? '✅ On Time'      :
        delayMin < 5  ? '🟡 Slightly Late' :
        delayMin < 15 ? '🟠 Delayed'       : '🔴 Heavily Delayed'}
    </div>
  `);

  function animateBus() {
    animProgress += animSpeed;
    if (animProgress > 1) animProgress = 0;

    const animLat = startLat + (currentStop.latitude  - startLat) * animProgress;
    const animLon = startLon + (currentStop.longitude - startLon) * animProgress;

    busMarker.setLatLng([animLat, animLon]);

    window._busAnimFrame = requestAnimationFrame(animateBus);
  }

  animateBus();
}

// Haversine distance formula (km)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2) * Math.sin(dLat/2)
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}


// ════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════

init();