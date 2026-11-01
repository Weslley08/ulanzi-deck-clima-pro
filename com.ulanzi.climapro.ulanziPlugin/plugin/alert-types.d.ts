// The shapes the Defesa Civil code passes around. Checked by `npm run typecheck`: the plugin runs
// as plain JavaScript on Studio's Node, with no build step, so nothing here ships as code.

/**
 * The feed's own CAP severity, translated and never remapped. EXTREME and SEVERE get the banner on
 * the key. The rest get a small mark, because the feed does publish them.
 */
export type AlertSeverity = 'EXTREME' | 'SEVERE' | 'MODERATE' | 'MINOR' | 'UNKNOWN';

export type AlertUrgency = 'IMMEDIATE' | 'EXPECTED' | 'FUTURE' | 'PAST' | 'UNKNOWN';

/** One place named in `areaDesc`, such as `Blumenau/SC`. `name` is folded with `placeKey`. */
export interface AlertAreaName {
  name: string;
  uf: string;
}

export interface AlertPolygon {
  contains(lat: number, lon: number): boolean;
}

export interface DefesaCivilAlert {
  id: string;
  source: string;
  /** The body that issued it, from `senderName`, such as `Defesa Civil de Blumenau (SC)`. */
  issuer: string;
  title: string;
  description: string;
  instructions?: string;
  severity: AlertSeverity;
  urgency: AlertUrgency;
  /** Epoch ms. `sent` always exists in the feed. */
  sentAt: number;
  /** CAP's `effective`, when the alert starts to apply. Without it, the alert applies from `sent`. */
  effectiveAt?: number;
  /** CAP's `onset`, when the event itself is expected. An alert can rightly come before its event. */
  startAt?: number;
  /** Always set: CAP allows leaving it out, and `MISSING_EXPIRY_MS` then limits how long it lasts. */
  expiresAt: number;
  areaDescription: string;
  areaNames: AlertAreaName[];
  /** The plugin has no IBGE code for the user's place, so these are kept but never matched on. */
  affectedIbgeCodes: string[];
  polygons: AlertPolygon[];
  officialUrl?: string;
}

export interface CapFeed {
  /** The feed's own `<updated>`, in epoch ms, or null if it had none. */
  generatedAt: number | null;
  /** `sent` of the oldest entry present, so anything older has scrolled off rather than been withdrawn. */
  oldestSentAt: number | null;
  entryCount: number;
  alerts: DefesaCivilAlert[];
  /** Identifiers that an Update, Cancel or Error entry replaces. */
  withdrawnIds: Set<string>;
}

export interface FetchedFeed extends CapFeed {
  /** The server's clock, from the Date header. */
  serverTime: number | null;
  unchanged?: false;
}

/** The server still has the version last read, so the rest of the download was skipped. */
export interface UnchangedFeed {
  unchanged: true;
  generatedAt: number;
  serverTime: number | null;
}

export type FeedAnswer = FetchedFeed | UnchangedFeed;

export type AlertFailureKind = 'network' | 'server' | 'invalid' | 'aborted';

/** The user's place, reduced to what matching needs. */
export interface AlertPlace {
  name: string;
  uf: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * - `checking`: no answer yet.
 * - `clear`: the source produced a recent answer and nothing in it affects this place.
 * - `active`: at least one alert affects this place.
 * - `stale`: the last answer is getting old, so it may be out of date.
 * - `unavailable`: there is no recent answer. This never means there are no alerts.
 * - `off`: nothing to check, because of the key's setting or because the place is not known yet.
 * - `outside`: the weather reply named a place outside Brazil, which the feed cannot cover, so the feature is off.
 */
export type AlertState = 'checking' | 'clear' | 'active' | 'stale' | 'unavailable' | 'off' | 'outside';

export interface AlertSnapshot {
  state: AlertState;
  /** Most serious first. Can be present in `stale` and `unavailable`, since they last until they expire. */
  alerts: DefesaCivilAlert[];
  /** When the source produced the last answer, in this machine's epoch ms. */
  checkedAt: number | null;
  /** For `outside`, the country the weather reply named, so the user can see why. Remote text. */
  country?: string;
}

export interface LocationFromWeather {
  name?: string;
  region?: string;
  country?: string;
  lat?: number | null;
  lon?: number | null;
}
