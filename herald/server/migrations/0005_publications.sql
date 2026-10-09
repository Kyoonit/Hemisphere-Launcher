-- Phase S5: publications (news, banners, welcome messages), their history, comments, images, published files.
CREATE TABLE publications (
  id TEXT PRIMARY KEY,                    -- also the item id in the feed (n-…, b-…, w-…)
  kind TEXT NOT NULL,
  status TEXT NOT NULL,                   -- draft | review | ready
  data TEXT NOT NULL,                     -- JSON PublicationData being edited
  published TEXT,                         -- JSON PublicationData in the feed (NULL = not online)
  published_at INTEGER,
  published_by TEXT,
  version INTEGER NOT NULL,               -- +1 on every change (stale saves are refused)
  editing_by TEXT,                        -- soft lock: who has it open in the editor, until when
  editing_until INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                     -- trash: never erased
  deleted_by TEXT
);
CREATE INDEX publications_updated ON publications (updated_at);

-- Every saved version, forever (history)
CREATE TABLE publication_versions (
  publication_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  action TEXT NOT NULL,                   -- create, save, status, publish, unpublish, delete, restore
  by TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (publication_id, version)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX comments_publication ON comments (publication_id);

-- Uploaded pictures (WebP from the app, at most 1.5 MB: one row each). id = SHA-256 of the file.
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  sha512 TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- Files a publish job writes next to the feed (vault files, pictures), fetched by the publisher by path
CREATE TABLE content_files (
  path TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  sha512 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Feed parts Herald does not edit yet, and other settings (JSON)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

-- A vault is reused while its item, content and opening time do not change (no new file at every publish)
ALTER TABLE vaults ADD COLUMN item_key TEXT;
ALTER TABLE vaults ADD COLUMN plain_sha256 TEXT;
ALTER TABLE vaults ADD COLUMN listing TEXT;
CREATE INDEX vaults_item ON vaults (item_key);

-- Who asked for a publish job (shown in Herald)
ALTER TABLE publish_jobs ADD COLUMN requested_by TEXT;
ALTER TABLE publish_jobs ADD COLUMN reason TEXT;
