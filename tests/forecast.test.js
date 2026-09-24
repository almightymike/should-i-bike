const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { localClock, datesToShow, compass, ratingFor, scoreFor, summariseWindow, renderForecast,
  locationLabel, validLocation, approximateLocation, forecastUrl, geocodingUrl, locationMatches } = require("../script.js");

const morning = { name: "Morning", hours: [6, 7, 8, 9, 10] };

function fixture(date = "2026-09-25") {
  const hours = morning.hours;
  return {
    time: hours.map((hour) => date + "T" + String(hour).padStart(2, "0") + ":00"),
    temperature_2m: [12, 13, 14, 15, 16],
    precipitation_probability: [10, 20, 15, 10, 15],
    precipitation: [0, 0, 0, 0, 0],
    wind_speed_10m: [10, 12, 13, 11, 12],
    wind_gusts_10m: [18, 20, 22, 19, 21],
    wind_direction_10m: [0, 10, 350, 0, 5],
    weather_code: [1, 1, 2, 1, 2]
  };
}

test("Wellington dates use local time, including the daylight saving change", () => {
  assert.equal(localClock(new Date("2026-09-24T12:30:00Z")).date, "2026-09-25");
  assert.equal(localClock(new Date("2026-09-27T11:30:00Z")).date, "2026-09-28");
  assert.equal(localClock(new Date("2026-09-24T12:30:00Z"), "America/Los_Angeles").date, "2026-09-24");
});

test("selected locations set coordinates and use local forecast time", () => {
  const location = { name: "Paris", admin1: "Île-de-France", country: "France", country_code: "FR",
    latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" };
  assert.equal(validLocation(location), true);
  assert.equal(locationLabel(location), "Paris, Île-de-France, France");
  const url = new URL(forecastUrl(location));
  assert.equal(url.searchParams.get("latitude"), "48.85");
  assert.equal(url.searchParams.get("longitude"), "2.35");
  assert.equal(url.searchParams.get("timezone"), "auto");
  assert.equal(new URL(geocodingUrl("Par")).searchParams.get("name"), "Par");
  assert.equal(validLocation({ ...location, latitude: 190 }), false);
  const matches = locationMatches("Mir", [{ name: "Miramar", admin1: "Wellington", country: "New Zealand",
    country_code: "NZ", latitude: -41.31, longitude: 174.82, timezone: "Pacific/Auckland" },
    { ...location, name: "Mirabel", admin1: undefined }]);
  assert.equal(matches[0].latitude, -41.317);
  assert.equal(matches.length, 2);
  assert.equal(matches[1].admin1, "");
  const estimate = approximateLocation({ name: "Wellington", admin1: "Wellington", country_code: "NZ",
    latitude: -41.28, longitude: 174.78, timezone: "Pacific/Auckland" });
  assert.equal(locationLabel(estimate), "Wellington, New Zealand");
  assert.equal(estimate.approximate, true);
  assert.equal(approximateLocation({ ...estimate, timezone: "Invalid/Timezone" }), null);
});

test("wind directions use full compass names", () => {
  assert.equal(compass(0), "North");
  assert.equal(compass(45), "Northeast");
  assert.equal(compass(225), "Southwest");
  assert.equal(compass(315), "Northwest");
});

test("Cloudflare location response is private and falls back when metadata is missing", async () => {
  const source = readFileSync(join(__dirname, "../functions/api/location.js"), "utf8");
  const { onRequestGet } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  const absent = onRequestGet({ request: { cf: {} } });
  assert.equal(absent.status, 204);
  const response = onRequestGet({ request: { cf: { city: "Wellington", region: "Wellington", country: "NZ",
    latitude: "-41.28", longitude: "174.78", timezone: "Pacific/Auckland" } } });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { name: "Wellington", admin1: "Wellington", country_code: "NZ",
    latitude: -41.28, longitude: 174.78, timezone: "Pacific/Auckland" });
});

