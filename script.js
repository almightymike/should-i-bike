// Forecast timestamps are returned in Pacific/Auckland local time by Open-Meteo.
const TIMEZONE = "Pacific/Auckland";
const API_URL = "https://api.open-meteo.com/v1/forecast?latitude=-41.317&longitude=174.817&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code&timezone=Pacific%2FAuckland&forecast_days=4&wind_speed_unit=kmh";
const WINDOWS = [
  { name: "Morning", hours: [6, 7, 8, 9, 10], label: "06:00–11:00" },
  { name: "Afternoon", hours: [12, 13, 14, 15, 16], label: "12:00–17:00" }
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

function scoreFor(stats) {
  const rating = ratingFor(stats);
  if (rating === "avoid") return 1;
  if (rating === "good") {
    return stats.wind < 15 && stats.gust < 25 && stats.rainChance < 15 && stats.rain < 0.1 ? 5 : 4;
  }
  return stats.wind < 25 && stats.gust < 42 && stats.rainChance < 45 && stats.rain < 0.8 ? 3 : 2;
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
  if (rating === "avoid") return "Skip exposed coastal roads; check again later.";
  if (rating === "caution") return "Shorter sheltered Miramar / Seatoun loop. Check wind from " + direction + ".";
  return "Evans Bay / Oriental Bay loop is an option. Check open sections for wind from " + direction + ".";
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
  return { state: "ready", stats, rating: ratingFor(stats), score: scoreFor(stats), hours: futureHours };
}

function dateLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid forecast date.");
  return new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(date + "T00:00:00Z"));
}

function scoreBadge(result) {
  const titles = { good: "Favourable", caution: "Use caution", avoid: "Avoid exposed routes" };
  const title = titles[result.rating];
  return '<span class="score-badge ' + result.rating + '" aria-label="Ride score ' + result.score + ' out of 5, ' + title + '">' +
    '<span class="score-number">' + result.score + '<span class="score-total">/5</span></span>' +
    '<span class="score-label">' + title + '</span></span>';
}

function windowHtml(result, window) {
  if (result.state !== "ready") {
    const message = result.state === "passed" ? "This ride window has passed in Wellington." : "/inco: Hourly forecast data is missing. No rating shown.";
    return '<section class="slot unavailable"><div class="slot-head"><span class="slot-title">' + window.name + '</span><span class="rating">' +
      (result.state === "passed" ? "Past" : "Unavailable") + '</span></div><div class="slot-line">' + window.label + '</div><p class="note">' + message + '</p></section>';
  }
  const stats = result.stats;
  const time = result.hours.length < window.hours.length ? "Remaining: " + String(result.hours[0]).padStart(2, "0") + ":00–" +
    String(result.hours.at(-1) + 1).padStart(2, "0") + ":00" : window.label;
  return '<section class="slot ' + result.rating + '"><div class="slot-head"><span class="slot-title">' + window.name +
    '</span>' + scoreBadge(result) + '</div><div class="slot-line">' + time + ' · ' + reasonFor(stats, result.rating) + '</div>' +
    '<div class="conditions"><div class="condition"><span>Temp:</span> ' + Math.round(stats.temp) + '°C</div>' +
    '<div class="condition"><span>Wind:</span> ' + Math.round(stats.wind) + ' km/h ' + stats.direction + '</div>' +
    '<div class="condition"><span>Gusts:</span> ' + Math.round(stats.gust) + ' km/h</div>' +
    '<div class="condition"><span>Rain chance:</span> ' + Math.round(stats.rainChance) + '%</div>' +
    '<div class="condition"><span>Rain total:</span> ' + stats.rain.toFixed(1) + ' mm</div>' +
    '<div class="condition"><span>Exposure:</span> ' + (result.rating === "good" ? "check open sections" : "avoid open coast") + '</div></div>' +
    '<p class="route"><strong>Route:</strong> ' + routeFor(result.rating, stats.direction) + '</p></section>';
}

function rankWindow(entry) {
  const stats = entry.result.stats;
  return stats.gust * 2 + stats.wind + stats.rainChance + stats.rain * 20;
}

