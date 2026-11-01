// What a key does with alerts, against fakes for the host, the weather and, unless a test brings the
// real one, the alert service.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DefesaCivilAlertService } from '../com.ulanzi.climapro.ulanziPlugin/plugin/defesa-civil-service.js';
import { ALERT_PAGE_RETURN_MS, PULSE_STEP_MS, WeatherKey } from '../com.ulanzi.climapro.ulanziPlugin/plugin/weather-key.js';

const WEATHER = {
  location: { name: 'Blumenau', region: 'Santa Catarina', country: 'Brazil', lat: -26.92, lon: -49.07 },
  current: { condition: 'rain', isDay: true, tempC: 24, tempF: 75, feelsLikeC: 25, feelsLikeF: 77, humidity: 80, windKph: 10, windMph: 6, precipMm: 1, precipIn: 0.04 },
};
const alertOf = (id, severity) => ({ id, severity, title: 'CHUVAS INTENSAS', description: `Alerta ${id}`, instructions: 'Instrução', issuer: 'Defesa Civil', areaDescription: 'Blumenau/SC', expiresAt: Date.now() + 3_600_000, officialUrl: 'https://www.gov.br/x', polygons: [{ huge: true }] });
const NONE = { state: 'clear', alerts: [], checkedAt: 1 };
const ACTIVE = (...alerts) => ({ state: 'active', alerts, checkedAt: 1 });

