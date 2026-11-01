// Checks the assumptions in test/fixtures against the real API. It spends about 40 calls of your own
// plan and only runs when you provide a key: WEATHERAPI_KEY=xxx npm run test:live
// It is kept out of the normal suite so that pull requests from forks never need a secret.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertPlace } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/alert-area.js';
import { WeatherError, fetchCurrent, searchLocations } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

const KEY = process.env.WEATHERAPI_KEY;
const options = { skip: KEY ? false : 'set WEATHERAPI_KEY to run' };

const STATE_CAPITALS = {
  AC: 'Rio Branco', AL: 'Maceio', AP: 'Macapa', AM: 'Manaus', BA: 'Salvador', CE: 'Fortaleza', DF: 'Brasilia', ES: 'Vitoria', GO: 'Goiania',
  MA: 'Sao Luis', MT: 'Cuiaba', MS: 'Campo Grande', MG: 'Belo Horizonte', PA: 'Belem', PB: 'Joao Pessoa', PR: 'Curitiba', PE: 'Recife', PI: 'Teresina',
  RJ: 'Rio de Janeiro', RN: 'Natal', RS: 'Porto Alegre', RO: 'Porto Velho', RR: 'Boa Vista', SC: 'Florianopolis', SP: 'Sao Paulo', SE: 'Aracaju', TO: 'Palmas',
};

test('a place in Brazil comes with what Defesa Civil alerts match on, in every state', options, async () => {
  const problems = [];
  for (const [uf, capital] of Object.entries(STATE_CAPITALS)) {
    const { location } = await fetchCurrent(KEY, `${capital}, Brazil`);
    const place = alertPlace(location);
    if (!place) problems.push(`${capital}: country is "${location.country}"`);
    else if (place.lat === null || place.lon === null) problems.push(`${capital}: no coordinates`);
    // Only an alert with no polygon needs the state, so a new name here goes in UF_BY_STATE in alert-area.js.
    else if (place.uf !== uf) problems.push(`${capital}: region "${location.region}" reads as ${place.uf}, not ${uf}`);
  }
  assert.deepEqual(problems, []);
});

test('a place outside Brazil never starts the alert feed', options, async () => {
  const { location } = await fetchCurrent(KEY, 'London');
  assert.equal(alertPlace(location), null);
});

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
  assert.match(items[0].label, /Paulo/);
  assert.equal(typeof items[0].id, 'number');
});

test('a place from the search can be asked for by its ID', options, async () => {
  const [{ id }] = await searchLocations(KEY, 'Sao Paulo');
  const weather = await fetchCurrent(KEY, `id:${id}`);
  assert.match(weather.location.name, /Paulo/);
});
