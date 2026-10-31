"""Flexible Map: a location history file, a dashboard, and a map card in one."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .const import (
    DB_FILE,
    DB_FOLDER,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_URL_PATH,
    URL_BASE,
    VERSION,
    merged_options,
)
from .store import LocationStore
from .tracker import Tracker

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_URL = f"{URL_BASE}/flexible-map-card.js?v={VERSION}"
PANEL_URL = f"{URL_BASE}/flexible-map-panel.js?v={VERSION}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Create the config entry by itself the first time, so there's nothing to click."""
    hass.data.setdefault(DOMAIN, {})
    if not hass.config_entries.async_entries(DOMAIN):
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN, context={"source": SOURCE_IMPORT}, data={}
            )
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Open the history file, start recording, and show the dashboard."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    options = merged_options(entry)

    store = LocationStore(hass.config.path(DB_FOLDER, DB_FILE))
    await hass.async_add_executor_job(store.open)
    tracker = Tracker(hass, store, options)
    domain_data["runtime"] = {
        "entry": entry,
        "store": store,
        "tracker": tracker,
        "options": options,
    }
    await tracker.async_start()

    if not domain_data.get("ui_ready"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    URL_BASE, str(Path(__file__).parent / "frontend"), False
                )
            ]
        )
        websocket.async_register(hass)
        domain_data["ui_ready"] = True

    # The card works on every dashboard without adding a resource by hand
    frontend.add_extra_js_url(hass, CARD_URL)

    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="Flexible Map",
        sidebar_icon="mdi:map-marker-path",
        module_url=PANEL_URL,
        embed_iframe=False,
        require_admin=False,
        config={"card_url": CARD_URL},
    )

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Stop recording and take the dashboard away."""
    runtime = hass.data.get(DOMAIN, {}).pop("runtime", None)
    if runtime:
        runtime["tracker"].async_stop()
        await hass.async_add_executor_job(runtime["store"].close)
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    try:
        frontend.remove_extra_js_url(hass, CARD_URL)
    except Exception:  # noqa: BLE001
        pass
    return True
