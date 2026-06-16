# Base de datos (Cloudflare D1)

WAR usa una única base de datos D1 (`war-scores`) para persistir usuarios y victorias.
El juego en sí es 100% cliente; la DB nunca participa en la partida, solo gestiona
identidades y registra victorias acumuladas.

## Esquema actual — tabla `users` (migración 0001)

```sql
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
| `created_at` | `INTEGER` | Timestamp epoch-ms (`Date.now()`) del registro. |

Los dos índices aceleran la búsqueda por username (registro/perfil) y el ranking `ORDER BY wins DESC`.

## Queries vivas

### `functions/api/auth/callback.js` — verificar registro tras OAuth

```sql
SELECT id FROM users WHERE sub = ?
```
Si devuelve fila → redirige a `/game`. Si no → redirige a `/register`.

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
SELECT username, wins FROM users WHERE sub = ?
```

## Migraciones

Las migraciones viven en `migrations/` y se aplican en orden ascendente.

| Migración | Archivo | Qué hace |
|---|---|---|
| 0001 | `migrations/0001_users.sql` | Borra `scores`; crea `users` con sus índices. |

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run db:create` | Crea la base `war-scores` (una sola vez; devuelve el `database_id`). |

Para aplicar una migración manualmente:
```bash
wrangler d1 execute war-scores --local  --file migrations/0001_users.sql
wrangler d1 execute war-scores --remote --file migrations/0001_users.sql
```

Ver también: [environment.md](environment.md) (binding `DB`), [api.md](api.md) (consumidores de estas queries).
