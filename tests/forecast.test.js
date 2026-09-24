const test = require("node:test");
const assert = require("node:assert/strict");
const { localClock, datesToShow, ratingFor, summariseWindow } = require("../script.js");

const morning = { name: "Morning", hours: [8, 9, 10, 11] };

function fixture(date = "2026-09-25") {
  const hours = morning.hours;
  return {
    time: hours.map((hour) => date + "T" + String(hour).padStart(2, "0") + ":00"),
    temperature_2m: [12, 13, 14, 15],
    precipitation_probability: [10, 20, 15, 10],
    precipitation: [0, 0, 0, 0],
    wind_speed_10m: [10, 12, 13, 11],
    wind_gusts_10m: [18, 20, 22, 19],
    wind_direction_10m: [0, 10, 350, 0],
    weather_code: [1, 1, 2, 1]
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
  assert.deepEqual(result.hours, [10, 11]);
  assert.equal(result.rating, "good");
});
