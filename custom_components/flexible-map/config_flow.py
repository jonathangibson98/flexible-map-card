"""Setup + the settings menu (Settings > Devices & services > Flexible Map > Configure)."""
from __future__ import annotations

from homeassistant.config_entries import ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import selector

from .const import (
    CONF_MAX_ACCURACY,
    CONF_MIN_DISTANCE,
    CONF_MIN_SECONDS,
    CONF_RETENTION,
    CONF_TRACKED,
    CONF_UNITS,
    DOMAIN,
    merged_options,
)

# HA is moving from voluptuous to probatio. Use whichever one HA itself uses.
vol = getattr(cv, "probatio", None) or getattr(cv, "vol")


def _num(maximum: int, unit: str | None = None):
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=0,
            max=maximum,
            step=1,
            mode=selector.NumberSelectorMode.BOX,
            unit_of_measurement=unit,
        )
    )


class FlexibleMapConfigFlow(ConfigFlow, domain=DOMAIN):
    """Nothing to enter. One click and it's on."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Flexible Map", data={})
        return self.async_show_form(step_id="user")

    async def async_step_import(self, import_data=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        return self.async_create_entry(title="Flexible Map", data={})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return FlexibleMapOptionsFlow()


class FlexibleMapOptionsFlow(OptionsFlow):
    """Settings."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        opts = merged_options(self.config_entry)
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_TRACKED, default=opts[CONF_TRACKED]
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain=["person", "device_tracker"], multiple=True
                    )
                ),
                vol.Optional(CONF_UNITS, default=opts[CONF_UNITS]): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            {"value": "mi", "label": "Miles"},
                            {"value": "km", "label": "Kilometers"},
                        ]
                    )
                ),
                vol.Optional(CONF_MIN_DISTANCE, default=opts[CONF_MIN_DISTANCE]): _num(500, "m"),
                vol.Optional(CONF_MIN_SECONDS, default=opts[CONF_MIN_SECONDS]): _num(3600, "s"),
                vol.Optional(CONF_MAX_ACCURACY, default=opts[CONF_MAX_ACCURACY]): _num(5000, "m"),
                vol.Optional(CONF_RETENTION, default=opts[CONF_RETENTION]): _num(36500, "days"),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
