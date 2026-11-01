import { Theme, SIZE } from '../theme.js';
import { fit, text } from '../text.js';
import { pixelGlyph, pixelIcon } from '../pixel-icons.js';

const BEZEL = '#262A22';
const SCREEN = '#AEBD9E';
const INK = '#161C12';
const SUB = '#2C3626';
const GHOST_OPACITY = 0.09;
const INSET = 5;

//    a
//  f   b
//    g
//  e   c
//    d
const DIGIT_SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g',
};

function segment(name, w, h, t) {
  const g = t * 0.18;
  const mid = h / 2;
  const horizontal = (y) => `M${g + t / 2} ${y}L${t + g} ${y - t / 2}H${w - t - g}L${w - g - t / 2} ${y}L${w - t - g} ${y + t / 2}H${t + g}Z`;
  const vertical = (x, y1, y2) => `M${x} ${y1 + g + t / 2}L${x + t / 2} ${y1 + t + g}V${y2 - t - g}L${x} ${y2 - g - t / 2}L${x - t / 2} ${y2 - t - g}V${y1 + t + g}Z`;
  switch (name) {
    case 'a': return horizontal(t / 2);
    case 'g': return horizontal(mid);
    case 'd': return horizontal(h - t / 2);
    case 'f': return vertical(t / 2, 0, mid);
    case 'b': return vertical(w - t / 2, 0, mid);
    case 'e': return vertical(t / 2, mid, h);
    default: return vertical(w - t / 2, mid, h);
  }
}

/** Draws seven-segment digits with the unlit "ghost" segments every real LCD shows. */
export function sevenSegment(value, rightX, y, height, cells = 2) {
  const chars = [...String(value)].filter((c) => DIGIT_SEGMENTS[c] !== undefined);
  const count = Math.max(cells, chars.length);
  const slots = [...Array(count - chars.length).fill(null), ...chars];
  const width = height * 0.55;
  const gap = height * 0.12;
  const thickness = height * 0.13;
  let lit = '';
  let ghost = '';
  slots.forEach((char, i) => {
    const x = rightX - (count - i) * (width + gap) + gap;
    const place = (name) => `<path transform="translate(${x.toFixed(1)} ${y})" d="${segment(name, width, height, thickness)}"/>`;
    for (const name of 'abcdefg') {
      if (char !== null && DIGIT_SEGMENTS[char].includes(name)) lit += place(name);
      else ghost += place(name);
    }
  });
  return `<g fill="${INK}" opacity="${GHOST_OPACITY}">${ghost}</g><g fill="${INK}">${lit}</g>`;
}

export default class LcdTheme extends Theme {
  id = 'lcd';
  fonts = { big: 'vt323-400', label: 'vt323-400' };

  palette() {
    return { bg: SCREEN, ink: INK, sub: SUB, accent: INK };
  }

  iconStyle() {
    return { mode: 'stroke', strokeWidth: 3.4, knockout: SCREEN, colors: new Proxy({}, { get: () => INK }) };
  }

  background() {
    return `<rect width="${SIZE}" height="${SIZE}" fill="${BEZEL}"/>`
      + `<rect x="${INSET}" y="${INSET}" width="${SIZE - INSET * 2}" height="${SIZE - INSET * 2}" rx="9" fill="${SCREEN}"/>`
      + `<rect x="${INSET + 1}" y="${INSET + 1}" width="${SIZE - INSET * 2 - 2}" height="${SIZE - INSET * 2 - 2}" rx="8" fill="none" stroke="${INK}" stroke-width="1" opacity=".18"/>`;
  }

  icon(view, condition, isDay, x, y, size) {
    const pixel = Math.max(1, Math.floor(size / 16));
    return pixelIcon(condition, isDay, x, y, pixel, INK);
  }

  label(view, str, x, y, maxWidth, maxSize, options = {}) {
    return super.label(view, String(str).toUpperCase(), x, y, maxWidth, maxSize, { minSize: 14, ...options });
  }

  now(view) {
    const unit = view.unit.toUpperCase();
    return this.icon(view, view.condition, view.isDay, 13, 12, 48)
      + this.label(view, `H ${view.max}`, 131, 30, 66, 24, { anchor: 'end' })
      + this.label(view, `L ${view.min}`, 131, 52, 66, 24, { anchor: 'end' })
      + sevenSegment(view.tempValue, 110, 63, 52)
      + this.label(view, `°${unit}`, 134, 84, 24, 22, { anchor: 'end' })
      + this.label(view, view.city, 72, 133, 122, 20, { anchor: 'middle' });
  }

  get messageSize() {
    return 22;
  }

  detailGlyph(view, name, x, y) {
    return pixelGlyph(name, x + 1, y + 1, 2, INK);
  }

  details(view) {
    const rowHeight = 30;
    const top = 11;
    const font = this.fonts.label;
    let out = '';
    this.detailRows(view).forEach(([name, value, unit], row) => {
      const baseline = top + row * rowHeight + 22;
      out += this.detailGlyph(view, name, 11, top + row * rowHeight);
      const fitted = fit(font, `${value}${unit ? ` ${unit.toUpperCase()}` : ''}`, 92, 30, 18);
      out += text(font, fitted.text, 133, baseline, fitted.size, { anchor: 'end', fill: INK });
    });
    return out;
  }

  forecast(view) {
    const centers = [27, 72, 117];
    let out = '';
    view.days.slice(0, 3).forEach((day, i) => {
      const x = centers[i];
      out += this.label(view, day.label, x, 25, 40, 20, { anchor: 'middle' });
      out += this.icon(view, day.condition, true, x - 16, 30, 32);
      out += this.label(view, day.max, x, 84, 40, 26, { anchor: 'middle' });
      out += this.label(view, day.min, x, 106, 40, 22, { anchor: 'middle', fill: SUB });
      out += this.label(view, day.rain, x, 128, 40, 20, { anchor: 'middle', fill: SUB });
    });
    return out;
  }

  staleMark() {
    return `<rect x="125" y="9" width="7" height="7" fill="${INK}"/>`;
  }
}
