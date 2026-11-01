// Keeps the official alerts current and says which ones reach each key's place. There is one feed for
// the whole country, so all keys share one download, and a new place is answered from memory at once.
// It runs beside WeatherHub and shares nothing with it, so neither can hold the other up.
// The feed only covers Brazil. With every key elsewhere or turned off, nothing is fetched, scheduled or kept.
import { affectsPlace, alertPlace, samePlace } from './alert-area.js';

/** @typedef {import('./alert-types').AlertSnapshot} AlertSnapshot */
/** @typedef {import('./alert-types').AlertPlace} AlertPlace */
/** @typedef {import('./alert-types').AlertSeverity} AlertSeverity */
/** @typedef {import('./alert-types').AlertUrgency} AlertUrgency */
/** @typedef {import('./alert-types').DefesaCivilAlert} DefesaCivilAlert */
/** @typedef {import('./alert-types').FeedAnswer} FeedAnswer */
/** @typedef {import('./alert-types').LocationFromWeather} LocationFromWeather */

const MINUTE = 60_000;
// The server says it caches the feed for 5 minutes (X-Feed-Cache), and <updated> was seen moving every
// 5 min 7 s. Asking sooner would download the same 7 MB again, so this is the pace, and <updated> says
// when the next version is due. A check that finds the old version still there costs next to nothing.
export const FEED_CACHE_MS = 5 * MINUTE;
export const AFTER_REFRESH_MS = 20_000;
export const MIN_CHECK_GAP_MS = MINUTE;
// The feed was seen dropping entries 12 hours after they were sent.
export const FEED_WINDOW_MS = 12 * 60 * MINUTE;
export const MAX_KEPT_MS = 72 * 60 * MINUTE;
const LONGEST_WAIT_MS = 60 * MINUTE;
// How long "no alerts here" can be believed without a new answer. Alerts themselves last until they expire.
export const STALE_AFTER_MS = 15 * MINUTE;
export const UNAVAILABLE_AFTER_MS = 60 * MINUTE;
const RETRY_BASE_MS = MINUTE;
const RETRY_MAX_MS = 30 * MINUTE;

/** @type {Record<AlertSeverity, number>} */
const SEVERITY_RANK = { EXTREME: 4, SEVERE: 3, UNKNOWN: 2, MODERATE: 2, MINOR: 1 };
/** @type {Record<AlertUrgency, number>} */
const URGENCY_RANK = { IMMEDIATE: 4, EXPECTED: 3, UNKNOWN: 2, FUTURE: 2, PAST: 1 };

/** @param {DefesaCivilAlert} a @param {DefesaCivilAlert} b */
const byImportance = (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  || URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]
  || b.sentAt - a.sentAt;

/**
 * Issuers repeat a message with a new polygon or a later end, and one place can fall in several.
 * @param {DefesaCivilAlert[]} alerts
 */
function withoutRepeats(alerts) {
  /** @type {Map<string, DefesaCivilAlert>} */
  const unique = new Map();
  for (const alert of alerts) {
    const key = [alert.severity, alert.issuer, alert.title, alert.description].join('\n');
    const seen = unique.get(key);
    if (!seen || alert.expiresAt > seen.expiresAt) unique.set(key, alert);
  }
  return [...unique.values()];
}

/**
 * When the next version of the feed should be there, by the server's own clock.
 * @param {FeedAnswer} feed
 */
function nextCheckIn({ generatedAt, serverTime }) {
  const longest = FEED_CACHE_MS + AFTER_REFRESH_MS;
  if (generatedAt === null || serverTime === null) return longest;
  return Math.min(longest, Math.max(MIN_CHECK_GAP_MS, longest - (serverTime - generatedAt)));
}

class AlertSubscription {
  /** @type {AlertPlace | null} The place to watch. */
  place = null;
  /** @type {string | null} Set when the weather reply named a place the feed cannot cover. */
  outsideCountry = null;
  /** @type {AlertSnapshot} */
  snapshot = { state: 'off', alerts: [], checkedAt: null };
  fingerprint = 'off';
  /** @type {LocationFromWeather | null} */
  #location = null;
  #enabled = true;

  /** @param {DefesaCivilAlertService} service @param {{active: boolean, onUpdate: () => void}} options */
  constructor(service, { active, onUpdate }) {
    this.service = service;
    this.active = active;
    this.onUpdate = onUpdate;
  }

