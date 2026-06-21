# Base de datos (Cloudflare D1)

WAR usa una única base de datos D1 (`war-scores`) para persistir usuarios y victorias.
El juego en sí es 100% cliente; la DB nunca participa en la partida, solo gestiona
identidades y registra victorias acumuladas.

## Esquema actual — tabla `users` (migración 0001)

```sql
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sub            TEXT UNIQUE NOT NULL,
  username       TEXT UNIQUE NOT NULL COLLATE NOCASE,
  age            INTEGER NOT NULL,
  email          TEXT NOT NULL,
  how_heard      TEXT NOT NULL,
  wins           INTEGER NOT NULL DEFAULT 0,
  wallet_address TEXT COLLATE NOCASE,
  created_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(wins DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet
  ON users(wallet_address) WHERE wallet_address IS NOT NULL;
```

| Columna | Tipo | Rol |
|---|---|---|
| `id` | `INTEGER` PK autoincrement | Clave interna. |
| `sub` | `TEXT UNIQUE` | Google Subject ID (`userinfo.sub`). Identifica al usuario de forma estable. |
| `username` | `TEXT UNIQUE NOCASE` | Nombre elegido por el usuario (3–30 chars, `[a-zA-Z0-9_]`). Insensible a mayúsculas. |
| `age` | `INTEGER` | Edad declarada (5–120). |
| `email` | `TEXT` | Email de Google o editado en registro. |
| `how_heard` | `TEXT` | Cómo conoció el juego (dropdown de 6 opciones). |
| `wins` | `INTEGER` | Victorias acumuladas. Arranca en 0. |
| `wallet_address` | `TEXT UNIQUE NOCASE` (nullable) | Dirección MetaMask vinculada a la cuenta. Misma cuenta accesible por Google o por wallet. |
| `created_at` | `INTEGER` | Timestamp epoch-ms (`Date.now()`) del registro. |

Los índices aceleran la búsqueda por username (registro/perfil), el ranking `ORDER BY wins DESC`, y la búsqueda por wallet en el login (`idx_users_wallet`, único parcial: permite múltiples `NULL` pero rechaza wallets duplicadas entre cuentas).

## Queries vivas

### `functions/api/auth/callback.js` — verificar registro tras OAuth

```sql
SELECT id FROM users WHERE sub = ?
```
Si devuelve fila → redirige a `/lobby`. Si no → redirige a `/register`.

### `functions/api/register.js` — registrar usuario

```sql
-- Verificar si ya existe por sub
SELECT id FROM users WHERE sub = ?

-- Verificar si el username está tomado
SELECT id FROM users WHERE username = ?

-- Insertar nuevo usuario
INSERT INTO users (sub, username, age, email, how_heard, wins, created_at)
VALUES (?, ?, ?, ?, ?, 0, ?)
```

### `functions/api/gamers.js` — ranking top 100

```sql
SELECT username, wins FROM users ORDER BY wins DESC LIMIT 100
```

### `functions/api/profile.js` — perfil del usuario autenticado

```sql
SELECT username, wins, wallet_address FROM users WHERE sub = ?
```

### `functions/gamers/[username].js` — página pública de perfil

```sql
SELECT username, wins FROM users WHERE username = ? COLLATE NOCASE
```
Ruta `GET /gamers/<username>` (HTML, sin auth). `COLLATE NOCASE` hace la búsqueda insensible a
mayúsculas. Si no hay fila, responde un HTML 404.

### `functions/api/wallet/link.js` — vincular wallet a la cuenta de la sesión

```sql
UPDATE users SET wallet_address = ? WHERE sub = ?
```
Requiere firma del mensaje `Vincular esta wallet a mi cuenta WAR (${sub})`. Si la wallet ya pertenece a otra cuenta, el `UNIQUE` parcial `idx_users_wallet` rechaza el `UPDATE` (409).

### `functions/api/auth/wallet.js` — login solo con wallet

