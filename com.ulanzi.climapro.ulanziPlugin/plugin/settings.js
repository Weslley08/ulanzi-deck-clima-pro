// Settings arrive from the host as loose strings and may predate this version.
import { DEFAULT_THEME, THEME_IDS } from './render/themes/index.js';

export const SCREENS = ['now', 'details'];

const MAX_TEXT = 80;
const API_KEY = /^[A-Za-z0-9]{10,64}$/;
const PLACE_ID = /^\d{1,12}$/;

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const cleanText = (value) => String(value ?? '').trim().slice(0, MAX_TEXT);

export function normalizeSettings(raw = {}) {
  return {
    theme: oneOf(raw.theme, THEME_IDS, DEFAULT_THEME),
    location: cleanText(raw.location),
    placeId: PLACE_ID.test(raw.placeId) ? String(raw.placeId) : '',
    unit: oneOf(raw.unit, ['c', 'f'], 'c'),
    screen: oneOf(raw.screen, SCREENS, SCREENS[0]),
    alerts: oneOf(raw.alerts, ['on', 'off'], 'on'),
  };
}

/** A place chosen from the list is asked for by its ID, because the API can read its name as somewhere else. */
export const placeQuery = ({ placeId, location }) => (placeId ? `id:${placeId}` : location);

/** Anything that does not look like a key counts as no key, so it never reaches a request. */
export function normalizeApiKey(raw) {
  const key = String(raw ?? '').trim();
  return API_KEY.test(key) ? key : '';
}
