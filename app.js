'use strict';

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEO_BASE = 'https://nominatim.openstreetmap.org/reverse';

// WMO weather code → { label, emoji }
const WMO = {
  0:  { label: 'Clear Sky',        emoji: '☀️' },
  1:  { label: 'Mostly Clear',     emoji: '🌤️' },
  2:  { label: 'Partly Cloudy',    emoji: '⛅' },
  3:  { label: 'Overcast',         emoji: '☁️' },
  45: { label: 'Fog',              emoji: '🌫️' },
  48: { label: 'Icy Fog',          emoji: '🌫️' },
  51: { label: 'Light Drizzle',    emoji: '🌦️' },
  53: { label: 'Drizzle',          emoji: '🌦️' },
  55: { label: 'Heavy Drizzle',    emoji: '🌧️' },
  61: { label: 'Light Rain',       emoji: '🌧️' },
  63: { label: 'Rain',             emoji: '🌧️' },
  65: { label: 'Heavy Rain',       emoji: '🌧️' },
  71: { label: 'Light Snow',       emoji: '🌨️' },
  73: { label: 'Snow',             emoji: '❄️' },
  75: { label: 'Heavy Snow',       emoji: '❄️' },
  77: { label: 'Snow Grains',      emoji: '🌨️' },
  80: { label: 'Light Showers',    emoji: '🌦️' },
  81: { label: 'Showers',          emoji: '🌧️' },
  82: { label: 'Heavy Showers',    emoji: '⛈️' },
  85: { label: 'Snow Showers',     emoji: '🌨️' },
  86: { label: 'Heavy Snow Showers', emoji: '❄️' },
  95: { label: 'Thunderstorm',     emoji: '⛈️' },
  96: { label: 'Thunderstorm w/ Hail', emoji: '⛈️' },
  99: { label: 'Severe Thunderstorm', emoji: '⛈️' },
};

function wmo(code) {
  return WMO[code] ?? { label: 'Unknown', emoji: '🌡️' };
}

function windDir(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function uvLabel(uv) {
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very High';
  return 'Extreme';
}

function formatHour(isoString) {
  const d = new Date(isoString);
  const h = d.getHours();
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatDay(isoString, i) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  return new Date(isoString).toLocaleDateString('en-US', { weekday: 'short' });
}

function cToF(c) { return Math.round(c * 9/5 + 32); }
function kmhToMph(k) { return Math.round(k * 0.621371); }

// DOM refs
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

async function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      e => reject(new Error('Location access denied. Please allow location and try again.')),
      { timeout: 10000 }
    );
  });
}

async function getCityName(lat, lon) {
  try {
    const res = await fetch(
      `${GEO_BASE}?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    const a = data.address;
    return a.city || a.town || a.village || a.county || 'Your Location';
  } catch {
    return 'Your Location';
  }
}

async function getWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'weather_code',
      'uv_index',
      'precipitation_probability',
    ].join(','),
    hourly: [
      'temperature_2m',
      'weather_code',
      'precipitation_probability',
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'weather_code',
      'precipitation_probability_max',
    ].join(','),
    forecast_days: 7,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) throw new Error('Weather data unavailable.');
  return res.json();
}

function renderCurrent(data, city) {
  const c = data.current;
  const wx = wmo(c.weather_code);

  $('location-name').textContent = city;
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
    const t = new Date(hours.time[i]);
    if (t < now - 1800000) continue; // skip past hours (allow 30 min grace)

    const wx = wmo(hours.weather_code[i]);
    const isNow = count === 0;
    const card = document.createElement('div');
    card.className = 'hour-card' + (isNow ? ' now' : '');
    card.innerHTML = `
      <div class="hour-time">${isNow ? 'Now' : formatHour(hours.time[i])}</div>
      <div class="hour-icon">${wx.emoji}</div>
      <div class="hour-temp">${Math.round(hours.temperature_2m[i])}°</div>
      <div class="hour-rain">${hours.precipitation_probability[i] > 0 ? hours.precipitation_probability[i] + '%' : ''}</div>
    `;
    container.appendChild(card);
    count++;
  }
}

function renderDaily(data) {
  const daily = data.daily;
  const container = $('daily');
  container.innerHTML = '';

  for (let i = 0; i < daily.time.length; i++) {
    const wx = wmo(daily.weather_code[i]);
    const rain = daily.precipitation_probability_max[i];
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <div class="day-name">${formatDay(daily.time[i], i)}</div>
      <div class="day-icon">${wx.emoji}</div>
      <div class="day-rain">${rain > 0 ? rain + '%' : ''}</div>
      <div class="day-temps">
        <span class="day-hi">${Math.round(daily.temperature_2m_max[i])}°</span>
        <span class="day-lo">${Math.round(daily.temperature_2m_min[i])}°</span>
      </div>
    `;
    container.appendChild(row);
  }
}

async function init() {
  show('loading');
  try {
    const { lat, lon } = await getLocation();
    const [data, city] = await Promise.all([getWeather(lat, lon), getCityName(lat, lon)]);
    renderCurrent(data, city);
    renderHourly(data);
    renderDaily(data);
    show('main');
  } catch (err) {
    showError(err.message);
  }
}

$('retry-btn').addEventListener('click', init);

// Auto-refresh every 10 minutes when tab is visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) init();
});

init();
