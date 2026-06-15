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

---

# API — Autenticación (`/api/auth/*`)

Dos Pages Functions que implementan el flujo OAuth 2.0 con Google.
Requieren los secrets `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (ver [environment.md](environment.md)).
Para el flujo completo y la estructura de la sesión ver [auth.md](auth.md).

## `GET /api/auth/google` — iniciar login

Sin parámetros. Construye la URL de autorización de Google y responde con redirect 302.

| Caso | Status | Destino |
|---|---|---|
| `GOOGLE_CLIENT_ID` presente | `302` | `accounts.google.com/o/oauth2/v2/auth?…` |
| `GOOGLE_CLIENT_ID` ausente | `500` | — (texto plano de error) |

Parámetros enviados a Google: `client_id`, `redirect_uri` (`<origen>/api/auth/callback`),
`response_type=code`, `scope=openid email profile`.

## `GET /api/auth/callback?code=<code>` — completar login

Google redirige aquí tras la autorización del usuario.

| Caso | Status | Destino |
|---|---|---|
| Flujo exitoso | `302` | `/` con `Set-Cookie: war_session=…` |
| Sin `?code` | `302` | `/login?error=no_code` |
| Env vars ausentes | `500` | — |
| Google devuelve error de token | `302` | `/login?error=<error_de_google>` |
| Error al obtener userinfo | `302` | `/login?error=userinfo_fetch` |

La cookie `war_session` es `HttpOnly; SameSite=Lax; Max-Age=604800` (7 días).
Su valor es un JSON base64 con `{ sub, name, email, picture }`.
Todos los redirects de error usan URLs absolutas (`<origen>/login?error=…`).
