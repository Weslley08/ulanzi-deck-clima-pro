import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AFTER_REFRESH_MS, DefesaCivilAlertService, FEED_CACHE_MS, FEED_WINDOW_MS, MAX_KEPT_MS, MIN_CHECK_GAP_MS, STALE_AFTER_MS, UNAVAILABLE_AFTER_MS } from '../com.ulanzi.climapro.ulanziPlugin/plugin/defesa-civil-service.js';
import { CapFeedReader } from '../com.ulanzi.climapro.ulanziPlugin/plugin/cap-feed.js';
import { capEntry, capFeed, iso, square } from './support/cap-builder.mjs';

const START = Date.parse('2026-11-01T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const BLUMENAU = { name: 'Blumenau', region: 'Santa Catarina', country: 'Brazil', lat: -26.92, lon: -49.07 };
const CURITIBA = { name: 'Curitiba', region: 'Parana', country: 'Brazil', lat: -25.43, lon: -49.27 };
const LISBON = { name: 'Lisbon', region: 'Lisboa', country: 'Portugal', lat: 38.72, lon: -9.13 };
const AT_BLUMENAU = [square(BLUMENAU.lat, BLUMENAU.lon)];

/** A service on a fake clock, reading SYNTHETIC feeds through the real parser. */
function harness({ entries = () => [], serverOffset = 0 } = {}) {
  const clock = { now: START, timers: new Map(), next: 1 };
  const calls = [];
  const logs = [];
  const state = { entries, failure: null };
  const service = new DefesaCivilAlertService({
    fetchFeed: async ({ signal, knownVersion }) => {
      const call = { signal, knownVersion };
      calls.push(call);
      if (state.gate) await state.gate;
      if (signal.aborted) throw Object.assign(new Error('aborted'), { kind: 'aborted' });
      if (state.failure) throw state.failure;
      const serverNow = clock.now + serverOffset;
      const generatedAt = state.generatedAt ?? serverNow;
      if (generatedAt === knownVersion) {
        call.unchanged = true;
        return { unchanged: true, generatedAt, serverTime: serverNow };
      }
      const reader = new CapFeedReader(serverNow);
      reader.push(capFeed(state.entries(serverNow), iso(generatedAt)));
      return { ...reader.finish(), serverTime: serverNow };
    },
    now: () => clock.now,
    setTimer: (fn, ms) => {
      const id = clock.next++;
      clock.timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimer: (id) => clock.timers.delete(id),
    log: (message) => logs.push(message),
  });
  const settle = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  };
  const advance = async (ms) => {
    const end = clock.now + ms;
    for (;;) {
      const due = [...clock.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock.timers.delete(due[0]);
      clock.now = due[1].at;
      due[1].fn();
      await settle();
    }
    clock.now = end;
    await settle();
  };
  const watch = async (location = BLUMENAU, active = true) => {
    const updates = { count: 0 };
    const sub = service.subscribe({ active, onUpdate: () => { updates.count += 1; } });
    sub.setPlace(location);
    await settle();
    return { sub, updates };
  };
  return { service, clock, calls, logs, state, settle, advance, watch };
}

const alertAt = (now, fields = {}) => capEntry({ sent: iso(now - MINUTE), expires: iso(now + 2 * HOUR), polygons: AT_BLUMENAU, areaDesc: 'Blumenau/SC', ...fields });
const fail = (kind, code) => Object.assign(new Error(kind), { kind, code });
const ids = (sub) => sub.snapshot.alerts.map(({ id }) => id);

// 1
test('a place with no alert is clear, and that is only said after the source answered', async () => {
  const { watch, settle, state } = harness();
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'checking');
  release();
  state.gate = null;
  await settle();
  assert.equal(sub.snapshot.state, 'clear');
  assert.deepEqual(sub.snapshot.alerts, []);
  assert.equal(sub.snapshot.checkedAt, START);
});

// 2
test('a severe alert over the place is active', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now, { id: 's', severity: 'Severe' })] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'active');
  assert.equal(sub.snapshot.alerts[0].severity, 'SEVERE');
});

