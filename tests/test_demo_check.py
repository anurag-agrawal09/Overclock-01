import os
import sys

def show_demo_readiness():
    GREEN = "\033[92m"
    CYAN = "\033[96m"
    YELLOW = "\033[93m"
    RESET = "\033[0m"

    print(f"""
{CYAN}======================================================================
     OVERCLOCK HACKATHON - DEMO READINESS & 2-MINUTE SPEAKING SCRIPT
     Project: SW-11 Blood Donor Finder & Emergency Request Board
======================================================================{RESET}
{GREEN}
  [✔] BASIC GOAL: Donor registration & search with visibility filter.
  [✔] BASIC GOAL: Emergency request board with open/closed status.
  [✔] ADVANCED GOAL: 90-Day rest eligibility check (auto-hides recent donors).
  [✔] ADVANCED GOAL: Automatic smart alerts on new emergency requests.
  [✔] ADVANCED GOAL: Interactive Leaflet Map for visual pins.
  [✔] STANDOUT FEATURE: Universal blood compatibility matching & SOS copy button.
{RESET}

{YELLOW}----------------------------------------------------------------------
  2-MINUTE JUDGES DEMO SCRIPT (PASS THE MIC TO EACH MEMBER!)
----------------------------------------------------------------------{RESET}

{CYAN}1. Member 1 (Leader & Backend - 30 seconds):{RESET}
   "Hello Judges! In medical emergencies, every minute counts. We built the
   Blood Donor Finder to instantly match patients with nearby donors. I led our
   team architecture and built our Python Flask backend, including a 90-day
   medical eligibility rule that protects donor health."

{CYAN}2. Member 2 (Frontend - 30 seconds):{RESET}
   "I created our clean, responsive user interface using HTML, CSS, JavaScript,
   and Leaflet OpenStreetMap. Families can view nearby donors, post emergency
   SOS alerts, and copy a one-click WhatsApp SOS message to share with contacts."

{CYAN}3. Member 3 (Database - 30 seconds):{RESET}
   "I designed our SQLite database schema storing donors, emergency requests,
   and alert logs. I also built a seed dataset with real hospital locations so
   our application runs with realistic data out-of-the-box."

{CYAN}4. Member 4 (Testing & Integration - 30 seconds):{RESET}
   "I built our automated integration test suite that tests all 6 core API flows
   in seconds, ensuring that medical privacy and the 90-day rest rule pass
   reliably with zero bugs before our deadline!"

{GREEN}======================================================================
  YOU ARE 100% READY TO WIN! GOOD LUCK TEAM!
======================================================================{RESET}
""")

if __name__ == "__main__":
    show_demo_readiness()
