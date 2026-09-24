// Open-Meteo returns hourly timestamps in the selected location's local time.
const DEFAULT_LOCATION = { name: "Miramar", admin1: "Wellington", country: "New Zealand", country_code: "NZ",
  latitude: -41.317, longitude: 174.817, timezone: "Pacific/Auckland" };
const STORAGE_KEY = "should-i-bike-location";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const RIDE_HOURS = 2;
const RIDE_MIN_TEMP_C = 12;
const WINDOWS = [
  { name: "Morning", hours: [5, 6, 7, 8, 9, 10, 11], label: "05:00–11:59" },
  { name: "Afternoon", hours: [12, 13, 14, 15, 16, 17], label: "12:00–17:59" },
  { name: "Night", hours: [18, 19, 20, 21, 22, 23], label: "18:00–23:59" }
];
const FIELDS = ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"];

function localClock(now = new Date(), timezone = DEFAULT_LOCATION.timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function locationLabel(location) {
  return [location.name, location.admin1, location.country]
    .filter((part, index, parts) => part && parts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index)
    .join(", ");
}

function isMiramar(location) {
  return location.name.toLowerCase() === "miramar" && location.country_code === "NZ" &&
    location.admin1.toLowerCase().includes("wellington");
}

function isWellingtonCity(location) {
  return location.country_code === "NZ" && location.name.toLowerCase() === "wellington";
}

function validLocation(location) {
  if (!location || typeof location.name !== "string" || !location.name.trim() ||
      typeof location.admin1 !== "string" || typeof location.country !== "string" ||
      typeof location.country_code !== "string" || typeof location.timezone !== "string" ||
      !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
      !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: location.timezone }); return true; }
  catch { return false; }
}

function approximateLocation(data) {
  if (!data || typeof data.country_code !== "string") return null;
  let country = data.country_code;
  try { country = new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country; }
  catch { /* Keep the country code if a display name is unavailable. */ }
  const location = { name: data.name, admin1: data.admin1 || "", country,
    country_code: data.country_code, latitude: data.latitude, longitude: data.longitude,
    timezone: data.timezone, approximate: true };
  return validLocation(location) ? location : null;
}

function forecastUrl(location) {
  const url = new URL(FORECAST_API);
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("hourly", FIELDS.join(","));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("wind_speed_unit", "kmh");
  return url.toString();
}

function geocodingUrl(query) {
  const url = new URL(GEOCODING_API);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  return url.toString();
}

function locationMatches(query, results) {
  const matches = (Array.isArray(results) ? results : [])
    .filter((result) => result && typeof result === "object")
    .map(({ name, admin1, country, country_code, latitude, longitude, timezone }) =>
      ({ name, admin1: admin1 || "", country: country || "", country_code: country_code || "", latitude, longitude, timezone }))
    .filter(validLocation);
  const pinned = DEFAULT_LOCATION.name.toLowerCase().startsWith(query.toLowerCase()) ? [DEFAULT_LOCATION] : [];
  return [...pinned, ...matches]
    .filter((location, index, all) => all.findIndex((other) => locationLabel(other) === locationLabel(location)) === index)
    .slice(0, 8);
}