// 3
test('an extreme alert over the place is active', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now, { id: 'e', severity: 'Extreme' })] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'active');
  assert.equal(sub.snapshot.alerts[0].severity, 'EXTREME');
});

test('an alert over somewhere else does not reach the place', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now, { polygons: [square(CURITIBA.lat, CURITIBA.lon)], areaDesc: 'Curitiba/PR' })] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'clear');
});

// 4
test('several alerts: the most serious first, then the most urgent, then the newest, and all stay reachable', async () => {
  const { watch } = harness({
    entries: (now) => [
      alertAt(now, { id: 'moderate', severity: 'Moderate' }),
      alertAt(now, { id: 'severe-later', severity: 'Severe', urgency: 'Expected' }),
      alertAt(now, { id: 'severe-now-old', severity: 'Severe', sent: iso(now - 20 * MINUTE) }),
      alertAt(now, { id: 'severe-now-new', severity: 'Severe', sent: iso(now - 10 * MINUTE) }),
      alertAt(now, { id: 'extreme', severity: 'Extreme', urgency: 'Expected' }),
    ],
  });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), ['extreme', 'severe-now-new', 'severe-now-old', 'severe-later', 'moderate']);
});

test('one message issued again, or over two polygons, shows once with the later end', async () => {
  const description = 'Mesma mensagem sintética';
  const { watch } = harness({
    entries: (now) => [
      alertAt(now, { id: 'first', description, expires: iso(now + HOUR) }),
      alertAt(now, { id: 'second', description, expires: iso(now + 3 * HOUR) }),
      alertAt(now, { id: 'other', description: 'Outra mensagem sintética' }),
    ],
  });
  const { sub } = await watch();
  assert.deepEqual(ids(sub).sort(), ['other', 'second']);
});

// 5
test('changing the place is answered at once from memory, with no second download', async () => {
  const { watch, calls, settle } = harness({ entries: (now) => [alertAt(now, { id: 'blumenau' })] });
  const { sub, updates } = await watch(BLUMENAU);
  assert.deepEqual(ids(sub), ['blumenau']);
  assert.equal(calls.length, 1);
  const before = updates.count;
  sub.setPlace(CURITIBA);
  assert.equal(sub.snapshot.state, 'clear');
  assert.deepEqual(ids(sub), []);
  assert.equal(updates.count, before + 1);
  sub.setPlace(BLUMENAU);
  assert.deepEqual(ids(sub), ['blumenau']);
  await settle();
  assert.equal(calls.length, 1);
});

test('a key with no place yet shows nothing from the old one', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now)] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.alerts.length, 1);
  sub.setPlace(null);
  assert.equal(sub.snapshot.state, 'off');
  assert.deepEqual(sub.snapshot.alerts, []);
});

// 6
test('an alert ends on time, between downloads, with no request', async () => {
  const entry = alertAt(START, { id: 'short', expires: iso(START + 2 * MINUTE) });
  const { watch, advance, calls } = harness({ entries: () => [entry] });
  const { sub, updates } = await watch();
  assert.deepEqual(ids(sub), ['short']);
  const downloads = calls.length;
  const before = updates.count;
  await advance(2 * MINUTE + 1);
  assert.deepEqual(ids(sub), []);
  assert.equal(sub.snapshot.state, 'clear');
  assert.equal(updates.count, before + 1);
  assert.equal(calls.length, downloads);
});

test('an alert that already expired in the feed never appears', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now, { sent: iso(now - 3 * HOUR), expires: iso(now - HOUR) })] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'clear');
});

test('an alert that starts later appears when it starts', async () => {
  const entry = alertAt(START, { id: 'later', effective: iso(START + 3 * MINUTE) });
  const { watch, advance } = harness({ entries: () => [entry] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), []);
  await advance(3 * MINUTE + 1);
  assert.deepEqual(ids(sub), ['later']);
});

