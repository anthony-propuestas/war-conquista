DROP TABLE IF EXISTS scores;

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sub        TEXT UNIQUE NOT NULL,
  username   TEXT UNIQUE NOT NULL COLLATE NOCASE,
  age        INTEGER NOT NULL,
  email      TEXT NOT NULL,
  how_heard  TEXT NOT NULL,
  wins       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(wins DESC);
