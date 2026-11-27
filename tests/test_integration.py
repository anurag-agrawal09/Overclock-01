import os
import sys
import json
from datetime import datetime, timedelta

# Add root folder to sys.path so we can test app directly
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app import app

def run_all_tests():
    print("=" * 65)
    print(" INTEGRATION TEST SUITE: BLOOD DONOR FINDER & REQUEST BOARD")
    print("=" * 65)
    passed = 0
    total = 7

    # Use Flask's in-process test_client (zero network/socket permissions required)
    client = app.test_client()

    # Test 1: Health check
    try:
        resp = client.get("/api/health")
        data = resp.get_json()
        assert resp.status_code == 200 and data.get("status") == "ok"
        print("[PASS] Test 1: /api/health returned OK status.")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 1: Health check failed: {e}")

    today = datetime.now().date()
    eligible_date = (today - timedelta(days=120)).strftime("%Y-%m-%d")
    recent_date = (today - timedelta(days=20)).strftime("%Y-%m-%d")

    # Test 2: Add eligible donor and verify visibility in search
    try:
        donor_payload = {
            "name": "Sarah Helper",
            "blood_group": "O+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0101",
            "last_donation_date": eligible_date,
            "is_visible": 1
        }
        resp = client.post("/api/donors", json=donor_payload)
        assert resp.status_code == 201

        search_resp = client.get("/api/donors", query_string={"blood_group": "O+", "area": "Downtown"})
        search_res = search_resp.get_json()
        names = [d["name"] for d in search_res]
        assert "Sarah Helper" in names
        print("[PASS] Test 2: Eligible donor (120 days ago) appears in search results.")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 2: Eligible donor check failed: {e}")

    # Test 3: 90-day eligibility check (donor donated 20 days ago must be HIDDEN)
    try:
        ineligible_payload = {
            "name": "Bob Resting",
            "blood_group": "O+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0102",
            "last_donation_date": recent_date,
            "is_visible": 1
        }
        resp = client.post("/api/donors", json=ineligible_payload)
        assert resp.status_code == 201

        search_resp = client.get("/api/donors", query_string={"blood_group": "O+", "area": "Downtown"})
        search_res = search_resp.get_json()
        names = [d["name"] for d in search_res]
        assert "Bob Resting" not in names
        print("[PASS] Test 3: 90-day rest rule works! (Donor from 20 days ago is hidden).")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 3: 90-day rule test failed: {e}")

    # Test 4: Hidden donor privacy (is_visible: false)
    try:
        hidden_payload = {
            "name": "Private Donor",
            "blood_group": "A+",
            "area": "Northside",
            "contact_preference": "SMS: 555-0199",
            "last_donation_date": eligible_date,
            "is_visible": False
        }
        resp = client.post("/api/donors", json=hidden_payload)
        assert resp.status_code == 201

        search_resp = client.get("/api/donors", query_string={"blood_group": "A+", "area": "Northside"})
        search_res = search_resp.get_json()
        names = [d["name"] for d in search_res]
        assert "Private Donor" not in names
        print("[PASS] Test 4: Hidden donor privacy works! (is_visible=False is hidden).")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 4: Hidden donor check failed: {e}")

    # Test 5: Post emergency request and verify auto-notifications
    created_req_id = None
    try:
        req_payload = {
            "blood_group": "O+",
            "hospital": "City Memorial Hospital",
            "area": "Downtown",
            "units_needed": 2,
            "contact": "Dr. Davis: 555-9999"
        }
        resp = client.post("/api/requests", json=req_payload)
        assert resp.status_code == 201
        created_req = resp.get_json()
        created_req_id = created_req["id"]

        alerts_resp = client.get("/api/alerts")
        alerts = alerts_resp.get_json()
        assert len(alerts) > 0
        alert_matches = [a for a in alerts if a.get("request_id") == created_req_id]
        assert len(alert_matches) > 0
        print("[PASS] Test 5: Emergency request triggers automated donor alerts.")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 5: Emergency request and alert check failed: {e}")

    # Test 6: Close emergency request
    try:
        if created_req_id:
            resp = client.patch(f"/api/requests/{created_req_id}/close")
            closed_req = resp.get_json()
            assert resp.status_code == 200 and closed_req.get("status") == "CLOSED"
            print("[PASS] Test 6: Emergency request closed/fulfilled successfully.")
            passed += 1
        else:
            print("[SKIP] Test 6 skipped because request creation failed.")
    except Exception as e:
        print(f"[FAIL] Test 6: Request closure failed: {e}")

    # Test 7: Compulsory Donor Eligibility & Protection (Age 18-65, DOB, Pincode, Weight, Password)
    try:
        # A. Underage registration (< 18) must fail with 400
        underage_resp = client.post("/api/donors", json={
            "name": "Underage Kid",
            "blood_group": "A+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0901",
            "dob": "2015-01-01", # ~11 years old
            "pincode": "226001",
            "password": "pass123",
            "weight": 55,
            "last_donation_date": eligible_date
        })
        assert underage_resp.status_code == 400
        assert "at least 18 years old" in underage_resp.get_json().get("error", "")

        # B. Over-age registration (> 65) must fail with 400
        overage_resp = client.post("/api/donors", json={
            "name": "Elderly Donor",
            "blood_group": "A+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0902",
            "dob": "1940-01-01", # > 80 years old
            "pincode": "226001",
            "password": "pass123",
            "weight": 55,
            "last_donation_date": eligible_date
        })
        assert overage_resp.status_code == 400
        assert "65 years old or younger" in overage_resp.get_json().get("error", "")

        # C. Invalid Pincode (< 6 digits) must fail with 400
        pin_resp = client.post("/api/donors", json={
            "name": "Bad Pin Donor",
            "blood_group": "A+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0903",
            "dob": "2000-01-01",
            "pincode": "123", # invalid
            "password": "pass123",
            "weight": 55,
            "last_donation_date": eligible_date
        })
        assert pin_resp.status_code == 400

        # D. Under-weight (< 50 kg) must fail with 400
        weight_resp = client.post("/api/donors", json={
            "name": "Low Weight Donor",
            "blood_group": "A+",
            "area": "Downtown",
            "contact_preference": "Call: 555-0904",
            "dob": "2000-01-01",
            "pincode": "226001",
            "password": "pass123",
            "weight": 42, # < 50 kg
            "last_donation_date": eligible_date
        })
        assert weight_resp.status_code == 400

        # E. Valid Donor registration (Age ~26, 60kg, 6-digit pin, password protected) must succeed
        valid_donor = client.post("/api/donors", json={
            "name": "Vikram Singh",
            "blood_group": "B+",
            "area": "Hazratganj, Lucknow",
            "contact_preference": "9876500001",
            "dob": "1998-05-15",
            "pincode": "226001",
            "password": "securePass456",
            "weight": 65,
            "health_verified": 1,
            "last_donation_date": eligible_date
        })
        assert valid_donor.status_code == 201

        # F. Password Protection on Login: wrong password must be rejected (401)
        bad_login = client.post("/api/auth/login", json={
            "role": "donor",
            "identifier": "9876500001",
            "password": "wrongPassword"
        })
        assert bad_login.status_code == 401

        # G. Correct password must log in successfully (200)
        good_login = client.post("/api/auth/login", json={
            "role": "donor",
            "identifier": "9876500001",
            "password": "securePass456"
        })
        assert good_login.status_code == 200
        assert good_login.get_json()["name"] == "Vikram Singh"

        print("[PASS] Test 7: Compulsory donor eligibility & password protection strictly verified!")
        passed += 1
    except Exception as e:
        print(f"[FAIL] Test 7: Eligibility & password validation failed: {e}")

    print("=" * 65)
    print(f" RESULT: {passed}/{total} tests passed.")
    if passed == total:
        print(" ALL SYSTEMS GREEN! Ready for Member 4 & team demo check.")
    else:
        print(" Some tests failed.")
    print("=" * 65)

if __name__ == "__main__":
    run_all_tests()
