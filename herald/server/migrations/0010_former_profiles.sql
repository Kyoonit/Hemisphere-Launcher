-- Profiles deleted for good (only revoked ones can be): their name stays for the journal, nothing else is kept
CREATE TABLE former_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