test("after the last two-hour night start, show tomorrow and the following two days", () => {
  const hourly = { time: ["2026-09-24T00:00", "2026-09-25T00:00", "2026-09-26T00:00", "2026-09-27T00:00"] };
  assert.deepEqual(datesToShow(hourly, { date: "2026-09-24", hour: 21 }), ["2026-09-24", "2026-09-25", "2026-09-26"]);
  assert.deepEqual(datesToShow(hourly, { date: "2026-09-24", hour: 22 }), ["2026-09-25", "2026-09-26", "2026-09-27"]);
});

test("rating limits include gusts and rain even when mean wind is light", () => {
  const base = { wind: 12, gust: 20, rainChance: 10, rain: 0, thunder: false };
  assert.equal(ratingFor(base), "good");
  assert.equal(ratingFor({ ...base, gust: 35 }), "caution");
  assert.equal(ratingFor({ ...base, gust: 50 }), "avoid");
  assert.equal(ratingFor({ ...base, rainChance: 60 }), "avoid");
  assert.equal(ratingFor({ ...base, thunder: true }), "avoid");
});

test("the five scores respect rating thresholds and thunder always scores 1", () => {
  const calm = { wind: 10, gust: 20, rainChance: 10, rain: 0, thunder: false };
  assert.equal(scoreFor(calm), 5);
  assert.equal(scoreFor({ ...calm, gust: 25 }), 4);
  assert.equal(scoreFor({ ...calm, gust: 35 }), 3);
  assert.equal(scoreFor({ ...calm, gust: 42 }), 2);
  assert.equal(scoreFor({ ...calm, gust: 50 }), 1);
  assert.equal(scoreFor({ ...calm, thunder: true }), 1);
});

test("a missing hourly value never produces a favourable rating", () => {
  const hourly = fixture();
  hourly.wind_gusts_10m[2] = null;
  const result = summariseWindow(hourly, "2026-09-25", morning, { date: "2026-09-24", hour: 9 });
  assert.equal(result.state, "incomplete");
  assert.equal(result.score, undefined);
});

test("today's window uses only future full forecast hours", () => {
  const hourly = fixture("2026-09-24");
  hourly.wind_gusts_10m[0] = 80;
  const result = summariseWindow(hourly, "2026-09-24", morning, { date: "2026-09-24", hour: 9 });
  assert.deepEqual(result.hours, [10]);
  assert.equal(result.rating, "good");
  assert.equal(result.rideOutHour, null);
});

test("ride-out time picks the best consecutive two-hour stretch within the window", () => {
  const hourly = fixture();
  hourly.wind_gusts_10m = [45, 46, 20, 19, 21];
  const result = summariseWindow(hourly, "2026-09-25", morning, { date: "2026-09-24", hour: 9 });
  assert.equal(result.score, 2);
  assert.equal(result.rideOutHour, 8);
  assert.equal(result.bestPair.score, 4);
  hourly.temperature_2m = [8, 8, 9, 12, 12];
  assert.equal(summariseWindow(hourly, "2026-09-25", morning, { date: "2026-09-24", hour: 9 }).rideOutHour, 9);
  hourly.temperature_2m.fill(8);
  assert.equal(summariseWindow(hourly, "2026-09-25", morning, { date: "2026-09-24", hour: 9 }).rideOutHour, null);
  const night = { name: "Night", hours: [18, 19, 20, 21, 22, 23] };
  const nightData = fixture();
  nightData.time = night.hours.map((hour) => "2026-09-25T" + hour + ":00");
  for (const field of ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"]) {
    nightData[field] = night.hours.map(() => ({ temperature_2m: 14, precipitation_probability: 10, precipitation: 0,
      wind_speed_10m: 10, wind_gusts_10m: 20, wind_direction_10m: 0, weather_code: 1 })[field]);
  }
  assert.equal(summariseWindow(nightData, "2026-09-25", night, { date: "2026-09-25", hour: 21 }).rideOutHour, 22);
  assert.equal(summariseWindow(nightData, "2026-09-25", night, { date: "2026-09-25", hour: 22 }).rideOutHour, null);
});

