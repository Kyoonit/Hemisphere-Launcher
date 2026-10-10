-- Catalogue in the launchers (launcher 1.4, step 3c). Players prove their Minecraft account (Mojang's hasJoined);
-- each one has a tag hidden in the textures they receive, so a texture found elsewhere says who it was given to.
CREATE TABLE catalogue_players (
  -- Minecraft profile id (32 hex digits) and its name when last seen
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- the mark in their textures (16 hex digits)
  tag TEXT NOT NULL UNIQUE,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  -- blocked by staff (a leak): nothing more from the catalogue, kept copies stop opening when their access ends
  blocked_at INTEGER,
  blocked_by TEXT
);

-- Which player received which item, and when (last time)
CREATE TABLE catalogue_deliveries (
  uuid TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (uuid, item_id, version)
);
CREATE INDEX catalogue_deliveries_item ON catalogue_deliveries (item_id);

-- An item version made ready for delivery once (model read, texture pixels), before each player's mark. JSON in parts.
CREATE TABLE catalogue_bundles (
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  part INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (item_id, version, part)
);
