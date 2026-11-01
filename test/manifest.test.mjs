// Contract between the manifest, the language files and the code. Mistakes here are silent in the host.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { THEME_IDS } from '../com.ulanzi.climapro.ulanziPlugin/plugin/render/themes/index.js';
import { SCREENS, normalizeApiKey, normalizeSettings, placeQuery } from '../com.ulanzi.climapro.ulanziPlugin/plugin/settings.js';

const pluginDir = fileURLToPath(new URL('../com.ulanzi.climapro.ulanziPlugin/', import.meta.url));
const read = (path) => readFileSync(join(pluginDir, path), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const inspectorHtml = read('property-inspector/weather/inspector.html');
const languages = readdirSync(pluginDir).filter((name) => /^[a-z]{2}(_[A-Z]{2})?\.json$/.test(name));

test('UUIDs follow the shape the SDK relies on', () => {
  assert.equal(manifest.UUID.split('.').length, 4);
  for (const action of manifest.Actions) {
    assert.ok(action.UUID.startsWith(`${manifest.UUID}.`));
    assert.ok(action.UUID.split('.').length > 4);
  }
});

test('the code and the manifest agree on the UUIDs', () => {
  const app = read('plugin/app.js');
  assert.ok(app.includes(`PLUGIN_UUID = '${manifest.UUID}'`));
  assert.equal(manifest.Actions[0].UUID, `${manifest.UUID}.weather`);
});

test('names respect the 30 character limit', () => {
  assert.ok(manifest.Category.length <= 30);
  for (const action of manifest.Actions) assert.ok(action.Name.length <= 30, action.Name);
});

test('every file the manifest points to exists', () => {
  const paths = [
    manifest.Icon,
    manifest.CategoryIcon,
    manifest.CodePath,
    ...manifest.Banner,
    ...manifest.Actions.flatMap((a) => [a.Icon, a.PropertyInspectorPath, ...a.States.map((s) => s.Image)]),
  ];
  for (const path of paths) assert.ok(existsSync(join(pluginDir, path)), path);
});

test('the key controls its own image, so the host must not toggle states', () => {
  for (const action of manifest.Actions) {
    assert.equal(action.DisableAutomaticStates, true);
    assert.equal(action.SupportedInMultiActions, false);
  }
});

test('the debug inspector port never ships', () => {
  assert.equal(manifest.Inspect, undefined);
});

test('the runtime version requirement uses the supported field', () => {
  assert.ok(manifest.Software.MinVersion);
  assert.equal(manifest.Software.MinimumVersion, undefined);
});

test('every file agrees on the version, because the release tag must match them all', () => {
  const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(manifest.Version, /^\d+\.\d+\.\d+$/);
  assert.equal(rootPackage.version, manifest.Version);
  assert.equal(JSON.parse(read('package.json')).version, manifest.Version);
});

test('the store text carries the disclaimer the WeatherAPI.com terms require', () => {
  const en = JSON.parse(read('en.json'));
  assert.ok(manifest.Detail.includes(en.Localization.disclaimer));
  assert.match(manifest.Detail, /WeatherAPI\.com/);
});

test('English is present so every other language has a fallback', () => {
  assert.ok(languages.includes('en.json'));
});

for (const file of languages) {
  test(`${file}: matches the manifest by position and has every string`, () => {
    const language = JSON.parse(read(file));
    const en = JSON.parse(read('en.json'));
    assert.equal(language.Actions.length, manifest.Actions.length);
    for (const action of language.Actions) assert.ok(action.Name.length <= 30, action.Name);
    assert.deepEqual(Object.keys(language.Localization).sort(), Object.keys(en.Localization).sort());
    for (const [key, value] of Object.entries(language.Localization)) assert.ok(value.trim(), key);
  });
}

test('the English file repeats the action name of the manifest', () => {
  const en = JSON.parse(read('en.json'));
  manifest.Actions.forEach((action, i) => assert.equal(en.Actions[i].Name, action.Name));
  assert.equal(en.Name, manifest.Name);
  assert.equal(en.Description, manifest.Description);
});

test('the inspector offers exactly the themes and screens the code accepts', () => {
  const values = (name) => [...inspectorHtml.matchAll(new RegExp(`name="${name}"[^>]*value="([^"]+)"`, 'g'))].map((m) => m[1]);
  assert.deepEqual(values('theme'), THEME_IDS);
  const selectValues = (name) => {
    const block = inspectorHtml.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`))[0];
    return [...block.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(selectValues('screen'), SCREENS);
  assert.deepEqual(selectValues('unit'), ['c', 'f']);
});

test('the inspector has a thumbnail for every theme', () => {
  for (const theme of THEME_IDS) assert.ok(existsSync(join(pluginDir, `resources/themes/${theme}.png`)), theme);
});

test('the API key field stays outside the per-key settings form', () => {
  const form = inspectorHtml.match(/<form[\s\S]*?<\/form>/)[0];
  assert.ok(!form.includes('apiKey'));
  assert.ok(inspectorHtml.includes('id="apiKey"'));
  assert.ok(inspectorHtml.includes('type="password"'));
});

test('the inspector credits the data source and shows the disclaimer', () => {
  assert.match(inspectorHtml, /WeatherAPI\.com/);
  assert.ok(inspectorHtml.includes(JSON.parse(read('en.json')).Localization.disclaimer));
});

test('every string marked in the inspector can be translated', () => {
  const en = JSON.parse(read('en.json')).Localization;
  const keys = new Set();
  for (const match of inspectorHtml.matchAll(/data-localize="([^"]+)"/g)) keys.add(match[1]);
  for (const match of inspectorHtml.matchAll(/data-localize>([^<]+)</g)) keys.add(match[1].trim());
  for (const key of keys) assert.ok(en[key], key);
});

test('settings from an old version or a bad host value fall back to defaults', () => {
  const settings = normalizeSettings({ theme: 'gone', unit: 'k', screen: 'nope', location: 42 });
  assert.deepEqual(settings, { theme: THEME_IDS[0], location: '42', placeId: '', unit: 'c', screen: 'now' });
});

test('a place chosen from the list is asked for by ID, and anything else by its text', () => {
  assert.equal(placeQuery(normalizeSettings({ location: 'Jabaquara, Espirito Santo, Brazil', placeId: '277112' })), 'id:277112');
  assert.equal(placeQuery(normalizeSettings({ location: 'Sao Paulo' })), 'Sao Paulo');
  assert.equal(placeQuery(normalizeSettings({ location: '' })), '');
});

test('only a number counts as a place ID, so nothing else can reach the request', () => {
  assert.equal(normalizeSettings({ placeId: 277112 }).placeId, '277112');
  for (const placeId of ['', 'abc', '12&key=x', null, undefined, '1234567890123']) {
    assert.equal(normalizeSettings({ placeId }).placeId, '', String(placeId));
  }
});

test('a key saved by an older version with the settings since removed still loads', () => {
  const settings = normalizeSettings({ screen: 'forecast', refresh: '60', label: 'Casa' });
  assert.equal(settings.screen, 'now');
  assert.equal(settings.refresh, undefined);
  assert.equal(settings.label, undefined);
});

test('only well-formed API keys are accepted', () => {
  assert.equal(normalizeApiKey('  abc123DEF456  '), 'abc123DEF456');
  assert.equal(normalizeApiKey(undefined), '');
  assert.equal(normalizeApiKey('short'), '');
  assert.equal(normalizeApiKey('abc123&q=evil000000'), '');
});
