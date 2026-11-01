// Measures what the plugin costs the user's machine. Run before each release and put the numbers
// in the release notes: node scripts/measure.mjs [keys] [idleSeconds]
// This runs against a fake host, so it measures the plugin and not Ulanzi Studio.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { pluginDir, root } from './lib/project.mjs';

const KEYS = Number(process.argv[2] ?? 6);
const IDLE_SECONDS = Number(process.argv[3] ?? 60);
const manifest = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'));
const THEMES = ['sky', 'minimal', 'thermal', 'lcd', 'neon', 'almanac'];
const preload = (file) => pathToFileURL(join(root, 'test', 'support', file)).href;

const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');

let socket;
let images = 0;
let bytes = 0;
const connected = once(server, 'connection').then(([client]) => {
  socket = client;
  client.on('message', (raw) => {
    const message = JSON.parse(raw);
    const data = message.cmd === 'state' ? message.param?.statelist?.[0]?.data : null;
    if (data) {
      images += 1;
      bytes += data.length;
    }
  });
});

const plugin = fork(join(pluginDir, 'plugin', 'app.js'), ['127.0.0.1', String(server.address().port), 'en'], {
  execArgv: ['--import', preload('fake-fetch.mjs'), '--import', preload('metrics.mjs')],
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});

const metrics = async () => {
  plugin.send('metrics');
  const [reply] = await once(plugin, 'message');
  return reply;
};
const send = (message) => socket.send(JSON.stringify(message));
const MB = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const key = (i) => ({ uuid: manifest.Actions[0].UUID, key: `${i}_0`, actionid: `a${i}` });

/** Waits until at least `count` images arrived and no more are coming. Returns when the last one did. */
async function settled(count, ms = 20_000) {
  const end = performance.now() + ms;
  let seen = images;
  let lastChange = performance.now();
  while (images < count || performance.now() - lastChange < 500) {
    if (performance.now() > end) throw new Error(`only ${images} of ${count} images arrived`);
    if (images !== seen) {
      seen = images;
      lastChange = performance.now();
    }
    await sleep(5);
  }
  return lastChange;
}

await connected;
await sleep(200);
const atStart = await metrics();

send({ cmd: 'didReceiveGlobalSettings', uuid: manifest.UUID, key: '', actionid: '', settings: { apiKey: 'MEASURE000000000' } });
const startedAt = performance.now();
for (let i = 0; i < KEYS; i += 1) {
  send({ cmd: 'add', ...key(i), param: { theme: THEMES[i % THEMES.length], location: `city ${i}` } });
}
const firstPaint = (await settled(KEYS)) - startedAt;
const afterRender = await metrics();
const imageSize = bytes / images;

await sleep(IDLE_SECONDS * 1000);
const afterIdle = await metrics();

const presses = 60;
const beforePresses = await metrics();
for (let i = 0; i < presses; i += 1) {
  send({ cmd: 'run', ...key(i % KEYS) });
  await sleep(50);
}
await settled(0, 30_000);
const afterPresses = await metrics();

const cpuPercent = (from, to, ms) => (((to.cpuMs - from.cpuMs) / ms) * 100).toFixed(2);

console.log(`Node ${process.version}, ${KEYS} keys, ${KEYS} different places`);
console.log(`Memory at start, no keys    ${MB(atStart.rss)}`);
console.log(`Memory with keys drawn      ${MB(afterRender.rss)} (heap ${MB(afterRender.heapUsed)}, WASM and buffers ${MB(afterRender.external)})`);
console.log(`Memory after ${IDLE_SECONDS} s idle       ${MB(afterIdle.rss)}`);
console.log(`Memory after ${presses} presses      ${MB(afterPresses.rss)}`);
console.log(`CPU idle                    ${cpuPercent(afterRender, afterIdle, IDLE_SECONDS * 1000)}% of one core`);
console.log(`First paint of every key    ${firstPaint.toFixed(0)} ms, ${(afterRender.cpuMs - atStart.cpuMs).toFixed(0)} ms of CPU`);
console.log(`One press                   ${((afterPresses.cpuMs - beforePresses.cpuMs) / presses).toFixed(1)} ms of CPU`);
console.log(`Image sent per key          ${(imageSize / 1024).toFixed(1)} KB`);

plugin.kill();
for (const client of server.clients) client.terminate();
server.close();
