"""Constants for Flexible Map."""
from __future__ import annotations

DOMAIN = "flexible_map"
VERSION = "4.0.1"

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
CONF_HEARTBEAT = "heartbeat_minutes"
CONF_STOP_MINUTES = "stop_minutes"
CONF_STOP_RADIUS = "stop_radius_m"
CONF_SENSORS = "create_sensors"
CONF_INGEST = "ingest_enabled"

SIGNAL_POINT = "flexible_map_point"
INGEST_URL = "/api/flexible_map/ingest"

DEFAULT_OPTIONS = {
    CONF_TRACKED: [],  # empty = every person.* entity
    CONF_RETENTION: 0,  # 0 = keep forever
    CONF_MIN_DISTANCE: 25,
    CONF_MIN_SECONDS: 30,
    CONF_MAX_ACCURACY: 200,  # 0 = don't filter on accuracy
    CONF_UNITS: "mi",
    CONF_HEARTBEAT: 10,  # save a point this often while standing still (0 = off)
    CONF_STOP_MINUTES: 10,  # a stop is at least this long ...
    CONF_STOP_RADIUS: 75,  # ... within this many meters
    CONF_SENSORS: True,  # "place" + "distance today" sensors per person
    CONF_INGEST: False,  # URL other apps (OwnTracks, Overland) can post to
}

INT_KEYS = (
    CONF_RETENTION,
    CONF_MIN_DISTANCE,
    CONF_MIN_SECONDS,
    CONF_MAX_ACCURACY,
    CONF_HEARTBEAT,
    CONF_STOP_MINUTES,
    CONF_STOP_RADIUS,
)


def merged_options(entry) -> dict:
    """Defaults + whatever the user saved."""
    opts = {**DEFAULT_OPTIONS, **(entry.options or {})}
    for key in INT_KEYS:
        try:
            opts[key] = int(opts[key])
        except (TypeError, ValueError):
            opts[key] = DEFAULT_OPTIONS[key]
    if opts[CONF_UNITS] not in ("mi", "km"):
        opts[CONF_UNITS] = "mi"
    for key in (CONF_SENSORS, CONF_INGEST):
        opts[key] = bool(opts[key])
    if not isinstance(opts[CONF_TRACKED], list):
        opts[CONF_TRACKED] = []
    return opts
