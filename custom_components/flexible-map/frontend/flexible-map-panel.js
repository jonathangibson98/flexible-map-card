import {
  LitElement,
  html,
  css,
  nothing,
} from "https://unpkg.com/lit@3.2.1/index.js?module";

const LOGO = "/flexible_map_static/logo.svg";
const MI = 1609.344;
const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["custom", "Pick dates"],
];
const TABS = [
  ["map", "Map"],
  ["places", "Places"],
  ["import", "Import"],
  ["settings", "Settings"],
];

const hav = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- turn the many JSON shapes people have into [ts, lat, lon, acc] ----------
function toSeconds(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v > 1e11 ? v / 1000 : v;
  const n = Number(v);
  if (!Number.isNaN(n) && String(v).trim() !== "") return n > 1e11 ? n / 1000 : n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t / 1000;
}
function parsePoints(data) {
  const out = [];
  const push = (ts, lat, lon, acc) => {
    ts = toSeconds(ts);
    lat = Number(lat);
    lon = Number(lon);
    if (ts === null || Number.isNaN(lat) || Number.isNaN(lon)) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    const a = Number(acc);
    out.push([ts, lat, lon, Number.isNaN(a) || acc === undefined || acc === null ? null : a]);
  };
  const timeOf = (o) =>
    o.timestamp ?? o.timestampMs ?? o.time ?? o.ts ?? o.tst ?? o.t ??
    o.datetime ?? o.date ?? o.isoDateTime ?? o.created_at ?? o.recorded_at ??
    o.last_updated ?? o.lu;
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (Array.isArray(item) && item.length >= 3 && typeof item[1] === "number") {
          push(item[0], item[1], item[2], item[3]); // [ts, lat, lon, acc]
        } else if (item && typeof item === "object") {
          if (item.latitudeE7 !== undefined) {
            push(timeOf(item), item.latitudeE7 / 1e7, item.longitudeE7 / 1e7, item.accuracy);
          } else if (item.type === "Feature" && item.geometry?.type === "Point") {
            const [lon, lat] = item.geometry.coordinates;
            push(timeOf(item.properties || {}), lat, lon, item.properties?.accuracy ?? item.properties?.acc);
          } else if (item.lat !== undefined || item.latitude !== undefined) {
            push(
              timeOf(item),
              item.lat ?? item.latitude,
              item.lon ?? item.lng ?? item.longitude,
              item.acc ?? item.accuracy ?? item.gps_accuracy
            );
          } else if (item.attributes?.latitude !== undefined) {
            push(timeOf(item), item.attributes.latitude, item.attributes.longitude, item.attributes.gps_accuracy);
          } else {
            walk(item);
          }
        }
      }
    } else if (node && typeof node === "object") {
      if (node.type === "FeatureCollection") return walk(node.features);
      for (const key of ["locations", "points", "data", "records", "history", "features", "items", "positions"]) {
        if (Array.isArray(node[key])) return walk(node[key]);
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
    }
  };
  walk(data);
  return out;
}

