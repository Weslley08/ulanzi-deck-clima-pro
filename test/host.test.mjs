// Runs the real plugin and the real SDK against a fake Studio and fake WeatherAPI.com replies.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const APP = fileURLToPath(new URL('../com.ulanzi.climapro.ulanziPlugin/plugin/app.js', import.meta.url));
const FAKE_FETCH = pathToFileURL(fileURLToPath(new URL('./support/fake-fetch.mjs', import.meta.url))).href;
const PLUGIN_UUID = 'com.ulanzi.climapro.ulanziPlugin';
const ACTION_UUID = `${PLUGIN_UUID}.weather`;
const API_KEY = 'SECRETKEY0123456789';
const WAIT_MS = 8000;
const QUIET_MS = 400;

let server;
let plugin;
let socket;
let received = [];
const everything = [];
let notify = () => {};
let output = '';
let workDir;
let requestLog;

function waitFor(predicate, ms = WAIT_MS) {
  return new Promise((resolve, reject) => {
    const limit = setTimeout(() => {
      notify = () => {};
      reject(new Error(`no matching message in ${ms} ms; got: ${received.map((m) => m.cmd).join(', ')}`));
    }, ms);
    const check = () => {
      const found = received.find(predicate);
      if (!found) return;
      clearTimeout(limit);
      notify = () => {};
      resolve(found);
    };
    notify = check;
    check();
  });
}

function send(message) {
  received = [];
  socket.send(JSON.stringify(message));
}

const iconFor = (key) => (m) => m.cmd === 'state' && m.param?.statelist?.[0]?.key === key;
const keyMessage = (key, actionid, extra = {}) => ({ uuid: ACTION_UUID, key, actionid, ...extra });
const requests = () => {
  try {
    return readFileSync(requestLog, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const iconOf = (message) => message.param.statelist[0].data;

async function startHost(port) {
  server = new WebSocketServer({ host: '127.0.0.1', port });
  await once(server, 'listening');
  server.on('connection', (client) => {
    socket = client;
    client.on('message', (data) => {
      const message = JSON.parse(data);
      received.push(message);
      everything.push(message);
      notify();
    });
  });
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'clima-pro-'));
  requestLog = join(workDir, 'requests.log');
  writeFileSync(requestLog, '');
  await startHost(0);
  plugin = spawn(process.execPath, ['--import', FAKE_FETCH, APP, '127.0.0.1', String(server.address().port), 'pt_PT'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FAKE_WEATHER_LOG: requestLog },
  });
  plugin.stdout.on('data', (chunk) => { output += chunk; });
  plugin.stderr.on('data', (chunk) => { output += chunk; });
  await waitFor((m) => m.cmd === 'connected');
});

after(() => {
  plugin?.kill();
  for (const client of server?.clients ?? []) client.terminate();
  server?.close();
  rmSync(workDir, { recursive: true, force: true });
});

test('announces the plugin UUID and asks for the saved key', async () => {
  const connected = await waitFor((m) => m.cmd === 'connected');
  assert.equal(connected.uuid, PLUGIN_UUID);
  await waitFor((m) => m.cmd === 'getGlobalSettings');
});

test('with no key saved, a new key asks for one instead of calling the API', async () => {
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: {} });
  await sleep(50);
  send({ cmd: 'add', ...keyMessage('0_0', 'a1', { param: {} }) });
  const face = await waitFor(iconFor('0_0'));
  assert.match(iconOf(face), /^data:image\/png;base64,/);
  assert.equal(requests().length, 0);
});

test('a press with no key alerts, as the store guideline requires', async () => {
  send({ cmd: 'run', ...keyMessage('0_0', 'a1') });
  await waitFor((m) => m.cmd === 'showAlert' && m.key === '0_0');
});

test('saving a key from the inspector starts the weather', async () => {
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: { apiKey: API_KEY } });
  await waitFor(iconFor('0_0'));
  const [line] = requests();
  assert.ok(line.startsWith('/v1/forecast.json auto:ip'), line);
  assert.ok(line.endsWith(API_KEY));
});

