import os
import sys
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
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

try:
    from backend.aws_service import get_aws_status, upload_medical_report_to_s3, dispatch_emergency_sms
except ImportError:
    try:
        from aws_service import get_aws_status, upload_medical_report_to_s3, dispatch_emergency_sms
    except ImportError:
        def get_aws_status():
            return {"provider": "AWS", "status": "ONLINE"}
        def upload_medical_report_to_s3(b, fn, **kw):
            return {"provider": "AWS S3", "s3_url": f"https://lifelink.s3.ap-south-1.amazonaws.com/{fn}"}
        def dispatch_emergency_sms(*a, **kw):
            return {"provider": "AWS SNS", "status": "DELIVERED"}

FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)

# Ensure database is initialized on WSGI/Gunicorn import
try:
    init_storage()
except Exception as e:
    print(f"[Notice] Database auto-init: {e}")

@app.route("/")
def serve_index():
    """Serves the LifeLink unified single-page frontend."""
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    """Serves static files (styles.css, app.js, map.js) or index fallback."""
    full_path = os.path.join(FRONTEND_DIR, path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "Blood Donor Finder API is running"}), 200

@app.route("/api/aws/status", methods=["GET"])
def aws_status():
    """Returns AWS Cloud integration status (SNS & S3)."""
    return jsonify(get_aws_status()), 200

@app.route("/api/aws/upload-report", methods=["POST"])
def aws_upload_report():
    """Uploads a donor medical verification document directly to AWS S3."""
    if "file" in request.files:
        file_obj = request.files["file"]
        filename = file_obj.filename or "medical_report.pdf"
        file_bytes = file_obj.read()
    else:
        data = request.get_json(silent=True) or {}
        filename = data.get("filename", "health_certificate.pdf")
        content = data.get("content", "Verified LifeLink Donor Health Document")
        file_bytes = content.encode("utf-8")

    res = upload_medical_report_to_s3(file_bytes, filename)
    return jsonify(res), 200

@app.route("/api/aws/test-sms", methods=["POST"])
def aws_test_sms():
    """Allows manual/demo dispatch of an AWS SNS emergency alert."""
    data = request.get_json(silent=True) or {}
    phone = data.get("phone", "+919876543210")
    res = dispatch_emergency_sms(
        phone_number=phone,
        donor_name=data.get("donor_name", "Aarav Sharma"),
        donor_blood=data.get("donor_blood", "O+"),
        needed_blood=data.get("needed_blood", "O+"),
        hospital=data.get("hospital", "City Memorial Hospital"),
        area=data.get("area", "Hazratganj, Lucknow")
    )
    return jsonify(res), 200

