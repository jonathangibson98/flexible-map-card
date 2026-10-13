import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";

class FlexibleMapCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
    };
  }

  setConfig(config) {
    if (!config.entities) {
      throw new Error("You need to define entities");
    }
    this.config = {
      card_height: "250px", // Default height override
      zoom: 14,
      ...config,
    };
  }

  // Set card dimensions and styles
  static get styles() {
    return css`
      ha-card {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .map-container {
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

    // Pass configuration down to inner map element
    const mapConfig = {
      type: "map",
      entities: this.config.entities,
      theme_mode: this.config.theme_mode || "auto",
      default_zoom: this.config.zoom,
    };

    return html`
      <ha-card .header=${this.config.title}>
        <div class="map-container" style="height: ${this.config.card_height};">
          <hui-map-card
            .hass=${this.hass}
            .config=${mapConfig}
          ></hui-map-card>
        </div>
      </ha-card>
    `;
  }

  // Define size logic for Home Assistant layout engine
  getCardSize() {
    const height = parseInt(this.config.card_height, 10);
    return isNaN(height) ? 3 : Math.ceil(height / 50);
  }
}

// Register custom element
customElements.define("flexible-map-card", FlexibleMapCard);

// Add to Home Assistant card picker menu
window.customCards = window.customCards || [];
window.customCards.push({
  type: "flexible-map-card",
  name: "Flexible Resizable Map Card",
  description: "A custom map card with strict height controls and zoom scaling.",
});
