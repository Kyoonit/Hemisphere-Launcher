-- Phase S4: staff profiles, sessions, the shared activity journal.
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,          -- lower-case name, for sign-in
  role TEXT NOT NULL,
  perms_add TEXT NOT NULL DEFAULT '[]',   -- JSON arrays of permission names
  perms_remove TEXT NOT NULL DEFAULT '[]',
  code_hash TEXT NOT NULL,                -- HMAC-SHA-256(CODE_PEPPER, code): the code itself is never stored
  revoked_at INTEGER,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,            -- SHA-256 of the session token: a database dump opens no session
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_profile ON sessions (profile_id);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  profile_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX activity_at ON activity (at);
