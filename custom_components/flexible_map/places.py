"""Home Assistant zones as the "places" Flexible Map matches stops against."""
from __future__ import annotations

from homeassistant.core import HomeAssistant

from .geo import match_place


def zone_places(hass: HomeAssistant) -> list[dict]:
    out = []
    for st in hass.states.async_all("zone"):
        a = st.attributes
        lat, lon = a.get("latitude"), a.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        if a.get("passive"):
            continue
        out.append(
            {
                "id": st.entity_id,
                "name": a.get("friendly_name") or st.entity_id,
                "lat": float(lat),
                "lon": float(lon),
                "radius": float(a.get("radius") or 100),
                "icon": a.get("icon"),
            }
        )
    return out


def place_name_at(hass: HomeAssistant, lat: float, lon: float) -> str | None:
    pl = match_place(lat, lon, zone_places(hass))
    return pl["name"] if pl else None