function datesToShow(hourly, clock) {
  const dates = [...new Set(hourly.time.map((stamp) => stamp.slice(0, 10)))];
  const start = dates.indexOf(clock.date);
  if (start < 0) throw new Error("Forecast dates do not include today in Wellington.");
  // After 22:00 no two full forecast hours remain before midnight.
  const offset = clock.hour >= 22 ? 1 : 0;
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

function routeFor(rating, direction, location) {
  if (rating === "avoid") return isMiramar(location) ? "Skip exposed coastal roads; check again later." :
    "No ride recommended. Check conditions again later.";
  if (isMiramar(location)) {
    if (rating === "caution") return "Shorter sheltered Miramar / Seatoun loop. Check wind from " + direction + ".";
    return "Evans Bay / Oriental Bay loop is an option. Check open sections for wind from " + direction + ".";
  }
  if (isWellingtonCity(location)) return rating === "caution" ?
    "Prefer a shorter sheltered city loop over the exposed waterfront. Check wind from " + direction + "." :
    "Oriental Bay / Evans Bay is an option. Check the open foreshore for wind from " + direction + ".";
  if (rating === "caution") return "Keep the loop short. Use sheltered streets and avoid open coasts or ridges in wind from " +
    direction + ".";
  return "Head into the " + direction + " wind first, then return with a tailwind. Check local road conditions.";
}

function statsForRows(rows) {
  return {
    wind: Math.max(...rows.map((row) => row.wind_speed_10m)),
    gust: Math.max(...rows.map((row) => row.wind_gusts_10m)),
    rainChance: Math.max(...rows.map((row) => row.precipitation_probability)),
    rain: rows.reduce((sum, row) => sum + Math.max(row.precipitation, 0), 0),
    temp: rows.reduce((sum, row) => sum + row.temperature_2m, 0) / rows.length,
    direction: prevailingDirection(rows),
    thunder: rows.some((row) => row.weather_code >= 95)
  };
}

function weatherBurden(stats) {
  return stats.gust * 2 + stats.wind + stats.rainChance + stats.rain * 20;
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

  const stats = statsForRows(rows);
  const pairs = [];
  for (let i = 0; i + RIDE_HOURS <= rows.length; i++) {
    if (futureHours[i + RIDE_HOURS - 1] !== futureHours[i] + RIDE_HOURS - 1) continue;
    const rideRows = rows.slice(i, i + RIDE_HOURS);
    const pair = statsForRows(rideRows);
    pairs.push({ hour: futureHours[i], stats: pair, score: scoreFor(pair), rating: ratingFor(pair),
      cold: rideRows.some((row) => row.temperature_2m < RIDE_MIN_TEMP_C) });
  }
  const bestPair = pairs.filter((pair) => pair.score > 1 && !pair.cold)
    .sort((a, b) => b.score - a.score || weatherBurden(a.stats) - weatherBurden(b.stats) || a.hour - b.hour)[0];
  const worstPair = pairs.sort((a, b) => a.score - b.score || weatherBurden(b.stats) - weatherBurden(a.stats) || a.hour - b.hour)[0];
  return { state: "ready", stats, rating: ratingFor(stats), score: scoreFor(stats), hours: futureHours,
    rideOutHour: bestPair?.hour ?? null, bestPair, worstPair };
}

function rideRange(hour) {
  return String(hour).padStart(2, "0") + ":00–" + String(hour + RIDE_HOURS - 1).padStart(2, "0") + ":59";
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

function windowHtml(result, window, location) {
  if (result.state !== "ready") {
    const message = result.state === "passed" ? "This ride window has passed." : "/inco: Hourly forecast data is missing. No rating shown.";
    return '<section class="slot unavailable"><div class="slot-head"><span class="slot-title">' + window.name + '</span><span class="rating">' +
      (result.state === "passed" ? "Past" : "Unavailable") + '</span></div><div class="slot-line">' + window.label + '</div><p class="note">' + message + '</p></section>';
  }
  const stats = result.stats;
  const titles = { good: "Favourable", caution: "Use caution", avoid: "Avoid exposed routes" };
  const time = result.hours.length < window.hours.length ? "Remaining: " + String(result.hours[0]).padStart(2, "0") + ":00–" +
    String(result.hours.at(-1)).padStart(2, "0") + ":59" : window.label;
  return '<section class="slot ' + result.rating + '"><div class="slot-head"><span class="slot-title">' + window.name +
    '</span><span class="rating score-text ' + result.rating + '" aria-label="Ride score ' + result.score + ' out of 5, ' +
    titles[result.rating] + '">' + result.score + '/5 · ' + titles[result.rating] +
    '</span></div><div class="slot-line">' + time + ' · ' + reasonFor(stats, result.rating) + '</div>' +
    '<div class="conditions"><div class="condition"><span>Temp:</span> ' + Math.round(stats.temp) + '°C</div>' +
    '<div class="condition"><span>Wind:</span> ' + Math.round(stats.wind) + ' km/h ' + stats.direction + '</div>' +
    '<div class="condition"><span>Gusts:</span> ' + Math.round(stats.gust) + ' km/h</div>' +
    '<div class="condition"><span>Rain chance:</span> ' + Math.round(stats.rainChance) + '%</div>' +
    '<div class="condition"><span>Rain total:</span> ' + stats.rain.toFixed(1) + ' mm</div>' +
    '<div class="condition"><span>Exposure:</span> ' + (result.rating === "good" ? "check open sections" :
      isMiramar(location) ? "avoid open coast" : "limit exposed sections") + '</div></div>' +
    '<p class="route"><strong>Route:</strong> ' + routeFor(result.rating, stats.direction, location) + '</p></section>';
}

function highlightHtml(label, entry, location, emphasis = false, emptyText = "No comparable window", emptyNote = "Check the day cards for passed or incomplete windows.", weakest = false) {
  if (!entry) return '<article class="card"><div class="label">' + label + '</div><div class="headline">' + emptyText + '</div>' +
    '<p class="meta">' + emptyNote + '</p></article>';
  const { stats } = entry.result;
  return '<article class="card' + (emphasis ? ' best' : '') + '"><div class="label">' + label + '</div>' +
    '<div class="summary-head"><div class="headline">' + dateLabel(entry.date) + ' · ' + entry.window.name + '</div>' + scoreBadge(entry.result) + '</div>' +
    '<div class="ride-out">' + (weakest ? "Weakest stretch: " : "Ride out: ") + rideRange(entry.result.hour) + '</div>' +
    '<div class="meta">' + reasonFor(stats, entry.result.rating) +
    (entry.result.cold ? ' Below the 12°C ride-out minimum.' : '') + '</div>' +
    '<div class="chips"><span class="chip">Temp ' + Math.round(stats.temp) + '°C</span><span class="chip">Wind ' + Math.round(stats.wind) + ' km/h ' + stats.direction + '</span>' +
    '<span class="chip">Gusts ' + Math.round(stats.gust) + ' km/h</span><span class="chip">Rain chance ' + Math.round(stats.rainChance) + '%</span>' +
    '<span class="chip">Rain total ' + stats.rain.toFixed(1) + ' mm</span></div>' +
    '<p class="route"><strong>Route:</strong> ' + routeFor(entry.result.rating, stats.direction, location) + '</p></article>';
}

function renderForecast(hourly, clock, location = DEFAULT_LOCATION) {
  const dates = datesToShow(hourly, clock);
  let incomplete = false;
  const entries = [];
  const cards = dates.map((date) => {
    const slots = WINDOWS.map((window) => {
      const result = summariseWindow(hourly, date, window, clock);
      if (result.state === "incomplete") incomplete = true;
      if (result.state === "ready") entries.push({ date, window, result });
      return windowHtml(result, window, location);
    }).join("");
    return '<article class="card day-card"><div class="day-title"><div><h2>' + dateLabel(date) + '</h2>' +
      '<p class="meta">' + (date === clock.date ? "Today" : "Morning, afternoon and night outlook") + '</p></div>' +
      '<span class="badge">' + (date === clock.date ? "Today" : "Upcoming") + '</span></div>' + slots + '</article>';
  });
  const rideOptions = entries.filter((entry) => entry.result.bestPair).map((entry) =>
    ({ date: entry.date, window: entry.window, result: entry.result.bestPair }))
    .sort((a, b) => b.result.score - a.result.score ||
      weatherBurden(a.result.stats) - weatherBurden(b.result.stats));
  const best = rideOptions[0];
  const backup = rideOptions[1];
  const weakest = entries.filter((entry) => entry.result.worstPair).map((entry) =>
    ({ date: entry.date, window: entry.window, result: entry.result.worstPair }))
    .sort((a, b) => a.result.score - b.result.score ||
      weatherBurden(b.result.stats) - weatherBurden(a.result.stats))[0];
  const highlights = highlightHtml("Best overall", best, location, true, entries.length ? "No ride recommended" : "Forecast incomplete",
    entries.length ? "No complete window has a suitable 2-hour start. Check again later." : "/inco: No complete upcoming window can be rated.") +
    highlightHtml("Best backup", backup, location, false, best ? "No backup available" : "No ride recommended",
      best ? "No second ride option has a suitable 2-hour start." : "No complete ride option has a suitable 2-hour start.") +
    highlightHtml("Weakest option", weakest, location, false, "No comparable stretch",
      "No complete two-hour stretch is available to compare.", true);
  const final = '<article class="card"><div class="label">Final call</div><div class="headline">' +
    (best ? dateLabel(best.date) + ' · ' + best.window.name + ' · ' + rideRange(best.result.hour) + ' · ' + best.result.score + '/5' :
      entries.length ? "No ride recommended" : "Forecast incomplete") +
    '</div><p class="meta">' + (best ? reasonFor(best.result.stats, best.result.rating) +
    (backup ? ' Backup: ' + dateLabel(backup.date) + ' ' + backup.window.name + ' (' + backup.result.score + '/5).' : '') :
    entries.length ? 'No complete upcoming window has a suitable 2-hour start. Check again later.' :
      '/inco: No complete upcoming window can be rated.') + '</p></article>' +
    '<article class="card"><div class="label">Source note</div><p class="meta">Live hourly forecast from Open-Meteo for the selected location. ' +
    'Score: 5 strong, 4 good, 3 cautious, 2 poor, 1 avoid. Forecast cards rate the entire time window. Ride highlights score and show conditions for a two-hour stretch only. ' +
    'Ride-out options need both hours at least 12°C. Night ratings cover weather, not lighting or visibility. Check current conditions and route exposure before leaving.</p></article>';
  return { html: cards.join(""), highlights, final, incomplete };
}

function savedLocation() {
  try {
    const location = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (validLocation(location)) return location;
  } catch { /* Private browsing can block storage. */ }
  return null;
}

const rememberedLocation = typeof document === "undefined" ? null : savedLocation();
let selectedLocation = rememberedLocation || DEFAULT_LOCATION;
let locationChoice = 0;
let forecastRequest = 0;
let forecastController;
let lastRequestedHourKey = null;
let searchRequest = 0;
let searchController;
let searchTimer;
let suggestions = [];
let activeSuggestion = -1;

function updateLocationHeader() {
  document.querySelector("#current-location").textContent = locationLabel(selectedLocation) +
    (selectedLocation.approximate ? " (approximate)" : "");
  document.querySelector("#page-title").textContent = selectedLocation.name + " Cycling Dashboard";
  document.title = "Should I Bike? | " + selectedLocation.name + " Cycling Dashboard";
}

function closeSuggestions() {
  const list = document.querySelector("#location-options");
  const input = document.querySelector("#location-query");
  list.replaceChildren();
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  suggestions = [];
  activeSuggestion = -1;
}

function chooseLocation(location) {
  if (!validLocation(location)) return;
  locationChoice++;
  clearTimeout(searchTimer);
  searchRequest++;
  searchController?.abort();
  selectedLocation = location;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(location)); } catch { /* Storage is optional. */ }
  document.querySelector("#location-query").value = "";
  document.querySelector("#location-hint").textContent = "Showing " + locationLabel(location) + ". Type to choose another location.";
  closeSuggestions();
  updateLocationHeader();
  loadForecast();
}

