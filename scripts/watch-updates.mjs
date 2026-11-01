// Watches how often WeatherAPI.com moves last_updated, which is what the plugin's polling relies on.
// It spends one call of your own plan per minute: WEATHERAPI_KEY=xxx npm run watch:updates -- [place] [minutes]
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchCurrent } from '../com.ulanzi.climapro.ulanziPlugin/plugin/weather-api.js';

const KEY = process.env.WEATHERAPI_KEY;
const PLACE = process.argv[2] ?? 'London';
const MINUTES = Number(process.argv[3] ?? 60);

if (!KEY) {
  console.error('Set WEATHERAPI_KEY to run.');
  process.exit(1);
}

const clock = (ms) => new Date(ms).toISOString().slice(11, 16);
let last = null;

console.log(`Watching ${PLACE} for ${MINUTES} minutes. Times are UTC.`);
for (let minute = 0; minute < MINUTES; minute += 1) {
  try {
    const { updatedEpoch, ageMs } = (await fetchCurrent(KEY, PLACE)).current;
    if (updatedEpoch !== last) {
      const step = last === null ? '' : `, ${(updatedEpoch - last) / 60} min after the previous one`;
      console.log(`${clock(Date.now())}  last_updated is ${clock(updatedEpoch * 1000)}, ${ageMs / 60_000} min old${step}`);
      last = updatedEpoch;
    }
  } catch (error) {
    console.log(`${clock(Date.now())}  ${error.message}`);
  }
  if (minute < MINUTES - 1) await sleep(60_000);
}
