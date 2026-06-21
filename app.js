'use strict';

const API_BASE   = 'https://api.open-meteo.com/v1/forecast';
const GEO_REV    = 'https://nominatim.openstreetmap.org/reverse';
const GEO_SEARCH = 'https://nominatim.openstreetmap.org/search';

// ── WMO codes ─────────────────────────────────────────────────────────────
const WMO = {
  0:{label:'Clear Sky',emoji:'☀️'},1:{label:'Mostly Clear',emoji:'🌤️'},
  2:{label:'Partly Cloudy',emoji:'⛅'},3:{label:'Overcast',emoji:'☁️'},
  45:{label:'Fog',emoji:'🌫️'},48:{label:'Icy Fog',emoji:'🌫️'},
  51:{label:'Light Drizzle',emoji:'🌦️'},53:{label:'Drizzle',emoji:'🌦️'},
  55:{label:'Heavy Drizzle',emoji:'🌧️'},61:{label:'Light Rain',emoji:'🌧️'},
  63:{label:'Rain',emoji:'🌧️'},65:{label:'Heavy Rain',emoji:'🌧️'},
  71:{label:'Light Snow',emoji:'🌨️'},73:{label:'Snow',emoji:'❄️'},
  75:{label:'Heavy Snow',emoji:'❄️'},77:{label:'Snow Grains',emoji:'🌨️'},
  80:{label:'Light Showers',emoji:'🌦️'},81:{label:'Showers',emoji:'🌧️'},
  82:{label:'Heavy Showers',emoji:'⛈️'},85:{label:'Snow Showers',emoji:'🌨️'},
  86:{label:'Heavy Snow Showers',emoji:'❄️'},95:{label:'Thunderstorm',emoji:'⛈️'},
  96:{label:'Thunderstorm w/ Hail',emoji:'⛈️'},99:{label:'Severe Thunderstorm',emoji:'⛈️'},
};
const wmo = c => WMO[c] ?? {label:'Unknown',emoji:'🌡️'};
const windDir = d => ['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];
const uvLabel = u => u<=2?'Low':u<=5?'Moderate':u<=7?'High':u<=10?'Very High':'Extreme';
function formatHour(iso) {
  const h = new Date(iso).getHours();
  if(h===0) return '12am'; if(h===12) return '12pm';
  return h<12?`${h}am`:`${h-12}pm`;
}
function formatDay(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

// ── Storage ────────────────────────────────────────────────────────────────
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
};

function loadLocations() { return LS.get('wx_locations') || []; }
function saveLocations(l) { LS.set('wx_locations', l); }
function getGPS() { return LS.get('wx_gps'); }
function saveGPS(l) { LS.set('wx_gps', l); }
function getActiveIdx() { return LS.get('wx_active_idx') ?? 0; }
function saveActiveIdx(i) { LS.set('wx_active_idx', i); }

// Build ordered list: GPS first (if exists), then manual locations
function allLocations() {
  const locs = loadLocations();
  const gps  = getGPS();
  return gps ? [gps, ...locs] : locs;
}

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = { loading: $('loading'), error: $('error'), main: $('main') };

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}
function showError(msg) { $('error-msg').textContent = msg; showScreen('error'); }

// ── Bottom sheet ───────────────────────────────────────────────────────────
const sheet        = $('add-sheet');
const sheetOverlay = $('sheet-overlay');
const locSearch    = $('loc-search');
const locResults   = $('loc-results');

function openSheet() {
  sheet.classList.add('open');
  sheetOverlay.classList.add('open');
  setTimeout(() => locSearch.focus(), 300);
}
function closeSheet() {
  sheet.classList.remove('open');
  sheetOverlay.classList.remove('open');
  locSearch.value = '';
  locResults.innerHTML = '';
}

$('add-location-btn').addEventListener('click', openSheet);
$('loc-close-btn').addEventListener('click', closeSheet);
sheetOverlay.addEventListener('click', closeSheet);
locSearch.addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });
locSearch.addEventListener('input', () => {
  if(locSearch.value.trim().length >= 3) doSearch();
});

