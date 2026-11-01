// Main service: routes host events to one WeatherKey per key on the deck.
import { readFileSync } from 'node:fs';
import { HostConnection, silenceConsole } from './host.js';
import { clearFaceCache } from './render/renderer.js';
import { normalizeApiKey } from './settings.js';
import { fetchForecast } from './weather-api.js';
import { WeatherHub } from './weather-hub.js';
import { WeatherKey } from './weather-key.js';

const PLUGIN_UUID = 'com.ulanzi.climapro.ulanziPlugin';
const ACTION_UUID = `${PLUGIN_UUID}.weather`;
const MAX_ATTEMPTS = 10;
const MAX_RECONNECT_WAIT_MS = 30_000;
const GLOBAL_SETTINGS_WAIT_MS = 3_000;
// The manifest is the one place the version lives. The release workflow checks the tag against it.
const { Version: VERSION } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

silenceConsole();

const $UD = new HostConnection();
const hub = new WeatherHub({ fetchForecast, log: (message) => $UD.logMessage(message, 'warn') });
const keys = new Map();

function keyFor(jsn) {
  let key = keys.get(jsn.context);
  if (!key && jsn.uuid === ACTION_UUID) {
    key = new WeatherKey(jsn.context, { host: $UD, hub, version: VERSION });
    keys.set(jsn.context, key);
    key.updateSettings(jsn.param ?? {});
  }
  return key;
}

function applySettings(jsn) {
  const known = keys.has(jsn.context);
  const key = keyFor(jsn);
  if (known) key?.updateSettings(jsn.param ?? {});
}

function shutdown() {
  for (const key of keys.values()) key.destroy();
  process.exit(0);
}

let attempts = 0;
let reconnectTimer = null;

// The SDK does not reconnect and the host does not relaunch a dead plugin.
function reconnect() {
  if (reconnectTimer) return;
  attempts += 1;
  if (attempts > MAX_ATTEMPTS) shutdown();
  const wait = Math.min(1000 * 2 ** (attempts - 1), MAX_RECONNECT_WAIT_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    $UD.reconnect();
  }, wait);
}

$UD.onConnected(async () => {
  attempts = 0;
  $UD.getGlobalSettings();
  // Without an answer the keys would sit on "loading" forever instead of asking for a key.
  setTimeout(() => {
    if (hub.keyState === 'unknown') hub.setApiKey('');
  }, GLOBAL_SETTINGS_WAIT_MS);
  await $UD.localizeUI();
  for (const key of keys.values()) key.redraw();
});
$UD.onClose(reconnect);
// Without this listener the EventEmitter throws and the process dies. The close event follows.
$UD.onError(() => {});

$UD.onDidReceiveGlobalSettings((jsn) => {
  hub.setApiKey(normalizeApiKey(jsn.settings?.apiKey));
});

$UD.onAdd(applySettings);
$UD.onParamFromApp(applySettings);
$UD.onParamFromPlugin(applySettings);

// Only run: on the D200H one touch fires keydown and run, and handling both would act twice.
$UD.onRun((jsn) => keyFor(jsn)?.run());

// active may arrive as a string.
$UD.onSetActive((jsn) => keys.get(jsn.context)?.setActive(String(jsn.active) === 'true'));

$UD.onSendToPlugin((jsn) => keyFor(jsn)?.onInspectorMessage(jsn.payload));

// clear has no message.context: each item in param carries its own.
$UD.onClear((jsn) => {
  for (const { context } of jsn.param ?? []) {
    keys.get(context)?.destroy();
    keys.delete(context);
  }
  if (!keys.size) clearFaceCache();
});

// The host never relaunches this process, so one bad frame must not take every key down with it.
const logFailure = (error) => $UD.logMessage(`unexpected failure: ${error?.name}: ${error?.message}`, 'error');
process.on('uncaughtException', logFailure);
process.on('unhandledRejection', logFailure);

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

$UD.connect(PLUGIN_UUID);
