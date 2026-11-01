// Runs the real client over real streams, with only the socket replaced.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import { afterEach, test } from 'node:test';
import { fetchDefesaCivilFeed } from '../com.ulanzi.climapro.ulanziPlugin/plugin/defesa-civil-api.js';
import { capEntry, capFeed, iso, square } from './support/cap-builder.mjs';

const realGet = https.get;
const HOUR = 3_600_000;

afterEach(() => {
  https.get = realGet;
});

/** Answers with `body`, a stream delivered to the client's callback as a server's response is. */
function serve(body, { status = 200, date = new Date().toUTCString() } = {}) {
  const calls = [];
  https.get = (url, options, callback) => {
    calls.push({ url: String(url), options });
    const request = new EventEmitter();
    setImmediate(() => callback(Object.assign(body, { statusCode: status, headers: date ? { date } : {} })));
    return request;
  };
  return calls;
}

function pieces(text, size = 1024) {
  const bytes = Buffer.from(text);
  const parts = [];
  for (let i = 0; i < bytes.length; i += size) parts.push(bytes.subarray(i, i + size));
  return Readable.from(parts, { objectMode: false });
}

const reply = (text, options = {}) => serve(pieces(text, options.pieceSize), options);
const failsWith = (kind, code) => (error) => error.name === 'FeedError' && error.kind === kind && (code === undefined || error.code === code);
const feedNow = (fields = {}) => capFeed([capEntry({ sent: iso(Date.now() - HOUR), expires: iso(Date.now() + HOUR), polygons: [square(-26.9, -49)], ...fields })]);

test('asks only the official host, with nothing about the user in the request', async () => {
  const calls = reply(feedNow());
  await fetchDefesaCivilFeed();
  const { hostname, search, protocol } = new URL(calls[0].url);
  assert.equal(hostname, 'idapfile.mdr.gov.br');
  assert.equal(protocol, 'https:');
  assert.equal(search, '');
  assert.deepEqual(Object.keys(calls[0].options.headers), ['user-agent']);
});

test('a redirect is a failure, so alerts can only come from the official host', async () => {
  serve(Readable.from([]), { status: 302 });
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('server', 302));
});

test('reads a whole feed from a stream, whatever the piece size', async () => {
  for (const pieceSize of [1, 7, 1024]) {
    reply(feedNow({ id: 'x', description: 'Ivolândia' }), { pieceSize });
    const { alerts, entryCount } = await fetchDefesaCivilFeed();
    assert.equal(entryCount, 1);
    assert.equal(alerts[0].description, 'Ivolândia', `accents survive being split in pieces of ${pieceSize}`);
  }
});

test('expiry is judged by the server clock, so a wrong clock here cannot hide a valid alert', async () => {
  const serverNow = Date.now() + 5 * HOUR;
  reply(capFeed([capEntry({ id: 'x', sent: iso(serverNow - HOUR), expires: iso(serverNow + HOUR), polygons: [square(1, 1)] })]), { date: new Date(serverNow).toUTCString() });
  const feed = await fetchDefesaCivilFeed();
  assert.deepEqual(feed.alerts.map(({ id }) => id), ['x']);
  assert.equal(feed.alerts[0].polygons.length, 1);
  assert.equal(feed.serverTime, Math.floor(serverNow / 1000) * 1000);
});

test('a version already read closes the connection after the first piece instead of downloading it all', async () => {
  const version = '2026-11-01T12:00:00Z';
  const xml = capFeed([capEntry({ sent: iso(Date.now() - HOUR), expires: iso(Date.now() + HOUR), polygons: [square(-26.9, -49, 0.2).repeat(2000)] })], version);
  const total = Buffer.byteLength(xml);
  const pieceSize = 16 * 1024;
  let offset = 0;
  let closed = false;
  const bytes = Buffer.from(xml);
  const body = new Readable({
    highWaterMark: pieceSize,
    read() {
      this.push(offset < total ? bytes.subarray(offset, offset + pieceSize) : null);
      offset += pieceSize;
    },
    destroy(error, callback) {
      closed = true;
      callback(error);
    },
  });
  serve(body);
  const answer = await fetchDefesaCivilFeed({ knownVersion: Date.parse(version) });
  assert.equal(answer.unchanged, true);
  assert.equal(answer.generatedAt, Date.parse(version));
  assert.ok(closed, 'the connection was closed');
  assert.ok(offset < total / 2, `read ${offset} of ${total} bytes`);
});

test('a new version is read in full', async () => {
  reply(capFeed([capEntry({ id: 'x', sent: iso(Date.now() - HOUR), expires: iso(Date.now() + HOUR) })], '2026-11-01T12:05:00Z'));
  const answer = await fetchDefesaCivilFeed({ knownVersion: Date.parse('2026-11-01T12:00:00Z') });
  assert.equal(answer.unchanged, undefined);
  assert.deepEqual(answer.alerts.map(({ id }) => id), ['x']);
});

test('without a server clock, it uses this one and says so', async () => {
  reply(feedNow(), { date: null });
  const feed = await fetchDefesaCivilFeed();
  assert.equal(feed.serverTime, null);
  assert.equal(feed.alerts.length, 1);
});

test('an HTTP error is a server failure, and its connection is not left open', async () => {
  const body = Readable.from([Buffer.from('Service unavailable')]);
  serve(body, { status: 503 });
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('server', 503));
  assert.ok(body.destroyed);
});

test('no network is a network failure, and the original error stays out of it', async () => {
  https.get = () => {
    const request = new EventEmitter();
    setImmediate(() => request.emit('error', new Error('getaddrinfo ENOTFOUND idapfile.mdr.gov.br')));
    return request;
  };
  await assert.rejects(fetchDefesaCivilFeed(), (error) => failsWith('network')(error) && !error.message.includes('idapfile'));
});

test('a connection lost halfway is a failure, not a shorter list of alerts', async () => {
  const bytes = Buffer.from(feedNow());
  let delivered = false;
  serve(new Readable({
    read() {
      if (delivered) {
        this.destroy(new Error('aborted'));
        return;
      }
      delivered = true;
      this.push(bytes.subarray(0, bytes.length / 2));
    },
  }));
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('network'));
});

test('a reply that ends early is invalid', async () => {
  const xml = feedNow();
  reply(xml.slice(0, xml.length / 2));
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('invalid'));
});

test('an error page with status 200 is invalid', async () => {
  reply('<html><body>Maintenance</body></html>');
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('invalid'));
});

test('a reply far beyond any real feed is refused without reading the rest', async () => {
  const opening = Buffer.from(`<feed><updated>${iso(Date.now())}</updated><entry><expires>${iso(Date.now() - HOUR)}</expires><polygon>`);
  const piece = Buffer.from('1,1 '.repeat(256 * 1024));
  let delivered = 0;
  serve(new Readable({
    read() {
      this.push(delivered ? piece : opening);
      delivered += piece.length;
    },
  }));
  await assert.rejects(fetchDefesaCivilFeed(), failsWith('invalid'));
  assert.ok(delivered < 300 * 1024 * 1024, `read ${delivered} bytes`);
});

test('canceling is reported as such', async () => {
  const controller = new AbortController();
  https.get = (_url, { signal }) => {
    const request = new EventEmitter();
    signal.addEventListener('abort', () => request.emit('error', new DOMException('aborted', 'AbortError')));
    return request;
  };
  const pending = fetchDefesaCivilFeed({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, failsWith('aborted'));
});
