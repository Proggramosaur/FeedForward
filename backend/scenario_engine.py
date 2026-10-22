import json
from datetime import datetime, timezone
from backend import database_helper


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── scenarios ─────────────────────────────────────────────────────────────────

def create_scenario(baseline_id: int, name: str) -> dict:
    conn = database_helper.get_connection()
    try:
        # validate baseline exists
        feed = conn.execute(
            "SELECT id FROM baseline_feed WHERE id=?", (baseline_id,)
        ).fetchone()

        if feed is None:
            raise ValueError(f"No baseline with id={baseline_id}")

        timestamp = _now()
        cursor = conn.execute(
            "INSERT INTO scenario (baseline_id, name, status, created_at) VALUES (?,?,?,?)",
            (baseline_id, name, "draft", timestamp),
        )
        conn.commit()
        return {
            "scenario_id": cursor.lastrowid,
            "baseline_id": baseline_id,
            "name":        name,
            "status":      "draft",
            "created_at":  timestamp,
        }
    
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_scenario(scenario_id: int) -> dict | None:
    conn = database_helper.get_connection()
    try:
        row = conn.execute(
            "SELECT id, baseline_id, name, status, created_at FROM scenario WHERE id=?",
            (scenario_id,),
        ).fetchone()
        if row is None:
            return None
        return dict(row)
    
    finally:
        conn.close()


#  changes
def list_scenarios(baseline_id: int) -> list[dict]:
    conn = database_helper.get_connection()
    try:
        rows = conn.execute(
            "SELECT id, baseline_id, name, status, created_at FROM scenario WHERE baseline_id=?",
            (baseline_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

def list_changes(scenario_id: int) -> list[dict]:
    conn = database_helper.get_connection()
    try:
        rows = conn.execute("""
            SELECT id, scenario_id, sequence_no, change_type, target_type,
                   target_id, payload_json, status
            FROM scenario_change
            WHERE scenario_id=? AND status != 'discarded'
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


def add_change(scenario_id: int, change_type: str, target_type: str,
               target_id: str | None, payload: dict) -> dict:
    # Validate change_type and target_type
    valid_change_types  = {"add", "modify", "remove"}
    valid_target_types  = {"trip", "stop"}
    if change_type not in valid_change_types:
        raise ValueError(f"change_type must be one of {valid_change_types}")
    if target_type not in valid_target_types:
        raise ValueError(f"target_type must be one of {valid_target_types}")

    conn = database_helper.get_connection()
    try:
        # Check scenario exists and is not exported/discarded
        scen = conn.execute(
            "SELECT id, status FROM scenario WHERE id=?", (scenario_id,)
        ).fetchone()
        if scen is None:
            raise ValueError(f"Scenario {scenario_id} not found")
        
        if scen["status"] in ("exported", "discarded"):
            raise ValueError(f"Cannot add changes to a scenario with status='{scen['status']}'")

        # Next sequence number
        max_seq = conn.execute(
            "SELECT COALESCE(MAX(sequence_no), 0) FROM scenario_change WHERE scenario_id=?",
            (scenario_id,),
        ).fetchone()[0]
        seq = max_seq + 1

        payload_json = json.dumps(payload)
        cursor = conn.execute(
            """INSERT INTO scenario_change
               (scenario_id, sequence_no, change_type, target_type, target_id, payload_json, status)
               VALUES (?,?,?,?,?,?,?)""",
            (scenario_id, seq, change_type, target_type, target_id, payload_json, "active"),
        )
        conn.commit()
        return {
            "change_id":   cursor.lastrowid,
            "scenario_id": scenario_id,
            "sequence_no": seq,
            "change_type": change_type,
            "target_type": target_type,
            "target_id":   target_id,
            "payload":     payload,
            "status":      "active",
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def discard_change(scenario_id: int, change_id: int):
    conn = database_helper.get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM scenario_change WHERE id=? AND scenario_id=?",
            (change_id, scenario_id),
        ).fetchone()
        if row is None:
            raise ValueError(f"Change {change_id} not found in scenario {scenario_id}")
        conn.execute(
            "UPDATE scenario_change SET status='discarded' WHERE id=?", (change_id,)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()