async function doSearch() {
  const q = locSearch.value.trim();
  if(!q) return;
  locResults.innerHTML = '<div class="loc-searching">Searching…</div>';
  try {
    const res  = await fetch(`${GEO_SEARCH}?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
      {headers:{'Accept-Language':'en'}});
    const data = await res.json();
    locResults.innerHTML = '';
    if(!data.length) { locResults.innerHTML='<div class="loc-searching">No results found.</div>'; return; }
    data.forEach(item => {
      const a    = item.address;
      const name = a.city||a.town||a.village||a.county||item.name;
      const sub  = [a.state,a.country].filter(Boolean).join(', ');
      const lat  = parseFloat(item.lat);
      const lon  = parseFloat(item.lon);
      const row  = document.createElement('div');
      row.className = 'loc-result-item';
      row.innerHTML = `
        <div><div class="loc-result-name">${name}</div><div class="loc-result-sub">${sub}</div></div>
        <button class="loc-result-add">Add</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        const locs = loadLocations();
        const id   = `loc_${Date.now()}`;
        locs.push({id, name, sub, lat, lon});
        saveLocations(locs);
        closeSheet();
        await buildAllPanels();
        goTo(allLocations().length - 1);
      });
      locResults.appendChild(row);
    });
  } catch { locResults.innerHTML='<div class="loc-searching">Search failed.</div>'; }
}

// ── Weather API ────────────────────────────────────────────────────────────
async function fetchWeather(lat, lon) {
  const p = new URLSearchParams({
    latitude:lat, longitude:lon,
    temperature_unit:'fahrenheit', wind_speed_unit:'mph',
    precipitation_unit:'inch', timezone:'auto',
    current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,uv_index,precipitation_probability',
    hourly:'temperature_2m,apparent_temperature,weather_code,precipitation_probability,wind_speed_10m',
    daily:'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    forecast_days:7,
  });
  const res = await fetch(`${API_BASE}?${p}`);
  if(!res.ok) throw new Error('Weather unavailable.');
  return res.json();
}

// ── Panel rendering ────────────────────────────────────────────────────────
function buildDayHourly(data, dayIdx) {
  const dayDate = data.daily.time[dayIdx];
  const h = data.hourly;
  const shown = [];
  for(let i=0;i<h.time.length;i++) if(h.time[i].startsWith(dayDate)) shown.push(i);
  if(!shown.length) return null;

  const now = new Date();
  const ul = document.createElement('div');
  ul.className = 'day-hourly day-hourly-scroll';

  // For today, find which row is the current hour so we can scroll to it on open
  let currentRowEl = null;

  shown.forEach(i => {
    const wx   = wmo(h.weather_code[i]);
    const rain = h.precipitation_probability[i];
    const slotTime = new Date(h.time[i]);
    const isCurrent = dayIdx === 0
      && slotTime.getHours() === now.getHours()
      && slotTime.toDateString() === now.toDateString();

    const row = document.createElement('div');
    row.className = 'day-hour-row' + (isCurrent ? ' current-hour' : '');
    row.innerHTML = `
      <span class="dh-time">${formatHour(h.time[i])}</span>
      <span class="dh-icon">${wx.emoji}</span>
      <span class="dh-temp">${Math.round(h.temperature_2m[i])}°</span>
      <span class="dh-feels">Feels ${Math.round(h.apparent_temperature[i])}°</span>
      <span class="dh-wind">${Math.round(h.wind_speed_10m[i])} mph</span>
      <span class="dh-rain${rain>0?' has-rain':''}">${rain>0?rain+'%':'—'}</span>
    `;
    if(isCurrent) currentRowEl = row;
    ul.appendChild(row);
  });

  // Store reference so the accordion toggle can scroll to it after opening
  ul._currentRow = currentRowEl;
  return ul;
}

