// Checks the assumptions in test/fixtures against the real API. It spends a few calls of your own
// plan and only runs when you provide a key: WEATHERAPI_KEY=xxx npm run test:live
// It is kept out of the normal suite so that pull requests from forks never need a secret.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeatherError, fetchForecast, searchLocations } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

const KEY = process.env.WEATHERAPI_KEY;
const options = { skip: KEY ? false : 'set WEATHERAPI_KEY to run' };

test('forecast has everything the screens draw', options, async () => {
  const weather = await fetchForecast(KEY, 'London');
  assert.equal(weather.location.name, 'London');
  for (const field of ['tempC', 'tempF', 'feelsLikeC', 'feelsLikeF', 'humidity', 'windKph', 'windMph']) {
    assert.equal(typeof weather.current[field], 'number', field);
  }
  assert.equal(typeof weather.current.isDay, 'boolean');
  assert.equal(weather.days.length, 3, 'the free plan returns 3 days');
  for (const day of weather.days) {
    assert.equal(typeof day.dateEpoch, 'number');
    for (const field of ['maxC', 'maxF', 'minC', 'minF', 'rainChance']) assert.equal(typeof day[field], 'number', field);
  }
});

test('hour= really trims the response', options, async () => {
  const url = `https://api.weatherapi.com/v1/forecast.json?${new URLSearchParams({ key: KEY, q: 'London', days: 3, hour: 12, aqi: 'no', alerts: 'no' })}`;
  const body = await (await fetch(url)).json();
  for (const day of body.forecast.forecastday) assert.ok(day.hour.length <= 1, `got ${day.hour.length} hours`);
});

test('location detection by IP works', options, async () => {
  const weather = await fetchForecast(KEY, 'auto:ip');
  assert.ok(weather.location.name);
});

test('an unknown location reports the documented error', options, async () => {
  await assert.rejects(fetchForecast(KEY, 'zzzzzzzzqqqqqqq'), (error) => error instanceof WeatherError && error.kind === 'location' && error.code === 1006);
});

test('a bad key reports the documented error', async () => {
  await assert.rejects(fetchForecast('0'.repeat(32), 'London'), (error) => error.kind === 'auth' && error.code === 2006);
});

test('search returns suggestions', options, async () => {
  const items = await searchLocations(KEY, 'Sao Paulo');
  assert.ok(items.length >= 1);
  assert.match(items[0], /Paulo/);
});
