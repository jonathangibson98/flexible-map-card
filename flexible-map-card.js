import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@3.2.1/index.js?module";

const HOLD_MS = 600;
const MOVE_TOLERANCE_PX = 10;

// ============================================================================
// MAIN CARD
// ============================================================================
class FlexibleMapCard extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      config: { attribute: false },
    };
  }

  constructor() {
    super();
    this._resizeObserver = null;
    this._mapEl = null;
    this._resizeTimer = null;
    this._lastRatio = null;
    this._entitiesKey = "";
    this._holdTimer = null;
    this._holdStart = null;
    this._hideTimer = null;
    this._observers = [];
    this._observed = new WeakSet();
    this._lastLogLen = 0;
  }

  static async getConfigElement() {
    return document.createElement("flexible-map-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:flexible-map-card",
      entities: [],
      add_all_entities: false,
      card_height: 250,
      full_width: true,
      card_width: 400,
      default_zoom: 14,
      theme_mode: "auto",
      map_style: "default",
      hours_to_show: 0,
      auto_fit: false,
      fit_zones: false,
      show_zone_radius: false,
      scale_ruler: false,
      cluster: true,
      hide_zoom_controls: false,
      hide_orient_buttons: false,
      hold_action: { action: "none" },
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.config = { card_height: 250, full_width: true, card_width: 400, ...config };
    this._mapEl = null;
    this._lastRatio = null;
    this._entitiesKey = "";
    this._disconnectObservers();
  }

  getGridOptions() {
    const height = parseInt(this.config?.card_height, 10) || 250;
    return {
      rows: Math.max(2, Math.ceil(height / 50)),
      columns: 6,
      min_rows: 2,
      min_columns: 3,
    };
  }

  getCardSize() {
    const height = parseInt(this.config?.card_height, 10);
    return isNaN(height) ? 4 : Math.ceil(height / 50);
  }

  get _cardHeightPx() {
    const parsed = parseInt(this.config?.card_height, 10);
    return isNaN(parsed) ? 250 : parsed;
  }

  get _wrapperWidthCss() {
    if (this.config?.full_width !== false) return "100%";
    const w = parseInt(this.config?.card_width, 10);
    return `${isNaN(w) ? 400 : w}px`;
  }

  // ------------------------------------------------------------------------
  // Entities (including the "add all entities" toggle)
  // ------------------------------------------------------------------------
  _collectEntities() {
    const configured = this.config.entities || [];
    if (!this.config.add_all_entities || !this.hass) return configured;

    const have = new Set(
      configured.map((e) => (typeof e === "string" ? e : e.entity))
    );
    const registry = this.hass.entities || {};

    // Gather all device trackers that are assigned to a person entity
    const personTrackers = new Set();
    for (const [id, st] of Object.entries(this.hass.states)) {
      if (id.startsWith("person.")) {
        const trackers = st.attributes?.device_trackers;
        if (Array.isArray(trackers)) {
          trackers.forEach((t) => personTrackers.add(t));
        }
      }
    }

    const extra = [];
    for (const [id, st] of Object.entries(this.hass.states)) {
      if (have.has(id)) continue;
      // Skip anything you've hidden in the entity registry (like the native card)
      if (registry[id]?.hidden) continue;
      // Skip device trackers that are used by a person entity
      if (personTrackers.has(id)) continue;

      const a = st.attributes || {};
      if (a.latitude !== undefined && a.longitude !== undefined) extra.push(id);
    }
    return [...configured, ...extra];
  }

  _entitiesKeyOf(list) {
    return list.map((e) => (typeof e === "string" ? e : e.entity)).join(",");
  }

  _buildMapConfig(aspectRatio) {
    const c = this.config;
    const entities = this._collectEntities();
    this._entitiesKey = this._entitiesKeyOf(entities);
    return {
      type: "map",
      title: c.title,
      aspect_ratio: aspectRatio || c.aspect_ratio,
      entities,
      geo_location_sources: c.geo_location_sources,
      auto_fit: c.auto_fit ?? false,
      fit_zones: c.fit_zones ?? false,
      show_zone_radius: c.show_zone_radius ?? false,
      default_zoom: c.default_zoom ?? 14,
      scale_ruler: c.scale_ruler ?? false,
      theme_mode: c.theme_mode || "auto",
      map_style: c.map_style || "default",
      hours_to_show: c.hours_to_show ?? 0,
      cluster: c.cluster ?? true,
    };
  }

  async _ensureMap() {
    const wrapper = this.shadowRoot?.querySelector(".map-wrapper");
    if (!wrapper || !this.config || !this.hass) return;

    const width = wrapper.clientWidth || 400;
    const height = this._cardHeightPx;
    const ratio = `${Math.round(width)}:${Math.round(height)}`;

    if (this._mapEl && this._lastRatio === ratio) return;

    const mapConfig = this._buildMapConfig(ratio);

    if (this._mapEl) {
      this._mapEl.setConfig(mapConfig);
      this._lastRatio = ratio;
      this._scheduleHideApply();
      return;
    }

    const helpers = await window.loadCardHelpers();
    const el = helpers.createCardElement(mapConfig);
    el.hass = this.hass;
    this._mapEl = el;
    this._lastRatio = ratio;

    wrapper.innerHTML = "";
    wrapper.appendChild(el);
    this._scheduleHideApply();
    [400, 1200, 3000].forEach((ms) => setTimeout(() => this._applyHides(), ms));
  }

  // ------------------------------------------------------------------------
  // Hiding the zoom / orient buttons
  // The buttons live inside nested shadow roots, so we walk every shadow root
  // under the map, hide anything that looks like a zoom or orient control,
  // and keep watching in case the map re-renders.
  // ------------------------------------------------------------------------
  _attrText(el) {
    return [
      el.getAttribute?.("title"),
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("label"),
      el.label,
    ]
      .filter((v) => typeof v === "string")
      .join(" ")
      .toLowerCase();
  }

  _classText(el) {
    return (el.getAttribute?.("class") || "").toLowerCase();
  }

  _hideEl(el) {
    // If the match lives inside an <ha-icon-button>, hide the whole button
    const host = el.getRootNode?.()?.host;
    const target = host && host.localName === "ha-icon-button" ? host : el;
    target.style.setProperty("display", "none", "important");
  }

  _isZoom(el) {
    if (/leaflet-control-zoom|ctrl-zoom|control-zoom/.test(this._classText(el))) {
      return true;
    }
    const clickable =
      ["a", "button", "ha-icon-button", "mwc-icon-button"].includes(el.localName) ||
      el.getAttribute?.("role") === "button";
    return clickable && /\bzoom (in|out)\b/.test(this._attrText(el));
  }

  _isOrient(el) {
    if (/compass|geolocate|reset|recenter/.test(this._classText(el))) return true;
    // The recenter button the native hui-map-card floats over the map
    const host = el.getRootNode?.()?.host;
    if (el.localName === "ha-icon-button" && host?.localName === "hui-map-card") {
      return true;
    }
    const clickable =
      ["a", "button", "ha-icon-button", "mwc-icon-button"].includes(el.localName) ||
      el.getAttribute?.("role") === "button";
    return (
      clickable &&
      /(north|compass|orient|reset focus|re-?center|reset map)/.test(this._attrText(el))
    );
  }

  _walkShadow(root, fn, seen) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    root.querySelectorAll("*").forEach((el) => {
      fn(el);
      if (el.shadowRoot) this._walkShadow(el.shadowRoot, fn, seen);
    });
  }

  _applyHides() {
    if (!this._mapEl || !this.config) return;
    const { hide_zoom_controls: hz, hide_orient_buttons: ho, debug } = this.config;
    if (!hz && !ho) return;

    const log = [];
    const visit = (el) => {
      if (debug) log.push(`${el.localName} | class="${this._classText(el)}" | ${this._attrText(el)}`);
      if (hz && this._isZoom(el)) this._hideEl(el);
      if (ho && this._isOrient(el)) this._hideEl(el);
    };

    const seen = new Set();
    visit(this._mapEl);
    this._walkShadow(this._mapEl.shadowRoot, visit, seen);

    // Watch every shadow root we found so re-renders get re-hidden
    seen.forEach((root) => {
      if (this._observed.has(root)) return;
      this._observed.add(root);
      const obs = new MutationObserver(() => this._scheduleHideApply());
      obs.observe(root, { childList: true, subtree: true });
      this._observers.push(obs);
    });

    if (debug && log.length !== this._lastLogLen) {
      this._lastLogLen = log.length;
      console.info("[flexible-map-card] elements inside map:", log);
    }
  }

  _scheduleHideApply() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._applyHides(), 150);
  }

  _disconnectObservers() {
    this._observers.forEach((o) => o.disconnect());
    this._observers = [];
    this._observed = new WeakSet();
    clearTimeout(this._hideTimer);
  }

  // ------------------------------------------------------------------------
  // Hold action
  // ------------------------------------------------------------------------
  _hasHold() {
    const a = this.config?.hold_action;
    return a && a.action && a.action !== "none";
  }

  _onPointerDown(ev) {
    if (!this._hasHold()) return;
    this._holdStart = { x: ev.clientX, y: ev.clientY };
    clearTimeout(this._holdTimer);
    this._holdTimer = setTimeout(() => {
      this._holdStart = null;
      if (navigator.vibrate) navigator.vibrate(30);
      this._runAction(this.config.hold_action);
    }, HOLD_MS);
  }

  _onPointerMove(ev) {
    if (!this._holdStart) return;
    const dx = ev.clientX - this._holdStart.x;
    const dy = ev.clientY - this._holdStart.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) this._cancelHold();
  }

  _cancelHold() {
    clearTimeout(this._holdTimer);
    this._holdStart = null;
  }

  _onContextMenu(ev) {
    // Stops the phone's long-press menu from fighting the hold action
    if (this._hasHold()) ev.preventDefault();
  }

  _runAction(cfg) {
    const hass = this.hass;
    if (!cfg || !hass) return;

    const firstEntity = () => {
      const e = (this.config.entities || [])[0];
      return typeof e === "string" ? e : e?.entity;
    };

    switch (cfg.action) {
      case "more-info": {
        const entityId = cfg.entity || firstEntity();
        if (!entityId) return;
        this.dispatchEvent(
          new CustomEvent("hass-more-info", {
            detail: { entityId },
            bubbles: true,
            composed: true,
          })
        );
        break;
      }
      case "navigate": {
        if (!cfg.navigation_path) return;
        history.pushState(null, "", cfg.navigation_path);
        window.dispatchEvent(
          new CustomEvent("location-changed", { detail: { replace: false } })
        );
        break;
      }
      case "url": {
        if (cfg.url_path) window.open(cfg.url_path, "_blank");
        break;
      }
      case "toggle": {
        const entityId = cfg.entity || firstEntity();
        if (entityId) hass.callService("homeassistant", "toggle", { entity_id: entityId });
        break;
      }
      case "perform-action":
      case "call-service": {
        const svc = cfg.perform_action || cfg.service;
        if (!svc || !svc.includes(".")) return;
        const [domain, service] = svc.split(".");
        hass.callService(domain, service, cfg.data || cfg.service_data || {}, cfg.target);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------
  firstUpdated() {
    const wrapper = this.shadowRoot.querySelector(".map-wrapper");
    if (!wrapper) return;

    this._resizeObserver = new ResizeObserver(() => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._ensureMap(), 150);
    });
    this._resizeObserver.observe(wrapper);

    // Capture phase so the map's own drag handling can't swallow these
    wrapper.addEventListener("pointerdown", (e) => this._onPointerDown(e), true);
    wrapper.addEventListener("pointermove", (e) => this._onPointerMove(e), true);
    wrapper.addEventListener("pointerup", () => this._cancelHold(), true);
    wrapper.addEventListener("pointercancel", () => this._cancelHold(), true);
    wrapper.addEventListener("pointerleave", () => this._cancelHold(), true);
    wrapper.addEventListener("contextmenu", (e) => this._onContextMenu(e), true);

    this._ensureMap();
  }

  updated(changed) {
    if (changed.has("config")) {
      this._ensureMap();
    }
    if (changed.has("hass")) {
      if (this._mapEl) this._mapEl.hass = this.hass;
      if (!this._mapEl && this.hass) this._ensureMap();

      // "Add all entities": rebuild only if the set of located entities changed
      if (this._mapEl && this.config?.add_all_entities) {
        const key = this._entitiesKeyOf(this._collectEntities());
        if (key !== this._entitiesKey) {
          this._mapEl.setConfig(this._buildMapConfig(this._lastRatio));
          this._scheduleHideApply();
        }
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    clearTimeout(this._resizeTimer);
    clearTimeout(this._holdTimer);
    this._disconnectObservers();
  }

  static get styles() {
    return css`
      ha-card {
        overflow: hidden;
        height: 100%;
        background: transparent;
        box-shadow: none;
        border: none;
      }
      .map-wrapper {
        position: relative;
        margin: 0 auto;
        max-width: 100%;
        touch-action: pan-x pan-y;
        -webkit-touch-callout: none;
        user-select: none;
      }
    `;
  }

  render() {
    if (!this.hass || !this.config) return html``;
    return html`
      <ha-card>
        <div
          class="map-wrapper"
          style="height: ${this._cardHeightPx}px; width: ${this._wrapperWidthCss};"
        ></div>
      </ha-card>
    `;
  }
}

// ============================================================================
// EDITOR (ha-form, so it survives HA frontend changes)
// ============================================================================
class FlexibleMapCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      _config: { attribute: false },
    };
  }

  setConfig(config) {
    this._config = config;
  }

  get _schema() {
    const opts = (arr) =>
      arr.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
    return [
      { name: "title", selector: { text: {} } },
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "add_all_entities", selector: { boolean: {} } },
      {
        name: "card_height",
        selector: {
          number: { min: 100, max: 1000, step: 10, mode: "slider", unit_of_measurement: "px" },
        },
      },
      { name: "full_width", selector: { boolean: {} } },
      {
        name: "card_width",
        selector: {
          number: { min: 100, max: 1400, step: 10, mode: "slider", unit_of_measurement: "px" },
        },
      },
      {
        name: "default_zoom",
        selector: { number: { min: 1, max: 20, step: 1, mode: "slider" } },
      },
      {
        name: "hours_to_show",
        selector: {
          number: { min: 0, max: 168, step: 1, mode: "slider", unit_of_measurement: "h" },
        },
      },
      {
        name: "theme_mode",
        selector: { select: { mode: "dropdown", options: opts(["auto", "light", "dark"]) } },
      },
      {
        name: "map_style",
        selector: {
          select: {
            mode: "dropdown",
            options: opts(["default", "colorful", "natural", "muted", "gray", "toner"]),
          },
        },
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "auto_fit", selector: { boolean: {} } },
          { name: "fit_zones", selector: { boolean: {} } },
          { name: "show_zone_radius", selector: { boolean: {} } },
          { name: "scale_ruler", selector: { boolean: {} } },
          { name: "cluster", selector: { boolean: {} } },
          { name: "hide_zoom_controls", selector: { boolean: {} } },
          { name: "hide_orient_buttons", selector: { boolean: {} } },
        ],
      },
      {
        name: "hold_action",
        selector: { ui_action: { default_action: "none" } },
      },
    ];
  }

  _label = (schema) => {
    const labels = {
      title: "Title (optional)",
      entities: "Entities",
      add_all_entities: "Add all entities (everything with a location)",
      card_height: "Card height",
      full_width: "Full width",
      card_width: "Card width (when Full width is off)",
      default_zoom: "Default zoom",
      hours_to_show: "History path (hours)",
      theme_mode: "Theme mode",
      map_style: "Map style",
      auto_fit: "Auto fit",
      fit_zones: "Fit zones",
      show_zone_radius: "Show zone radius",
      scale_ruler: "Scale ruler",
      cluster: "Cluster markers",
      hide_zoom_controls: "Hide zoom buttons",
      hide_orient_buttons: "Hide orient / recenter buttons",
      hold_action: "Hold action",
    };
    return labels[schema.name] || schema.name;
  };

  _valueChanged(ev) {
    ev.stopPropagation();
    this._config = ev.detail.value;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.hass || !this._config) return html``;
    const data = {
      card_height: 250,
      full_width: true,
      card_width: 400,
      default_zoom: 14,
      hours_to_show: 0,
      theme_mode: "auto",
      map_style: "default",
      cluster: true,
      ...this._config,
      entities: (this._config.entities || []).map((e) =>
        typeof e === "string" ? e : e.entity
      ),
    };
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${this._schema}
        .computeLabel=${this._label}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }
}

customElements.define("flexible-map-card", FlexibleMapCard);
customElements.define("flexible-map-card-editor", FlexibleMapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "flexible-map-card",
  name: "Flexible Vector Map Card",
  description: "Dynamic resizable map card built for the vector map engine.",
  preview: true,
});