test('an event expected later still warns now: onset is not when the alert starts', async () => {
  const { watch } = harness({ entries: (now) => [alertAt(now, { id: 'ahead', onset: iso(now + HOUR) })] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), ['ahead']);
});

// 7
test('an update replaces the alert it names', async () => {
  const first = alertAt(START, { id: 'v1', severity: 'Severe', description: 'versão 1' });
  const { watch, advance, state } = harness({ entries: () => [first] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), ['v1']);
  const update = alertAt(START, { id: 'v2', severity: 'Extreme', msgType: 'Update', references: `CENAD-SEDEC,v1,${iso(START)}`, description: 'versão 2' });
  state.entries = () => [first, update];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), ['v2']);
  assert.equal(sub.snapshot.alerts[0].severity, 'EXTREME');
});

test('a cancellation removes the alert it names', async () => {
  const first = alertAt(START, { id: 'gone' });
  const { watch, advance, state } = harness({ entries: () => [first] });
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'active');
  const cancel = alertAt(START, { id: 'c', msgType: 'Cancel', references: `CENAD-SEDEC,gone,${iso(START)}` });
  state.entries = () => [first, cancel];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), []);
  assert.equal(sub.snapshot.state, 'clear');
});

test('an alert that vanishes from the middle of the feed was withdrawn', async () => {
  const older = alertAt(START, { id: 'older', sent: iso(START - 30 * MINUTE), polygons: [square(0, 0)] });
  const withdrawn = alertAt(START, { id: 'withdrawn', sent: iso(START - 10 * MINUTE) });
  const { watch, advance, state } = harness({ entries: () => [older, withdrawn] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), ['withdrawn']);
  state.entries = () => [older];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), []);
});

test('a valid alert older than the feed\'s window stays until it expires', async () => {
  const long = alertAt(START, { id: 'long', sent: iso(START - 30 * MINUTE), expires: iso(START + HOUR) });
  const { watch, advance, state } = harness({ entries: () => [long] });
  const { sub } = await watch();
  const newer = alertAt(START, { id: 'newer', sent: iso(START - 5 * MINUTE), polygons: [square(0, 0)] });
  state.entries = () => [newer];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), ['long']);
  await advance(HOUR);
  assert.deepEqual(ids(sub), []);
});

test('with an empty feed, its age tells an alert that aged out from one that was withdrawn', async () => {
  const aged = alertAt(START, { id: 'aged', sent: iso(START - FEED_WINDOW_MS - MINUTE), expires: iso(START + 3 * HOUR) });
  const recent = alertAt(START, { id: 'recent', sent: iso(START - HOUR), expires: iso(START + 3 * HOUR) });
  const { watch, advance, state } = harness({ entries: () => [aged, recent] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub).sort(), ['aged', 'recent']);
  state.entries = () => [];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), ['aged']);
});

test('a wrong date far in the future cannot overflow the timer or pin the alert to the key', async () => {
  const wrong = alertAt(START, { id: 'wrong', sent: iso(START - HOUR), expires: '2099-01-01T00:00:00Z' });
  const { watch, advance, state, clock } = harness({ entries: () => [wrong] });
  const { sub } = await watch();
  assert.deepEqual(ids(sub), ['wrong']);
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  await advance(UNAVAILABLE_AFTER_MS + FEED_CACHE_MS);
  // A download is running and nothing else is due, which leaves only the far-off date to wake for.
  const [timer] = [...clock.timers.values()];
  assert.ok(timer.at - clock.now <= HOUR, `the next wake is ${timer.at - clock.now} ms away`);
  release();
  state.gate = null;
  state.entries = () => [alertAt(clock.now, { id: 'newer', polygons: [square(0, 0)] })];
  await advance(FEED_WINDOW_MS);
  assert.deepEqual(ids(sub), ['wrong'], 'it left the window, and it is still believed for a while');
  await advance(MAX_KEPT_MS);
  assert.deepEqual(ids(sub), [], 'but not for ever');
});

