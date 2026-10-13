import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";

// ============================================================================
// MAIN CARD COMPONENT
// ============================================================================
class FlexibleMapCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
    };
  }

  // Define custom visual editor element for Home Assistant
  static async getConfigElement() {
    return document.createElement("flexible-map-card-editor");
  }

  // Provide default values for the visual editor
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
    this.config = {
      card_height: 250,
      ...config,
    };
  }

  static get styles() {
    return css`
      ha-card {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .map-wrapper {
        width: 100%;
        position: relative;
      }
      hui-map-card {
        width: 100%;
        height: 100%;
        display: block;
      }
    `;
  }

  render() {
    if (!this.hass || !this.config) {
      return html``;
    }

    // Build configuration object containing all native Home Assistant Map options
    const mapConfig = {
      type: "map",
      title: this.config.title,
      aspect_ratio: this.config.aspect_ratio,
      entities: this.config.entities || [],
      geo_location_sources: this.config.geo_location_sources,
      show_all: this.config.show_all,
      auto_fit: this.config.auto_fit ?? false,
      fit_zones: this.config.fit_zones ?? false,
      show_zone_radius: this.config.show_zone_radius ?? false,
      default_zoom: this.config.default_zoom ?? 14,
      scale_ruler: this.config.scale_ruler ?? false,
      theme_mode: this.config.theme_mode || "auto",
      map_style: this.config.map_style || "default",
      hours_to_show: this.config.hours_to_show ?? 0,
      cluster: this.config.cluster ?? true,
    };

    const cardHeight = typeof this.config.card_height === "number" 
      ? `${this.config.card_height}px` 
      : (this.config.card_height || "250px");

    return html`
      <ha-card .header=${this.config.title ? undefined : null}>
        <div class="map-wrapper" style="height: ${cardHeight};">
          <hui-map-card
            .hass=${this.hass}
            .config=${mapConfig}
          ></hui-map-card>
        </div>
      </ha-card>
    `;
  }

  getCardSize() {
    const height = parseInt(this.config.card_height, 10);
    return isNaN(height) ? 4 : Math.ceil(height / 50);
  }
}

// ============================================================================
// VISUAL EDITOR COMPONENT (GUI Picker)
// ============================================================================
class FlexibleMapCardEditor extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: {},
    };
  }

  setConfig(config) {
    this._config = config;
  }

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 8px 0;
      }
      .option-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .slider-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .slider-header {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
      }
      input[type="range"] {
        width: 100%;
        cursor: pointer;
      }
      ha-textfield, ha-select {
        width: 100%;
      }
      .toggle-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
    `;
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const currentHeight = this._config.card_height ?? 250;
    const currentZoom = this._config.default_zoom ?? 14;
    const currentHours = this._config.hours_to_show ?? 0;

    return html`
      <div class="card-config">
        <!-- Title Field -->
        <ha-textfield
          label="Title (Optional)"
          .value=${this._config.title || ""}
          .configValue=${"title"}
          @input=${this._valueChanged}
        ></ha-textfield>

        <!-- Custom Card Height Slider -->
        <div class="slider-container">
          <div class="slider-header">
            <span>Card Height</span>
            <span><strong>${currentHeight}px</strong></span>
          </div>
          <input
            type="range"
            min="100"
            max="1000"
            step="10"
            .value=${currentHeight}
            .configValue=${"card_height"}
            @input=${this._numberValueChanged}
          />
        </div>

        <!-- Zoom Level Slider -->
        <div class="slider-container">
          <div class="slider-header">
            <span>Default Zoom Level</span>
            <span><strong>${currentZoom}</strong></span>
          </div>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            .value=${currentZoom}
            .configValue=${"default_zoom"}
            @input=${this._numberValueChanged}
          />
        </div>

        <!-- Hours to Show Slider -->
        <div class="slider-container">
          <div class="slider-header">
            <span>History Path (Hours to Show)</span>
            <span><strong>${currentHours} hrs</strong></span>
          </div>
          <input
            type="range"
            min="0"
            max="168"
            step="1"
            .value=${currentHours}
            .configValue=${"hours_to_show"}
            @input=${this._numberValueChanged}
          />
        </div>

        <!-- Dropdowns: Theme Mode & Map Style -->
        <ha-select
          label="Theme Mode"
          .value=${this._config.theme_mode || "auto"}
          .configValue=${"theme_mode"}
          @selected=${this._valueChanged}
        >
          <mwc-list-item value="auto">Auto</mwc-list-item>
          <mwc-list-item value="light">Light</mwc-list-item>
          <mwc-list-item value="dark">Dark</mwc-list-item>
        </ha-select>

        <ha-select
          label="Map Style"
          .value=${this._config.map_style || "default"}
          .configValue=${"map_style"}
          @selected=${this._valueChanged}
        >
          <mwc-list-item value="default">Default</mwc-list-item>
          <mwc-list-item value="colorful">Colorful</mwc-list-item>
          <mwc-list-item value="natural">Natural</mwc-list-item>
          <mwc-list-item value="muted">Muted</mwc-list-item>
          <mwc-list-item value="gray">Gray</mwc-list-item>
          <mwc-list-item value="toner">Toner</mwc-list-item>
        </ha-select>

        <!-- Feature Toggles -->
        <div class="toggle-grid">
          <label class="option-row">
            <span>Auto Fit</span>
            <ha-switch
              .checked=${this._config.auto_fit ?? false}
              .configValue=${"auto_fit"}
              @change=${this._toggleChanged}
            ></ha-switch>
          </label>

          <label class="option-row">
            <span>Fit Zones</span>
            <ha-switch
              .checked=${this._config.fit_zones ?? false}
              .configValue=${"fit_zones"}
              @change=${this._toggleChanged}
            ></ha-switch>
          </label>

          <label class="option-row">
            <span>Show Zone Radius</span>
            <ha-switch
              .checked=${this._config.show_zone_radius ?? false}
              .configValue=${"show_zone_radius"}
              @change=${this._toggleChanged}
            ></ha-switch>
          </label>

          <label class="option-row">
            <span>Scale Ruler</span>
            <ha-switch
              .checked=${this._config.scale_ruler ?? false}
              .configValue=${"scale_ruler"}
              @change=${this._toggleChanged}
            ></ha-switch>
          </label>

          <label class="option-row">
            <span>Cluster Markers</span>
            <ha-switch
              .checked=${this._config.cluster ?? true}
              .configValue=${"cluster"}
              @change=${this._toggleChanged}
            ></ha-switch>
          </label>
        </div>
      </div>
    `;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    if (this._config[target.configValue] === target.value) return;

    this._config = {
      ...this._config,
      [target.configValue]: target.value,
    };
    this._fireConfigChanged();
  }

  _numberValueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    const value = parseFloat(target.value);

    this._config = {
      ...this._config,
      [target.configValue]: value,
    };
    this._fireConfigChanged();
  }

  _toggleChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;

    this._config = {
      ...this._config,
      [target.configValue]: target.checked,
    };
    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    const event = new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

// Register Web Components
customElements.define("flexible-map-card", FlexibleMapCard);
customElements.define("flexible-map-card-editor", FlexibleMapCardEditor);

// Register Card in Home Assistant Card Picker UI
window.customCards = window.customCards || [];
window.customCards.push({
  type: "flexible-map-card",
  name: "Flexible Resizable Map Card",
  description: "Map card with custom height sliders and full visual editor support.",
  preview: true,
});