async function initialiseLocation(force = false) {
  if (rememberedLocation && !force) { loadForecast(); return; }
  lastRequestedHourKey = null;
  const choice = locationChoice;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  document.querySelector("#status").textContent = "Finding approximate location…";
  document.querySelector("#refresh").disabled = true;
  let estimate = null;
  try {
    const response = await fetch("/api/location", { cache: "no-store", signal: controller.signal });
    if (response.ok && response.status !== 204) estimate = approximateLocation(await response.json());
  } catch { /* Fall back to Miramar if the estimate is unavailable. */ }
  finally { clearTimeout(timer); }
  if (choice !== locationChoice) return;
  selectedLocation = estimate || DEFAULT_LOCATION;
  updateLocationHeader();
  document.querySelector("#location-hint").textContent = estimate ?
    "Approximate network location. Type to choose a more accurate place." :
    "Showing Miramar because approximate location is unavailable. Type to choose another place.";
  loadForecast();
}

function markSuggestion(index) {
  activeSuggestion = index;
  const input = document.querySelector("#location-query");
  document.querySelectorAll("#location-options button").forEach((button, position) => {
    button.classList.toggle("active", position === index);
    button.setAttribute("aria-selected", String(position === index));
  });
  if (index >= 0) input.setAttribute("aria-activedescendant", "location-option-" + index);
  else input.removeAttribute("aria-activedescendant");
}

