-- Phase S2: just what the end-to-end test needs. The full schema (profiles, publications…) comes with S4.

-- One row: the last published sequence (launchers refuse anything older)
CREATE TABLE publish_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sequence INTEGER NOT NULL,
  commit_sha TEXT,
  updated_at TEXT NOT NULL
);

-- Vault keys, wrapped with the VAULT_MASTER secret; given out only from opens_at
CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  opens_at INTEGER NOT NULL,
  key_wrapped TEXT NOT NULL,
  released_at INTEGER
);
