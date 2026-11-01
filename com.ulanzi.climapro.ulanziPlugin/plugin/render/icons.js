// Weather drawings on a 64x64 grid, painted differently by each theme. They are our own
// artwork: WeatherAPI.com's terms restrict using its graphics separately.

const CLOUD = 'M17 50A11.5 11.5 0 0 1 14.6 27.3 15.5 15.5 0 0 1 43.6 22.8 13.8 13.8 0 0 1 48 50Z';
const MOON = 'M41 9.5A22.5 22.5 0 1 0 55 41.5 18.5 18.5 0 0 1 41 9.5Z';
const BOLT = 'M35 36 25 51h8l-4 12 13-17h-8l5-10Z';
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
  const rad = (angle * Math.PI) / 180;
  const point = (r) => `${(32 + r * Math.cos(rad)).toFixed(1)} ${(32 + r * Math.sin(rad)).toFixed(1)}`;
  return `M${point(20)}L${point(27)}`;
}).join('');

const at = (x, y, scale, body) => `<g transform="translate(${x} ${y}) scale(${scale})">${body}</g>`;

function painter(style) {
  const { colors: c, mode } = style;
  const sw = style.strokeWidth ?? 3.5;
  const line = `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const outlined = mode === 'stroke';
  const knockout = style.knockout ?? 'none';

  const shape = (d, color) => (outlined
    ? `<path d="${d}" fill="${knockout}" stroke="${color}" ${line}/>`
    : `<path d="${d}" fill="${color}"${knockout !== 'none' ? ` stroke="${knockout}" stroke-width="2.5"` : ''}/>`);

  return {
    sun() {
      const core = outlined
        ? `<circle cx="32" cy="32" r="13" fill="${knockout}" stroke="${c.sun}" ${line}/>`
        : `<circle cx="32" cy="32" r="14" fill="${c.sun}"/>`;
      return `<path d="${RAYS}" fill="none" stroke="${c.ray ?? c.sun}" ${line}/>${core}`;
    },
    moon: () => shape(MOON, c.moon),
    star: (x, y, r) => `<path d="M${x} ${y - r}L${x + r * 0.28} ${y - r * 0.28} ${x + r} ${y} ${x + r * 0.28} ${y + r * 0.28} ${x} ${y + r} ${x - r * 0.28} ${y + r * 0.28} ${x - r} ${y} ${x - r * 0.28} ${y - r * 0.28}Z" fill="${c.star ?? c.moon}"/>`,
    cloud: (tone = 'cloud') => shape(CLOUD, c[tone] ?? c.cloud),
    drops: (points, length = 7) => `<path d="${points.map(([x, y]) => `M${x} ${y}l${-length * 0.4} ${length}`).join('')}" fill="none" stroke="${c.drop}" ${line}/>`,
    flakes(points) {
      if (!outlined) return points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.3" fill="${c.flake}"/>`).join('');
      const r = 3.6;
      const d = points.map(([x, y]) => `M${x - r} ${y}h${r * 2}M${x - r * 0.5} ${y - r * 0.87}l${r} ${r * 1.74}M${x - r * 0.5} ${y + r * 0.87}l${r} ${-r * 1.74}`).join('');
      return `<path d="${d}" fill="none" stroke="${c.flake}" stroke-width="${Math.min(sw, 2.2)}" stroke-linecap="round"/>`;
    },
    bolt: () => (outlined
      ? `<path d="${BOLT}" fill="${knockout}" stroke="${c.bolt}" stroke-width="${Math.min(sw, 2.6)}" stroke-linejoin="round"/>`
      : `<path d="${BOLT}" fill="${c.bolt}"/>`),
    bars: (rows, color) => `<path d="${rows.map(([x, y, w]) => `M${x} ${y}h${w}`).join('')}" fill="none" stroke="${color}" ${line}/>`,
    waves: (rows, color) => `<path d="${rows.map(([x, y]) => `M${x} ${y}q6-5 12 0t12 0 12 0`).join('')}" fill="none" stroke="${color}" ${line}/>`,
    dots: (points, color) => points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${color}"/>`).join(''),
  };
}

