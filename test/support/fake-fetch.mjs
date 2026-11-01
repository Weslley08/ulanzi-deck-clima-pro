// Preloaded with --import so the plugin runs its real code against canned WeatherAPI.com replies.
// Living here instead of behind a setting means the shipped plugin has no way to point the
// user's API key at another host. Each request is appended to FAKE_WEATHER_LOG.
import { appendFileSync, readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/current.json', import.meta.url), 'utf8'));
const log = process.env.FAKE_WEATHER_LOG;

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const key = url.searchParams.get('key');
  const q = url.searchParams.get('q');
  if (log) appendFileSync(log, `${url.pathname} ${q} ${url.searchParams.get('key')}\n`);
  if (url.hostname !== 'api.weatherapi.com') throw new Error('unexpected host');
  if (key === 'BADKEY0000000000') return reply(401, { error: { code: 2006, message: 'API key is invalid.' } });
  if (q === 'nowhere') return reply(400, { error: { code: 1006, message: 'No matching location found.' } });
  if (q === 'offline') throw new TypeError('fetch failed');
  if (url.pathname.endsWith('/search.json')) return reply(200, [{ name: 'São Paulo', region: 'Sao Paulo', country: 'Brazil' }]);
  return reply(200, fixtures);
};