  /** The place always comes from the weather reply, so there is no second location to configure. @param {LocationFromWeather | null} location */
  setPlace(location) {
    this.#location = location;
    this.#apply();
  }

  /** The key's own setting. @param {boolean} enabled */
  setEnabled(enabled) {
    this.#enabled = enabled;
    this.#apply();
  }

  #apply() {
    const covered = alertPlace(this.#location);
    const place = this.#enabled ? covered : null;
    // Whatever the setting says, because this is the reason the feature cannot work here.
    const outsideCountry = this.#location && !covered ? String(this.#location.country ?? '') : null;
    if (samePlace(place, this.place) && outsideCountry === this.outsideCountry) return;
    this.place = place;
    this.outsideCountry = outsideCountry;
    this.service.wake();
  }

  /** A key waiting for its place may need the feed in a moment. One outside Brazil or turned off will not. */
  get needsFeed() {
    return this.place !== null || (this.#location === null && this.#enabled);
  }

  /** @param {boolean} active */
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.service.wake();
  }

  close() {
    this.service.release(this);
  }
}

export class DefesaCivilAlertService {
  /** @type {Set<AlertSubscription>} */
  #subs = new Set();
  /** @type {DefesaCivilAlert[]} */
  #known = [];
  #fetchFeed;
  #now;
  #setTimer;
  #clearTimer;
  #log;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  /** @type {AbortController | null} */
  #loading = null;
  #nextFetchAt = 0;
  /** @type {number | null} */
  #checkedAt = null;
  #failures = 0;
  /** @type {string | null} */
  #lastFailure = null;
  #clockOffset = 0;
  /** @type {number | null} */
  #version = null;

  /**
   * @param {object} options
   * @param {(options: {signal: AbortSignal, knownVersion: number | null}) => Promise<FeedAnswer>} options.fetchFeed
   * @param {() => number} [options.now]
   * @param {(fn: () => void, ms: number) => any} [options.setTimer]
   * @param {(id: any) => void} [options.clearTimer]
   * @param {(message: string) => void} [options.log]
   */
  constructor({ fetchFeed, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
    this.#fetchFeed = fetchFeed;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#log = log;
  }

  /** @param {{active: boolean, onUpdate: () => void}} options */
  subscribe(options) {
    const subscription = new AlertSubscription(this, options);
    this.#subs.add(subscription);
    return subscription;
  }

  /** @param {AlertSubscription} subscription */
  release(subscription) {
    this.#subs.delete(subscription);
    this.wake();
  }

  /** The one place that decides what happens next, so there is never more than one timer. */
  wake() {
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
    if (![...this.#subs].some((subscription) => subscription.needsFeed)) this.#forget();
    const now = this.#now();
    this.#known = this.#known.filter((alert) => alert.expiresAt > this.#sourceTime(now));
    for (const subscription of this.#subs) this.#evaluate(subscription, now);

    // Nothing is fetched or scheduled for keys that are off screen or outside Brazil.
    if (![...this.#subs].some((subscription) => subscription.active && subscription.place)) {
      this.#loading?.abort();
      return;
    }
    if (!this.#loading && now >= this.#nextFetchAt) this.#load();
    const wakeAt = this.#nextWake();
    if (wakeAt !== null) {
      // Capped because a far-off date from the feed would overflow the timer, and that would fire at once.
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        this.wake();
      }, Math.min(Math.max(wakeAt - now, 1), LONGEST_WAIT_MS));
    }
  }

  async #load() {
    const controller = new AbortController();
    this.#loading = controller;
    /** @type {FeedAnswer | null} */
    let feed = null;
    /** @type {any} */
    let failure = null;
    try {
      feed = await this.#fetchFeed({ signal: controller.signal, knownVersion: this.#version });
    } catch (error) {
      failure = error;
    }
    this.#loading = null;
    // A canceled download says nothing, and whatever asked for it has moved on.
    if (!controller.signal.aborted) {
      if (feed) this.#recordAnswer(feed);
      else this.#recordFailure(failure);
    }
    this.wake();
  }

  /** Frees the polygons, and means the next place in Brazil starts from a new download. */
  #forget() {
    this.#known = [];
    this.#version = null;
    this.#checkedAt = null;
    this.#nextFetchAt = 0;
    this.#failures = 0;
    this.#lastFailure = null;
    this.#clockOffset = 0;
  }

  /** @param {FeedAnswer} feed */
  #recordAnswer(feed) {
    const now = this.#now();
    this.#clockOffset = feed.serverTime === null ? 0 : feed.serverTime - now;
    if (!feed.unchanged) {
      this.#version = feed.generatedAt;
      this.#known = this.#merge(feed, now);
    }
    // Counted from when the source produced it, so a server stuck on an old copy cannot go on saying "no alerts".
    this.#checkedAt = feed.generatedAt === null ? now : Math.min(now, feed.generatedAt - this.#clockOffset);
    this.#nextFetchAt = now + nextCheckIn(feed);
    this.#failures = 0;
    this.#lastFailure = null;
  }

  /**
   * An alert that lasts longer than the feed's window leaves it while still valid, which is not the same
   * as being withdrawn: anything newer than the oldest entry was withdrawn. A wrong date from the feed
   * must not pin an alert to the key, so nothing stays past MAX_KEPT_MS without the feed confirming it.
   * @param {import('./alert-types').FetchedFeed} feed
   * @param {number} now
   */
  #merge(feed, now) {
    const merged = new Map(feed.alerts.map((alert) => [alert.id, alert]));
    const sourceNow = this.#sourceTime(now);
    const windowStart = feed.oldestSentAt ?? sourceNow - FEED_WINDOW_MS;
    for (const alert of this.#known) {
      if (!merged.has(alert.id) && alert.sentAt < windowStart && sourceNow - alert.sentAt < MAX_KEPT_MS) merged.set(alert.id, alert);
    }
    for (const id of feed.withdrawnIds) merged.delete(id);
    return [...merged.values()];
  }