test('a second key on the same place shares the request', async () => {
  const count = requests().length;
  send({ cmd: 'add', ...keyMessage('1_0', 'a2', { param: { location: '', theme: 'neon' } }) });
  await waitFor(iconFor('1_0'));
  assert.equal(requests().length, count);
});

test('another place makes its own request', async () => {
  const count = requests().length;
  send({ cmd: 'add', ...keyMessage('2_0', 'a3', { param: { location: 'Rio de Janeiro' } }) });
  await waitFor(iconFor('2_0'));
  assert.equal(requests().length, count + 1);
});

test('a press moves to the next screen and saves it', async () => {
  send({ cmd: 'run', ...keyMessage('1_0', 'a2') });
  const saved = await waitFor((m) => m.cmd === 'paramfromplugin' && m.key === '1_0');
  assert.equal(saved.param.screen, 'details');
  assert.equal(saved.param.theme, 'neon');
  await waitFor(iconFor('1_0'));
});

test('run works even if add never came', async () => {
  send({ cmd: 'run', ...keyMessage('3_0', 'a4', { param: { theme: 'lcd' } }) });
  await waitFor(iconFor('3_0'));
  assert.equal(plugin.exitCode, null);
});

test('settings from the inspector change the face', async () => {
  send({ cmd: 'paramfromplugin', ...keyMessage('2_0', 'a3', { param: { location: 'Rio de Janeiro', theme: 'almanac' } }) });
  await waitFor(iconFor('2_0'));
});

test('an unchanged setting sends nothing, so the device is not repainted for no reason', async () => {
  send({ cmd: 'paramfromapp', ...keyMessage('2_0', 'a3', { param: { location: 'Rio de Janeiro', theme: 'almanac' } }) });
  await sleep(QUIET_MS);
  assert.equal(received.find(iconFor('2_0')), undefined);
});

test('a hidden key stays quiet and redraws when it comes back; active may be a string', async () => {
  send({ cmd: 'setactive', ...keyMessage('2_0', 'a3', { active: 'false' }) });
  await waitFor((m) => m.cmd === 'setactive' && m.code === 0);
  send({ cmd: 'paramfromplugin', ...keyMessage('2_0', 'a3', { param: { location: 'Rio de Janeiro', theme: 'sky' } }) });
  await sleep(QUIET_MS);
  assert.equal(received.find(iconFor('2_0')), undefined);
  send({ cmd: 'setactive', ...keyMessage('2_0', 'a3', { active: true }) });
  await waitFor(iconFor('2_0'));
});

test('a location that does not exist shows an error and alerts on press', async () => {
  send({ cmd: 'paramfromplugin', ...keyMessage('4_0', 'a5', { param: { location: 'nowhere' } }) });
  await waitFor(iconFor('4_0'));
  await sleep(QUIET_MS);
  send({ cmd: 'run', ...keyMessage('4_0', 'a5') });
  await waitFor((m) => m.cmd === 'showAlert' && m.key === '4_0');
});

test('the inspector gets a status when it opens', async () => {
  send({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: { type: 'hello' } }) });
  const status = await waitFor((m) => m.cmd === 'sendToPropertyInspector' && m.payload?.type === 'status');
  assert.equal(status.key, '2_0');
  assert.equal(status.payload.state, 'ok');
  assert.equal(status.payload.place, 'São Paulo, Brazil');
});

test('the inspector is told the version in the manifest', async () => {
  const { Version } = JSON.parse(readFileSync(new URL('../manifest.json', pathToFileURL(APP)), 'utf8'));
  send({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: { type: 'hello' } }) });
  const about = await waitFor((m) => m.cmd === 'sendToPropertyInspector' && m.payload?.type === 'about');
  assert.equal(about.key, '2_0');
  assert.equal(about.payload.version, Version);
});

