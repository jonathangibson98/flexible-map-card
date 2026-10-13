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
    const extra = [];
    for (const [id, st] of Object.entries(this.hass.states)) {
      if (id.startsWith("zone.")) continue; // zones are drawn by the map itself
      if (have.has(id)) continue;
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
  }

  // ------------------------------------------------------------------------
  // Hiding the zoom / orient buttons
  // The buttons live inside nested shadow roots, so we inject a <style> tag
  // into each one. Selectors cover both Leaflet and MapLibre vector maps.
  // ------------------------------------------------------------------------
  _hideCss() {
    const rules = [];
    if (this.config?.hide_zoom_controls) {
      rules.push(
        ".leaflet-control-zoom, .maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .mapboxgl-ctrl-zoom-in, .mapboxgl-ctrl-zoom-out"
      );
    }
    if (this.config?.hide_orient_buttons) {
      rules.push(
        ".maplibregl-ctrl-compass, .maplibregl-ctrl-geolocate, .mapboxgl-ctrl-compass, .reset-button, ha-icon-button.reset-button, .reset-focus, .leaflet-control-reset"
      );
    }
    if (!rules.length) return "";
    return `${rules.join(",\n")} { display: none !important; }`;
  }

  _injectStyle(root, cssText) {
    if (!root) return;
    let tag = root.querySelector("style[data-fmc-hide]");
    if (!tag) {
      tag = document.createElement("style");
      tag.setAttribute("data-fmc-hide", "");
      root.appendChild(tag);
    }
    if (tag.textContent !== cssText) tag.textContent = cssText;
  }

  _applyHides() {
    const mapCard = this._mapEl;
    if (!mapCard) return;
    const cssText = this._hideCss();

    const roots = [];
    if (mapCard.shadowRoot) roots.push(mapCard.shadowRoot);
    const haMap = mapCard.shadowRoot?.querySelector("ha-map");
    if (haMap?.shadowRoot) roots.push(haMap.shadowRoot);

    roots.forEach((r) => this._injectStyle(r, cssText));
  }

  _scheduleHideApply() {
    // The inner map renders async, so retry for a few seconds
    clearInterval(this._hideTimer);
    let tries = 0;
    this._hideTimer = setInterval(() => {
      this._applyHides();
      if (++tries >= 25) clearInterval(this._hideTimer);
    }, 400);
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
    clearInterval(this._hideTimer);
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
