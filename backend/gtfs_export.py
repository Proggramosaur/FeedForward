import io
import csv
import zipfile
from datetime import datetime, timezone
from backend.composer import compose_temp_feed
from backend.database_helper import get_connection


def _write_csv(z: zipfile.ZipFile, filename: str, fieldnames: list[str], rows: list[dict]):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    z.writestr(filename, buf.getvalue())


def export_scenario_feed(scenario_id: int, baseline_id: int,
                          user_filename: str | None = None) -> tuple[bytes, str]:
    """
    Compose the temp feed and materialise it as a GTFS ZIP.
    Returns (zip_bytes, filename).
    """
    feed = compose_temp_feed(baseline_id, scenario_id)

    # Pull agency from baseline (not modified by scenario engine)
    conn = get_connection()
    try:
        agency_rows = [dict(r) for r in conn.execute(
            "SELECT * FROM baseline_agency WHERE feed_id=?", (baseline_id,)
        ).fetchall()]
    finally:
        conn.close()

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:

        # agency.txt
        if agency_rows:
            _write_csv(z, "agency.txt",
                       ["agency_id", "agency_name", "agency_url", "agency_timezone"],
                       agency_rows)

        # stops.txt
        _write_csv(z, "stops.txt",
                   ["stop_id", "stop_name", "stop_lat", "stop_lon"],
                   feed["stops"])

        # routes.txt
        _write_csv(z, "routes.txt",
                   ["route_id", "route_short_name", "route_long_name", "route_type"],
                   feed["routes"])

        # trips.txt
        _write_csv(z, "trips.txt",
                   ["trip_id", "route_id", "service_id", "trip_headsign", "direction_id"],
                   feed["trips"])

        # stop_times.txt
        _write_csv(z, "stop_times.txt",
                   ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
                   sorted(feed["stop_times"],
                          key=lambda x: (x["trip_id"], x["stop_sequence"])))

        # calendar.txt
        _write_csv(z, "calendar.txt",
                   ["service_id", "monday", "tuesday", "wednesday",
                    "thursday", "friday", "saturday", "sunday",
                    "start_date", "end_date"],
                   feed["calendar"])

    zip_bytes = buf.getvalue()

    # Mark scenario as exported
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE scenario SET status='exported' WHERE id=?", (scenario_id,)
        )
        conn.commit()
    finally:
        conn.close()

    # Filename
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
    filename = user_filename if user_filename else f"feedforward_export_{ts}.zip"
    if not filename.endswith(".zip"):
        filename += ".zip"

    return zip_bytes, filename