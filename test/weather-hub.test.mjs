import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeatherHub, MANUAL_REFRESH_GAP_MS, MAX_DATA_AGE_MS, QUOTA_RETRY_MS } from '../com.ulanzi.climapro.ulanziPlugin/plugin/weather-hub.js';

const MINUTE = 60_000;
const KEY = 'TESTKEY000000000';
const DATA = { location: { name: 'X' } };

/** A hub on a fake clock, so hours of polling run in milliseconds. */
function harness({ apiKey = KEY, respond = async () => DATA } = {}) {
  const clock = { now: 0, timers: new Map(), next: 1 };
  const calls = [];
  const hub = new WeatherHub({
    fetchForecast: async (key, query) => {
      calls.push({ key, query });
      return harness.current(key, query);
    },
    now: () => clock.now,
    setTimer: (fn, ms) => {
      const id = clock.next++;
      clock.timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimer: (id) => clock.timers.delete(id),
  });
  harness.current = respond;
  if (apiKey !== null) hub.setApiKey(apiKey);

  const settle = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
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
  const watch = (location, options = {}) => {
    const updates = { count: 0 };
    const sub = hub.subscribe(location, { intervalMs: 30 * MINUTE, active: true, onUpdate: () => { updates.count += 1; }, ...options });
    return { sub, updates };
  };
  return { hub, calls, clock, advance, settle, watch, setRespond: (fn) => { harness.current = fn; } };
}

const fail = (kind, code) => async () => {
  throw Object.assign(new Error(kind), { kind, code });
};

test('nothing is requested before the host has told us the key', async () => {
  const { calls, settle, watch, hub } = harness({ apiKey: null });
  watch('rio');
  await settle();
  assert.equal(hub.keyState, 'unknown');
  assert.equal(calls.length, 0);
});

test('no key means no requests, and adding one starts them', async () => {
  const { calls, settle, watch, hub } = harness({ apiKey: '' });
  const { sub } = watch('rio');
  await settle();
  assert.equal(hub.keyState, 'missing');
  assert.equal(calls.length, 0);
  hub.setApiKey(KEY);
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(sub.snapshot().data, DATA);
});

test('keys showing the same place share one request, whatever the case', async () => {
  const { calls, settle, watch } = harness();
  watch('Rio');
  watch('rio');
  watch('RIO');
  await settle();
  assert.equal(calls.length, 1);
});

test('different places get their own request', async () => {
  const { calls, settle, watch } = harness();
  watch('rio');
  watch('oslo');
  await settle();
  assert.equal(calls.length, 2);
});

test('an empty location asks the API to detect it from the IP', async () => {
  const { calls, settle, watch } = harness();
  watch('');
  await settle();
  assert.equal(calls[0].query, 'auto:ip');
});

test('polls at the interval while active', async () => {
  const { calls, advance, settle, watch } = harness();
  watch('rio');
  await settle();
  await advance(90 * MINUTE);
  assert.equal(calls.length, 4);
});

test('the shortest interval of the keys on screen wins', async () => {
  const { calls, advance, settle, watch } = harness();
  watch('rio', { intervalMs: 60 * MINUTE });
  watch('rio', { intervalMs: 15 * MINUTE });
  await settle();
  await advance(45 * MINUTE);
  assert.equal(calls.length, 4);
});

test('stops polling while no key is on screen, and catches up on return', async () => {
  const { calls, clock, advance, settle, watch } = harness();
  const { sub } = watch('rio');
  await settle();
  sub.setActive(false);
  assert.equal(clock.timers.size, 1, 'only the data expiry timer remains');
  await advance(10 * 60 * MINUTE);
  assert.equal(calls.length, 1);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 2);
});

test('coming back with fresh data does not spend a call', async () => {
  const { calls, advance, settle, watch } = harness();
  const { sub } = watch('rio');
  await settle();
  sub.setActive(false);
  await advance(5 * MINUTE);
  sub.setActive(true);
  await settle();
  assert.equal(calls.length, 1);
});

test('one key still on screen keeps a shared feed alive', async () => {
  const { calls, advance, settle, watch } = harness();
  const first = watch('rio');
  watch('rio');
  await settle();
  first.sub.setActive(false);
  await advance(30 * MINUTE);
  assert.equal(calls.length, 2);
});

test('closing the last key cancels every timer', async () => {
  const { clock, settle, watch } = harness();
  const { sub } = watch('rio');
  await settle();
  sub.close();
  assert.equal(clock.timers.size, 0);
});

test('a reply arriving after the key was removed changes nothing', async () => {
  let resolve;
  const { clock, settle, watch } = harness({ respond: () => new Promise((r) => { resolve = r; }) });
  const { sub, updates } = watch('rio');
  await settle();
  sub.close();
  resolve(DATA);
  await settle();
  assert.equal(updates.count, 0);
  assert.equal(clock.timers.size, 0);
});

