// Checks our assumptions about the real IDAP feed, which nothing documents. It needs no key, downloads
// the feed a few times, and stays out of `npm test` so that a government server cannot fail a pull request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchDefesaCivilFeed } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/defesa-civil-api.js';

const FIVE_MINUTES = 5 * 60_000;
const TWELVE_HOURS = 12 * 60 * 60_000;

test('the real feed still reads as a whole CAP feed', async () => {
  const feed = await fetchDefesaCivilFeed();
  assert.ok(feed.entryCount > 0, 'an empty feed is legal, but check by hand that it is really empty');
  assert.ok(feed.generatedAt, 'the feed has <updated>');
  assert.ok(feed.serverTime, 'the reply has a Date header');
  console.log(`${feed.entryCount} entries, ${feed.alerts.length} in force`);
  for (const alert of feed.alerts) {
    // Handy for docs/VERIFY.md: a real alert cannot be ordered, so test with a place that has one now.
    console.log(`  ${alert.severity} ${alert.areaDescription} until ${new Date(alert.expiresAt).toLocaleString()}`);
    assert.ok(alert.issuer, `${alert.id} has an issuer`);
    assert.ok(alert.title, `${alert.id} has an event`);
    assert.ok(alert.description, `${alert.id} has a description`);
    assert.ok(alert.expiresAt > alert.sentAt, `${alert.id} ends after it was sent`);
    assert.ok(alert.polygons.length || alert.areaNames.length, `${alert.id} can be matched to a place`);
  }
});

test('<updated> is about as recent as the 5 minute cache says', async () => {
  const { generatedAt, serverTime } = await fetchDefesaCivilFeed();
  const age = serverTime - generatedAt;
  console.log(`the answer is ${Math.round(age / 1000)} s old`);
  assert.ok(age < 3 * FIVE_MINUTES, `the answer is ${Math.round(age / 1000)} s old`);
});

test('entries stay about 12 hours, because the plugin relies on it to spot a withdrawn alert', async () => {
  const { oldestSentAt, serverTime } = await fetchDefesaCivilFeed();
  assert.ok(serverTime - oldestSentAt < TWELVE_HOURS + 2 * FIVE_MINUTES);
});

test('a version already read closes early', async () => {
  const { generatedAt } = await fetchDefesaCivilFeed();
  const started = performance.now();
  const answer = await fetchDefesaCivilFeed({ knownVersion: generatedAt });
  if (answer.unchanged) console.log(`skipped the rest in ${Math.round(performance.now() - started)} ms`);
  else console.log('a new version came out between the two requests, so run this again');
});
