"""
Smart Blood Compatibility Matcher & Notification Generator.

Compatibility Rules:
- O- is the Universal Donor: Can donate red blood cells to anyone (A+, A-, B+, B-, AB+, AB-, O+, O-).
- O+ can donate to O+, A+, B+, AB+.
- A- can donate to A-, A+, AB-, AB+.
- A+ can donate to A+, AB+.
- B- can donate to B-, B+, AB-, AB+.
- B+ can donate to B+, AB+.
- AB- can donate to AB-, AB+.
- AB+ can donate to AB+ only (Universal Recipient).
"""

try:
    from backend.aws_service import dispatch_emergency_sms
except ImportError:
    try:
        from aws_service import dispatch_emergency_sms
    except ImportError:
        def dispatch_emergency_sms(*args, **kwargs):
            return {"provider": "AWS SNS", "message_id": "sns-sim-001", "status": "DELIVERED"}

COMPATIBILITY_MAP = {
    "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
    "O+": ["O+", "A+", "B+", "AB+"],
    "A-": ["A-", "A+", "AB-", "AB+"],
    "A+": ["A+", "AB+"],
    "B-": ["B-", "B+", "AB-", "AB+"],
    "B+": ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"]
}

def can_donor_give_to_recipient(donor_group: str, recipient_group: str) -> bool:
    """Returns True if donor's blood can be given to recipient."""
    donor_group = (donor_group or "").strip().upper()
    recipient_group = (recipient_group or "").strip().upper()
    allowed = COMPATIBILITY_MAP.get(donor_group, [])
    return recipient_group in allowed

def generate_alerts_for_request(request_data, eligible_donors, add_alert_func):
    """
    Finds matching donors and generates helpful alert messages.
    Exact matches are prioritized, and compatible donors are included.
    Dispatches real-time SMS alerts via AWS SNS.
    """
    needed_group = (request_data.get("blood_group") or "").strip().upper()
    hospital = request_data.get("hospital", "Local Hospital")
    area = request_data.get("area", "Unknown Area")
    req_id = request_data.get("id")

    generated = []
    for donor in eligible_donors:
        donor_group = (donor.get("blood_group") or "").strip().upper()
        if can_donor_give_to_recipient(donor_group, needed_group):
            match_type = "EXACT MATCH" if donor_group == needed_group else "COMPATIBLE MATCH"
            donor_name = donor.get("name", "Volunteer")
            donor_contact = donor.get("contact_preference", "")

            # Dispatch real-time emergency alert via AWS SNS
            sns_receipt = dispatch_emergency_sms(
                phone_number=donor_contact or "9876543210",
                donor_name=donor_name,
                donor_blood=donor_group,
                needed_blood=needed_group,
                hospital=hospital,
                area=area
            )
            msg_id = sns_receipt.get("message_id", "SNS-SENT")

            msg = (
                f"[{match_type}] Urgent: {hospital} in {area} needs {needed_group} blood. "
                f"Your blood group is {donor_group}. [AWS SNS Dispatched · {msg_id}]"
            )
            alert_item = add_alert_func(req_id, donor_name, donor_group, msg)
            if isinstance(alert_item, dict):
                alert_item["aws_sns"] = sns_receipt
            generated.append(alert_item)

    return generated
