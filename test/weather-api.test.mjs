import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { CONDITIONS, conditionFromCode } from '../com.ulanzi.climapro.ulanziPlugin/plugin/conditions.js';
import { WeatherError, fetchCurrent, parseCurrent, searchLocations } from '../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

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

test('parseCurrent flattens the fields the screens use', () => {
  const weather = parseCurrent(fixture('current.json'));
  assert.equal(weather.location.name, 'São Paulo');
  assert.equal(weather.current.condition, 'partly');
  assert.equal(weather.current.isDay, true);
  assert.equal(weather.current.tempC, 27.2);
  assert.equal(weather.current.humidity, 62);
  assert.equal(weather.current.precipMm, 0.4);
  assert.equal(weather.current.precipIn, 0.02);
  assert.equal(weather.current.updatedEpoch, 1793548800);
});

test('the age of the data comes from the times in the reply, not from this machine', () => {
  assert.equal(parseCurrent(fixture('current.json')).current.ageMs, 5 * 60_000);
});

test('an age that cannot be worked out is missing, not zero', () => {
  const noUpdate = fixture('current.json');
  delete noUpdate.current.last_updated_epoch;
  assert.equal(parseCurrent(noUpdate).current.ageMs, null);
  const noClock = fixture('current.json');
  delete noClock.location.localtime_epoch;
  assert.equal(parseCurrent(noClock).current.ageMs, null);
  const fromTheFuture = fixture('current.json');
  fromTheFuture.current.last_updated_epoch = fromTheFuture.location.localtime_epoch + 60;
  assert.equal(parseCurrent(fromTheFuture).current.ageMs, null);
});

test('numbers sent as strings are read and blanks stay missing', () => {
  const body = fixture('current.json');
  Object.assign(body.current, { temp_c: '27.2', humidity: '' });
  const { current } = parseCurrent(body);
  assert.equal(current.tempC, 27.2);
  assert.equal(current.humidity, null);
});

test('a reply with no current conditions is a server error, not a crash', () => {
  assert.throws(() => parseCurrent({}), (error) => error.kind === 'server');
  assert.throws(() => parseCurrent(null), (error) => error.kind === 'server');
});

test('the request asks for the least data, refuses redirects and encodes the location', async () => {
  const calls = stubFetch(200, fixture('current.json'));
  await fetchCurrent(KEY, 'São Paulo & co');
  const [{ url, init }] = calls;
  assert.equal(url.origin, 'https://api.weatherapi.com');
  assert.equal(url.pathname, '/v1/current.json');
  assert.equal(url.searchParams.get('q'), 'São Paulo & co');
  assert.equal(url.searchParams.get('aqi'), 'no');
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
    await assert.rejects(fetchCurrent(KEY, 'x'), (error) => error instanceof WeatherError && error.kind === kind && error.code === code);
  });
}

test('an HTML error page is a server error', async () => {
  stubFetch(502, '<html>Bad Gateway</html>');
  await assert.rejects(fetchCurrent(KEY, 'x'), (error) => error.kind === 'server' && error.code === 502);
});

test('network failures never carry the key, even if the runtime quotes the URL', async () => {
  globalThis.fetch = async (url) => {
    throw new TypeError(`request to ${url} failed`);
  };
  await assert.rejects(fetchCurrent(KEY, 'x'), (error) => {
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