test('a version already read is not read again, and what is known stays', async () => {
  const entry = alertAt(START, { id: 'kept' });
  const { watch, advance, state, calls } = harness({ entries: () => [entry] });
  state.generatedAt = START;
  const { sub } = await watch();
  assert.equal(calls[0].knownVersion, null);
  state.entries = () => [];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.equal(calls[1].knownVersion, START);
  assert.equal(calls[1].unchanged, true);
  assert.deepEqual(ids(sub), ['kept']);
});

test('a server stuck on an old copy cannot go on saying there are no alerts', async () => {
  const { watch, advance, state, calls } = harness();
  state.generatedAt = START;
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'clear');
  await advance(STALE_AFTER_MS);
  assert.equal(sub.snapshot.state, 'stale');
  await advance(UNAVAILABLE_AFTER_MS - STALE_AFTER_MS);
  assert.equal(sub.snapshot.state, 'unavailable');
  assert.ok(calls.length <= 62, `checks every minute at most, each costing one piece: ${calls.length}`);
  assert.ok(calls.slice(1).every(({ unchanged }) => unchanged), 'none of them downloaded the feed again');
  state.generatedAt = null;
  await advance(MIN_CHECK_GAP_MS);
  assert.equal(sub.snapshot.state, 'clear');
});

test('a later cancellation also reaches an alert that left the window', async () => {
  const long = alertAt(START, { id: 'long', sent: iso(START - 30 * MINUTE), expires: iso(START + 3 * HOUR) });
  const { watch, advance, state } = harness({ entries: () => [long] });
  const { sub } = await watch();
  state.entries = () => [alertAt(START, { id: 'c', msgType: 'Cancel', sent: iso(START - 5 * MINUTE), references: `CENAD-SEDEC,long,${iso(START)}` })];
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), []);
});

// 8
test('with the source down from the start, the state is unavailable and never clear', async () => {
  const { watch, state, logs } = harness();
  state.failure = fail('network');
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'unavailable');
  assert.deepEqual(sub.snapshot.alerts, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Defesa Civil alerts request failed: network/);
});

test('failures back off, and the check comes back by itself', async () => {
  const { watch, state, calls, advance } = harness();
  state.failure = fail('network');
  const { sub } = await watch();
  assert.equal(calls.length, 1);
  await advance(MINUTE);
  assert.equal(calls.length, 2);
  await advance(MINUTE);
  assert.equal(calls.length, 2, 'the second wait is longer than the first');
  await advance(MINUTE);
  assert.equal(calls.length, 3);
  await advance(4 * MINUTE);
  assert.equal(calls.length, 4);
  state.failure = null;
  await advance(8 * MINUTE);
  assert.equal(sub.snapshot.state, 'clear');
});

test('retries stop growing at 30 minutes', async () => {
  const { watch, state, calls, advance } = harness();
  state.failure = fail('network');
  await watch();
  await advance(6 * HOUR);
  const count = calls.length;
  await advance(2 * HOUR);
  assert.equal(calls.length, count + 4);
});

test('"no alerts" goes stale and then unavailable as failures continue', async () => {
  const { watch, state, advance } = harness();
  const { sub } = await watch();
  assert.equal(sub.snapshot.state, 'clear');
  state.failure = fail('server', 503);
  await advance(STALE_AFTER_MS - 1);
  assert.equal(sub.snapshot.state, 'clear', 'one failed check is not news yet');
  await advance(1);
  assert.equal(sub.snapshot.state, 'stale');
  await advance(UNAVAILABLE_AFTER_MS - STALE_AFTER_MS);
  assert.equal(sub.snapshot.state, 'unavailable');
});

test('known alerts stay while the source is down, until they expire and never after', async () => {
  const entry = alertAt(START, { id: 'kept', expires: iso(START + 90 * MINUTE) });
  const { watch, state, advance } = harness({ entries: () => [entry] });
  const { sub } = await watch();
  state.failure = fail('network');
  await advance(70 * MINUTE);
  assert.equal(sub.snapshot.state, 'unavailable');
  assert.deepEqual(ids(sub), ['kept']);
  await advance(20 * MINUTE + 1);
  assert.equal(sub.snapshot.state, 'unavailable');
  assert.deepEqual(ids(sub), []);
});

