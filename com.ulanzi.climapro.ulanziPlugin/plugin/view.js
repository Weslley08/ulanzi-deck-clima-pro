// Turns weather data and key settings into the flat, display-ready object themes draw.

const DASH = '--';

const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
const minusSign = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
const degrees = (value) => {
  const n = round(value);
  return n === null ? DASH : `${minusSign(n)}°`;
};
const percent = (value) => {
  const n = round(value);
  return n === null ? DASH : `${n}%`;
};

export function weekdayLabel(dateEpoch, language) {
  const date = new Date(dateEpoch * 1000);
  const format = (locale) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date);
  let label;
  try {
    label = format(String(language ?? 'en').replace('_', '-'));
  } catch {
    label = format('en');
  }
  return label.replace(/[.,]/g, '').toUpperCase().slice(0, 3);
}

export function buildWeatherView(weather, settings, screen, language, stale = false) {
  const fahrenheit = settings.unit === 'f';
  const pick = (metric, imperial) => (fahrenheit ? imperial : metric);
  const { current, today, days, location } = weather;
  const wind = round(pick(current.windKph, current.windMph));
  const temp = round(pick(current.tempC, current.tempF));

  return {
    theme: settings.theme,
    screen,
    condition: current.condition,
    isDay: current.isDay,
    city: settings.label || location.name,
    unit: fahrenheit ? 'f' : 'c',
    celsius: round(current.tempC),
    temp: degrees(temp),
    tempValue: temp === null ? '' : String(temp),
    feels: degrees(pick(current.feelsLikeC, current.feelsLikeF)),
    humidity: round(current.humidity) ?? DASH,
    wind: wind ?? DASH,
    windUnit: pick('km/h', 'mph'),
    rainChance: round(today?.rainChance) ?? DASH,
    max: degrees(pick(today?.maxC, today?.maxF)),
    min: degrees(pick(today?.minC, today?.minF)),
    days: days.map((day) => ({
      label: weekdayLabel(day.dateEpoch, language),
      condition: day.condition,
      max: degrees(pick(day.maxC, day.maxF)),
      min: degrees(pick(day.minC, day.minF)),
      rain: percent(day.rainChance),
    })),
    stale,
  };
}

/** Screens with no weather on them: setup, loading and errors. */
export function buildMessageView(settings, message, glyph) {
  return { theme: settings.theme, screen: 'message', isDay: true, condition: 'cloudy', message, glyph: glyph ?? null };
}
