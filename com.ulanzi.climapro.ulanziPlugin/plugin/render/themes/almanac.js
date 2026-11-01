import { Theme, SIZE } from '../theme.js';
import { weatherIcon } from '../icons.js';

const PAPER = '#F4ECD8';
const INK = '#2A2433';
const SEPIA = '#6B4F2E';
const OFFSET_TINT = '#D9B98C';

const inkColors = new Proxy({}, { get: () => INK });
const tintColors = new Proxy({}, { get: () => OFFSET_TINT });

export default class AlmanacTheme extends Theme {
  id = 'almanac';
  fonts = { big: 'fraunces-600', label: 'fraunces-600' };

  palette() {
    return { bg: PAPER, ink: INK, sub: SEPIA, accent: SEPIA };
  }

  iconStyle() {
    return { mode: 'stroke', strokeWidth: 2.8, knockout: PAPER, colors: inkColors };
  }

  background() {
    return `<rect width="${SIZE}" height="${SIZE}" fill="${PAPER}"/>`
      + `<rect x="4.5" y="4.5" width="135" height="135" fill="none" stroke="${INK}" stroke-width="1.5"/>`
      + `<rect x="8" y="8" width="128" height="128" fill="none" stroke="${INK}" stroke-width=".6"/>`;
  }

  // An offset tint behind the ink imitates the misregistered colour plate of old printing.
  icon(view, condition, isDay, x, y, size) {
    const style = this.iconStyle();
    const tint = { ...style, knockout: OFFSET_TINT, colors: tintColors };
    return weatherIcon(condition, isDay, x + 2, y + 2, size, tint) + weatherIcon(condition, isDay, x, y, size, style);
  }

  rule(y) {
    return `<path d="M16 ${y}H64M80 ${y}H128" stroke="${INK}" stroke-width=".8"/><path d="M72 ${y - 3}l3 3-3 3-3-3Z" fill="${INK}"/>`;
  }

  now(view) {
    const { sub } = this.palette(view);
    return this.label(view, view.city, 72, 30, 116, 17, { anchor: 'middle', minSize: 12 })
      + this.rule(38)
      + this.bigTemp(view, view.temp, 14, 90, 70, 44)
      + this.icon(view, view.condition, view.isDay, 86, 48, 46)
      + this.rule(104)
      + this.label(view, `${view.max} / ${view.min}`, 72, 126, 112, 19, { anchor: 'middle', fill: sub, minSize: 13 });
  }

  details(view) {
    const out = super.details(view);
    const rules = [42, 73, 104].map((y) => `<path d="M12 ${y}H132" stroke="${INK}" stroke-width=".5"/>`).join('');
    return rules + out;
  }

  // Narrower columns than the base layout, to stay inside the printed border.
  forecast(view) {
    const { sub, accent } = this.palette(view);
    const centers = [31, 72, 113];
    const column = 38;
    let out = '';
    view.days.slice(0, 3).forEach((day, i) => {
      const x = centers[i];
      out += this.label(view, day.label, x, 26, column, 14, { anchor: 'middle', minSize: 10, fill: sub });
      out += this.icon(view, day.condition, true, x - 17, 31, 34);
      out += this.label(view, day.max, x, 88, column, 19, { anchor: 'middle', minSize: 12 });
      out += this.label(view, day.min, x, 107, column, 15, { anchor: 'middle', minSize: 11, fill: sub });
      out += this.label(view, day.rain, x, 127, column, 13, { anchor: 'middle', minSize: 10, fill: accent });
    });
    return out;
  }

  staleMark() {
    return `<path d="M130 11l4 4-4 4-4-4Z" fill="${SEPIA}"/>`;
  }
}
