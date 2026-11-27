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
    total = 6

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

    print("=" * 65)
    print(f" RESULT: {passed}/{total} tests passed.")
    if passed == total:
        print(" ALL SYSTEMS GREEN! Ready for Member 4 & team demo check.")
    else:
        print(" Some tests failed.")
    print("=" * 65)

if __name__ == "__main__":
    run_all_tests()
