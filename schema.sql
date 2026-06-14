-- Esquema de la base de datos D1 para el salon de la fama de WAR
CREATE TABLE IF NOT EXISTS scores (
  name       TEXT PRIMARY KEY,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scores_wins ON scores (wins DESC);
