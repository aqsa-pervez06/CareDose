CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('doctor', 'nurse'))
);

CREATE TABLE IF NOT EXISTS residents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 0),
  room TEXT NOT NULL,
  allergy TEXT,
  UNIQUE (name, room)
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents(id),
  drug_name TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL,
  stock_left INTEGER NOT NULL CHECK (stock_left >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (resident_id, drug_name, time_of_day)
);

CREATE TABLE IF NOT EXISTS doses (
  id INTEGER PRIMARY KEY,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  dose_date TEXT NOT NULL,
  dose_time TEXT NOT NULL,
  scheduled_time TEXT NOT NULL DEFAULT '08:00',
  status TEXT NOT NULL DEFAULT 'pending',
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
