/* Flexible Map card
 *
 * One card for: live map with real person pictures and zone icons, history
 * trails from the Flexible Map history file, heatmap, playback, a people list
 * (where everyone is, since when, distance) and your Travel Times sensors
 * (drive time / distance / ETA to places and between people).
 *
 * Everything it needs ships with the integration (Leaflet, Lit), so it works
 * without internet access to a CDN. Only the map tiles come from the web.
 */
import { LitElement, html, css, nothing } from "./vendor/lit.js";

const VERSION = "4.0.1";
const BASE = new URL(".", import.meta.url).href; // .../flexible_map_static/
const HOLD_MS = 600;
const MOVE_TOLERANCE_PX = 10;
const DEFAULT_RANGES = [1, 6, 24, 72, 168];
const PALETTE = ["#4dabf7", "#ff6b6b", "#51cf66", "#fcc419", "#cc5de8", "#ff922b", "#22b8cf", "#f06595"];
const MI = 1609.344;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const idOf = (e) => (typeof e === "string" ? e : e?.entity);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const low = (v) => String(v ?? "").trim().toLowerCase();

function havM(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => Array.from(w)[0] || "").join("").slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Leaflet loader (bundled copy, loaded once per page)
// ---------------------------------------------------------------------------
let leafletPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
}
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = (async () => {
      if (!window.L || !window.L.map) await loadScript(`${BASE}vendor/leaflet.js?v=${VERSION}`);
      if (!window.L.heatLayer) await loadScript(`${BASE}vendor/leaflet-heat.js?v=${VERSION}`);
      return window.L;
    })().catch((e) => {
      leafletPromise = null;
      throw e;
    });
  }
  return leafletPromise;
}

const TILES = {
  carto: (dark) => ({
    url: `https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "rastertiles/voyager"}/{z}/{x}/{y}{r}.png`,
    opt: { subdomains: "abcd", maxZoom: 20, attribution: "&copy; OpenStreetMap &copy; CARTO" },
  }),
  osm: () => ({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    opt: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" },
    invertDark: true,
  }),
  satellite: () => ({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    opt: { maxZoom: 19, attribution: "Tiles &copy; Esri" },
  }),
};

