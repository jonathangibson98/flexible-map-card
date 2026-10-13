import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@3.2.1/index.js?module";

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
  }

  static async getConfigElement() {
    return document.createElement("flexible-map-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:flexible-map-card",
      entities: [],
      card_height: 250,
      default_zoom: 14,
      theme_mode: "auto",
      map_style: "default",
      hours_to_show: 0,
      auto_fit: false,
      fit_zones: false,
      show_zone_radius: false,
      scale_ruler: false,
      cluster: true,
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.config = { card_height: 250, ...config };
    // Force the inner map to rebuild with the new config
    this._mapEl = null;
    this._lastRatio = null;
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
    const h = this.config?.card_height;
    if (typeof h === "number") return h;
    const parsed = parseInt(h, 10);
    return isNaN(parsed) ? 250 : parsed;
  }

  _buildMapConfig(aspectRatio) {
    const c = this.config;
    return {
      type: "map",
      title: c.title,
      aspect_ratio: aspectRatio || c.aspect_ratio,
      entities: c.entities || [],
      geo_location_sources: c.geo_location_sources,
      show_all: c.show_all,
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
    if (!wrapper || !this.config) return;

    const width = wrapper.clientWidth || 400;
    const height = this._cardHeightPx;
    const ratio = `${Math.round(width)}:${Math.round(height)}`;

    // Already built and nothing changed
    if (this._mapEl && this._lastRatio === ratio) return;

    const mapConfig = this._buildMapConfig(ratio);

    if (this._mapEl) {
      // Just update config on the existing element (cheap resize path)
      this._mapEl.setConfig(mapConfig);
      this._lastRatio = ratio;
      return;
    }

    // First build: use HA's helper so hui-map-card is guaranteed to be loaded
    const helpers = await window.loadCardHelpers();
    const el = helpers.createCardElement(mapConfig);
    el.hass = this.hass;
    this._mapEl = el;
    this._lastRatio = ratio;

    wrapper.innerHTML = "";
    wrapper.appendChild(el);
  }

  firstUpdated() {
    const wrapper = this.shadowRoot.querySelector(".map-wrapper");
    if (!wrapper) return;

    this._resizeObserver = new ResizeObserver(() => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._ensureMap(), 150);
    });
    this._resizeObserver.observe(wrapper);

    this._ensureMap();
  }

  updated(changed) {
    if (changed.has("config")) {
      this._ensureMap();
    }
    if (changed.has("hass") && this._mapEl) {
      this._mapEl.hass = this.hass;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    clearTimeout(this._resizeTimer);
  }

  static get styles() {
    return css`
      ha-card {
        overflow: hidden;
        height: 100%;
      }
      .map-wrapper {
        width: 100%;
        position: relative;
      }
    `;
  }

  render() {
    if (!this.hass || !this.config) return html``;
    return html`
      <ha-card>
        <div class="map-wrapper" style="height: ${this._cardHeightPx}px;"></div>
      </ha-card>
    `;
  }
}

// ============================================================================
// EDITOR (uses ha-form so it survives HA frontend changes)
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
      {
        name: "card_height",
        selector: {
          number: { min: 100, max: 1000, step: 10, mode: "slider", unit_of_measurement: "px" },
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
        ],
      },
    ];
  }

  _label = (schema) => {
    const labels = {
      title: "Title (optional)",
      entities: "Entities",
      card_height: "Card height",
      default_zoom: "Default zoom",
      hours_to_show: "History path (hours)",
      theme_mode: "Theme mode",
      map_style: "Map style",
      auto_fit: "Auto fit",
      fit_zones: "Fit zones",
      show_zone_radius: "Show zone radius",
      scale_ruler: "Scale ruler",
      cluster: "Cluster markers",
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
      default_zoom: 14,
      hours_to_show: 0,
      theme_mode: "auto",
      map_style: "default",
      cluster: true,
      ...this._config,
      // ha-form's entity picker wants plain strings
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
