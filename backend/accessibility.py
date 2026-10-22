from collections import defaultdict, deque
from backend.composer import _time_to_sec


def _build_graph(feed: dict) -> dict[str, list[tuple[str, int]]]:
    """
    Build adjacency graph: stop_id → [(next_stop_id, travel_time_sec)]
    Derived from stop_times — consecutive stops in each trip are edges.
    """
    graph: dict[str, list[tuple[str, int]]] = defaultdict(list)

    # Group stop_times by trip, sorted by sequence
    by_trip: dict[str, list[dict]] = {}
    for st in feed["stop_times"]:
        by_trip.setdefault(st["trip_id"], []).append(st)
    for trip_id in by_trip:
        by_trip[trip_id].sort(key=lambda x: x["stop_sequence"])

    for trip_id, sts in by_trip.items():
        for i in range(len(sts) - 1):
            a = sts[i]
            b = sts[i + 1]
            if not a.get("departure_time") or not b.get("arrival_time"):
                continue
            travel_time = _time_to_sec(b["arrival_time"]) - _time_to_sec(a["departure_time"])
            if travel_time > 0:
                graph[a["stop_id"]].append((b["stop_id"], travel_time))

    return dict(graph)


def compute_reachable_stops(feed: dict, origin_stop_id: str,
                             window_minutes: int = 30) -> dict:
    """
    BFS from origin_stop_id within window_minutes.
    Returns reachable stop_ids and their minimum travel time from origin.
    """
    window_sec = window_minutes * 60
    graph      = _build_graph(feed)

    # BFS: queue holds (stop_id, cumulative_time_sec)
    visited: dict[str, int] = {}   # stop_id → min time to reach it
    queue = deque([(origin_stop_id, 0)])

    while queue:
        current_stop, elapsed = queue.popleft()

        if current_stop in visited:
            continue
        visited[current_stop] = elapsed

        for next_stop, travel_time in graph.get(current_stop, []):
            new_elapsed = elapsed + travel_time
            if new_elapsed <= window_sec and next_stop not in visited:
                queue.append((next_stop, new_elapsed))

    # Exclude the origin itself from reachable count
    reachable = {
        stop_id: secs
        for stop_id, secs in visited.items()
        if stop_id != origin_stop_id
    }

    return {
        "origin":          origin_stop_id,
        "window_minutes":  window_minutes,
        "reachable_count": len(reachable),
        "reachable_stops": {
            stop_id: {"travel_time_sec": secs, "travel_time_min": round(secs / 60, 1)}
            for stop_id, secs in sorted(reachable.items(), key=lambda x: x[1])
        }
    }


def compute_accessibility_delta(baseline_result: dict,
                                 temp_result: dict) -> dict:
    """
    Compare baseline vs temp feed reachability.
    Returns gained/lost stops and count delta.
    """
    baseline_stops = set(baseline_result["reachable_stops"].keys())
    temp_stops     = set(temp_result["reachable_stops"].keys())

    gained = temp_stops - baseline_stops
    lost   = baseline_stops - temp_stops

    return {
        "origin":          baseline_result["origin"],
        "window_minutes":  baseline_result["window_minutes"],
        "baseline_count":  baseline_result["reachable_count"],
        "temp_count":      temp_result["reachable_count"],
        "delta":           temp_result["reachable_count"] - baseline_result["reachable_count"],
        "gained_stops":    sorted(gained),
        "lost_stops":      sorted(lost),
    }   
#TODO Check with a change in virar-bound train
