// One instance per key on the deck.
import { renderFace } from './render/renderer.js';
import { SCREENS, normalizeSettings } from './settings.js';
import { buildMessageView, buildWeatherView } from './view.js';
import { searchLocations } from './weather-api.js';

const MIN_SEARCH_LENGTH = 3;

const ERROR_FACES = {
  auth: ['Check your API key', 'key'],
  quota: ['API limit reached', 'alert'],
  location: ['Location not found', 'pin'],
  network: ['No connection', 'offline'],
  server: ['Weather unavailable', 'alert'],
};

export class WeatherKey {
  settings = normalizeSettings();
  active = true;
  #subscription = null;
  #lastIcon = null;
  #renderToken = 0;
  #lastStatus = null;

  constructor(context, { host, hub, version, render = renderFace, search = searchLocations }) {
    this.context = context;
    this.host = host;
    this.hub = hub;
    this.version = version;
    this.renderImage = render;
    this.search = search;
  }

  updateSettings(param) {
    const next = normalizeSettings(param);
    const samePlace = this.#subscription && next.location === this.settings.location;
    this.settings = next;
    if (!samePlace) {
      this.#subscription?.close();
      this.#subscription = this.hub.subscribe(next.location, {
        active: this.active,
        onUpdate: () => this.onWeatherChanged(),
      });
    }
    this.onWeatherChanged();
  }

  onWeatherChanged() {
    this.pushStatus();
    this.render();
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.#subscription?.setActive(active);
    if (active) this.redraw();
  }

  /** Forgets what was last sent. The screen may have been repainted or the host restarted. */
  redraw() {
    this.#lastIcon = null;
    this.render();
  }

  run() {
    const snapshot = this.#subscription?.snapshot();
    if (!snapshot) return;
    if (snapshot.error) this.#subscription.refresh();
    if (!snapshot.data) {
      // Still loading is not a failure, but a key that cannot show weather is.
      if (this.hub.keyState === 'missing' || snapshot.error) this.host.showAlert(this.context);
      return;
    }
    const next = SCREENS[(SCREENS.indexOf(this.settings.screen) + 1) % SCREENS.length];
    this.settings = { ...this.settings, screen: next };
    this.host.sendParamFromPlugin(this.settings, this.context);
    this.render();
  }

  async render() {
    if (!this.active) return;
    const token = ++this.#renderToken;
    let icon;
    try {
      icon = await this.renderImage(this.buildView());
    } catch (error) {
      this.host.logMessage(`render failed: ${error?.name}`, 'error');
      return;
    }
    // A newer render already started, so this one is out of date.
    if (token !== this.#renderToken || !this.active || icon === this.#lastIcon) return;
    this.#lastIcon = icon;
    this.host.setBaseDataIcon(this.context, icon);
  }

  buildView() {
    const { settings, hub } = this;
    if (hub.keyState === 'missing') return buildMessageView(settings, this.host.t('Add your API key'), 'key');
    const { data, error, stale } = this.#subscription.snapshot();
    if (data) return buildWeatherView(data, settings, settings.screen, stale);
    if (error) {
      const [message, glyph] = ERROR_FACES[error.kind] ?? ERROR_FACES.server;
      return buildMessageView(settings, this.host.t(message), glyph);
    }
    return buildMessageView(settings, this.host.t('Loading'));
  }

  status() {
    if (this.hub.keyState === 'missing') return { type: 'status', state: 'missing' };
    const { data, error, stale } = this.#subscription.snapshot();
    if (error && !stale) return { type: 'status', state: error.kind };
    if (!data) return { type: 'status', state: 'loading' };
    const { name, country } = data.location;
    return { type: 'status', state: stale ? error.kind : 'ok', place: [name, country].filter(Boolean).join(', ') };
  }

  /** The inspector only exists while the key is selected, and the host drops messages sent without one. */
  pushStatus(force = false) {
    const status = this.status();
    const serialized = JSON.stringify(status);
    if (!force && serialized === this.#lastStatus) return;
    this.#lastStatus = serialized;
    this.host.sendToPropertyInspector(status, this.context);
  }

  async onInspectorMessage(payload) {
    if (payload?.type === 'hello') {
      this.pushStatus(true);
      this.host.sendToPropertyInspector({ type: 'about', version: this.version }, this.context);
      return;
    }
    if (payload?.type !== 'search') return;
    const query = String(payload.q ?? '').trim().slice(0, 80);
    if (query.length < MIN_SEARCH_LENGTH || this.hub.keyState !== 'ready') return;
    let items = [];
    try {
      items = await this.search(this.hub.apiKey, query);
    } catch {
      // Suggestions are a convenience: the saved location still reports its own errors.
    }
    this.host.sendToPropertyInspector({ type: 'suggestions', q: query, items }, this.context);
  }

  destroy() {
    this.active = false;
    this.#renderToken += 1;
    this.#subscription?.close();
    this.#subscription = null;
  }
}
