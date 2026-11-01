import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CapFeedReader, MISSING_EXPIRY_MS } from '../com.ulanzi.climapro.ulanziPlugin/plugin/cap-feed.js';
import { capEntry, capFeed, iso, square } from './support/cap-builder.mjs';

const REAL_FEED = readFileSync(new URL('./fixtures/idap-feed.xml', import.meta.url), 'utf8');
// When the alerts in the saved feed were all still in force.
const REAL_NOW = Date.parse('2026-10-31T18:30:00-03:00');
const NOW = Date.parse('2026-11-01T12:00:00Z');
const HOUR = 3_600_000;
const SENT = iso(NOW - HOUR);
const EXPIRES = iso(NOW + HOUR);

function read(xml, now = NOW, pieceSize = 4096) {
  const reader = new CapFeedReader(now);
  for (let i = 0; i < xml.length; i += pieceSize) reader.push(xml.slice(i, i + pieceSize));
  return reader.finish();
}
const one = (fields) => read(capFeed([capEntry({ sent: SENT, expires: EXPIRES, ...fields })]));
const invalid = (error) => error.name === 'FeedError' && error.kind === 'invalid';

test('real feed: every field the alert model relies on comes through', () => {
  const feed = read(REAL_FEED, REAL_NOW);
  assert.equal(feed.entryCount, 5);
  assert.equal(feed.generatedAt, Date.parse('2026-11-01T07:23:30Z'));
  const alert = feed.alerts.find(({ id }) => id === '195709/2026');
  assert.equal(alert.severity, 'EXTREME');
  assert.equal(alert.urgency, 'EXPECTED');
  assert.equal(alert.source, 'IDAP');
  assert.equal(alert.issuer, 'Defesa Civil Estadual de Goiás');
  assert.equal(alert.title, 'CHUVAS INTENSAS');
  assert.equal(alert.description, 'Alerta em Ivolândia de risco ALTO de alagamentos e enxurradas.');
  assert.match(alert.instructions, /Em caso de emergência 193/);
  assert.equal(alert.sentAt, Date.parse('2026-10-31T18:06:50-03:00'));
  assert.equal(alert.startAt, Date.parse('2026-10-31T18:06:50-03:00'));
  assert.equal(alert.expiresAt, Date.parse('2026-10-31T22:00:00-03:00'));
  assert.equal(alert.areaDescription, 'Ivolândia/GO');
  assert.deepEqual(alert.areaNames, [{ name: 'IVOLANDIA', uf: 'GO' }]);
  assert.deepEqual(alert.affectedIbgeCodes, ['5211602']);
  assert.equal(alert.polygons.length, 1);
  assert.equal(alert.officialUrl, 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil/saiba-como-agir');
});

test('real feed: several municipalities in one entry, and severity as published', () => {
  const { alerts } = read(REAL_FEED, REAL_NOW);
  const twoPlaces = alerts.find(({ id }) => id === '195727/2026');
  assert.deepEqual(twoPlaces.areaNames, [{ name: 'ITUETA', uf: 'MG' }, { name: 'SANTA RITA DO ITUETO', uf: 'MG' }]);
  assert.equal(twoPlaces.polygons.length, 2);
  assert.equal(alerts.find(({ id }) => id === '195735/2026').severity, 'MODERATE');
  assert.equal(alerts.find(({ id }) => id === '195716/2026').severity, 'SEVERE');
});

test('real feed: after they expire, the reader keeps nothing and parses no polygon', () => {
  const feed = read(REAL_FEED, Date.parse('2026-11-02T00:00:00-03:00'));
  assert.equal(feed.entryCount, 5);
  assert.deepEqual(feed.alerts, []);
});

test('the result does not depend on where the network splits the stream', () => {
  const xml = capFeed([
    capEntry({ id: 'a', sent: SENT, expires: EXPIRES, polygons: [square(-26.9, -49), square(-20, -40)], geocodes: ['4202404'] }),
    capEntry({ id: 'b', sent: SENT, expires: EXPIRES, description: 'Ação &amp; prevenção', polygons: [square(-10, -50)] }),
  ]);
  const whole = read(xml, NOW, xml.length);
  for (const size of [1, 2, 3, 7, 10, 11, 64]) {
    const split = read(xml, NOW, size);
    assert.deepEqual(split.alerts.map((alert) => [alert.id, alert.description, alert.polygons.map((polygon) => [...polygon.coords])]), whole.alerts.map((alert) => [alert.id, alert.description, alert.polygons.map((polygon) => [...polygon.coords])]), `pieces of ${size}`);
  }
});

test('only public, actual alerts from the Defesa Civil are used', () => {
  assert.equal(one({ id: 'real' }).alerts.length, 1);
  assert.equal(one({ status: 'Test' }).alerts.length, 0);
  assert.equal(one({ status: 'Exercise' }).alerts.length, 0);
  assert.equal(one({ status: 'Draft' }).alerts.length, 0);
  assert.equal(one({ scope: 'Restricted' }).alerts.length, 0);
  assert.equal(one({ msgType: 'Ack' }).alerts.length, 0);
  assert.equal(one({ source: 'INMET', senderName: 'Instituto Nacional de Meteorologia' }).alerts.length, 0);
  assert.equal(one({ source: null, senderName: 'INMET' }).alerts.length, 0);
  assert.equal(one({ source: null, senderName: 'Defesa Civil de Blumenau (SC)' }).alerts.length, 1);
});

test('severity is the source\'s own, and anything else is unknown instead of guessed', () => {
  assert.equal(one({ severity: 'Minor' }).alerts[0].severity, 'MINOR');
  assert.equal(one({ severity: 'Unknown' }).alerts[0].severity, 'UNKNOWN');
  assert.equal(one({ severity: 'Vermelho' }).alerts[0].severity, 'UNKNOWN');
});

test('an alert without an expiry gets a limit, and is gone after it', () => {
  const sentAt = NOW - HOUR;
  assert.equal(one({ expires: undefined }).alerts[0].expiresAt, sentAt + MISSING_EXPIRY_MS);
  const old = capEntry({ sent: iso(NOW - MISSING_EXPIRY_MS - 1000), expires: undefined });
  assert.equal(read(capFeed([old])).alerts.length, 0);
});

test('an expired alert is left out, but still counts as the oldest entry', () => {
  const feed = read(capFeed([
    capEntry({ id: 'old', sent: iso(NOW - 5 * HOUR), expires: iso(NOW - HOUR), polygons: [square(0, 0)] }),
    capEntry({ id: 'new', sent: SENT, expires: EXPIRES }),
  ]));
  assert.deepEqual(feed.alerts.map(({ id }) => id), ['new']);
  assert.equal(feed.oldestSentAt, NOW - 5 * HOUR);
});

test('update, cancel and error name what they replace, and only an update is itself an alert', () => {
  const references = `CENAD-SEDEC,100/2026,${SENT} CENAD-SEDEC,101/2026,${SENT}`;
  const update = one({ id: 'u', msgType: 'Update', references });
  assert.deepEqual([...update.withdrawnIds], ['100/2026', '101/2026']);
  assert.deepEqual(update.alerts.map(({ id }) => id), ['u']);
  for (const msgType of ['Cancel', 'Error']) {
    const feed = one({ id: 'c', msgType, references: `CENAD-SEDEC,100/2026,${SENT}` });
    assert.deepEqual([...feed.withdrawnIds], ['100/2026']);
    assert.deepEqual(feed.alerts, []);
  }
});

test('another issuer cannot withdraw a Defesa Civil alert', () => {
  const feed = one({ msgType: 'Cancel', source: 'INMET', senderName: 'INMET', references: `CENAD-SEDEC,100/2026,${SENT}` });
  assert.deepEqual([...feed.withdrawnIds], []);
});

test('entities decode, and nothing beyond them expands', () => {
  const { alerts } = one({ description: 'A &amp; B &lt;b&gt; &#233; &#xE9; &unknown; &#0;' });
  assert.equal(alerts[0].description, 'A & B <b> é é &unknown;');
});

test('a link that is not https is dropped', () => {
  for (const web of ['http://example.invalid/x', 'javascript:alert(1)', 'data:text/html,x', 'not a url', '']) {
    assert.equal(one({ web }).alerts[0].officialUrl, undefined, web);
  }
});

test('a polygon with a bad vertex decides nothing, and the rest of the alert survives', () => {
  const { alerts } = one({ polygons: ['1,1 2,2 x,y 1,1', '91,0 92,0 93,0 91,0', '1,1 2,2', square(-26.9, -49)] });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].polygons.length, 1);
});

