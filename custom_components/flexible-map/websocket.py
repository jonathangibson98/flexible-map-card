"""API the dashboard and the card talk to.

Plain-string keys are used in the schemas on purpose: they work the same on
voluptuous and on probatio, so this file doesn't care which one HA ships.
Values are checked by hand below.
"""
from __future__ import annotations

import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import (
    CONF_MAX_ACCURACY,
    CONF_MIN_DISTANCE,
    CONF_MIN_SECONDS,
    CONF_RETENTION,
    CONF_TRACKED,
    CONF_UNITS,
    DOMAIN,
    VERSION,
    merged_options,
)

MAX_IMPORT_BATCH = 5000


def _runtime(hass: HomeAssistant, connection, msg) -> dict | None:
    runtime = hass.data.get(DOMAIN, {}).get("runtime")
    if runtime is None:
        connection.send_error(msg["id"], "not_ready", "Flexible Map isn't running")
    return runtime


def _num(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _seconds(value: Any) -> float | None:
    """Accept seconds or milliseconds."""
    v = _num(value)
    if v is None:
        return None
    return v / 1000 if v > 1e11 else v


def async_register(hass: HomeAssistant) -> None:
    for command in (
        ws_config,
        ws_history,
        ws_stats,
        ws_import_points,
        ws_delete_range,
        ws_set_options,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({"type": "flexible_map/config"})
@websocket_api.async_response
async def ws_config(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    connection.send_result(
        msg["id"], {"version": VERSION, "options": merged_options(runtime["entry"])}
    )


@websocket_api.websocket_command(
    {
        "type": "flexible_map/history",
        "entity_ids": [str],
        "start": object,
        "end": object,
        "max_points": object,
    }
)
@websocket_api.async_response
async def ws_history(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    now = time.time()
    end = _seconds(msg.get("end")) or now
    start = _seconds(msg.get("start")) or end - 86400
    max_points = int(_num(msg.get("max_points"), 4000) or 4000)
    points = await hass.async_add_executor_job(
        runtime["store"].query, msg.get("entity_ids") or [], start, end, max_points
    )
    connection.send_result(msg["id"], {"points": points})


@websocket_api.websocket_command({"type": "flexible_map/stats"})
@websocket_api.async_response
async def ws_stats(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    connection.send_result(
        msg["id"], await hass.async_add_executor_job(runtime["store"].stats)
    )


@websocket_api.websocket_command(
    {"type": "flexible_map/import_points", "entity_id": str, "points": list}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_points(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    entity_id = (msg.get("entity_id") or "").strip()
    raw = msg.get("points") or []
    if not entity_id or len(raw) > MAX_IMPORT_BATCH:
        connection.send_error(
            msg["id"], "invalid_format", f"Need an entity_id and at most {MAX_IMPORT_BATCH} points"
        )
        return
    rows, skipped = [], 0
    for p in raw:
        try:
            ts, lat, lon = _seconds(p[0]), _num(p[1]), _num(p[2])
            acc = _num(p[3]) if len(p) > 3 else None
        except (TypeError, IndexError, KeyError):
            skipped += 1
            continue
        if ts is None or lat is None or lon is None or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            skipped += 1
            continue
        rows.append((ts, lat, lon, acc))
    added = await hass.async_add_executor_job(runtime["store"].add_many, entity_id, rows)
    runtime["tracker"].forget_cache()
    connection.send_result(msg["id"], {"added": added, "skipped": skipped, "received": len(raw)})


@websocket_api.websocket_command(
    {"type": "flexible_map/delete_range", "entity_id": str, "start": object, "end": object}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_range(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    start = _seconds(msg.get("start")) or 0
    end = _seconds(msg.get("end")) or time.time() + 86400
    removed = await hass.async_add_executor_job(
        runtime["store"].delete_range, msg.get("entity_id") or None, start, end
    )
    runtime["tracker"].forget_cache()
    connection.send_result(msg["id"], {"removed": removed})


@websocket_api.websocket_command(
    {
        "type": "flexible_map/set_options",
        "tracked_entities": [str],
        "units": str,
        "min_distance_m": object,
        "min_seconds": object,
        "max_accuracy_m": object,
        "retention_days": object,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_options(hass, connection, msg) -> None:
    runtime = _runtime(hass, connection, msg)
    if runtime is None:
        return
    new = dict(runtime["entry"].options)
    if "tracked_entities" in msg:
        new[CONF_TRACKED] = [e for e in msg["tracked_entities"] if "." in e]
    if msg.get("units") in ("mi", "km"):
        new[CONF_UNITS] = msg["units"]
    for key in (CONF_MIN_DISTANCE, CONF_MIN_SECONDS, CONF_MAX_ACCURACY, CONF_RETENTION):
        value = _num(msg.get(key))
        if value is not None and value >= 0:
            new[key] = int(value)
    # Saving triggers a reload of the integration (see __init__.py)
    hass.config_entries.async_update_entry(runtime["entry"], options=new)
    connection.send_result(msg["id"], {"saved": True})
