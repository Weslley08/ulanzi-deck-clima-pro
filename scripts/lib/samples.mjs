// Made-up weather used for previews, store art and tests. Nothing here comes from the API.
import { buildWeatherView, buildMessageView } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/view.js';

export const MONDAY_EPOCH = Date.UTC(2026, 10, 2) / 1000;

export function sampleWeather({
  city = 'São Paulo',
  condition = 'partly',
  isDay = true,
  tempC = 27,
  feelsLikeC = 29,
  maxC = 30,
  minC = 21,
  humidity = 62,
  windKph = 14,
  rainChance = 35,
} = {}) {
  const toF = (c) => (c * 9) / 5 + 32;
  const days = [
    { condition, maxC, minC, rainChance },
    { condition: 'rain', maxC: 24, minC: 18, rainChance: 80 },
    { condition: 'clear', maxC: 31, minC: 20, rainChance: 5 },
  ].map((day, i) => ({
    ...day,
    dateEpoch: MONDAY_EPOCH + i * 86400,
    maxF: toF(day.maxC),
    minF: toF(day.minC),
  }));
  return {
    location: { name: city, region: '', country: 'Brazil' },
    current: {
      condition,
      isDay,
      tempC,
      tempF: toF(tempC),
      feelsLikeC,
      feelsLikeF: toF(feelsLikeC),
      humidity,
      windKph,
      windMph: windKph / 1.609,
    },
    today: days[0],
    days,
  };
}

export const sampleSettings = (theme, overrides = {}) => ({ theme, unit: 'c', ...overrides });

export function sampleView(theme, screen = 'now', weather = {}, settings = {}, language = 'en') {
  return buildWeatherView(sampleWeather(weather), sampleSettings(theme, settings), screen, language);
}

export function sampleMessage(theme, message = 'Add your API key', glyph = 'key') {
  return buildMessageView(sampleSettings(theme), message, glyph);
}
