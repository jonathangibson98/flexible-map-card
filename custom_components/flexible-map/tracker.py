"""Listens to person / device_tracker updates and writes them to the file."""
from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
import time

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    CONF_MAX_ACCURACY,
    CONF_MIN_DISTANCE,
    CONF_MIN_SECONDS,
    CONF_RETENTION,
    CONF_TRACKED,
)
from .store import LocationStore, haversine_m

_LOGGER = logging.getLogger(__name__)
_MISSING = object()


class Tracker:
    """Records location changes."""

    def __init__(self, hass: HomeAssistant, store: LocationStore, options: dict) -> None:
        self.hass = hass
        self.store = store
        self.options = options
        self._tracked = set(options[CONF_TRACKED])
        self._last: dict[str, tuple | None] = {}
        self._lock = asyncio.Lock()
        self._unsubs: list[CALLBACK_TYPE] = []

    def is_tracked(self, entity_id: str) -> bool:
        if self._tracked:
            return entity_id in self._tracked
        return entity_id.startswith("person.")

    @callback
    def _filter(self, data) -> bool:
        entity_id = data.get("entity_id")
        return bool(entity_id) and self.is_tracked(entity_id)

    @callback
    def _on_state(self, event: Event) -> None:
        new_state = event.data.get("new_state")
        if new_state is None:
            return
        self.hass.async_create_task(self._process(new_state.entity_id, new_state))

    async def _process(self, entity_id: str, state) -> None:
        attrs = state.attributes
        lat, lon = attrs.get("latitude"), attrs.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return
        acc = attrs.get("gps_accuracy")
        acc = float(acc) if isinstance(acc, (int, float)) else None
        max_acc = self.options[CONF_MAX_ACCURACY]
        if max_acc and acc is not None and acc > max_acc:
            return
        ts = state.last_updated.timestamp()

        try:
            async with self._lock:
                last = self._last.get(entity_id, _MISSING)
                if last is _MISSING:
                    last = await self.hass.async_add_executor_job(
                        self.store.last_point, entity_id
                    )
                    self._last[entity_id] = last
                if last:
                    last_ts, last_lat, last_lon = last
                    if ts <= last_ts:
                        return
                    if ts - last_ts < self.options[CONF_MIN_SECONDS]:
                        return
                    if haversine_m(last_lat, last_lon, lat, lon) < self.options[CONF_MIN_DISTANCE]:
                        return
                self._last[entity_id] = (ts, lat, lon)
                await self.hass.async_add_executor_job(
                    self.store.add_point, entity_id, ts, float(lat), float(lon), acc
                )
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Could not save a location point for %s", entity_id)

    def forget_cache(self) -> None:
        """Call after deleting/importing data so 'last point' is re-read."""
        self._last.clear()

    async def _cleanup(self, _now=None) -> None:
        days = self.options[CONF_RETENTION]
        if days <= 0:
            return
        cutoff = time.time() - days * 86400
        removed = await self.hass.async_add_executor_job(self.store.purge_before, cutoff)
        if removed:
            _LOGGER.debug("Removed %s location points older than %s days", removed, days)

    async def async_start(self) -> None:
        self._unsubs.append(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._on_state, event_filter=self._filter
            )
        )
        self._unsubs.append(
            async_track_time_interval(self.hass, self._cleanup, timedelta(hours=6))
        )
        # Grab where everyone is right now so the file isn't empty on day one
        for state in self.hass.states.async_all():
            if self.is_tracked(state.entity_id):
                self.hass.async_create_task(self._process(state.entity_id, state))
        await self._cleanup()

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
