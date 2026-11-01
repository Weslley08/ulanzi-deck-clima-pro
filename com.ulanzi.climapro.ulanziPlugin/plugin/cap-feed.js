// Reads the IDAP feed: an Atom document with one CAP 1.2 alert in each entry. It weighs about 7 MB and
// nearly all of that is polygon coordinates, so it is read in pieces. Polygons of alerts that already
// expired are skipped unparsed, and the others are packed into typed arrays, so the feed never has to
// sit in memory as text. No XML library: this reads only known tags and never expands an entity
// beyond the five standard ones and numeric references.
import { PolygonBuilder, parseAreaNames } from './alert-area.js';

/** @typedef {import('./alert-types').AlertSeverity} AlertSeverity */
/** @typedef {import('./alert-types').AlertUrgency} AlertUrgency */
/** @typedef {import('./alert-types').AlertPolygon} AlertPolygon */
/** @typedef {import('./alert-types').CapFeed} CapFeed */
/** @typedef {import('./alert-types').DefesaCivilAlert} DefesaCivilAlert */

export const SOURCE_NAME = 'IDAP';
// CAP allows an alert with no expiry and leaves the policy to the reader. Every entry seen so far has one.
export const MISSING_EXPIRY_MS = 6 * 60 * 60_000;

const POLYGON_OPEN = '<polygon>';
const POLYGON_CLOSE = '</polygon>';
const ENTRY_OPEN = '<entry>';
const ENTRY_CLOSE = '</entry>';
const FEED_CLOSE = '</feed>';
// Long enough that a marker split between two pieces of the stream is still found.
const KEEP_FOR_MARKER = POLYGON_CLOSE.length;
// Coordinates pass straight through, so only a little text ever waits here. Past this it is not a feed.
const MAX_BUFFER = 1024 * 1024;

/** @type {Record<string, AlertSeverity>} */
const SEVERITIES = { Extreme: 'EXTREME', Severe: 'SEVERE', Moderate: 'MODERATE', Minor: 'MINOR' };
/** @type {Record<string, AlertUrgency>} */
const URGENCIES = { Immediate: 'IMMEDIATE', Expected: 'EXPECTED', Future: 'FUTURE', Past: 'PAST' };
const IS_DEFESA_CIVIL = /defesa\s+civil/i;

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export class FeedError extends Error {
  /** @param {import('./alert-types').AlertFailureKind} kind @param {number} [code] */
  constructor(kind, code) {
    super(`alert feed failed: ${kind}${code ? ` (${code})` : ''}`);
    this.name = 'FeedError';
    this.kind = kind;
    this.code = code;
  }
}

/** @param {string} text */
function decodeXml(text) {
  const plain = text.startsWith('<![CDATA[') && text.endsWith(']]>') ? text.slice(9, -3) : text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] !== '#') return ENTITIES[name] ?? match;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  return plain.replace(/\s+/g, ' ').trim();
}

/** @param {string} text @param {string} name @param {number} [from] @returns {string} */
function tag(text, name, from = 0) {
  const open = `<${name}>`;
  const start = text.indexOf(open, from);
  if (start === -1) return '';
  const end = text.indexOf(`</${name}>`, start);
  return end === -1 ? '' : decodeXml(text.slice(start + open.length, end));
}

/** @param {string} text @param {string} name @returns {string[]} */
function tags(text, name) {
  const open = `<${name}>`;
  const found = [];
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + open.length)) {
    found.push(tag(text, name, start));
  }
  return found;
}

