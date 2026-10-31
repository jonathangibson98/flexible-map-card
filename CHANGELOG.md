# Changelog

## [2.0.0] - 2026-10-31
First combined release: integration + sidebar dashboard + card in one repo.

### Added
* History file (SQLite) that records every location change, with retention and accuracy/jitter filters.
* Sidebar dashboard: people, date ranges, trail map, timeline by place, distance in miles, Places (HA zones), JSON import, settings.
* Websocket API (`flexible_map/history`, `stats`, `import_points`, `delete_range`, `set_options`, `config`).
* Custom logo and brand images.
* Card reads the history file (falls back to Home Assistant's recorder).

### Carried over from the card 1.10.0
* Working history trails, range buttons, distance legend, dark map after sunset, MapLibre click-to-zoom, `min_move_m`, `max_accuracy_m`.
