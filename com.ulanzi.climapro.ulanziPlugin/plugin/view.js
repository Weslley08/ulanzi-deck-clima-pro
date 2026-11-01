// Turns weather data and key settings into the flat, display-ready object themes draw.

const DASH = '--';

const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
const minusSign = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
const degrees = (value) => {
  const n = round(value);
  return n === null ? DASH : `${minusSign(n)}°`;
};
// Drizzle is a fraction of a millimetre, so whole numbers would read as dry.
const amount = (value, decimals) => (Number.isFinite(value) ? String(Number(value.toFixed(decimals))) : DASH);

export function buildWeatherView(weather, settings, screen, stale = false) {
  const fahrenheit = settings.unit === 'f';
  const pick = (metric, imperial) => (fahrenheit ? imperial : metric);
  const { current, location } = weather;
  const wind = round(pick(current.windKph, current.windMph));
  const temp = round(pick(current.tempC, current.tempF));

  return {
    theme: settings.theme,
    screen,
    condition: current.condition,
    isDay: current.isDay,
    city: location.name,
    unit: fahrenheit ? 'f' : 'c',
    celsius: round(current.tempC),
    temp: degrees(temp),
    tempValue: temp === null ? '' : String(temp),
    feels: degrees(pick(current.feelsLikeC, current.feelsLikeF)),
    humidity: round(current.humidity) ?? DASH,
    wind: wind ?? DASH,
    windUnit: pick('km/h', 'mph'),
    precip: amount(pick(current.precipMm, current.precipIn), pick(1, 2)),
    precipUnit: pick('mm', 'in'),
    stale,
  };
}

/** Screens with no weather on them: setup, loading and errors. */
export function buildMessageView(settings, message, glyph) {
  return { theme: settings.theme, screen: 'message', isDay: true, condition: 'cloudy', message, glyph: glyph ?? null };
}

const UNCERTAIN_STATES = new Set(['stale', 'unavailable']);

/**
 * Adds what the themes need to know about alerts. With nothing to say the view comes back untouched,
 * so a key with no alert renders exactly what it did before alerts existed.
 * @param {object} view
 * @param {import('./alert-types').AlertSnapshot} snapshot
 * @param {number} [pulse] step of the extreme animation
 */
export function withAlert(view, { state, alerts }, pulse = 0) {
  const uncertain = UNCERTAIN_STATES.has(state);
  const severity = alerts[0]?.severity ?? null;
  if (!severity && !uncertain) return view;
  return { ...view, alert: { severity, uncertain, pulse: severity === 'EXTREME' ? pulse : 0 } };
}

const twoDigits = (n) => String(n).padStart(2, '0');

/** In local time, with the date only when it is not today. */
export function alertEndTime(ms, now = Date.now()) {
  const end = new Date(ms);
  const clock = `${twoDigits(end.getHours())}:${twoDigits(end.getMinutes())}`;
  return end.toDateString() === new Date(now).toDateString() ? clock : `${twoDigits(end.getDate())}/${twoDigits(end.getMonth() + 1)} ${clock}`;
}

/**
 * The page a press opens. Always in Portuguese, because the text comes from the issuer that way.
 * @param {import('./alert-types').DefesaCivilAlert} alert
 */
export function buildAlertPageView(alert, index, total, settings, weatherView) {
  return {
    theme: settings.theme,
    screen: 'alertPage',
    severity: alert.severity,
    title: alert.title,
    description: alert.description,
    until: alertEndTime(alert.expiresAt),
    index,
    total,
    temp: weatherView?.temp ?? null,
    city: weatherView?.city ?? null,
  };
}
