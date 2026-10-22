from backend.composer import _time_to_sec
import yaml
from pathlib import Path

def load_thresholds() -> dict:
    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    print(f"Thresholds loaded: {cfg['headway']}")  # ← add this
    return cfg["headway"]

def _get_stop_times_by_stop(feed: dict) -> dict[str, list[dict]]:
    """Group stop_times by stop_id, sorted by departure_time."""
    by_stop: dict[str, list[dict]] = {}
    for st in feed["stop_times"]:
        by_stop.setdefault(st["stop_id"], []).append(st)
    for stop_id in by_stop:
        by_stop[stop_id].sort(key=lambda x: _time_to_sec(x["departure_time"]) if x.get("departure_time") else 0)
    return by_stop

def _get_direction(trip_id: str, feed: dict) -> int | None:
    for t in feed["trips"]:
        if t["trip_id"] == trip_id:
            return t.get("direction_id")
    return None

def _get_route_direction(trip_id: str, feed: dict) -> tuple[str | None, int | None]:
    for t in feed["trips"]:
        if t["trip_id"] == trip_id:
            return t.get("route_id"), t.get("direction_id")
    return None, None

def run_headway_check(feed: dict) -> list[dict]:
    """
    For each stop, check the gap between consecutive trips
    in the same direction. Flag if below threshold.
    """
    thresholds  = load_thresholds()
    min_hw      = thresholds["min_headway_sec"]
    critical_hw = thresholds["critical_headway_sec"]

    by_stop   = _get_stop_times_by_stop(feed)
    conflicts = []

    for stop_id, stop_times in by_stop.items():
                # Group by route + direction, not just direction
        by_route_dir: dict[tuple, list[dict]] = {}
        for st in stop_times:
            route_id, direction = _get_route_direction(st["trip_id"], feed)
            key = (route_id, direction)
            by_route_dir.setdefault(key, []).append(st)

        for (route_id, direction), sts in by_route_dir.items():
            sts_sorted = sorted(
                sts,
                key=lambda x: _time_to_sec(x["departure_time"]) if x.get("departure_time") else 0
            )

            for i in range(1, len(sts_sorted)):
                prev = sts_sorted[i - 1]
                curr = sts_sorted[i]

                if not prev.get("departure_time") or not curr.get("departure_time"):
                    continue

                gap = _time_to_sec(curr["departure_time"]) - _time_to_sec(prev["departure_time"])

                if gap < min_hw:
                    severity = "CRITICAL" if gap < critical_hw else "WARNING"
                    conflicts.append({
                        "type":                "headway_violation",
                        "location_stop_id":    stop_id,
                        "trip_a":              prev["trip_id"],
                        "trip_b":              curr["trip_id"],
                        "severity":            severity,
                        "margin_violated_sec": min_hw - gap,
                    })

    return conflicts


def run_platform_clash_check(feed: dict) -> list[dict]:
    """
    Only runs if stop_ids have platform-level granularity.
    Skipped entirely for station-level feeds.
    WR feed is station-level so this will return [] in practice.
    """
    # Platform-level granularity detection:
    # if any stop_id contains a platform separator we proceed, else skip.
    stop_ids = {st["stop_id"] for st in feed["stop_times"]}
    has_platform_granularity = any(
        "_P" in sid or "-P" in sid or "PLT" in sid.upper()
        for sid in stop_ids
    )
    if not has_platform_granularity:
        return []

    from config.config import config
    min_sep = config["platform_clash"]["min_platform_separation_sec"]
    conflicts = []
    by_stop = _get_stop_times_by_stop(feed)

    for stop_id, sts in by_stop.items():
        for i in range(len(sts)):
            for j in range(i + 1, len(sts)):
                a, b = sts[i], sts[j]
                if not a.get("departure_time") or not b.get("arrival_time"):
                    continue
                gap = _time_to_sec(b["arrival_time"]) - _time_to_sec(a["departure_time"])
                if gap < min_sep:
                    conflicts.append({
                        "type":                "platform_clash",
                        "location_stop_id":    stop_id,
                        "trip_a":              a["trip_id"],
                        "trip_b":              b["trip_id"],
                        "severity":            "WARNING",
                        "margin_violated_sec": min_sep - gap,
                    })

    return conflicts


def run_conflict_engine(feed: dict) -> list[dict]:
    """Entry point — runs all checks and returns combined conflict list."""
    conflicts = []
    conflicts.extend(run_headway_check(feed))
    conflicts.extend(run_platform_clash_check(feed))
    return conflicts

def enrich_conflicts_with_ml(conflicts: list[dict], feed: dict) -> list[dict]:
    """Attach RF delay predictions to each flagged conflict."""
    from ml.predictor import predict_delay

    # Build a quick stop_times index for downstream stop count
    trip_stop_counts = {}
    for st in feed["stop_times"]:
        trip_stop_counts[st["trip_id"]] = trip_stop_counts.get(st["trip_id"], 0) + 1

    for c in conflicts:
        if c["type"] != "headway_violation":
            continue

        margin     = c["margin_violated_sec"]
        trip_a     = c["trip_a"]

        # Derive peak hour from trip_a's first departure
        first_dep  = next(
            (st["departure_time"] for st in feed["stop_times"]
             if st["trip_id"] == trip_a),
            None
        )
        is_peak = 0
        if first_dep:
            hour = int(first_dep.split(":")[0]) % 24
            is_peak = 1 if (7 <= hour <= 10 or 17 <= hour <= 19) else 0

        downstream = trip_stop_counts.get(trip_a, 5)

        result = predict_delay(
            headway_margin_violated_sec       = margin,
            is_peak_hour                      = is_peak,
            downstream_recovery_slack_sec     = 60,   # conservative default
            dwell_buffer_sec                  = 30,   # conservative default
            num_downstream_stops              = downstream,
            historical_delay_propagation_rate = 0.6   # conservative default
        )
        c["rf_estimated_cascade_sec"] = result["estimated_cascade_delay_sec"]
        c["rf_confidence"]            = result["confidence"]

    return conflicts