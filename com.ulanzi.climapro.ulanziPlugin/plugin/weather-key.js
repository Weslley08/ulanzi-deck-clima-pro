// One instance per key on the deck.
import { ALERT_LABELS } from './render/alert-layer.js';
import { renderFace } from './render/renderer.js';
import { SCREENS, normalizeSettings, placeQuery } from './settings.js';
import { alertEndTime, buildAlertPageView, buildMessageView, buildWeatherView, withAlert } from './view.js';
import { searchLocations } from './weather-api.js';

const MIN_SEARCH_LENGTH = 3;
// The forecast is what a key shows. An alert page opened and forgotten goes back by itself.
export const ALERT_PAGE_RETURN_MS = 30_000;
// Slow enough to read as a glow, and only one small image a second for as long as an extreme alert lasts.
// Bright, middle, dim, middle: three images, each rendered once and then reused.
export const PULSE_STEP_MS = 1_000;
const PULSE_FRAMES = [0, 1, 2, 1];

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
  #alerts = null;
  #alertPage = null;
  #alertPageTimer = null;
  #pulse = 0;
  #pulseTimer = null;
  #lastIcon = null;
  #renderToken = 0;
  #lastStatus = null;
  #lastAlertStatus = null;

  constructor(context, { host, hub, alerts, version, render = renderFace, search = searchLocations, timers = globalThis }) {
    this.context = context;
    this.host = host;
    this.hub = hub;
    this.alertService = alerts;
    this.version = version;
    this.renderImage = render;
    this.search = search;
    this.timers = timers;
  }

  updateSettings(param) {
    const next = normalizeSettings(param);
    const samePlace = this.#subscription && placeQuery(next) === placeQuery(this.settings);
    this.settings = next;
    this.#alerts ??= this.alertService.subscribe({ active: this.active, onUpdate: () => this.onAlertsChanged() });
    if (!samePlace) {
      this.#subscription?.close();
      // Until the new place is known, the old place's alerts must not appear under its name.
      this.#alerts.setPlace(null);
      this.#subscription = this.hub.subscribe(placeQuery(next), {
        active: this.active,
        onUpdate: () => this.onWeatherChanged(),
      });
    }
    this.onWeatherChanged();
  }

  onWeatherChanged() {
    this.#followPlace();
    this.pushStatus();
    // The key's setting can change what the panel should say without changing any alert.
    this.pushAlerts();
    this.render();
  }

  /** The place for alerts is always the one the weather reply names, so there is no second one to set. */
  #followPlace() {
    this.#alerts.setEnabled(this.settings.alerts !== 'off');
    // Weather data ages out after 60 minutes but the place stays the same, so alerts carry on without it.
    const location = this.#subscription.snapshot().data?.location;
    if (location) this.#alerts.setPlace(location);
  }

  onAlertsChanged() {
    if (this.#alertPage !== null && this.#alertPage >= this.#alerts.snapshot.alerts.length) this.#closeAlertPage();
    this.#syncPulse();
    this.pushAlerts();
    this.render();
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.#subscription?.setActive(active);
    this.#alerts?.setActive(active);
    this.#syncPulse();
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
    const leftAlertPage = this.#alertPage !== null;
    if (this.#stepThroughAlerts()) return;
    if (!snapshot.data) {
      // Still loading is not a failure, but a key that cannot show weather is.
      if (leftAlertPage) this.render();
      else if (this.hub.keyState === 'missing' || snapshot.error) this.host.showAlert(this.context);
      return;
    }
    const next = SCREENS[(SCREENS.indexOf(this.settings.screen) + 1) % SCREENS.length];
    this.settings = { ...this.settings, screen: next };
    this.host.sendParamFromPlugin(this.settings, this.context);
    this.render();
  }

  /**
   * While alerts are active, a press opens them before moving on to the next forecast screen. A page is
   * never saved in the settings, so a restart always comes back to the forecast.
   * @returns {boolean} whether the press landed on an alert page
   */
  #stepThroughAlerts() {
    const next = this.#alertPage === null ? 0 : this.#alertPage + 1;
    if (next >= this.#alerts.snapshot.alerts.length) {
      this.#closeAlertPage();
      this.#syncPulse();
      return false;
    }
    this.#alertPage = next;
    this.timers.clearTimeout(this.#alertPageTimer);
    this.#alertPageTimer = this.timers.setTimeout(() => {
      this.#closeAlertPage();
      this.#syncPulse();
      this.render();
    }, ALERT_PAGE_RETURN_MS);
    this.#syncPulse();
    this.render();
    return true;
  }

  #closeAlertPage() {
    this.timers.clearTimeout(this.#alertPageTimer);
    this.#alertPageTimer = null;
    this.#alertPage = null;
  }

  /** Runs only while an extreme alert is actually on screen. */
  #syncPulse() {
    const wanted = this.active && this.#alertPage === null && this.#alerts?.snapshot.alerts[0]?.severity === 'EXTREME';
    if (wanted === (this.#pulseTimer !== null)) return;
    if (wanted) {
      this.#pulseTimer = this.timers.setInterval(() => {
        this.#pulse = (this.#pulse + 1) % PULSE_FRAMES.length;
        this.render();
      }, PULSE_STEP_MS);
    } else {
      this.timers.clearInterval(this.#pulseTimer);
      this.#pulseTimer = null;
      this.#pulse = 0;
    }
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
    const { settings } = this;
    const snapshot = this.#alerts.snapshot;
    const forecast = this.#forecastView();
    const page = this.#alertPage === null ? null : snapshot.alerts[this.#alertPage];
    if (page) return buildAlertPageView(page, this.#alertPage, snapshot.alerts.length, settings, forecast);
    return withAlert(forecast, snapshot, PULSE_FRAMES[this.#pulse]);
  }

  #forecastView() {
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
    // The region tells apart places that share a name.
    const { name, region, country } = data.location;
    return { type: 'status', state: stale ? error.kind : 'ok', place: [name, region, country].filter(Boolean).join(', ') };
  }

  /** The inspector only exists while the key is selected, and the host drops messages sent without one. */
  pushStatus(force = false) {
    const status = this.status();
    const serialized = JSON.stringify(status);
    if (!force && serialized === this.#lastStatus) return;
    this.#lastStatus = serialized;
    this.host.sendToPropertyInspector(status, this.context);
  }

  alertStatus() {
    const { state, alerts, checkedAt, country } = this.#alerts.snapshot;
    return {
      type: 'alerts',
      state: state === 'off' ? this.#whyNoAlertCheck() : state,
      country,
      checkedAt,
      items: alerts.map((alert) => ({
        id: alert.id,
        severity: alert.severity,
        level: ALERT_LABELS[alert.severity],
        title: alert.title,
        description: alert.description,
        instructions: alert.instructions,
        issuer: alert.issuer,
        area: alert.areaDescription,
        until: alertEndTime(alert.expiresAt),
        url: alert.officialUrl,
      })),
    };
  }

  #whyNoAlertCheck() {
    return this.settings.alerts === 'off' ? 'disabled' : 'checking';
  }

  pushAlerts(force = false) {
    const status = this.alertStatus();
    const serialized = JSON.stringify(status);
    if (!force && serialized === this.#lastAlertStatus) return;
    this.#lastAlertStatus = serialized;
    this.host.sendToPropertyInspector(status, this.context);
  }

  async onInspectorMessage(payload) {
    if (payload?.type === 'hello') {
      this.pushStatus(true);
      this.pushAlerts(true);
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
    this.#closeAlertPage();
    this.#syncPulse();
    this.#subscription?.close();
    this.#subscription = null;
    this.#alerts?.close();
    this.#alerts = null;
  }
}
