import { fit, measure, text, wrap } from './text.js';
import { glyph, weatherIcon } from './icons.js';

export const SIZE = 144;

/**
 * Base class for key faces. A theme only needs `fonts`, `palette(view)` and `iconStyle(view)`;
 * every layout below can be overridden. See CONTRIBUTING.md for how to add one.
 *
 * Palette tokens: ink (main text), sub (secondary text) and accent.
 */
export class Theme {
  /** @type {string} */ id;
  /** @type {{big: string, label: string}} Font ids from scripts/build-glyphs.mjs. */ fonts;

  /** Fonts this theme needs loaded before it can draw. */
  fontIds() {
    return [...new Set(Object.values(this.fonts))];
  }

  render(view) {
    const body = this[view.screen]?.(view) ?? this.message(view);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${this.background(view)}${body}${view.stale ? this.staleMark(view) : ''}</svg>`;
  }

  background(view) {
    return `<rect width="${SIZE}" height="${SIZE}" fill="${this.palette(view).bg}"/>`;
  }

  icon(view, condition, isDay, x, y, size) {
    return weatherIcon(condition, isDay, x, y, size, this.iconStyle(view));
  }

  label(view, str, x, y, maxWidth, maxSize, { minSize = 11, anchor = 'start', fill, tracking = 0 } = {}) {
    const fitted = fit(this.fonts.label, str, maxWidth, maxSize, minSize, tracking);
    return text(this.fonts.label, fitted.text, x, y, fitted.size, { anchor, tracking, fill: fill ?? this.palette(view).ink });
  }

  bigTemp(view, value, x, y, maxWidth, maxSize, { anchor = 'start', fill, minSize = 20 } = {}) {
    const fitted = fit(this.fonts.big, value, maxWidth, maxSize, minSize);
    return text(this.fonts.big, fitted.text, x, y, fitted.size, { anchor, fill: fill ?? this.palette(view).ink });
  }

  /** Default "now" layout; most themes replace it to get their own composition. */
  now(view) {
    const pal = this.palette(view);
    return this.icon(view, view.condition, view.isDay, 44, 6, 56)
      + this.bigTemp(view, view.temp, 72, 106, 128, 46, { anchor: 'middle' })
      + this.label(view, view.city, 72, 130, 128, 15, { anchor: 'middle', fill: pal.sub });
  }

  detailRows(view) {
    return [
      ['thermo', view.feels, ''],
      ['drop', view.humidity, '%'],
      ['wind', view.wind, view.windUnit],
      ['umbrella', view.rainChance, '%'],
    ];
  }

  detailGlyph(view, name, x, y, size) {
    const pal = this.palette(view);
    return glyph(name, x, y, size, pal.accent ?? pal.ink, 2);
  }

  details(view) {
    const pal = this.palette(view);
    const font = this.fonts.label;
    const rowHeight = 31;
    const top = 11;
    let out = '';
    this.detailRows(view).forEach(([name, value, unit], row) => {
      const baseline = top + row * rowHeight + 22;
      out += this.detailGlyph(view, name, 11, top + row * rowHeight + 2, 23);
      const unitFit = unit ? fit(font, unit, 38, 13, 10) : null;
      const unitWidth = unitFit ? measure(font, unitFit.text, unitFit.size) + 4 : 0;
      out += this.label(view, value, 133 - unitWidth, baseline, 72, 25, { anchor: 'end', minSize: 16 });
      if (unitFit) out += text(font, unitFit.text, 133, baseline, unitFit.size, { anchor: 'end', fill: pal.sub });
    });
    return out;
  }

  forecast(view) {
    const pal = this.palette(view);
    const centers = [25, 72, 119];
    const column = 44;
    let out = '';
    view.days.slice(0, 3).forEach((day, i) => {
      const x = centers[i];
      out += this.label(view, day.label, x, 24, column, 14, { anchor: 'middle', minSize: 10, fill: pal.sub });
      out += this.icon(view, day.condition, true, x - 19, 30, 38);
      out += this.label(view, day.max, x, 92, column, 20, { anchor: 'middle', minSize: 12 });
      out += this.label(view, day.min, x, 112, column, 16, { anchor: 'middle', minSize: 11, fill: pal.sub });
      out += this.label(view, day.rain, x, 132, column, 13, { anchor: 'middle', minSize: 10, fill: pal.accent ?? pal.sub });
    });
    return out;
  }

  /** Setup, loading and error screens. */
  message(view) {
    const pal = this.palette(view);
    const size = this.messageSize;
    const lines = wrap(this.fonts.label, view.message ?? '', 120, size).slice(0, 3);
    const lineHeight = size + 3;
    const blockTop = 86 - ((lines.length - 1) * lineHeight) / 2;
    let out = view.glyph
      ? glyph(view.glyph, 54, blockTop - 56, 36, pal.accent ?? pal.ink, 1.8)
      : this.loadingDots(view, 72, blockTop - 34);
    lines.forEach((line, i) => {
      out += text(this.fonts.label, line, 72, blockTop + i * lineHeight, size, { anchor: 'middle', fill: pal.ink });
    });
    return out;
  }

  /** Text size on status screens; narrow or pixel fonts can raise or lower it. */
  get messageSize() {
    return 16;
  }

  loadingDots(view, x, y) {
    const { accent, ink } = this.palette(view);
    return [-14, 0, 14].map((dx) => `<circle cx="${x + dx}" cy="${y}" r="4.5" fill="${accent ?? ink}"/>`).join('');
  }

  /** Shown when refreshes are failing and the data on screen is getting old. */
  staleMark(view) {
    const { bg, accent, ink } = this.palette(view);
    return `<circle cx="134" cy="10" r="5" fill="${accent ?? ink}" stroke="${bg ?? '#000'}" stroke-width="1.5"/>`;
  }
}

/** Upward or downward triangle used next to the daily high and low. */
export function arrow(x, y, up, fill) {
  return up
    ? `<path d="M${x} ${y}l5.5-9 5.5 9Z" fill="${fill}"/>`
    : `<path d="M${x} ${y - 9}l5.5 9 5.5-9Z" fill="${fill}"/>`;
}