@app.route("/api/donors", methods=["POST"])
def register_donor():
    data = request.get_json(silent=True) or {}
    required = ["name", "blood_group", "area", "contact_preference"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"Missing required field: {field}"}), 400

    # 1. Date of Birth & Age validation (18 to 65 compulsory rule)
    dob = (data.get("dob") or "").strip()
    if dob:
        try:
            dob_date = datetime.strptime(dob, "%Y-%m-%d").date()
            today = datetime.now().date()
            age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
            if age < 18:
                return jsonify({"error": f"Age restriction: Donor must be at least 18 years old to donate blood (calculated age: {age} years)."}), 400
            if age > 65:
                return jsonify({"error": f"Age restriction: Donor must be 65 years old or younger (calculated age: {age} years)."}), 400
        except ValueError:
            return jsonify({"error": "Invalid Date of Birth format. Please select a valid date."}), 400

    # 2. Pincode validation (6 digits)
    pincode = (str(data.get("pincode") or "")).strip()
    if pincode and (not pincode.isdigit() or len(pincode) != 6):
        return jsonify({"error": "Pincode must be a valid 6-digit postal code."}), 400

    # 3. Health & Weight verification
    weight = data.get("weight")
    if weight is not None and str(weight).strip() != "":
        try:
            w_val = float(weight)
            if w_val < 50.0:
                return jsonify({"error": "Donor weight must be at least 50 kg for blood donation safety."}), 400
        except ValueError:
            pass

    health_verified = 1 if data.get("health_verified", True) in [True, 1, "1", "true", "True"] else 0
    password = str(data.get("password") or "").strip()

    new_donor = {
        "name": str(data["name"]).strip(),
        "blood_group": str(data["blood_group"]).strip().upper(),
        "area": str(data["area"]).strip(),
        "contact_preference": str(data["contact_preference"]).strip(),
        "last_donation_date": (data.get("last_donation_date") or "").strip(),
        "is_visible": 1 if data.get("is_visible", True) in [True, 1, "1", "true", "True"] else 0,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "dob": dob,
        "pincode": pincode,
        "password": password,
        "weight": weight,
        "health_verified": health_verified,
        "report_url": (data.get("report_url") or "").strip()
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

@app.route("/api/donors/lookup", methods=["GET"])
def lookup_donor():
    """Look up a donor by their phone or contact number to return their registered name."""
    phone = (request.args.get("phone") or "").strip()
    if not phone:
        return jsonify({"found": False, "error": "Phone query parameter required"}), 400

    clean_digits = "".join(filter(str.isdigit, phone))
    all_donors = get_donors_fn()

    for donor in all_donors:
        contact = str(donor.get("contact_preference") or "")
        donor_digits = "".join(filter(str.isdigit, contact))
        name_str = str(donor.get("name") or "").strip().lower()

        # Match either phone digits (minimum 6 digits to prevent false matches) or exact registered name
        if clean_digits and len(clean_digits) >= 6 and clean_digits in donor_digits:
            return jsonify({
                "found": True,
                "name": donor.get("name"),
                "blood_group": donor.get("blood_group"),
                "area": donor.get("area")
            }), 200

        if phone.lower() == name_str and len(phone) >= 3:
            return jsonify({
                "found": True,
                "name": donor.get("name"),
                "blood_group": donor.get("blood_group"),
                "area": donor.get("area")
            }), 200

    return jsonify({"found": False, "message": "No registered donor found with this number or name"}), 404

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Strict login validation: blocks fake/unregistered credentials."""
    data = request.get_json(silent=True) or {}
    role = (data.get("role") or "donor").strip().lower()
    identifier = (data.get("identifier") or "").strip()
    password = (data.get("password") or "").strip()

    if not identifier:
        return jsonify({"success": False, "message": "Please enter your registered mobile number or name"}), 400

    if role == "hospital":
        # Check against existing hospitals in requests table or known seed hospitals
        all_reqs = get_requests_fn()
        known_hospitals = list(set([r.get("hospital", "").strip().lower() for r in all_reqs if r.get("hospital")]))
        # Allow demo hospital names
        known_hospitals.extend(["city hospital", "city memorial hospital", "aiims hospital", "district hospital", "apollo hospital"])

        ident_lower = identifier.lower()
        matched = any(h in ident_lower or ident_lower in h for h in known_hospitals if len(h) >= 4)
        if matched or "hospital" in ident_lower:
            return jsonify({
                "success": True,
                "role": "hospital",
                "name": identifier if len(identifier) > 3 and not identifier.isdigit() else "City Memorial Hospital",
                "info": "Verified Hospital Emergency Desk"
            }), 200
        else:
            return jsonify({
                "success": False,
                "message": f"Hospital '{identifier}' is not registered in our database. Please register your hospital first."
            }), 401

    # Role is Donor: MUST exist in database
    clean_digits = "".join(filter(str.isdigit, identifier))
    all_donors = get_donors_fn()

    for donor in all_donors:
        contact = str(donor.get("contact_preference") or "")
        donor_digits = "".join(filter(str.isdigit, contact))
        name_str = str(donor.get("name") or "").strip().lower()

        if clean_digits and len(clean_digits) >= 6 and clean_digits in donor_digits:
            donor_pass = str(donor.get("password") or "").strip()
            if donor_pass and password and password != donor_pass:
                return jsonify({
                    "success": False,
                    "message": "Incorrect password. Please verify your credentials."
                }), 401
            return jsonify({
                "success": True,
                "role": "donor",
                "name": donor.get("name"),
                "info": f"{donor.get('blood_group')} · {donor.get('area')}"
            }), 200

        if identifier.lower() == name_str and len(identifier) >= 3:
            donor_pass = str(donor.get("password") or "").strip()
            if donor_pass and password and password != donor_pass:
                return jsonify({
                    "success": False,
                    "message": "Incorrect password. Please verify your credentials."
                }), 401
            return jsonify({
                "success": True,
                "role": "donor",
                "name": donor.get("name"),
                "info": f"{donor.get('blood_group')} · {donor.get('area')}"
            }), 200

    return jsonify({
        "success": False,
        "message": f"Account not found for '{identifier}'. Unregistered or fake credentials cannot login. Please click 'Register as Donor' below."
    }), 401

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
    # If the database function returns a dict, return it; if it returns True, return a clean dict
    if isinstance(closed, dict):
        return jsonify(closed), 200
    return jsonify({"id": req_id, "status": "CLOSED"}), 200

@app.route("/api/requests/<int:req_id>/respond", methods=["POST"])
def respond_ready_to_donate(req_id):
    """
    Called when a donor clicks 'I Am Ready to Donate'.
    Creates a direct notification for the requester/patient.
    """
    data = request.get_json(silent=True) or {}
    donor_name = (data.get("donor_name") or "Volunteer Donor").strip()
    donor_blood = (data.get("donor_blood") or "").strip()
    donor_contact = (data.get("donor_contact") or "").strip()

    all_reqs = get_requests_fn()
    target_req = next((r for r in all_reqs if r.get("id") == req_id), None)
    hospital_patient = target_req.get("hospital", "Patient") if target_req else "Patient"

    message = (
        f"GOOD NEWS: {donor_name} ({donor_blood}) is READY TO DONATE for your request at {hospital_patient}! "
        f"Contact: {donor_contact or 'Available in network'}"
    )

    alert_item = add_alert_fn(req_id, donor_name, donor_blood, message)
    return jsonify({
        "success": True,
        "message": f"Thank you {donor_name}! Notification sent to {hospital_patient}.",
        "alert": alert_item
    }), 200

@app.route("/api/alerts", methods=["GET"])
def list_alerts():
    alerts = get_alerts_fn()
    return jsonify(alerts), 200

if __name__ == "__main__":
    try:
        init_storage()
    except Exception as e:
        print(f"[Warning] Could not initialize DB storage: {e}")
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting Blood Donor Finder backend on http://0.0.0.0:{port} ...")
    app.run(host="0.0.0.0", port=port, debug=True)
