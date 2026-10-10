-- Catalogue (launcher 1.4, Patreon try-on): models and skins kept on Herald. An item is on Herald only (draft), shown in
-- the launchers (published) or taken out of them (hidden). Its sheet is JSON (src/shared/heraldCatalogue.ts).
CREATE TABLE catalogue_items (
  id TEXT PRIMARY KEY,
  sheet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  -- the files in use (0 = none yet)
  version INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  published_at INTEGER
);

-- Every version of an item's files is kept (a model updated on Patreon gets a new version). Big files are split in
-- parts (a D1 value is limited to 2 MB).
CREATE TABLE catalogue_files (
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  part INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  -- size and SHA-256 of the whole file (on part 0)
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (item_id, version, name, part)
);
