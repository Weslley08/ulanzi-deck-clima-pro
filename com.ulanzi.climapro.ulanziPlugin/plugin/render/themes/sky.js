import { Theme, SIZE } from '../theme.js';

// [top, bottom] per condition. White text must stay readable on both stops (see theme tests).
const DAY = {
  clear: ['#0E62C4', '#2E8BE0'],
  partly: ['#1A5FB0', '#4A8DD0'],
  cloudy: ['#3E5A7A', '#6F8BA8'],
  overcast: ['#3F4C5E', '#6B7888'],
  fog: ['#4E5A66', '#79858F'],
  dust: ['#7A5226', '#AB7A3A'],
  drizzle: ['#2F4C6E', '#56789B'],
  rain: ['#233C5A', '#456685'],
  heavyRain: ['#18293F', '#2F4A66'],
  sleet: ['#3A5570', '#64829E'],
  snow: ['#3D6C9C', '#6592BD'],
  heavySnow: ['#355F88', '#5B87B0'],
  thunder: ['#2A2448', '#4E4478'],
};
const NIGHT = {
  clear: ['#070D2B', '#232F66'],
  partly: ['#0D1438', '#333D6B'],
  cloudy: ['#191F30', '#3A4559'],
  overcast: ['#161A24', '#323844'],
  fog: ['#242A31', '#4A525B'],
  dust: ['#33261A', '#5C4830'],
  drizzle: ['#121B2E', '#2D3D57'],
  rain: ['#0F1726', '#26344A'],
  heavyRain: ['#0A101C', '#1D2838'],
  sleet: ['#162030', '#37485C'],
  snow: ['#1A2A42', '#42597A'],
  heavySnow: ['#16243A', '#3A4F6C'],
  thunder: ['#120E26', '#332C55'],
};

const STARS = [[18, 14, 1.2], [44, 9, 0.9], [66, 20, 1.3], [92, 8, 1], [118, 18, 1.1], [132, 42, 0.8], [104, 40, 0.9], [12, 44, 0.8], [58, 42, 0.7]];
const RAIN_STREAKS = [[10, 20], [34, 8], [58, 26], [82, 6], [106, 22], [128, 10], [22, 70], [50, 84], [78, 66], [120, 74], [14, 112], [66, 118], [100, 110]];
const SNOW_DOTS = [[12, 40], [34, 16], [60, 36], [88, 14], [112, 34], [132, 18], [24, 92], [52, 110], [20, 128], [70, 132]];

const FLAT = {
  sun: '#FFD24A',
  ray: '#FFE08A',
  moon: '#FFF1BF',
  star: '#FFF1BF',
  cloud: '#FFFFFF',
  cloudBack: '#D6E2EE',
  cloudDark: '#AEBDCB',
  drop: '#9FD8FF',
  flake: '#FFFFFF',
  bolt: '#FFD24A',
  fog: '#E7EDF2',
  dust: '#F6DFAF',
};

export default class SkyTheme extends Theme {
  id = 'sky';
  fonts = { big: 'outfit-700', label: 'outfit-500' };

  stops(view) {
    return (view.isDay ? DAY : NIGHT)[view.condition] ?? DAY.cloudy;
  }

  palette(view) {
    const [top] = this.stops(view);
    return { bg: top, ink: '#FFFFFF', sub: '#FFFFFF', accent: '#FFFFFF' };
  }

  iconStyle() {
    return { mode: 'fill', colors: FLAT };
  }

  background(view) {
    const [top, bottom] = this.stops(view);
    let out = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
    const glowing = view.screen === 'now' && view.isDay && (view.condition === 'clear' || view.condition === 'partly');
    if (glowing) out += '<radialGradient id="glow"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".55"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>';
    out += `</defs><rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>`;
    if (glowing) out += '<circle cx="110" cy="106" r="58" fill="url(#glow)"/>';
    if (!view.isDay && (view.condition === 'clear' || view.condition === 'partly')) {
      out += STARS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".7"/>`).join('');
    }
    if (['drizzle', 'rain', 'heavyRain', 'thunder', 'sleet'].includes(view.condition)) {
      const d = RAIN_STREAKS.map(([x, y]) => `M${x} ${y}l-5 14`).join('');
      out += `<path d="${d}" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".13" fill="none"/>`;
    }
    if (view.condition === 'snow' || view.condition === 'heavySnow') {
      out += SNOW_DOTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#fff" opacity=".28"/>`).join('');
    }
    return out;
  }

  now(view) {
    return this.label(view, view.city, 11, 24, 122, 17, { minSize: 12 })
      + this.bigTemp(view, view.temp, 9, 81, 108, 60)
      + this.icon(view, view.condition, view.isDay, 78, 76, 62)
      + this.detailGlyph(view, 'thermo', 8, 97, 18) + this.label(view, view.feels, 28, 112, 50, 18, { minSize: 12 })
      + this.detailGlyph(view, 'drop', 8, 118, 18) + this.label(view, `${view.humidity}%`, 28, 133, 50, 18, { minSize: 12 });
  }
}