function showSuggestions(locations) {
  closeSuggestions();
  suggestions = locations;
  const list = document.querySelector("#location-options");
  for (const [index, location] of locations.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = "location-option-" + index;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.textContent = locationLabel(location);
    button.addEventListener("click", () => chooseLocation(location));
    item.append(button);
    list.append(item);
  }
  list.hidden = locations.length === 0;
  document.querySelector("#location-query").setAttribute("aria-expanded", String(locations.length > 0));
}

async function searchLocations(query, requestId) {
  const hint = document.querySelector("#location-hint");
  const pinned = locationMatches(query, []);
  if (pinned.length) showSuggestions(pinned);
  const controller = new AbortController();
  searchController = controller;
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(geocodingUrl(query), { signal: controller.signal });
    if (!response.ok) throw new Error("Location search returned " + response.status);
    const data = await response.json();
    if (requestId !== searchRequest) return;
    const locations = locationMatches(query, data.results);
    showSuggestions(locations);
    hint.textContent = locations.length ? "Select a suggestion, or use the arrow keys and Enter." : "No matches. Try a city name or a longer search.";
  } catch (error) {
    if (requestId !== searchRequest) return;
    if (!pinned.length) closeSuggestions();
    hint.textContent = pinned.length ? "Miramar is available. Other suggestions could not load." :
      error.name === "AbortError" ? "Location search timed out. Try again." : "Location search unavailable. Try again.";
  } finally { clearTimeout(timer); }
}

