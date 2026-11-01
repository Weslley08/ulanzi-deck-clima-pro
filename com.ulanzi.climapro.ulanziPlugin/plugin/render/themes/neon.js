import { Theme, SIZE } from '../theme.js';
import { text, fit } from '../text.js';
import { weatherIcon } from '../icons.js';

const CYAN = '#22F3FF';
const PINK = '#FF4FD8';
const AMBER = '#FFC247';
const BG_TOP = '#0A0420';
const BG_BOTTOM = '#1D0B42';

const COLORS = {
  sun: AMBER,
  ray: AMBER,
  moon: '#E8E4FF',
  star: PINK,
  cloud: CYAN,
  cloudBack: PINK,
  cloudDark: '#8F7BFF',
  drop: CYAN,
  flake: '#FFFFFF',
  bolt: AMBER,
  fog: CYAN,
  dust: AMBER,
};

const VANISHING = [-60, -30, 0, 30, 60].map((dx) => `M72 106L${72 + dx * 3} ${SIZE}`).join('');
const HORIZONTALS = [106, 111, 136].map((y) => `M0 ${y}H${SIZE}`).join('');

export default class NeonTheme extends Theme {
  id = 'neon';
  fonts = { big: 'orbitron-700', label: 'orbitron-700' };

  palette() {
    return { bg: BG_BOTTOM, ink: '#FFFFFF', sub: '#FF9DEA', accent: CYAN };
  }

  iconStyle() {
    return { mode: 'stroke', strokeWidth: 3.2, knockout: BG_TOP, colors: COLORS };
  }

  background(view) {
    let out = `<defs><linearGradient id="neon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient></defs><rect width="${SIZE}" height="${SIZE}" fill="url(#neon)"/>`;
    if (view.screen === 'now') out += `<path d="${VANISHING}${HORIZONTALS}" fill="none" stroke="${PINK}" stroke-width="1" opacity=".2"/>`;
    return out;
  }

  // Layered strokes instead of an SVG blur filter: same glow for a fraction of the render cost.
  icon(view, condition, isDay, x, y, size) {
    const style = this.iconStyle();
    const halo = { ...style, strokeWidth: style.strokeWidth * 2.6, knockout: 'none' };
    return `<g opacity=".22">${weatherIcon(condition, isDay, x, y, size, halo)}</g>${weatherIcon(condition, isDay, x, y, size, style)}`;
  }

  now(view) {
    const { sub } = this.palette(view);
    const temp = fit(this.fonts.big, view.temp, 130, 42, 22);
    const big = (fill, dx, dy) => text(this.fonts.big, temp.text, 72 + dx, 93 + dy, temp.size, { anchor: 'middle', fill });
    return this.icon(view, view.condition, view.isDay, 48, 5, 48)
      + big(PINK, -2, 2) + big(CYAN, 0, 0)
      + this.label(view, String(view.city).toUpperCase(), 72, 128, 130, 14, { anchor: 'middle', minSize: 9, fill: sub });
  }

  forecast(view) {
    const { sub } = this.palette(view);
    const centers = [25, 72, 119];
    let out = '';
    view.days.slice(0, 3).forEach((day, i) => {
      const x = centers[i];
      out += this.label(view, day.label, x, 22, 44, 12, { anchor: 'middle', minSize: 9, fill: sub });
      out += this.icon(view, day.condition, true, x - 19, 28, 38);
      out += this.label(view, day.max, x, 88, 44, 17, { anchor: 'middle', minSize: 10, fill: CYAN });
      out += this.label(view, day.min, x, 108, 44, 14, { anchor: 'middle', minSize: 10, fill: sub });
      out += this.label(view, day.rain, x, 130, 44, 11, { anchor: 'middle', minSize: 9, fill: AMBER });
    });
    return out;
  }
}
