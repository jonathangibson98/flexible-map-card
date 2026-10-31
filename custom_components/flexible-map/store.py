"""The file that keeps every location point (SQLite)."""
from __future__ import annotations

import math
import os
import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS points (
    entity_id TEXT NOT NULL,
    ts REAL NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    acc REAL,
    PRIMARY KEY (entity_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_points_ts ON points (ts);
"""


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two points."""
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(h))


class LocationStore:
    """Thin, thread-safe wrapper. Every method blocks: call from an executor."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._db: sqlite3.Connection | None = None

    def open(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        db = sqlite3.connect(self.path, check_same_thread=False)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        db.executescript(SCHEMA)
        db.commit()
        self._db = db

    def close(self) -> None:
        with self._lock:
            if self._db is not None:
                self._db.close()
                self._db = None

    def add_point(self, entity_id, ts, lat, lon, acc) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO points VALUES (?,?,?,?,?)",
                (entity_id, ts, lat, lon, acc),
            )
            self._db.commit()

    def add_many(self, entity_id: str, rows: list) -> int:
        """rows: [(ts, lat, lon, acc|None), ...]. Returns how many were new."""
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(
                "INSERT OR IGNORE INTO points VALUES (?,?,?,?,?)",
                [(entity_id, r[0], r[1], r[2], r[3]) for r in rows],
            )
            self._db.commit()
            return self._db.total_changes - before

    def last_point(self, entity_id: str):
        with self._lock:
            return self._db.execute(
                "SELECT ts, lat, lon FROM points WHERE entity_id=? "
                "ORDER BY ts DESC LIMIT 1",
                (entity_id,),
            ).fetchone()

    def query(self, entity_ids, start: float, end: float, max_points: int) -> dict:
        out: dict[str, list] = {}
        with self._lock:
            if not entity_ids:
                entity_ids = [
                    r[0] for r in self._db.execute("SELECT DISTINCT entity_id FROM points")
                ]
            for eid in entity_ids:
                rows = self._db.execute(
                    "SELECT ts, lat, lon, acc FROM points "
                    "WHERE entity_id=? AND ts>=? AND ts<=? ORDER BY ts",
                    (eid, start, end),
                ).fetchall()
                if max_points and len(rows) > max_points:
                    step = math.ceil(len(rows) / max_points)
                    last = rows[-1]
                    rows = rows[::step]
                    if rows[-1] != last:
                        rows.append(last)
                out[eid] = [list(r) for r in rows]
        return out

    def delete_range(self, entity_id: str | None, start: float, end: float) -> int:
        with self._lock:
            before = self._db.total_changes
            if entity_id:
                self._db.execute(
                    "DELETE FROM points WHERE entity_id=? AND ts>=? AND ts<=?",
                    (entity_id, start, end),
                )
            else:
                self._db.execute(
                    "DELETE FROM points WHERE ts>=? AND ts<=?", (start, end)
                )
            self._db.commit()
            return self._db.total_changes - before

    def purge_before(self, ts: float) -> int:
        with self._lock:
            before = self._db.total_changes
            self._db.execute("DELETE FROM points WHERE ts<?", (ts,))
            self._db.commit()
            return self._db.total_changes - before

    def stats(self) -> dict:
        with self._lock:
            rows = self._db.execute(
                "SELECT entity_id, COUNT(*), MIN(ts), MAX(ts) FROM points "
                "GROUP BY entity_id"
            ).fetchall()
        try:
            size = os.path.getsize(self.path)
        except OSError:
            size = 0
        return {
            "bytes": size,
            "entities": {
                r[0]: {"count": r[1], "first": r[2], "last": r[3]} for r in rows
            },
        }