const RAINY_CLOUD = (p, tone) => at(0, -10, 1, p.cloud(tone));

const DRAWINGS = {
  clear: (p, isDay) => (isDay ? p.sun() : p.moon() + p.star(50, 15, 4.5) + p.star(58, 28, 3)),
  partly: (p, isDay) => at(25, -3, 0.62, isDay ? p.sun() : p.moon()) + at(-1, 9, 0.88, p.cloud()),
  cloudy: (p) => at(24, 1, 0.66, p.cloud('cloudBack')) + at(-1, 9, 0.88, p.cloud()),
  overcast: (p) => at(22, -3, 0.72, p.cloud('cloudDark')) + at(-1, 7, 0.92, p.cloud('cloudBack')),
  fog: (p, _isDay, c) => at(5, -11, 0.84, p.cloud()) + p.bars([[10, 44, 44], [5, 52, 42], [17, 60, 40]], c.fog ?? c.cloud),
  dust: (p, _isDay, c) => p.waves([[10, 18], [10, 32], [10, 46]], c.dust ?? c.cloud) + p.dots([[16, 57], [32, 60], [48, 56]], c.dust ?? c.cloud),
  drizzle: (p) => RAINY_CLOUD(p) + p.drops([[22, 47], [34, 47], [46, 47]], 6),
  rain: (p) => RAINY_CLOUD(p) + p.drops([[20, 46], [31, 46], [42, 46], [53, 46]], 11),
  heavyRain: (p) => RAINY_CLOUD(p, 'cloudDark') + p.drops([[15, 45], [25, 45], [35, 45], [45, 45], [55, 45]], 14),
  sleet: (p) => RAINY_CLOUD(p) + p.drops([[20, 46], [46, 46]], 11) + p.flakes([[32, 53]]),
  snow: (p) => RAINY_CLOUD(p) + p.flakes([[20, 50], [33, 56], [46, 50]]),
  heavySnow: (p) => RAINY_CLOUD(p, 'cloudBack') + p.flakes([[14, 48], [27, 48], [40, 48], [53, 48], [20, 58], [33, 58], [46, 58]]),
  thunder: (p) => at(0, -11, 1, p.cloud('cloudDark')) + p.bolt() + p.drops([[20, 44], [51, 44]], 8),
};

/**
 * @param {string} condition one of CONDITIONS
 * @param {{mode: 'fill'|'stroke', colors: object, strokeWidth?: number, knockout?: string}} style
 */
export function weatherIcon(condition, isDay, x, y, size, style) {
  const draw = DRAWINGS[condition] ?? DRAWINGS.cloudy;
  const body = draw(painter(style), isDay, style.colors);
  return `<g transform="translate(${x} ${y}) scale(${size / 64})">${body}</g>`;
}

// Small interface glyphs on a 24x24 grid, always outlined.
const GLYPHS = {
  thermo: 'M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0Z',
  drop: 'M12 3s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12Z',
  wind: 'M3 9h10.5a2.75 2.75 0 1 0-2.6-3.6M3 14h15a3 3 0 1 1-2.8 4M3 19h7',
  umbrella: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9ZM12 12v6.5a2.5 2.5 0 0 1-5 0',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2 4.5 4.5 0 0 1 1.3 3.2ZM13.2 12.8 21 20.5M17 16.5l2.5-2.5',
  pin: 'M12 22s7-6.4 7-12a7 7 0 0 0-14 0c0 5.6 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  offline: 'M3 3l18 18M6.5 10.6A6 6 0 0 0 7 22h10M12.5 6a6 6 0 0 1 6 5.2A4.5 4.5 0 0 1 21 19',
  hourglass: 'M6 3h12M6 21h12M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9',
  alert: 'M12 3.5 22 20.5H2L12 3.5ZM12 10v5M12 18v.1',
};

export function glyph(name, x, y, size, color, strokeWidth = 2) {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})"><path d="${GLYPHS[name]}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