// 9
test('an invalid reply keeps the last good answer instead of erasing it', async () => {
  const entry = alertAt(START, { id: 'kept' });
  const { watch, state, advance, logs } = harness({ entries: () => [entry] });
  const { sub } = await watch();
  state.failure = fail('invalid');
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.deepEqual(ids(sub), ['kept']);
  assert.match(logs[0], /invalid/);
});

test('the same failure is logged once, and a new kind or a recovery logs again', async () => {
  const { watch, state, advance, logs } = harness();
  state.failure = fail('network');
  await watch();
  await advance(10 * MINUTE);
  assert.equal(logs.length, 1);
  state.failure = fail('server', 500);
  await advance(30 * MINUTE);
  assert.equal(logs.length, 2);
  assert.match(logs[1], /server \(500\)/);
  state.failure = null;
  await advance(30 * MINUTE);
  state.failure = fail('server', 500);
  await advance(30 * MINUTE);
  assert.equal(logs.length, 3);
});

// 10 is in alert-area.test.mjs, where names are matched. This is the same case end to end.
test('a town with the same name in another state stays clear', async () => {
  const { watch } = harness({ entries: (now) => [capEntry({ sent: iso(now - MINUTE), expires: iso(now + HOUR), areaDesc: 'Bom Jesus/RS' })] });
  const rs = await watch({ name: 'Bom Jesus', region: 'Rio Grande do Sul', country: 'Brazil', lat: -28.67, lon: -50.43 });
  const pi = await watch({ name: 'Bom Jesus', region: 'Piaui', country: 'Brazil', lat: -9.07, lon: -44.36 });
  assert.equal(rs.sub.snapshot.state, 'active');
  assert.equal(pi.sub.snapshot.state, 'clear');
});

test('all keys share one download', async () => {
  const { watch, calls } = harness();
  await watch(BLUMENAU);
  await watch(CURITIBA);
  await watch(BLUMENAU);
  assert.equal(calls.length, 1);
});

test('asking again while a download runs starts no second one', async () => {
  const { watch, calls, state, settle } = harness();
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const first = await watch(BLUMENAU);
  await watch(CURITIBA);
  first.sub.setPlace(CURITIBA);
  first.sub.setActive(false);
  first.sub.setActive(true);
  assert.equal(calls.length, 1);
  release();
  await settle();
  assert.equal(calls.length, 1);
});

test('nothing downloads for a key with no place yet', async () => {
  const { service, calls, clock } = harness();
  service.subscribe({ active: true, onUpdate() {} });
  service.wake();
  assert.equal(calls.length, 0);
  assert.equal(clock.timers.size, 0);
});

test('outside Brazil the feature is off: no download, no timer, and the snapshot says why', async () => {
  const { watch, calls, clock, advance } = harness({ entries: (now) => [alertAt(now)] });
  const { sub } = await watch(LISBON);
  assert.deepEqual(sub.snapshot, { state: 'outside', alerts: [], checkedAt: null, country: 'Portugal' });
  assert.equal(clock.timers.size, 0);
  await advance(6 * HOUR);
  assert.equal(calls.length, 0);
});

test('the reason shows even on a key with alerts turned off, because the setting would not help', async () => {
  const { watch, calls } = harness();
  const { sub } = await watch(null);
  sub.setEnabled(false);
  assert.equal(sub.snapshot.state, 'off');
  sub.setPlace(LISBON);
  assert.equal(sub.snapshot.state, 'outside');
  sub.setPlace(BLUMENAU);
  assert.equal(sub.snapshot.state, 'off');
  assert.equal(calls.length, 0);
});

