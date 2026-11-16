# Changelog

## [4.0.0] - 2026-11-15
Flexible Map, Mini Tracker and Travel Times combined.

### Fixed
* The integration folder is now `custom_components/flexible_map` (it was `flexible-map`, which Home Assistant can't load because it doesn't match the domain).
* Person pictures and zone icons now always show on the card. The card draws its own markers instead of relying on Home Assistant's built-in map, so pictures, `mdi:` icons and custom icon sets (`custom:`, `local:` ...) all work, and pictures are cropped so heads stay in the circle.
* Lit is bundled instead of loaded from unpkg, so the card and dashboard work without internet access to a CDN.

### Added
* Card: people list (place, time there, distance, battery), heatmap, playback, show every point, map styles (clean / OpenStreetMap / satellite / custom), per-entity and per-zone picture/icon/color overrides, GPS accuracy circles.
* Card: Travel Times. Routes, between-people trackers and groups from the Travel Times add-on, with ETA, miles, orange/red thresholds, dashed lines to places and labelled lines between people.
* Dashboard: Live tab, timeline with stop detection (time at each place, trips with distance and average speed), tap a trip to draw it, save an unknown stop as a place, time-at-places stats, export GPX/CSV/JSON, import GPX/CSV/OwnTracks .rec.
* Integration: "place" and "distance today" sensors for each person, heartbeat points while standing still, ingest URL for OwnTracks / Overland / plain JSON, `timeline`, `place_stats`, `export` and `ingest_info` websocket commands.

## [3.0.1] - 2026-10-31
### Fixed
* Zone icons (Home, Work, ...) now show on the dashboard map. New card option `show_zones` adds every zone that has a location; the dashboard turns it on.
* Google Timeline exports (the `Timeline.json` from the phone) now import: visits, trips and path points. Older Takeout "Semantic Location History" files work too.
* Points that share the same millisecond (common in Google exports) are all kept instead of one being dropped.

## [3.0.0] - 2026-10-31
First combined release: integration + sidebar dashboard + card in one repo.

### Added
* History file (SQLite) that records every location change, with retention and accuracy/jitter filters.
* Sidebar dashboard: people, date ranges, trail map, timeline by place, distance in miles, Places (HA zones), JSON import, settings.
* Websocket API (`flexible_map/history`, `stats`, `import_points`, `delete_range`, `set_options`, `config`).
* Custom logo and brand images.
* Card reads the history file (falls back to Home Assistant's recorder).

### Carried over from the card 1.10.0
* Working history trails, range buttons, distance legend, dark map after sunset, MapLibre click-to-zoom, `min_move_m`, `max_accuracy_m`.