  /** @param {any} failure */
  #recordFailure(failure) {
    const kind = failure?.kind ?? 'network';
    if (kind !== this.#lastFailure) this.#log(`Defesa Civil alerts request failed: ${kind}${failure?.code ? ` (${failure.code})` : ''}`);
    this.#lastFailure = kind;
    this.#failures += 1;
    this.#nextFetchAt = this.#now() + Math.min(RETRY_BASE_MS * 2 ** (this.#failures - 1), RETRY_MAX_MS);
  }

  /** @param {number} now */
  #sourceTime(now) {
    return now + this.#clockOffset;
  }

  /** @param {number} now @returns {AlertSnapshot['state']} */
  #freshness(now) {
    if (this.#checkedAt === null) return this.#failures ? 'unavailable' : 'checking';
    const age = now - this.#checkedAt;
    if (age >= UNAVAILABLE_AFTER_MS) return 'unavailable';
    return age >= STALE_AFTER_MS ? 'stale' : 'clear';
  }

  /** @param {AlertSubscription} subscription @param {number} now */
  #evaluate(subscription, now) {
    const { place, outsideCountry } = subscription;
    /** @type {AlertSnapshot} */
    let next = { state: 'off', alerts: [], checkedAt: this.#checkedAt };
    if (outsideCountry !== null) {
      next = { state: 'outside', alerts: [], checkedAt: null, country: outsideCountry };
    } else if (place) {
      const sourceNow = this.#sourceTime(now);
      const alerts = withoutRepeats(this.#known.filter((alert) => (alert.effectiveAt ?? 0) <= sourceNow && affectsPlace(alert, place))).sort(byImportance);
      const freshness = this.#freshness(now);
      next = { state: freshness === 'clear' && alerts.length ? 'active' : freshness, alerts, checkedAt: this.#checkedAt };
    }
    const fingerprint = [next.country ? `${next.state}:${next.country}` : next.state, ...next.alerts.map((alert) => `${alert.id}:${alert.expiresAt}`)].join('|');
    subscription.snapshot = next;
    if (fingerprint === subscription.fingerprint) return;
    subscription.fingerprint = fingerprint;
    subscription.onUpdate();
  }

  /** The next moment something changes: a fetch due, an alert starting or ending, or an answer growing old. */
  #nextWake() {
    const offset = this.#clockOffset;
    const times = this.#known.flatMap((alert) => [alert.expiresAt - offset, (alert.effectiveAt ?? 0) - offset]);
    if (this.#checkedAt !== null) times.push(this.#checkedAt + STALE_AFTER_MS, this.#checkedAt + UNAVAILABLE_AFTER_MS);
    if (!this.#loading) times.push(this.#nextFetchAt);
    const now = this.#now();
    const future = times.filter((time) => time > now);
    return future.length ? Math.min(...future) : null;
  }
}