test('network failures keep the last data, marked stale, and back off', async () => {
  const { calls, advance, settle, watch, setRespond } = harness();
  const { sub } = watch('rio');
  await settle();
  setRespond(fail('network'));
  await advance(30 * MINUTE);
  assert.equal(calls.length, 2);
  assert.equal(sub.snapshot().stale, true);
  assert.deepEqual(sub.snapshot().data, DATA);
  await advance(MINUTE);
  assert.equal(calls.length, 3);
  await advance(MINUTE);
  assert.equal(calls.length, 3, 'the second retry waits twice as long');
  await advance(MINUTE);
  assert.equal(calls.length, 4);
});

test('a recovery clears the stale mark and the backoff', async () => {
  const { calls, advance, settle, watch, setRespond } = harness();
  const { sub } = watch('rio');
  await settle();
  setRespond(fail('network'));
  await advance(30 * MINUTE);
  setRespond(async () => DATA);
  await advance(MINUTE);
  assert.equal(sub.snapshot().stale, false);
  assert.equal(sub.snapshot().error, null);
  const before = calls.length;
  await advance(29 * MINUTE);
  assert.equal(calls.length, before);
  await advance(MINUTE);
  assert.equal(calls.length, before + 1);
});

test('data is dropped at the 60 minutes the terms allow, even with no key on screen', async () => {
  const { advance, settle, watch, setRespond } = harness();
  const { sub, updates } = watch('rio');
  await settle();
  setRespond(fail('network'));
  sub.setActive(false);
  const before = updates.count;
  await advance(MAX_DATA_AGE_MS);
  assert.equal(sub.snapshot().data, null);
  assert.ok(updates.count > before);
});

test('with failures, stale data is still gone after 60 minutes', async () => {
  const { advance, settle, watch, setRespond } = harness();
  const { sub } = watch('rio');
  await settle();
  setRespond(fail('network'));
  await advance(MAX_DATA_AGE_MS - 1);
  assert.deepEqual(sub.snapshot().data, DATA);
  await advance(1);
  assert.equal(sub.snapshot().data, null);
  assert.equal(sub.snapshot().error.kind, 'network');
});

test('an hourly key refreshes before its data expires, so it never flashes loading', async () => {
  const { calls, advance, settle, watch } = harness();
  const seen = [];
  const { sub } = watch('rio', {
    intervalMs: 60 * MINUTE,
    onUpdate: () => seen.push(sub?.snapshot().data ?? null),
  });
  await settle();
  await advance(3 * 60 * MINUTE);
  assert.ok(calls.length >= 4);
  assert.ok(seen.slice(1).every((data) => data !== null));
});

for (const [kind, code] of [['auth', 2006], ['location', 1006]]) {
  test(`a ${kind} error stops polling instead of burning quota`, async () => {
    const { calls, advance, settle, watch } = harness({ respond: fail(kind, code) });
    const { sub } = watch('rio');
    await settle();
    await advance(24 * 60 * MINUTE);
    assert.equal(calls.length, 1);
    assert.equal(sub.snapshot().error.kind, kind);
  });
}

test('a used-up quota waits an hour between tries', async () => {
  const { calls, advance, settle, watch } = harness({ respond: fail('quota', 2007) });
  watch('rio');
  await settle();
  await advance(QUOTA_RETRY_MS - 1);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.equal(calls.length, 2);
});

test('a new key forgets the data and errors of the old one', async () => {
  const { calls, settle, watch, hub, setRespond } = harness({ respond: fail('auth', 2006) });
  const { sub } = watch('rio');
  await settle();
  assert.equal(sub.snapshot().error.kind, 'auth');
  setRespond(async () => DATA);
  hub.setApiKey('NEWKEY0000000000');
  await settle();
  assert.equal(calls.at(-1).key, 'NEWKEY0000000000');
  assert.equal(sub.snapshot().error, null);
  assert.deepEqual(sub.snapshot().data, DATA);
});

test('a slow reply for a replaced key is discarded', async () => {
  const resolvers = [];
  const { settle, watch, hub } = harness({ respond: () => new Promise((resolve) => { resolvers.push(resolve); }) });
  const { sub } = watch('rio');
  await settle();
  hub.setApiKey('NEWKEY0000000000');
  resolvers[0]({ location: { name: 'old key' } });
  await settle();
  assert.equal(sub.snapshot().data, null);
  resolvers[1]({ location: { name: 'new key' } });
  await settle();
  assert.equal(sub.snapshot().data.location.name, 'new key');
});

test('a press retries a stopped feed, but cannot hammer the API', async () => {
  const { calls, advance, settle, watch } = harness({ respond: fail('location', 1006) });
  const { sub } = watch('rio');
  await settle();
  sub.refresh();
  await settle();
  assert.equal(calls.length, 1, 'too soon after the last attempt');
  await advance(MANUAL_REFRESH_GAP_MS);
  sub.refresh();
  sub.refresh();
  await settle();
  assert.equal(calls.length, 2);
});

test('the log gets one line per kind of failure, never the key', async () => {
  const lines = [];
  const clock = { now: 0 };
  const hub = new WeatherHub({
    fetchForecast: fail('network'),
    now: () => clock.now,
    setTimer: () => 1,
    clearTimer: () => {},
    log: (line) => lines.push(line),
  });
  hub.setApiKey(KEY);
  const sub = hub.subscribe('rio', { intervalMs: MINUTE, active: true, onUpdate: () => {} });
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  sub.setActive(false);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes(KEY));
});
