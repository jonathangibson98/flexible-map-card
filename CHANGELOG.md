# Changelog

All notable changes to the **Flexible Vector Map Card** will be documented in this file.

## [1.10.0] - 2026-10-31

### Fixed
* **History trails now actually show.** The card used to hand `hours_to_show` to Home Assistant's built-in map and default it to `0` (off). It now fetches history itself over the websocket and draws the trails on the map, defaulting to 24 hours.
* **Click-to-zoom works on HA's MapLibre map** (it was looking for the old Leaflet object and silently falling back).

### Added
* **1h / 6h / 24h / 3d / 7d buttons** on the map to change the trail range on the fly (`show_history_controls`, `history_ranges`).
* **Distance legend** per person/device for the selected range, in miles by default (`units: mi | km`, `show_distance`).
* **GPS jitter filter** (`min_move_m`, `max_accuracy_m`) and auto-refresh (`history_refresh_seconds`).
* **Dark map after sunset** (`dark_at_night`, uses `sun.sun`).
* Per-entity `color` for trails when using the object form of `entities`.

---

## [1.9.0] - 2026-10-29

### Added
* **Click-to-Zoom Behavior:** Clicking an entity marker on the map now intercepts the default `more-info` action, preventing the modal dialog from opening and smoothly centering and zooming the map directly onto that entity's coordinates.
* **Smart Device Tracker Filtering:** Enhanced the `add_all_entities` auto-fill logic to automatically scan and exclude individual device trackers bound to a `person` entity, perfectly mirroring native Home Assistant map behavior and eliminating duplicate markers.

---

## [1.0.0] - Initial Release

### Features
* Dynamic resizable container with automatic `ResizeObserver` adjustment.
* Smart auto-discovery toggle (`add_all_entities`) with entity registry filtering.
* Built-in UI controls cleanup to hide native zoom and orientation/recenter buttons.
* Customizable hold actions with haptic vibration feedback.
* Native Home Assistant visual editor (`ha-form`) support.