test('another country outside Brazil tells the panel, since the reason names it', async () => {
  const { watch } = harness();
  const { sub, updates } = await watch(LISBON);
  const before = updates.count;
  sub.setPlace({ ...LISBON, name: 'Madrid', country: 'Spain' });
  assert.equal(sub.snapshot.country, 'Spain');
  assert.equal(updates.count, before + 1);
  sub.setPlace({ ...LISBON, name: 'Madrid', country: 'Spain' });
  assert.equal(updates.count, before + 1);
});

test('a reply with no country cannot be confirmed as Brazil, so it stays off', async () => {
  const { watch, calls } = harness();
  const { sub } = await watch({ ...BLUMENAU, country: undefined });
  assert.equal(sub.snapshot.state, 'outside');
  assert.equal(sub.snapshot.country, '');
  assert.equal(calls.length, 0);
});

test('moving abroad drops the alerts at once and keeps nothing, and coming back reads the feed anew', async () => {
  const { watch, calls, clock, settle } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const { sub } = await watch(BLUMENAU);
  assert.deepEqual(ids(sub), ['x']);
  sub.setPlace(LISBON);
  assert.deepEqual(ids(sub), []);
  assert.equal(sub.snapshot.state, 'outside');
  assert.equal(clock.timers.size, 0);
  sub.setPlace(BLUMENAU);
  await settle();
  assert.equal(calls.length, 2, 'nothing was left to answer from');
  assert.equal(calls[1].knownVersion, null);
  assert.deepEqual(ids(sub), ['x']);
});

test('moving abroad cancels a download already running, and its answer is ignored', async () => {
  const { watch, calls, state, settle, logs } = harness({ entries: (now) => [alertAt(now, { id: 'late' })] });
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const { sub } = await watch(BLUMENAU);
  sub.setPlace(LISBON);
  assert.ok(calls[0].signal.aborted);
  release();
  state.gate = null;
  await settle();
  assert.equal(sub.snapshot.state, 'outside');
  assert.deepEqual(logs, []);
});

test('turning alerts off also keeps nothing', async () => {
  const { watch, calls, clock, settle } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const { sub } = await watch(BLUMENAU);
  sub.setEnabled(false);
  assert.equal(sub.snapshot.state, 'off');
  assert.deepEqual(ids(sub), []);
  assert.equal(clock.timers.size, 0);
  sub.setEnabled(true);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].knownVersion, null);
  assert.deepEqual(ids(sub), ['x']);
});

test('removing the last key keeps nothing either', async () => {
  const { watch, calls, settle } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const { sub } = await watch(BLUMENAU);
  sub.close();
  const again = await watch(BLUMENAU);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].knownVersion, null);
  assert.deepEqual(ids(again.sub), ['x']);
});

test('a key abroad does not stop a key in Brazil, and memory stays for it', async () => {
  const { watch, calls, advance } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const brazil = await watch(BLUMENAU);
  const abroad = await watch(LISBON);
  assert.deepEqual(ids(brazil.sub), ['x']);
  assert.equal(abroad.sub.snapshot.state, 'outside');
  assert.deepEqual(ids(abroad.sub), []);
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS);
  assert.equal(calls.length, 2);
});

test('a key between two places keeps what is known, so the new place needs no download', async () => {
  const { watch, calls, settle } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const { sub } = await watch(CURITIBA);
  sub.setPlace(null);
  assert.equal(sub.snapshot.state, 'off');
  sub.setPlace(BLUMENAU);
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(sub), ['x']);
});

test('a hidden key in Brazil also keeps what is known', async () => {
  const { watch, calls, settle } = harness({ entries: (now) => [alertAt(now, { id: 'x' })] });
  const { sub } = await watch(BLUMENAU);
  sub.setActive(false);
  assert.deepEqual(ids(sub), ['x']);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 1);
});

test('nothing downloads or waits while no key is on screen, and coming back catches up', async () => {
  const { watch, calls, clock, advance, settle } = harness();
  const { sub } = await watch(BLUMENAU, false);
  assert.equal(calls.length, 0);
  assert.equal(clock.timers.size, 0);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 1);
  sub.setActive(false);
  assert.equal(clock.timers.size, 0);
  await advance(HOUR);
  assert.equal(calls.length, 1);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 2);
});

