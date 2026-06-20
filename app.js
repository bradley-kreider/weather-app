'use strict';

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEO_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const GEO_SEARCH = 'https://nominatim.openstreetmap.org/search';

// WMO weather code → { label, emoji }
const WMO = {
  0:  { label: 'Clear Sky',             emoji: '☀️' },
  1:  { label: 'Mostly Clear',          emoji: '🌤️' },
  2:  { label: 'Partly Cloudy',         emoji: '⛅' },
  3:  { label: 'Overcast',              emoji: '☁️' },
  45: { label: 'Fog',                   emoji: '🌫️' },
  48: { label: 'Icy Fog',               emoji: '🌫️' },
  51: { label: 'Light Drizzle',         emoji: '🌦️' },
  53: { label: 'Drizzle',               emoji: '🌦️' },
  55: { label: 'Heavy Drizzle',         emoji: '🌧️' },
  61: { label: 'Light Rain',            emoji: '🌧️' },
  63: { label: 'Rain',                  emoji: '🌧️' },
  65: { label: 'Heavy Rain',            emoji: '🌧️' },
  71: { label: 'Light Snow',            emoji: '🌨️' },
  73: { label: 'Snow',                  emoji: '❄️' },
  75: { label: 'Heavy Snow',            emoji: '❄️' },
  77: { label: 'Snow Grains',           emoji: '🌨️' },
  80: { label: 'Light Showers',         emoji: '🌦️' },
  81: { label: 'Showers',               emoji: '🌧️' },
  82: { label: 'Heavy Showers',         emoji: '⛈️' },
  85: { label: 'Snow Showers',          emoji: '🌨️' },
  86: { label: 'Heavy Snow Showers',    emoji: '❄️' },
  95: { label: 'Thunderstorm',          emoji: '⛈️' },
  96: { label: 'Thunderstorm w/ Hail',  emoji: '⛈️' },
  99: { label: 'Severe Thunderstorm',   emoji: '⛈️' },
};

function wmo(code) { return WMO[code] ?? { label: 'Unknown', emoji: '🌡️' }; }
function windDir(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
}
function uvLabel(uv) {
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very High';
  return 'Extreme';
}
function formatHour(iso) {
  const h = new Date(iso).getHours();
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function formatDay(iso, i) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
}

// ── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wx_locations';
const ACTIVE_KEY  = 'wx_active';

function loadLocations() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveLocations(locs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(locs));
}

function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY);
}

function setActiveId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

// Each location: { id, name, sublabel, lat, lon, isGPS }
// GPS location always has id === 'gps'

function getGPSLocation() {
  try { return JSON.parse(localStorage.getItem('wx_gps')); }
  catch { return null; }
}
function saveGPSLocation(loc) {
  localStorage.setItem('wx_gps', JSON.stringify(loc));
}

// ── DOM ────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const screens = { loading: $('loading'), error: $('error'), main: $('main') };

function show(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}
function showError(msg) {
  $('error-msg').textContent = msg;
  show('error');
}

// ── Drawer ─────────────────────────────────────────────────────────────────

const drawer  = $('loc-drawer');
const overlay = $('loc-overlay');

function openDrawer() {
  drawer.classList.add('open');
  overlay.classList.add('open');
  renderSavedList();
}
function closeDrawer() {
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  $('loc-results').innerHTML = '';
  $('loc-search').value = '';
}

$('locations-btn').addEventListener('click', openDrawer);
$('loc-close-btn').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

$('loc-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchLocation();
});
$('loc-search-btn').addEventListener('click', searchLocation);

async function searchLocation() {
  const q = $('loc-search').value.trim();
  if (!q) return;
  const results = $('loc-results');
  results.innerHTML = '<div class="loc-searching">Searching…</div>';

  try {
    const res = await fetch(
      `${GEO_SEARCH}?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    results.innerHTML = '';

    if (!data.length) {
      results.innerHTML = '<div class="loc-searching">No results found.</div>';
      return;
    }

    data.forEach(item => {
      const a = item.address;
      const name = a.city || a.town || a.village || a.county || item.name;
      const sublabel = [a.state, a.country].filter(Boolean).join(', ');
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);

      const row = document.createElement('div');
      row.className = 'loc-result-item';
      row.innerHTML = `
        <span>${name}<br><small style="color:var(--muted)">${sublabel}</small></span>
        <button>Add</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        addLocation({ name, sublabel, lat, lon });
        closeDrawer();
        loadWeatherFor({ name, sublabel, lat, lon, id: getActiveId() });
      });
      results.appendChild(row);
    });
  } catch {
    results.innerHTML = '<div class="loc-searching">Search failed. Try again.</div>';
  }
}

function addLocation({ name, sublabel, lat, lon }) {
  const locs = loadLocations();
  const id = `loc_${Date.now()}`;
  locs.push({ id, name, sublabel, lat, lon, isGPS: false });
  saveLocations(locs);
  setActiveId(id);
}

