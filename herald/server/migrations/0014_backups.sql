-- Automatic backups of this database (herald/backup): every night a GitHub Actions workflow of the private backups
-- repository exports it, encrypts it for the owner's key and reports here. Herald shows how the last ones went.
CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  -- 1 saved, 0 failed
  ok INTEGER NOT NULL,
  name TEXT,
  size INTEGER,
  sha256 TEXT,
  -- the release (or the failed run) on GitHub
  url TEXT,
  -- backups kept in the repository after this one
  kept INTEGER,
  error TEXT
);
CREATE INDEX backups_at ON backups (at);
