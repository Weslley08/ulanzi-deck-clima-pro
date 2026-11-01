// Runs the real plugin, the real SDK, the real parser and the real renderer end to end, against a fake
// Studio and SYNTHETIC feeds. The weather fixture is São Paulo.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { capEntry, capFeed, iso, square } from './support/cap-builder.mjs';

const APP = fileURLToPath(new URL('../com.ulanzi.climapro.ulanziPlugin/plugin/app.js', import.meta.url));
const FAKE_FETCH = pathToFileURL(fileURLToPath(new URL('./support/fake-fetch.mjs', import.meta.url))).href;
const PLUGIN_UUID = 'com.ulanzi.climapro.ulanziPlugin';
const ACTION_UUID = `${PLUGIN_UUID}.weather`;
const API_KEY = 'SECRETKEY0123456789';
const WAIT_MS = 8000;
const SAO_PAULO = [square(-23.53, -46.62)];
const HOUR = 3_600_000;

const workDir = mkdtempSync(join(tmpdir(), 'clima-pro-alerts-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

const running = [];
after(() => {
  for (const { plugin, server } of running) {
    plugin.kill();
    for (const client of server.clients) client.terminate();
    server.close();
  }
});

async function start(feedFile) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const state = { messages: [], output: '', notify: () => {} };
  server.on('connection', (client) => {
    state.socket = client;
    client.on('message', (raw) => {
      state.messages.push(JSON.parse(raw));
      state.notify();
    });
  });
  const alertLog = join(workDir, `${running.length}.log`);
  writeFileSync(alertLog, '');
  const plugin = spawn(process.execPath, ['--import', FAKE_FETCH, APP, '127.0.0.1', String(server.address().port), 'pt_PT'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FAKE_ALERT_FEED: feedFile, FAKE_ALERT_LOG: alertLog },
  });
  plugin.stderr.on('data', (chunk) => { state.output += chunk; });
  running.push({ plugin, server });

  const waitFor = (predicate, ms = WAIT_MS) => new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error(`nothing matched in ${ms} ms; got ${state.messages.map((m) => m.cmd).join(', ')}`)), ms);
    const check = () => {
      const found = state.messages.find(predicate);
      if (!found) return;
      clearTimeout(limit);
      state.notify = () => {};
      resolve(found);
    };
    state.notify = check;
    check();
  });
  const send = (message) => {
    state.messages = [];
    state.socket.send(JSON.stringify(message));
  };
  const key = (name) => ({ uuid: ACTION_UUID, key: name, actionid: `action-${name}` });
  const panelMessage = (name) => (m) => m.cmd === 'sendToPropertyInspector' && m.key === name && m.payload?.type === 'alerts';
  await waitFor((m) => m.cmd === 'connected');
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: { apiKey: API_KEY } });
  await sleep(50);
  return { state, waitFor, send, key, panelMessage, feedRequests: () => readFileSync(alertLog, 'utf8').trim().split('\n').filter(Boolean).length };
}

function feedFile(name, entries) {
  const file = join(workDir, `${name}.xml`);
  writeFileSync(file, capFeed(entries, iso(Date.now())));
  return file;
}

const entry = (id, severity, fields = {}) => capEntry({ id, severity, sent: iso(Date.now() - HOUR / 2), expires: iso(Date.now() + HOUR), polygons: SAO_PAULO, areaDesc: 'São Paulo/SP', description: `Alerta sintético ${id}`, ...fields });
const iconFor = (name) => (m) => m.cmd === 'state' && m.param?.statelist?.[0]?.key === name;
const iconOf = (message) => message.param.statelist[0].data;

test('end to end: an extreme alert over the place, then the press flow, and one shared download', async () => {
  const h = await start(feedFile('extreme', [entry('e', 'Extreme'), entry('s', 'Severe'), entry('far', 'Extreme', { polygons: [square(-3, -60)], areaDesc: 'Manaus/AM' })]));
  h.send({ cmd: 'add', ...h.key('0_0'), param: { theme: 'sky', location: 'Sao Paulo' } });
  const status = await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'active');
  assert.deepEqual(status.payload.items.map(({ id }) => id), ['e', 's'], 'most serious first, and the far one left out');

  h.send({ cmd: 'add', ...h.key('1_0'), param: { theme: 'neon', location: 'Rio de Janeiro' } });
  await h.waitFor(iconFor('1_0'));
  assert.equal(h.feedRequests(), 1, 'two places, one download');

  // A forecast face gets its banner and glows: distinct images keep arriving.
  h.send({ cmd: 'sendToPlugin', ...h.key('0_0'), payload: { type: 'noop' } });
  await sleep(2300);
  const faces = new Set(h.state.messages.filter(iconFor('0_0')).map(iconOf));
  assert.ok(faces.size >= 2, `saw ${faces.size} distinct images`);
  for (const face of faces) assert.match(face, /^data:image\/png;base64,/);

  // First press: the page. Nothing saved.
  h.send({ cmd: 'run', ...h.key('0_0') });
  await h.waitFor(iconFor('0_0'));
  await sleep(200);
  assert.equal(h.state.messages.find((m) => m.cmd === 'paramfromplugin'), undefined);
  assert.equal(h.state.messages.find((m) => m.cmd === 'showAlert'), undefined);

  // The glow stops on the page: no more images arrive.
  h.state.messages = [];
  await sleep(1300);
  assert.equal(h.state.messages.find(iconFor('0_0')), undefined);

  h.send({ cmd: 'run', ...h.key('0_0') });
  await h.waitFor(iconFor('0_0'));
  h.send({ cmd: 'run', ...h.key('0_0') });
  const saved = await h.waitFor((m) => m.cmd === 'paramfromplugin' && m.key === '0_0');
  assert.equal(saved.param.screen, 'details');
});

