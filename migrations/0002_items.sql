CREATE TABLE IF NOT EXISTS card_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  effect_type  TEXT    NOT NULL,
  effect_value INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

-- Player card inventory; used_at NULL = still available
CREATE TABLE IF NOT EXISTS user_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  acquired_at INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);

-- Battle pass reward calendar (admin-configurable per month+day)
CREATE TABLE IF NOT EXISTS battle_pass_rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  month       INTEGER NOT NULL,
  day         INTEGER NOT NULL,
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  quantity    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(month, day)
);

-- Per-user daily login progress (resets each month)
CREATE TABLE IF NOT EXISTS battle_pass_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  current_month   INTEGER NOT NULL,
  claimed_days    TEXT    NOT NULL DEFAULT '[]',
  last_claim_date TEXT
);