function highlightHtml(label, entry, emphasis = false, emptyText = "No comparable window", emptyNote = "Check the day cards for passed or incomplete windows.") {
  if (!entry) return '<article class="card"><div class="label">' + label + '</div><div class="headline">' + emptyText + '</div>' +
    '<p class="meta">' + emptyNote + '</p></article>';
  const { stats } = entry.result;
  return '<article class="card' + (emphasis ? ' best' : '') + '"><div class="label">' + label + '</div>' +
    '<div class="summary-head"><div class="headline">' + dateLabel(entry.date) + ' · ' + entry.window.name + '</div>' + scoreBadge(entry.result) + '</div>' +
    '<div class="meta">' + entry.window.label + ' · ' + reasonFor(stats, entry.result.rating) + '</div>' +
    '<div class="chips"><span class="chip">' + Math.round(stats.temp) + '°C</span><span class="chip">Wind ' + Math.round(stats.wind) + ' km/h</span>' +
    '<span class="chip">Gusts ' + Math.round(stats.gust) + ' km/h</span><span class="chip">Rain ' + Math.round(stats.rainChance) + '%</span></div>' +
    '<p class="route"><strong>Route:</strong> ' + routeFor(entry.result.rating, stats.direction) + '</p></article>';
}

function renderForecast(hourly, clock) {
  const dates = datesToShow(hourly, clock);
  let incomplete = false;
  const entries = [];
  const cards = dates.map((date) => {
    const slots = WINDOWS.map((window) => {
      const result = summariseWindow(hourly, date, window, clock);
      if (result.state === "incomplete") incomplete = true;
      if (result.state === "ready") entries.push({ date, window, result });
      return windowHtml(result, window);
    }).join("");
    return '<article class="card day-card"><div class="day-title"><div><h2>' + dateLabel(date) + '</h2>' +
      '<p class="meta">' + (date === clock.date ? "Today in Wellington" : "Morning and afternoon outlook") + '</p></div>' +
      '<span class="badge">' + (date === clock.date ? "Today" : "Upcoming") + '</span></div>' + slots + '</article>';
  });
  const ranked = entries.slice().sort((a, b) => b.result.score - a.result.score || rankWindow(a) - rankWindow(b));
  const rideOptions = ranked.filter((entry) => entry.result.score > 1);
  const best = rideOptions[0];
  const backup = rideOptions[1];
  const weakest = ranked.length > 1 ? ranked.at(-1) : null;
  const highlights = highlightHtml("Best overall", best, true, entries.length ? "No ride recommended" : "Forecast incomplete",
    entries.length ? "Every complete window is 1/5. Check again later." : "/inco: No complete upcoming window can be rated.") +
    highlightHtml("Best backup", backup, false, best ? "No backup available" : "No ride recommended",
      best ? "No second ride option scores above 1/5." : "No complete ride option scores above 1/5.") +
    highlightHtml("Weakest option", weakest);
  const final = '<article class="card"><div class="label">Final call</div><div class="headline">' +
    (best ? dateLabel(best.date) + ' · ' + best.window.name + ' · ' + best.result.score + '/5' :
      entries.length ? "No ride recommended" : "Forecast incomplete") +
    '</div><p class="meta">' + (best ? reasonFor(best.result.stats, best.result.rating) +
    (backup ? ' Backup: ' + dateLabel(backup.date) + ' ' + backup.window.name + ' (' + backup.result.score + '/5).' : '') :
    entries.length ? 'All complete upcoming windows score 1/5. Avoid exposed routes and check again later.' :
      '/inco: No complete upcoming window can be rated.') + '</p></article>' +
    '<article class="card"><div class="label">Source note</div><p class="meta">Live hourly forecast for Miramar from Open-Meteo. ' +
    'Score: 5 strong, 4 good, 3 cautious, 2 poor, 1 avoid. Each window uses the strongest wind and gust, highest rain chance, and total predicted rain. ' +
    'Check current conditions and route exposure before leaving.</p></article>';
  return { html: cards.join(""), highlights, final, incomplete };
}

async function loadForecast() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#forecast-grid");
  const highlights = document.querySelector("#highlights");
  const final = document.querySelector("#final-cards");
  const updated = document.querySelector("#updated");
  const button = document.querySelector("#refresh");
  button.disabled = true;
  status.classList.remove("warning");
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
    highlights.innerHTML = result.highlights;
    final.innerHTML = result.final;
    updated.textContent = "Updated " + dateLabel(clock.date) + " · " + String(clock.hour).padStart(2, "0") + ":" +
      String(clock.minute).padStart(2, "0") + " NZ time";
    status.textContent = result.incomplete ? "/inco: Some hourly forecast data is missing. Affected windows have no rating." :
      "Forecast checked at " + String(clock.hour).padStart(2, "0") + ":" + String(clock.minute).padStart(2, "0") + " Wellington time.";
    if (result.incomplete) status.classList.add("warning");
  } catch (error) {
    grid.replaceChildren();
    highlights.replaceChildren();
    final.replaceChildren();
    updated.textContent = "Forecast unavailable";
    status.classList.add("warning");
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
  module.exports = { localClock, datesToShow, compass, ratingFor, scoreFor, summariseWindow, renderForecast };
}
