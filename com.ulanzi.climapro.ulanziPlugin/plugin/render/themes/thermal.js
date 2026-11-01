import { Theme, SIZE } from '../theme.js';

// Background follows the temperature, like a weather map. Bands are in °C.
const BANDS = [
  { below: -10, bg: '#3B1E77', ink: '#FFFFFF' },
  { below: 0, bg: '#1F4FB8', ink: '#FFFFFF' },
  { below: 10, bg: '#0F7FA8', ink: '#FFFFFF' },
  { below: 18, bg: '#2BB39B', ink: '#06211C' },
  { below: 24, bg: '#A6D854', ink: '#1A2406' },
  { below: 30, bg: '#FFC93C', ink: '#2B1F00' },
  { below: 36, bg: '#F2762E', ink: '#1F0D00' },
  { below: Infinity, bg: '#C4202B', ink: '#FFFFFF' },
];
const SCALE_MIN = -20;
const SCALE_MAX = 45;

function bandFor(celsius) {
  return BANDS.find((band) => celsius < band.below) ?? BANDS[0];
}

export default class ThermalTheme extends Theme {
  id = 'thermal';
  fonts = { big: 'outfit-800', label: 'outfit-500' };

  palette(view) {
    const { bg, ink } = bandFor(view.celsius ?? 20);
    return { bg, ink, sub: ink, accent: ink };
  }

  iconStyle(view) {
    const { bg, ink } = this.palette(view);
    return { mode: 'fill', knockout: bg, colors: new Proxy({}, { get: () => ink }) };
  }

  background(view) {
    return `<rect width="${SIZE}" height="${SIZE}" fill="${this.palette(view).bg}"/>`;
  }

  scaleBar(view) {
    const { ink } = this.palette(view);
    const ratio = Math.min(1, Math.max(0, ((view.celsius ?? 20) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
    const x = 11 + ratio * 122;
    return `<rect x="11" y="127" width="122" height="5" rx="2.5" fill="${ink}" opacity=".3"/><circle cx="${x.toFixed(1)}" cy="129.5" r="5.5" fill="${ink}"/>`;
  }

  now(view) {
    return this.label(view, view.city, 11, 25, 86, 16, { minSize: 11 })
      + this.icon(view, view.condition, view.isDay, 102, 6, 34)
      + this.bigTemp(view, view.temp, 72, 106, 130, 82, { anchor: 'middle' })
      + this.scaleBar(view);
  }
}
