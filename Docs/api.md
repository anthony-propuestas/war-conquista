# API — `/api/win`

Endpoint de registro de victorias. Es una **Cloudflare Pages Function**
(`functions/api/win.js`) sobre D1; la lógica del juego no toca la red.
(Los otros endpoints son `/api/auth/*` —abajo—, `/api/gamers`/`/api/profile`/`/api/register`
y `/api/game-room` —WebSocket, ver [realtime.md](realtime.md)—.)

## `POST /api/win` — registrar una victoria

Requiere cookie `war_session` (mismo formato que el login, ver [auth.md](auth.md)).
Sin body.

| Caso | Status | Body |
|---|---|---|
| Sin cookie o cookie inválida (sin `sub`) | `200` | `{ "ok": false }` |
| Éxito (`UPDATE users SET wins = wins + 1 WHERE sub = ?`) | `200` | `{ "ok": true }` |

**Diseño clave:** degrada de forma silenciosa — una sesión inválida no es un error
de protocolo, simplemente no incrementa nada. No hay rama `500`: si la query
fallara se propagaría como excepción no controlada (no hay try/catch).

## Consumidores

`js/main.js` → `onGameOver(winner)`: si `myIndex` (índice del jugador local en
la partida online) coincide con el ganador, hace `POST /api/win` (sin esperar
ni manejar la respuesta; envuelto en `.catch(() => {})`). Solo se llama en
partidas online — el modo local (`startLocalGame`) no reporta victorias.

Ver también: [database.md](database.md) (queries y esquema), [architecture.md](architecture.md).

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
| Usuario ya registrado en DB | `302` | `/lobby` con `Set-Cookie: war_session=…` |
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
| Éxito | `200` | `{ "username": "Ana", "wins": 3, "wallet_address": "0x..."\|null, "sub": "u1" }` |

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

# API — Wallet (`/api/auth/wallet`, `/api/wallet/link`)

Login y vinculación de wallet MetaMask, alternativa a Google OAuth. Ambos endpoints
verifican la firma con `ethers.verifyMessage` (`recovered.toLowerCase() === address.toLowerCase()`).
Detalle del flujo y de `signMessage` en [onchain.md](onchain.md); flujo de sesión en [auth.md](auth.md).

## `POST /api/auth/wallet` — login solo con wallet

**Request body**: `{ "address": "0x...", "signature": "0x..." }`, firma del mensaje
`Iniciar sesión en WAR con esta wallet (${address})`.

| Caso | Status | Body |
|---|---|---|
| JSON inválido | `400` | `{ "error": "Cuerpo inválido" }` |
| Falta `address` o `signature` | `400` | `{ "error": "Faltan datos" }` |
| Firma no corresponde a `address` | `400` | `{ "error": "Firma inválida" }` |
| Wallet no vinculada a ninguna cuenta | `404` | `{ "error": "Wallet no vinculada a ninguna cuenta" }` |
| Éxito | `200` | `{ "ok": true }` + `Set-Cookie: war_session=…` (mismo formato que el login con Google) |

## `POST /api/wallet/link` — vincular wallet a la cuenta de la sesión

Requiere cookie `war_session` válida. **Request body**: `{ "address": "0x...", "signature": "0x..." }`,
firma del mensaje `Vincular esta wallet a mi cuenta WAR (${sub})`.

| Caso | Status | Body |
|---|---|---|
| Sin sesión | `401` | `{ "error": "No autenticado" }` |
| JSON inválido | `400` | `{ "error": "Cuerpo inválido" }` |
| Falta `address` o `signature` | `400` | `{ "error": "Faltan datos" }` |
| Firma no corresponde a `address` | `400` | `{ "error": "Firma inválida" }` |
| Wallet ya vinculada a otra cuenta (`UNIQUE` de `idx_users_wallet`) | `409` | `{ "error": "Esta wallet ya está vinculada a otra cuenta" }` |
| Éxito | `200` | `{ "wallet_address": "0x..." }` |

---

# API — Sala multijugador (`/api/game-room`)

Endpoint **WebSocket**. El routing lo hace la Pages Function
`functions/api/game-room.js`, que enruta al Durable Object `GameRoom` (clase
definida en `worker/index.js`, desplegado como Worker separado
`war-game-room`) por `roomId`.

## `GET /api/game-room?roomId=<id>&playerId=<id>&playerName=<nombre>` (upgrade WebSocket)

| Caso | Status | Resultado |
|---|---|---|
| Header `Upgrade: websocket` presente y la sala no inició | `101` | Conexión WebSocket aceptada en la sala `roomId`. |
| Sin ese header | `426` | `Expected WebSocket`. |
| La sala ya inició (`start_game` ya se envió) | `409` | `Room already started`. |

Mensajes (JSON `{ type, payload }`): el cliente envía `game_state` (se persiste y
retransmite), `set_ready` (marca al jugador listo en el lobby) o `start_game`
(el host arranca la partida). El servidor reenvía a los demás con
`from: <playerId>`, emite `lobby_update` con la lista de jugadores y
`player_left` al cerrar. Protocolo y semántica completos en
[realtime.md](realtime.md).
