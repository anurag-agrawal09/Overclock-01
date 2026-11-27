from datetime import datetime, timedelta

try:
    from database.db import (
        DB_PATH,
        _get_connection,
        add_donor,
        add_request,
        get_donors,
        get_requests,
        init_db,
    )
except ImportError:
    from db import (
        DB_PATH,
        _get_connection,
        add_donor,
        add_request,
        get_donors,
        get_requests,
        init_db,
    )


def _days_ago(days):
    """Return a YYYY-MM-DD date string for N days before today."""
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")


def seed():
    """Populate the database with 10 realistic demo donors and 3 emergency requests."""
    init_db()

    # Clear existing demo rows so re-running this script stays clean.
    with _get_connection() as conn:
        conn.execute("DELETE FROM alerts")
        conn.execute("DELETE FROM requests")
        conn.execute("DELETE FROM donors")

    demo_donors = [
        # 2 donors who donated 30 days ago (ineligible under 90-day rule)
        {
            "name": "Aarav Sharma",
            "blood_group": "O+",
            "area": "Indiranagar",
            "contact_preference": "Phone: +91-9876543201",
            "last_donation_date": _days_ago(30),
            "is_visible": 1,
            "latitude": 12.9784,
            "longitude": 77.6408,
        },
        {
            "name": "Priya Nair",
            "blood_group": "A+",
            "area": "Koramangala",
            "contact_preference": "WhatsApp: +91-9876543202",
            "last_donation_date": _days_ago(30),
            "is_visible": 1,
            "latitude": 12.9352,
            "longitude": 77.6245,
        },
        # 2 hidden donors (is_visible = 0 to prove privacy works)
        {
            "name": "Rohan Verma",
            "blood_group": "O-",
            "area": "Jayanagar",
            "contact_preference": "Email: rohan.v@example.com",
            "last_donation_date": _days_ago(140),
            "is_visible": 0,
            "latitude": 12.9250,
            "longitude": 77.5938,
        },
        {
            "name": "Sneha Kulkarni",
            "blood_group": "B-",
            "area": "Malleshwaram",
            "contact_preference": "Phone: +91-9876543204",
            "last_donation_date": _days_ago(180),
            "is_visible": 0,
            "latitude": 13.0031,
            "longitude": 77.5643,
        },
        # 6 visible & eligible donors spread across the city
        {
            "name": "Vikram Reddy",
            "blood_group": "B+",
            "area": "Whitefield",
            "contact_preference": "Phone: +91-9876543205",
            "last_donation_date": _days_ago(120),
            "is_visible": 1,
            "latitude": 12.9698,
            "longitude": 77.7500,
        },
        {
            "name": "Ananya Iyer",
            "blood_group": "AB+",
            "area": "HSR Layout",
            "contact_preference": "WhatsApp: +91-9876543206",
            "last_donation_date": _days_ago(200),
            "is_visible": 1,
            "latitude": 12.9121,
            "longitude": 77.6446,
        },
        {
            "name": "Karthik Rao",
            "blood_group": "O-",
            "area": "Hebbal",
            "contact_preference": "Phone: +91-9876543207",
            "last_donation_date": _days_ago(110),
            "is_visible": 1,
            "latitude": 13.0358,
            "longitude": 77.5970,
        },
        {
            "name": "Meera Menon",
            "blood_group": "A-",
            "area": "BTM Layout",
            "contact_preference": "Email: meera.m@example.com",
            "last_donation_date": _days_ago(160),
            "is_visible": 1,
            "latitude": 12.9166,
            "longitude": 77.6101,
        },
        {
            "name": "Arjun Das",
            "blood_group": "O+",
            "area": "Marathahalli",
            "contact_preference": "WhatsApp: +91-9876543209",
            "last_donation_date": _days_ago(95),
            "is_visible": 1,
            "latitude": 12.9591,
            "longitude": 77.6974,
        },
        {
            "name": "Divya Patel",
            "blood_group": "AB-",
            "area": "Rajajinagar",
            "contact_preference": "Phone: +91-9876543210",
            "last_donation_date": None,
            "is_visible": 1,
            "latitude": 12.9982,
            "longitude": 77.5530,
        },
    ]

    demo_requests = [
        {
            "blood_group": "O+",
            "hospital": "Manipal Hospital",
            "area": "Indiranagar",
            "units_needed": 2,
            "contact": "+91-80-25024444",
            "status": "OPEN",
            "latitude": 12.9592,
            "longitude": 77.6480,
        },
        {
            "blood_group": "O-",
            "hospital": "St. John's Medical College Hospital",
            "area": "Koramangala",
            "units_needed": 1,
            "contact": "+91-80-22065000",
            "status": "OPEN",
            "latitude": 12.9296,
            "longitude": 77.6205,
        },
        {
            "blood_group": "B+",
            "hospital": "Apollo Hospital",
            "area": "Jayanagar",
            "units_needed": 3,
            "contact": "+91-80-26304050",
            "status": "OPEN",
            "latitude": 12.9177,
            "longitude": 77.5934,
        },
    ]

    for donor in demo_donors:
        add_donor(donor)

    for req in demo_requests:
        add_request(req)

    donors = get_donors()
    requests = get_requests()
    print(f"Database ready at: {DB_PATH}")
    print(f"Inserted {len(donors)} demo donors and {len(requests)} emergency requests.")


if __name__ == "__main__":
    seed()
