// Runs the settings panel in a real Chromium, the engine Ulanzi Studio embeds, with the real SDK
// against a fake host. Skipped when no browser is installed; set CHROME_PATH to point at one.
// Set PI_SCREENSHOT=<folder> to also save pictures of the panel.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = 'com.ulanzi.climapro.ulanziPlugin';
const ACTION_UUID = `${PLUGIN}.weather`;
const SAVED_KEY = 'SAVEDKEY0123456789';
const WAIT_MS = 8000;

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => path && existsSync(path));

const options = { skip: browserPath ? false : 'no Chromium found; set CHROME_PATH to run' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let web;
let host;
let hostSocket;
let browser;
let profile;
let page;
let messages = [];
const consoleOutput = [];
let notify = () => {};
let nextId = 1;
const pending = new Map();

function waitForMessage(predicate) {
  return new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error(`no matching message; got ${messages.map((m) => m.cmd).join(', ')}`)), WAIT_MS);
    const check = () => {
      const found = messages.find(predicate);
      if (!found) return;
      clearTimeout(limit);
      notify = () => {};
      resolve(found);
    };
    notify = check;
    check();
  });
}

const fromHost = (message) => hostSocket.send(JSON.stringify({ uuid: ACTION_UUID, key: '0_0', actionid: 'a1', ...message }));

