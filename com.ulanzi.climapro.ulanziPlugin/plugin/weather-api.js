// WeatherAPI.com client. This is the only file that ever puts the API key in a URL.
import { conditionFromCode } from './conditions.js';

const BASE_URL = 'https://api.weatherapi.com/v1';
const TIMEOUT_MS = 10_000;
const MAX_SUGGESTIONS = 5;

export const AUTO_LOCATION = 'auto:ip';

// Source: https://www.weatherapi.com/docs/error-codes/
const KIND_BY_CODE = new Map([
  [1002, 'auth'],
  [2006, 'auth'],
  [2008, 'auth'],
  [2009, 'auth'],
  [2007, 'quota'],
  [1003, 'location'],
  [1005, 'location'],
  [1006, 'location'],
]);

export class WeatherError extends Error {
  /** @param {'auth'|'quota'|'location'|'network'|'server'} kind @param {number} [code] */
  constructor(kind, code) {
    super(`weather request failed: ${kind}${code ? ` (${code})` : ''}`);
    this.name = 'WeatherError';
    this.kind = kind;
    this.code = code;
  }
}

async function request(path, params) {
  const url = `${BASE_URL}/${path}?${new URLSearchParams(params)}`;
  let response;
  let body;
  try {
    // redirect: 'error' keeps the key from being replayed to another host.
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    body = await response.json();
  } catch {
    // The original error is dropped on purpose: it can quote the URL, and the URL holds the key.
    if (!response) throw new WeatherError('network');
    body = null;
  }
  if (response.ok && body && !body.error) return body;
  const code = body?.error?.code;
  throw new WeatherError(KIND_BY_CODE.get(code) ?? 'server', code ?? response.status);
}

const toNumber = (value) => {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value ?? NaN);
  return Number.isFinite(n) ? n : null;
};

/** How old the data was when the API answered. Both times are the API's, so a wrong clock here cannot skew it. */
function ageMs(updatedEpoch, nowEpoch) {
  if (updatedEpoch === null || nowEpoch === null || nowEpoch < updatedEpoch) return null;
  return (nowEpoch - updatedEpoch) * 1000;
}

export function parseCurrent(body) {
  const { location, current } = body ?? {};
  if (!location || !current) throw new WeatherError('server');
  const updatedEpoch = toNumber(current.last_updated_epoch);
  return {
    location: { name: String(location.name ?? ''), region: String(location.region ?? ''), country: String(location.country ?? '') },
    current: {
      condition: conditionFromCode(current.condition?.code),
      isDay: Number(current.is_day) === 1,
      tempC: toNumber(current.temp_c),
      tempF: toNumber(current.temp_f),
      feelsLikeC: toNumber(current.feelslike_c),
      feelsLikeF: toNumber(current.feelslike_f),
      humidity: toNumber(current.humidity),
      windKph: toNumber(current.wind_kph),
      windMph: toNumber(current.wind_mph),
      precipMm: toNumber(current.precip_mm),
      precipIn: toNumber(current.precip_in),
      updatedEpoch,
      ageMs: ageMs(updatedEpoch, toNumber(location.localtime_epoch)),
    },
  };
}

export async function fetchCurrent(apiKey, query) {
  return parseCurrent(await request('current.json', { key: apiKey, q: query, aqi: 'no' }));
}

export async function searchLocations(apiKey, query) {
  const body = await request('search.json', { key: apiKey, q: query });
  if (!Array.isArray(body)) return [];
  return body.slice(0, MAX_SUGGESTIONS).map((place) => ({
    id: toNumber(place.id),
    label: [place.name, place.region, place.country].filter(Boolean).join(', '),
  }));
}
