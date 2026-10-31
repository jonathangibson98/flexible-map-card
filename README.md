# Flexible Map for Home Assistant

One repository, one install. It gives Home Assistant:

* **A history file that keeps your locations** (`/config/flexible_map/history.db`). Every time a person's location changes it is saved, so history is there for as long as you want, not just the recorder's 10 days.
* **A "Flexible Map" dashboard in the sidebar** with its own logo: pick people, pick a day (or any dates), see the trail, a timeline of where they were (Home, Work, on the move) and distance in miles. Tabs for Places, Import and Settings.
* **The Flexible Map card** for any normal dashboard (`custom:flexible-map-card`). It reads the same history file, with 1h / 6h / 24h / 3d / 7d buttons, a distance legend, click-to-zoom, dark map after sunset, and everything the old card did.
* **Places** are normal Home Assistant zones, so they show on every map and work in automations.
* **Import**: JSON files (a list of points, Google `Records.json`, GeoJSON, OwnTracks) for a device of your choice, plus a one-click copy of Home Assistant's existing history.

## Install (HACS)

1. HACS > three dots > **Custom repositories**.
2. Paste `https://github.com/jonathangibson98/flexible-map`, category **Integration**, Add.
3. Download **Flexible Map** and **restart Home Assistant**.
4. That's it. It sets itself up and **Flexible Map** appears in the sidebar. Open it, go to **Import** > **Copy history** to pull in what Home Assistant already has.

Manual install: copy `custom_components/flexible_map` into `/config/custom_components/` and restart.

If you used the old standalone card, delete its entry under Settings > Dashboards > Resources (`/local/flexible-map-card.js`). The integration loads the card by itself.

## Using the card on a dashboard

```yaml
type: custom:flexible-map-card
title: Family
entities:
  - person.jon
  - person.mj
card_height: 350
hours_to_show: 24
units: mi
dark_at_night: true
```

| Option | Default | What it does |
| :--- | :--- | :--- |
| `entities` | `[]` | People / devices to show. Use `{entity: person.jon, color: "#ff6b6b"}` to pick a trail color. |
| `add_all_entities` | `false` | Show everything that has a location. |
| `hours_to_show` | `24` | History trail length (0 = off). |
| `history_source` | `auto` | `auto` = history file first, Home Assistant's recorder for anything missing. `integration` or `ha` to force one. |
| `show_history_controls` | `true` | Off / 1h / 6h / 24h / 3d / 7d buttons on the map. |
| `history_ranges` | `[1,6,24,72,168]` | Hours behind those buttons (YAML only). |
| `show_distance` | `true` | Distance per person for the selected range. |
| `units` | `mi` | `mi` or `km`. |
| `min_move_m` | `20` | Ignore GPS jitter smaller than this (meters). |
| `max_accuracy_m` | `0` | Drop points less accurate than this (0 = off). |
| `history_refresh_seconds` | `60` | How often trails refresh. |
| `dark_at_night` | `false` | Dark map while `sun.sun` is below the horizon. |
| `card_height`, `full_width`, `card_width`, `default_zoom`, `theme_mode`, `map_style`, `auto_fit`, `fit_zones`, `show_zone_radius`, `scale_ruler`, `cluster`, `hide_zoom_controls`, `hide_orient_buttons`, `hold_action` | | Same as before. |

## Settings

Settings > Devices & services > Flexible Map > **Configure**, or the **Settings** tab in the sidebar panel:

* which people / devices to record (empty = every person)
* units (miles or km)
* how far someone must move before a point is saved (default 25 m, at least 30 s apart)
* ignore inaccurate points (default worse than 200 m)
* how long to keep history (default: forever)

## How it works

* `custom_components/flexible_map/` is the integration: `tracker.py` listens for location changes, `store.py` writes them to SQLite, `websocket.py` is the API, `__init__.py` registers the sidebar panel and loads the card.
* `frontend/` holds the card (`flexible-map-card.js`), the dashboard (`flexible-map-panel.js`) and the logo.
* `brand/` is the logo Home Assistant shows for the integration (needs Home Assistant 2026.3 or newer to show custom brand images).

## Back up

Copy `/config/flexible_map/history.db`. It's included in normal Home Assistant backups if your backup covers `/config`.
