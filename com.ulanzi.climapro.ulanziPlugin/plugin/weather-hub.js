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
// Refreshing just before that limit keeps an hourly key from flashing "loading" every hour.
const LONGEST_INTERVAL_MS = MAX_DATA_AGE_MS - 5 * MINUTE;

// These cannot fix themselves. Retrying would only burn the user's quota.
const HALTING_KINDS = new Set(['auth', 'location']);

class Subscription {
  constructor(hub, feed, { intervalMs, active, onUpdate }) {
    this.hub = hub;
    this.feed = feed;
    this.intervalMs = intervalMs;
    this.active = active;
    this.onUpdate = onUpdate;
  }

  setActive(active) {
    this.active = active;
    this.hub.reschedule(this.feed);
  }

  setIntervalMs(intervalMs) {
    this.intervalMs = intervalMs;
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
  #fetchForecast;
  #now;
  #setTimer;
  #clearTimer;
  #log;

  constructor({ fetchForecast, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
    this.#fetchForecast = fetchForecast;
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
      feed = { id, query, subs: new Set(), data: null, error: null, fetchedAt: null, retryAt: null, failures: 0, halted: false, loading: false, lastAttempt: 0, timer: null, expiry: null };
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
    const intervals = [...feed.subs].filter((sub) => sub.active).map((sub) => sub.intervalMs);
    if (!intervals.length) return;
    const due = feed.retryAt ?? (feed.fetchedAt === null ? 0 : feed.fetchedAt + Math.min(...intervals, LONGEST_INTERVAL_MS));
    const wait = due - this.#now();
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
      data = await this.#fetchForecast(apiKey, feed.query);
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
    Object.assign(feed, { data, error: null, fetchedAt: this.#now(), retryAt: null, failures: 0, halted: false });
    this.#clear(feed, 'expiry');
    feed.expiry = this.#setTimer(() => {
      feed.expiry = null;
      Object.assign(feed, { data: null, fetchedAt: null });
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
    Object.assign(feed, { data: null, error: null, fetchedAt: null, retryAt: null, failures: 0, halted: false, lastAttempt: 0 });
  }

  #clear(feed, name) {
    if (feed[name] !== null) this.#clearTimer(feed[name]);
    feed[name] = null;
  }

  #notify(feed) {
    for (const sub of feed.subs) sub.onUpdate();
  }
}
