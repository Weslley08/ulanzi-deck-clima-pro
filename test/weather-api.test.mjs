import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { CONDITIONS, conditionFromCode } from '../com.ulanzi.climapro.ulanziPlugin/plugin/conditions.js';
import { WeatherError, fetchForecast, parseForecast, searchLocations } from '../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const realFetch = globalThis.fetch;
const KEY = 'TESTKEY000000000';

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return calls;
}

test('every condition code the API documents maps to a drawing on purpose', () => {
  const mapped = new Set(CONDITIONS);
  for (const code of fixture('condition-codes.json')) {
    assert.ok(mapped.has(conditionFromCode(code)), `code ${code}`);
    // conditionFromCode falls back to cloudy, so only 1006 may reach it without being listed.
    if (code !== 1006) assert.notEqual(conditionFromCode(code), 'cloudy', `code ${code} is not listed`);
  }
});

test('an unknown condition code still draws something', () => {
  assert.equal(conditionFromCode(9999), 'cloudy');
  assert.equal(conditionFromCode(undefined), 'cloudy');
});

test('parseForecast flattens the fields the screens use', () => {
  const weather = parseForecast(fixture('forecast.json'));
  assert.equal(weather.location.name, 'São Paulo');
  assert.equal(weather.current.condition, 'partly');
  assert.equal(weather.current.isDay, true);
  assert.equal(weather.current.tempC, 27.2);
  assert.equal(weather.current.humidity, 62);
  assert.equal(weather.days.length, 3);
  assert.equal(weather.today.maxC, 30.1);
  assert.equal(weather.days[1].condition, 'rain');
  assert.equal(weather.days[1].rainChance, 80);
});

test('the umbrella counts snow as well as rain', () => {
  const body = fixture('forecast.json');
  Object.assign(body.forecast.forecastday[0].day, { daily_chance_of_rain: 10, daily_chance_of_snow: 70 });
  assert.equal(parseForecast(body).today.rainChance, 70);
});

test('numbers sent as strings are read and blanks stay missing', () => {
  const body = fixture('forecast.json');
  Object.assign(body.current, { temp_c: '27.2', humidity: '' });
  const { current } = parseForecast(body);
  assert.equal(current.tempC, 27.2);
  assert.equal(current.humidity, null);
});

test('a reply with no current conditions is a server error, not a crash', () => {
  assert.throws(() => parseForecast({}), (error) => error.kind === 'server');
  assert.throws(() => parseForecast(null), (error) => error.kind === 'server');
});

test('the request asks for the least data, refuses redirects and encodes the location', async () => {
  const calls = stubFetch(200, fixture('forecast.json'));
  await fetchForecast(KEY, 'São Paulo & co');
  const [{ url, init }] = calls;
  assert.equal(url.origin, 'https://api.weatherapi.com');
  assert.equal(url.pathname, '/v1/forecast.json');
  assert.equal(url.searchParams.get('q'), 'São Paulo & co');
  assert.equal(url.searchParams.get('days'), '3');
  assert.equal(url.searchParams.get('aqi'), 'no');
  assert.equal(url.searchParams.get('alerts'), 'no');
  assert.ok(url.searchParams.has('hour'));
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
});

for (const [status, code, kind] of [
  [401, 1002, 'auth'],
  [401, 2006, 'auth'],
  [403, 2007, 'quota'],
  [403, 2008, 'auth'],
  [403, 2009, 'auth'],
  [400, 1006, 'location'],
  [400, 9999, 'server'],
]) {
  test(`API error ${code} is reported as ${kind}`, async () => {
    stubFetch(status, { error: { code, message: 'x' } });
    await assert.rejects(fetchForecast(KEY, 'x'), (error) => error instanceof WeatherError && error.kind === kind && error.code === code);
  });
}

test('an HTML error page is a server error', async () => {
  stubFetch(502, '<html>Bad Gateway</html>');
  await assert.rejects(fetchForecast(KEY, 'x'), (error) => error.kind === 'server' && error.code === 502);
});

test('network failures never carry the key, even if the runtime quotes the URL', async () => {
  globalThis.fetch = async (url) => {
    throw new TypeError(`request to ${url} failed`);
  };
  await assert.rejects(fetchForecast(KEY, 'x'), (error) => {
    assert.equal(error.kind, 'network');
    assert.ok(!error.message.includes(KEY));
    assert.ok(!String(error.stack).includes(KEY));
    return true;
  });
});

test('search returns readable labels, at most five', async () => {
  stubFetch(200, Array.from({ length: 8 }, (_, i) => ({ name: `City ${i}`, region: '', country: 'Brazil' })));
  const labels = await searchLocations(KEY, 'city');
  assert.equal(labels.length, 5);
  assert.equal(labels[0], 'City 0, Brazil');
});
