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
