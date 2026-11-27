# SW-11: Blood Donor Finder & Emergency Request Board

A web application where volunteer blood donors register and hospitals/families can post emergency requests and find matching donors nearby.

## Project Structure
- `backend/`: Flask REST API and smart notification logic (Leader / Member 1)
- `frontend/`: Interactive UI with Leaflet OpenStreetMap and SOS messaging (Member 2)
- `database/`: SQLite schema, database helper functions, and demo seed data (Member 3)
- `tests/`: Automated integration tests and 2-minute demo readiness check (Member 4)

## Quick Start (One Command)
```bash
python start.py
```
This initializes the database, starts the backend on `http://127.0.0.1:5000`, and opens `frontend/index.html` in your web browser.

## Running Tests
```bash
python tests/test_integration.py
python tests/test_demo_check.py
```
