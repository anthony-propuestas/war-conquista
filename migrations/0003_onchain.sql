-- Wins por mes (fuente de verdad para el reclamo mensual de WGT)
CREATE TABLE IF NOT EXISTS user_monthly_wins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  year_month  TEXT    NOT NULL,    -- formato "2026-06"
  wins        INTEGER NOT NULL DEFAULT 0,
  claimed_at  INTEGER,             -- NULL = aún no reclamado
  UNIQUE(user_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_wins_user ON user_monthly_wins(user_id);

-- Items de tienda: almacenamiento horizontal (una fila por tipo por jugador)
CREATE TABLE IF NOT EXISTS user_shop_items (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  quantity    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_def_id)
);

-- Evitar que el Worker entregue dos veces el mismo txHash
CREATE TABLE IF NOT EXISTS delivered_txs (
  tx_hash      TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  delivered_at INTEGER NOT NULL
);

-- Items iniciales de la tienda en card_definitions
INSERT OR IGNORE INTO card_definitions (id, name, description, effect_type, effect_value, is_active, created_at)
VALUES
  (1, 'Refuerzos Extra', 'Añade 3 unidades extra al refuerzo de este turno', 'EXTRA_UNITS',   3, 1, unixepoch()),
  (2, 'Doble Ataque',    'El ataque de este turno cuenta doble',              'DOUBLE_ATTACK', 0, 1, unixepoch()),
  (3, 'Escudo',          'Bloquea el próximo ataque que recibas',             'SHIELD',        0, 1, unixepoch());
