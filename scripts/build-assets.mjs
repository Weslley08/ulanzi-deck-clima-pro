// Regenerates every image derived from the themes, so previews never drift from the real
// faces: theme thumbnails, plugin icons, store banners and the sheet in the README.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleMessage, sampleView } from './lib/samples.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = join(root, 'com.ulanzi.climapro.ulanziPlugin');
const render = `${pluginDir.replaceAll('\\', '/')}/plugin/render`;
const toUrl = (p) => `file:///${p.replace(/^\//, '')}`;
const { faceSvg, svgToPng } = await import(toUrl(`${render}/renderer.js`));
const { THEME_IDS } = await import(toUrl(`${render}/themes/index.js`));
const { loadFont, text } = await import(toUrl(`${render}/text.js`));
const { weatherIcon } = await import(toUrl(`${render}/icons.js`));

function save(path, bytes) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

const plugin = (rel) => join('com.ulanzi.climapro.ulanziPlugin', rel);

async function facePng(view, width) {
  return svgToPng(await faceSvg(view), width);
}

const dataUri = (png) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

// Faces become embedded images in composites: nested SVGs would collide on gradient ids.
function placed(png, x, y, size, radius = size * 0.14) {
  const clip = `c${Math.round(x)}_${Math.round(y)}`;
  return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}"/></clipPath>`
    + `<image href="${dataUri(png)}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#${clip})"/>`;
}

const SHEET_COLUMNS = [
  (t) => sampleView(t, 'now'),
  (t) => sampleView(t, 'now', { city: 'Rio de Janeiro', condition: 'rain', isDay: false, tempC: 19, feelsLikeC: 18, humidity: 94 }),
  (t) => sampleView(t, 'now', { city: 'Reykjavík', condition: 'snow', tempC: -6, feelsLikeC: -11, humidity: 100 }),
  (t) => sampleView(t, 'details'),
  (t) => sampleMessage(t),
];

