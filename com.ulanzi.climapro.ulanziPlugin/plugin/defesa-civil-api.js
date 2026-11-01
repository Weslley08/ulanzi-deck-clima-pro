// IDAP client. The feed covers all of Brazil and matching happens here, so the request says nothing
// about the user or the place. See docs/DEFESA-CIVIL.md for what this source covers and what it does not.
//
// node:https and not fetch, because of the feed's size: one read of the real feed raised the process's
// memory by 8 MB this way and by 22 to 27 MB through fetch, every 5 minutes.
import https from 'node:https';
import { CapFeedReader, FeedError } from './cap-feed.js';

const FEED_URL = 'https://idapfile.mdr.gov.br/idap/api/rss/cap';
const USER_AGENT = 'ClimaPro (+https://github.com/Weslley08/ulanzi-deck-clima-pro)';
// Generous because the size follows the weather: 3 to 7 MB were seen on a quiet day, which takes minutes
// on a slow link, and more on a stormy one. Nothing waits for this, and refusing a big feed on the worst
// day would be the wrong way round, so the limit only stops something that is clearly not this feed.
const TIMEOUT_MS = 300_000;
const MAX_BYTES = 256 * 1024 * 1024;

/**
 * A plain GET follows no redirects, so an official-looking alert can only ever come from the official host.
 * @param {AbortSignal} signal
 * @returns {Promise<import('node:http').IncomingMessage>}
 */
function openFeed(signal) {
  return new Promise((resolve, reject) => {
    https.get(FEED_URL, { headers: { 'user-agent': USER_AGENT }, signal }, resolve).on('error', reject);
  });
}

/**
 * @param {{signal?: AbortSignal, knownVersion?: number | null}} [options] knownVersion is the `<updated>` of the feed last read
 * @returns {Promise<import('./alert-types').FeedAnswer>}
 * @throws {FeedError}
 */
export async function fetchDefesaCivilFeed({ signal, knownVersion = null } = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await openFeed(signal ? AbortSignal.any([signal, timeout]) : timeout);
    if (response.statusCode !== 200) {
      response.destroy();
      throw new FeedError('server', response.statusCode);
    }
    // Read the server's clock first: with a wrong clock here, a valid alert would look expired and be skipped.
    const date = Date.parse(response.headers.date ?? '');
    const serverTime = Number.isFinite(date) ? date : null;
    const reader = new CapFeedReader(serverTime ?? Date.now());
    const decoder = new TextDecoder();
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new FeedError('invalid');
      reader.push(decoder.decode(chunk, { stream: true }));
      // <updated> comes first and the server caches whole versions, and there is no ETag to ask with.
      // Leaving this loop closes the connection, so a version already read costs one piece, not the whole feed.
      if (knownVersion !== null && reader.feed.generatedAt === knownVersion) return { unchanged: true, generatedAt: knownVersion, serverTime };
    }
    reader.push(decoder.decode());
    return { ...reader.finish(), serverTime };
  } catch (error) {
    if (signal?.aborted) throw new FeedError('aborted');
    if (error instanceof FeedError) throw error;
    // The original error is dropped on purpose, so nothing but a kind ever reaches the log.
    throw new FeedError('network');
  }
}
