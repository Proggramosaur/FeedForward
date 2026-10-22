from datetime import datetime, timezone
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "feedforward.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")   # faster concurrent writes
    conn.execute("PRAGMA synchronous = NORMAL") # safe but faster than FULL
    return conn


def init_db():
    conn = get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS baseline_feed (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        source_path TEXT
    );

    CREATE TABLE IF NOT EXISTS baseline_agency (
        feed_id         INTEGER NOT NULL REFERENCES baseline_feed(id),
        agency_id       TEXT,
        agency_name     TEXT NOT NULL,
        agency_url      TEXT NOT NULL,
        agency_timezone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS baseline_stops (
        feed_id   INTEGER NOT NULL REFERENCES baseline_feed(id),
        stop_id   TEXT NOT NULL,
        stop_name TEXT,
        stop_lat  REAL,
        stop_lon  REAL,
        PRIMARY KEY (feed_id, stop_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_routes (
        feed_id          INTEGER NOT NULL REFERENCES baseline_feed(id),
        route_id         TEXT NOT NULL,
        route_short_name TEXT,
        route_long_name  TEXT,
        route_type       INTEGER,
        PRIMARY KEY (feed_id, route_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_trips (
        feed_id       INTEGER NOT NULL REFERENCES baseline_feed(id),
        trip_id       TEXT NOT NULL,
        route_id      TEXT NOT NULL,
        service_id    TEXT NOT NULL,
        trip_headsign TEXT,
        direction_id  INTEGER,
        PRIMARY KEY (feed_id, trip_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_stop_times (
        feed_id        INTEGER NOT NULL REFERENCES baseline_feed(id),
        trip_id        TEXT NOT NULL,
        stop_id        TEXT NOT NULL,
        stop_sequence  INTEGER NOT NULL,
        arrival_time   TEXT,
        departure_time TEXT,
        PRIMARY KEY (feed_id, trip_id, stop_sequence)
    );

    CREATE TABLE IF NOT EXISTS baseline_calendar (
        feed_id    INTEGER NOT NULL REFERENCES baseline_feed(id),
        service_id TEXT NOT NULL,
        monday     INTEGER,
        tuesday    INTEGER,
        wednesday  INTEGER,
        thursday   INTEGER,
        friday     INTEGER,
        saturday   INTEGER,
        sunday     INTEGER,
        start_date TEXT,
        end_date   TEXT,
        PRIMARY KEY (feed_id, service_id)
    );

    CREATE TABLE IF NOT EXISTS scenario (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        baseline_id INTEGER NOT NULL REFERENCES baseline_feed(id),
        name        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'draft',
        created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenario_change (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id  INTEGER NOT NULL REFERENCES scenario(id),
        sequence_no  INTEGER NOT NULL,
        change_type  TEXT NOT NULL,
        target_type  TEXT NOT NULL,
        target_id    TEXT,
        payload_json TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS evaluation (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id        INTEGER NOT NULL REFERENCES scenario(id),
        kind               TEXT NOT NULL,
        computed_at        TEXT NOT NULL,
        accessibility_json TEXT
    );

    CREATE TABLE IF NOT EXISTS conflict_report (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id              INTEGER NOT NULL REFERENCES scenario(id),
        type                     TEXT NOT NULL,
        location_stop_id         TEXT,
        trip_a                   TEXT,
        trip_b                   TEXT,
        severity                 TEXT,
        margin_violated_sec      REAL,
        rf_estimated_cascade_sec REAL,
        confidence               REAL
    );

    CREATE TABLE IF NOT EXISTS headway_pattern_report (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id           INTEGER NOT NULL REFERENCES scenario(id),
        computed_at           TEXT NOT NULL,
        pattern_features_json TEXT,
        risk_flag             INTEGER,
        confidence            REAL
    );

    CREATE TABLE IF NOT EXISTS passenger_service_report (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id              INTEGER NOT NULL REFERENCES scenario(id),
        accessibility_delta_json TEXT,
        predicted_load_factor    REAL,
        computed_at              TEXT NOT NULL
    );
    """)
    conn.close()
    print("DB initialised at", DB_PATH)


# ── Baseline import helpers ───────────────────────────────────────────────────
# Each function accepts a connection from the caller so all inserts
# for one import share a single transaction — one commit at the end.

def register_feed(conn: sqlite3.Connection, feed_name: str) -> tuple[int, str]:
    """Insert a baseline feed record; returns (feed_id, timestamp)."""
    ts = datetime.now(timezone.utc).isoformat()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO baseline_feed (name, imported_at) VALUES (?, ?)",
        (feed_name, ts)
    )
    return cursor.lastrowid, ts


def insert_agency(conn: sqlite3.Connection, feed_id: int,
                  agency_id: str, agency_name: str,
                  agency_url: str, agency_timezone: str):
    conn.execute("""
        INSERT INTO baseline_agency
            (feed_id, agency_id, agency_name, agency_url, agency_timezone)
        VALUES (?, ?, ?, ?, ?)
    """, (feed_id, agency_id, agency_name, agency_url, agency_timezone))


def insert_stops_batch(conn: sqlite3.Connection, feed_id: int, rows: list[dict]):
    """Insert all stops in one executemany call."""
    conn.executemany("""
        INSERT INTO baseline_stops (feed_id, stop_id, stop_name, stop_lat, stop_lon)
        VALUES (?, ?, ?, ?, ?)
    """, [
        (feed_id,
         r["stop_id"],
         r.get("stop_name", ""),
         float(r["stop_lat"]) if r.get("stop_lat") else None,
         float(r["stop_lon"]) if r.get("stop_lon") else None)
        for r in rows
    ])
    print(f"  Inserted {len(rows)} stops")


def insert_routes_batch(conn: sqlite3.Connection, feed_id: int, rows: list[dict]):
    conn.executemany("""
        INSERT INTO baseline_routes
            (feed_id, route_id, route_short_name, route_long_name, route_type)
        VALUES (?, ?, ?, ?, ?)
    """, [
        (feed_id,
         r["route_id"],
         r.get("route_short_name", ""),
         r.get("route_long_name", ""),
         int(r["route_type"]) if r.get("route_type") else None)
        for r in rows
    ])
    print(f"  Inserted {len(rows)} routes")


def insert_trips_batch(conn: sqlite3.Connection, feed_id: int, rows: list[dict]):
    conn.executemany("""
        INSERT INTO baseline_trips
            (feed_id, trip_id, route_id, service_id, trip_headsign, direction_id)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [
        (feed_id,
         r["trip_id"],
         r["route_id"],
         r["service_id"],
         r.get("trip_headsign", ""),
         int(r["direction_id"]) if r.get("direction_id") else None)
        for r in rows
    ])
    print(f"  Inserted {len(rows)} trips")


def insert_stop_times_batch(conn: sqlite3.Connection, feed_id: int, rows: list[dict]):
    conn.executemany("""
        INSERT INTO baseline_stop_times
            (feed_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [
        (feed_id,
         r["trip_id"],
         r["stop_id"],
         int(r["stop_sequence"]),
         r.get("arrival_time", ""),
         r.get("departure_time", ""))
        for r in rows
    ])
    print(f"  Inserted {len(rows)} stop_times")


def insert_calendar_batch(conn: sqlite3.Connection, feed_id: int, rows: list[dict]):
    conn.executemany("""
        INSERT INTO baseline_calendar
            (feed_id, service_id, monday, tuesday, wednesday,
             thursday, friday, saturday, sunday, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        (feed_id,
         r["service_id"],
         int(r.get("monday", 0)),    int(r.get("tuesday", 0)),
         int(r.get("wednesday", 0)), int(r.get("thursday", 0)),
         int(r.get("friday", 0)),    int(r.get("saturday", 0)),
         int(r.get("sunday", 0)),
         r.get("start_date", ""),    r.get("end_date", ""))
        for r in rows
    ])
    print(f"  Inserted {len(rows)} calendar entries")
