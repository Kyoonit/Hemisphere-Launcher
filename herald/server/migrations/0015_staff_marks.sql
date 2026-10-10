-- The original files downloaded from Herald (permission catalogue.export) carry a mark of the staff member who
-- downloaded them, like the players' copies: a texture found elsewhere says whose download it came from.
CREATE TABLE catalogue_staff_marks (
  profile_id TEXT PRIMARY KEY,
  -- the mark in their downloads (16 hex digits), never a player's
  tag TEXT NOT NULL UNIQUE,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);