function buildPanel(loc, data, locIdx) {
  const panel = document.createElement('div');
  panel.className = 'city-panel';
  panel.dataset.idx = locIdx;

  const c  = data.current;
  const wx = wmo(c.weather_code);

  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-header-left">
        <div class="panel-loc">${loc.name}</div>
        <div class="panel-updated">Updated ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
      </div>
      <div class="panel-header-right">
        <div class="city-dots" data-dots></div>
        <button id="add-btn" aria-label="Add location">+</button>
      </div>
    </div>
    <section class="current">
      <div class="current-top">
        <div class="temp-block">
          <span class="temp-val">${Math.round(c.temperature_2m)}</span>
          <span class="unit">°F</span>
        </div>
        <div class="condition-block">
          <div class="wx-icon">${wx.emoji}</div>
          <div class="cond-label">${wx.label}</div>
          <div class="feels">Feels like ${Math.round(c.apparent_temperature)}°</div>
        </div>
      </div>
      <div class="current-details">
        <div class="detail"><span class="label">Humidity</span><span class="val">${c.relative_humidity_2m}%</span></div>
        <div class="detail"><span class="label">Wind</span><span class="val">${Math.round(c.wind_speed_10m)} mph ${windDir(c.wind_direction_10m)}</span></div>
        <div class="detail"><span class="label">UV Index</span><span class="val">${Math.round(c.uv_index)} · ${uvLabel(c.uv_index)}</span></div>
        <div class="detail"><span class="label">Rain</span><span class="val">${c.precipitation_probability??0}%</span></div>
      </div>
    </section>
    <section class="section-block">
      <h2>7-Day Forecast</h2>
      <div class="daily-list"></div>
    </section>
    <footer class="panel-footer">
      <span>Data: Open-Meteo · <a href="https://open-meteo.com" target="_blank">open-meteo.com</a></span>
    </footer>
  `;

  // Daily accordion
  const dailyList = panel.querySelector('.daily-list');
  data.daily.time.forEach((t,i) => {
    const dw   = wmo(data.daily.weather_code[i]);
    const rain = data.daily.precipitation_probability_max[i];
    const wrap = document.createElement('div');
    wrap.className = 'day-wrapper';
    wrap.innerHTML = `
      <div class="day-row" role="button" tabindex="0">
        <div class="day-name">${formatDay(t)}</div>
        <div class="day-icon">${dw.emoji}</div>
        <div class="day-rain">${rain>0?rain+'%':''}</div>
        <div class="day-temps"><span class="day-hi">${Math.round(data.daily.temperature_2m_max[i])}°</span><span class="day-lo">${Math.round(data.daily.temperature_2m_min[i])}°</span></div>
        <div class="day-chevron">›</div>
      </div>
      <div class="day-detail"></div>
    `;
    const detail   = wrap.querySelector('.day-detail');
    const hourlyEl = buildDayHourly(data, i);
    if(hourlyEl) detail.appendChild(hourlyEl);
    const row = wrap.querySelector('.day-row');
    const toggle = () => {
      const opening = !wrap.classList.contains('open');
      dailyList.querySelectorAll('.day-wrapper.open').forEach(w=>w.classList.remove('open'));
      if(opening) {
        wrap.classList.add('open');
        // After the max-height transition starts, scroll hourly list to current hour
        if(hourlyEl?._currentRow) {
          setTimeout(() => {
            const row = hourlyEl._currentRow;
            hourlyEl.scrollTop = row.offsetTop - row.offsetHeight;
          }, 50);
        }
      }
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e=>{if(e.key==='Enter'||e.key===' ')toggle();});
    dailyList.appendChild(wrap);
  });

  // Delete button for non-GPS cities
  if(!loc.isGPS) {
    const del = document.createElement('button');
    del.className = 'delete-city-btn';
    del.textContent = 'Remove this city';
    del.addEventListener('click', () => {
      const locs = loadLocations().filter(l=>l.id!==loc.id);
      saveLocations(locs);
      const newAll = allLocations();
      const newIdx = Math.min(locIdx, newAll.length-1);
      saveActiveIdx(newIdx);
      buildAllPanels().then(()=>goTo(newIdx, false));
    });
    panel.appendChild(del);
  }

  return panel;
}

// ── Swipe track ────────────────────────────────────────────────────────────
const track = $('swipe-track');
let currentIdx = 0;

function panelWidth() {
  const panel = track.querySelector('.city-panel');
  return panel ? panel.offsetWidth : window.innerWidth;
}

function goTo(idx, animate=true) {
  currentIdx = idx;
  saveActiveIdx(idx);
  if(animate) {
    track.classList.add('snap');
  } else {
    track.classList.remove('snap');
  }
  track.style.transform = `translateX(${-idx * panelWidth()}px)`;
  updateDots();
}

function updateDots() {
  const locs = allLocations();
  // Update every panel's dot container and wire its + button
  track.querySelectorAll('[data-dots]').forEach(container => {
    container.innerHTML = '';
    locs.forEach((loc,i) => {
      const dot = document.createElement('div');
      dot.className = 'city-dot' + (loc.isGPS?' gps':'') + (i===currentIdx?' active':'');
      dot.addEventListener('click', ()=>goTo(i));
      container.appendChild(dot);
    });
  });
  // Wire + buttons (each panel has one)
  track.querySelectorAll('#add-btn').forEach(btn => {
    btn.onclick = openSheet;
  });
}

// ── Build all panels ───────────────────────────────────────────────────────
async function buildAllPanels() {
  const locs = allLocations();
  if(!locs.length) return;

  track.innerHTML = '';
  // Fetch all in parallel, show placeholders while loading
  const results = await Promise.allSettled(locs.map(l=>fetchWeather(l.lat,l.lon)));

  results.forEach((r,i) => {
    if(r.status==='fulfilled') {
      track.appendChild(buildPanel(locs[i], r.value, i));
    } else {
      const panel = document.createElement('div');
      panel.className = 'city-panel';
      panel.innerHTML = `<div style="padding:120px 24px;text-align:center;color:var(--muted)">Could not load ${locs[i].name}</div>`;
      track.appendChild(panel);
    }
  });

  updateDots();
  lastFetch = Date.now();
}

// ── Swipe gesture ──────────────────────────────────────────────────────────
function initSwipe() {
  const vp = $('swipe-viewport');
  let startX=0, startY=0, dx=0, lastX=0, lastT=0, velX=0;
  let dragging=false, lockAxis=null, rafId=null;

  vp.addEventListener('touchstart', e=>{
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastX  = startX;
    lastT  = e.timeStamp;
    dx=0; velX=0; dragging=true; lockAxis=null;
    track.classList.remove('snap');
  },{passive:true});

  vp.addEventListener('touchmove', e=>{
    if(!dragging) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;

    if(!lockAxis) {
      if(Math.abs(mx) > Math.abs(my) + 4) lockAxis = 'x';
      else if(Math.abs(my) > Math.abs(mx) + 4) lockAxis = 'y';
      else return;
    }
    if(lockAxis==='y') return;
    e.preventDefault();

    // Track velocity (px/ms) over last frame
    const now = e.timeStamp;
    velX = (e.touches[0].clientX - lastX) / (now - lastT + 1);
    lastX = e.touches[0].clientX;
    lastT = now;
    dx = mx;

    if(rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(()=>{
      const base = -currentIdx * panelWidth();
      // Rubber-band resistance at edges
      const locs = allLocations();
      let offset = base + dx;
      if(dx > 0 && currentIdx === 0) offset = base + dx * 0.2;
      if(dx < 0 && currentIdx === locs.length-1) offset = base + dx * 0.2;
      track.style.transform = `translateX(${offset}px)`;
    });
  },{passive:false});

  const onEnd = () => {
    if(!dragging) return;
    dragging=false;
    if(rafId) { cancelAnimationFrame(rafId); rafId=null; }
    if(lockAxis !== 'x') return;

    const locs = allLocations();
    const pw = panelWidth();
    // Snap by distance OR flick velocity (>0.3 px/ms counts as a flick)
    const flickNext = velX < -0.3 && currentIdx < locs.length-1;
    const flickPrev = velX >  0.3 && currentIdx > 0;
    if((dx < -pw * 0.2 || flickNext) && currentIdx < locs.length-1) goTo(currentIdx+1);
    else if((dx > pw * 0.2 || flickPrev) && currentIdx > 0) goTo(currentIdx-1);
    else goTo(currentIdx);
  };

  vp.addEventListener('touchend',    onEnd, {passive:true});
  vp.addEventListener('touchcancel', onEnd, {passive:true});
}

// ── Geolocation (one-time cache) ───────────────────────────────────────────
async function requestGPS() {
  return new Promise((res,rej)=>{
    if(!navigator.geolocation) return rej(new Error('Geolocation not supported.'));
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
      ()=>rej(new Error('Location access denied. Add a city with the + button.')),
      {timeout:10000}
    );
  });
}

async function getCityName(lat,lon) {
  try {
    const r = await fetch(`${GEO_REV}?lat=${lat}&lon=${lon}&format=json`,{headers:{'Accept-Language':'en'}});
    const d = await r.json();
    const a = d.address;
    return a.city||a.town||a.village||a.county||'My Location';
  } catch { return 'My Location'; }
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  showScreen('loading');
  initSwipe();

  let locs = allLocations();

  // No locations at all — try GPS first
  if(!locs.length) {
    try {
      const {lat,lon} = await requestGPS();
      const name = await getCityName(lat,lon);
      saveGPS({id:'gps',name,lat,lon,isGPS:true});
    } catch(err) {
      // GPS failed — show error with Add button
      showError(err.message);
      return;
    }
    locs = allLocations();
  }

  await buildAllPanels();
  const savedIdx = Math.min(getActiveIdx(), locs.length-1);
  goTo(savedIdx, false);
  showScreen('main');
}

$('retry-btn').addEventListener('click', init);

// Refresh weather quietly in background when app comes back to foreground
// Only rebuild if data is stale (>10 min old)
let lastFetch = 0;
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden && screens.main.classList.contains('active')) {
    if(Date.now() - lastFetch > 10 * 60 * 1000) {
      buildAllPanels().then(()=>goTo(currentIdx, false));
    }
  }
});

init();