// ============================================================================
// MAIN CARD
// ============================================================================
class FlexibleMapCard extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      config: { attribute: false },
      _error: { state: true },
      _heat: { state: true },
      _play: { state: true },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._map = null;
    this._L = null;
    this._tile = null;
    this._tileKey = "";
    this._layers = null;
    this._markers = {}; // id -> {marker, circle, key}
    this._zoneLayers = {}; // id -> {marker, circle, key}
    this._activeHours = 0;
    this._trails = [];
    this._histToken = 0;
    this._histTimer = null;
    this._window = null;
    this._noIntegration = false;
    this._fitted = false;
    this._heat = false;
    this._play = null; // {t, playing, speed}
    this._open = null; // person id whose travel list is expanded
    this._holdTimer = null;
    this._holdStart = null;
    this._extraPath = null;
  }

  static async getConfigElement() {
    return document.createElement("flexible-map-card-editor");
  }

  static getStubConfig(hass) {
    const people = Object.keys(hass?.states || {}).filter((e) => e.startsWith("person.")).slice(0, 4);
    return {
      type: "custom:flexible-map-card",
      entities: people,
      card_height: 320,
      hours_to_show: 24,
      show_zones: true,
      show_people: true,
      travel_times: true,
      units: "mi",
      dark_at_night: true,
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.config = {
      card_height: 320,
      full_width: true,
      card_width: 400,
      hours_to_show: 24,
      show_zones: true,
      show_people: true,
      travel_times: true,
      travel_lines: true,
      pair_lines: true,
      map_style: "carto",
      theme_mode: "auto",
      auto_fit: true,
      show_accuracy: true,
      show_zone_radius: true,
      marker_size: 40,
      picture_fit: "cover",
      ...config,
    };
    this._activeHours = Number(this.config.hours_to_show) || 0;
    this._fitted = false;
    this._tileKey = "";
    this._clearMarkers();
    this._restartHistoryTimer();
    if (this._map) this._sync(true);
  }

  getGridOptions() {
    const h = this._cardHeightPx + (this.config?.show_people === false ? 0 : 56 * Math.min(4, this._personIds().length || 1));
    return { rows: Math.max(3, Math.ceil(h / 56)), columns: 12, min_rows: 3, min_columns: 4 };
  }

  getCardSize() {
    return Math.ceil(this._cardHeightPx / 50) + (this.config?.show_people === false ? 0 : 2);
  }

  get _cardHeightPx() {
    const v = parseInt(this.config?.card_height, 10);
    return Number.isNaN(v) ? 320 : v;
  }

  get _wrapperWidthCss() {
    if (this.config?.full_width !== false) return "100%";
    const w = parseInt(this.config?.card_width, 10);
    return `${Number.isNaN(w) ? 400 : w}px`;
  }

  get _units() {
    return this.config?.units === "km" ? "km" : "mi";
  }

  // ------------------------------------------------------------------------
  // Who and what is on the map
  // ------------------------------------------------------------------------
  _entityCfg(id) {
    return (this.config.entities || []).find((e) => typeof e !== "string" && e?.entity === id) || {};
  }

  _personIds() {
    if (!this.config || !this.hass) return [];
    const ids = (this.config.entities || []).map(idOf).filter((id) => id && !id.startsWith("zone."));
    if (this.config.add_all_entities) {
      const have = new Set(ids);
      const used = new Set();
      for (const [id, st] of Object.entries(this.hass.states)) {
        if (id.startsWith("person.")) (st.attributes.device_trackers || []).forEach((t) => used.add(t));
      }
      for (const [id, st] of Object.entries(this.hass.states)) {
        if (have.has(id) || used.has(id) || id.startsWith("zone.")) continue;
        if (this.hass.entities?.[id]?.hidden) continue;
        if (!/^(person|device_tracker)\./.test(id)) continue;
        if (st.attributes.latitude !== undefined) ids.push(id);
      }
    }
    return [...new Set(ids)].filter((id) => this.hass.states[id]);
  }

  _zoneIds() {
    if (!this.hass) return [];
    const listed = (this.config.entities || []).map(idOf).filter((id) => id?.startsWith("zone."));
    let ids = listed;
    if (this.config.show_zones !== false) {
      ids = [
        ...listed,
        ...Object.keys(this.hass.states).filter((id) => id.startsWith("zone.") && !this.hass.entities?.[id]?.hidden),
      ];
    }
    const hide = new Set(this.config.hide_zones || []);
    return [...new Set(ids)].filter((id) => !hide.has(id) && this.hass.states[id]?.attributes?.latitude !== undefined && !this.hass.states[id].attributes.passive);
  }

  _colorFor(id) {
    const c = this._entityCfg(id).color;
    if (c) return c;
    const idx = this._personIds().indexOf(id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }

  _nameOf(id) {
    return this._entityCfg(id).name || this.hass.states[id]?.attributes?.friendly_name || id;
  }

  // What to draw inside the circle: picture, icon or initials.
  // Order: card override > Home Assistant's picture > HA icon > initials.
  _look(id) {
    const st = this.hass.states[id];
    const a = st?.attributes || {};
    const ov = id.startsWith("zone.") ? this.config.zones?.[id] || {} : this._entityCfg(id);
    const picture = ov.picture || (ov.icon ? null : a.entity_picture);
    if (picture) return { picture: this._url(picture) };
    const icon = ov.icon || a.icon || this.hass.entities?.[id]?.icon;
    if (icon && /^[a-z0-9_-]+:/i.test(icon)) return { icon };
    if (icon) return { text: Array.from(icon).slice(0, 2).join("") }; // emoji
    if (id.startsWith("zone.")) return { icon: id === "zone.home" ? "mdi:home" : "mdi:map-marker" };
    return { text: initials(this._nameOf(id)) };
  }

  _url(path) {
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    return this.hass?.hassUrl ? this.hass.hassUrl(path) : path;
  }

  _avatarEl(id, size, color, cls = "") {
    const look = this._look(id);
    const el = document.createElement("div");
    el.className = `fm-av ${cls}`;
    el.style.cssText = `--c:${color};--s:${size}px`;
    if (look.picture) {
      const img = document.createElement("img");
      img.src = look.picture;
      img.alt = "";
      img.draggable = false;
      if (this.config.picture_fit === "contain") img.style.objectFit = "contain";
      img.onerror = () => {
        el.textContent = initials(this._nameOf(id));
      };
      el.appendChild(img);
    } else if (look.icon) {
      const ic = document.createElement("ha-icon");
      ic.setAttribute("icon", look.icon);
      el.appendChild(ic);
      el.classList.add("icon");
    } else {
      el.textContent = look.text;
    }
    return el;
  }

  _avatarTpl(id, color) {
    const look = this._look(id);
    return html`<span class="av" style="--c:${color}">
      ${look.picture
        ? html`<img src=${look.picture} alt="" style=${this.config.picture_fit === "contain" ? "object-fit:contain" : ""} />`
        : look.icon
          ? html`<ha-icon .icon=${look.icon}></ha-icon>`
          : html`<span>${look.text}</span>`}
    </span>`;
  }

  // ------------------------------------------------------------------------
  // Map setup
  // ------------------------------------------------------------------------
  async _initMap() {
    if (this._map || this._initing) return;
    const el = this.shadowRoot?.querySelector(".map");
    if (!el || !this.hass) return;
    this._initing = true;
    try {
      const L = await loadLeaflet();
      this._L = L;
      const map = L.map(el, {
        zoomControl: !this.config.hide_zoom_controls,
        attributionControl: true,
        preferCanvas: false,
        zoomSnap: 0.5,
      }).setView([39.8, -98.6], 4);
      if (map.zoomControl) map.zoomControl.setPosition("bottomright");
      map.attributionControl.setPrefix("");
      this._layers = {
        zones: L.layerGroup().addTo(map),
        trails: L.layerGroup().addTo(map),
        travel: L.layerGroup().addTo(map),
        people: L.layerGroup().addTo(map),
        play: L.layerGroup().addTo(map),
        extra: L.layerGroup().addTo(map),
        heat: null,
      };
      this._map = map;
      el.addEventListener("click", (e) => {
        const b = e.target?.closest?.("[data-more]");
        if (b) this._moreInfo(b.dataset.more);
      });
      this._ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      this._ro.observe(el);
      this._sync(true);
      this._fetchHistory();
    } catch (e) {
      this._error = `Map couldn't load: ${e.message}`;
    } finally {
      this._initing = false;
    }
  }

  _isDark() {
    const mode = this.config.theme_mode || "auto";
    if (mode === "dark") return true;
    if (mode === "light") return false;
    if (this.config.dark_at_night) {
      const sun = this.hass?.states?.["sun.sun"]?.state;
      if (sun) return sun === "below_horizon";
      const h = new Date().getHours();
      return h >= 19 || h < 7;
    }
    return !!this.hass?.themes?.darkMode;
  }

  _applyTiles() {
    const L = this._L;
    const dark = this._isDark();
    const style = this.config.map_style === "default" ? "carto" : this.config.map_style || "carto";
    const custom = style === "custom" && this.config.tile_url;
    const key = `${style}|${dark}|${custom ? this.config.tile_url : ""}`;
    this.shadowRoot.querySelector(".map")?.classList.toggle("dark", dark);
    if (key === this._tileKey) return;
    this._tileKey = key;
    if (this._tile) this._map.removeLayer(this._tile);
    let t;
    if (custom) t = { url: this.config.tile_url, opt: { maxZoom: 20, attribution: this.config.tile_attribution || "" } };
    else t = (TILES[style] || TILES.carto)(dark);
    this.shadowRoot.querySelector(".map")?.classList.toggle("invert", !!(dark && t.invertDark));
    this._tile = L.tileLayer(t.url, t.opt).addTo(this._map);
    this._tile.bringToBack();
  }

  _clearMarkers() {
    for (const m of Object.values(this._markers)) {
      m.marker.remove();
      m.circle?.remove();
    }
    for (const m of Object.values(this._zoneLayers)) {
      m.marker.remove();
      m.circle?.remove();
    }
    this._markers = {};
    this._zoneLayers = {};
  }

  // Bring markers in line with hass. Cheap when nothing moved.
  _sync(force = false) {
    if (!this._map || !this.hass) return;
    const L = this._L;
    this._applyTiles();

    // zones
    const zoneIds = new Set(this._zoneIds());
    for (const id of Object.keys(this._zoneLayers)) {
      if (!zoneIds.has(id)) {
        this._zoneLayers[id].marker.remove();
        this._zoneLayers[id].circle?.remove();
        delete this._zoneLayers[id];
      }
    }
    for (const id of zoneIds) {
      const a = this.hass.states[id].attributes;
      const color = this.config.zones?.[id]?.color || (id === "zone.home" ? "#ff9800" : "var(--fm-zone, #4c8bf5)");
      const look = this._look(id);
      const key = JSON.stringify([a.latitude, a.longitude, a.radius, look, color, this.config.show_zone_radius]);
      const cur = this._zoneLayers[id];
      if (cur && cur.key === key && !force) continue;
      cur?.marker.remove();
      cur?.circle?.remove();
      const size = Math.round((Number(this.config.marker_size) || 40) * 0.75);
      const el = this._avatarEl(id, size, color, "zone");
      const marker = L.marker([a.latitude, a.longitude], {
        icon: L.divIcon({ html: el, className: "fm-mk", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: -1000,
        keyboard: false,
      }).addTo(this._layers.zones);
      marker.bindTooltip(esc(a.friendly_name || id), { direction: "top", offset: [0, -size / 2] });
      let circle = null;
      if (this.config.show_zone_radius !== false && a.radius) {
        const c = color.startsWith("var") ? "#4c8bf5" : color;
        circle = L.circle([a.latitude, a.longitude], {
          radius: a.radius, color: c, weight: 1, opacity: 0.6, fillOpacity: 0.12, interactive: false,
        }).addTo(this._layers.zones);
      }
      this._zoneLayers[id] = { marker, circle, key };
    }

    // people / devices
    const ids = new Set(this._personIds());
    for (const id of Object.keys(this._markers)) {
      if (!ids.has(id)) {
        this._markers[id].marker.remove();
        this._markers[id].circle?.remove();
        delete this._markers[id];
      }
    }
    const size = Number(this.config.marker_size) || 40;
    for (const id of ids) {
      const st = this.hass.states[id];
      const a = st.attributes;
      if (typeof a.latitude !== "number" || typeof a.longitude !== "number") continue;
      const color = this._colorFor(id);
      const look = this._look(id);
      const lookKey = JSON.stringify([look, color, size]);
      const cur = this._markers[id];
      if (cur && cur.lookKey === lookKey && !force) {
        cur.marker.setLatLng([a.latitude, a.longitude]);
        if (cur.circle) cur.circle.setLatLng([a.latitude, a.longitude]).setRadius(a.gps_accuracy || 0);
        cur.marker.setPopupContent(this._popupHtml(id));
        continue;
      }
      cur?.marker.remove();
      cur?.circle?.remove();
      const el = this._avatarEl(id, size, color, "person");
      const marker = L.marker([a.latitude, a.longitude], {
        icon: L.divIcon({ html: el, className: "fm-mk", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: 1000,
        riseOnHover: true,
      }).addTo(this._layers.people);
      marker.bindPopup(this._popupHtml(id), { offset: [0, -size / 2], maxWidth: 280, className: "fm-pop" });
      marker.on("click", () => this._zoomTo(id));
      let circle = null;
      if (this.config.show_accuracy !== false && a.gps_accuracy) {
        circle = L.circle([a.latitude, a.longitude], {
          radius: a.gps_accuracy, color, weight: 1, opacity: 0.5, fillOpacity: 0.1, interactive: false,
        }).addTo(this._layers.people);
      }
      this._markers[id] = { marker, circle, lookKey };
    }

    this._drawTravel();
    if (!this._fitted && this.config.auto_fit !== false) this._fit();
  }

  _fit(extra = []) {
    const L = this._L;
    const pts = [];
    for (const m of Object.values(this._markers)) pts.push(m.marker.getLatLng());
    if (this.config.fit_zones) for (const m of Object.values(this._zoneLayers)) pts.push(m.marker.getLatLng());
    pts.push(...extra);
    if (!pts.length) {
      const z = this.hass.states["zone.home"]?.attributes;
      if (z) this._map.setView([z.latitude, z.longitude], Number(this.config.default_zoom) || 14);
      return;
    }
    this._fitted = true;
    if (pts.length === 1) {
      this._map.setView(pts[0], Number(this.config.default_zoom) || 14);
    } else {
      this._map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: Number(this.config.default_zoom) || 15 });
    }
  }

  _zoomTo(id) {
    const a = this.hass.states[id]?.attributes;
    if (a?.latitude === undefined) return;
    this._map.setView([a.latitude, a.longitude], Math.max(this._map.getZoom(), 16));
  }

  focusEntity(id) {
    if (!this._map) return;
    this._zoomTo(id);
    this._markers[id]?.marker.openPopup();
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  // ------------------------------------------------------------------------
  // Facts about a person (place, since, battery, distance)
  // ------------------------------------------------------------------------
  _placeOf(id) {
    const st = this.hass.states[id];
    if (!st) return "";
    const s = st.state;
    if (s === "home") return this.hass.states["zone.home"]?.attributes?.friendly_name || "Home";
    if (s === "not_home") {
      const a = st.attributes;
      const z = this._zoneAt(a.latitude, a.longitude);
      return z || "Away";
    }
    if (s === "unknown" || s === "unavailable") return "Unknown";
    return s;
  }

  _zoneAt(lat, lon) {
    if (typeof lat !== "number") return null;
    let best = null;
    for (const [id, st] of Object.entries(this.hass.states)) {
      if (!id.startsWith("zone.")) continue;
      const a = st.attributes;
      if (a.passive || a.latitude === undefined) continue;
      const r = Number(a.radius) || 100;
      if (havM([lat, lon], [a.latitude, a.longitude]) <= r && (!best || r < best.r)) best = { r, name: a.friendly_name || id };
    }
    return best?.name || null;
  }

  _battery(id) {
    const st = this.hass.states[id];
    const a = st?.attributes || {};
    let b = a.battery_level ?? a.battery;
    if (b === undefined && a.source) b = this.hass.states[a.source]?.attributes?.battery_level;
    if (b === undefined && this._entityCfg(id).battery) b = this.hass.states[this._entityCfg(id).battery]?.state;
    const n = num(b);
    return n === null ? null : Math.round(n);
  }

  _ago(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }

  _fmtDist(m) {
    if (this._units === "km") return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
    if (m < 160) return `${Math.round(m * 3.28084)} ft`;
    const v = m / MI;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} mi`;
  }

  _popupHtml(id) {
    const st = this.hass.states[id];
    const a = st.attributes;
    const bat = this._battery(id);
    const trail = this._trails.find((t) => t.id === id);
    const rows = this._travelFor(id);
    const bits = [];
    bits.push(`<div class="pp-h"><b>${esc(this._nameOf(id))}</b><span>${esc(this._placeOf(id))}</span></div>`);
    const meta = [`for ${this._ago(st.last_changed)}`];
    if (bat !== null) meta.push(`🔋 ${bat}%`);
    if (a.gps_accuracy) meta.push(`±${this._fmtDist(a.gps_accuracy)}`);
    meta.push(`updated ${this._ago(st.last_updated)}${this._ago(st.last_updated) === "just now" ? "" : " ago"}`);
    bits.push(`<div class="pp-m">${esc(meta.join(" · "))}</div>`);
    if (trail && trail.distM > 0) bits.push(`<div class="pp-m">Moved ${esc(this._fmtDist(trail.distM))} in this range</div>`);
    for (const r of rows) {
      bits.push(`<div class="pp-t">${r.kind === "pair" ? "↔" : "→"} <b>${esc(r.label)}</b> ${esc(r.text)}</div>`);
    }
    bits.push(`<button data-more="${esc(id)}" class="pp-b">More info</button>`);
    return bits.join("");
  }

  // ------------------------------------------------------------------------
  // Travel Times (sensors made by the Travel Times add-on: attribute tt_kind)
  // ------------------------------------------------------------------------
  _travelSensors() {
    if (!this.hass || this.config.travel_times === false) return [];
    const only = Array.isArray(this.config.travel_entities) && this.config.travel_entities.length
      ? new Set(this.config.travel_entities) : null;
    const out = [];
    for (const [eid, st] of Object.entries(this.hass.states)) {
      if (!eid.startsWith("sensor.")) continue;
      const a = st.attributes;
      if (!a.tt_kind) continue;
      if (only && !only.has(eid)) continue;
      if (a.tt_kind === "tracker" && a.unit_of_measurement !== "min") continue; // the separate distance sensor
      out.push({ eid, st, a });
    }
    return out;
  }

  // Travel Times names people its own way ("Alex"); map them to entities.
  _nameMap(sensors) {
    const map = {};
    for (const { a } of sensors) {
      if (a.tt_kind === "route" && a.origin && a.tt_from) map[low(a.tt_from)] = a.origin;
    }
    const ids = this._personIds();
    const resolve = (name) => {
      const n = low(name);
      if (map[n] && this.hass.states[map[n]]) return map[n];
      for (const id of ids) {
        const f = low(this._nameOf(id));
        if (f === n || f.split(/\s+/)[0] === n || id === `person.${n.replace(/\s+/g, "_")}`) return id;
      }
      return null;
    };
    return resolve;
  }

  _destPoint(target, name) {
    const t = String(target || "").trim();
    if (t.startsWith("zone.") || /^(person|device_tracker)\./.test(t)) {
      const a = this.hass.states[t]?.attributes;
      return a?.latitude !== undefined ? [a.latitude, a.longitude] : null;
    }
    const m = t.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return [Number(m[1]), Number(m[2])];
    // an address: try a zone with the same name
    for (const [id, st] of Object.entries(this.hass.states)) {
      if (id.startsWith("zone.") && low(st.attributes.friendly_name) === low(name)) return [st.attributes.latitude, st.attributes.longitude];
    }
    return null;
  }

  _minClass(min) {
    const warn = Number(this.config.warn_above) || 0;
    const alert = Number(this.config.alert_above) || 0;
    if (alert && min >= alert) return "alert";
    if (warn && min >= warn) return "warn";
    return "";
  }

  _fmtMin(m) {
    const v = Math.round(Number(m));
    if (!Number.isFinite(v)) return "…";
    return v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v} min`;
  }

  // All travel facts, grouped by person entity: [{kind, label, text, min, ...}]
  _travelIndex() {
    const sensors = this._travelSensors();
    const resolve = this._nameMap(sensors);
    const idx = {};
    const groups = [];
    const push = (id, row) => (idx[id] = idx[id] || []).push(row);
    for (const { eid, st, a } of sensors) {
      const min = num(st.state);
      const unit = a.distance_unit || this._units;
      if (a.tt_kind === "route") {
        const who = (a.origin && this.hass.states[a.origin] ? a.origin : null) || resolve(a.tt_from);
        if (!who) continue;
        const arrived = !!a.arrived;
        const eta = a.eta ? new Date(a.eta) : null;
        const bits = [];
        if (arrived) bits.push("there now");
        else {
          bits.push(this._fmtMin(min));
          if (a.distance !== undefined && a.distance !== null) bits.push(`${a.distance} ${unit}`);
          if (eta && !Number.isNaN(+eta)) bits.push(`ETA ${eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
        }
        push(who, {
          kind: "route", eid, label: a.tt_to || "?", text: bits.join(" · "), min: arrived ? 0 : min,
          cls: arrived ? "ok" : this._minClass(min), via: a.route, dest: this._destPoint(a.destination, a.tt_to),
          arrived,
        });
      } else if (a.tt_kind === "tracker") {
        for (const p of a.pairs || []) {
          const ia = resolve(p.a), ib = resolve(p.b);
          const together = p.arrived;
          const bits = [];
          if (together) bits.push("together");
          else {
            if (p.minutes !== null && p.minutes !== undefined) bits.push(this._fmtMin(p.minutes));
            if (p.distance !== null && p.distance !== undefined) bits.push(`${p.distance} ${unit}`);
            if (p.straight_line !== null && p.straight_line !== undefined) bits.push(`${p.straight_line} ${unit} straight`);
          }
          const row = { kind: "pair", eid, a: ia, b: ib, min: p.minutes, text: bits.join(" · ") || "…", cls: together ? "ok" : this._minClass(p.minutes) };
          if (ia) push(ia, { ...row, label: ib ? this._nameOf(ib) : p.b, other: ib });
          if (ib) push(ib, { ...row, label: ia ? this._nameOf(ia) : p.a, other: ia });
        }
      } else if (a.tt_kind === "group") {
        groups.push({
          eid, label: `${a.tt_from} → ${a.tt_to}`, min,
          text: a.arrived ? "everyone's there" : `${this._fmtMin(min)} (${a.mode || "max"})${a.total_distance !== undefined ? ` · ${a.total_distance} ${unit} combined` : ""}`,
          members: (a.members || []).map((m) => `${m.name} ${m.arrived ? "here" : this._fmtMin(m.minutes)}`).join(" · "),
          cls: a.arrived ? "ok" : this._minClass(min),
        });
      }
    }
    // de-duplicate pairs that came from more than one tracker
    for (const id of Object.keys(idx)) {
      const seen = new Set();
      idx[id] = idx[id].filter((r) => {
        const k = `${r.kind}|${r.label}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "route" ? -1 : 1) || (x.min ?? 999) - (y.min ?? 999));
    }
    return { byPerson: idx, groups };
  }

  _travelFor(id) {
    return this._travelIndex().byPerson[id] || [];
  }

  _drawTravel() {
    if (!this._map) return;
    const L = this._L;
    const layer = this._layers.travel;
    layer.clearLayers();
    if (this.config.travel_times === false) return;
    const { byPerson } = this._travelIndex();
    const shown = new Set(this._personIds());
    const pairsDone = new Set();
    for (const [id, rows] of Object.entries(byPerson)) {
      if (!shown.has(id)) continue;
      const a = this.hass.states[id]?.attributes;
      if (typeof a?.latitude !== "number") continue;
      const from = [a.latitude, a.longitude];
      const color = this._colorFor(id);
      const focus = this._open === id;
      for (const r of rows) {
        if (r.kind === "route" && r.dest && !r.arrived && (this.config.travel_lines === true || focus) && this.config.travel_lines !== false) {
          L.polyline([from, r.dest], { color, weight: focus ? 3 : 2, opacity: focus ? 0.9 : 0.45, dashArray: "6 8", interactive: false }).addTo(layer);
        }
        if (r.kind === "pair" && r.other && this.config.pair_lines !== false && shown.has(r.other)) {
          const key = [id, r.other].sort().join("|");
          if (pairsDone.has(key)) continue;
          pairsDone.add(key);
          const b = this.hass.states[r.other]?.attributes;
          if (typeof b?.latitude !== "number" || r.cls === "ok") continue;
          const to = [b.latitude, b.longitude];
          L.polyline([from, to], { color: "#9e9e9e", weight: 2, opacity: 0.7, dashArray: "2 6", interactive: false }).addTo(layer);
          const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
          const lab = document.createElement("div");
          lab.className = "fm-pair";
          lab.textContent = r.text.split(" · ").slice(0, 2).join(" · ");
          L.marker(mid, { icon: L.divIcon({ html: lab, className: "fm-mk", iconSize: null }), interactive: false, keyboard: false }).addTo(layer);
        }
      }
    }
  }

  _focusTravel(id, row) {
    if (!this._map) return;
    const a = this.hass.states[id]?.attributes;
    const pts = [];
    if (a?.latitude !== undefined) pts.push([a.latitude, a.longitude]);
    if (row?.dest) pts.push(row.dest);
    if (row?.other) {
      const b = this.hass.states[row.other]?.attributes;
      if (b?.latitude !== undefined) pts.push([b.latitude, b.longitude]);
    }
    if (pts.length > 1) this._map.fitBounds(this._L.latLngBounds(pts), { padding: [50, 50], maxZoom: 16 });
    else if (pts.length) this._map.setView(pts[0], 15);
  }

  // ------------------------------------------------------------------------
  // History trails
  // ------------------------------------------------------------------------
  _restartHistoryTimer() {
    clearInterval(this._histTimer);
    this._histTimer = null;
    if (!this.isConnected || !this.config) return;
    const secs = Math.max(15, Number(this.config.history_refresh_seconds) || 60);
    this._histTimer = setInterval(() => this._fetchHistory(), secs * 1000);
  }

  setWindow(start, end, live = false) {
    this._window = { start, end, live };
    this._windowFitted = false;
    if (this._play) this._togglePlayback();
    this._fetchHistory();
    this.requestUpdate();
  }

  clearWindow() {
    this._window = null;
    this._fetchHistory();
    this.requestUpdate();
  }

  _range() {
    const raw = this._window;
    if (raw) return { start: raw.start, end: raw.live ? new Date() : raw.end, hours: Math.max(1, Math.ceil(((raw.live ? new Date() : raw.end) - raw.start) / 3600000)) };
    const hours = Number(this._activeHours) || 0;
    const end = new Date();
    return { start: new Date(end - hours * 3600000), end, hours };
  }

  async _fetchHistory() {
    const token = ++this._histToken;
    if (!this.hass || !this.config) return;
    const { start, end, hours } = this._range();
    const ids = hours ? this._personIds() : [];
    if (!hours || !ids.length) {
      this._trails = [];
      this._drawTrails();
      return;
    }
    const source = this.config.history_source || "auto";
    const rowsById = {};
    if (source !== "ha" && !this._noIntegration) {
      try {
        const r = await this.hass.callWS({
          type: "flexible_map/history", entity_ids: ids,
          start: start.getTime() / 1000, end: end.getTime() / 1000, max_points: 5000,
        });
        for (const [id, pts] of Object.entries(r?.points || {})) {
          rowsById[id] = pts.map((p) => ({ ts: new Date(p[0] * 1000), lat: p[1], lon: p[2], acc: p[3] }));
        }
      } catch (err) {
        if (err?.code === "unknown_command") this._noIntegration = true;
        else console.warn("[flexible-map-card] history file request failed", err);
      }
    }
    const missing = source === "integration" ? [] : ids.filter((id) => (rowsById[id]?.length || 0) < 2);
    if (missing.length) {
      try {
        const res = await this.hass.callWS({
          type: "history/history_during_period",
          start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: missing,
          include_start_time_state: true, significant_changes_only: false, minimal_response: false, no_attributes: false,
        });
        const toDate = (v) => (typeof v === "number" ? new Date(v * 1000) : new Date(v));
        for (const id of missing) {
          rowsById[id] = (res?.[id] || []).map((row) => {
            const a = row.a ?? row.attributes ?? {};
            return { ts: toDate(row.lu ?? row.last_updated ?? row.lc), lat: a.latitude, lon: a.longitude, acc: a.gps_accuracy };
          });
        }
      } catch (err) {
        console.warn("[flexible-map-card] HA history request failed", err);
      }
    }
    if (token !== this._histToken) return;

    const minMove = Math.max(0, Number(this.config.min_move_m ?? 20));
    const maxAcc = Number(this.config.max_accuracy_m) || 0;
    const viewingNow = end.getTime() >= Date.now() - 120000;
    this._trails = ids.map((id) => {
      const points = [];
      let distM = 0;
      const add = (lat, lon, ts, force) => {
        if (typeof lat !== "number" || typeof lon !== "number") return;
        const last = points[points.length - 1];
        if (last) {
          const d = havM(last.point, [lat, lon]);
          if ((d < minMove && !force) || d === 0) return;
          distM += d;
        }
        points.push({ point: [lat, lon], timestamp: ts });
      };
      for (const row of rowsById[id] || []) {
        if (maxAcc && typeof row.acc === "number" && row.acc > maxAcc) continue;
        add(row.lat, row.lon, row.ts, false);
      }
      const cur = this.hass.states[id]?.attributes;
      if (cur && viewingNow) add(cur.latitude, cur.longitude, new Date(), true);
      return { id, name: this._nameOf(id), color: this._colorFor(id), points, distM };
    });
    this._drawTrails();
  }

  _drawTrails() {
    this.dispatchEvent(new CustomEvent("trails-changed", { detail: { trails: this._trails, window: this._window } }));
    this.requestUpdate();
    if (!this._map) return;
    const L = this._L;
    const layer = this._layers.trails;
    layer.clearLayers();
    for (const t of this._trails) {
      const n = t.points.length;
      if (n < 2) continue;
      // Older parts fade out, the newest part is solid
      const chunks = Math.min(8, n - 1);
      const per = Math.ceil((n - 1) / chunks);
      for (let i = 0; i < n - 1; i += per) {
        const seg = t.points.slice(i, Math.min(n, i + per + 1)).map((p) => p.point);
        const op = 0.25 + 0.65 * ((i + per) / (n - 1));
        L.polyline(seg, { color: t.color, weight: 4, opacity: Math.min(0.9, op), lineCap: "round", lineJoin: "round", interactive: false }).addTo(layer);
      }
      if (this.config.show_points) {
        for (const p of t.points) {
          L.circleMarker(p.point, { radius: 3, color: t.color, weight: 1, fillOpacity: 0.8 })
            .bindTooltip(p.timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))
            .addTo(layer);
        }
      }
    }
    this._drawHeat();
    this._drawPlay();
    if (this._window && this._trails.some((t) => t.points.length > 1) && !this._windowFitted) {
      this._windowFitted = true;
      const pts = this._trails.flatMap((t) => t.points.map((p) => p.point));
      if (pts.length > 1) this._map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
    }
  }

  _drawHeat() {
    const L = this._L;
    if (this._layers.heat) {
      this._layers.heat.remove();
      this._layers.heat = null;
    }
    if (!this._heat || !L.heatLayer) return;
    const pts = this._trails.flatMap((t) => t.points.map((p) => [p.point[0], p.point[1], 0.6]));
    if (!pts.length) return;
    this._layers.heat = L.heatLayer(pts, { radius: 18, blur: 15, maxZoom: 17 }).addTo(this._map);
  }

  // Draw a path the dashboard asks for (e.g. one trip on the timeline)
  showPath(points, color = "#ff4081") {
    if (!this._map) return;
    const L = this._L;
    this._layers.extra.clearLayers();
    if (!points?.length) return;
    L.polyline(points, { color, weight: 6, opacity: 0.95 }).addTo(this._layers.extra);
    L.circleMarker(points[0], { radius: 6, color, fillColor: "#fff", fillOpacity: 1 }).addTo(this._layers.extra);
    L.circleMarker(points[points.length - 1], { radius: 6, color, fillColor: color, fillOpacity: 1 }).addTo(this._layers.extra);
    this._map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 });
  }

  showPoint(lat, lon, label = "") {
    if (!this._map) return;
    const L = this._L;
    this._layers.extra.clearLayers();
    const m = L.circleMarker([lat, lon], { radius: 9, color: "#ff4081", weight: 3, fillOpacity: 0.3 }).addTo(this._layers.extra);
    if (label) m.bindTooltip(esc(label), { permanent: true, direction: "top" });
    this._map.setView([lat, lon], Math.max(this._map.getZoom(), 16));
  }

  clearPath() {
    this._layers?.extra.clearLayers();
  }

  // ------------------------------------------------------------------------
  // Playback
  // ------------------------------------------------------------------------
  _playBounds() {
    const ts = this._trails.flatMap((t) => (t.points.length > 1 ? [t.points[0].timestamp, t.points[t.points.length - 1].timestamp] : []));
    if (!ts.length) return null;
    return [Math.min(...ts.map(Number)), Math.max(...ts.map(Number))];
  }

  _posAt(points, t) {
    if (!points.length || t < +points[0].timestamp) return null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (t <= +b.timestamp) {
        const span = +b.timestamp - +a.timestamp || 1;
        const f = (t - +a.timestamp) / span;
        return [a.point[0] + (b.point[0] - a.point[0]) * f, a.point[1] + (b.point[1] - a.point[1]) * f];
      }
    }
    return points[points.length - 1].point;
  }

  _togglePlayback() {
    if (this._play) {
      this._stopPlay();
      this._play = null;
      this._layers?.play.clearLayers();
      this._sync(true);
      return;
    }
    const b = this._playBounds();
    if (!b) return;
    this._play = { t: b[0], playing: true, speed: 1 };
    this._startPlay();
  }

  _startPlay() {
    this._stopPlay();
    let last = performance.now();
    const step = (now) => {
      if (!this._play?.playing) return;
      const b = this._playBounds();
      if (!b) return;
      const dt = now - last;
      last = now;
      // whole range plays in about a minute at 1x
      const t = this._play.t + ((b[1] - b[0]) / 60000) * dt * this._play.speed;
      this._play = { ...this._play, t: Math.min(b[1], t), playing: t < b[1] };
      this._drawPlay();
      if (this._play.playing) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPlay() {
    cancelAnimationFrame(this._raf);
  }

  _drawPlay() {
    if (!this._map || !this._play) return;
    const L = this._L;
    const layer = this._layers.play;
    layer.clearLayers();
    this._layers.people.eachLayer((m) => m.setOpacity?.(0.25));
    const size = Math.round((Number(this.config.marker_size) || 40) * 0.8);
    for (const t of this._trails) {
      const pos = this._posAt(t.points, this._play.t);
      if (!pos) continue;
      const el = this._avatarEl(t.id, size, t.color, "person");
      L.marker(pos, { icon: L.divIcon({ html: el, className: "fm-mk", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), interactive: false, zIndexOffset: 2000 }).addTo(layer);
    }
  }

  _scrub(ev) {
    if (!this._play) return;
    this._play = { ...this._play, t: Number(ev.target.value), playing: false };
    this._stopPlay();
    this._drawPlay();
  }

  _playPause() {
    if (!this._play) return;
    const b = this._playBounds();
    const restart = b && this._play.t >= b[1];
    this._play = { ...this._play, t: restart ? b[0] : this._play.t, playing: !this._play.playing };
    if (this._play.playing) this._startPlay();
    else this._stopPlay();
  }

  _cycleSpeed() {
    if (!this._play) return;
    const speeds = [1, 4, 16, 0.25];
    const i = speeds.indexOf(this._play.speed);
    this._play = { ...this._play, speed: speeds[(i + 1) % speeds.length] };
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
    if (Math.hypot(ev.clientX - this._holdStart.x, ev.clientY - this._holdStart.y) > MOVE_TOLERANCE_PX) this._cancelHold();
  }

  _cancelHold() {
    clearTimeout(this._holdTimer);
    this._holdStart = null;
  }

  _runAction(cfg) {
    const hass = this.hass;
    if (!cfg || !hass) return;
    const first = this._personIds()[0];
    switch (cfg.action) {
      case "more-info": {
        const id = cfg.entity || first;
        if (id) this._moreInfo(id);
        break;
      }
      case "navigate":
        if (!cfg.navigation_path) return;
        history.pushState(null, "", cfg.navigation_path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        break;
      case "url":
        if (cfg.url_path) window.open(cfg.url_path, "_blank");
        break;
      case "toggle": {
        const id = cfg.entity || first;
        if (id) hass.callService("homeassistant", "toggle", { entity_id: id });
        break;
      }
      case "perform-action":
      case "call-service": {
        const svc = cfg.perform_action || cfg.service;
        if (!svc || !svc.includes(".")) return;
        const [d, s] = svc.split(".");
        hass.callService(d, s, cfg.data || cfg.service_data || {}, cfg.target);
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
    const wrap = this.shadowRoot.querySelector(".map");
    wrap.addEventListener("pointerdown", (e) => this._onPointerDown(e), true);
    wrap.addEventListener("pointermove", (e) => this._onPointerMove(e), true);
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => wrap.addEventListener(t, () => this._cancelHold(), true));
    wrap.addEventListener("contextmenu", (e) => this._hasHold() && e.preventDefault(), true);
    this._initMap();
  }

  connectedCallback() {
    super.connectedCallback();
    this._restartHistoryTimer();
    if (this._map) {
      setTimeout(() => this._map?.invalidateSize(), 50);
      this._fetchHistory();
    }
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) {
      if (!this._map) this._initMap();
      else if (!this._play) this._sync(false);
      const key = this._personIds().join(",");
      if (key !== this._idsKey) {
        const first = this._idsKey === undefined;
        this._idsKey = key;
        if (!first) this._fetchHistory();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._histTimer);
    this._histTimer = null;
    clearTimeout(this._holdTimer);
    this._stopPlay();
  }

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  _setRange(h) {
    this._activeHours = h;
    this._window = null;
    this._windowFitted = false;
    if (this._play) this._togglePlayback();
    this._fetchHistory();
    this.requestUpdate();
  }

  _rangeLabel(h) {
    if (!h) return "Off";
    if (h < 24 || h % 24) return `${h}h`;
    return `${h / 24}d`;
  }

  _renderTools() {
    const c = this.config;
    const active = this._window ? -1 : Number(this._activeHours) || 0;
    const ranges = Array.isArray(c.history_ranges) && c.history_ranges.length ? c.history_ranges : DEFAULT_RANGES;
    const hasTrail = this._trails.some((t) => t.points.length > 1);
    return html`
      ${c.show_history_controls === false || this._window ? nothing : html`<div class="chips">
        ${[0, ...ranges].map((h) => html`<button class=${h === active ? "chip on" : "chip"} @click=${() => this._setRange(h)}>${this._rangeLabel(h)}</button>`)}
      </div>`}
      <div class="tools">
        <button title="Fit everyone" @click=${() => this._fit()}><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></button>
        ${c.show_heatmap_button === false || !hasTrail ? nothing : html`<button title="Heatmap" class=${this._heat ? "on" : ""}
          @click=${() => { this._heat = !this._heat; this._drawHeat(); }}><ha-icon icon="mdi:fire"></ha-icon></button>`}
        ${c.show_playback === false || !hasTrail ? nothing : html`<button title="Play back the trip" class=${this._play ? "on" : ""}
          @click=${() => this._togglePlayback()}><ha-icon icon="mdi:play-circle-outline"></ha-icon></button>`}
      </div>
      ${this._renderLegend()}`;
  }

  _renderLegend() {
    const c = this.config;
    if (c.show_distance === false || c.show_people !== false) return nothing;
    const shown = this._trails.filter((t) => t.points.length >= 2);
    if (!shown.length) return nothing;
    return html`<div class="legend">${shown.map((t) => html`<div class="row">
      <span class="dot" style="background:${t.color}"></span><span class="nm">${t.name}</span><span class="mi">${this._fmtDist(t.distM)}</span>
    </div>`)}</div>`;
  }

  _renderPlayback() {
    if (!this._play) return nothing;
    const b = this._playBounds();
    if (!b) return nothing;
    const t = new Date(this._play.t);
    return html`<div class="playbar">
      <button @click=${this._playPause}><ha-icon icon=${this._play.playing ? "mdi:pause" : "mdi:play"}></ha-icon></button>
      <input type="range" min=${b[0]} max=${b[1]} step="1000" .value=${String(this._play.t)} @input=${this._scrub} />
      <span class="when">${t.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
      <button class="speed" @click=${this._cycleSpeed}>${this._play.speed}x</button>
    </div>`;
  }

  _renderPeople() {
    if (this.config.show_people === false) return nothing;
    const ids = this._personIds();
    if (!ids.length) return nothing;
    const { byPerson, groups } = this._travelIndex();
    const trails = Object.fromEntries(this._trails.map((t) => [t.id, t]));
    const compact = this.config.people_layout === "compact";
    return html`<div class=${compact ? "people compact" : "people"}>
      ${ids.map((id) => {
        const st = this.hass.states[id];
        const color = this._colorFor(id);
        const rows = byPerson[id] || [];
        const open = this._open === id;
        const bat = this._battery(id);
        const d = trails[id]?.distM;
        const first = rows.find((r) => r.kind === "route" && !r.arrived);
        return html`<div class=${open ? "person open" : "person"}>
          <div class="p-row" @click=${() => { this._open = open ? null : id; this._focusTravel(id); this._drawTravel(); }}>
            ${this._avatarTpl(id, color)}
            <div class="p-main">
              <div class="p-name">${this._nameOf(id)}</div>
              <div class="p-sub">
                <b>${this._placeOf(id)}</b> · ${this._ago(st.last_changed)}
                ${d ? html` · ${this._fmtDist(d)} ${this._window ? "" : `in ${this._rangeLabel(this._activeHours)}`}` : nothing}
                ${bat !== null ? html` · <span class=${bat <= 20 ? "low" : ""}>${bat}%</span>` : nothing}
              </div>
            </div>
            ${first && !open ? html`<div class="p-eta ${first.cls}">
              <span>${this._fmtMin(first.min)}</span><small>to ${first.label}</small></div>` : nothing}
            ${rows.length ? html`<ha-icon class="chev" icon=${open ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>` : nothing}
          </div>
          ${open && rows.length ? html`<div class="trips">
            ${rows.map((r) => html`<div class="trip" @click=${() => this._focusTravel(id, r)}>
              <ha-icon icon=${r.kind === "pair" ? "mdi:account-arrow-right" : "mdi:car-clock"}></ha-icon>
              <span class="t-to">${r.label}</span>
              <span class="t-txt ${r.cls}">${r.text}</span>
            </div>`)}
          </div>` : nothing}
        </div>`;
      })}
      ${groups.length && this.config.show_groups !== false ? html`<div class="groups">
        ${groups.map((g) => html`<div class="trip group">
          <ha-icon icon="mdi:account-group"></ha-icon>
          <span class="t-to">${g.label}</span>
          <span class="t-txt ${g.cls}">${g.text}</span>
          ${g.members ? html`<span class="t-mem">${g.members}</span>` : nothing}
        </div>`)}
      </div>` : nothing}
    </div>`;
  }

  render() {
    if (!this.config) return nothing;
    return html`<ha-card>
      ${this.config.title ? html`<div class="title">${this.config.title}</div>` : nothing}
      <div class="shell" style="width:${this._wrapperWidthCss}">
        <link rel="stylesheet" href="${BASE}vendor/leaflet.css?v=${VERSION}" />
        <div class="mapwrap" style="height:${this._cardHeightPx}px">
          <div class="map"></div>
          ${this.hass ? this._renderTools() : nothing}
          ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
        </div>
        ${this.hass ? this._renderPlayback() : nothing}
        ${this.hass ? this._renderPeople() : nothing}
      </div>
    </ha-card>`;
  }

  static get styles() {
    return css`
      :host { display: block; }
      ha-card { overflow: hidden; height: 100%; }
      .title { padding: 12px 16px 4px; font-size: 18px; font-weight: 500; }
      .shell { margin: 0 auto; max-width: 100%; }
      .mapwrap { position: relative; overflow: hidden; }
      .map { position: absolute; inset: 0; background: var(--secondary-background-color, #ddd); z-index: 0; }
      .map.invert .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9); }
      .map.dark { background: #1d2026; }
      .map .leaflet-control-attribution { font-size: 9px; background: rgba(255, 255, 255, 0.6); }
      .map.dark .leaflet-control-attribution { background: rgba(0, 0, 0, 0.5); color: #aaa; }
      .map.dark .leaflet-control-attribution a { color: #ccc; }
      .map.dark .leaflet-bar a { background: #2b2f36; color: #eee; border-color: #444; }
      .fm-mk { background: none; border: none; }
      .fm-av {
        width: var(--s); height: var(--s); box-sizing: border-box; border-radius: 50%;
        border: 3px solid var(--c); background: var(--c); color: #fff; overflow: hidden;
        display: grid; place-items: center; font: 600 calc(var(--s) * 0.36) / 1 var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45); cursor: pointer; user-select: none;
      }
      .leaflet-container .leaflet-marker-pane .fm-av img { width: 100% !important; height: 100% !important; }
      .fm-av img { width: 100%; height: 100%; object-fit: cover; object-position: center top; background: #fff; display: block; }
      .fm-av ha-icon { --mdc-icon-size: calc(var(--s) * 0.58); color: #fff; display: flex; }
      .fm-av.zone { border-width: 2px; background: var(--card-background-color, #fff); color: var(--c); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); }
      .fm-av.zone ha-icon { color: var(--c); }
      .fm-pair {
        white-space: nowrap; transform: translate(-50%, -50%); display: inline-block;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #222);
        font: 600 11px/1 var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        padding: 4px 7px; border-radius: 10px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      }
      .fm-pop .leaflet-popup-content-wrapper, .fm-pop .leaflet-popup-tip {
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #222);
      }
      .fm-pop .leaflet-popup-content { margin: 10px 12px; font-size: 13px; line-height: 1.35; }
      .pp-h { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
      .pp-h span { color: var(--primary-color, #03a9f4); font-weight: 600; }
      .pp-m { color: var(--secondary-text-color, #666); font-size: 12px; margin-top: 2px; }
      .pp-t { margin-top: 4px; }
      .pp-b { margin-top: 8px; width: 100%; border: 1px solid var(--divider-color, #ddd); background: transparent; color: inherit; border-radius: 8px; padding: 5px; font: inherit; cursor: pointer; }
      .chips {
        position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 2px; padding: 3px;
        border-radius: 16px; background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); z-index: 500; opacity: 0.94;
      }
      .chip { border: none; background: transparent; color: var(--primary-text-color, #222); font: inherit; font-size: 12px; line-height: 1; padding: 6px 9px; border-radius: 13px; cursor: pointer; }
      .chip.on { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
      .tools { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 6px; z-index: 500; }
      .tools button {
        width: 34px; height: 34px; border-radius: 10px; border: none; display: grid; place-items: center; cursor: pointer;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #222); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); --mdc-icon-size: 20px;
      }
      .tools button.on { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
      .legend {
        position: absolute; left: 8px; bottom: 22px; max-width: 60%; max-height: 40%; overflow: auto; padding: 6px 8px; border-radius: 8px;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #222); font-size: 12px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); z-index: 500; opacity: 0.94;
      }
      .legend .row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
      .legend .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
      .legend .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .err { position: absolute; inset: auto 8px 8px 8px; padding: 8px; border-radius: 8px; background: var(--error-color, #db4437); color: #fff; z-index: 600; font-size: 13px; }
      .playbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--divider-color); }
      .playbar input { flex: 1; accent-color: var(--primary-color); }
      .playbar button { border: none; background: none; color: inherit; cursor: pointer; padding: 4px; font: inherit; }
      .playbar .speed { font-size: 12px; font-weight: 600; min-width: 34px; }
      .playbar .when { font-size: 12px; color: var(--secondary-text-color); min-width: 92px; text-align: right; }
      .people { padding: 4px 6px 6px; }
      .person { border-radius: 12px; }
      .person.open { background: var(--secondary-background-color, rgba(127, 127, 127, 0.08)); }
      .p-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; cursor: pointer; border-radius: 12px; }
      .av {
        --size: 38px; width: var(--size); height: var(--size); flex: none; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
        border: 2px solid var(--c); background: var(--c); color: #fff; font-weight: 600; font-size: 14px; box-sizing: border-box;
      }
      .av img { width: 100%; height: 100%; object-fit: cover; object-position: center top; background: #fff; }
      .av ha-icon { --mdc-icon-size: 22px; }
      .p-main { flex: 1; min-width: 0; }
      .p-name { font-weight: 500; font-size: 15px; }
      .p-sub { font-size: 12.5px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .p-sub b { color: var(--primary-text-color); font-weight: 500; }
      .p-sub .low { color: var(--error-color, #db4437); }
      .p-eta { text-align: right; line-height: 1.1; }
      .p-eta span { display: block; font-weight: 600; font-size: 15px; font-variant-numeric: tabular-nums; }
      .p-eta small { color: var(--secondary-text-color); font-size: 11px; }
      .chev { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
      .trips, .groups { padding: 0 8px 8px 56px; display: grid; gap: 2px; }
      .groups { padding-left: 8px; border-top: 1px solid var(--divider-color); padding-top: 6px; margin-top: 4px; }
      .trip { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 8px; cursor: pointer; font-size: 13.5px; }
      .trip:hover { background: rgba(127, 127, 127, 0.1); }
      .trip ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
      .t-to { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .t-txt { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
      .t-mem { grid-column: 2 / 4; font-size: 12px; color: var(--secondary-text-color); }
      .warn, .p-eta.warn span { color: var(--warning-color, #ff9800) !important; }
      .alert, .p-eta.alert span { color: var(--error-color, #db4437) !important; }
      .ok, .p-eta.ok span { color: var(--success-color, #43a047) !important; }
      .people.compact .p-row { padding: 4px 6px; }
      .people.compact .av { --size: 30px; }
    `;
  }
}

// ============================================================================
// EDITOR
// ============================================================================
class FlexibleMapCardEditor extends LitElement {
  static get properties() {
    return { hass: { attribute: false }, _config: { attribute: false } };
  }

  setConfig(config) {
    this._config = config;
  }

  get _schema() {
    const sel = (options) => ({ select: { mode: "dropdown", options } });
    return [
      { name: "title", selector: { text: {} } },
      { name: "entities", selector: { entity: { multiple: true, filter: [{ domain: ["person", "device_tracker", "zone"] }] } } },
      {
        type: "expandable", name: "", title: "Map", icon: "mdi:map", schema: [
          { type: "grid", name: "", schema: [
            { name: "card_height", selector: { number: { min: 150, max: 1200, step: 10, mode: "box", unit_of_measurement: "px" } } },
            { name: "default_zoom", selector: { number: { min: 3, max: 19, step: 1, mode: "box" } } },
            { name: "marker_size", selector: { number: { min: 24, max: 72, step: 2, mode: "box", unit_of_measurement: "px" } } },
          ] },
          { name: "map_style", selector: sel([
            { value: "carto", label: "Clean (looks like Home Assistant)" },
            { value: "osm", label: "OpenStreetMap" },
            { value: "satellite", label: "Satellite" },
            { value: "custom", label: "Custom tile URL" },
          ]) },
          { name: "tile_url", selector: { text: {} } },
          { name: "theme_mode", selector: sel([
            { value: "auto", label: "Follow Home Assistant" },
            { value: "light", label: "Always light" },
            { value: "dark", label: "Always dark" },
          ]) },
          { name: "picture_fit", selector: sel([
            { value: "cover", label: "Fill the circle (keeps heads in)" },
            { value: "contain", label: "Show the whole picture" },
          ]) },
          { type: "grid", name: "", schema: [
            { name: "dark_at_night", selector: { boolean: {} } },
            { name: "show_zones", selector: { boolean: {} } },
            { name: "show_zone_radius", selector: { boolean: {} } },
            { name: "show_accuracy", selector: { boolean: {} } },
            { name: "auto_fit", selector: { boolean: {} } },
            { name: "fit_zones", selector: { boolean: {} } },
            { name: "add_all_entities", selector: { boolean: {} } },
            { name: "hide_zoom_controls", selector: { boolean: {} } },
            { name: "full_width", selector: { boolean: {} } },
          ] },
        ],
      },
      {
        type: "expandable", name: "", title: "History", icon: "mdi:map-marker-path", schema: [
          { name: "hours_to_show", selector: { number: { min: 0, max: 720, step: 1, mode: "box", unit_of_measurement: "h" } } },
          { name: "history_source", selector: sel([
            { value: "auto", label: "Auto (history file, then Home Assistant)" },
            { value: "integration", label: "History file only" },
            { value: "ha", label: "Home Assistant recorder only" },
          ]) },
          { name: "units", selector: sel([{ value: "mi", label: "Miles" }, { value: "km", label: "Kilometers" }]) },
          { name: "min_move_m", selector: { number: { min: 0, max: 200, step: 5, mode: "box", unit_of_measurement: "m" } } },
          { type: "grid", name: "", schema: [
            { name: "show_history_controls", selector: { boolean: {} } },
            { name: "show_heatmap_button", selector: { boolean: {} } },
            { name: "show_playback", selector: { boolean: {} } },
            { name: "show_points", selector: { boolean: {} } },
            { name: "show_distance", selector: { boolean: {} } },
          ] },
        ],
      },
      {
        type: "expandable", name: "", title: "People list & Travel Times", icon: "mdi:car-clock", schema: [
          { type: "grid", name: "", schema: [
            { name: "show_people", selector: { boolean: {} } },
            { name: "travel_times", selector: { boolean: {} } },
            { name: "travel_lines", selector: { boolean: {} } },
            { name: "pair_lines", selector: { boolean: {} } },
            { name: "show_groups", selector: { boolean: {} } },
          ] },
          { name: "people_layout", selector: sel([{ value: "normal", label: "Normal" }, { value: "compact", label: "Compact" }]) },
          { name: "travel_entities", selector: { entity: { multiple: true, filter: [{ domain: "sensor" }] } } },
          { type: "grid", name: "", schema: [
            { name: "warn_above", selector: { number: { min: 0, max: 600, step: 1, mode: "box", unit_of_measurement: "min" } } },
            { name: "alert_above", selector: { number: { min: 0, max: 600, step: 1, mode: "box", unit_of_measurement: "min" } } },
          ] },
        ],
      },
      { name: "hold_action", selector: { ui_action: { default_action: "none" } } },
    ];
  }

  _label = (s) => ({
    title: "Title (optional)",
    entities: "People, devices and extra zones",
    card_height: "Map height",
    default_zoom: "Zoom",
    marker_size: "Picture size",
    map_style: "Map look",
    tile_url: "Custom tile URL (only for Custom)",
    theme_mode: "Light / dark",
    picture_fit: "Pictures in the circles",
    dark_at_night: "Dark map after sunset",
    show_zones: "Show all zones",
    show_zone_radius: "Show zone circles",
    show_accuracy: "Show GPS accuracy circle",
    auto_fit: "Zoom to fit everyone",
    fit_zones: "Include zones when fitting",
    add_all_entities: "Add everything with a location",
    hide_zoom_controls: "Hide + / - buttons",
    full_width: "Full width",
    hours_to_show: "Trail length (hours, 0 = off)",
    history_source: "Where history comes from",
    units: "Units",
    min_move_m: "Ignore GPS jitter under",
    show_history_controls: "Show 1h / 6h / 24h buttons",
    show_heatmap_button: "Heatmap button",
    show_playback: "Playback button",
    show_points: "Show every point",
    show_distance: "Distance legend (when people list is off)",
    show_people: "People list under the map",
    travel_times: "Show Travel Times",
    travel_lines: "Lines to destinations",
    pair_lines: "Lines between people",
    show_groups: "Show group times",
    people_layout: "People list size",
    travel_entities: "Only these Travel Times sensors (empty = all)",
    warn_above: "Orange above",
    alert_above: "Red above",
    hold_action: "Hold action",
  }[s.name] || s.name);

  _changed(ev) {
    ev.stopPropagation();
    const cfg = { ...ev.detail.value };
    // keep per-entity options (colors, pictures) from YAML when the list changes in the editor
    const old = Object.fromEntries((this._config.entities || []).filter((e) => typeof e !== "string").map((e) => [e.entity, e]));
    cfg.entities = (cfg.entities || []).map((id) => old[id] || id);
    this._config = cfg;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.hass || !this._config) return nothing;
    const data = {
      card_height: 320, default_zoom: 14, marker_size: 40, map_style: "carto", theme_mode: "auto", picture_fit: "cover",
      hours_to_show: 24, history_source: "auto", units: "mi", min_move_m: 20, people_layout: "normal",
      show_zones: true, show_zone_radius: true, show_accuracy: true, auto_fit: true, full_width: true,
      show_history_controls: true, show_heatmap_button: true, show_playback: true, show_distance: true,
      show_people: true, travel_times: true, travel_lines: true, pair_lines: true, show_groups: true,
      ...this._config,
      entities: (this._config.entities || []).map(idOf),
    };
    return html`<ha-form .hass=${this.hass} .data=${data} .schema=${this._schema} .computeLabel=${this._label} @value-changed=${this._changed}></ha-form>`;
  }
}

// The sidebar dashboard uses its own tag, so an old copy of the card left in
// Dashboards > Resources (/local/flexible-map-card.js) can't take its place.
if (!customElements.get("fm-map-card-v4")) {
  customElements.define("fm-map-card-v4", class extends FlexibleMapCard {});
}
if (customElements.get("flexible-map-card") && !customElements.get("fm-map-card-v4-editor")) {
  console.warn("[flexible-map-card] An old copy of this card is loaded. Delete /local/flexible-map-card.js from Settings > Dashboards > Resources.");
  window.__fmOldCard = true;
}
if (!customElements.get("fm-map-card-v4-editor")) {
  customElements.define("fm-map-card-v4-editor", class extends FlexibleMapCardEditor {});
}
if (!customElements.get("flexible-map-card")) {
  customElements.define("flexible-map-card", FlexibleMapCard);
  customElements.define("flexible-map-card-editor", FlexibleMapCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "flexible-map-card",
    name: "Flexible Map",
    description: "Map with real pictures, history trails, heatmap, playback, a people list and Travel Times.",
    preview: true,
  });
  console.info(`%c FLEXIBLE-MAP-CARD %c ${VERSION} `, "background:#4dabf7;color:#fff;font-weight:700", "background:#333;color:#fff");
}
