import json
from copy import deepcopy
from backend.database_helper import get_connection


def load_baseline(feed_id: int) -> dict:
    """Load baseline GTFS tables into memory as lists of dicts."""
    conn = get_connection()
    try:
        def fetchall(query, params):
            return [dict(r) for r in conn.execute(query, params).fetchall()]

        return {
            "stops":      fetchall("SELECT * FROM baseline_stops      WHERE feed_id=?", (feed_id,)),
            "routes":     fetchall("SELECT * FROM baseline_routes     WHERE feed_id=?", (feed_id,)),
            "trips":      fetchall("SELECT * FROM baseline_trips      WHERE feed_id=?", (feed_id,)),
            "stop_times": fetchall("SELECT * FROM baseline_stop_times WHERE feed_id=?", (feed_id,)),
            "calendar":   fetchall("SELECT * FROM baseline_calendar   WHERE feed_id=?", (feed_id,)),
        }
    finally:
        conn.close()


def load_active_changes(scenario_id: int) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT * FROM scenario_change
            WHERE scenario_id=? AND status='active'
            ORDER BY sequence_no
        """, (scenario_id,)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["payload"] = json.loads(d.pop("payload_json"))
            result.append(d)
        return result
    finally:
        conn.close()


def _time_to_sec(t: str) -> int:
    """HH:MM:SS → seconds. Handles times past midnight (e.g. 25:10:00)."""
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _sec_to_time(s: int) -> str:
    """Seconds → HH:MM:SS (allows >24h for post-midnight trips)."""
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    return f"{h:02}:{m:02}:{sec:02}"


def _propagate_offset(stop_times: list[dict], from_sequence: int, offset_sec: int):
    """Shift arrival and departure of all stop_times after from_sequence by offset_sec."""
    for st in stop_times:
        if st["stop_sequence"] > from_sequence:
            if st.get("arrival_time"):
                st["arrival_time"]   = _sec_to_time(_time_to_sec(st["arrival_time"])   + offset_sec)
            if st.get("departure_time"):
                st["departure_time"] = _sec_to_time(_time_to_sec(st["departure_time"]) + offset_sec)


def compose_temp_feed(feed_id: int, scenario_id: int) -> dict:
    """
    Apply all active scenario changes on top of the baseline.
    Returns an in-memory GTFS-shaped dict (no disk write).
    Raises ValueError if a change references a trip that doesn't exist.
    """
    feed = load_baseline(feed_id)
    changes = load_active_changes(scenario_id)

    # Index for fast lookup — keyed by trip_id
    trips_idx = {t["trip_id"]: t for t in feed["trips"]}
    # stop_times grouped by trip_id
    st_by_trip: dict[str, list[dict]] = {}
    for st in feed["stop_times"]:
        st_by_trip.setdefault(st["trip_id"], []).append(st)

    for change in changes:
        op        = change["payload"].get("operation")
        target_id = change.get("target_id")  # trip_id for trip-level ops

        # ── ADD TRIP ──────────────────────────────────────────────────────────
        if op == "add_trip":
            trip_data  = change["payload"]["trip"]
            stop_times = change["payload"]["stop_times"]
            trips_idx[trip_data["trip_id"]] = {**trip_data, "feed_id": feed_id}
            st_by_trip[trip_data["trip_id"]] = [
                {**st, "feed_id": feed_id, "trip_id": trip_data["trip_id"]}
                for st in stop_times
            ]

        # ── REMOVE TRIP ───────────────────────────────────────────────────────
        elif op == "remove_trip":
            if target_id not in trips_idx:
                raise ValueError(f"remove_trip: trip '{target_id}' not found in feed")
            trips_idx.pop(target_id)
            st_by_trip.pop(target_id, None)

        # ── MODIFY STOP TIME ──────────────────────────────────────────────────
        elif op == "modify_stop_time":
            if target_id not in st_by_trip:
                raise ValueError(f"modify_stop_time: trip '{target_id}' not found")
            stop_id = change["payload"]["stop_id"]
    
            # Accept both payload formats:
            # Format A (composer schema): { "changes": { "arrival_time": ..., "departure_time": ... } }
            # Format B (frontend direct):  { "arrival_time": ..., "departure_time": ... }
            if "changes" in change["payload"]:
                changes_ = change["payload"]["changes"]
            else:
                changes_ = {
                    k: v for k, v in change["payload"].items()
                    if k in ("arrival_time", "departure_time")
                }
    
            sts   = st_by_trip[target_id]
            match = next((s for s in sts if s["stop_id"] == stop_id), None)
            if match is None:
                raise ValueError(f"modify_stop_time: stop '{stop_id}' not in trip '{target_id}'")
    
            old_dep = _time_to_sec(match["departure_time"]) if match.get("departure_time") else None
            match.update({k: v for k, v in changes_.items()})
            new_dep = _time_to_sec(match["departure_time"]) if match.get("departure_time") else None
    
            if old_dep is not None and new_dep is not None and new_dep != old_dep:
                _propagate_offset(sts, match["stop_sequence"], new_dep - old_dep)

        # ── ADD STOP TO TRIP ──────────────────────────────────────────────────
        elif op == "add_stop_to_trip":
            if target_id not in st_by_trip:
                raise ValueError(f"add_stop_to_trip: trip '{target_id}' not found")
            sts     = st_by_trip[target_id]
            new_seq = change["payload"]["stop_sequence"]
            # Shift existing stops at or after new_seq up by 1
            for st in sts:
                if st["stop_sequence"] >= new_seq:
                    st["stop_sequence"] += 1
            sts.append({
                "feed_id":        feed_id,
                "trip_id":        target_id,
                "stop_id":        change["payload"]["stop_id"],
                "stop_sequence":  new_seq,
                "arrival_time":   change["payload"].get("arrival_time", ""),
                "departure_time": change["payload"].get("departure_time", ""),
            })
            st_by_trip[target_id] = sorted(sts, key=lambda x: x["stop_sequence"])

        # ── REMOVE STOP FROM TRIP ─────────────────────────────────────────────
        elif op == "remove_stop_from_trip":
            if target_id not in st_by_trip:
                raise ValueError(f"remove_stop_from_trip: trip '{target_id}' not found")
            stop_id = change["payload"]["stop_id"]
            sts     = st_by_trip[target_id]
            before  = len(sts)
            st_by_trip[target_id] = [s for s in sts if s["stop_id"] != stop_id]
            if len(st_by_trip[target_id]) == before:
                raise ValueError(f"remove_stop_from_trip: stop '{stop_id}' not in trip '{target_id}'")
            # Renumber sequences to keep them contiguous
            for i, st in enumerate(sorted(st_by_trip[target_id], key=lambda x: x["stop_sequence"]), 1):
                st["stop_sequence"] = i

        else:
            raise ValueError(f"Unknown operation: '{op}'")

    # Reconstruct flat stop_times list
    feed["trips"]      = list(trips_idx.values())
    feed["stop_times"] = [st for sts in st_by_trip.values() for st in sts]

    return feed