"""A URL other apps can send locations to (OwnTracks, Overland, curl, ...).

POST /api/flexible_map/ingest?token=TOKEN

Off unless "Ingest URL" is switched on in Settings. Each device name becomes
`ext.<name>` in the history file.
"""
from __future__ import annotations

from datetime import datetime
import hmac
import logging
import re
import secrets

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import CONF_INGEST, DOMAIN, INGEST_URL

_LOGGER = logging.getLogger(__name__)
MAX_POINTS = 5000


async def async_get_token(hass: HomeAssistant, regenerate: bool = False) -> str:
    store = Store(hass, 1, f"{DOMAIN}.ingest")
    data = await store.async_load() or {}
    if regenerate or not data.get("token"):
        data["token"] = secrets.token_urlsafe(24)
        await store.async_save(data)
    hass.data[DOMAIN]["ingest_token"] = data["token"]
    return data["token"]


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")
    return s[:40] or "device"


def _ts(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v / 1000 if v > 1e11 else float(v)
    try:
        n = float(v)
        return n / 1000 if n > 1e11 else n
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _points(body, query) -> list[tuple]:
    """(device, ts, lat, lon, acc) from OwnTracks, Overland, GeoJSON or plain JSON."""
    out = []
    hint = query.get("device_id") or query.get("device") or ""

    def add(obj, name=""):
        if not isinstance(obj, dict):
            return
        # Overland / GeoJSON feature
        if obj.get("type") == "Feature" and isinstance(obj.get("geometry"), dict):
            coords = obj["geometry"].get("coordinates") or []
            props = obj.get("properties") or {}
            if len(coords) >= 2:
                out.append((
                    name or props.get("device_id") or hint or "overland",
                    _ts(props.get("timestamp")),
                    coords[1], coords[0],
                    props.get("horizontal_accuracy"),
                ))
            return
        if obj.get("_type") not in (None, "location"):
            return  # OwnTracks sends other message types too
        lat = obj.get("lat", obj.get("latitude"))
        lon = obj.get("lon", obj.get("lng", obj.get("longitude")))
        if lat is None or lon is None:
            return
        out.append((
            name or obj.get("device") or obj.get("tid") or hint or "device",
            _ts(obj.get("timestamp", obj.get("tst", obj.get("time")))),
            lat, lon,
            obj.get("accuracy", obj.get("acc")),
        ))

    if isinstance(body, list):
        for item in body[:MAX_POINTS]:
            add(item)
    elif isinstance(body, dict):
        if isinstance(body.get("locations"), list):
            for item in body["locations"][:MAX_POINTS]:
                add(item)
        else:
            add(body)
    return out


class IngestView(HomeAssistantView):
    url = INGEST_URL
    name = "api:flexible_map:ingest"
    requires_auth = False
    cors_allowed = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def _ok(self, request: web.Request) -> bool:
        expected = self.hass.data.get(DOMAIN, {}).get("ingest_token") or ""
        given = request.query.get("token") or ""
        auth = request.headers.get("Authorization", "")
        if not given and auth.lower().startswith("bearer "):
            given = auth[7:].strip()
        return bool(expected) and hmac.compare_digest(given, expected)

    async def post(self, request: web.Request) -> web.Response:
        runtime = self.hass.data.get(DOMAIN, {}).get("runtime")
        if runtime is None or not runtime["options"].get(CONF_INGEST):
            return self.json_message("Ingest is turned off", 404)
        if not self._ok(request):
            return self.json_message("Wrong token", 401)
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Send JSON", 400)
        saved = 0
        now = datetime.now().timestamp()
        for name, ts, lat, lon, acc in _points(body, request.query):
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            try:
                acc = float(acc) if acc is not None else None
            except (TypeError, ValueError):
                acc = None
            await runtime["tracker"].async_add_external(f"ext.{_slug(name)}", ts or now, lat, lon, acc)
            saved += 1
        # OwnTracks expects a JSON list back; Overland expects {"result": "ok"}
        if "locations" in (body if isinstance(body, dict) else {}):
            return self.json({"result": "ok", "saved": saved})
        return self.json([])