async function themeSheet() {
  const face = 216;
  const gap = 20;
  const width = SHEET_COLUMNS.length * (face + gap) + gap;
  const height = THEME_IDS.length * (face + gap) + gap;
  let body = '';
  for (const [row, theme] of THEME_IDS.entries()) {
    for (const [col, build] of SHEET_COLUMNS.entries()) {
      const png = await facePng(build(theme), face);
      body += placed(png, gap + col * (face + gap), gap + row * (face + gap), face);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#17181B"/>${body}</svg>`;
  save('docs/themes.png', await svgToPng(svg, width));
}

const withAlertOf = (severity, pulse = 0, uncertain = false) => (view) => ({ ...view, alert: { severity, pulse, uncertain } });
const ALERT_SAMPLE = {
  severity: 'EXTREME',
  title: 'CHUVAS INTENSAS',
  description: 'Alerta em Ivolândia de risco ALTO de alagamentos e enxurradas.',
  until: '22:00',
  index: 0,
  total: 2,
  temp: '27°',
  city: 'Ivolândia',
};
const ALERT_COLUMNS = [
  (t) => sampleView(t, 'now'),
  (t) => withAlertOf('SEVERE')(sampleView(t, 'now')),
  (t) => withAlertOf('EXTREME')(sampleView(t, 'now')),
  (t) => withAlertOf('EXTREME')(sampleView(t, 'details')),
  (t) => withAlertOf('MODERATE')(sampleView(t, 'now')),
  (t) => withAlertOf(null, 0, true)(sampleView(t, 'now')),
  (t) => ({ theme: t, screen: 'alertPage', ...ALERT_SAMPLE }),
];

// What a key looks like in each alert state, on every theme.
async function alertSheet() {
  const face = 216;
  const gap = 20;
  const width = ALERT_COLUMNS.length * (face + gap) + gap;
  const height = THEME_IDS.length * (face + gap) + gap;
  let body = '';
  for (const [row, theme] of THEME_IDS.entries()) {
    for (const [col, build] of ALERT_COLUMNS.entries()) {
      body += placed(await facePng(build(theme), face), gap + col * (face + gap), gap + row * (face + gap), face);
    }
  }
  save('docs/alerts.png', await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#17181B"/>${body}</svg>`, width));
}

async function thumbnails() {
  for (const theme of THEME_IDS) {
    save(plugin(`resources/themes/${theme}.png`), await facePng(sampleView(theme, 'now'), 144));
  }
}

const ICON_COLORS = {
  sun: '#FFD24A', ray: '#FFE08A', moon: '#FFF1BF', star: '#FFF1BF', cloud: '#FFFFFF', cloudBack: '#D6E2EE',
  cloudDark: '#AEBDCB', drop: '#9FD8FF', flake: '#FFFFFF', bolt: '#FFD24A', fog: '#E7EDF2', dust: '#F6DFAF',
};

// Neutral art with no numbers: this shows before any data has loaded.
function brandSvg(size, rounded) {
  const icon = weatherIcon('partly', true, 0, 0, 64, { mode: 'fill', colors: ICON_COLORS });
  const corner = rounded ? ` rx="${size * 0.18}"` : '';
  const scale = (size * 0.72) / 64;
  const offset = size * 0.14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E62C4"/><stop offset="1" stop-color="#2E8BE0"/></linearGradient></defs>'
    + `<rect width="${size}" height="${size}" fill="url(#b)"${corner}/>`
    + `<g transform="translate(${offset} ${offset}) scale(${scale})">${icon}</g></svg>`;
}

async function icons() {
  save(plugin('resources/plugin-icon.png'), await svgToPng(brandSvg(196, false), 196));
  save(plugin('resources/plugin-icon@2x.png'), await svgToPng(brandSvg(196, false), 392));
  save(plugin('resources/key-default.png'), await svgToPng(brandSvg(144, false), 144));
  save(plugin('resources/key-default@2x.png'), await svgToPng(brandSvg(144, false), 288));

  const listIcon = (color) => '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">'
    + `<circle cx="13.5" cy="6.5" r="2.5" stroke="${color}" stroke-width="1.4"/>`
    + `<path d="M13.5 1.5v1M18.5 6.5h-1M17 3l-.7.7" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
    + `<path d="M5.5 17a3.5 3.5 0 0 1-.4-7A4.8 4.8 0 0 1 14.2 9.4 3.8 3.8 0 0 1 14 17Z" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" fill="#00000000"/></svg>\n`;
  save(plugin('resources/category.svg'), listIcon('#FFFFFF'));
  save(plugin('resources/action.svg'), listIcon('#A6A6A6'));
}

// Store art: the real faces on a dark stage.
async function storeArt(width, height, { title, subtitle, columns }) {
  await loadFont('outfit-500');
  const rows = Math.ceil(THEME_IDS.length / columns);
  const titleSize = height * 0.1;
  const subtitleSize = height * 0.042;
  const header = height * 0.27;
  const gap = height * 0.03;
  const face = Math.min(
    (height - header - gap * (rows + 1)) / rows,
    (width - gap * (columns + 1)) / columns,
  );
  const gridWidth = columns * face + (columns - 1) * gap;
  const left = (width - gridWidth) / 2;
  let body = text('outfit-500', title, width / 2, height * 0.135, titleSize, { anchor: 'middle', fill: '#FFFFFF' })
    + text('outfit-500', subtitle, width / 2, height * 0.205, subtitleSize, { anchor: 'middle', fill: '#B9BEC7' });
  for (const [i, theme] of THEME_IDS.entries()) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const png = await facePng(sampleView(theme, 'now'), Math.round(face));
    body += placed(png, left + col * (face + gap), header + gap + row * (face + gap), face);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#14161B"/>${body}</svg>`;
  return svgToPng(svg, width);
}

async function store() {
  const copy = { title: 'Clima Pro', subtitle: 'Live weather on your keys, in the style you choose' };
  save(plugin('assets/banners/banner-1.png'), await storeArt(1098, 732, { ...copy, columns: 3 }));
  save('store/cover-2x1.png', await storeArt(1200, 600, { ...copy, columns: 6 }));
  save('store/cover-1x1.png', await svgToPng(brandSvg(800, false), 800));
}

const only = process.argv[2];
if (only === 'sheet') {
  await themeSheet();
  await alertSheet();
} else {
  await themeSheet();
  await alertSheet();
  await thumbnails();
  await icons();
  await store();
}
console.log('assets written');
