// Settings arrive from the host as loose strings and may predate this version.
import { DEFAULT_THEME, THEME_IDS } from './render/themes/index.js';

export const SCREENS = ['now', 'details'];

const MAX_TEXT = 80;
const API_KEY = /^[A-Za-z0-9]{10,64}$/;

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const cleanText = (value) => String(value ?? '').trim().slice(0, MAX_TEXT);

export function normalizeSettings(raw = {}) {
  return {
    theme: oneOf(raw.theme, THEME_IDS, DEFAULT_THEME),
    location: cleanText(raw.location),
    label: cleanText(raw.label),
    unit: oneOf(raw.unit, ['c', 'f'], 'c'),
    screen: oneOf(raw.screen, SCREENS, SCREENS[0]),
  };
}

/** Anything that does not look like a key counts as no key, so it never reaches a request. */
export function normalizeApiKey(raw) {
  const key = String(raw ?? '').trim();
  return API_KEY.test(key) ? key : '';
}
