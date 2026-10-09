-- Phase S3: the schema 2 state. The server keeps the last feed it asked to publish (vault entries included, keys not)
-- so that the minute task can republish it with the keys of the vaults that just opened (fallback for launchers that
-- could not reach the server at the opening time).
CREATE TABLE feed_v2_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  feed TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE vaults ADD COLUMN kind TEXT;
