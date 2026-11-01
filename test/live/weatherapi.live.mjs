// Checks the assumptions in test/fixtures against the real API. It spends a few calls of your own
// plan and only runs when you provide a key: WEATHERAPI_KEY=xxx npm run test:live
// It is kept out of the normal suite so that pull requests from forks never need a secret.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeatherError, fetchCurrent, searchLocations } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

const KEY = process.env.WEATHERAPI_KEY;
const options = { skip: KEY ? false : 'set WEATHERAPI_KEY to run' };

test('current conditions have everything the screens draw', options, async () => {
  const weather = await fetchCurrent(KEY, 'London');
  assert.equal(weather.location.name, 'London');
  for (const field of ['tempC', 'tempF', 'feelsLikeC', 'feelsLikeF', 'humidity', 'windKph', 'windMph', 'precipMm', 'precipIn']) {
    assert.equal(typeof weather.current[field], 'number', field);
  }
  assert.equal(typeof weather.current.isDay, 'boolean');
});

test('the reply says how old the data is, which decides when the plugin asks again', options, async () => {
  const { current } = await fetchCurrent(KEY, 'London');
  assert.equal(typeof current.updatedEpoch, 'number');
  assert.equal(typeof current.ageMs, 'number');
  assert.ok(current.ageMs < 60 * 60_000, `${current.ageMs / 60_000} minutes old`);
});

test('location detection by IP works', options, async () => {
  const weather = await fetchCurrent(KEY, 'auto:ip');
  assert.ok(weather.location.name);
});

test('an unknown location reports the documented error', options, async () => {
  await assert.rejects(fetchCurrent(KEY, 'zzzzzzzzqqqqqqq'), (error) => error instanceof WeatherError && error.kind === 'location' && error.code === 1006);
});

test('a bad key reports the documented error', async () => {
  await assert.rejects(fetchCurrent('0'.repeat(32), 'London'), (error) => error.kind === 'auth' && error.code === 2006);
});

test('search returns suggestions', options, async () => {
  const items = await searchLocations(KEY, 'Sao Paulo');
  assert.ok(items.length >= 1);
  assert.match(items[0], /Paulo/);
});
