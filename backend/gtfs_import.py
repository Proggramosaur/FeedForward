import zipfile
import io
import csv
from backend import database_helper

def parse_and_import_gtfs(file_bytes: bytes, name: str) -> dict:

    try:
        z = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        raise ValueError("Uploaded file is not a valid ZIP.")

    files_in_zip = z.namelist()
    required = ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt"]
    missing = [f for f in required if f not in files_in_zip]
    if missing:
        raise ValueError(f"Missing required GTFS files: {missing}")

    # Register the baseline feed and get its ID, and registration timestamp
    conn= database_helper.get_connection()
    feed_id, registeration_timestamp=database_helper.register_feed(conn,feed_name=name)
    
    
    def read_csv(filename):
        with z.open(filename) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))

    try:
        # agency.txt
        if "agency.txt" in files_in_zip:
            for row in read_csv("agency.txt"):
                agency_id  =    row.get("agency_id", "")
                agency_name=    row.get("agency_name", "")
                agency_url =    row.get("agency_url", "")
                agency_timezone=row.get("agency_timezone", "")

                database_helper.insert_agency(conn,feed_id,agency_id, agency_name,
                                              agency_url,agency_timezone)


        
        # database_helper.insert_agency(conn, feed_id, ...)
        database_helper.insert_stops_batch(conn, feed_id, read_csv("stops.txt"))
        database_helper.insert_routes_batch(conn, feed_id, read_csv("routes.txt"))
        database_helper.insert_trips_batch(conn, feed_id, read_csv("trips.txt"))
        database_helper.insert_stop_times_batch(conn, feed_id, read_csv("stop_times.txt"))
        database_helper.insert_calendar_batch(conn, feed_id, read_csv("calendar.txt"))
        conn.commit()  # ← single commit for the entire import
    except Exception as e:
        conn.rollback()
        raise
    
    finally:
        conn.close()

    return {"feed_id": feed_id, "name": name, "imported_at": registeration_timestamp}

def get_baseline_evaluation(feed_id: int) -> dict:
    conn = database_helper.get_connection()
    try:
        cursor = conn.cursor()

        # Basic counts
        stops = cursor.execute(
            "SELECT COUNT(*) FROM baseline_stops WHERE feed_id = ?", (feed_id,)
        ).fetchone()[0]

        routes = cursor.execute(
            "SELECT route_id, route_short_name, route_long_name FROM baseline_routes WHERE feed_id = ?", (feed_id,)
        ).fetchall()

        trips = cursor.execute(
            "SELECT COUNT(*) FROM baseline_trips WHERE feed_id = ?", (feed_id,)
        ).fetchone()[0]

        # Per-route trip count
        route_trip_counts = cursor.execute("""
            SELECT r.route_id, r.route_short_name, COUNT(t.trip_id) as trip_count
            FROM baseline_routes r
            LEFT JOIN baseline_trips t 
                ON t.route_id = r.route_id AND t.feed_id = r.feed_id
            WHERE r.feed_id = ?
            GROUP BY r.route_id
        """, (feed_id,)).fetchall()

        # Earliest and latest departure in the feed
        time_range = cursor.execute("""
            SELECT MIN(departure_time), MAX(departure_time)
            FROM baseline_stop_times
            WHERE feed_id = ?
        """, (feed_id,)).fetchone()

        # Service days
        calendar = cursor.execute(
            "SELECT * FROM baseline_calendar WHERE feed_id = ?", (feed_id,)
        ).fetchall()

                # Stops for map markers
        stops_rows = cursor.execute(
            "SELECT stop_id, stop_name, stop_lat, stop_lon FROM baseline_stops WHERE feed_id=?",
            (feed_id,)
        ).fetchall()

        return {
            "feed_id": feed_id,
            "stop_count": stops,
            "trip_count": trips,
            "route_count": len(routes),
            "routes": [
                {
                    "route_id": r["route_id"],
                    "short_name": r["route_short_name"],
                    "long_name": r["route_long_name"],
                    "trip_count": rc["trip_count"]
                }
                for r, rc in zip(routes, route_trip_counts)
            ],
            "schedule_range": {
                "first_departure": time_range[0],
                "last_departure":  time_range[1]
            },
            "service_patterns": [
                {
                    "service_id": c["service_id"],
                    "days": {
                        "monday":    bool(c["monday"]),
                        "tuesday":   bool(c["tuesday"]),
                        "wednesday": bool(c["wednesday"]),
                        "thursday":  bool(c["thursday"]),
                        "friday":    bool(c["friday"]),
                        "saturday":  bool(c["saturday"]),
                        "sunday":    bool(c["sunday"]),
                    },
                    "start_date": c["start_date"],
                    "end_date":   c["end_date"]
                }
                for c in calendar
            ],
            "stops": [
                {
                    "stop_id":   r["stop_id"],
                    "stop_name": r["stop_name"],
                    "stop_lat":  r["stop_lat"],
                    "stop_lon":  r["stop_lon"],
                }
                for r in stops_rows
            ]
        }
    finally:
        conn.close()

def get_baseline_trips_for_map(feed_id: int) -> list:
    conn = database_helper.get_connection()
    try:
        cursor = conn.cursor()

        # Stop coordinates lookup
        stops_rows = cursor.execute(
            "SELECT stop_id, stop_lat, stop_lon FROM baseline_stops WHERE feed_id=?",
            (feed_id,)
        ).fetchall()
        stop_coords = {r["stop_id"]: (r["stop_lat"], r["stop_lon"]) for r in stops_rows}

        # All trips
        trips_rows = cursor.execute(
            "SELECT trip_id, route_id, trip_headsign FROM baseline_trips WHERE feed_id=?",
            (feed_id,)
        ).fetchall()

        # All stop_times in one query
        all_st = cursor.execute("""
            SELECT trip_id, stop_id, stop_sequence
            FROM baseline_stop_times
            WHERE feed_id=?
            ORDER BY trip_id, stop_sequence
        """, (feed_id,)).fetchall()

        from collections import defaultdict
        st_by_trip = defaultdict(list)
        for st in all_st:
            lat, lon = stop_coords.get(st["stop_id"], (None, None))
            if lat is not None and lon is not None:
                st_by_trip[st["trip_id"]].append({
                    "stop_id":       st["stop_id"],
                    "stop_sequence": st["stop_sequence"],
                    "lat":           lat,
                    "lon":           lon,
                })

        return [
            {
                "trip_id":       t["trip_id"],
                "route_id":      t["route_id"],
                "trip_headsign": t["trip_headsign"],
                "stops":         st_by_trip.get(t["trip_id"], [])
            }
            for t in trips_rows
        ]
    finally:
        conn.close()