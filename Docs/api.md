# API — `/api/scores`

Endpoint del salón de la fama. Es una **Cloudflare Pages Function**
(`functions/api/scores.js`) sobre D1; la lógica del juego no toca la red.
(Los otros endpoints son `/api/auth/*` —abajo— y `/api/game-room` —WebSocket, ver
[realtime.md](realtime.md)—.)

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
| Usuario ya registrado en DB | `302` | `/game` con `Set-Cookie: war_session=…` |
| Usuario nuevo (no en DB) | `302` | `/register` con `Set-Cookie: war_session=…` |
| Sin `?code` o Google devuelve `?error` | `302` | `/login.html?error=no_code` |
| Env vars ausentes | `500` | — |
| Error de red al canjear code (excepción de fetch) | `302` | `/login?error=token_fetch` |
| Google devuelve error de token | `302` | `/login?error=<error_de_google>` |
| Error al obtener userinfo | `302` | `/login?error=userinfo_fetch` |

La cookie `war_session` es `HttpOnly; SameSite=Lax; Max-Age=604800` (7 días).
Su valor es un JSON base64 con `{ sub, name, email, picture }`.
El redirect "sin code" usa `/login.html`; el resto usan `/login` (sin extensión).
Tras el callback el servidor consulta `users WHERE sub = ?` para decidir el destino.

---

# API — Gamers, perfil y registro

## `GET /api/gamers` — ranking de jugadores

Sin autenticación. Devuelve hasta 100 jugadores ordenados por victorias.

**200 OK**
```json
[ { "username": "Ana", "wins": 15 }, { "username": "Bob", "wins": 9 } ]
```

No hay degradación: si falla `env.DB` el error se propaga (500 del runtime).

## `GET /api/profile` — perfil del usuario autenticado

Requiere cookie `war_session` válida.

| Caso | Status | Body |
|---|---|---|
| Sin cookie o cookie inválida | `401` | `{ "error": "No autenticado" }` |
| Usuario no registrado aún | `404` | `{ "error": "Usuario no registrado" }` |
| Éxito | `200` | `{ "username": "Ana", "wins": 3 }` |

## `POST /api/register` — registrar usuario

Requiere cookie `war_session`. Body JSON `{ username, age, email, how_heard }`.

| Caso | Status | Body / Destino |
|---|---|---|
| Sin sesión | `302` | `/login.html` |
| JSON inválido | `400` | `{ "error": "Cuerpo inválido" }` |
| `username` <3 o >30 chars | `400` | `{ "error": "El nombre de usuario debe tener entre 3 y 30 caracteres" }` |
| `username` con chars inválidos (solo `[a-zA-Z0-9_]`) | `400` | `{ "error": "Solo letras, números y guion bajo" }` |
| `age` fuera de `[5, 120]` | `400` | `{ "error": "Edad inválida" }` |
| `email` sin `@` | `400` | `{ "error": "Correo inválido" }` |
| `how_heard` no en lista permitida | `400` | `{ "error": "Opción inválida" }` |
| `sub` ya registrado | `409` | `{ "error": "Usuario ya registrado" }` |
| `username` ya tomado | `409` | `{ "error": "Ese nombre de usuario ya está en uso" }` |
| Éxito | `200` | `{ "ok": true }` |

Valores válidos de `how_heard`: `"YouTube"`, `"Twitter / X"`, `"Un amigo me lo recomendó"`, `"Reddit"`, `"Discord"`, `"Encontré el link por casualidad"`.

---

# API — Sala multijugador (`/api/game-room`)

Endpoint **WebSocket** servido por `functions/game-room.js`, que enruta al Durable Object
`GameRoom` por `roomId`.

## `GET /api/game-room?roomId=<id>&playerId=<id>` (upgrade WebSocket)

| Caso | Status | Resultado |
|---|---|---|
| Header `Upgrade: websocket` presente | `101` | Conexión WebSocket aceptada en la sala `roomId`. |
| Sin ese header | `426` | `Expected WebSocket`. |

Mensajes (JSON `{ type, payload }`): el cliente envía `game_state` (se persiste y
retransmite) u otras acciones (solo retransmiten). El servidor reenvía a los demás con
`from: <playerId>` y emite `player_left` al cerrar. Protocolo y semántica completos en
[realtime.md](realtime.md).