/** @param {string} value @returns {number | undefined} */
function time(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** @param {string} text @returns {string[]} */
function ibgeCodes(text) {
  const codes = [];
  for (let start = text.indexOf('<geocode>'); start !== -1; start = text.indexOf('<geocode>', start + 1)) {
    if (tag(text, 'valueName', start) === 'IBGE') {
      const code = tag(text, 'value', start);
      if (/^\d{7}$/.test(code)) codes.push(code);
    }
  }
  return codes;
}

/** CAP writes references as `sender,identifier,sent` separated by spaces. @param {string} text */
const referencedIds = (text) => text.split(' ').map((reference) => reference.split(',')[1]).filter(Boolean);

/** @param {string} value */
function httpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export class CapFeedReader {
  #now;
  #buffer = '';
  /** Everything of the current entry or header except its polygons. */
  #text = '';
  #inEntry = false;
  #sawRoot = false;
  #closed = false;
  /** @type {PolygonBuilder | null} */
  #polygon = null;
  #skippingPolygon = false;
  /** @type {AlertPolygon[]} */
  #polygons = [];
  #wellFormed = 0;

  /** @type {CapFeed} */
  feed = { generatedAt: null, oldestSentAt: null, entryCount: 0, alerts: [], withdrawnIds: new Set() };

  /** @param {number} now to tell expired alerts, whose polygons need no reading */
  constructor(now) {
    this.#now = now;
  }

  /** @param {string} piece */
  push(piece) {
    this.#buffer += piece;
    while (this.#step());
    if (this.#buffer.length > MAX_BUFFER || this.#text.length > MAX_BUFFER) throw new FeedError('invalid');
  }

  /** @returns {CapFeed} @throws {FeedError} when this is not a whole feed */
  finish() {
    if (!this.#sawRoot || !this.#closed || (this.feed.entryCount > 0 && this.#wellFormed === 0)) throw new FeedError('invalid');
    return this.feed;
  }

  /** @returns {boolean} whether to look again */
  #step() {
    if (this.#polygon || this.#skippingPolygon) return this.#readPolygon();
    return this.#inEntry ? this.#readEntryText() : this.#readOutsideEntries();
  }

  // The header and the space between entries are small, so they can wait in the buffer.
  #readOutsideEntries() {
    const open = this.#buffer.indexOf(ENTRY_OPEN);
    if (open === -1) {
      this.#closed = this.#buffer.includes(FEED_CLOSE);
      if (this.#closed && !this.#sawRoot) this.#readHeader(this.#buffer);
      return false;
    }
    if (!this.#sawRoot) this.#readHeader(this.#buffer.slice(0, open));
    this.#buffer = this.#buffer.slice(open + ENTRY_OPEN.length);
    this.#inEntry = true;
    return true;
  }

  /** @param {string} header */
  #readHeader(header) {
    this.#sawRoot = header.includes('<feed');
    this.feed.generatedAt = time(tag(header, 'updated')) ?? null;
  }

  #readEntryText() {
    const polygon = this.#buffer.indexOf(POLYGON_OPEN);
    const close = this.#buffer.indexOf(ENTRY_CLOSE);
    if (polygon !== -1 && (close === -1 || polygon < close)) {
      this.#absorb(polygon);
      this.#buffer = this.#buffer.slice(POLYGON_OPEN.length);
      // CAP's order puts expires before area, so it is known by the first polygon.
      if (this.#stillInForce()) this.#polygon = new PolygonBuilder();
      else this.#skippingPolygon = true;
      return true;
    }
    if (close !== -1) {
      this.#absorb(close);
      this.#buffer = this.#buffer.slice(ENTRY_CLOSE.length);
      this.#finishEntry();
      return true;
    }
    this.#absorb(this.#buffer.length - KEEP_FOR_MARKER);
    return false;
  }

  #readPolygon() {
    const close = this.#buffer.indexOf(POLYGON_CLOSE);
    if (close === -1) {
      // Everything before the last space is whole pairs. The rest may continue in the next piece.
      const cut = this.#buffer.lastIndexOf(' ');
      if (cut > 0) {
        this.#polygon?.add(this.#buffer.slice(0, cut));
        this.#buffer = this.#buffer.slice(cut + 1);
      }
      return false;
    }
    this.#polygon?.add(this.#buffer.slice(0, close));
    this.#buffer = this.#buffer.slice(close + POLYGON_CLOSE.length);
    const built = this.#polygon?.build();
    if (built) this.#polygons.push(built);
    this.#polygon = null;
    this.#skippingPolygon = false;
    return true;
  }

  /** @param {number} length */
  #absorb(length) {
    if (length <= 0) return;
    this.#text += this.#buffer.slice(0, length);
    this.#buffer = this.#buffer.slice(length);
  }

  #stillInForce() {
    const expires = time(tag(this.#text, 'expires'));
    return expires === undefined || expires > this.#now;
  }

  #finishEntry() {
    this.feed.entryCount += 1;
    this.#readAlert(this.#text, this.#polygons);
    this.#text = '';
    this.#polygons = [];
    this.#inEntry = false;
  }

  /** @param {string} text @param {AlertPolygon[]} polygons */
  #readAlert(text, polygons) {
    const id = tag(text, 'identifier');
    const sentAt = time(tag(text, 'sent'));
    if (!id || sentAt === undefined) return;
    this.#wellFormed += 1;
    const { feed } = this;
    if (feed.oldestSentAt === null || sentAt < feed.oldestSentAt) feed.oldestSentAt = sentAt;

    const issuer = tag(text, 'senderName');
    const official = tag(text, 'status') === 'Actual' && tag(text, 'scope') === 'Public' && (IS_DEFESA_CIVIL.test(tag(text, 'source')) || IS_DEFESA_CIVIL.test(issuer));
    if (!official) return;

    const type = tag(text, 'msgType');
    if (type === 'Update' || type === 'Cancel' || type === 'Error') {
      for (const replaced of referencedIds(tag(text, 'references'))) feed.withdrawnIds.add(replaced);
    }
    if (type !== 'Alert' && type !== 'Update') return;

    const expiresAt = time(tag(text, 'expires')) ?? sentAt + MISSING_EXPIRY_MS;
    if (expiresAt <= this.#now) return;
    const areaDescription = tags(text, 'areaDesc').join(', ');
    feed.alerts.push({
      id,
      source: SOURCE_NAME,
      issuer,
      title: tag(text, 'event'),
      // The headline repeats the description for SMS, without accents and with a prefix.
      description: tag(text, 'description') || tag(text, 'headline').replace(/^Defesa Civil:\s*/i, ''),
      instructions: tag(text, 'instruction') || undefined,
      severity: SEVERITIES[tag(text, 'severity')] ?? 'UNKNOWN',
      urgency: URGENCIES[tag(text, 'urgency')] ?? 'UNKNOWN',
      sentAt,
      effectiveAt: time(tag(text, 'effective')),
      startAt: time(tag(text, 'onset')),
      expiresAt,
      areaDescription,
      areaNames: parseAreaNames(areaDescription),
      affectedIbgeCodes: ibgeCodes(text),
      polygons,
      officialUrl: httpsUrl(tag(text, 'web')),
    });
  }
}
