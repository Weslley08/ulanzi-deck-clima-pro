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

const ALERT_PAGE = {
  screen: 'alertPage',
  severity: 'EXTREME',
  title: 'CHUVAS INTENSAS',
  description: 'Alerta em Ivolândia de risco ALTO de alagamentos e enxurradas.',
  until: '22:00',
  index: 0,
  total: 2,
  temp: '27°',
  city: 'Ivolândia',
};

for (const theme of THEME_IDS) {
  test(`${theme}: with no alert, the face is exactly what it was`, async () => {
    for (const screen of ['now', 'details']) {
      const view = sampleView(theme, screen);
      assert.equal(await faceSvg(view), getTheme(theme).render(view));
      assert.ok(!(await faceSvg(view)).includes('stroke-opacity=".45"'));
    }
  });

  test(`${theme}: a banner keeps the whole forecast, only smaller, and every state renders`, async () => {
    for (const screen of ['now', 'details']) {
      const view = sampleView(theme, screen);
      const forecast = getTheme(theme).body(view);
      for (const severity of ['SEVERE', 'EXTREME']) {
        const svg = await faceSvg({ ...view, alert: { severity, pulse: 0, uncertain: false } });
        assert.ok(svg.includes(forecast), `${severity}: every part of the forecast is drawn, untouched`);
        const [, scale] = svg.match(/scale\((0\.\d+)\)">/);
        assert.ok(Number(scale) >= 0.84, `${severity}: still readable at ${scale}`);
        assert.deepEqual(pngSize(await svgToPng(svg)), [SIZE, SIZE]);
      }
    }
  });

  test(`${theme}: a small mark leaves the forecast at full size and in place`, async () => {
    const view = sampleView(theme, 'now');
    for (const alert of [{ severity: 'MODERATE', pulse: 0, uncertain: false }, { severity: 'UNKNOWN', pulse: 0, uncertain: false }, { severity: null, pulse: 0, uncertain: true }]) {
      const svg = await faceSvg({ ...view, alert });
      assert.ok(svg.includes(`${getTheme(theme).background(view)}${getTheme(theme).body(view)}`));
      await svgToPng(svg);
    }
  });

  test(`${theme}: a stale forecast and an error screen can both carry an alert`, async () => {
    const alert = { severity: 'EXTREME', pulse: 2, uncertain: true };
    await svgToPng(await faceSvg({ ...sampleView(theme, 'now'), stale: true, alert }));
    await svgToPng(await faceSvg({ ...sampleMessage(theme), alert }));
  });

  test(`${theme}: the alert page renders, with text from the feed unable to inject markup`, async () => {
    const svg = await faceSvg({
      ...ALERT_PAGE,
      theme,
      title: '"/><image href="http://evil.example/x.png"/>',
      description: '<script>alert(1)</script> &lt;b&gt; '.repeat(40),
      city: '"><script>',
    });
    assert.ok(!svg.includes('evil.example'));
    assert.ok(!svg.includes('<script'));
    assert.ok(!svg.includes('<image'));
    assert.deepEqual(pngSize(await svgToPng(svg)), [SIZE, SIZE]);
  });
}

test('severe and extreme look different, and neither depends on color alone', async () => {
  const view = sampleView('sky');
  const severe = await faceSvg({ ...view, alert: { severity: 'SEVERE', pulse: 0, uncertain: false } });
  const extreme = await faceSvg({ ...view, alert: { severity: 'EXTREME', pulse: 0, uncertain: false } });
  const withoutColors = (svg) => svg.replace(/#[0-9A-Fa-f]{6}/g, '');
  assert.notEqual(withoutColors(severe), withoutColors(extreme), 'someone who cannot tell the colors apart still sees a difference');
});

test('the extreme pulse changes only the color of the frame', async () => {
  const view = sampleView('sky');
  const frames = await Promise.all([0, 1, 2].map((pulse) => faceSvg({ ...view, alert: { severity: 'EXTREME', pulse, uncertain: false } })));
  assert.equal(new Set(frames).size, 3, 'bright, middle and dim');
  const withoutFrameColor = frames.map((svg) => svg.replace(/stroke="#(FF2A2A|DE1F1F|B01414)"/, 'stroke="frame"'));
  assert.equal(new Set(withoutFrameColor).size, 1);
});

test('the alert page shows the position only when there is more than one', async () => {
  const single = await faceSvg({ ...ALERT_PAGE, theme: 'sky', total: 1 });
  const several = await faceSvg({ ...ALERT_PAGE, theme: 'sky' });
  assert.ok(several.length > single.length);
});

test('each animation step reuses one render', async () => {
  const view = { ...sampleView('sky'), alert: { severity: 'EXTREME', pulse: 1, uncertain: false } };
  assert.equal(await renderFace(view), await renderFace({ ...view }));
});

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
