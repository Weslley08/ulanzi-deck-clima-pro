// Main service: routes host events to one WeatherKey per key on the deck.
import { readFileSync } from 'node:fs';
import { fetchDefesaCivilFeed } from './defesa-civil-api.js';
import { DefesaCivilAlertService } from './defesa-civil-service.js';
import { HostConnection, silenceConsole } from './host.js';
import { clearFaceCache } from './render/renderer.js';
import { normalizeApiKey } from './settings.js';
import { fetchCurrent } from './weather-api.js';
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

// Studio prints a plugin's stderr next to its exit code, the only trace left when there is no socket
// to log through. Only short messages come here: never settings or URLs, which can hold the API key.
const report = (message, done) => process.stderr.write(`[Clima Pro] ${message}\n`, done);
// Without this, writing after Studio closes the pipe would throw, and logFailure would write again.
process.stderr.on('error', () => {});

const $UD = new HostConnection();
const logWarning = (message) => {
  report(message);
  $UD.logMessage(message, 'warn');
};
const hub = new WeatherHub({ fetchCurrent, log: logWarning });
const alerts = new DefesaCivilAlertService({ fetchFeed: fetchDefesaCivilFeed, log: logWarning });
const keys = new Map();

/** The SDK says the main service must pass a context here, so this has to wait for a key on the deck. */
function askForApiKey(context) {
  $UD.getGlobalSettings(context);
  // Without an answer the keys would sit on "loading" forever instead of asking for a key.
  setTimeout(() => {
    if (hub.keyState !== 'unknown') return;
    report('Studio did not answer about the saved API key');
    hub.setApiKey('');
  }, GLOBAL_SETTINGS_WAIT_MS);
}

function keyFor(jsn) {
  let key = keys.get(jsn.context);
  if (!key && jsn.uuid === ACTION_UUID) {
    key = new WeatherKey(jsn.context, { host: $UD, hub, alerts, version: VERSION });
    keys.set(jsn.context, key);
    key.updateSettings(jsn.param ?? {});
    if (hub.keyState !== 'ready') askForApiKey(jsn.context);
  }
  return key;
}

function applySettings(jsn) {
  const known = keys.has(jsn.context);
  const key = keyFor(jsn);
  if (known) key?.updateSettings(jsn.param ?? {});
}

function shutdown(reason, code = 0) {
  for (const key of keys.values()) key.destroy();
  const exit = () => process.exit(code);
  // stderr is asynchronous on Windows pipes, so exiting right away could lose the reason.
  report(`stopping: ${reason}`, exit);
  setTimeout(exit, 1000);
}

let attempts = 0;
let reconnectTimer = null;

// The SDK does not reconnect and the host does not relaunch a dead plugin.
function reconnect() {
  if (reconnectTimer) return;
  attempts += 1;
  if (attempts > MAX_ATTEMPTS) {
    shutdown(`no connection to Studio after ${MAX_ATTEMPTS} attempts`, 1);
    return;
  }
  const wait = Math.min(1000 * 2 ** (attempts - 1), MAX_RECONNECT_WAIT_MS);
  report(`no connection to Studio, retrying in ${wait / 1000} s (${attempts} of ${MAX_ATTEMPTS})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    $UD.reconnect();
  }, wait);
}

$UD.onConnected(async () => {
  attempts = 0;
  report('connected to Studio');
  // After a reconnection the key may have changed. On a first connection the keys are still to come.
  const [firstKey] = keys.keys();
  if (firstKey) askForApiKey(firstKey);
  await $UD.localizeUI();
  for (const key of keys.values()) key.redraw();
});
$UD.onClose(reconnect);
// Without this listener the EventEmitter throws and the process dies. The close event follows.
$UD.onError(() => {});

$UD.onDidReceiveGlobalSettings((jsn) => {
  const apiKey = normalizeApiKey(jsn.settings?.apiKey);
  report(apiKey ? 'Studio sent a saved API key' : 'Studio has no API key saved');
  hub.setApiKey(apiKey);
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
const logFailure = (error) => {
  const message = `unexpected failure: ${error?.name}: ${error?.message}`;
  report(message);
  $UD.logMessage(message, 'error');
  // During startup nothing may be keeping the process alive, and exiting with 0 would read as success.
  process.exitCode = 1;
};
process.on('uncaughtException', logFailure);
process.on('unhandledRejection', logFailure);

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

report(`${VERSION} starting on Node ${process.version} with arguments ${JSON.stringify(process.argv.slice(2))}`);
$UD.connect(PLUGIN_UUID);
