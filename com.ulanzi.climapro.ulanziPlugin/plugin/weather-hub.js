// Decides when the API is called. Keys showing the same place share one feed, and a feed only
// polls while at least one of its keys is on screen, so calls track what the user can see.
import { AUTO_LOCATION } from './weather-api.js';

const MINUTE = 60_000;
export const MANUAL_REFRESH_GAP_MS = 30_000;
export const QUOTA_RETRY_MS = 60 * MINUTE;
const RETRY_BASE_MS = MINUTE;
const RETRY_MAX_MS = 30 * MINUTE;
// WeatherAPI.com terms: current conditions may be cached for at most 60 minutes.
export const MAX_DATA_AGE_MS = 60 * MINUTE;
// WeatherAPI.com says current conditions update every 10 to 15 minutes, and saved replies show
// last_updated on :00, :15, :30 and :45. Asking just after the next step is due gets new data
// soonest for the fewest calls, so the API sets the pace and there is no setting for it.
export const UPDATE_DUE_MS = 16 * MINUTE;
export const RECHECK_MS = 3 * MINUTE;
// This far past the step the place has stopped updating, so chasing it would only burn quota.
export const LATE_AGE_MS = 30 * MINUTE;
export const LATE_RECHECK_MS = 15 * MINUTE;

// These cannot fix themselves. Retrying would only burn the user's quota.
const HALTING_KINDS = new Set(['auth', 'location']);

function nextCheckIn(ageMs) {
  if (ageMs === null || ageMs === undefined) return UPDATE_DUE_MS;
  if (ageMs >= LATE_AGE_MS) return LATE_RECHECK_MS;
  return Math.max(UPDATE_DUE_MS - ageMs, RECHECK_MS);
}

class Subscription {
  constructor(hub, feed, { active, onUpdate }) {
    this.hub = hub;
    this.feed = feed;
    this.active = active;
    this.onUpdate = onUpdate;
  }

  setActive(active) {
    this.active = active;
    this.hub.reschedule(this.feed);
  }

  /** @returns {{data: object|null, error: {kind: string}|null, stale: boolean}} */
  snapshot() {
    const { data, error } = this.feed;
    return { data, error, stale: Boolean(data && error) };
  }

  /** Retries now if the user asks, even after an error that stopped polling. */
  refresh() {
    this.hub.refresh(this.feed);
  }

  close() {
    this.hub.release(this.feed, this);
  }
}

export class WeatherHub {
  #feeds = new Map();
  #apiKey = null;
  #fetchCurrent;
  #now;
  #setTimer;
  #clearTimer;
  #log;

  constructor({ fetchCurrent, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
    this.#fetchCurrent = fetchCurrent;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#log = log;
  }

  /** 'unknown' until the host has answered, which is not the same as having no key. */
  get keyState() {
    if (this.#apiKey === null) return 'unknown';
    return this.#apiKey ? 'ready' : 'missing';
  }

  get apiKey() {
    return this.#apiKey;
  }

  setApiKey(apiKey) {
    if (apiKey === this.#apiKey) return;
    this.#apiKey = apiKey;
    for (const feed of this.#feeds.values()) {
      this.#forget(feed);
      this.#notify(feed);
      this.reschedule(feed);
    }
  }

  subscribe(location, options) {
    const query = location || AUTO_LOCATION;
    const id = query.toLowerCase();
    let feed = this.#feeds.get(id);
    if (!feed) {
      feed = { id, query, subs: new Set(), data: null, error: null, nextAt: null, retryAt: null, failures: 0, halted: false, loading: false, lastAttempt: 0, timer: null, expiry: null };
      this.#feeds.set(id, feed);
    }
    const subscription = new Subscription(this, feed, options);
    feed.subs.add(subscription);
    this.reschedule(feed);
    return subscription;
  }

  reschedule(feed) {
    this.#clear(feed, 'timer');
    if (!this.#apiKey || feed.halted || feed.loading) return;
    if (![...feed.subs].some((sub) => sub.active)) return;
    const wait = (feed.retryAt ?? feed.nextAt ?? 0) - this.#now();
    if (wait <= 0) {
      this.#load(feed);
      return;
    }
    feed.timer = this.#setTimer(() => {
      feed.timer = null;
      this.#load(feed);
    }, wait);
  }

  refresh(feed) {
    if (!this.#apiKey || feed.loading || this.#now() - feed.lastAttempt < MANUAL_REFRESH_GAP_MS) return;
    this.#clear(feed, 'timer');
    feed.halted = false;
    this.#load(feed);
  }

  release(feed, subscription) {
    feed.subs.delete(subscription);
    if (feed.subs.size) {
      this.reschedule(feed);
      return;
    }
    this.#clear(feed, 'timer');
    this.#clear(feed, 'expiry');
    this.#feeds.delete(feed.id);
  }

  async #load(feed) {
    feed.loading = true;
    feed.lastAttempt = this.#now();
    const apiKey = this.#apiKey;
    let data = null;
    let failure = null;
    try {
      data = await this.#fetchCurrent(apiKey, feed.query);
    } catch (error) {
      failure = error;
    }
    feed.loading = false;
    if (this.#feeds.get(feed.id) !== feed) return;
    // A reply for a key the user has since replaced says nothing about the new one.
    if (apiKey === this.#apiKey) {
      if (failure) this.#recordFailure(feed, failure);
      else this.#recordSuccess(feed, data);
      this.#notify(feed);
    }
    this.reschedule(feed);
  }

  #recordSuccess(feed, data) {
    Object.assign(feed, { data, error: null, nextAt: this.#now() + nextCheckIn(data?.current?.ageMs), retryAt: null, failures: 0, halted: false });
    this.#clear(feed, 'expiry');
    feed.expiry = this.#setTimer(() => {
      feed.expiry = null;
      Object.assign(feed, { data: null, nextAt: null });
      this.#notify(feed);
      this.reschedule(feed);
    }, MAX_DATA_AGE_MS);
  }

  #recordFailure(feed, failure) {
    const kind = failure?.kind ?? 'server';
    if (feed.error?.kind !== kind) this.#log(`weather request failed: ${kind}${failure?.code ? ` (${failure.code})` : ''}`);
    feed.error = { kind };
    feed.failures += 1;
    feed.halted = HALTING_KINDS.has(kind);
    if (feed.halted) {
      feed.retryAt = null;
      return;
    }
    const backoff = Math.min(RETRY_BASE_MS * 2 ** (feed.failures - 1), RETRY_MAX_MS);
    feed.retryAt = this.#now() + (kind === 'quota' ? QUOTA_RETRY_MS : backoff);
  }

  #forget(feed) {
    this.#clear(feed, 'timer');
    this.#clear(feed, 'expiry');
    Object.assign(feed, { data: null, error: null, nextAt: null, retryAt: null, failures: 0, halted: false, lastAttempt: 0 });
  }

  #clear(feed, name) {
    if (feed[name] !== null) this.#clearTimer(feed[name]);
    feed[name] = null;
  }

  #notify(feed) {
    for (const sub of feed.subs) sub.onUpdate();
  }
}