function cdp(method, params = {}) {
  const id = nextId++;
  page.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function run(expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

const type = (selector, value) => run(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  el.focus();
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

async function until(expression) {
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    if (await run(expression)) return;
    await sleep(25);
  }
  assert.fail(`never became true: ${expression}`);
}

async function screenshot(name) {
  if (!process.env.PI_SCREENSHOT) return;
  // The panel is transparent and its text is white; the host provides this background.
  await run(`document.documentElement.style.background = '#1e1f22'`);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(process.env.PI_SCREENSHOT, `${name}.png`), Buffer.from(data, 'base64'));
}

before(async () => {
  if (!browserPath) return;
  web = http.createServer((request, response) => {
    const path = join(ROOT, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (!existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
  });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');

  host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(host, 'listening');
  host.on('connection', (socket) => {
    hostSocket = socket;
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw));
      notify();
    });
  });

  profile = mkdtempSync(join(tmpdir(), 'clima-pro-browser-'));
  // Linux CI restricts the namespaces Chromium's sandbox needs. This only ever loads our own local pages.
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=620,1100', ...sandbox, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const debugUrl = await new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error('browser did not start')), 20_000);
    let log = '';
    browser.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\S+)/);
      if (match) {
        clearTimeout(limit);
        resolve(match[1]);
      }
    });
  });

  const params = new URLSearchParams({ address: '127.0.0.1', port: host.address().port, uuid: ACTION_UUID, key: '0_0', actionid: 'a1', language: 'pt_PT' });
  const pageUrl = `http://127.0.0.1:${web.address().port}/${PLUGIN}/property-inspector/weather/inspector.html?${params}`;
  const created = await fetch(`http://${new URL(debugUrl).host}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' }).then((r) => r.json());
  page = new WebSocket(created.webSocketDebuggerUrl);
  await once(page, 'open');
  page.on('message', (raw) => {
    const reply = JSON.parse(raw);
    if (reply.method === 'Runtime.consoleAPICalled') consoleOutput.push(JSON.stringify(reply.params.args));
    pending.get(reply.id)?.resolve(reply.result);
    pending.delete(reply.id);
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
});

// Chromium's helper processes can outlive the main one and keep writing to the profile. rmSync's own
// retries never list the folder again, so one new file makes all of them fail.
async function removeProfile() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch {
      await sleep(500);
    }
  }
  // A leftover temporary folder says nothing about the panel, so it does not fail the run.
  console.warn(`could not remove ${profile}`);
}

after(async () => {
  page?.close();
  browser?.kill();
  if (browser && browser.exitCode === null) await Promise.race([once(browser, 'exit'), sleep(3000)]);
  for (const client of host?.clients ?? []) client.terminate();
  host?.close();
  web?.close();
  if (profile) await removeProfile();
});

test('connects, shows itself, and asks for the saved key and status', options, async () => {
  await waitForMessage((m) => m.cmd === 'connected');
  await waitForMessage((m) => m.cmd === 'getGlobalSettings');
  await waitForMessage((m) => m.cmd === 'sendToPlugin' && m.payload?.type === 'hello');
  await until(`!document.querySelector('.uspi-wrapper').classList.contains('hidden')`);
});

test('the page has no background of its own, as the store requires', options, async () => {
  assert.equal(await run(`getComputedStyle(document.body).backgroundColor`), 'rgba(0, 0, 0, 0)');
});

test('the panel appears in the host language', options, async () => {
  await until(`document.querySelector('label[for=apiKey]').textContent === 'Chave da API'`);
  assert.match(await run(`document.querySelector('.disclaimer').textContent`), /fins informativos gerais/);
  assert.equal(await run(`document.querySelector('#location').placeholder`), 'Detetar pelo meu IP');
  assert.equal(await run(`document.querySelector('[value=details]').textContent`), 'Detalhes');
});

test('saved settings fill the form', options, async () => {
  fromHost({ cmd: 'paramfromapp', param: { theme: 'neon', location: 'Rio de Janeiro', screen: 'details', unit: 'f' } });
  await until(`document.querySelector('[name=theme]:checked').value === 'neon'`);
  assert.equal(await run(`document.querySelector('#location').value`), 'Rio de Janeiro');
  assert.equal(await run(`document.querySelector('#screen').value`), 'details');
  assert.equal(await run(`document.querySelector('#unit').value`), 'f');
});

test('the panel offers no choice of how often to update', options, async () => {
  assert.equal(await run(`document.querySelector('#refresh')`), null);
});

test('the panel leaves the name on the key to the title field in Studio', options, async () => {
  assert.equal(await run(`document.querySelector('#label')`), null);
});

test('the saved key fills its field, hidden', options, async () => {
  fromHost({ cmd: 'didReceiveGlobalSettings', settings: { apiKey: SAVED_KEY } });
  await until(`document.querySelector('#apiKey').value === ${JSON.stringify(SAVED_KEY)}`);
  assert.equal(await run(`document.querySelector('#apiKey').type`), 'password');
});

test('the version from the plugin shows up', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'about', version: '1.2.3' } });
  await until(`document.querySelector('#version').textContent === 'Clima Pro v1.2.3'`);
});

test('status from the plugin shows up, and a place name cannot inject markup', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'status', state: 'ok', place: '<img src=x onerror="window.pwned=1">' } });
  await until(`document.querySelector('#status').textContent.includes('Ligado')`);
  assert.equal(await run(`document.querySelector('#status img')`), null);
  assert.equal(await run(`document.querySelector('#status').className`), 'tip success');
  await sleep(50);
  assert.equal(await run(`window.pwned ?? null`), null);
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'status', state: 'ok', place: 'Rio de Janeiro, Brazil' } });
  await until(`document.querySelector('#status').textContent.includes('Rio de Janeiro')`);
  await screenshot('panel');
});

test('errors read as errors', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'status', state: 'auth' } });
  await until(`document.querySelector('#status').className === 'tip error'`);
  assert.match(await run(`document.querySelector('#status').textContent`), /recusou/);
  await screenshot('panel-error');
});

test('a malformed key gets feedback and is not saved', options, async () => {
  messages = [];
  await type('#apiKey', 'not a key!');
  await until(`document.querySelector('#status').textContent.includes('não parece')`);
  await sleep(100);
  assert.equal(messages.find((m) => m.cmd === 'setGlobalSettings'), undefined);
});

test('a valid key is saved globally, never in the settings of this key', options, async () => {
  messages = [];
  await type('#apiKey', '  NEWKEY0123456789  ');
  const saved = await waitForMessage((m) => m.cmd === 'setGlobalSettings');
  assert.deepEqual(saved.settings, { apiKey: 'NEWKEY0123456789' });
  assert.equal(messages.find((m) => m.cmd === 'paramfromplugin'), undefined);
});

test('clearing the key tells the plugin', options, async () => {
  messages = [];
  await type('#apiKey', '');
  const saved = await waitForMessage((m) => m.cmd === 'setGlobalSettings');
  assert.deepEqual(saved.settings, { apiKey: '' });
  await run(`document.querySelector('#apiKey').blur()`);
});

test('choosing a theme saves on the spot, with every other setting intact and no key', options, async () => {
  messages = [];
  await run(`document.querySelector('[name=theme][value=lcd]').click()`);
  const saved = await waitForMessage((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.theme, 'lcd');
  assert.equal(saved.param.location, 'Rio de Janeiro');
  assert.equal(saved.param.screen, 'details');
  assert.equal(saved.param.apiKey, undefined);
});

test('a press on the key updates the panel', options, async () => {
  fromHost({ cmd: 'paramfromplugin', param: { theme: 'lcd', location: 'Rio de Janeiro', screen: 'now', unit: 'f' } });
  await until(`document.querySelector('#screen').value === 'now'`);
});

test('typing a place saves it and asks for suggestions', options, async () => {
  messages = [];
  await type('#location', 'Sao Pa');
  const search = await waitForMessage((m) => m.cmd === 'sendToPlugin' && m.payload?.type === 'search');
  assert.equal(search.payload.q, 'Sao Pa');
  const saved = await waitForMessage((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.location, 'Sao Pa');
});

test('too few letters do not spend an API call', options, async () => {
  messages = [];
  await type('#location', 'Sa');
  await sleep(700);
  assert.equal(messages.find((m) => m.cmd === 'sendToPlugin'), undefined);
});

const suggestionsOpen = `!document.querySelector('#suggestionRow').classList.contains('hidden')`;
const suggestionReply = (q, items) => fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'suggestions', q, items } });

test('suggestions show as plain text that is readable against its background', options, async () => {
  assert.equal(await run(suggestionsOpen), false);
  suggestionReply('Sa', ['São Paulo, Brazil', '<b>x</b>']);
  await until(`document.querySelectorAll('.suggestion').length === 2`);
  assert.equal(await run(`getComputedStyle(document.querySelector('#suggestionRow')).display`), 'flex');
  assert.equal(await run(`document.querySelector('.suggestion').textContent`), 'São Paulo, Brazil');
  assert.equal(await run(`document.querySelector('#suggestions b')`), null);
  assert.equal(await run(`getComputedStyle(document.querySelector('.suggestion')).color`), 'rgb(255, 255, 255)');
  assert.equal(await run(`getComputedStyle(document.querySelector('.suggestion')).backgroundColor`), 'rgb(24, 25, 27)');
  await screenshot('panel-suggestions');
});

test('a reply for text that has since changed is ignored', options, async () => {
  suggestionReply('Something else', ['Something else, Nowhere']);
  await sleep(100);
  assert.equal(await run(`document.querySelector('.suggestion').textContent`), 'São Paulo, Brazil');
});

test('choosing a suggestion fills the place, saves it and closes the list', options, async () => {
  messages = [];
  await run(`document.querySelector('.suggestion').click()`);
  const saved = await waitForMessage((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.location, 'São Paulo, Brazil');
  assert.equal(await run(`document.querySelector('#location').value`), 'São Paulo, Brazil');
  assert.equal(await run(suggestionsOpen), false);
  assert.equal(await run(`getComputedStyle(document.querySelector('#suggestionRow')).display`), 'none');
});

test('a reply with nothing to suggest leaves the list closed', options, async () => {
  suggestionReply('São Paulo, Brazil', []);
  await sleep(100);
  assert.equal(await run(suggestionsOpen), false);
});

test('Escape closes the list', options, async () => {
  suggestionReply('São Paulo, Brazil', ['São Paulo, Brazil']);
  await until(suggestionsOpen);
  await run(`document.querySelector('#location').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal(await run(suggestionsOpen), false);
});