function setupLocationSearch() {
  const input = document.querySelector("#location-query");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchRequest++;
    searchController?.abort();
    closeSuggestions();
    const query = input.value.trim();
    const hint = document.querySelector("#location-hint");
    if (query.length < 3) {
      hint.textContent = "Type at least 3 letters to see location suggestions.";
      return;
    }
    hint.textContent = "Searching locations…";
    const requestId = searchRequest;
    searchTimer = setTimeout(() => searchLocations(query, requestId), 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeSuggestions(); return; }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      markSuggestion(activeSuggestion < 0 ? (event.key === "ArrowDown" ? 0 : suggestions.length - 1) :
        (activeSuggestion + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseLocation(suggestions[activeSuggestion < 0 ? 0 : activeSuggestion]);
    }
  });
  document.addEventListener("click", (event) => {
    if (!document.querySelector(".location-picker").contains(event.target)) closeSuggestions();
  });
}

async function loadForecast() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#forecast-grid");
  const highlights = document.querySelector("#highlights");
  const final = document.querySelector("#final-cards");
  const updated = document.querySelector("#updated");
  const button = document.querySelector("#refresh");
  forecastController?.abort();
  const requestId = ++forecastRequest;
  const location = selectedLocation;
  const requestClock = localClock(new Date(), location.timezone);
  lastRequestedHourKey = requestClock.date + ":" + requestClock.hour;
  const controller = new AbortController();
  forecastController = controller;
  button.disabled = true;
  status.classList.remove("warning");
  status.textContent = "Loading forecast for " + locationLabel(location) + "…";
  grid.replaceChildren();
  highlights.replaceChildren();
  final.replaceChildren();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(forecastUrl(location), { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Weather service returned " + response.status + ".");
    const payload = await response.json();
    if (requestId !== forecastRequest) return;
    if (!payload.hourly || !Array.isArray(payload.hourly.time) || typeof payload.timezone !== "string") {
      throw new Error("The weather service returned an unexpected forecast.");
    }
    const clock = localClock(new Date(), payload.timezone);
    const result = renderForecast(payload.hourly, clock, location);
    grid.innerHTML = result.html;
    highlights.innerHTML = result.highlights;
    final.innerHTML = result.final;
    updated.textContent = "Checked " + dateLabel(clock.date) + " · " + String(clock.hour).padStart(2, "0") + ":" +
      String(clock.minute).padStart(2, "0") + " local time";
    status.textContent = result.incomplete ? "/inco: Some hourly forecast data is missing. Affected windows have no rating." :
      "Forecast checked for " + locationLabel(location) + " at " + String(clock.hour).padStart(2, "0") + ":" +
      String(clock.minute).padStart(2, "0") + " local time.";
    if (result.incomplete) status.classList.add("warning");
  } catch (error) {
    if (requestId !== forecastRequest) return;
    grid.replaceChildren();
    highlights.replaceChildren();
    final.replaceChildren();
    updated.textContent = "Forecast unavailable";
    status.classList.add("warning");
    status.textContent = "/inco: Live weather is unavailable. Wind and rain data are missing. Try Refresh forecast.";
    console.error("Forecast load failed:", error);
  } finally {
    clearTimeout(timer);
    if (requestId === forecastRequest) button.disabled = false;
  }
}

function refreshWhenHourChanges() {
  if (document.visibilityState === "hidden" || !lastRequestedHourKey) return;
  const clock = localClock(new Date(), selectedLocation.timezone);
  const hourKey = clock.date + ":" + clock.hour;
  if (hourKey !== lastRequestedHourKey) loadForecast();
}

if (typeof document !== "undefined") {
  if (rememberedLocation) updateLocationHeader();
  setupLocationSearch();
  document.querySelector("#refresh").addEventListener("click", loadForecast);
  // Remove expired ride-out times without requiring a manual page reload.
  setInterval(refreshWhenHourChanges, 30000);
  document.addEventListener("visibilitychange", refreshWhenHourChanges);
  document.querySelector("#use-approx").addEventListener("click", () => {
    locationChoice++;
    searchRequest++;
    searchController?.abort();
    clearTimeout(searchTimer);
    closeSuggestions();
    document.querySelector("#location-query").value = "";
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    initialiseLocation(true);
  });
  initialiseLocation();
}

if (typeof module !== "undefined") {
  module.exports = { localClock, datesToShow, compass, ratingFor, scoreFor, summariseWindow, renderForecast,
    locationLabel, validLocation, approximateLocation, forecastUrl, geocodingUrl, locationMatches };
}
