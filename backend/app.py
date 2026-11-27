import os
import sys
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS

# Add root folder to sys.path so we can import from database or backend
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.notifications import generate_alerts_for_request

# Try importing Member 3's database functions.
# If Member 3 hasn't merged yet, use safe in-memory fallback stubs.
try:
    from database.db import (
        init_db as db_init,
        add_donor as db_add_donor,
        get_donors as db_get_donors,
        add_request as db_add_request,
        get_requests as db_get_requests,
        close_request as db_close_request,
        add_alert as db_add_alert,
        get_alerts as db_get_alerts
    )
    USING_REAL_DB = True
except Exception:
    USING_REAL_DB = False

# Fallback in-memory storage if database/db.py is not yet ready
_MEM_DONORS = []
_MEM_REQUESTS = []
_MEM_ALERTS = []
_ID_COUNTER = {"donor": 1, "request": 1, "alert": 1}

def mem_init():
    pass

def mem_add_donor(data):
    item = dict(data)
    item["id"] = _ID_COUNTER["donor"]
    _ID_COUNTER["donor"] += 1
    item.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    item.setdefault("is_visible", 1)
    _MEM_DONORS.append(item)
    return item

def mem_get_donors(blood_group=None, area=None):
    results = list(_MEM_DONORS)
    if blood_group:
        results = [d for d in results if d.get("blood_group", "").strip().upper() == blood_group.strip().upper()]
    if area:
        results = [d for d in results if area.strip().lower() in d.get("area", "").strip().lower()]
    return results

def mem_add_request(data):
    item = dict(data)
    item["id"] = _ID_COUNTER["request"]
    _ID_COUNTER["request"] += 1
    item["status"] = "OPEN"
    item.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    _MEM_REQUESTS.append(item)
    return item

def mem_get_requests():
    return sorted(_MEM_REQUESTS, key=lambda r: (r.get("status") != "OPEN", -r.get("id", 0)))

def mem_close_request(req_id):
    for r in _MEM_REQUESTS:
        if r.get("id") == int(req_id):
            r["status"] = "CLOSED"
            return r
    return None

def mem_add_alert(req_id, donor_name, blood_group, message):
    alert = {
        "id": _ID_COUNTER["alert"],
        "request_id": req_id,
        "donor_name": donor_name,
        "blood_group": blood_group,
        "message": message,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    _ID_COUNTER["alert"] += 1
    _MEM_ALERTS.append(alert)
    return alert

def mem_get_alerts():
    return sorted(_MEM_ALERTS, key=lambda a: -a.get("id", 0))

# Wire active handlers
init_storage = db_init if USING_REAL_DB else mem_init
add_donor_fn = db_add_donor if USING_REAL_DB else mem_add_donor
get_donors_fn = db_get_donors if USING_REAL_DB else mem_get_donors
add_request_fn = db_add_request if USING_REAL_DB else mem_add_request
get_requests_fn = db_get_requests if USING_REAL_DB else mem_get_requests
close_request_fn = db_close_request if USING_REAL_DB else mem_close_request
add_alert_fn = db_add_alert if USING_REAL_DB else mem_add_alert
get_alerts_fn = db_get_alerts if USING_REAL_DB else mem_get_alerts

def is_donor_eligible_90_days(last_date_str):
    """
    Checks the 90-day rest rule:
    Returns True if donor donated more than 90 days ago OR has never donated.
    Returns False if donor donated within the last 90 days.
    """
    if not last_date_str:
        return True
    try:
        last_date = datetime.strptime(str(last_date_str).strip(), "%Y-%m-%d").date()
        today = datetime.now().date()
        days_passed = (today - last_date).days
        return days_passed >= 90
    except Exception:
        return True

app = Flask(__name__)
CORS(app)

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "Blood Donor Finder API is running"}), 200

@app.route("/api/donors", methods=["POST"])
def register_donor():
    data = request.get_json(silent=True) or {}
    required = ["name", "blood_group", "area", "contact_preference"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"Missing required field: {field}"}), 400

    new_donor = {
        "name": str(data["name"]).strip(),
        "blood_group": str(data["blood_group"]).strip().upper(),
        "area": str(data["area"]).strip(),
        "contact_preference": str(data["contact_preference"]).strip(),
        "last_donation_date": (data.get("last_donation_date") or "").strip(),
        "is_visible": 1 if data.get("is_visible", True) in [True, 1, "1", "true", "True"] else 0,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude")
    }
    saved = add_donor_fn(new_donor)
    return jsonify(saved), 201

@app.route("/api/donors", methods=["GET"])
def list_donors():
    blood_group = request.args.get("blood_group")
    # In URLs, a '+' is often decoded as a space ('O ' instead of 'O+'). Fix that automatically!
    if blood_group:
        blood_group = blood_group.strip().replace(" ", "+").upper()
    area = request.args.get("area")

    all_donors = get_donors_fn(blood_group=blood_group, area=area)

    # Filter 1: Must be visible (is_visible == 1)
    # Filter 2: Must be eligible under 90-day rule
    visible_and_eligible = []
    for donor in all_donors:
        is_vis = donor.get("is_visible")
        if is_vis in [0, "0", False, "false"]:
            continue
        if not is_donor_eligible_90_days(donor.get("last_donation_date")):
            continue
        visible_and_eligible.append(donor)

    return jsonify(visible_and_eligible), 200

@app.route("/api/requests", methods=["POST"])
def create_request():
    data = request.get_json(silent=True) or {}
    required = ["blood_group", "hospital", "area", "units_needed", "contact"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"Missing required field: {field}"}), 400

    new_req = {
        "blood_group": str(data["blood_group"]).strip().upper(),
        "hospital": str(data["hospital"]).strip(),
        "area": str(data["area"]).strip(),
        "units_needed": int(data.get("units_needed", 1)),
        "contact": str(data["contact"]).strip(),
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude")
    }
    saved_req = add_request_fn(new_req)

    # Automatic Notification: Find all visible eligible donors and notify them
    all_donors = get_donors_fn()
    eligible_donors = [
        d for d in all_donors
        if d.get("is_visible") not in [0, "0", False, "false"]
        and is_donor_eligible_90_days(d.get("last_donation_date"))
    ]
    generate_alerts_for_request(saved_req, eligible_donors, add_alert_fn)

    return jsonify(saved_req), 201

@app.route("/api/requests", methods=["GET"])
def list_requests():
    reqs = get_requests_fn()
    return jsonify(reqs), 200

@app.route("/api/requests/<int:req_id>/close", methods=["PATCH"])
def close_request(req_id):
    closed = close_request_fn(req_id)
    if not closed:
        return jsonify({"error": f"Request with id {req_id} not found"}), 404
    return jsonify(closed), 200

@app.route("/api/alerts", methods=["GET"])
def list_alerts():
    alerts = get_alerts_fn()
    return jsonify(alerts), 200

if __name__ == "__main__":
    try:
        init_storage()
    except Exception as e:
        print(f"[Warning] Could not initialize DB storage: {e}")
    print("Starting Blood Donor Finder backend on http://127.0.0.1:5000 ...")
    app.run(host="127.0.0.1", port=5000, debug=True)
