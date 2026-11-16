# Flexible Map for Home Assistant

**Flexible Map + Mini Tracker + Travel Times, in one install.**

One HACS integration gives you:

* **A map card for any dashboard** (`custom:flexible-map-card`) with:
  * everyone's **real Home Assistant picture** in the marker (or their icon, or initials)
  * **zones drawn with their own icons**, including `mdi:` and your custom icon sets (`custom:`, `local:` ...), with the zone circle
  * **history trails** (Off / 1h / 6h / 1d / 3d / 7d), **heatmap**, and **playback** (watch the day replay)
  * a **people list** under the map: where each person is, for how long, how far they went, phone battery
  * your **Travel Times**: drive time, miles and ETA to each place, time and distance between people, group times. Dashed lines on the map show who is heading where, and a label shows how far apart two people are
  * dark map after sunset, miles everywhere, hold action, visual editor
* **A history file** (`/config/flexible_map/history.db`) that keeps every location for as long as you want, not just the recorder's 10 days.
* **A Flexible Map sidebar dashboard** with its own logo:
  * **Live**: the full card with people list and Travel Times
  * **History**: pick people and a day (or any dates), see the trail and a **timeline of stops and trips** (stop detection, time at each place, distance, average speed). Tap a trip to draw it, tap an unknown stop to save it as a place
  * **Places**: your Home Assistant zones (add, edit, delete) plus **time at places** for 7 / 30 / 90 days
  * **Data**: import (Google Timeline, Takeout, GPX, CSV, GeoJSON, OwnTracks), copy Home Assistant's history, **export** GPX / CSV / JSON, and an **ingest URL** for OwnTracks / Overland
  * **Settings**
* **Sensors for each person**: `sensor.<name>_place` (zone name or Away) and `sensor.<name>_distance_today` (miles).

## Install (HACS)

1. HACS > three dots > **Custom repositories**.
2. Paste `https://github.com/jonathangibson98/flexible-map-card`, category **Integration**, Add.
3. Download **Flexible Map** and **restart Home Assistant**.
4. It sets itself up. **Flexible Map** appears in the sidebar. Open **Data** > **Copy history** to pull in what Home Assistant already has.

Upgrading from an older version:

* If you have a folder called `/config/custom_components/flexible-map` (with a dash), delete it. The right folder is `flexible_map` (underscore). The dash version can't load.
* If you used the old standalone card, delete its entry under Settings > Dashboards > Resources (`/local/flexible-map-card.js`). The integration loads the card by itself.
* Coming from the **Mini Tracker** app: in Mini Tracker, export each person as GPX or JSON, then import it here under **Data**. After that you can uninstall Mini Tracker.

## The card

Add it from the dashboard editor (search "Flexible Map"). Everything is in the visual editor. YAML example:

```yaml
type: custom:flexible-map-card
title: Family
entities:
  - person.alex
  - entity: person.sam
    color: "#f06595"
card_height: 340
hours_to_show: 24
dark_at_night: true
travel_times: true
warn_above: 30
alert_above: 60
```

### Pictures and icons

The card uses exactly what Home Assistant uses, so nothing to set up:

| For | It shows |
| --- | --- |
| A person or device tracker | Its Home Assistant picture, otherwise its icon, otherwise initials |
| A zone | The zone's icon (`mdi:`, `custom:`, any icon set you have installed). Home gets `mdi:home` if it has none |

Want something different on the map only? Override it per entity:

```yaml
entities:
  - entity: person.alex
    picture: /local/people/alex.png   # or icon: custom:alex
zones:
  zone.work:
    icon: custom:bitcoin
    color: "#f7931a"
hide_zones:
  - zone.old_job
```

Pictures are cropped to keep heads in the circle. Set `picture_fit: contain` to show the whole picture.

### Travel Times

If the **Travel Times** add-on is running, the card finds its sensors by itself (anything with a `tt_kind` attribute):

* **Routes** (person to place): shown under that person with minutes, miles and ETA, plus a dashed line on the map to the place
* **Trackers** (between people): shown under both people with drive time, road miles and straight-line miles, plus a line and label between them
* **Groups**: shown at the bottom

