// The SDK writes every message to the console, including the API key.
for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};

const API_KEY_FORMAT = /^[A-Za-z0-9]{10,64}$/;
const DEFAULTS = { theme: 'sky', location: '', placeId: '', unit: 'c', screen: 'now', alerts: 'on' };
const MIN_SEARCH_LENGTH = 3;
const SEARCH_DELAY_MS = 500;
const LINKS = { getKey: 'https://www.weatherapi.com/signup', attribution: 'https://www.weatherapi.com/' };

const form = document.querySelector('#property-inspector');
const apiKeyInput = document.querySelector('#apiKey');
const statusLine = document.querySelector('#status');
const suggestions = document.querySelector('#suggestions');
const suggestionRow = document.querySelector('#suggestionRow');
const versionLine = document.querySelector('#version');
const alertStatusLine = document.querySelector('#alertStatus');
const alertList = document.querySelector('#alertList');
const alertNote = document.querySelector('.alert-note');

let settings = { ...DEFAULTS };
let lastStatus = { state: 'loading' };
let keyResent = false;
let alertsOutside = false;

$UD.connect();

function showStatus({ state, place }) {
  lastStatus = { state, place };
  const text = $UD.t(`status.${state}`);
  // Place names come from a remote API: textContent keeps them from being read as markup.
  statusLine.textContent = place ? `${text} ${place}` : text;
  const tone = state === 'ok' ? 'success' : state === 'loading' || state === 'missing' ? 'info' : 'error';
  statusLine.className = `tip ${tone}`;
}

const paragraph = (className, textContent) => Object.assign(document.createElement('p'), { className, textContent });

function alertCard({ severity, level, title, description, instructions, issuer, area, until, url }) {
  const card = Object.assign(document.createElement('div'), { className: 'alert-card' });
  card.dataset.severity = severity;
  // Everything here comes from a remote feed: textContent keeps it from being read as markup.
  card.append(
    paragraph('alert-card-title', `${level} · ${title}`),
    paragraph('alert-card-meta', `${area} · ${$UD.t('alerts.until')} ${until}`),
    paragraph('', description),
  );
  if (instructions) card.append(paragraph('', instructions));
  card.append(paragraph('alert-card-meta', issuer));
  if (url?.startsWith('https://')) {
    const link = Object.assign(document.createElement('a'), { href: '#', textContent: $UD.t('alerts.link') });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      // The host takes a query only through its own parameter.
      const { origin, pathname, searchParams } = new URL(url);
      $UD.openUrl(`${origin}${pathname}`, false, [...searchParams].length ? Object.fromEntries(searchParams) : null);
    });
    card.append(link);
  }
  return card;
}

/**
 * Outside Brazil the option can do nothing, so it reads Off and cannot be changed. A disabled field stays
 * out of what the form saves, so the key's own choice is still there when it gets a place in Brazil.
 */
function syncAlertOption() {
  const option = form.elements.alerts;
  option.disabled = alertsOutside;
  option.value = alertsOutside ? 'off' : settings.alerts;
}

const ALERT_TONES = { clear: 'success', active: 'error', stale: 'error', unavailable: 'error', outside: 'warn' };

function showAlerts({ state, items = [], country }) {
  const text = $UD.t(`alerts.${state}`);
  // The country comes from a remote API: textContent keeps it from being read as markup.
  alertStatusLine.textContent = country ? `${text} ${$UD.t('alerts.country')} ${country}` : text;
  alertStatusLine.className = `tip ${ALERT_TONES[state] ?? 'info'}`;
  alertList.replaceChildren(...items.map(alertCard));
  const outside = state === 'outside';
  alertNote.classList.toggle('hidden', outside);
  if (outside === alertsOutside) return;
  alertsOutside = outside;
  syncAlertOption();
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
  syncAlertOption();
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
  if (message?.type === 'alerts') showAlerts(message);
});

showStatus(lastStatus);
showAlerts({ state: 'checking' });
