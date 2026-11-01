// Made-up weather used for previews, store art and tests. Nothing here comes from the API.
import { buildWeatherView, buildMessageView } from '../../com.ulanzi.climapro.ulanziPlugin/plugin/view.js';

export function sampleWeather({
  city = 'São Paulo',
  condition = 'partly',
  isDay = true,
  tempC = 27,
  feelsLikeC = 29,
  humidity = 62,
  windKph = 14,
  precipMm = 0.4,
} = {}) {
  const toF = (c) => (c * 9) / 5 + 32;
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
      precipMm,
      precipIn: precipMm / 25.4,
    },
  };
}

export const sampleSettings = (theme, overrides = {}) => ({ theme, unit: 'c', ...overrides });

export function sampleView(theme, screen = 'now', weather = {}, settings = {}) {
  return buildWeatherView(sampleWeather(weather), sampleSettings(theme, settings), screen);
}

export function sampleMessage(theme, message = 'Add your API key', glyph = 'key') {
  return buildMessageView(sampleSettings(theme), message, glyph);
}
