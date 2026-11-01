// Preloaded with --import so the plugin runs its real code against canned WeatherAPI.com replies.
// Living here instead of behind a setting means the shipped plugin has no way to point the
// user's API key at another host. Each request is appended to FAKE_WEATHER_LOG.
// The Defesa Civil feed comes through https.get: from the file FAKE_ALERT_FEED names, failing if that
// says "offline", and empty if unset. Its requests go to FAKE_ALERT_LOG, so they never count as
// WeatherAPI.com calls.
import { appendFileSync, createReadStream, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/current.json', import.meta.url), 'utf8'));
const log = process.env.FAKE_WEATHER_LOG;
const alertFeed = process.env.FAKE_ALERT_FEED;
const alertLog = process.env.FAKE_ALERT_LOG;
const EMPTY_FEED = '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty (synthetic)</title></feed>';

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

https.get = (url, _options, callback) => {
  const request = new EventEmitter();
  if (new URL(String(url)).hostname !== 'idapfile.mdr.gov.br') throw new Error('unexpected host');
  if (alertLog) appendFileSync(alertLog, 'feed\n');
  setImmediate(() => {
    if (alertFeed === 'offline') {
      request.emit('error', new Error('getaddrinfo ENOTFOUND'));
      return;
    }
    // In pieces, as a network delivers it, so that measuring memory measures the plugin and not this file.
    const body = alertFeed ? createReadStream(alertFeed, { highWaterMark: 64 * 1024 }) : Readable.from([Buffer.from(EMPTY_FEED)]);
    callback(Object.assign(body, { statusCode: 200, headers: { date: new Date().toUTCString() } }));
  });
  return request;
};

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const key = url.searchParams.get('key');
  const q = url.searchParams.get('q');
  if (log) appendFileSync(log, `${url.pathname} ${q} ${url.searchParams.get('key')}\n`);
  if (url.hostname !== 'api.weatherapi.com') throw new Error('unexpected host');
  if (key === 'BADKEY0000000000') return reply(401, { error: { code: 2006, message: 'API key is invalid.' } });
  if (q === 'nowhere') return reply(400, { error: { code: 1006, message: 'No matching location found.' } });
  if (q === 'offline') throw new TypeError('fetch failed');
  if (url.pathname.endsWith('/search.json')) return reply(200, [{ id: 290780, name: 'São Paulo', region: 'Sao Paulo', country: 'Brazil' }]);
  if (q === 'lisbon') return reply(200, { ...fixtures, location: { ...fixtures.location, name: 'Lisbon', region: 'Lisboa', country: 'Portugal', lat: 38.72, lon: -9.13 } });
  return reply(200, fixtures);
};