test('coming back within the cache window reuses what is in memory', async () => {
  const { watch, calls, advance, settle } = harness();
  const { sub } = await watch();
  sub.setActive(false);
  await advance(MINUTE);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 1);
});

test('hiding every key cancels a download already running', async () => {
  const { watch, calls, state, settle } = harness();
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const { sub } = await watch();
  sub.setActive(false);
  assert.ok(calls[0].signal.aborted);
  release();
  await settle();
  assert.equal(sub.snapshot.state, 'checking', 'it never answered, so this cannot claim anything');
});

test('a canceled download is not a failure: no log and no backoff', async () => {
  const { watch, calls, state, settle, logs } = harness();
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const { sub } = await watch();
  sub.close();
  release();
  state.gate = null;
  await settle();
  assert.deepEqual(logs, []);
  const again = await watch();
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(again.sub.snapshot.state, 'clear');
});

test('removing the last key leaves no timer running', async () => {
  const { watch, clock } = harness({ entries: (now) => [alertAt(now)] });
  const { sub } = await watch();
  assert.equal(clock.timers.size, 1);
  sub.close();
  assert.equal(clock.timers.size, 0);
});

test('there is never more than one timer, however many keys and alerts', async () => {
  const { watch, clock } = harness({ entries: (now) => [alertAt(now, { id: 'a' }), alertAt(now, { id: 'b', expires: iso(now + 3 * HOUR) })] });
  const one = await watch(BLUMENAU);
  const two = await watch(CURITIBA);
  one.sub.setPlace(CURITIBA);
  two.sub.setActive(false);
  two.sub.setActive(true);
  assert.equal(clock.timers.size, 1);
});

test('the pace follows the source: right after its next version is due, not every 2 minutes', async () => {
  const { watch, calls, advance } = harness();
  await watch();
  await advance(FEED_CACHE_MS + AFTER_REFRESH_MS - 1);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.equal(calls.length, 2);
});

test('an answer already old when it arrived brings the next check closer', async () => {
  const { watch, calls, advance, state } = harness();
  state.generatedAt = START - 3 * MINUTE;
  await watch();
  await advance(2 * MINUTE + AFTER_REFRESH_MS - 1);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.equal(calls.length, 2);
});

test('checks are never closer than a minute, however old the answer', async () => {
  const { watch, calls, advance, state } = harness();
  state.generatedAt = START - 20 * MINUTE;
  await watch();
  await advance(MIN_CHECK_GAP_MS - 1);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.equal(calls.length, 2);
});

test('a wrong clock on this machine does not change what is in force', async () => {
  for (const serverOffset of [-5 * HOUR, 5 * HOUR]) {
    const serverStart = START + serverOffset;
    const entry = alertAt(serverStart, { id: 'x', expires: iso(serverStart + HOUR) });
    const { watch, advance } = harness({ entries: () => [entry], serverOffset });
    const { sub } = await watch();
    assert.deepEqual(ids(sub), ['x'], `clock off by ${serverOffset / HOUR} h`);
    await advance(HOUR - 1);
    assert.deepEqual(ids(sub), ['x'], 'still in force by the source\'s clock');
    await advance(2);
    assert.deepEqual(ids(sub), [], 'ended by the source\'s clock');
  }
});

test('nothing changed means no update: the key is not redrawn on every download', async () => {
  const entry = alertAt(START, { id: 'same', expires: iso(START + 3 * HOUR) });
  const { watch, advance, calls } = harness({ entries: () => [entry] });
  const { updates } = await watch();
  const after = updates.count;
  await advance(FEED_CACHE_MS * 6);
  assert.ok(calls.length >= 5);
  assert.equal(updates.count, after);
});

test('the same place reported again does nothing', async () => {
  const { watch } = harness();
  const { sub, updates } = await watch();
  const after = updates.count;
  sub.setPlace({ ...BLUMENAU });
  assert.equal(updates.count, after);
});
