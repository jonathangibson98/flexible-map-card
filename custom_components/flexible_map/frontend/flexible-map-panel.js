import { LitElement, html, css, nothing } from "./vendor/lit.js";

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
  ["live", "Live"],
  ["map", "History"],
  ["places", "Places"],
  ["import", "Data"],
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
  const seen = new Set();
  const push = (ts, lat, lon, acc) => {
    ts = toSeconds(ts);
    lat = Number(lat);
    lon = Number(lon);
    if (ts === null || Number.isNaN(lat) || Number.isNaN(lon)) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    // Google often gives an end and the next start the same millisecond; keep both
    let k = Math.round(ts * 1000);
    while (seen.has(k)) k++;
    seen.add(k);
    ts = k / 1000;
    const a = Number(acc);
    out.push([ts, lat, lon, Number.isNaN(a) || acc === undefined || acc === null ? null : a]);
  };
  const timeOf = (o) =>
    o.timestamp ?? o.timestampMs ?? o.time ?? o.ts ?? o.tst ?? o.t ??
    o.datetime ?? o.date ?? o.isoDateTime ?? o.created_at ?? o.recorded_at ??
    o.last_updated ?? o.lu;
  // "geo:34.5,-82.5" or "34.5°, -82.5°"
  const geo = (v) => {
    if (v && typeof v === "object") v = v.latLng ?? v.latlng;
    if (!v) return null;
    const m = String(v).match(/(-?\d+(?:\.\d+)?)\D+?(-?\d+(?:\.\d+)?)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  // Google Timeline export from the phone (visit / activity / timelinePath)
  const timelineSegment = (seg) => {
    const t0 = toSeconds(seg.startTime);
    const t1 = toSeconds(seg.endTime);
    if (t0 === null) return;
    for (const pt of seg.timelinePath || []) {
      const g = geo(pt.point);
      const off = Number(pt.durationMinutesOffsetFromStartTime);
      if (g) push(t0 + (Number.isNaN(off) ? 0 : off) * 60, g[0], g[1], null);
    }
    if (seg.visit) {
      const g = geo(seg.visit.topCandidate?.placeLocation);
      if (g) {
        push(t0, g[0], g[1], null);
        if (t1 !== null) push(t1, g[0], g[1], null);
      }
    }
    if (seg.activity) {
      const s = geo(seg.activity.start);
      const e = geo(seg.activity.end);
      if (s) push(t0, s[0], s[1], null);
      if (e && t1 !== null) push(t1, e[0], e[1], null);
    }
  };
  // Older Takeout "Semantic Location History" (placeVisit / activitySegment)
  const semantic = (item) => {
    const e7 = (l) => (l && l.latitudeE7 !== undefined ? [l.latitudeE7 / 1e7, l.longitudeE7 / 1e7] : null);
    const v = item.placeVisit;
    if (v) {
      const g = e7(v.location);
      if (g) {
        push(v.duration?.startTimestamp ?? v.duration?.startTimestampMs, g[0], g[1], null);
        push(v.duration?.endTimestamp ?? v.duration?.endTimestampMs, g[0], g[1], null);
      }
    }
    const a = item.activitySegment;
    if (a) {
      const s = e7(a.startLocation), e = e7(a.endLocation);
      if (s) push(a.duration?.startTimestamp ?? a.duration?.startTimestampMs, s[0], s[1], null);
      if (e) push(a.duration?.endTimestamp ?? a.duration?.endTimestampMs, e[0], e[1], null);
    }
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          if (item.startTime && (item.timelinePath || item.visit || item.activity)) {
            timelineSegment(item);
            continue;
          }
          if (item.placeVisit || item.activitySegment) {
            semantic(item);
            continue;
          }
        }
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

// GPX tracks / waypoints
function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const out = [];
  for (const el of doc.querySelectorAll("trkpt, rtept, wpt")) {
    const lat = Number(el.getAttribute("lat"));
    const lon = Number(el.getAttribute("lon"));
    const t = el.querySelector("time")?.textContent;
    const ts = toSeconds(t);
    if (ts !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) out.push([ts, lat, lon, null]);
  }
  return out;
}
// CSV with lat / lon / time columns (any order, common names)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const find = (...names) => head.findIndex((h) => names.includes(h));
  const iLat = find("lat", "latitude");
  const iLon = find("lon", "lng", "long", "longitude");
  const iT = find("time", "timestamp", "ts", "date", "datetime", "recorded_at", "last_updated", "tst");
  const iA = find("acc", "accuracy", "gps_accuracy");
  if (iLat < 0 || iLon < 0 || iT < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
    const ts = toSeconds(c[iT]);
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (ts === null || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    out.push([ts, lat, lon, iA >= 0 && c[iA] !== "" ? Number(c[iA]) : null]);
  }
  return out;
}
// OwnTracks .rec: "2024-01-01T10:00:00Z  *  {json}"
function parseRec(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("{");
    if (i < 0) continue;
    try {
      const o = JSON.parse(line.slice(i));
      if (o._type === "location") items.push(o);
    } catch (e) { /* skip */ }
  }
  return parsePoints(items);
}
function parseAny(name, text) {
  const n = name.toLowerCase();
  const t = text.trimStart();
  if (n.endsWith(".gpx") || t.startsWith("<")) return parseGPX(text);
  if (n.endsWith(".rec")) return parseRec(text);
  if (n.endsWith(".csv") || n.endsWith(".tsv") || !/^[[{]/.test(t)) return parseCSV(text);
  return parsePoints(JSON.parse(text));
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const iso = (ts) => new Date(ts * 1000).toISOString();
const fmtDur = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

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
      _tl: { state: true },
      _pstats: { state: true },
      _ingest: { state: true },
      _exp: { state: true },
    };
  }

  constructor() {
    super();
    this._tab = "live";
    this._tl = {}; // entity -> server timeline
    this._pstats = { entity: "", days: 30, rows: null, busy: false };
    this._ingest = null;
    this._exp = { entity: "", range: "all" };
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
    if (url && !customElements.get("fm-map-card-v4")) import(url).then(() => this.requestUpdate()).catch(() => {});
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
      show_zones: true,
      card_height: Math.min(560, Math.max(280, Math.round(window.innerHeight * 0.46))),
      full_width: true,
      hours_to_show: 24,
      show_history_controls: false,
      show_distance: false,
      show_people: false,
      travel_times: false,
      units: this._units,
      auto_fit: true,
      show_zone_radius: true,
      dark_at_night: true,
      default_zoom: 14,
    };
  }

  _liveConfig() {
    return {
      type: "custom:flexible-map-card",
      entities: this._people.map((p) => p.id),
      card_height: Math.min(620, Math.max(300, Math.round(window.innerHeight * 0.55))),
      hours_to_show: 6,
      units: this._units,
      dark_at_night: true,
      show_people: true,
      travel_times: true,
    };
  }

  updated() {
    const live = this.renderRoot?.querySelector("fm-map-card-v4.live");
    if (live && this._tab === "live") {
      const key = JSON.stringify(this._liveConfig());
      if (key !== this._liveKey || live !== this._liveEl) {
        this._liveKey = key;
        this._liveEl = live;
        live.setConfig(this._liveConfig());
      }
    }
    const card = this.renderRoot?.querySelector("fm-map-card-v4.hist");
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
    this._loadTimelines();
  }

  // Stops + trips from the integration (stop detection, speed, matched zones)
  async _loadTimelines() {
    const w = this._window;
    const key = `${this._chosen.join(",")}|${Math.floor(+w.start / 60000)}|${Math.floor(+w.end / 60000)}`;
    if (key === this._tlKey) return;
    this._tlKey = key;
    const out = {};
    await Promise.all(this._chosen.map(async (id) => {
      try {
        out[id] = await this.hass.callWS({ type: "flexible_map/timeline", entity_id: id, start: +w.start / 1000, end: +w.end / 1000 });
      } catch (e) {
        out[id] = null;
      }
    }));
    if (key === this._tlKey) this._tl = out;
  }

  get _histCard() {
    return this.renderRoot?.querySelector("fm-map-card-v4.hist");
  }

  _showTrip(id, trip) {
    const t = this._trails.find((x) => x.id === id);
    const pts = (t?.points || [])
      .filter((p) => +p.timestamp >= trip.start * 1000 - 1000 && +p.timestamp <= trip.end * 1000 + 1000)
      .map((p) => p.point);
    const line = pts.length > 1 ? pts : [trip.from_pt, trip.to_pt];
    this._histCard?.showPath(line, this._colors[id] || "#ff4081");
  }

  _showStop(s) {
    this._histCard?.showPoint(s.lat, s.lon, s.place || "Stop");
  }

  _speed(mph) {
    return this._units === "km" ? `${Math.round(mph * 1.609344)} km/h` : `${Math.round(mph)} mph`;
  }

  // Unknown stop -> prefill the "Add a place" form
  _saveStopAsPlace(s) {
    this._place = { id: null, name: "", lat: s.lat.toFixed(6), lon: s.lon.toFixed(6), feet: 330, icon: "" };
    this._tab = "places";
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
      const pts = parseAny(file.name, await file.text());
      this._imp = { ...this._imp, file: file.name, points: pts, log: pts.length ? "" : "No locations found in that file." };
    } catch (e) {
      this._imp = { ...this._imp, file: file.name, points: null, log: "Couldn't read that file (JSON, GPX, CSV or OwnTracks .rec)." };
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
  _openTab(k) {
    if (k === "settings") return this._openSettings();
    this._tab = k;
    if (k === "import") {
      this.hass.callWS({ type: "flexible_map/stats" }).then((s) => (this._stats = s)).catch(() => {});
      if (this._admin) this._loadIngest();
    }
  }

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
        heartbeat_minutes: Number(d.heartbeat_minutes),
        stop_minutes: Number(d.stop_minutes),
        stop_radius_m: Number(d.stop_radius_m),
        create_sensors: !!d.create_sensors,
        ingest_enabled: !!d.ingest_enabled,
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
            <fm-map-card-v4 class="hist" .hass=${this.hass} @trails-changed=${this._onTrails}></fm-map-card-v4>
          </div>`
        : html`<div class="empty">Pick at least one person above to see where they've been.</div>`}
      ${this._renderTimeline()}`;
  }

  _renderLive() {
    if (!this._people.length) return html`<div class="empty">No people to show yet.</div>`;
    return html`<div class="mapbox"><fm-map-card-v4 class="live" .hass=${this.hass}></fm-map-card-v4></div>
      ${window.__fmOldCard ? html`<p class="status">An old copy of the Flexible Map card is still loaded, so your dashboards show the old card. Delete <code>/local/flexible-map-card.js</code> under Settings > Dashboards > Resources, then reload.</p>` : nothing}
      <p class="hint">Tap someone in the list for their Travel Times. Want this on a dashboard? Add the <b>Flexible Map</b> card.</p>`;
  }

  _renderTimeline() {
    const trails = this._trails.filter((t) => t.points.length > 1 && this._chosen.includes(t.id));
    if (!trails.length) {
      return html`<div class="empty">No saved movement for this range yet. New points are saved as phones report in; use Import to bring in older history.</div>`;
    }
    return html`<div class="timelines">
      ${trails.map((t) => {
        const tl = this._tl[t.id];
        if (tl && (tl.stays.length || tl.trips.length)) return this._renderServerTimeline(t, tl);
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

  _renderServerTimeline(t, tl) {
    const items = [
      ...tl.stays.map((s) => ({ kind: "stay", start: s.start, s })),
      ...tl.trips.map((s) => ({ kind: "trip", start: s.start, s })),
    ].sort((a, b) => a.start - b.start);
    const sum = tl.summary;
    const when = (ts) => this._t(new Date(ts * 1000));
    return html`<section class="tl" style="--c:${t.color}">
      <h3><span class="dot"></span>${t.name}<span class="total">${this._dist(sum.distance_m)}</span></h3>
      <p class="muted sum">${sum.stops} stops · moving ${fmtDur(sum.moving_s)}</p>
      <ol>
        ${items.map((it) => it.kind === "stay"
          ? html`<li class="stay" @click=${() => this._showStop(it.s)}>
              <span class="what"><ha-icon icon="mdi:map-marker"></ha-icon> ${it.s.place || "Unknown place"}</span>
              <span class="when">${when(it.s.start)} – ${when(it.s.end)}</span>
              <span class="more">${fmtDur(it.s.duration)}</span>
              ${!it.s.place && this._admin ? html`<button class="mini" @click=${(e) => { e.stopPropagation(); this._saveStopAsPlace(it.s); }}>Save as place</button>` : nothing}
            </li>`
          : html`<li class="trip" @click=${() => this._showTrip(t.id, it.s)}>
              <span class="what"><ha-icon icon="mdi:car"></ha-icon> ${it.s.from || "…"} → ${it.s.to || "…"}</span>
              <span class="when">${when(it.s.start)} · ${fmtDur(it.s.duration)} · ${this._speed(it.s.avg_mph)}</span>
              <span class="more">${this._dist(it.s.distance_m)}</span>
            </li>`)}
      </ol>
    </section>`;
  }

  async _loadPlaceStats() {
    const ps = this._pstats;
    const entity = ps.entity || this._people[0]?.id;
    if (!entity) return;
    this._pstats = { ...ps, entity, busy: true };
    try {
      const r = await this.hass.callWS({ type: "flexible_map/place_stats", entity_id: entity, days: Number(ps.days) });
      this._pstats = { ...this._pstats, rows: r.places, busy: false };
    } catch (e) {
      this._pstats = { ...this._pstats, rows: [], busy: false };
    }
  }

  _renderPlaceStats() {
    const ps = this._pstats;
    const people = this._people;
    const max = Math.max(1, ...(ps.rows || []).map((r) => r.seconds));
    return html`<div class="form">
      <h3>Time at places</h3>
      <div class="two">
        <label>Who <select .value=${ps.entity || people[0]?.id || ""} @change=${(e) => { this._pstats = { ...ps, entity: e.target.value, rows: null }; this._loadPlaceStats(); }}>
          ${people.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></label>
        <label>Over the last <select .value=${String(ps.days)} @change=${(e) => { this._pstats = { ...ps, days: Number(e.target.value), rows: null }; this._loadPlaceStats(); }}>
          <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">year</option></select></label>
      </div>
      ${ps.rows === null ? html`<div class="btns"><button @click=${this._loadPlaceStats}>Show</button></div>`
        : ps.rows.length ? html`<ul class="bars">${ps.rows.map((r) => html`<li>
            <span class="nm">${r.name}</span>
            <span class="bar"><i style="width:${(r.seconds / max) * 100}%"></i></span>
            <span class="v">${fmtDur(r.seconds)} · ${r.visits} visit${r.visits === 1 ? "" : "s"}</span></li>`)}</ul>`
        : html`<p class="hint">No stops at your places in that range.</p>`}
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
            <div class="zrow"><ha-icon icon=${s.attributes.icon || "mdi:map-marker"}></ha-icon><div><b>${s.attributes.friendly_name || s.entity_id}</b>
              <span class="muted">${Math.round(r * 3.28084)} ft radius${item ? "" : " · set in configuration"}</span></div></div>
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
      </div>` : html`<p class="hint">Ask an admin to add or change places.</p>`}
      ${this._renderPlaceStats()}`;
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
        <h3>Import a history file</h3>
        <p class="hint">Google Timeline (the Timeline.json from your phone), Google Takeout Records.json, GPX, CSV (lat, lon, time columns), GeoJSON, OwnTracks .rec, or any JSON list of points.</p>
        <label>Which device is it for?
          <select .value=${imp.entity} @change=${(e) => (this._imp = { ...imp, entity: e.target.value })}>
            <option value="">Choose…</option>
            ${people.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
          </select></label>
        <label>…or type a name for another device
          <input placeholder="device_tracker.old_phone" .value=${imp.custom} @input=${(e) => (this._imp = { ...imp, custom: e.target.value })} /></label>
        <label>File <input type="file" accept=".json,.geojson,.gpx,.csv,.tsv,.rec,.txt" @change=${this._pickFile} /></label>
        ${pts?.length ? html`<p>Found <b>${pts.length.toLocaleString()}</b> locations from ${range}.</p>` : nothing}
        <div class="btns"><button class="primary" ?disabled=${imp.busy || !pts?.length || !(imp.custom.trim() || imp.entity)} @click=${this._runImport}>Import</button></div>
      </div>
      <div class="form">
        <h3>Copy from Home Assistant's own history</h3>
        <p class="hint">Fills the history file with what Home Assistant already recorded for your people.</p>
        <label>Days to copy <input type="number" min="1" max="60" .value=${String(imp.days)} @input=${(e) => (this._imp = { ...imp, days: e.target.value })} /></label>
        <div class="btns"><button ?disabled=${imp.busy} @click=${this._backfill}>Copy history</button></div>
      </div>
      ${imp.log ? html`<p class="status">${imp.log}</p>` : nothing}
      ${this._renderExport()}
      ${this._renderIngest()}`;
  }

  _allHistoryIds() {
    const ids = new Set(this._people.map((p) => p.id));
    for (const id of Object.keys(this._stats?.entities || {})) ids.add(id);
    return [...ids];
  }

  async _export(fmt) {
    const id = this._exp.entity || this._allHistoryIds()[0];
    if (!id) return;
    const now = Date.now() / 1000;
    const start = { all: 0, "30": now - 30 * 86400, "7": now - 7 * 86400, today: dayStart(new Date()) / 1000 }[this._exp.range] ?? 0;
    this._msg = "Preparing download…";
    try {
      const { points } = await this.hass.callWS({ type: "flexible_map/export", entity_id: id, start, end: now + 60 });
      const base = `${id.replace(/\W+/g, "_")}_${ymd(new Date())}`;
      if (fmt === "gpx") {
        const pts = points.map((p) => `<trkpt lat="${p[1]}" lon="${p[2]}"><time>${iso(p[0])}</time></trkpt>`).join("\n");
        download(`${base}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Flexible Map" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${id}</name><trkseg>\n${pts}\n</trkseg></trk></gpx>\n`, "application/gpx+xml");
      } else if (fmt === "csv") {
        download(`${base}.csv`, "time,lat,lon,accuracy\n" + points.map((p) => `${iso(p[0])},${p[1]},${p[2]},${p[3] ?? ""}`).join("\n") + "\n", "text/csv");
      } else {
        download(`${base}.json`, JSON.stringify({ entity_id: id, points: points.map((p) => ({ time: iso(p[0]), lat: p[1], lon: p[2], accuracy: p[3] })) }, null, 1), "application/json");
      }
      this._msg = `Downloaded ${points.length.toLocaleString()} points.`;
    } catch (e) {
      this._msg = `Export failed: ${e.message || e.code}`;
    }
  }

  _renderExport() {
    const ids = this._allHistoryIds();
    const ex = this._exp;
    return html`<div class="form">
      <h3>Export</h3>
      <div class="two">
        <label>Who <select .value=${ex.entity || ids[0] || ""} @change=${(e) => (this._exp = { ...ex, entity: e.target.value })}>
          ${ids.map((id) => html`<option value=${id}>${this.hass.states[id]?.attributes?.friendly_name || id}</option>`)}</select></label>
        <label>Range <select .value=${ex.range} @change=${(e) => (this._exp = { ...ex, range: e.target.value })}>
          <option value="all">Everything</option><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="today">Today</option></select></label>
      </div>
      <div class="btns"><button @click=${() => this._export("gpx")}>GPX</button><button @click=${() => this._export("csv")}>CSV</button><button @click=${() => this._export("json")}>JSON</button></div>
    </div>`;
  }

  async _loadIngest(regenerate = false) {
    try {
      this._ingest = await this.hass.callWS({ type: "flexible_map/ingest_info", regenerate });
    } catch (e) {
      this._ingest = null;
    }
  }

  _renderIngest() {
    const ig = this._ingest;
    if (!ig) return nothing;
    const url = `${location.origin}${ig.path}?token=${ig.token}`;
    return html`<div class="form">
      <h3>Other apps (OwnTracks, Overland, anything that can POST JSON)</h3>
      ${ig.enabled ? html`
        <p class="hint">Send locations to this URL. Each device shows up as <code>ext.&lt;name&gt;</code> in your history. Keep the token secret.</p>
        <label>URL <input readonly .value=${url} @focus=${(e) => e.target.select()} /></label>
        <p class="hint">OwnTracks: Mode HTTP, paste the URL. Overland: paste the URL and add <code>&amp;device_id=my-phone</code>.
          Anything else: <code>{"device":"my gps","lat":34.5,"lon":-82.6}</code></p>
        <div class="btns"><button @click=${() => confirm("Make a new token? The old URL stops working.") && this._loadIngest(true)}>New token</button></div>`
      : html`<p class="hint">Off. Turn on "Ingest URL" in Settings to get a URL.</p>`}
    </div>`;
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
        <div class="two">
          <label>Ignore points less accurate than (meters, 0 = off) <input type="number" .value=${String(d.max_accuracy_m)} ?disabled=${!this._admin} @input=${set("max_accuracy_m")} /></label>
          <label>While standing still, save a point every (minutes, 0 = off) <input type="number" .value=${String(d.heartbeat_minutes ?? 10)} ?disabled=${!this._admin} @input=${set("heartbeat_minutes")} /></label>
        </div>
        <h3>Timeline stops</h3>
        <div class="two">
          <label>A stop is at least (minutes) <input type="number" .value=${String(d.stop_minutes ?? 10)} ?disabled=${!this._admin} @input=${set("stop_minutes")} /></label>
          <label>…within (meters) <input type="number" .value=${String(d.stop_radius_m ?? 75)} ?disabled=${!this._admin} @input=${set("stop_radius_m")} /></label>
        </div>
        <h3>Extras</h3>
        <div class="checks">
          <label><input type="checkbox" .checked=${d.create_sensors !== false} ?disabled=${!this._admin} @change=${(e) => (this._draft = { ...d, create_sensors: e.target.checked })} /> "Place" and "distance today" sensors for each person</label>
          <label><input type="checkbox" .checked=${!!d.ingest_enabled} ?disabled=${!this._admin} @change=${(e) => (this._draft = { ...d, ingest_enabled: e.target.checked })} /> Ingest URL for other apps (OwnTracks, Overland)</label>
        </div>
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
          @click=${() => this._openTab(k)}>${label}</button>`)}
      </nav>
      <main>
        ${this._msg ? html`<p class="status" @click=${() => (this._msg = "")}>${this._msg}</p>` : nothing}
        ${this._tab === "live" ? this._renderLive()
          : this._tab === "map" ? this._renderMap()
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
      .tl li.stay, .tl li.trip { cursor: pointer; border-radius: 8px; }
      .tl li.stay:hover, .tl li.trip:hover { background: var(--secondary-background-color); }
      .tl .what ha-icon { --mdc-icon-size: 16px; color: var(--c); vertical-align: -2px; }
      .tl li.trip .what { font-weight: 400; color: var(--secondary-text-color); }
      .tl .sum { margin: -2px 0 6px 18px; font-size: 13px; }
      .mini { grid-column: 1 / 3; justify-self: start; padding: 3px 10px; font-size: 12px; border-radius: 8px; border: 1px solid var(--divider-color); background: transparent; margin-top: 3px; }
      .zrow { display: flex; align-items: center; gap: 10px; }
      .zrow ha-icon { color: var(--primary-color); }
      .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .bars li { display: grid; grid-template-columns: minmax(90px, 1fr) 2fr auto; gap: 10px; align-items: center; font-size: 14px; }
      .bars .bar { height: 10px; border-radius: 5px; background: var(--secondary-background-color); overflow: hidden; }
      .bars .bar i { display: block; height: 100%; background: var(--primary-color); border-radius: 5px; }
      .bars .v { color: var(--secondary-text-color); font-size: 13px; font-variant-numeric: tabular-nums; }
      h3 + .two { margin-top: -2px; }
    `;
  }
}

if (!customElements.get("flexible-map-panel")) {
  customElements.define("flexible-map-panel", FlexibleMapPanel);
}