function harness({ weather = WEATHER, alerts = NONE, keyState = 'ready', settings = {}, service: realService = null } = {}) {
  const sent = { icons: [], params: [], alerts: 0, panel: [] };
  const clock = { nextId: 1, timeouts: new Map(), intervals: new Map() };
  const timers = {
    setTimeout: (fn, ms) => {
      const id = clock.nextId++;
      clock.timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => clock.timeouts.delete(id),
    setInterval: (fn, ms) => {
      const id = clock.nextId++;
      clock.intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => clock.intervals.delete(id),
  };
  const host = {
    t: (text) => text,
    logMessage: (message) => { sent.log = message; },
    showAlert: () => { sent.alerts += 1; },
    setBaseDataIcon: (_context, icon) => sent.icons.push(icon),
    sendParamFromPlugin: (param) => sent.params.push(param),
    sendToPropertyInspector: (message) => sent.panel.push(message),
  };
  const feed = { data: weather, error: null };
  const weatherSub = { snapshot: () => ({ data: feed.data, error: feed.error, stale: Boolean(feed.data && feed.error) }), refresh() {}, setActive() {}, close() {} };
  const hub = { keyState, apiKey: 'K', subscribe: (query, { onUpdate }) => {
    feed.query = query;
    feed.notify = onUpdate;
    return weatherSub;
  } };
  const places = [];
  const alertSub = {
    snapshot: alerts,
    active: null,
    enabled: null,
    setPlace: (place) => places.push(place),
    setEnabled: (enabled) => { alertSub.enabled = enabled; },
    setActive: (active) => { alertSub.active = active; },
    close: () => { alertSub.closed = true; },
  };
  let notifyAlerts = () => {};
  const service = realService ?? { subscribe: ({ onUpdate }) => {
    notifyAlerts = onUpdate;
    return alertSub;
  } };
  const render = async (view) => JSON.stringify(view);
  const key = new WeatherKey('ctx', { host, hub, alerts: service, version: '9', render, timers });
  key.updateSettings(settings);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const lastView = () => JSON.parse(sent.icons.at(-1));
  return {
    key, sent, clock, feed, places, flush, lastView, alertSub,
    setAlerts: (snapshot) => {
      alertSub.snapshot = snapshot;
      notifyAlerts();
    },
  };
}

test('no alert: the view is the plain forecast, with no alert field at all', async () => {
  const { flush, lastView } = harness();
  await flush();
  const view = lastView();
  assert.equal(view.screen, 'now');
  assert.equal(view.alert, undefined);
  assert.equal(view.temp, '24°');
});

test('a severe or extreme alert adds to the forecast and removes nothing from it', async () => {
  for (const severity of ['SEVERE', 'EXTREME', 'MODERATE']) {
    const { flush, lastView } = harness({ alerts: ACTIVE(alertOf('a', severity)) });
    await flush();
    const view = lastView();
    assert.equal(view.screen, 'now', 'an alert must never take the screen by itself');
    assert.equal(view.alert.severity, severity);
    assert.equal(view.temp, '24°');
    assert.equal(view.city, 'Blumenau');
    assert.equal(view.condition, 'rain');
  }
});

test('the most serious alert is the one the face shows', async () => {
  const { flush, lastView } = harness({ alerts: ACTIVE(alertOf('e', 'EXTREME'), alertOf('s', 'SEVERE')) });
  await flush();
  assert.equal(lastView().alert.severity, 'EXTREME');
});

test('a failed check keeps the forecast, and marks that it could not check', async () => {
  for (const state of ['stale', 'unavailable']) {
    const { flush, lastView } = harness({ alerts: { state, alerts: [], checkedAt: null } });
    await flush();
    const view = lastView();
    assert.equal(view.temp, '24°');
    assert.equal(view.screen, 'now');
    assert.deepEqual(view.alert, { severity: null, uncertain: true, pulse: 0 });
  }
});

test('an alert kept through a failed check says both things', async () => {
  const { flush, lastView } = harness({ alerts: { state: 'unavailable', alerts: [alertOf('a', 'SEVERE')], checkedAt: 1 } });
  await flush();
  assert.deepEqual(lastView().alert, { severity: 'SEVERE', uncertain: true, pulse: 0 });
});

test('with the weather down, an alert still shows over the message', async () => {
  const { flush, lastView, feed, key } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  feed.data = null;
  feed.error = { kind: 'network' };
  key.onWeatherChanged();
  await flush();
  assert.equal(lastView().screen, 'message');
  assert.equal(lastView().alert.severity, 'SEVERE');
});

test('the place for alerts comes from the weather reply, with no setting of its own', () => {
  const { places, key } = harness();
  assert.deepEqual(places.at(-1), WEATHER.location);
  assert.equal('alertLocation' in key.settings, false);
});

test('changing the place drops the old one at once, before the new reply arrives', () => {
  const { places, key, feed } = harness();
  feed.data = null;
  places.length = 0;
  key.updateSettings({ location: 'Curitiba' });
  assert.deepEqual(places, [null]);
  assert.equal(feed.query, 'Curitiba');
  const curitiba = { ...WEATHER, location: { ...WEATHER.location, name: 'Curitiba' } };
  feed.data = curitiba;
  feed.notify();
  assert.equal(places.at(-1).name, 'Curitiba');
});

test('when weather data ages out, the place stays, so alerts keep working', () => {
  const { places, key, feed } = harness();
  feed.data = null;
  places.length = 0;
  key.onWeatherChanged();
  assert.deepEqual(places, []);
});

test('the setting reaches the service, on and off', () => {
  const { alertSub, key } = harness();
  assert.equal(alertSub.enabled, true);
  key.updateSettings({ alerts: 'off' });
  assert.equal(alertSub.enabled, false);
  key.updateSettings({ alerts: 'on' });
  assert.equal(alertSub.enabled, true);
});

test('a press opens the alert, the next goes through the others, then on to the next forecast screen', async () => {
  const { key, flush, lastView, sent } = harness({ alerts: ACTIVE(alertOf('e', 'EXTREME'), alertOf('s', 'SEVERE')) });
  await flush();
  key.run();
  await flush();
  assert.equal(lastView().screen, 'alertPage');
  assert.equal(lastView().description, 'Alerta e');
  assert.deepEqual([lastView().index, lastView().total], [0, 2]);
  key.run();
  await flush();
  assert.equal(lastView().description, 'Alerta s');
  assert.deepEqual(sent.params, [], 'an alert page is never saved in the settings');
  key.run();
  await flush();
  assert.equal(lastView().screen, 'details');
  assert.equal(sent.params.at(-1).screen, 'details');
  assert.equal(lastView().alert.severity, 'EXTREME', 'the details screen keeps the banner');
  key.run();
  await flush();
  assert.equal(lastView().screen, 'alertPage');
  key.run();
  key.run();
  await flush();
  assert.equal(lastView().screen, 'now');
});

test('the alert page keeps the temperature and the place', async () => {
  const { key, flush, lastView } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  key.run();
  await flush();
  assert.equal(lastView().temp, '24°');
  assert.equal(lastView().city, 'Blumenau');
});

test('with no alert, a press switches screens exactly as before', async () => {
  const { key, flush, lastView, sent } = harness();
  key.run();
  await flush();
  assert.equal(lastView().screen, 'details');
  assert.equal(sent.params.at(-1).screen, 'details');
  key.run();
  await flush();
  assert.equal(lastView().screen, 'now');
});

test('a forgotten alert page goes back to the forecast by itself', async () => {
  const { key, flush, lastView, clock } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  key.run();
  await flush();
  const [{ fn, ms }] = clock.timeouts.values();
  assert.equal(ms, ALERT_PAGE_RETURN_MS);
  fn();
  await flush();
  assert.equal(lastView().screen, 'now');
});

test('each press restarts the wait, and only one wait ever runs', async () => {
  const { key, clock } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE'), alertOf('b', 'SEVERE')) });
  key.run();
  key.run();
  assert.equal(clock.timeouts.size, 1);
  key.run();
  assert.equal(clock.timeouts.size, 0, 'leaving the pages stops it');
});

test('an alert that ends while its page is open goes back to the forecast', async () => {
  const { key, flush, lastView, setAlerts, clock } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  key.run();
  await flush();
  setAlerts(NONE);
  await flush();
  assert.equal(lastView().screen, 'now');
  assert.equal(clock.timeouts.size, 0);
});

test('a press with no weather still opens alerts, and leaving them raises no error', async () => {
  const { key, flush, lastView, feed, sent } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  feed.data = null;
  feed.error = { kind: 'network' };
  key.run();
  await flush();
  assert.equal(lastView().screen, 'alertPage');
  assert.equal(lastView().temp, null);
  key.run();
  await flush();
  assert.equal(lastView().screen, 'message');
  assert.equal(sent.alerts, 0);
  key.run();
  await flush();
  assert.equal(lastView().screen, 'alertPage');
});

test('a press with no weather and no alert still alerts, as the store requires', () => {
  const { key, feed, sent } = harness();
  feed.data = null;
  feed.error = { kind: 'network' };
  key.run();
  assert.equal(sent.alerts, 1);
});

test('only an extreme alert animates', () => {
  for (const severity of ['SEVERE', 'MODERATE', 'MINOR', 'UNKNOWN']) {
    const { clock, setAlerts } = harness();
    setAlerts(ACTIVE(alertOf('a', severity)));
    assert.equal(clock.intervals.size, 0, severity);
  }
});

test('the extreme animation is slow, changes only the pulse, and runs once per key', async () => {
  const { setAlerts, clock, flush, lastView } = harness();
  setAlerts(ACTIVE(alertOf('a', 'EXTREME')));
  setAlerts(ACTIVE(alertOf('a', 'EXTREME'), alertOf('b', 'SEVERE')));
  assert.equal(clock.intervals.size, 1);
  const [{ fn, ms }] = clock.intervals.values();
  assert.equal(ms, PULSE_STEP_MS);
  assert.ok(ms >= 1000, 'nothing close to a flash');
  await flush();
  const first = lastView();
  fn();
  await flush();
  const second = lastView();
  assert.notEqual(first.alert.pulse, second.alert.pulse);
  assert.deepEqual({ ...first, alert: null }, { ...second, alert: null });
});

test('the animation stops whenever it cannot be seen', async () => {
  const { key, setAlerts, clock } = harness();
  setAlerts(ACTIVE(alertOf('a', 'EXTREME')));
  assert.equal(clock.intervals.size, 1);
  key.setActive(false);
  assert.equal(clock.intervals.size, 0, 'hidden');
  key.setActive(true);
  assert.equal(clock.intervals.size, 1);
  key.run();
  assert.equal(clock.intervals.size, 0, 'on the alert page');
  key.run();
  assert.equal(clock.intervals.size, 1);
  setAlerts(ACTIVE(alertOf('a', 'SEVERE')));
  assert.equal(clock.intervals.size, 0, 'no longer extreme');
  setAlerts(ACTIVE(alertOf('a', 'EXTREME')));
  key.destroy();
  assert.equal(clock.intervals.size, 0, 'removed');
});

test('removing a key stops everything it started', async () => {
  const { key, clock, alertSub } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  key.run();
  key.destroy();
  assert.equal(clock.timeouts.size, 0);
  assert.equal(alertSub.closed, true);
});

test('an unchanged image is not sent again', async () => {
  const { key, flush, sent } = harness({ alerts: ACTIVE(alertOf('a', 'SEVERE')) });
  await flush();
  const count = sent.icons.length;
  key.onAlertsChanged();
  key.onAlertsChanged();
  await flush();
  assert.equal(sent.icons.length, count);
});

test('the panel gets each alert in full, without its polygons', async () => {
  const { key, sent } = harness({ alerts: ACTIVE(alertOf('a', 'EXTREME')) });
  await key.onInspectorMessage({ type: 'hello' });
  const message = sent.panel.filter((m) => m.type === 'alerts').at(-1);
  assert.equal(message.state, 'active');
  assert.deepEqual(Object.keys(message.items[0]).sort(), ['area', 'description', 'id', 'instructions', 'issuer', 'level', 'severity', 'title', 'until', 'url']);
  assert.equal(message.items[0].level, 'EXTREMO');
  assert.ok(!JSON.stringify(message).includes('huge'));
});

const panelState = (sent) => sent.panel.filter((m) => m.type === 'alerts').at(-1);
const LISBON_WEATHER = { ...WEATHER, location: { name: 'Lisbon', region: 'Lisboa', country: 'Portugal', lat: 38.72, lon: -9.13 } };

/** The real service, with nothing behind it but a count of the downloads asked for. */
function realAlertService() {
  const downloads = { count: 0 };
  const service = new DefesaCivilAlertService({
    fetchFeed: async () => {
      downloads.count += 1;
      return { generatedAt: null, oldestSentAt: null, entryCount: 0, alerts: [], withdrawnIds: new Set(), serverTime: null };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });
  return { service, downloads };
}

test('the panel says why no check is running', async () => {
  const off = harness({ alerts: { state: 'off', alerts: [], checkedAt: null } });
  await off.key.onInspectorMessage({ type: 'hello' });
  assert.equal(panelState(off.sent).state, 'checking');
  off.key.updateSettings({ alerts: 'off' });
  assert.equal(panelState(off.sent).state, 'disabled', 'the panel is told as soon as the setting changes');
});

test('outside Brazil: no download, the forecast as usual, and the reason for the panel', async () => {
  const { service, downloads } = realAlertService();
  const { key, sent, flush, lastView } = harness({ weather: LISBON_WEATHER, service });
  await flush();
  assert.equal(downloads.count, 0);
  assert.equal(panelState(sent).state, 'outside');
  assert.equal(panelState(sent).country, 'Portugal');
  assert.deepEqual(panelState(sent).items, []);
  const view = lastView();
  assert.equal(view.alert, undefined, 'nothing is added to the face');
  assert.equal(view.city, 'Lisbon');
  key.run();
  await flush();
  assert.equal(lastView().screen, 'details', 'a press still does what it always did');
});

test('the reason stays when the weather data ages out, instead of going back to "checking"', async () => {
  const { service } = realAlertService();
  const { key, sent, feed } = harness({ weather: LISBON_WEATHER, service });
  feed.data = null;
  feed.error = { kind: 'network' };
  key.onWeatherChanged();
  assert.equal(panelState(sent).state, 'outside');
});

test('outside Brazil the reason shows even with alerts turned off on the key', async () => {
  const { service } = realAlertService();
  const { sent } = harness({ weather: LISBON_WEATHER, service, settings: { alerts: 'off' } });
  assert.equal(panelState(sent).state, 'outside');
});

test('a key waiting for its first reply says "checking", then the reason', async () => {
  const { service } = realAlertService();
  const { key, sent, feed } = harness({ weather: null, service });
  assert.equal(panelState(sent).state, 'checking');
  feed.data = LISBON_WEATHER;
  key.onWeatherChanged();
  assert.equal(panelState(sent).state, 'outside');
});

test('a place in Brazil turns it back on, respecting the setting of the key', async () => {
  const { service, downloads } = realAlertService();
  const { key, sent, feed, flush } = harness({ weather: LISBON_WEATHER, service });
  feed.data = WEATHER;
  key.updateSettings({ location: 'Blumenau' });
  await flush();
  assert.equal(downloads.count, 1);
  assert.equal(panelState(sent).state, 'clear');
  assert.equal(panelState(sent).country, undefined);
  key.updateSettings({ location: 'Blumenau', alerts: 'off' });
  assert.equal(panelState(sent).state, 'disabled');
});

test('the same alerts are not sent to the panel twice', async () => {
  const { setAlerts, sent } = harness();
  const count = () => sent.panel.filter((m) => m.type === 'alerts').length;
  const snapshot = ACTIVE(alertOf('a', 'SEVERE'));
  setAlerts(snapshot);
  const after = count();
  setAlerts(snapshot);
  assert.equal(count(), after);
});
