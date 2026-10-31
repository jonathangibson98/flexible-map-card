import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@3.2.1/index.js?module";

const HOLD_MS = 600;
const MOVE_TOLERANCE_PX = 10;
const DEFAULT_RANGES = [1, 6, 24, 72, 168];
const FALLBACK_COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#cc5de8", "#ff922b", "#22b8cf", "#f06595"];
const METERS_PER_MILE = 1609.344;

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
    // history / trails
    this._activeHours = 0;
    this._trails = [];
    this._histToken = 0;
    this._histTimer = null;
    this._applyRetry = null;
    this._lastThemeMode = null;
    this._window = null; // {start: Date, end: Date} set by the dashboard
    this._noIntegration = false;
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
      hours_to_show: 24,
      history_source: "auto",
      show_zones: true,
      show_history_controls: true,
      show_distance: true,
      units: "mi",
      dark_at_night: false,
      min_move_m: 20,
      history_refresh_seconds: 60,
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
    this.config = {
      card_height: 250,
      full_width: true,
      card_width: 400,
      hours_to_show: 24,
      ...config,
    };
    this._activeHours = Number(this.config.hours_to_show) || 0;
    this._trails = [];
    this._mapEl = null;
    this._lastRatio = null;
    this._entitiesKey = "";
    this._disconnectObservers();
    this._restartHistoryTimer();
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
  // Zones (Home, Work, ...) only draw if they're in the entity list, so
  // `show_zones` adds every zone that has a location.
  _collectEntities() {
    const base = this._collectBase();
    if (!this.config?.show_zones || !this.hass) return base;
    const have = new Set(base.map((e) => (typeof e === "string" ? e : e.entity)));
    const registry = this.hass.entities || {};
    const zones = Object.entries(this.hass.states)
      .filter(
        ([id, st]) =>
          id.startsWith("zone.") &&
          !have.has(id) &&
          !registry[id]?.hidden &&
          st.attributes?.latitude !== undefined
      )
      .map(([id]) => id);
    return [...base, ...zones];
  }

  _collectBase() {
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

  _themeMode() {
    const base = this.config?.theme_mode || "auto";
    if (this.config?.dark_at_night && base === "auto") {
      const sun = this.hass?.states?.["sun.sun"]?.state;
      if (sun === "below_horizon") return "dark";
    }
    return base;
  }

  _buildMapConfig(aspectRatio) {
    const c = this.config;
    this._lastThemeMode = this._themeMode();
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
      theme_mode: this._themeMode(),
      map_style: c.map_style || "default",
      // History is drawn by this card itself (see _fetchHistory), so the
      // built-in trail is switched off to avoid double-drawing.
      hours_to_show: 0,
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
    this._fetchHistory();
  }

  // ------------------------------------------------------------------------
  // Click-to-Zoom Handler
  // ------------------------------------------------------------------------
  _handleMoreInfo(ev) {
    const entityId = ev.detail?.entityId;
    if (!entityId || !this.hass) return;

    const stateObj = this.hass.states[entityId];
    const lat = stateObj?.attributes?.latitude;
    const lon = stateObj?.attributes?.longitude;

    if (lat !== undefined && lon !== undefined) {
      // Prevent more-info dialog from opening
      ev.stopPropagation();
      ev.preventDefault();

      // HA's map now runs on MapLibre; ha-map exposes setView()/getView()
      try {
        const haMap = this._haMap();
        if (haMap && typeof haMap.setView === "function") {
          const cur = haMap.getView?.();
          const curZoom = typeof cur?.zoom === "number" ? cur.zoom : 0;
          haMap.setView([lat, lon], Math.max(curZoom, 16));
          return;
        }
      } catch (err) {
        console.warn("[flexible-map-card] setView failed, using fallback.", err);
      }

      // Fallback: update map configuration to focus/zoom if direct reference isn't found
      if (this._mapEl) {
        const updatedConfig = {
          ...this._mapEl.config,
          default_zoom: Math.max(this.config.default_zoom || 14, 16),
        };
        this._mapEl.setConfig(updatedConfig);
      }
    }
  }

  // ------------------------------------------------------------------------
  // History trails (drawn by this card, independent of the built-in trail)
  // ------------------------------------------------------------------------
  _haMap() {
    return this._mapEl?.shadowRoot?.querySelector("ha-map") || null;
  }

  _trailEntityIds() {
    const ids = [];
    for (const e of this._collectEntities()) {
      const id = typeof e === "string" ? e : e?.entity;
      if (id && !id.startsWith("zone.")) ids.push(id);
    }
    return [...new Set(ids)];
  }

  _colorFor(id, idx) {
    const cfg = (this.config.entities || []).find(
      (e) => typeof e !== "string" && e?.entity === id
    );
    if (cfg?.color) return cfg.color;
    const marker = this._haMap()?.entities?.find?.((e) => e.entity_id === id);
    return marker?.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  }

  _distM(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }

  _restartHistoryTimer() {
    clearInterval(this._histTimer);
    this._histTimer = null;
    if (!this.isConnected || !this.config) return;
    const secs = Math.max(15, Number(this.config.history_refresh_seconds) || 60);
    this._histTimer = setInterval(() => this._fetchHistory(), secs * 1000);
  }

  _emitTrails() {
    this.dispatchEvent(
      new CustomEvent("trails-changed", {
        detail: { trails: this._trails, window: this._window },
      })
    );
  }

  // live = true keeps the end of the window at "now" on every refresh
  setWindow(start, end, live = false) {
    this._window = { start, end, live };
    this._fetchHistory();
    this.requestUpdate();
  }

  clearWindow() {
    this._window = null;
    this._fetchHistory();
    this.requestUpdate();
  }

  focusEntity(entityId) {
    const a = this.hass?.states?.[entityId]?.attributes;
    if (a?.latitude === undefined) return;
    this._haMap()?.setView?.([a.latitude, a.longitude], 16);
  }

  async _fetchHistory() {
    const raw = this._window;
    const win = raw
      ? { start: raw.start, end: raw.live ? new Date() : raw.end }
      : null;
    const hours = win
      ? Math.max(1, Math.ceil((win.end - win.start) / 3600000))
      : Number(this._activeHours) || 0;
    const token = ++this._histToken;
    if (!this.hass || !this.config) return;

    const ids = hours ? this._trailEntityIds() : [];
    if (!hours || !ids.length) {
      this._trails = [];
      this._applyPaths();
      this._emitTrails();
      this.requestUpdate();
      return;
    }

    const end = win ? win.end : new Date();
    const start = win ? win.start : new Date(end.getTime() - hours * 3600 * 1000);
    const source = this.config.history_source || "auto";
    const rowsById = {}; // id -> [{ts: Date, lat, lon, acc}]

    // 1) The Flexible Map integration's own history file (kept as long as you want)
    if (source !== "ha" && !this._noIntegration) {
      try {
        const r = await this.hass.callWS({
          type: "flexible_map/history",
          entity_ids: ids,
          start: start.getTime() / 1000,
          end: end.getTime() / 1000,
          max_points: 5000,
        });
        for (const [id, pts] of Object.entries(r?.points || {})) {
          rowsById[id] = pts.map((p) => ({
            ts: new Date(p[0] * 1000),
            lat: p[1],
            lon: p[2],
            acc: p[3],
          }));
        }
      } catch (err) {
        if (err?.code === "unknown_command") this._noIntegration = true;
        else console.warn("[flexible-map-card] history file request failed", err);
      }
    }

    // 2) Home Assistant's recorder for anything the file doesn't cover yet
    const missing =
      source === "integration" ? [] : ids.filter((id) => (rowsById[id]?.length || 0) < 2);
    if (missing.length) {
      try {
        const res = await this.hass.callWS({
          type: "history/history_during_period",
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          entity_ids: missing,
          include_start_time_state: true,
          significant_changes_only: false,
          minimal_response: false,
          no_attributes: false,
        });
        const toDate = (v) => (typeof v === "number" ? new Date(v * 1000) : new Date(v));
        for (const id of missing) {
          const rows = Array.isArray(res?.[id]) ? res[id] : [];
          rowsById[id] = rows.map((row) => {
            const a = row.a ?? row.attributes ?? {};
            return {
              ts: toDate(row.lu ?? row.last_updated ?? row.lc),
              lat: a.latitude,
              lon: a.longitude,
              acc: a.gps_accuracy,
            };
          });
        }
      } catch (err) {
        console.warn("[flexible-map-card] HA history request failed", err);
      }
    }
    if (token !== this._histToken) return; // a newer request superseded this one

    const minMove = Math.max(0, Number(this.config.min_move_m ?? 20));
    const maxAcc = Number(this.config.max_accuracy_m) || 0;
    const viewingNow = !win || win.end.getTime() >= Date.now() - 120000;
    const trails = [];

    ids.forEach((id, idx) => {
      const points = [];
      let distM = 0;

      const add = (lat, lon, ts, force) => {
        if (typeof lat !== "number" || typeof lon !== "number") return;
        const last = points[points.length - 1];
        if (last) {
          const d = this._distM(last.point, [lat, lon]);
          if (d < minMove && !force) return;
          if (d === 0) return;
          distM += d;
        }
        points.push({ point: [lat, lon], timestamp: ts });
      };

      for (const row of rowsById[id] || []) {
        if (maxAcc && typeof row.acc === "number" && row.acc > maxAcc) continue;
        add(row.lat, row.lon, row.ts, false);
      }

      // Make sure the trail reaches the marker's current position
      const cur = this.hass.states[id]?.attributes;
      if (cur && viewingNow) add(cur.latitude, cur.longitude, new Date(), true);

      const stateObj = this.hass.states[id];
      trails.push({
        id,
        name: stateObj?.attributes?.friendly_name || id,
        color: this._colorFor(id, idx),
        points,
        distM,
      });
    });

    this._trails = trails;
    this._applyPaths();
    this._emitTrails();
    this.requestUpdate();
  }

  _applyPaths(attempt = 0) {
    clearTimeout(this._applyRetry);
    const haMap = this._haMap();
    if (!haMap) {
      // inner map isn't rendered yet; try again shortly
      if (attempt < 12) {
        this._applyRetry = setTimeout(() => this._applyPaths(attempt + 1), 500);
      }
      return;
    }
    const win = this._window;
    const hours = win
      ? Math.ceil(((win.live ? new Date() : win.end) - win.start) / 3600000)
      : Number(this._activeHours) || 0;
    const paths = hours
      ? this._trails
          .filter((t) => t.points.length >= 2)
          .map((t) => ({
            points: t.points,
            name: t.name,
            color: t.color,
            // gradual opacity divides by (points - 2), so it needs 3+ points
            gradualOpacity: t.points.length > 2 ? 0.8 : undefined,
            fullDatetime: hours > 144,
          }))
      : [];
    haMap.paths = paths.length ? paths : undefined;
  }

  _setRange(hours) {
    this._activeHours = hours;
    this._fetchHistory();
    this.requestUpdate();
  }

  _rangeLabel(h) {
    if (!h) return "Off";
    if (h < 24 || h % 24) return `${h}h`;
    return `${h / 24}d`;
  }

  _fmtDist(m) {
    const km = this.config?.units === "km";
    const v = km ? m / 1000 : m / METERS_PER_MILE;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${km ? "km" : "mi"}`;
  }

  _renderControls() {
    const c = this.config;
    const active = this._window ? 1 : Number(this._activeHours) || 0;
    const ranges = Array.isArray(c.history_ranges) && c.history_ranges.length
      ? c.history_ranges
      : DEFAULT_RANGES;
    const chips =
      c.show_history_controls === false
        ? html``
        : html`<div class="chips">
            ${[0, ...ranges].map(
              (h) => html`<button
                class=${h === active ? "chip on" : "chip"}
                @click=${() => this._setRange(h)}
              >${this._rangeLabel(h)}</button>`
            )}
          </div>`;

    const shown = this._trails.filter((t) => t.points.length >= 2);
    const legend =
      c.show_distance === false || !active || !shown.length
        ? html``
        : html`<div class="legend">
            ${shown.map(
              (t) => html`<div class="row">
                <span class="dot" style="background:${t.color}"></span>
                <span class="nm">${t.name}</span>
                <span class="mi">${this._fmtDist(t.distM)}</span>
              </div>`
            )}
          </div>`;
    return html`${chips}${legend}`;
  }

  // ------------------------------------------------------------------------
  // Hiding the zoom / orient buttons
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

    // Intercept more-info events to handle click-to-zoom instead of opening dialog
    wrapper.addEventListener("hass-more-info", (e) => this._handleMoreInfo(e), true);

    // Capture phase so the map's own drag handling can't swallow these pointers
    wrapper.addEventListener("pointerdown", (e) => this._onPointerDown(e), true);
    wrapper.addEventListener("pointermove", (e) => this._onPointerMove(e), true);
    wrapper.addEventListener("pointerup", () => this._cancelHold(), true);
    wrapper.addEventListener("pointercancel", () => this._cancelHold(), true);
    wrapper.addEventListener("pointerleave", () => this._cancelHold(), true);
    wrapper.addEventListener("contextmenu", (e) => this._onContextMenu(e), true);

    this._ensureMap();
  }

  connectedCallback() {
    super.connectedCallback();
    this._restartHistoryTimer();
    if (this._mapEl) this._fetchHistory();
  }

  updated(changed) {
    if (changed.has("config")) {
      this._ensureMap();
    }
    if (changed.has("hass")) {
      if (this._mapEl) this._mapEl.hass = this.hass;
      if (!this._mapEl && this.hass) this._ensureMap();

      if (this._mapEl) {
        let rebuild = this._themeMode() !== this._lastThemeMode;
        let refetch = false;
        if (this.config?.add_all_entities || this.config?.show_zones) {
          const key = this._entitiesKeyOf(this._collectEntities());
          if (key !== this._entitiesKey) {
            rebuild = true;
            refetch = true;
          }
        }
        if (rebuild) {
          this._mapEl.setConfig(this._buildMapConfig(this._lastRatio));
          this._scheduleHideApply();
          this._applyPaths(); // re-assert trails after the inner map reconfigures
          if (refetch) this._fetchHistory();
        }
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    clearTimeout(this._resizeTimer);
    clearTimeout(this._holdTimer);
    clearTimeout(this._applyRetry);
    clearInterval(this._histTimer);
    this._histTimer = null;
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
      .shell {
        position: relative;
        margin: 0 auto;
        max-width: 100%;
      }
      .map-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
        touch-action: pan-x pan-y;
        -webkit-touch-callout: none;
        user-select: none;
      }
      .chips {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        opacity: 0.92;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        z-index: 5;
      }
      .chip {
        border: none;
        background: transparent;
        color: var(--primary-text-color, #222);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        padding: 6px 9px;
        border-radius: 13px;
        cursor: pointer;
      }
      .chip.on {
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
      }
      .legend {
        position: absolute;
        left: 8px;
        bottom: 24px;
        max-width: 60%;
        max-height: 40%;
        overflow: auto;
        padding: 6px 8px;
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #222);
        opacity: 0.92;
        font-size: 12px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        z-index: 5;
      }
      .legend .row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 1px 0;
      }
      .legend .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
      }
      .legend .nm {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .legend .mi {
        font-variant-numeric: tabular-nums;
        opacity: 0.8;
      }
    `;
  }

  render() {
    if (!this.hass || !this.config) return html``;
    return html`
      <ha-card>
        <div
          class="shell"
          style="height: ${this._cardHeightPx}px; width: ${this._wrapperWidthCss};"
        >
          <div class="map-wrapper"></div>
          ${this._renderControls()}
        </div>
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
          number: { min: 0, max: 240, step: 1, mode: "slider", unit_of_measurement: "h" },
        },
      },
      {
        name: "history_source",
        selector: { select: { mode: "dropdown", options: [
          { value: "auto", label: "Auto (history file, then Home Assistant)" },
          { value: "integration", label: "History file only" },
          { value: "ha", label: "Home Assistant recorder only" },
        ] } },
      },
      {
        name: "units",
        selector: { select: { mode: "dropdown", options: [
          { value: "mi", label: "Miles" },
          { value: "km", label: "Kilometers" },
        ] } },
      },
      {
        name: "min_move_m",
        selector: { number: { min: 0, max: 200, step: 5, mode: "slider", unit_of_measurement: "m" } },
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
          { name: "show_zones", selector: { boolean: {} } },
          { name: "show_history_controls", selector: { boolean: {} } },
          { name: "show_distance", selector: { boolean: {} } },
          { name: "dark_at_night", selector: { boolean: {} } },
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
      hours_to_show: "History trail (hours, 0 = off)",
      history_source: "Where history comes from",
      show_zones: "Show zone icons (Home, Work, ...)",
      units: "Distance units",
      min_move_m: "Ignore GPS jitter under (meters)",
      show_history_controls: "Show 1h / 6h / 24h buttons",
      show_distance: "Show distance legend",
      dark_at_night: "Dark map after sunset (uses sun.sun)",
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
      hours_to_show: 24,
      units: "mi",
      min_move_m: 20,
      show_history_controls: true,
      show_distance: true,
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

if (!customElements.get("flexible-map-card")) {
  customElements.define("flexible-map-card", FlexibleMapCard);
  customElements.define("flexible-map-card-editor", FlexibleMapCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "flexible-map-card",
    name: "Flexible Map",
    description: "Resizable map with history trails, distance in miles and click-to-zoom.",
    preview: true,
  });
}
