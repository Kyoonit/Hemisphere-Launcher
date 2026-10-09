-- Phase S6: every change of the feed parts edited in the Server tab (maintenances, daily restart), kept forever.
CREATE TABLE settings_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  action TEXT NOT NULL,
  by TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX settings_versions_key ON settings_versions (key, at);