```sql
SELECT sub, username, email FROM users WHERE wallet_address = ? COLLATE NOCASE
```
Requiere firma del mensaje `Iniciar sesión en WAR con esta wallet (${address})`. Si hay fila, emite la misma cookie `war_session` que el login con Google.

### `functions/api/win.js` — registrar una victoria

```sql
UPDATE users SET wins = wins + 1 WHERE sub = ?
```
Solo corre si la cookie `war_session` trae un `sub` válido (si no, el endpoint
responde `{ok:false}` sin tocar la DB). No valida que `sub` exista en la tabla:
si no hay fila, el `UPDATE` simplemente afecta 0 filas.

---

## Esquema 0002_items (migración 0002) — sistema de cartas y battle pass

```sql
-- Catálogo de tipos de carta (administrado desde /api/admin/cards)
CREATE TABLE IF NOT EXISTS card_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  effect_type  TEXT    NOT NULL,  -- 'EXTRA_UNITS' | 'DOUBLE_ATTACK' | 'SHIELD'
  effect_value INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

-- Inventario de cartas por jugador (used_at NULL = disponible)
CREATE TABLE IF NOT EXISTS user_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  acquired_at INTEGER NOT NULL,
  used_at     INTEGER            -- timestamp-ms; NULL = aún no usada
);
CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);

-- Calendario de recompensas del battle pass (por mes+día, configurable desde /api/admin/battle-pass)
CREATE TABLE IF NOT EXISTS battle_pass_rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  month       INTEGER NOT NULL,
  day         INTEGER NOT NULL,
  card_def_id INTEGER NOT NULL REFERENCES card_definitions(id),
  quantity    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(month, day)
);

-- Progreso diario del battle pass por usuario (se resetea cada mes)
CREATE TABLE IF NOT EXISTS battle_pass_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  current_month   INTEGER NOT NULL,
  claimed_days    TEXT    NOT NULL DEFAULT '[]',  -- JSON array de días reclamados
  last_claim_date TEXT                            -- 'YYYY-MM-DD' o NULL
);
```

| Tabla | Rol |
|---|---|
| `card_definitions` | Catálogo de tipos de carta. Solo los admins la modifican. `is_active=0` oculta la carta sin borrarla. |
| `user_cards` | Una fila por carta que posee un jugador. `used_at IS NULL` = disponible. Se inserta vía battle pass claim o futura compra. |
| `battle_pass_rewards` | Qué carta (y cuántas) se entrega cada día del mes. `UNIQUE(month, day)` → `INSERT OR REPLACE` en el admin. |
| `battle_pass_progress` | Estado de avance del jugador: días reclamados este mes, fecha del último claim. Se resetea automáticamente al cambiar de mes. |

### Queries — `functions/api/cards/inventory.js`

```sql
SELECT id FROM users WHERE sub = ?

SELECT uc.id, uc.used_at, cd.name, cd.description, cd.effect_type, cd.effect_value
FROM user_cards uc
JOIN card_definitions cd ON uc.card_def_id = cd.id
WHERE uc.user_id = ? AND cd.is_active = 1
ORDER BY uc.acquired_at
```

Sin sesión o sin usuario en DB → devuelve `[]` (no 401).

### Queries — `functions/api/cards/use.js`

```sql
SELECT id FROM users WHERE sub = ?

-- Verifica que la carta existe, pertenece al usuario y no fue usada
SELECT uc.id, cd.effect_type, cd.effect_value, cd.name
FROM user_cards uc
JOIN card_definitions cd ON uc.card_def_id = cd.id
WHERE uc.id = ? AND uc.user_id = ? AND uc.used_at IS NULL AND cd.is_active = 1

UPDATE user_cards SET used_at = ? WHERE id = ?
```

### Queries — `functions/api/cards/delete.js`

```sql
SELECT id FROM users WHERE sub = ?
SELECT id FROM user_cards WHERE id = ? AND user_id = ?
DELETE FROM user_cards WHERE id = ?
```

