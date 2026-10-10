-- Server statistics (Herald stats panel): collected every minute by the cron, from the game's server list ping and
-- BlueMap's public live data. Nothing is installed on the Minecraft server.

-- One row per minute: was the server answering, how many players
CREATE TABLE server_samples (
  -- the minute (ms, rounded down)
  at INTEGER PRIMARY KEY,
  -- 1 the server answered, 0 it did not
  online INTEGER NOT NULL,
  players INTEGER,
  max_players INTEGER,
  -- from Cloudflare to the server (connection time)
  latency_ms INTEGER,
  version TEXT,
  -- where the names came from: 'bluemap' (everyone), 'ping' (the server's sample, maybe not everyone), null (none)
  names TEXT
);

-- Who is online now and since when (one row; the sessions are written when they end)
CREATE TABLE stats_presence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- A player's visit: from the first minute seen to the last (+1)
CREATE TABLE player_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Minecraft profile id (32 hex digits) and its name then
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  -- minutes in each dimension (when BlueMap said where)
  overworld INTEGER NOT NULL DEFAULT 0,
  nether INTEGER NOT NULL DEFAULT 0,
  end_minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX player_sessions_started ON player_sessions (started_at);
CREATE INDEX player_sessions_uuid ON player_sessions (uuid, started_at);

-- Every player ever seen: first and last time, totals of the ended sessions
CREATE TABLE stats_players (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX stats_players_first ON stats_players (first_seen);
