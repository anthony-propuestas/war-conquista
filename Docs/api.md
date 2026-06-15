# API — `/api/scores`

Único endpoint del proyecto. Es una **Cloudflare Pages Function**
(`functions/api/scores.js`) que expone el salón de la fama sobre D1.
Maneja el salón de la fama; la lógica del juego no toca la red.

**Diseño clave:** degrada de forma segura. Si no hay D1 vinculado (`env.DB`
ausente), responde sin error para que el juego siga funcionando sin backend.

## `GET /api/scores` — top 10 ganadores

Sin parámetros. Devuelve hasta 10 filas ordenadas por victorias.

**200 OK**
```json
[ { "name": "Ana", "wins": 5 }, { "name": "Beto", "wins": 3 } ]
```

- Sin `env.DB` → `200 []`.
- Error de DB (excepción en la query) → `200 []` (degradación silenciosa; el front
  trata `[]` como "sin salón de la fama").

## `POST /api/scores` — registrar una victoria

**Request body**
```json
{ "name": "Ana" }
```
El `name` se normaliza: `String(name).trim().slice(0, 16)` (máx. 16 caracteres).

| Resultado | Status | Body |
|---|---|---|
| Éxito (upsert `+1`) | `200` | `{ "ok": true }` |
| Sin D1 vinculado | `200` | `{ "ok": false, "reason": "no-db" }` |
| JSON inválido en el body | `400` | `{ "ok": false, "reason": "bad-json" }` |
| `name` vacío tras `trim` | `400` | `{ "ok": false, "reason": "no-name" }` |
| Error al escribir en D1 | `500` | `{ "ok": false, "reason": "db-error" }` |

Todas las respuestas son `application/json`.

## Consumidores

`js/main.js`:
- `submitScore(name)` → `POST` al terminar la partida (envuelto en try/catch: si falla,
  el juego no se ve afectado).
- `loadLeaderboard()` → `GET` al volver al menú; si la respuesta no es `ok` o está
  vacía, oculta el bloque del salón de la fama.

Ver también: [database.md](database.md) (queries y esquema), [architecture.md](architecture.md).
Las ramas de error de este endpoint están cubiertas por tests — ver [testing.md](testing.md).