The number on the right of each person is their quickest trip. Tap a person to see all of them; tap a trip to zoom the map to it. Use `travel_entities` to pick only some sensors.

### All options

| Option | Default | What it does |
| :--- | :--- | :--- |
| `entities` | `[]` | People / devices (and extra zones). `{entity, color, name, icon, picture, battery}` for overrides |
| `add_all_entities` | `false` | Add every person / device tracker that has a location |
| `show_zones` | `true` | Draw every zone with its icon |
| `show_zone_radius` | `true` | Zone circles |
| `zones` / `hide_zones` | | Per-zone icon / picture / color, and zones to leave off |
| `card_height` | `320` | Map height in px |
| `default_zoom` | `14` | Zoom when there's one person |
| `auto_fit` / `fit_zones` | `true` / `false` | Zoom to fit everyone (and zones) |
| `marker_size` | `40` | Picture size in px |
| `picture_fit` | `cover` | `cover` or `contain` |
| `map_style` | `carto` | `carto` (clean, HA-like), `osm`, `satellite`, `custom` + `tile_url` |
| `theme_mode` | `auto` | `auto` (follow HA), `light`, `dark` |
| `dark_at_night` | `false` | Dark map while `sun.sun` is down (OpenStreetMap gets inverted) |
| `show_accuracy` | `true` | GPS accuracy circle |
| `hours_to_show` | `24` | Trail length (0 = off) |
| `history_ranges` | `[1,6,24,72,168]` | Hours behind the range buttons |
| `history_source` | `auto` | `auto`, `integration` (history file only) or `ha` (recorder only) |
| `show_history_controls` | `true` | Range buttons on the map |
| `show_heatmap_button` / `show_playback` | `true` | Heatmap and playback buttons |
| `show_points` | `false` | Dot for every saved point (hover for the time) |
| `units` | `mi` | `mi` or `km` |
| `min_move_m` / `max_accuracy_m` | `20` / `0` | Ignore jitter / inaccurate points on the trail |
| `history_refresh_seconds` | `60` | How often trails refresh |
| `show_people` | `true` | People list under the map |
| `people_layout` | `normal` | `normal` or `compact` |
| `show_distance` | `true` | Distance legend on the map (only when the people list is off) |
| `travel_times` | `true` | Use Travel Times sensors |
| `travel_entities` | all | Only these Travel Times sensors |
| `travel_lines` / `pair_lines` / `show_groups` | `true` | Lines to places, lines between people, group rows |
| `warn_above` / `alert_above` | off | Minutes where a time turns orange / red |
| `hide_zoom_controls` | `false` | Hide + / - |
| `full_width` / `card_width` | `true` / `400` | Width |
| `hold_action` | `none` | Any Home Assistant action |

Tap a person on the map to zoom in and see their place, time there, battery, accuracy and trips. **More info** opens the normal Home Assistant dialog.

## Settings

Settings > Devices & services > Flexible Map > **Configure**, or the **Settings** tab in the sidebar:

* who to record (empty = every person), miles or km
* save a point after moving 25 m, at least 30 s apart, and every 10 min while standing still (so stops have real lengths)
* ignore points worse than 200 m
* a stop is at least 10 minutes within 75 m
* keep history forever, or for N days
* sensors on/off, ingest URL on/off

## Ingest URL (OwnTracks, Overland, anything)

Turn on in Settings, then copy the URL from **Data**. It looks like
`https://your-ha/api/flexible_map/ingest?token=...`. Each device becomes `ext.<name>` in the history file
(viewable in History, exportable). Keep the token secret; **New token** makes the old URL stop working.

## How it's built

* `custom_components/flexible_map/`: `tracker.py` records location changes, `store.py` is the SQLite file, `geo.py` finds stops and trips, `sensor.py` the sensors, `ingest.py` the ingest URL, `websocket.py` the API.
* `frontend/`: the card, the dashboard and the logo. Leaflet and Lit are bundled in `frontend/vendor/`, so nothing loads from a CDN (only the map tiles come from the internet).

## Back up

Copy `/config/flexible_map/history.db`. It's in normal Home Assistant backups.