function renderSavedList() {
  const container = $('loc-saved');
  container.innerHTML = '';
  const activeId = getActiveId();

  // GPS entry
  const gps = getGPSLocation();
  if (gps) {
    const item = document.createElement('div');
    item.className = 'loc-saved-item' + (activeId === 'gps' ? ' active' : '');
    item.innerHTML = `
      <span class="loc-icon">📍</span>
      <div>
        <div class="loc-label">${gps.name}</div>
        <div class="loc-sublabel">Current Location</div>
      </div>
    `;
    item.addEventListener('click', () => {
      setActiveId('gps');
      closeDrawer();
      loadWeatherFor(gps);
    });
    container.appendChild(item);
  }

  // Manual locations
  const locs = loadLocations();
  locs.forEach(loc => {
    const item = document.createElement('div');
    item.className = 'loc-saved-item' + (activeId === loc.id ? ' active' : '');
    item.innerHTML = `
      <span class="loc-icon">🏙️</span>
      <div style="flex:1">
        <div class="loc-label">${loc.name}</div>
        <div class="loc-sublabel">${loc.sublabel || ''}</div>
      </div>
      <button class="loc-delete-btn" aria-label="Remove">✕</button>
    `;
    item.addEventListener('click', e => {
      if (e.target.closest('.loc-delete-btn')) return;
      setActiveId(loc.id);
      closeDrawer();
      loadWeatherFor(loc);
    });
    item.querySelector('.loc-delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      removeLocation(loc.id);
      renderSavedList();
      // If we deleted the active one, fall back to GPS or first
      if (activeId === loc.id) {
        const remaining = loadLocations();
        const gpsLoc = getGPSLocation();
        if (gpsLoc) { setActiveId('gps'); loadWeatherFor(gpsLoc); }
        else if (remaining.length) { setActiveId(remaining[0].id); loadWeatherFor(remaining[0]); }
      }
    });
    container.appendChild(item);
  });

  if (!gps && !locs.length) {
    container.innerHTML = '<div class="loc-searching">No saved locations yet.</div>';
  }
}

function removeLocation(id) {
  saveLocations(loadLocations().filter(l => l.id !== id));
}

// ── Weather fetch & render ─────────────────────────────────────────────────

async function getWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    current: [
      'temperature_2m','apparent_temperature','relative_humidity_2m',
      'wind_speed_10m','wind_direction_10m','weather_code',
      'uv_index','precipitation_probability',
    ].join(','),
    hourly: ['temperature_2m','apparent_temperature','weather_code','precipitation_probability','wind_speed_10m'].join(','),
    daily: [
      'temperature_2m_max','temperature_2m_min',
      'weather_code','precipitation_probability_max',
    ].join(','),
    forecast_days: 7,
  });
  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) throw new Error('Weather data unavailable.');
  return res.json();
}

