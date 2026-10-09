-- Phase S10: changes of the mod pack. One member proposes (the whole next manifest, built in Herald from Modrinth),
-- ANOTHER member approves, then every publish job carries it until GitHub Actions has published it.
CREATE TABLE pack_proposals (
  id TEXT PRIMARY KEY,
  -- proposed | approved | published | rejected | withdrawn | replaced | failed
  status TEXT NOT NULL,
  client_version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  -- the online pack it starts from: {sequence, clientVersion, sha512}
  based_on TEXT NOT NULL,
  previous_can_join INTEGER NOT NULL,
  note TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  proposed_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  -- why it was rejected, or why publishing it failed
  decision_note TEXT,
  commit_sha TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX pack_proposals_status ON pack_proposals (status, proposed_at);

-- The approved pack a publish job carries (marked published when the job is done)
ALTER TABLE publish_jobs ADD COLUMN pack_id TEXT;
