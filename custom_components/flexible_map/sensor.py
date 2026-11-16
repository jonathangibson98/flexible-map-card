"""Per-person sensors: where they are (place) and how far they went today."""
from __future__ import annotations

from datetime import datetime
import logging

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED, STATE_HOME, STATE_NOT_HOME
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .const import CONF_SENSORS, CONF_UNITS, DOMAIN, SIGNAL_POINT, VERSION
from .geo import path_length_m
from .places import place_name_at

_LOGGER = logging.getLogger(__name__)
METERS_PER_MILE = 1609.344


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities) -> None:
    runtime = hass.data[DOMAIN]["runtime"]
    options = runtime["options"]
    if not options[CONF_SENSORS]:
        return
    entities = []
    for entity_id in runtime["tracker"].tracked_ids():
        entities.append(PlaceSensor(hass, entity_id))
        entities.append(DistanceTodaySensor(hass, runtime["store"], entity_id, options[CONF_UNITS]))
    async_add_entities(entities)


def _friendly(hass: HomeAssistant, entity_id: str) -> str:
    st = hass.states.get(entity_id)
    if st and st.attributes.get("friendly_name"):
        return st.attributes["friendly_name"]
    return entity_id.split(".", 1)[-1].replace("_", " ").title()


def _device(entity_id: str) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, "flexible_map")},
        name="Flexible Map",
        manufacturer="jonathangibson98",
        model="Location history",
        sw_version=VERSION,
    )


class _Base(SensorEntity):
    _attr_should_poll = False
    _attr_has_entity_name = False

    def __init__(self, hass: HomeAssistant, source: str, kind: str) -> None:
        self.hass = hass
        self.source = source
        slug = source.replace(".", "_")
        self._attr_unique_id = f"{DOMAIN}_{slug}_{kind}"
        self._attr_device_info = _device(source)


class PlaceSensor(_Base):
    """Name of the zone the person is in, or Away."""

    _attr_icon = "mdi:map-marker-radius"

    def __init__(self, hass: HomeAssistant, source: str) -> None:
        super().__init__(hass, source, "place")
        self._attr_name = f"{_friendly(hass, source)} place"
        self._since: datetime | None = None

    def _compute(self) -> str | None:
        st = self.hass.states.get(self.source)
        if st is None:
            return None
        if st.state == STATE_HOME:
            home = self.hass.states.get("zone.home")
            return home.attributes.get("friendly_name", "Home") if home else "Home"
        if st.state not in (STATE_NOT_HOME, "unknown", "unavailable", ""):
            return st.state  # person/device_tracker state is the zone name
        lat, lon = st.attributes.get("latitude"), st.attributes.get("longitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            return place_name_at(self.hass, lat, lon) or "Away"
        return "Away" if st.state == STATE_NOT_HOME else None

    @callback
    def _refresh(self, *_args) -> None:
        value = self._compute()
        if value != self._attr_native_value:
            self._since = dt_util.utcnow()
        self._attr_native_value = value
        self._attr_extra_state_attributes = {
            "source": self.source,
            "since": self._since.isoformat() if self._since else None,
        }
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self._attr_native_value = self._compute()
        self._since = dt_util.utcnow()

        @callback
        def _match(data) -> bool:
            return data.get("entity_id") == self.source

        @callback
        def _on_change(event: Event) -> None:
            self._refresh()

        self.async_on_remove(
            self.hass.bus.async_listen(EVENT_STATE_CHANGED, _on_change, event_filter=_match)
        )
        self._refresh()


class DistanceTodaySensor(_Base):
    """Distance moved since midnight, from the history file."""

    _attr_icon = "mdi:map-marker-distance"
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_suggested_display_precision = 1

    def __init__(self, hass: HomeAssistant, store, source: str, units: str) -> None:
        super().__init__(hass, source, "distance_today")
        self.store = store
        self._attr_name = f"{_friendly(hass, source)} distance today"
        self._attr_native_unit_of_measurement = "km" if units == "km" else "mi"
        self._div = 1000 if units == "km" else METERS_PER_MILE
        self._attr_native_value = 0

    async def _async_update_value(self, *_args) -> None:
        start = dt_util.start_of_local_day().timestamp()
        end = dt_util.utcnow().timestamp() + 60
        try:
            pts = await self.hass.async_add_executor_job(self.store.points, self.source, start, end)
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Couldn't read today's points for %s", self.source)
            return
        self._attr_native_value = round(path_length_m(pts) / self._div, 2)
        self._attr_extra_state_attributes = {"source": self.source, "points_today": len(pts)}
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{SIGNAL_POINT}_{self.source}", self._schedule
            )
        )
        self.async_on_remove(
            async_track_time_change(self.hass, self._schedule, hour=0, minute=0, second=5)
        )
        await self._async_update_value()

    @callback
    def _schedule(self, *_args) -> None:
        self.hass.async_create_task(self._async_update_value())
