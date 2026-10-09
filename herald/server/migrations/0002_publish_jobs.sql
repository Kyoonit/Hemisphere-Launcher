-- Plan A (S2): GitHub Actions signs and commits; the server only queues what to publish.
-- The publisher takes the newest queued job (older queued ones are superseded: it publishes the latest state).
CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'publishing', 'done', 'failed', 'superseded')),
  sequence INTEGER,
  commit_sha TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX publish_jobs_status ON publish_jobs (status, created_at);
