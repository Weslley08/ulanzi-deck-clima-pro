// WeatherAPI.com client. This is the only file that ever puts the API key in a URL.
import { conditionFromCode } from './conditions.js';

const BASE_URL = 'https://api.weatherapi.com/v1';
const TIMEOUT_MS = 10_000;
const FORECAST_DAYS = 3; // The most the free plan returns.
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

function parseDay(entry) {
  const { day = {} } = entry;
  const rain = toNumber(day.daily_chance_of_rain);
  const snow = toNumber(day.daily_chance_of_snow);
  return {
    dateEpoch: entry.date_epoch,
    condition: conditionFromCode(day.condition?.code),
    maxC: toNumber(day.maxtemp_c),
    maxF: toNumber(day.maxtemp_f),
    minC: toNumber(day.mintemp_c),
    minF: toNumber(day.mintemp_f),
    // The umbrella stands for any precipitation, so a snowy day should not read as dry.
    rainChance: rain === null && snow === null ? null : Math.max(rain ?? 0, snow ?? 0),
  };
}

export function parseForecast(body) {
  const { location, current, forecast } = body ?? {};
  if (!location || !current) throw new WeatherError('server');
  const days = (forecast?.forecastday ?? []).map(parseDay);
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
    },
    today: days[0] ?? null,
    days,
  };
}

export async function fetchForecast(apiKey, query) {
  // hour= trims the response from hundreds of hourly entries to one per day; we use none of them.
  const body = await request('forecast.json', { key: apiKey, q: query, days: FORECAST_DAYS, hour: 12, aqi: 'no', alerts: 'no' });
  return parseForecast(body);
}

export async function searchLocations(apiKey, query) {
  const body = await request('search.json', { key: apiKey, q: query });
  if (!Array.isArray(body)) return [];
  return body.slice(0, MAX_SUGGESTIONS).map((place) => [place.name, place.region, place.country].filter(Boolean).join(', '));
}
