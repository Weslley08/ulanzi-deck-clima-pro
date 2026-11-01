import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleMessage, sampleView } from '../scripts/lib/samples.mjs';
import { faceSvg, renderFace, svgToPng } from '../com.ulanzi.climapro.ulanziPlugin/plugin/render/renderer.js';
import { DEFAULT_THEME, THEME_IDS, getTheme } from '../com.ulanzi.climapro.ulanziPlugin/plugin/render/themes/index.js';
import { CONDITIONS } from '../com.ulanzi.climapro.ulanziPlugin/plugin/conditions.js';
import { buildWeatherView } from '../com.ulanzi.climapro.ulanziPlugin/plugin/view.js';
import { SIZE } from '../com.ulanzi.climapro.ulanziPlugin/plugin/render/theme.js';

const pngSize = (bytes) => {
  const data = Buffer.from(bytes);
  assert.equal(data.toString('latin1', 1, 4), 'PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

test('there are themes to choose from and the first is the default', () => {
  assert.ok(THEME_IDS.length >= 2);
  assert.equal(DEFAULT_THEME, THEME_IDS[0]);
  assert.equal(getTheme('does-not-exist').id, DEFAULT_THEME);
});

for (const theme of THEME_IDS) {
  test(`${theme}: every screen renders to a key-sized PNG`, async () => {
    for (const screen of ['now', 'details']) {
      const png = await svgToPng(await faceSvg(sampleView(theme, screen)));
      assert.deepEqual(pngSize(png), [SIZE, SIZE], screen);
    }
    assert.deepEqual(pngSize(await svgToPng(await faceSvg(sampleMessage(theme)))), [SIZE, SIZE]);
  });

  test(`${theme}: every condition draws, by day and by night`, async () => {
    for (const condition of CONDITIONS) {
      for (const isDay of [true, false]) {
        const svg = await faceSvg(sampleView(theme, 'now', { condition, isDay }));
        assert.ok(!svg.includes('undefined'), `${condition} ${isDay}`);
        assert.ok(!svg.includes('NaN'), `${condition} ${isDay}`);
      }
    }
  });

  test(`${theme}: missing data shows dashes instead of breaking`, async () => {
    const weather = {
      location: { name: '' },
      current: { condition: 'cloudy', isDay: true },
    };
    for (const screen of ['now', 'details']) {
      const svg = await faceSvg(buildWeatherView(weather, { theme, unit: 'c' }, screen));
      assert.ok(!svg.includes('undefined'), screen);
      assert.ok(!svg.includes('NaN'), screen);
      await svgToPng(svg);
    }
  });

  test(`${theme}: text from the API can never inject markup`, async () => {
    const city = '"/><image href="http://evil.example/x.png"/><script>alert(1)</script>';
    const svg = await faceSvg(sampleView(theme, 'now', { city }));
    assert.ok(!svg.includes('evil.example'));
    assert.ok(!svg.includes('<script'));
    assert.ok(!svg.includes('<image'));
  });

  test(`${theme}: very long names and extreme values still render`, async () => {
    const svg = await faceSvg(sampleView(theme, 'now', { city: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', tempC: -40, feelsLikeC: -55, humidity: 100 }));
    await svgToPng(svg);
    const hot = await faceSvg(sampleView(theme, 'details', { tempC: 50, feelsLikeC: 58, windKph: 212, humidity: 100, precipMm: 123.4 }));
    await svgToPng(hot);
  });
}

test('the stale mark changes the face', async () => {
  const fresh = sampleView('sky');
  assert.notEqual(await faceSvg({ ...fresh, stale: true }), await faceSvg(fresh));
});

test('Fahrenheit converts the numbers and the wind unit', () => {
  const view = sampleView('sky', 'details', { tempC: 0, feelsLikeC: 0 }, { unit: 'f' });
  assert.equal(view.temp, '32°');
  assert.equal(view.windUnit, 'mph');
});

test('negative temperatures use a real minus sign', () => {
  assert.equal(sampleView('sky', 'now', { tempC: -6 }).temp, '−6°');
});

test('precipitation keeps the fractions that matter, in the chosen unit', () => {
  assert.equal(sampleView('sky', 'details', { precipMm: 0.4 }).precip, '0.4');
  assert.equal(sampleView('sky', 'details', { precipMm: 0.4 }).precipUnit, 'mm');
  assert.equal(sampleView('sky', 'details', { precipMm: 0 }).precip, '0');
  const imperial = sampleView('sky', 'details', { precipMm: 2.54 }, { unit: 'f' });
  assert.equal(imperial.precip, '0.1');
  assert.equal(imperial.precipUnit, 'in');
});

test('the key image is a full data URI, or the device ignores it', async () => {
  const uri = await renderFace(sampleView('minimal'));
  assert.match(uri, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
});

test('identical faces reuse one render', async () => {
  const view = sampleView('minimal', 'details');
  assert.equal(await renderFace(view), await renderFace({ ...view }));
});
