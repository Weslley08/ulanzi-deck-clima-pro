// After a restart or an update the panel stays closed, so the plugin has to get the saved key by itself.
// The SDK says the main service must pass a context to getGlobalSettings, so this host only answers with one.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const APP = fileURLToPath(new URL('../com.ulanzi.climapro.ulanziPlugin/plugin/app.js', import.meta.url));
const FAKE_FETCH = pathToFileURL(fileURLToPath(new URL('./support/fake-fetch.mjs', import.meta.url))).href;
const PLUGIN_UUID = 'com.ulanzi.climapro.ulanziPlugin';
const API_KEY = 'SAVEDKEY00000000';
const KEY = { uuid: `${PLUGIN_UUID}.weather`, key: '0_0', actionid: 'a1' };

async function startup(answers) {
  const workDir = mkdtempSync(join(tmpdir(), 'clima-pro-key-'));
  const requestLog = join(workDir, 'requests.log');
  writeFileSync(requestLog, '');
  const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(host, 'listening');
  const asks = [];
  host.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.cmd === 'connected') socket.send(JSON.stringify({ cmd: 'add', ...KEY, param: {} }));
      if (message.cmd !== 'getGlobalSettings') return;
      asks.push(message);
      if (answers && message.key && message.actionid) {
        socket.send(JSON.stringify({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: { apiKey: API_KEY } }));
      }
    });
  });
  const plugin = spawn(process.execPath, ['--import', FAKE_FETCH, APP, '127.0.0.1', String(host.address().port), 'en'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, FAKE_WEATHER_LOG: requestLog },
  });
  const run = { asks, stderr: '', requests: () => readFileSync(requestLog, 'utf8') };
  plugin.stderr.on('data', (chunk) => { run.stderr += chunk; });
  run.stop = () => {
    plugin.kill();
    for (const client of host.clients) client.terminate();
    host.close();
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return run;
}

async function until(condition, ms = 6000) {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(25);
}

test('the saved key comes back by itself, with no panel open', async () => {
  const run = await startup(true);
  try {
    await until(() => run.requests().includes('/v1/current.json'));
    assert.match(run.requests(), new RegExp(`/v1/current\\.json auto:ip ${API_KEY}`));
    assert.deepEqual(run.asks[0], { cmd: 'getGlobalSettings', ...KEY });
    assert.match(run.stderr, /\[Clima Pro\] Studio sent a saved API key/);
    assert.ok(!run.stderr.includes(API_KEY), 'the key reached the log');
  } finally {
    run.stop();
  }
});

test('a Studio that never answers is reported, and the key asks for an API key', async () => {
  const run = await startup(false);
  try {
    await until(() => run.stderr.includes('did not answer'));
    assert.match(run.stderr, /\[Clima Pro\] Studio did not answer about the saved API key/);
    assert.equal(run.requests(), '');
  } finally {
    run.stop();
  }
});