test('end to end: changing the place drops its alerts, with no new download', async () => {
  const h = await start(feedFile('severe', [entry('s', 'Severe')]));
  h.send({ cmd: 'add', ...h.key('0_0'), param: { location: 'Sao Paulo' } });
  await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'active');
  h.send({ cmd: 'paramfromplugin', ...h.key('0_0'), param: { location: 'Rio de Janeiro', alerts: 'off' } });
  const off = await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'disabled');
  assert.deepEqual(off.payload.items, []);
  h.send({ cmd: 'paramfromplugin', ...h.key('0_0'), param: { location: 'Rio de Janeiro', alerts: 'on' } });
  const on = await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'active');
  assert.equal(on.payload.items[0].id, 's', 'the fixture answers São Paulo for every query');
  assert.equal(h.feedRequests(), 1);
});

test('end to end: a place outside Brazil turns the feature off and says why, and Brazil turns it back on', async () => {
  const h = await start(feedFile('outside', [entry('s', 'Severe')]));
  h.send({ cmd: 'add', ...h.key('0_0'), param: { location: 'lisbon', theme: 'minimal' } });
  const off = await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'outside');
  assert.equal(off.payload.country, 'Portugal');
  assert.deepEqual(off.payload.items, []);
  await h.waitFor(iconFor('0_0'));
  await sleep(300);
  assert.equal(h.feedRequests(), 0, 'nothing is downloaded for this place');

  h.send({ cmd: 'paramfromplugin', ...h.key('0_0'), param: { location: 'Sao Paulo', theme: 'minimal' } });
  const on = await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'active');
  assert.equal(on.payload.items[0].id, 's');
  assert.equal(on.payload.country, undefined);
  assert.equal(h.feedRequests(), 1);

  h.send({ cmd: 'paramfromplugin', ...h.key('0_0'), param: { location: 'lisbon', theme: 'minimal' } });
  await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'outside');
  await sleep(300);
  assert.equal(h.feedRequests(), 1, 'and going back abroad starts nothing new');
});

test('end to end: with the feed down, the weather carries on, and the panel never says "clear"', async () => {
  const h = await start('offline');
  h.send({ cmd: 'add', ...h.key('0_0'), param: { theme: 'minimal' } });
  await h.waitFor((m) => m.cmd === 'sendToPropertyInspector' && m.payload?.type === 'status' && m.payload.state === 'ok');
  await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'unavailable');
  await h.waitFor(iconFor('0_0'));
  assert.ok(!h.state.messages.some((m) => h.panelMessage('0_0')(m) && m.payload.state === 'clear'));
  await sleep(100);
  assert.match(h.state.output, /\[Clima Pro\] Defesa Civil alerts request failed: network/);
  assert.ok(!h.state.output.includes(API_KEY));
  assert.ok(!h.state.output.includes('idapfile'), 'the log stays free of URLs');
  h.send({ cmd: 'run', ...h.key('0_0') });
  const saved = await h.waitFor((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.screen, 'details', 'the press still does what it always did');
});

test('end to end: a garbage reply reads as unavailable, and the plugin stays up', async () => {
  const file = join(workDir, 'garbage.xml');
  writeFileSync(file, '<html><body>Maintenance</body></html>');
  const h = await start(file);
  h.send({ cmd: 'add', ...h.key('0_0'), param: {} });
  await h.waitFor((m) => h.panelMessage('0_0')(m) && m.payload.state === 'unavailable');
  await sleep(100);
  assert.match(h.state.output, /Defesa Civil alerts request failed: invalid/);
  assert.equal(running.at(-1).plugin.exitCode, null);
});

test('no feed, however bad, brought a plugin down', () => {
  for (const { plugin } of running) assert.equal(plugin.exitCode, null);
});
