// The SDK writes every message to the console, including the API key.
for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};

const API_KEY_FORMAT = /^[A-Za-z0-9]{10,64}$/;
const DEFAULTS = { theme: 'sky', location: '', placeId: '', unit: 'c', screen: 'now' };
const MIN_SEARCH_LENGTH = 3;
const SEARCH_DELAY_MS = 500;
const LINKS = { getKey: 'https://www.weatherapi.com/signup', attribution: 'https://www.weatherapi.com/' };

const form = document.querySelector('#property-inspector');
const apiKeyInput = document.querySelector('#apiKey');
const statusLine = document.querySelector('#status');
const suggestions = document.querySelector('#suggestions');
const suggestionRow = document.querySelector('#suggestionRow');
const versionLine = document.querySelector('#version');

let settings = { ...DEFAULTS };
let lastStatus = { state: 'loading' };
let keyResent = false;

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

// If this panel has the saved key and the plugin does not, saving it again forwards it to the plugin.
// Only once per panel, so a host that echoes the save cannot start a loop.
function resendSavedKey() {
  const apiKey = apiKeyInput.value.trim();
  if (keyResent || lastStatus.state !== 'missing' || !API_KEY_FORMAT.test(apiKey)) return;
  keyResent = true;
  showStatus({ state: 'loading' });
  $UD.setGlobalSettings({ apiKey });
}

function requestSuggestions() {
  const q = form.elements.location.value.trim();
  if (q.length >= MIN_SEARCH_LENGTH) $UD.sendToPlugin({ type: 'search', q });
  else showSuggestions([]);
}

function showSuggestions(items) {
  suggestions.replaceChildren(...items.map(({ id, label }) => {
    // Place names come from a remote API: textContent keeps them from being read as markup.
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'suggestion', textContent: label });
    button.dataset.placeId = id ?? '';
    return button;
  }));
  suggestionRow.classList.toggle('hidden', !items.length);
}

function chooseSuggestion(event) {
  const choice = event.target.closest('.suggestion');
  if (!choice) return;
  form.elements.location.value = choice.textContent;
  settings.placeId = choice.dataset.placeId;
  showSuggestions([]);
  saveSettings();
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
  // Typed text is a new request, not the place chosen from the list.
  form.elements.location.addEventListener('input', () => {
    settings.placeId = '';
  });
  form.elements.location.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') showSuggestions([]);
  });
  suggestions.addEventListener('click', chooseSuggestion);
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
  resendSavedKey();
});

$UD.onSendToPropertyInspector((jsn) => {
  const message = jsn.payload;
  if (message?.type === 'status') {
    showStatus(message);
    resendSavedKey();
  }
  // A slow reply must not reopen the list after the text has changed or a place was chosen.
  if (message?.type === 'suggestions' && message.q === form.elements.location.value.trim()) showSuggestions(message.items ?? []);
  if (message?.type === 'about') versionLine.textContent = `Clima Pro v${message.version}`;
});

showStatus(lastStatus);
