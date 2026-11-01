import AlmanacTheme from './almanac.js';
import LcdTheme from './lcd.js';
import MinimalTheme from './minimal.js';
import NeonTheme from './neon.js';
import SkyTheme from './sky.js';
import ThermalTheme from './thermal.js';

// Order here is the order shown in the theme gallery. The first one is the default.
const ALL = [new SkyTheme(), new MinimalTheme(), new ThermalTheme(), new LcdTheme(), new NeonTheme(), new AlmanacTheme()];

const BY_ID = new Map(ALL.map((theme) => [theme.id, theme]));

export const THEME_IDS = ALL.map((theme) => theme.id);
export const DEFAULT_THEME = ALL[0].id;

export function getTheme(id) {
  return BY_ID.get(id) ?? ALL[0];
}
