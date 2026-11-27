-- Schema for SW-11: Blood Donor Finder & Emergency Request Board

CREATE TABLE IF NOT EXISTS donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    blood_group TEXT NOT NULL,
    area TEXT NOT NULL,
    contact_preference TEXT,
    last_donation_date TEXT,
    is_visible INTEGER DEFAULT 1,
    latitude REAL,
    longitude REAL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blood_group TEXT NOT NULL,
    hospital TEXT NOT NULL,
    area TEXT NOT NULL,
    units_needed INTEGER NOT NULL,
    contact TEXT NOT NULL,
    status TEXT DEFAULT 'OPEN',
    latitude REAL,
    longitude REAL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    donor_name TEXT NOT NULL,
    blood_group TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT
);