class FlexibleMapPanel extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      narrow: { type: Boolean },
      panel: { attribute: false },
      _tab: { state: true },
      _selected: { state: true },
      _range: { state: true },
      _from: { state: true },
      _to: { state: true },
      _cfg: { state: true },
      _zones: { state: true },
      _trails: { state: true },
      _colors: { state: true },
      _stats: { state: true },
      _draft: { state: true },
      _msg: { state: true },
      _place: { state: true },
      _imp: { state: true },
    };
  }

  constructor() {
    super();
    this._tab = "map";
    this._selected = null; // null = everyone
    this._range = "today";
    this._from = ymd(new Date());
    this._to = ymd(new Date());
    this._cfg = null;
    this._zones = [];
    this._trails = [];
    this._colors = {};
    this._stats = null;
    this._draft = null;
    this._msg = "";
    this._place = { id: null, name: "", lat: "", lon: "", feet: 330, icon: "" };
    this._imp = { entity: "", custom: "", points: null, file: "", busy: false, log: "", days: 10 };
    this._cardKey = "";
    this._winKey = "";
  }

  connectedCallback() {
    super.connectedCallback();
    const url = this.panel?.config?.card_url;
    if (url && !customElements.get("flexible-map-card")) import(url).catch(() => {});
    this._load();
  }

  async _load() {
    try {
      this._cfg = await this.hass.callWS({ type: "flexible_map/config" });
      this._draft = { ...this._cfg.options };
    } catch (e) {
      this._msg = "The Flexible Map integration isn't running yet. Restart Home Assistant once after installing it.";
    }
    this._loadZones();
  }

  async _loadZones() {
    try {
      this._zones = await this.hass.callWS({ type: "zone/list" });
    } catch (e) {
      this._zones = [];
    }
  }

  get _admin() {
    return !!this.hass?.user?.is_admin;
  }
  get _units() {
    return this._cfg?.options?.units === "km" ? "km" : "mi";
  }
  _dist(m) {
    const v = this._units === "km" ? m / 1000 : m / MI;
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${this._units}`;
  }

  // ---- who ------------------------------------------------------------------
  get _people() {
    const tracked = this._cfg?.options?.tracked_entities || [];
    const ids = tracked.length
      ? tracked
      : Object.keys(this.hass.states).filter((e) => e.startsWith("person."));
    return ids
      .filter((id) => this.hass.states[id])
      .map((id) => {
        const st = this.hass.states[id];
        return {
          id,
          name: st.attributes.friendly_name || id,
          picture: st.attributes.entity_picture,
        };
      });
  }
  get _chosen() {
    const all = this._people.map((p) => p.id);
    return this._selected ? this._selected.filter((id) => all.includes(id)) : all;
  }
  _toggle(id) {
    const cur = new Set(this._chosen);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    this._selected = [...cur];
  }

  // ---- when -----------------------------------------------------------------
  get _window() {
    const now = new Date();
    const today = dayStart(now);
    const day = 86400000;
    switch (this._range) {
      case "yesterday":
        return { start: new Date(today - day), end: today };
      case "7d":
        return { start: new Date(now - 7 * day), end: now };
      case "30d":
        return { start: new Date(now - 30 * day), end: now };
      case "custom": {
        const s = new Date(`${this._from}T00:00:00`);
        const e = new Date(`${this._to}T00:00:00`);
        return {
          start: s,
          end: new Date(Math.max(+e, +s) + day),
        };
      }
      default:
        return { start: today, end: now };
    }
  }

  // ---- map tab: wire the card up --------------------------------------------
  _cardConfig() {
    return {
      type: "custom:flexible-map-card",
      entities: this._chosen,
      card_height: Math.min(560, Math.max(280, Math.round(window.innerHeight * 0.46))),
      full_width: true,
      hours_to_show: 24,
      show_history_controls: false,
      show_distance: false,
      units: this._units,
      auto_fit: true,
      show_zone_radius: true,
      dark_at_night: true,
      default_zoom: 14,
      cluster: false,
      hide_orient_buttons: false,
    };
  }

  updated() {
    const card = this.renderRoot?.querySelector("flexible-map-card");
    if (!card || this._tab !== "map") return;
    if (card !== this._cardEl) {
      // a fresh card element (e.g. after visiting another tab) needs everything again
      this._cardEl = card;
      this._cardKey = "";
      this._winKey = "";
    }
    const cfg = this._cardConfig();
    const key = JSON.stringify(cfg);
    if (key !== this._cardKey) {
      this._cardKey = key;
      this._winKey = "";
      card.setConfig(cfg);
    }
    const w = this._window;
    const wk = `${+w.start}|${+w.end}`;
    // "now" moves every second; only re-query when the range itself changed
    const stable = this._range === "today" || this._range === "7d" || this._range === "30d" ? this._range : wk;
    if (stable !== this._winKey) {
      this._winKey = stable;
      card.setWindow(w.start, w.end, ["today", "7d", "30d"].includes(this._range));
    }
  }

  _onTrails(ev) {
    const trails = ev.detail.trails || [];
    this._trails = trails;
    const colors = {};
    for (const t of trails) colors[t.id] = t.color;
    this._colors = colors;
  }

  // ---- timeline: group points by the zone they were in ----------------------
  _zoneList() {
    return Object.values(this.hass.states)
      .filter((s) => s.entity_id.startsWith("zone.") && s.attributes.latitude !== undefined)
      .map((s) => ({
        name: s.attributes.friendly_name || s.entity_id,
        lat: s.attributes.latitude,
        lon: s.attributes.longitude,
        r: Number(s.attributes.radius) || 100,
      }));
  }
  _segments(trail) {
    const zones = this._zoneList();
    const labelOf = (lat, lon) => {
      let best = null;
      for (const z of zones) {
        if (hav(lat, lon, z.lat, z.lon) <= z.r && (!best || z.r < best.r)) best = z;
      }
      return best ? best.name : null;
    };
    const segs = [];
    let prev = null;
    for (const p of trail.points) {
      const label = labelOf(p.point[0], p.point[1]);
      const step = prev ? hav(prev.point[0], prev.point[1], p.point[0], p.point[1]) : 0;
      const last = segs[segs.length - 1];
      if (last && last.label === label) {
        last.distM += step;
        last.end = p.timestamp;
      } else {
        segs.push({ label, start: p.timestamp, end: p.timestamp, distM: step });
      }
      prev = p;
    }
    // a stay lasts until the next stop begins
    for (let i = 0; i < segs.length - 1; i++) segs[i].end = segs[i + 1].start;
    return segs;
  }
  _t(d) {
    const w = this._window;
    const multi = w.end - w.start > 86400000 * 1.5;
    return d.toLocaleString([], multi
      ? { weekday: "short", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" });
  }
  _dur(a, b) {
    const m = Math.round((b - a) / 60000);
    if (m < 1) return "";
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }

  // ---- places ---------------------------------------------------------------
  async _savePlace() {
    const p = this._place;
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!p.name.trim() || Number.isNaN(lat) || Number.isNaN(lon)) {
      this._msg = "A place needs a name and a location.";
      return;
    }
    const body = {
      name: p.name.trim(),
      latitude: lat,
      longitude: lon,
      radius: Math.round(Number(p.feet || 330) / 3.28084),
    };
    if (p.icon.trim()) body.icon = p.icon.trim();
    try {
      if (p.id) await this.hass.callWS({ type: "zone/update", zone_id: p.id, ...body });
      else await this.hass.callWS({ type: "zone/create", ...body });
      this._msg = p.id ? "Place updated." : "Place added.";
      this._place = { id: null, name: "", lat: "", lon: "", feet: 330, icon: "" };
      this._loadZones();
    } catch (e) {
      this._msg = `Couldn't save the place: ${e.message || e.code}`;
    }
  }
  async _deletePlace(z) {
    if (!confirm(`Delete the place "${z.name}"?`)) return;
    try {
      await this.hass.callWS({ type: "zone/delete", zone_id: z.id });
      this._loadZones();
    } catch (e) {
      this._msg = `Couldn't delete: ${e.message || e.code}`;
    }
  }
  _useLocationOf(id) {
    const a = this.hass.states[id]?.attributes;
    if (a?.latitude === undefined) return;
    this._place = { ...this._place, lat: a.latitude, lon: a.longitude };
  }

  // ---- import ---------------------------------------------------------------
  async _pickFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const pts = parsePoints(JSON.parse(await file.text()));
      this._imp = { ...this._imp, file: file.name, points: pts, log: pts.length ? "" : "No locations found in that file." };
    } catch (e) {
      this._imp = { ...this._imp, file: file.name, points: null, log: "That doesn't look like a JSON file." };
    }
  }
  async _sendBatches(entity, points, onProgress) {
    let added = 0;
    for (let i = 0; i < points.length; i += 2000) {
      const res = await this.hass.callWS({
        type: "flexible_map/import_points",
        entity_id: entity,
        points: points.slice(i, i + 2000),
      });
      added += res.added;
      onProgress?.(Math.min(i + 2000, points.length), points.length);
    }
    return added;
  }
  async _runImport() {
    const imp = this._imp;
    const entity = (imp.custom.trim() || imp.entity).trim();
    if (!entity || !imp.points?.length) return;
    this._imp = { ...imp, busy: true, log: "Importing…" };
    try {
      const added = await this._sendBatches(entity, imp.points, (n, total) => {
        this._imp = { ...this._imp, log: `Importing… ${n} of ${total}` };
      });
      this._imp = { ...this._imp, busy: false, points: null, file: "", log: `Done. ${added} new points saved for ${entity} (${imp.points.length - added} were already there).` };
    } catch (e) {
      this._imp = { ...this._imp, busy: false, log: `Import failed: ${e.message || e.code}` };
    }
  }
  async _backfill() {
    const days = Math.max(1, Math.min(60, Number(this._imp.days) || 10));
    this._imp = { ...this._imp, busy: true, log: "Reading Home Assistant history…" };
    let total = 0;
    try {
      for (const p of this._people) {
        for (let i = 0; i < days; i++) {
          const end = new Date(Date.now() - i * 86400000);
          const start = new Date(end - 86400000);
          this._imp = { ...this._imp, log: `${p.name}: day ${i + 1} of ${days}…` };
          const res = await this.hass.callWS({
            type: "history/history_during_period",
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            entity_ids: [p.id],
            include_start_time_state: false,
            significant_changes_only: false,
            minimal_response: false,
            no_attributes: false,
          });
          const rows = (res?.[p.id] || [])
            .map((r) => {
              const a = r.a ?? r.attributes ?? {};
              return [r.lu ?? r.last_updated, a.latitude, a.longitude, a.gps_accuracy];
            })
            .filter((r) => typeof r[1] === "number" && typeof r[2] === "number");
          if (rows.length) total += await this._sendBatches(p.id, rows);
        }
      }
      this._imp = { ...this._imp, busy: false, log: `Done. ${total} points copied from Home Assistant's history.` };
    } catch (e) {
      this._imp = { ...this._imp, busy: false, log: `Couldn't finish: ${e.message || e.code}` };
    }
  }

  // ---- settings -------------------------------------------------------------
  async _openSettings() {
    this._tab = "settings";
    try {
      this._stats = await this.hass.callWS({ type: "flexible_map/stats" });
    } catch (e) {
      this._stats = null;
    }
  }
  async _saveSettings() {
    const d = this._draft;
    try {
      await this.hass.callWS({
        type: "flexible_map/set_options",
        tracked_entities: d.tracked_entities || [],
        units: d.units,
        min_distance_m: Number(d.min_distance_m),
        min_seconds: Number(d.min_seconds),
        max_accuracy_m: Number(d.max_accuracy_m),
        retention_days: Number(d.retention_days),
      });
      this._msg = "Saved. Flexible Map is restarting itself with the new settings.";
      setTimeout(() => this._load(), 2500);
    } catch (e) {
      this._msg = `Couldn't save: ${e.message || e.code}`;
    }
  }
  async _wipe(entity) {
    if (!confirm(`Delete ALL saved history for ${entity}? This can't be undone.`)) return;
    try {
      const r = await this.hass.callWS({ type: "flexible_map/delete_range", entity_id: entity, start: 0, end: Date.now() / 1000 + 86400 });
      this._msg = `Deleted ${r.removed} points for ${entity}.`;
      this._stats = await this.hass.callWS({ type: "flexible_map/stats" });
    } catch (e) {
      this._msg = `Couldn't delete: ${e.message || e.code}`;
    }
  }

  // ---- rendering ------------------------------------------------------------
  _renderMap() {
    const people = this._people;
    const chosen = new Set(this._chosen);
    return html`
      <div class="people">
        ${people.map((p) => html`
          <button class=${chosen.has(p.id) ? "person on" : "person"} @click=${() => this._toggle(p.id)}
                  style="--ring:${this._colors[p.id] || "var(--divider-color)"}">
            <span class="avatar">
              ${p.picture ? html`<img src=${p.picture} alt="" />` : html`<span>${p.name[0]}</span>`}
            </span>
            ${p.name}
          </button>`)}
      </div>
      <div class="ranges">
        ${RANGES.map(([k, label]) => html`
          <button class=${this._range === k ? "range on" : "range"} @click=${() => (this._range = k)}>${label}</button>`)}
        ${this._range === "custom" ? html`
          <input type="date" .value=${this._from} @change=${(e) => (this._from = e.target.value)} />
          <span>to</span>
          <input type="date" .value=${this._to} @change=${(e) => (this._to = e.target.value)} />` : nothing}
      </div>
      ${chosen.size
        ? html`<div class="mapbox">
            <flexible-map-card .hass=${this.hass} @trails-changed=${this._onTrails}></flexible-map-card>
          </div>`
        : html`<div class="empty">Pick at least one person above to see where they've been.</div>`}
      ${this._renderTimeline()}`;
  }

  _renderTimeline() {
    const trails = this._trails.filter((t) => t.points.length > 1 && this._chosen.includes(t.id));
    if (!trails.length) {
      return html`<div class="empty">No saved movement for this range yet. New points are saved as phones report in; use Import to bring in older history.</div>`;
    }
    return html`<div class="timelines">
      ${trails.map((t) => {
        const segs = this._segments(t);
        return html`<section class="tl" style="--c:${t.color}">
          <h3><span class="dot"></span>${t.name}<span class="total">${this._dist(t.distM)}</span></h3>
          <ol>
            ${segs.map((s) => html`<li>
              <span class="what">${s.label || "On the move"}</span>
              <span class="when">${this._t(s.start)}${s.end - s.start > 60000 ? html` – ${this._t(s.end)}` : nothing}</span>
              <span class="more">${s.label ? this._dur(s.start, s.end) : this._dist(s.distM)}</span>
            </li>`)}
          </ol>
        </section>`;
      })}
    </div>`;
  }

  _renderPlaces() {
    const stored = this._zones;
    const states = Object.values(this.hass.states).filter((s) => s.entity_id.startsWith("zone."));
    const p = this._place;
    const people = this._people;
    return html`
      <p class="hint">Places are Home Assistant zones, so they show on every map and work in automations.</p>
      <ul class="list">
        ${states.map((s) => {
          const item = stored.find((z) => z.name === (s.attributes.friendly_name || ""));
          const r = Number(s.attributes.radius) || 0;
          return html`<li>
            <div><b>${s.attributes.friendly_name || s.entity_id}</b>
              <span class="muted">${Math.round(r * 3.28084)} ft radius${item ? "" : " · set in configuration"}</span></div>
            ${item && this._admin ? html`<div class="btns">
              <button @click=${() => (this._place = { id: item.id, name: item.name, lat: item.latitude, lon: item.longitude, feet: Math.round(item.radius * 3.28084), icon: item.icon || "" })}>Edit</button>
              <button class="danger" @click=${() => this._deletePlace(item)}>Delete</button></div>` : nothing}
          </li>`;
        })}
      </ul>
      ${this._admin ? html`<div class="form">
        <h3>${p.id ? "Edit place" : "Add a place"}</h3>
        <label>Name <input .value=${p.name} @input=${(e) => (this._place = { ...p, name: e.target.value })} /></label>
        <label>Use the current location of
          <select @change=${(e) => this._useLocationOf(e.target.value)}>
            <option value="">Choose…</option>
            ${people.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
          </select></label>
        <div class="two">
          <label>Latitude <input .value=${String(p.lat)} @input=${(e) => (this._place = { ...p, lat: e.target.value })} /></label>
          <label>Longitude <input .value=${String(p.lon)} @input=${(e) => (this._place = { ...p, lon: e.target.value })} /></label>
        </div>
        <div class="two">
          <label>Radius (feet) <input type="number" .value=${String(p.feet)} @input=${(e) => (this._place = { ...p, feet: e.target.value })} /></label>
          <label>Icon (optional, like mdi:home) <input .value=${p.icon} @input=${(e) => (this._place = { ...p, icon: e.target.value })} /></label>
        </div>
        <div class="btns"><button class="primary" @click=${this._savePlace}>${p.id ? "Save changes" : "Add place"}</button>
          ${p.id ? html`<button @click=${() => (this._place = { id: null, name: "", lat: "", lon: "", feet: 330, icon: "" })}>Cancel</button>` : nothing}</div>
      </div>` : html`<p class="hint">Ask an admin to add or change places.</p>`}`;
  }

  _renderImport() {
    const imp = this._imp;
    const people = this._people;
    const pts = imp.points;
    let range = "";
    if (pts?.length) {
      const ts = pts.map((x) => x[0]);
      range = `${new Date(Math.min(...ts) * 1000).toLocaleDateString()} to ${new Date(Math.max(...ts) * 1000).toLocaleDateString()}`;
    }
    if (!this._admin) return html`<p class="hint">Only admins can import history.</p>`;
    return html`
      <div class="form">
        <h3>Import a JSON file</h3>
        <p class="hint">Works with a list of points (lat, lon, time), Google location Records.json, GeoJSON points and OwnTracks exports.</p>
        <label>Which device is it for?
          <select .value=${imp.entity} @change=${(e) => (this._imp = { ...imp, entity: e.target.value })}>
            <option value="">Choose…</option>
            ${people.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
          </select></label>
        <label>…or type a name for another device
          <input placeholder="device_tracker.old_phone" .value=${imp.custom} @input=${(e) => (this._imp = { ...imp, custom: e.target.value })} /></label>
        <label>File <input type="file" accept=".json,application/json" @change=${this._pickFile} /></label>
        ${pts?.length ? html`<p>Found <b>${pts.length.toLocaleString()}</b> locations from ${range}.</p>` : nothing}
        <div class="btns"><button class="primary" ?disabled=${imp.busy || !pts?.length || !(imp.custom.trim() || imp.entity)} @click=${this._runImport}>Import</button></div>
      </div>
      <div class="form">
        <h3>Copy from Home Assistant's own history</h3>
        <p class="hint">Fills the history file with what Home Assistant already recorded for your people.</p>
        <label>Days to copy <input type="number" min="1" max="60" .value=${String(imp.days)} @input=${(e) => (this._imp = { ...imp, days: e.target.value })} /></label>
        <div class="btns"><button ?disabled=${imp.busy} @click=${this._backfill}>Copy history</button></div>
      </div>
      ${imp.log ? html`<p class="status">${imp.log}</p>` : nothing}`;
  }

  _renderSettings() {
    const d = this._draft;
    if (!d) return html`<p class="hint">Loading…</p>`;
    const set = (k) => (e) => (this._draft = { ...d, [k]: e.target.value });
    const people = this._people;
    const mb = this._stats ? (this._stats.bytes / 1048576).toFixed(1) : "?";
    const tracked = new Set(d.tracked_entities || []);
    return html`
      <div class="form">
        <h3>What gets saved</h3>
        <p class="hint">Leave everyone unchecked to save every person. History file: <code>/config/flexible_map/history.db</code> (${mb} MB).</p>
        <div class="checks">
          ${people.map((x) => html`<label><input type="checkbox" .checked=${tracked.has(x.id)} ?disabled=${!this._admin}
            @change=${(e) => { const n = new Set(tracked); e.target.checked ? n.add(x.id) : n.delete(x.id); this._draft = { ...d, tracked_entities: [...n] }; }} /> ${x.name}</label>`)}
        </div>
        <div class="two">
          <label>Distance units
            <select .value=${d.units} ?disabled=${!this._admin} @change=${set("units")}>
              <option value="mi">Miles</option><option value="km">Kilometers</option></select></label>
          <label>Keep history for (days, 0 = forever) <input type="number" .value=${String(d.retention_days)} ?disabled=${!this._admin} @input=${set("retention_days")} /></label>
        </div>
        <div class="two">
          <label>Save a point after moving (meters) <input type="number" .value=${String(d.min_distance_m)} ?disabled=${!this._admin} @input=${set("min_distance_m")} /></label>
          <label>…and at least (seconds) apart <input type="number" .value=${String(d.min_seconds)} ?disabled=${!this._admin} @input=${set("min_seconds")} /></label>
        </div>
        <label>Ignore points less accurate than (meters, 0 = off) <input type="number" .value=${String(d.max_accuracy_m)} ?disabled=${!this._admin} @input=${set("max_accuracy_m")} /></label>
        <div class="btns"><button class="primary" ?disabled=${!this._admin} @click=${this._saveSettings}>Save settings</button></div>
      </div>
      <div class="form">
        <h3>Saved history</h3>
        ${this._stats && Object.keys(this._stats.entities).length ? html`<ul class="list">
          ${Object.entries(this._stats.entities).map(([id, s]) => html`<li>
            <div><b>${this.hass.states[id]?.attributes?.friendly_name || id}</b>
              <span class="muted">${s.count.toLocaleString()} points · ${new Date(s.first * 1000).toLocaleDateString()} to ${new Date(s.last * 1000).toLocaleDateString()}</span></div>
            ${this._admin ? html`<button class="danger" @click=${() => this._wipe(id)}>Delete</button>` : nothing}
          </li>`)}</ul>` : html`<p class="hint">Nothing saved yet.</p>`}
      </div>`;
  }

  render() {
    if (!this.hass) return nothing;
    return html`
      <header>
        ${this.narrow ? html`<button class="icon" @click=${() => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }))}><ha-icon icon="mdi:menu"></ha-icon></button>` : nothing}
        <img src=${LOGO} alt="" />
        <h1>Flexible Map</h1>
      </header>
      <nav>
        ${TABS.map(([k, label]) => html`<button class=${this._tab === k ? "tab on" : "tab"}
          @click=${() => (k === "settings" ? this._openSettings() : (this._tab = k))}>${label}</button>`)}
      </nav>
      <main>
        ${this._msg ? html`<p class="status" @click=${() => (this._msg = "")}>${this._msg}</p>` : nothing}
        ${this._tab === "map" ? this._renderMap()
          : this._tab === "places" ? this._renderPlaces()
          : this._tab === "import" ? this._renderImport()
          : this._renderSettings()}
      </main>`;
  }

  static get styles() {
    return css`
      :host { display: block; min-height: 100%; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
      header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); background: var(--app-header-background-color, var(--card-background-color)); border-bottom: 1px solid var(--divider-color); }
      header img { width: 34px; height: 34px; border-radius: 9px; }
      h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.2px; }
      button { font: inherit; color: inherit; cursor: pointer; }
      button.icon { background: none; border: none; padding: 4px; margin-left: -8px; --mdc-icon-size: 24px; }
      nav { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--divider-color); overflow-x: auto; }
      .tab { background: none; border: none; padding: 12px 14px; font-size: 15px; color: var(--secondary-text-color); border-bottom: 2px solid transparent; }
      .tab.on { color: var(--primary-text-color); border-bottom-color: var(--primary-color); font-weight: 600; }
      main { max-width: 920px; margin: 0 auto; padding: 14px 14px calc(30px + env(safe-area-inset-bottom, 0px)); }
      .people, .ranges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
      .person { display: flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 999px; border: 1px solid var(--divider-color); background: var(--card-background-color); opacity: .55; }
      .person.on { opacity: 1; border-color: var(--ring); }
      .avatar { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--secondary-background-color); box-shadow: 0 0 0 2px var(--ring); }
      .avatar img { width: 100%; height: 100%; object-fit: cover; }
      .range { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent; }
      .range.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
      input, select { font: inherit; color: inherit; background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; }
      .mapbox { border-radius: var(--ha-card-border-radius, 12px); overflow: hidden; border: 1px solid var(--divider-color); background: var(--card-background-color); }
      .empty, .hint, .muted { color: var(--secondary-text-color); }
      .empty { padding: 24px 4px; }
      .status { padding: 10px 12px; border-radius: 8px; background: var(--secondary-background-color); }
      .timelines { display: grid; gap: 14px; margin-top: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .tl h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 16px; }
      .tl .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
      .tl .total { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
      .tl ol { list-style: none; margin: 0; padding: 0 0 0 4px; border-left: 2px solid var(--c); margin-left: 4px; }
      .tl li { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; padding: 7px 0 7px 14px; }
      .tl .when, .tl .more { color: var(--secondary-text-color); font-size: 13px; }
      .tl .what { font-weight: 500; }
      .tl .more { grid-column: 2; grid-row: 1; text-align: right; }
      .tl .when { grid-column: 1; }
      .form { margin: 14px 0 22px; display: grid; gap: 10px; background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px); padding: 14px; border: 1px solid var(--divider-color); }
      .form h3 { margin: 0; font-size: 16px; }
      label { display: grid; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
      label input, label select { color: var(--primary-text-color); }
      .two { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
      @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
      .checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
      .checks label { display: flex; align-items: center; gap: 6px; color: var(--primary-text-color); font-size: 14px; }
      .btns { display: flex; gap: 8px; flex-wrap: wrap; }
      .btns button, .list button { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent; }
      button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
      button.danger { color: var(--error-color, #db4437); }
      button:disabled { opacity: .5; cursor: default; }
      .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
      .list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--card-background-color); }
      .list .muted { display: block; font-size: 13px; }
      code { background: var(--secondary-background-color); padding: 1px 5px; border-radius: 4px; }
    `;
  }
}

if (!customElements.get("flexible-map-panel")) {
  customElements.define("flexible-map-panel", FlexibleMapPanel);
}
