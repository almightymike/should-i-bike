const test = require("node:test");
const assert = require("node:assert/strict");
const { localClock, datesToShow, ratingFor, summariseWindow, renderForecast } = require("../script.js");

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
});

test("after the afternoon window, show tomorrow and the following two days", () => {
  const hourly = { time: ["2026-09-24T00:00", "2026-09-25T00:00", "2026-09-26T00:00", "2026-09-27T00:00"] };
  assert.deepEqual(datesToShow(hourly, { date: "2026-09-24", hour: 20 }), ["2026-09-25", "2026-09-26", "2026-09-27"]);
});

test("rating limits include gusts and rain even when mean wind is light", () => {
  const base = { wind: 12, gust: 20, rainChance: 10, rain: 0, thunder: false };
  assert.equal(ratingFor(base), "good");
  assert.equal(ratingFor({ ...base, gust: 35 }), "caution");
  assert.equal(ratingFor({ ...base, gust: 50 }), "avoid");
  assert.equal(ratingFor({ ...base, rainChance: 60 }), "avoid");
  assert.equal(ratingFor({ ...base, thunder: true }), "avoid");
});

test("a missing hourly value never produces a favourable rating", () => {
  const hourly = fixture();
  hourly.wind_gusts_10m[2] = null;
  assert.equal(summariseWindow(hourly, "2026-09-25", morning, { date: "2026-09-24", hour: 9 }).state, "incomplete");
});

test("today's window uses only future full forecast hours", () => {
  const hourly = fixture("2026-09-24");
  hourly.wind_gusts_10m[0] = 80;
  const result = summariseWindow(hourly, "2026-09-24", morning, { date: "2026-09-24", hour: 9 });
  assert.deepEqual(result.hours, [10]);
  assert.equal(result.rating, "good");
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
  assert.equal((result.html.match(/class="slot good"/g) || []).length, 6);
  assert.match(result.final, /Final call/);
});
