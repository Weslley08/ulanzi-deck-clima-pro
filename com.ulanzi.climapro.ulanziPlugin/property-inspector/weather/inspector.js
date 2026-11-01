// The SDK writes every message to the console, including the API key.
for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};

const API_KEY_FORMAT = /^[A-Za-z0-9]{10,64}$/;
const DEFAULTS = { theme: 'sky', location: '', label: '', unit: 'c', screen: 'now' };
const MIN_SEARCH_LENGTH = 3;
const SEARCH_DELAY_MS = 500;
const LINKS = { getKey: 'https://www.weatherapi.com/signup', attribution: 'https://www.weatherapi.com/' };

const form = document.querySelector('#property-inspector');
const apiKeyInput = document.querySelector('#apiKey');
const statusLine = document.querySelector('#status');
const suggestions = document.querySelector('#suggestions');
const versionLine = document.querySelector('#version');

let settings = { ...DEFAULTS };
let lastStatus = { state: 'loading' };

$UD.connect();

function showStatus({ state, place }) {
  lastStatus = { state, place };
  const text = $UD.t(`status.${state}`);
  // Place names come from a remote API: textContent keeps them from being read as markup.
  statusLine.textContent = place ? `${text} ${place}` : text;
  const tone = state === 'ok' ? 'success' : state === 'loading' || state === 'missing' ? 'info' : 'error';
  statusLine.className = `tip ${tone}`;
}

function saveSettings() {
  settings = { ...settings, ...Utils.getFormValue(form) };
  $UD.sendParamFromPlugin(settings);
}

function saveApiKey() {
  const apiKey = apiKeyInput.value.trim();
  if (apiKey && !API_KEY_FORMAT.test(apiKey)) {
    showStatus({ state: 'format' });
    return;
  }
  showStatus({ state: apiKey ? 'loading' : 'missing' });
  $UD.setGlobalSettings({ apiKey });
}

function requestSuggestions() {
  const q = form.elements.location.value.trim();
  if (q.length >= MIN_SEARCH_LENGTH) $UD.sendToPlugin({ type: 'search', q });
}

function showSuggestions(items) {
  suggestions.replaceChildren(...items.map((value) => Object.assign(document.createElement('option'), { value })));
}

$UD.onConnected(() => {
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  $UD.getGlobalSettings();
  $UD.sendToPlugin({ type: 'hello' });

  // onConnected can fire more than once.
  if (form.dataset.bound) return;
  form.dataset.bound = 'true';

  form.addEventListener('input', Utils.debounce(saveSettings));
  form.elements.location.addEventListener('input', Utils.debounce(requestSuggestions, SEARCH_DELAY_MS));
  apiKeyInput.addEventListener('input', Utils.debounce(saveApiKey, SEARCH_DELAY_MS));

  // The host opens links in the user's browser; navigating here would replace the panel.
  for (const [id, url] of Object.entries(LINKS)) {
    document.getElementById(id).addEventListener('click', (event) => {
      event.preventDefault();
      $UD.openUrl(url);
    });
  }
});

function loadSettings(jsn) {
  if (!jsn?.param) return;
  settings = { ...DEFAULTS, ...jsn.param };
  Utils.setFormValue(settings, form);
}

$UD.onAdd(loadSettings);
$UD.onParamFromApp(loadSettings);
$UD.onParamFromPlugin(loadSettings);

$UD.onDidReceiveGlobalSettings((jsn) => {
  // Never overwrite what the user is typing.
  if (document.activeElement !== apiKeyInput) apiKeyInput.value = jsn.settings?.apiKey ?? '';
});

$UD.onSendToPropertyInspector((jsn) => {
  const message = jsn.payload;
  if (message?.type === 'status') showStatus(message);
  if (message?.type === 'suggestions') showSuggestions(message.items ?? []);
  if (message?.type === 'about') versionLine.textContent = `Clima Pro v${message.version}`;
});

showStatus(lastStatus);
