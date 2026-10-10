-- The daily restart as it really happens: around the scheduled time the Herald server checks the Minecraft server
-- every few seconds and notes when it went down and when it answered again (restartWatch.ts).
CREATE TABLE restart_observations (
  -- the scheduled restart (ms)
  scheduled_at INTEGER PRIMARY KEY,
  -- the daily time then, in its time zone
  time TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  down_at INTEGER,
  up_at INTEGER,
  checked_until INTEGER NOT NULL
);
