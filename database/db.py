import os
import sqlite3
from datetime import datetime

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DB_DIR, "blood_donor.db")
SCHEMA_PATH = os.path.join(DB_DIR, "schema.sql")


def _get_connection():
    """Open a connection to the SQLite database with dict-like row access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now_iso():
    """Return the current local timestamp in ISO format."""
    return datetime.now().isoformat(timespec="seconds")


def init_db():
    """Initialize database tables from schema.sql if they do not exist."""
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    with _get_connection() as conn:
        conn.executescript(schema_sql)


def add_donor(data):
    """Insert a new donor and return a dict with the new ID."""
    created_at = data.get("created_at") or _now_iso()
    is_visible = data.get("is_visible", 1)

    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO donors (
                name, blood_group, area, contact_preference,
                last_donation_date, is_visible, latitude, longitude, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["name"],
                data["blood_group"],
                data["area"],
                data.get("contact_preference"),
                data.get("last_donation_date"),
                is_visible,
                data.get("latitude"),
                data.get("longitude"),
                created_at,
            ),
        )
        new_id = cursor.lastrowid

    return {
        "id": new_id,
        "name": data["name"],
        "blood_group": data["blood_group"],
        "area": data["area"],
        "contact_preference": data.get("contact_preference"),
        "last_donation_date": data.get("last_donation_date"),
        "is_visible": is_visible,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "created_at": created_at,
    }


def get_donors(blood_group=None, area=None):
    """Return a list of donor dicts, optionally filtered by blood_group and area."""
    query = "SELECT * FROM donors WHERE 1=1"
    params = []

    if blood_group:
        query += " AND UPPER(blood_group) = UPPER(?)"
        params.append(blood_group.strip())

    if area:
        query += " AND LOWER(area) LIKE LOWER(?)"
        params.append(f"%{area.strip()}%")

    query += " ORDER BY id DESC"

    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()

    return [dict(row) for row in rows]


def add_request(data):
    """Insert a new emergency blood request and return a dict with the new ID."""
    created_at = data.get("created_at") or _now_iso()
    status = data.get("status") or "OPEN"

    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO requests (
                blood_group, hospital, area, units_needed,
                contact, status, latitude, longitude, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["blood_group"],
                data["hospital"],
                data["area"],
                data["units_needed"],
                data["contact"],
                status,
                data.get("latitude"),
                data.get("longitude"),
                created_at,
            ),
        )
        new_id = cursor.lastrowid

    return {
        "id": new_id,
        "blood_group": data["blood_group"],
        "hospital": data["hospital"],
        "area": data["area"],
        "units_needed": data["units_needed"],
        "contact": data["contact"],
        "status": status,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "created_at": created_at,
    }


def get_requests():
    """Return a list of all emergency request dicts."""
    with _get_connection() as conn:
        rows = conn.execute("SELECT * FROM requests ORDER BY id DESC").fetchall()

    return [dict(row) for row in rows]


def close_request(request_id):
    """Mark an emergency request as CLOSED. Returns True if a row was updated."""
    with _get_connection() as conn:
        cursor = conn.execute(
            "UPDATE requests SET status = 'CLOSED' WHERE id = ?",
            (request_id,),
        )
        return cursor.rowcount > 0


def add_alert(request_id, donor_name, blood_group, message):
    """Save an alert for a matched donor and return a dict with the new ID."""
    created_at = _now_iso()

    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO alerts (request_id, donor_name, blood_group, message, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (request_id, donor_name, blood_group, message, created_at),
        )
        new_id = cursor.lastrowid

    return {
        "id": new_id,
        "request_id": request_id,
        "donor_name": donor_name,
        "blood_group": blood_group,
        "message": message,
        "created_at": created_at,
    }


def get_alerts():
    """Return a list of all alert dicts."""
    with _get_connection() as conn:
        rows = conn.execute("SELECT * FROM alerts ORDER BY id DESC").fetchall()

    return [dict(row) for row in rows]
