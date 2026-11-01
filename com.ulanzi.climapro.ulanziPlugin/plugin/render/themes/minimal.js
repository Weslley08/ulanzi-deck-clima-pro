import { Theme } from '../theme.js';

const INK = '#FFFFFF';

export default class MinimalTheme extends Theme {
  id = 'minimal';
  fonts = { big: 'outfit-300', label: 'outfit-500' };

  palette() {
    return { bg: '#000000', ink: INK, sub: '#A3A3A3', accent: '#D4D4D4' };
  }

  iconStyle() {
    const colors = Object.fromEntries(['sun', 'ray', 'moon', 'star', 'cloud', 'cloudBack', 'cloudDark', 'drop', 'flake', 'bolt', 'fog', 'dust'].map((part) => [part, INK]));
    return { mode: 'stroke', strokeWidth: 3, knockout: '#000000', colors };
  }

  now(view) {
    const { sub } = this.palette(view);
    return this.icon(view, view.condition, view.isDay, 50, 7, 44)
      + this.bigTemp(view, view.temp, 72, 106, 132, 62, { anchor: 'middle' })
      + this.label(view, view.city, 72, 132, 128, 15, { anchor: 'middle', fill: sub, minSize: 12 });
  }
}