test('an empty feed is a real answer', () => {
  assert.deepEqual(read(capFeed([])).alerts, []);
});

test('anything that is not a whole feed is refused, never read as "no alerts"', () => {
  const whole = capFeed([capEntry({ sent: SENT, expires: EXPIRES, polygons: [square(1, 1)] })]);
  const cases = {
    'an error page': '<!DOCTYPE html><html><body>Service unavailable</body></html>',
    'plain text': 'upstream timed out',
    'empty body': '',
    'cut off in an entry': whole.slice(0, whole.indexOf('<area>')),
    'cut off in a polygon': whole.slice(0, whole.indexOf('</polygon>') - 4),
    'cut off between entries': whole.slice(0, whole.indexOf('</feed>')),
    'entries in a shape we do not know': capFeed([capEntry({ sent: SENT, expires: EXPIRES }).replaceAll('identifier>', 'cap:identifier>')]),
    'JSON instead': JSON.stringify({ error: 'x' }),
  };
  for (const [name, xml] of Object.entries(cases)) assert.throws(() => read(xml), invalid, name);
});

test('a huge response with no structure stops early instead of being searched forever', () => {
  const junk = 'x'.repeat(256 * 1024);
  const openings = { 'outside any entry': '', 'inside an entry': '<feed><entry>', 'inside a polygon': `<feed><entry><expires>${EXPIRES}</expires><polygon>` };
  for (const [name, opening] of Object.entries(openings)) {
    const reader = new CapFeedReader(NOW);
    reader.push(opening);
    assert.throws(() => {
      for (let i = 0; i < 10; i += 1) reader.push(junk);
    }, invalid, name);
  }
});
