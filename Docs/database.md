# Base de datos (Cloudflare D1)

WAR usa una única base de datos D1 (`war-scores`) solo para el **salón de la fama**.
El juego en sí es 100% cliente; la DB nunca participa en la partida, solo registra
victorias acumuladas por nombre.

## Esquema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS scores (
  name       TEXT PRIMARY KEY,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scores_wins ON scores (wins DESC);
```

| Columna | Tipo | Rol |
|---|---|---|
| `name` | `TEXT` PK | Nombre del jugador (clave natural; ≤16 chars, recortado en la API). Sirve para el upsert. |
| `wins` | `INTEGER` | Victorias acumuladas. Arranca en 1 al insertar, `+1` en cada conflicto. |
| `updated_at` | `INTEGER` | Timestamp epoch-ms (`Date.now()`) de la última victoria. Desempata el ranking. |

El índice `idx_scores_wins (wins DESC)` acelera el `ORDER BY wins DESC` del top 10.

## Queries vivas (`functions/api/scores.js`)

**Lectura — top 10:**

```sql
SELECT name, wins FROM scores ORDER BY wins DESC, updated_at DESC LIMIT 10
```

**Escritura — registrar/incrementar victoria (upsert):**

```sql
INSERT INTO scores (name, wins, updated_at) VALUES (?, 1, ?)
ON CONFLICT(name) DO UPDATE SET wins = wins + 1, updated_at = ?
```

El `ON CONFLICT(name)` depende de que `name` sea PRIMARY KEY: la primera victoria
inserta con `wins = 1`; las siguientes incrementan en vez de duplicar filas.

## Migraciones

| Comando | Qué hace |
|---|---|
| `npm run db:init` | Aplica `schema.sql` a la D1 **local** (entorno de `wrangler pages dev`). |
| `npm run db:init:remote` | Aplica `schema.sql` a la D1 **remota** (producción). |
| `npm run db:create` | Crea la base `war-scores` (una sola vez; devuelve el `database_id`). |

El esquema es idempotente (`IF NOT EXISTS`), así que re-ejecutarlo es seguro.

Ver también: [environment.md](environment.md) (binding `DB`), [api.md](api.md) (consumidor de estas queries).
