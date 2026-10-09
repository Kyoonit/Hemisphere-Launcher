-- Go-live (S12): everything published is sealed. Content keys seal the feed and the mod pack index; given to
-- launchers only once published, refused 15 minutes after being replaced (old copies in the history stay closed).
CREATE TABLE content_keys (
  id TEXT PRIMARY KEY,
  -- feed | pack
  kind TEXT NOT NULL,
  key_wrapped TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  retired_at INTEGER
);
CREATE INDEX content_keys_kind ON content_keys (kind, published_at);

-- A vault no longer in the published feed (its item removed, or opened and now in the feed): key refused after a while
ALTER TABLE vaults ADD COLUMN revoked_at INTEGER;

-- The keys a job uses ({feed, pack?}) and the vaults its feed lists (to revoke the others once it is published)
ALTER TABLE publish_jobs ADD COLUMN keys TEXT;
ALTER TABLE publish_jobs ADD COLUMN vault_ids TEXT;