### Queries — `functions/api/battle-pass/status.js`

```sql
SELECT id FROM users WHERE sub = ?
SELECT * FROM battle_pass_progress WHERE user_id = ?

SELECT bp.day, bp.quantity, cd.name, cd.description, cd.effect_type, cd.effect_value
FROM battle_pass_rewards bp
JOIN card_definitions cd ON bp.card_def_id = cd.id
WHERE bp.month = ?
ORDER BY bp.day
```

### Queries — `functions/api/battle-pass/claim.js`

```sql
SELECT id FROM users WHERE sub = ?
SELECT * FROM battle_pass_progress WHERE user_id = ?

-- Primera vez: crea el registro de progreso
INSERT INTO battle_pass_progress (user_id, current_month, claimed_days, last_claim_date)
  VALUES (?, ?, '[]', NULL)

-- Nuevo mes: resetea días reclamados
UPDATE battle_pass_progress SET current_month=?, claimed_days='[]', last_claim_date=NULL
  WHERE user_id=?

-- Recompensa del día
SELECT bp.quantity, cd.id AS card_def_id, cd.name, cd.description, cd.effect_type, cd.effect_value
FROM battle_pass_rewards bp
JOIN card_definitions cd ON bp.card_def_id = cd.id
WHERE bp.month = ? AND bp.day = ? AND cd.is_active = 1

-- Marca el día como reclamado
UPDATE battle_pass_progress SET claimed_days=?, last_claim_date=? WHERE user_id=?

-- Inserta N cartas en batch (una por quantity)
INSERT INTO user_cards (user_id, card_def_id, acquired_at) VALUES (?, ?, ?)
-- → env.DB.batch([stmt1, stmt2, ...])
```

### Queries — `functions/api/admin/cards.js`

```sql
-- GET
SELECT * FROM card_definitions ORDER BY created_at DESC

-- POST
INSERT INTO card_definitions (name, description, effect_type, effect_value, is_active, created_at)
  VALUES (?, ?, ?, ?, 1, ?)

-- PUT
UPDATE card_definitions SET name=?, description=?, effect_type=?, effect_value=?, is_active=? WHERE id=?

-- DELETE
DELETE FROM card_definitions WHERE id=?
```

### Queries — `functions/api/admin/battle-pass.js`

```sql
-- GET ?month=N
SELECT bp.id, bp.month, bp.day, bp.quantity, bp.card_def_id,
       cd.name AS card_name, cd.effect_type, cd.effect_value
FROM battle_pass_rewards bp
JOIN card_definitions cd ON bp.card_def_id = cd.id
WHERE bp.month = ?
ORDER BY bp.day

-- POST (upsert por month+day gracias al UNIQUE constraint)
INSERT OR REPLACE INTO battle_pass_rewards (month, day, card_def_id, quantity)
  VALUES (?, ?, ?, ?)

-- DELETE ?month=N&day=N
DELETE FROM battle_pass_rewards WHERE month=? AND day=?
```

---

## Migraciones

Las migraciones viven en `migrations/` y se aplican en orden ascendente.

| Migración | Archivo | Qué hace |
|---|---|---|
| 0001 | `migrations/0001_users.sql` | Borra `scores`; crea `users` (incluye `wallet_address`) con sus índices. |
| 0002 | `migrations/0002_items.sql` | Crea `card_definitions`, `user_cards`, `battle_pass_rewards`, `battle_pass_progress`. |

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run db:create` | Crea la base `war-scores` (una sola vez; devuelve el `database_id`). |

Para aplicar una migración manualmente:
```bash
wrangler d1 execute war-scores --local  --file migrations/0002_items.sql
wrangler d1 execute war-scores --remote --file migrations/0002_items.sql
```

Ver también: [environment.md](environment.md) (binding `DB`), [api.md](api.md) (consumidores de estas queries).