test("dashboard ranks complete future windows and renders the reference card sections", () => {
  const time = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => date + "T" + String(hour).padStart(2, "0") + ":00"));
  const hourly = { time };
  for (const field of ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"]) {
    hourly[field] = time.map(() => ({ temperature_2m: 14, precipitation_probability: 10, precipitation: 0,
      wind_speed_10m: 10, wind_gusts_10m: 20, wind_direction_10m: 0, weather_code: 1 })[field]);
  }
  const result = renderForecast(hourly, { date: "2026-09-24", hour: 20 });
  assert.match(result.highlights, /Best overall/);
  assert.match(result.highlights, /Best backup/);
  assert.match(result.highlights, /Weakest option/);
  assert.equal((result.html.match(/class="card day-card"/g) || []).length, 3);
  assert.equal((result.html.match(/class="slot good"/g) || []).length, 7);
  assert.match(result.html, /Night/);
  assert.doesNotMatch(result.html, /Ride out:/);
  assert.match(result.highlights, /Ride out: 05:00/);
  assert.match(result.highlights, /Wind 10 km\/h North/);
  assert.match(result.highlights, /Rain total 0.0 mm/);
  assert.match(result.highlights, /Weakest stretch:/);
  assert.match(result.final, /Final call/);
  assert.match(result.html, /rating score-text good" aria-label="Ride score 5 out of 5, Favourable"/);
  assert.match(result.highlights, /score-badge good" aria-label="Ride score 5 out of 5, Favourable"/);
  const elsewhere = renderForecast(hourly, { date: "2026-09-24", hour: 20 },
    { name: "Paris", admin1: "Île-de-France", country: "France", country_code: "FR",
      latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris" });
  assert.doesNotMatch(elsewhere.html, /Evans Bay|Seatoun|Miramar/);
  assert.match(elsewhere.html, /Head into the North wind first, then return with a tailwind/);
  const wellington = renderForecast(hourly, { date: "2026-09-24", hour: 20 },
    { name: "Wellington", admin1: "Wellington Region", country: "New Zealand", country_code: "NZ",
      latitude: -41.28, longitude: 174.78, timezone: "Pacific/Auckland" });
  assert.match(wellington.html, /Oriental Bay \/ Evans Bay/);
  hourly.wind_gusts_10m.fill(36);
  const cautious = renderForecast(hourly, { date: "2026-09-24", hour: 20 });
  assert.match(cautious.html, /rating score-text caution" aria-label="Ride score 3 out of 5, Use caution"/);
  hourly.wind_gusts_10m.fill(55);
  const unsafe = renderForecast(hourly, { date: "2026-09-24", hour: 20 });
  assert.match(unsafe.highlights, /Best overall<\/div><div class="headline">No ride recommended/);
  assert.match(unsafe.final, /No complete upcoming window has a suitable 2-hour start/);
  assert.match(unsafe.html, /rating score-text avoid" aria-label="Ride score 1 out of 5, Avoid exposed routes"/);
  assert.doesNotMatch(unsafe.highlights.split('Best backup')[0], /score-badge/);
});

test("a safe two-hour highlight can occur within a poor full-window forecast", () => {
  const time = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => date + "T" + String(hour).padStart(2, "0") + ":00"));
  const hourly = { time };
  for (const field of ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"]) {
    hourly[field] = time.map(() => ({ temperature_2m: 14, precipitation_probability: 10, precipitation: 0,
      wind_speed_10m: 10, wind_gusts_10m: 55, wind_direction_10m: 0, weather_code: 1 })[field]);
  }
  for (const hour of [6, 7, 8, 9]) hourly.wind_gusts_10m[time.indexOf("2026-09-25T0" + hour + ":00")] = 20;
  const result = renderForecast(hourly, { date: "2026-09-24", hour: 22 });
  assert.match(result.html, /class="slot avoid"/);
  assert.doesNotMatch(result.html, /Ride out:/);
  assert.match(result.highlights, /Best overall[\s\S]*Ride out: 06:00–07:59/);
  assert.match(result.highlights, /score-badge good" aria-label="Ride score 5 out of 5/);
  assert.match(result.highlights, /Weakest stretch:[\s\S]*Rain total 0.0 mm/);
});
