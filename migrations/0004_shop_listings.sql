CREATE TABLE IF NOT EXISTS shop_listings (
  card_def_id INTEGER PRIMARY KEY,
  is_listed   INTEGER NOT NULL DEFAULT 1,
  listed_at   INTEGER,
  FOREIGN KEY (card_def_id) REFERENCES card_definitions(id) ON DELETE CASCADE
);
