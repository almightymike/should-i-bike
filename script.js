// Forecast timestamps are returned in Pacific/Auckland local time by Open-Meteo.
const TIMEZONE = "Pacific/Auckland";
const API_URL = "https://api.open-meteo.com/v1/forecast?latitude=-41.317&longitude=174.817&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code&timezone=Pacific%2FAuckland&forecast_days=4&wind_speed_unit=kmh";
const WINDOWS = [
  { name: "Morning", hours: [8, 9, 10, 11], label: "8–11 am" },
  { name: "Afternoon", hours: [13, 14, 15, 16], label: "1–4 pm" }
];
const FIELDS = ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"];

function localClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function datesToShow(hourly, clock) {
  const dates = [...new Set(hourly.time.map((stamp) => stamp.slice(0, 10)))];
  const start = dates.indexOf(clock.date);
  if (start < 0) throw new Error("Forecast dates do not include today in Wellington.");
  const offset = clock.hour >= 17 ? 1 : 0;
  const selected = dates.slice(start + offset, start + offset + 3);
  if (selected.length < 3) throw new Error("The forecast has fewer than three upcoming days.");
  return selected;
}

function compass(degrees) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

function prevailingDirection(rows) {
  const vectors = rows.reduce((sum, row) => {
    const radians = row.wind_direction_10m * Math.PI / 180;
    const weight = Math.max(row.wind_speed_10m, 1);
    return { x: sum.x + Math.sin(radians) * weight, y: sum.y + Math.cos(radians) * weight };
  }, { x: 0, y: 0 });
  return compass(Math.atan2(vectors.x, vectors.y) * 180 / Math.PI);
}

function ratingFor(stats) {
  if (stats.thunder || stats.wind >= 30 || stats.gust >= 50 || stats.rainChance >= 60 || stats.rain >= 1.5) return "avoid";
  if (stats.wind >= 20 || stats.gust >= 35 || stats.rainChance >= 30 || stats.rain >= 0.4) return "caution";
  return "good";
}

function reasonFor(stats, rating) {
  if (stats.thunder) return "Thunder is forecast in this window.";
  if (rating === "good") return "Wind and rain stay below the caution limits.";
  if (stats.gust >= (rating === "avoid" ? 50 : 35)) return "Gusts could reach " + Math.round(stats.gust) + " km/h.";
  if (stats.wind >= (rating === "avoid" ? 30 : 20)) return "Wind could reach " + Math.round(stats.wind) + " km/h.";
  if (stats.rain >= (rating === "avoid" ? 1.5 : 0.4)) return "Rain could total " + stats.rain.toFixed(1) + " mm.";
  return "Rain chance could reach " + Math.round(stats.rainChance) + "%.";
}

function routeFor(rating, direction) {
  if (rating === "avoid") return "Skip exposed waterfront and peninsula roads. Check again later.";
  if (rating === "caution") return "Prefer a shorter Miramar loop over exposed coastal roads. Wind from " + direction + ".";
  return "A waterfront ride via Evans Bay is an option. Check open sections for wind from " + direction + ".";
}

function summariseWindow(hourly, date, window, clock) {
  const futureHours = window.hours.filter((hour) => date !== clock.date || hour > clock.hour);
  if (futureHours.length === 0) return { state: "passed" };

  const rows = [];
  for (const hour of futureHours) {
    const stamp = date + "T" + String(hour).padStart(2, "0") + ":00";
    const index = hourly.time.indexOf(stamp);
    if (index < 0 || FIELDS.some((field) => !Array.isArray(hourly[field]) || !Number.isFinite(hourly[field][index]))) {
      return { state: "incomplete", missing: stamp };
    }
    rows.push(Object.fromEntries(FIELDS.map((field) => [field, hourly[field][index]])));
  }

  const stats = {
    wind: Math.max(...rows.map((row) => row.wind_speed_10m)),
    gust: Math.max(...rows.map((row) => row.wind_gusts_10m)),
    rainChance: Math.max(...rows.map((row) => row.precipitation_probability)),
    rain: rows.reduce((sum, row) => sum + Math.max(row.precipitation, 0), 0),
    temp: rows.reduce((sum, row) => sum + row.temperature_2m, 0) / rows.length,
    direction: prevailingDirection(rows),
    thunder: rows.some((row) => row.weather_code >= 95)
  };
  return { state: "ready", stats, rating: ratingFor(stats), hours: futureHours };
}

function dateLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid forecast date.");
  return new Intl.DateTimeFormat("en-NZ", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(date + "T00:00:00Z"));
}

function windowHtml(result, window) {
  let content;
  if (result.state === "passed") {
    content = '<span class="rating unavailable">Window passed</span><p class="summary">This time has passed in Wellington.</p>';
  } else if (result.state === "incomplete") {
    content = '<span class="rating unavailable">Forecast unavailable</span><p class="summary">/inco: Hourly forecast data is missing for this window. No rating shown.</p>';
  } else {
    const stats = result.stats;
    const title = { good: "Favourable", caution: "Use caution", avoid: "Avoid exposed routes" }[result.rating];
    const time = result.hours.length < window.hours.length ? "Remaining: " + result.hours[0] + "–" + result.hours.at(-1) + ":00" : window.label;
    content = '<span class="rating ' + result.rating + '">' + title + '</span>' +
      '<p class="summary">' + reasonFor(stats, result.rating) + '</p>' +
      '<dl class="metrics">' +
      '<div><dt>Wind</dt><dd>' + Math.round(stats.wind) + ' km/h ' + stats.direction + '</dd></div>' +
      '<div><dt>Gusts</dt><dd>' + Math.round(stats.gust) + ' km/h</dd></div>' +
      '<div><dt>Rain chance</dt><dd>' + Math.round(stats.rainChance) + '%</dd></div>' +
      '<div><dt>Rain / temp</dt><dd>' + stats.rain.toFixed(1) + ' mm / ' + Math.round(stats.temp) + '°C</dd></div></dl>' +
      '<p class="route"><strong>Route note</strong>' + routeFor(result.rating, stats.direction) + '</p>';
    return '<section class="slot" aria-label="' + window.name + ' ' + time + '"><div class="slot-heading"><h4>' + window.name + '</h4><span>' + time + '</span></div>' + content + '</section>';
  }
  return '<section class="slot unavailable-slot" aria-label="' + window.name + '"><div class="slot-heading"><h4>' + window.name + '</h4><span>' + window.label + '</span></div>' + content + '</section>';
}

function renderForecast(hourly, clock) {
  const dates = datesToShow(hourly, clock);
  let incomplete = false;
  const cards = dates.map((date) => {
    const slots = WINDOWS.map((window) => {
      const result = summariseWindow(hourly, date, window, clock);
      if (result.state === "incomplete") incomplete = true;
      return windowHtml(result, window);
    }).join("");
    return '<article class="day-card"><div class="day-head"><h3>' + (date === clock.date ? "Today" : dateLabel(date).split(",")[0]) +
      '</h3><span>' + dateLabel(date) + '</span></div>' + slots + '</article>';
  });
  return { html: cards.join(""), incomplete };
}

async function loadForecast() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#forecast-grid");
  const button = document.querySelector("#refresh");
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = "Loading the latest forecast…";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(API_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Weather service returned " + response.status + ".");
    const payload = await response.json();
    if (!payload.hourly || !Array.isArray(payload.hourly.time) || payload.timezone !== TIMEZONE) {
      throw new Error("The weather service returned an unexpected forecast.");
    }
    const clock = localClock();
    const result = renderForecast(payload.hourly, clock);
    grid.innerHTML = result.html;
    status.textContent = "Forecast checked at " + String(clock.hour).padStart(2, "0") + ":" + String(clock.minute).padStart(2, "0") +
      " Wellington time." + (result.incomplete ? " /inco: Some forecast hours are missing, so affected windows have no rating." : "");
  } catch (error) {
    grid.replaceChildren();
    status.classList.add("error");
    status.textContent = "/inco: Live weather is unavailable. Wind and rain data are missing. Try Refresh forecast.";
    console.error("Forecast load failed:", error);
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
}

if (typeof document !== "undefined") {
  document.querySelector("#refresh").addEventListener("click", loadForecast);
  loadForecast();
}

if (typeof module !== "undefined") {
  module.exports = { localClock, datesToShow, compass, ratingFor, summariseWindow, renderForecast };
}