test('the inspector gets place suggestions', async () => {
  send({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: { type: 'search', q: 'Sao Pa' } }) });
  const reply = await waitFor((m) => m.cmd === 'sendToPropertyInspector' && m.payload?.type === 'suggestions');
  assert.deepEqual(reply.payload.items, ['São Paulo, Sao Paulo, Brazil']);
});

test('a too short search does not spend a call', async () => {
  const count = requests().length;
  send({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: { type: 'search', q: 'Sa' } }) });
  await sleep(QUIET_MS);
  assert.equal(requests().length, count);
});

test('a rejected key is reported on every key and stops the requests', async () => {
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: { apiKey: 'BADKEY0000000000' } });
  await waitFor(iconFor('0_0'));
  await sleep(QUIET_MS);
  const count = requests().length;
  await sleep(QUIET_MS);
  assert.equal(requests().length, count);
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: { apiKey: API_KEY } });
  await waitFor(iconFor('0_0'));
});

test('clear uses the list in param and tolerates an unknown key', async () => {
  send({
    cmd: 'clear',
    param: [keyMessage('3_0', 'a4'), keyMessage('9_9', 'unknown')],
  });
  await waitFor((m) => m.cmd === 'clear' && m.code === 0);
  // Hiding and showing would force a redraw on a key that still existed.
  send({ cmd: 'setactive', ...keyMessage('3_0', 'a4', { active: 'false' }) });
  send({ cmd: 'setactive', ...keyMessage('3_0', 'a4', { active: 'true' }) });
  await sleep(QUIET_MS);
  assert.equal(received.find(iconFor('3_0')), undefined);
  assert.equal(plugin.exitCode, null);
});

test('garbage from the host does not bring the plugin down', async () => {
  socket.send('{"cmd":"add","uuid":"someone.else.entirely.here.x","key":"z","actionid":"z"}');
  socket.send(JSON.stringify({ cmd: 'clear' }));
  socket.send(JSON.stringify({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: null }) }));
  await sleep(QUIET_MS);
  assert.equal(plugin.exitCode, null);
});

test('after losing the host it reconnects on the same port and redraws, in the same language', async () => {
  received = [];
  socket.terminate();
  await waitFor((m) => m.cmd === 'connected');
  await waitFor(iconFor('0_0'));
  assert.equal(plugin.exitCode, null);
  send({ cmd: 'sendToPlugin', ...keyMessage('2_0', 'a3', { payload: { type: 'hello' } }) });
  await waitFor((m) => m.cmd === 'sendToPropertyInspector');
});

test('survives failed connections while the host is away, then comes back', async () => {
  const { port } = server.address();
  for (const client of server.clients) client.terminate();
  await new Promise((resolve) => server.close(resolve));
  // The first retry fails with a refused connection. Without an error listener the SDK would kill the process.
  await sleep(1500);
  assert.equal(plugin.exitCode, null);
  received = [];
  await startHost(port);
  await waitFor((m) => m.cmd === 'connected');
  await waitFor(iconFor('0_0'));
});

test('the key and the images never reach stdout or stderr', async () => {
  await sleep(100);
  assert.ok(!output.includes(API_KEY), 'API key leaked');
  assert.ok(!output.includes('base64'), 'image data logged');
  assert.equal(output, '');
});

test('the log sent to the host never contains the key', () => {
  const logs = everything.filter((m) => m.cmd === 'logMessage');
  assert.ok(logs.length > 0, 'the failures above should have been logged');
  for (const message of logs) assert.ok(!JSON.stringify(message).includes(API_KEY));
});

test('the plugin only sends the key back to the host when echoing what it received', () => {
  const leaks = everything.filter((m) => m.cmd !== 'didReceiveGlobalSettings' && JSON.stringify(m).includes(API_KEY));
  assert.deepEqual(leaks.map((m) => m.cmd), []);
});

test('exits cleanly when asked to stop', async () => {
  const exit = once(plugin, 'exit');
  plugin.kill('SIGTERM');
  await exit;
  plugin = null;
});
