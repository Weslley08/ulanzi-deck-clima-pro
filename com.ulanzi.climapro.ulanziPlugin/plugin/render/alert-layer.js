// Draws Defesa Civil alerts on a key. The forecast always stays: for a banner, the whole forecast
// shrinks into the space above it at its own proportions, so no theme has to leave room and nothing
// gets covered. A face with no alert never comes through here, so it stays exactly as it was.
import { fit, measure, text, wrap } from './text.js';
import { SIZE } from './theme.js';

export const ALERT_PAGE = 'alertPage';
export const ALERT_FONT = 'outfit-500';

// CAP's own words translated, not the levels of the Portaria: the feed does not say how they map.
export const ALERT_LABELS = { EXTREME: 'EXTREMO', SEVERE: 'SEVERO', MODERATE: 'MODERADO', MINOR: 'MENOR', UNKNOWN: 'SEM NÍVEL' };
const COLORS = {
  EXTREME: { fill: '#D01010', ink: '#FFFFFF' },
  SEVERE: { fill: '#FF8A00', ink: '#1A1000' },
  MODERATE: { fill: '#FFD02E', ink: '#1A1400' },
  MINOR: { fill: '#FFD02E', ink: '#1A1400' },
  UNKNOWN: { fill: '#FFD02E', ink: '#1A1400' },
};
// Going through a middle red reads as a slow glow instead of a flash.
const EXTREME_FRAME_COLORS = ['#FF2A2A', '#DE1F1F', '#B01414'];

const BAND_HEIGHT = 18;
const FRAME_WIDTH = { EXTREME: 4, SEVERE: 2.5 };
const BAND_TEXT_MAX = 12;
const BAND_TEXT_MIN = 9;
const PAGE_LINES = 4;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${body}</svg>`;

function warningSign(x, y, size, { fill, ink, outline = '#000000' }) {
  const body = `<path d="M12 2.5 23 21.5H1Z" fill="${fill}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M12 9v6.5M12 18.6v.1" fill="none" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y}) scale(${size / 24})">${body}</g>`;
}

/** A hollow sign says the check is not getting through, so an empty corner cannot be read as "no alerts". */
function uncertainMark() {
  return '<g transform="translate(2 2) scale(.46)"><path d="M12 2.5 23 21.5H1Z" fill="#000000" fill-opacity=".55" stroke="#C9CDD2" stroke-width="3" stroke-linejoin="round"/></g>';
}

function banner(severity, label) {
  const { fill, ink } = COLORS[severity];
  const top = SIZE - BAND_HEIGHT;
  const iconSize = 13;
  const textX = 4 + iconSize + 3;
  const fitted = fit(ALERT_FONT, label, SIZE - textX - 4, BAND_TEXT_MAX, BAND_TEXT_MIN);
  return `<rect y="${top}" width="${SIZE}" height="${BAND_HEIGHT}" fill="${fill}"/>`
    + warningSign(4, top + 2.5, iconSize, { fill: ink, ink: fill, outline: ink })
    + text(ALERT_FONT, fitted.text, textX, top + 13, fitted.size, { fill: ink });
}

function frame(severity, pulse) {
  const width = FRAME_WIDTH[severity];
  const color = severity === 'EXTREME' ? EXTREME_FRAME_COLORS[pulse] : COLORS[severity].fill;
  const bottom = SIZE - BAND_HEIGHT;
  // Drawn in three sides because the band is the fourth. The dark edge keeps it visible on a theme of the same color.
  const sides = `M${width / 2} ${bottom}V${width / 2}H${SIZE - width / 2}V${bottom}`;
  return `<path d="${sides}" fill="none" stroke="#000000" stroke-opacity=".45" stroke-width="${width + 2}"/>`
    + `<path d="${sides}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

function withBanner(theme, view) {
  const { severity, pulse, uncertain } = view.alert;
  const width = FRAME_WIDTH[severity];
  const scale = (SIZE - BAND_HEIGHT - width) / SIZE;
  const left = (SIZE - SIZE * scale) / 2;
  return theme.background(view)
    + `<g transform="translate(${left} ${width}) scale(${scale})">${theme.body(view)}</g>`
    + frame(severity, pulse)
    + banner(severity, `DEFESA CIVIL — ${ALERT_LABELS[severity]}`)
    + (uncertain ? uncertainMark() : '');
}

function withCornerMark(theme, view) {
  const { severity, uncertain } = view.alert;
  const mark = severity ? warningSign(1, 0, 12, COLORS[severity]) : '';
  return theme.background(view) + theme.body(view) + mark + (uncertain && !severity ? uncertainMark() : '');
}

/** Long text is cut on the key because the settings panel always has all of it. */
function pageLines(description, width, size) {
  const lines = wrap(ALERT_FONT, description, width, size);
  if (lines.length <= PAGE_LINES) return lines;
  const kept = lines.slice(0, PAGE_LINES);
  const last = `${kept[PAGE_LINES - 1]} ${lines[PAGE_LINES]}`;
  kept[PAGE_LINES - 1] = fit(ALERT_FONT, last, width, size).text;
  return kept;
}

function alertPage(view) {
  const { fill, ink } = COLORS[view.severity] ?? COLORS.UNKNOWN;
  let out = `<rect width="${SIZE}" height="${SIZE}" fill="#14171C"/>`
    + `<rect width="${SIZE}" height="26" fill="${fill}"/>`
    + warningSign(5, 3, 20, { fill: ink, ink: fill, outline: ink });
  const counter = view.total > 1 ? `${view.index + 1}/${view.total}` : '';
  const counterWidth = counter ? measure(ALERT_FONT, counter, 12) + 8 : 0;
  const label = fit(ALERT_FONT, ALERT_LABELS[view.severity] ?? ALERT_LABELS.UNKNOWN, SIZE - 30 - counterWidth - 5, 15, 11);
  out += text(ALERT_FONT, label.text, 30, 18.5, label.size, { fill: ink });
  if (counter) out += text(ALERT_FONT, counter, SIZE - 6, 18, 12, { anchor: 'end', fill: ink });

  const title = fit(ALERT_FONT, view.title, SIZE - 12, 13, 10);
  out += text(ALERT_FONT, title.text, 6, 41, title.size, { fill: '#FFFFFF' });
  pageLines(view.description, SIZE - 12, 11.5).forEach((line, i) => {
    out += text(ALERT_FONT, line, 6, 55 + i * 13.5, 11.5, { fill: '#D6DAE0' });
  });
  if (view.until) {
    const until = fit(ALERT_FONT, `Até ${view.until}`, SIZE - 12, 12, 10);
    out += text(ALERT_FONT, until.text, 6, 117, until.size, { fill: '#FFFFFF' });
  }
  // The forecast stays on this page too, even though the user chose to open it.
  out += `<rect y="${SIZE - 20}" width="${SIZE}" height="20" fill="#000000"/>`;
  const forecast = fit(ALERT_FONT, [view.temp, view.city].filter(Boolean).join(' · '), SIZE - 12, 13, 10);
  if (forecast.text) out += text(ALERT_FONT, forecast.text, SIZE / 2, SIZE - 6, forecast.size, { anchor: 'middle', fill: '#FFFFFF' });
  return out;
}

/** Returns the whole key image, or null for a face with nothing to add, which then draws as usual. */
export function alertFace(theme, view) {
  if (view.screen === ALERT_PAGE) return svg(alertPage(view));
  if (!view.alert) return null;
  return svg(FRAME_WIDTH[view.alert.severity] ? withBanner(theme, view) : withCornerMark(theme, view));
}