test('erasing down to too few letters closes the list', options, async () => {
  suggestionReply('São Paulo, Brazil', ['São Paulo, Brazil']);
  await until(suggestionsOpen);
  await type('#location', 'Sa');
  await until(`document.querySelector('#suggestionRow').classList.contains('hidden')`);
});

test('links open in the browser through the host, not inside the panel', options, async () => {
  messages = [];
  const before = await run(`location.href`);
  await run(`document.querySelector('#attribution').click()`);
  const open = await waitForMessage((m) => m.cmd === 'openurl');
  assert.equal(open.url, 'https://www.weatherapi.com/');
  await run(`document.querySelector('#getKey').click()`);
  await waitForMessage((m) => m.cmd === 'openurl' && m.url.endsWith('/signup'));
  assert.equal(await run(`location.href`), before);
});

test('the key never reaches the browser console, where debug tools and logs can read it', options, async () => {
  await sleep(100);
  for (const line of consoleOutput) {
    assert.ok(!line.includes(SAVED_KEY) && !line.includes('NEWKEY0123456789'), line);
  }
});

test('every theme picture loaded', options, async () => {
  assert.equal(await run(`[...document.querySelectorAll('.theme img')].every((img) => img.complete && img.naturalWidth === 144)`), true);
  assert.equal(await run(`document.querySelectorAll('.theme img').length`), 6);
});