function renderCurrent(data, loc) {
  const c = data.current;
  const wx = wmo(c.weather_code);
  $('location-name').textContent = loc.name;
  $('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('temp').textContent = Math.round(c.temperature_2m);
  $('weather-icon').textContent = wx.emoji;
  $('condition').textContent = wx.label;
  $('feels-like').textContent = `Feels like ${Math.round(c.apparent_temperature)}°`;
  $('humidity').textContent = `${c.relative_humidity_2m}%`;
  $('wind').textContent = `${Math.round(c.wind_speed_10m)} mph ${windDir(c.wind_direction_10m)}`;
  $('uv').textContent = `${Math.round(c.uv_index)} · ${uvLabel(c.uv_index)}`;
  $('precip').textContent = `${c.precipitation_probability ?? 0}%`;
}

function renderHourly(data) {
  const now = new Date();
  const hours = data.hourly;
  const container = $('hourly');
  container.innerHTML = '';
  let count = 0;
  for (let i = 0; i < hours.time.length && count < 24; i++) {
    if (new Date(hours.time[i]) < now - 1800000) continue;
    const wx = wmo(hours.weather_code[i]);
    const card = document.createElement('div');
    card.className = 'hour-card' + (count === 0 ? ' now' : '');
    card.innerHTML = `
      <div class="hour-time">${count === 0 ? 'Now' : formatHour(hours.time[i])}</div>
      <div class="hour-icon">${wx.emoji}</div>
      <div class="hour-temp">${Math.round(hours.temperature_2m[i])}°</div>
      <div class="hour-rain">${hours.precipitation_probability[i] > 0 ? hours.precipitation_probability[i] + '%' : ''}</div>
    `;
    container.appendChild(card);
    count++;
  }
}

function buildDayHourly(data, dayIndex) {
  // Find hourly entries that belong to this calendar day
  const dayDate = data.daily.time[dayIndex]; // "YYYY-MM-DD"
  const hours = data.hourly;
  const slots = [];
  for (let i = 0; i < hours.time.length; i++) {
    if (hours.time[i].startsWith(dayDate)) slots.push(i);
  }

  // Show every 3 hours (8 slots max keeps it concise)
  const shown = slots.filter((_, idx) => idx % 3 === 0);

  if (!shown.length) return null;

  const ul = document.createElement('div');
  ul.className = 'day-hourly';

  shown.forEach(i => {
    const wx = wmo(hours.weather_code[i]);
    const rain = hours.precipitation_probability[i];
    const wind = Math.round(hours.wind_speed_10m[i]);
    const feels = Math.round(hours.apparent_temperature[i]);
    const row = document.createElement('div');
    row.className = 'day-hour-row';
    row.innerHTML = `
      <span class="dh-time">${formatHour(hours.time[i])}</span>
      <span class="dh-icon">${wx.emoji}</span>
      <span class="dh-temp">${Math.round(hours.temperature_2m[i])}°</span>
      <span class="dh-feels">Feels ${feels}°</span>
      <span class="dh-wind">${wind} mph</span>
      <span class="dh-rain${rain > 0 ? ' has-rain' : ''}">${rain > 0 ? rain + '%' : '—'}</span>
    `;
    ul.appendChild(row);
  });

  return ul;
}

function renderDaily(data) {
  const daily = data.daily;
  const container = $('daily');
  container.innerHTML = '';

  for (let i = 0; i < daily.time.length; i++) {
    const wx = wmo(daily.weather_code[i]);
    const rain = daily.precipitation_probability_max[i];

    const wrapper = document.createElement('div');
    wrapper.className = 'day-wrapper';

    const row = document.createElement('div');
    row.className = 'day-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.innerHTML = `
      <div class="day-name">${formatDay(daily.time[i], i)}</div>
      <div class="day-icon">${wx.emoji}</div>
      <div class="day-rain">${rain > 0 ? rain + '%' : ''}</div>
      <div class="day-temps">
        <span class="day-hi">${Math.round(daily.temperature_2m_max[i])}°</span>
        <span class="day-lo">${Math.round(daily.temperature_2m_min[i])}°</span>
      </div>
      <div class="day-chevron">›</div>
    `;

    const detail = document.createElement('div');
    detail.className = 'day-detail';
    const hourlyEl = buildDayHourly(data, i);
    if (hourlyEl) detail.appendChild(hourlyEl);

    function toggle() {
      const isOpen = wrapper.classList.toggle('open');
      // Close siblings
      if (isOpen) {
        container.querySelectorAll('.day-wrapper.open').forEach(w => {
          if (w !== wrapper) w.classList.remove('open');
        });
      }
    }

    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });

    wrapper.appendChild(row);
    wrapper.appendChild(detail);
    container.appendChild(wrapper);
  }
}

async function loadWeatherFor(loc) {
  show('loading');
  try {
    const data = await getWeather(loc.lat, loc.lon);
    renderCurrent(data, loc);
    renderHourly(data);
    renderDaily(data);
    show('main');
  } catch (err) {
    showError(err.message);
  }
}

// ── GPS location (one-time + cached) ──────────────────────────────────────

async function requestGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Location access denied. Add a location manually or allow location access.')),
      { timeout: 10000 }
    );
  });
}

async function getCityName(lat, lon) {
  try {
    const res = await fetch(`${GEO_REVERSE}?lat=${lat}&lon=${lon}&format=json`, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    const a = data.address;
    return a.city || a.town || a.village || a.county || 'Your Location';
  } catch { return 'Your Location'; }
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const activeId = getActiveId();
  const locs = loadLocations();
  const cached = getGPSLocation();

  // If there's a non-GPS active location, load it immediately — no GPS needed
  if (activeId && activeId !== 'gps') {
    const loc = locs.find(l => l.id === activeId);
    if (loc) return loadWeatherFor(loc);
  }

  // If GPS is active and we have a cached GPS fix, use it
  if (activeId === 'gps' && cached) {
    return loadWeatherFor(cached);
  }

  // First ever launch, or GPS active but no cache — request GPS once
  show('loading');
  try {
    const { lat, lon } = await requestGPS();
    const name = await getCityName(lat, lon);
    const gpsloc = { id: 'gps', name, lat, lon, isGPS: true };
    saveGPSLocation(gpsloc);
    setActiveId('gps');
    return loadWeatherFor(gpsloc);
  } catch (err) {
    // If GPS fails but there are manual locations, use the first one
    if (locs.length) {
      setActiveId(locs[0].id);
      return loadWeatherFor(locs[0]);
    }
    showError(err.message);
  }
}

$('retry-btn').addEventListener('click', init);
$('add-location-btn').addEventListener('click', openDrawer);

// Refresh weather (not location) when tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const activeId = getActiveId();
    const locs = loadLocations();
    const cached = getGPSLocation();
    let loc = null;
    if (activeId === 'gps') loc = cached;
    else loc = locs.find(l => l.id === activeId);
    if (loc) loadWeatherFor(loc);
  }
});

init();
