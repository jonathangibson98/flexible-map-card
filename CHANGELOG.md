# Changelog

## [2.0.1] - 2026-10-31
### Fixed
* Zone icons (Home, Work, ...) now show on the dashboard map. New card option `show_zones` adds every zone that has a location; the dashboard turns it on.
* Google Timeline exports (the `Timeline.json` from the phone) now import: visits, trips and path points. Older Takeout "Semantic Location History" files work too.
* Points that share the same millisecond (common in Google exports) are all kept instead of one being dropped.

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
