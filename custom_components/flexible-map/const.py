"""Constants for Flexible Map."""
from __future__ import annotations

DOMAIN = "flexible_map"
VERSION = "2.0.0"

URL_BASE = "/flexible_map_static"
PANEL_URL_PATH = "flexible-map"
PANEL_ELEMENT = "flexible-map-panel"
DB_FOLDER = "flexible_map"
DB_FILE = "history.db"

CONF_TRACKED = "tracked_entities"
CONF_RETENTION = "retention_days"
CONF_MIN_DISTANCE = "min_distance_m"
CONF_MIN_SECONDS = "min_seconds"
CONF_MAX_ACCURACY = "max_accuracy_m"
CONF_UNITS = "units"

DEFAULT_OPTIONS = {
    CONF_TRACKED: [],  # empty = every person.* entity
    CONF_RETENTION: 0,  # 0 = keep forever
    CONF_MIN_DISTANCE: 25,
    CONF_MIN_SECONDS: 30,
    CONF_MAX_ACCURACY: 200,  # 0 = don't filter on accuracy
    CONF_UNITS: "mi",
}


def merged_options(entry) -> dict:
    """Defaults + whatever the user saved."""
    opts = {**DEFAULT_OPTIONS, **(entry.options or {})}
    for key in (CONF_RETENTION, CONF_MIN_DISTANCE, CONF_MIN_SECONDS, CONF_MAX_ACCURACY):
        try:
            opts[key] = int(opts[key])
        except (TypeError, ValueError):
            opts[key] = DEFAULT_OPTIONS[key]
    if opts[CONF_UNITS] not in ("mi", "km"):
        opts[CONF_UNITS] = "mi"
    if not isinstance(opts[CONF_TRACKED], list):
        opts[CONF_TRACKED] = []
    return opts
