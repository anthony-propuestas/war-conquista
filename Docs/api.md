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
| Usuario no encontrado en DB | `200` | `{ "ok": false }` |
| Éxito | `200` | `{ "ok": true }` |

**Diseño clave:** degrada silenciosamente — sesión inválida o usuario inexistente
responden `{ok:false}`. Al confirmar el usuario, ejecuta `DB.batch()` con dos
sentencias: incrementa `users.wins` e inserta/actualiza `user_monthly_wins` para
el mes en curso (`year_month = "YYYY-MM"`). No hay try/catch.

## Consumidores

`js/main.js` → `onGameOver(winner)`: hace `POST /api/win` (sin esperar ni manejar
la respuesta; envuelto en `.catch(() => {})`) **solo** cuando se cumplen `rankedOnline &&
myIndex === winner.id` — es decir, únicamente en el **modo online de emparejamiento** y
cuando el ganador es el jugador local. El modo **local** (`startLocalGame`) y el de **sala**
(crear/unirse, `enterLobby`) **no** reportan victorias, aunque la sala también tenga `myIndex`.

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
`response_type=code`, `scope=openid email profile`, `state` (UUID anti-CSRF).
También emite `Set-Cookie: oauth_state=<state>; HttpOnly; Secure; SameSite=Lax; Max-Age=600`.

## `GET /api/auth/callback?code=<code>&state=<state>` — completar login

Google redirige aquí tras la autorización del usuario.

| Caso | Status | Destino |
|---|---|---|
| Usuario ya registrado en DB | `302` | `/lobby` con `Set-Cookie: war_session=…` + limpiar `oauth_state` |
| Usuario nuevo (no en DB) | `302` | `/register` con `Set-Cookie: war_session=…` + limpiar `oauth_state` |
| Sin `?code` o Google devuelve `?error` | `302` | `/login.html?error=no_code` |
| `state` ausente o no coincide con cookie `oauth_state` | `302` | `/login.html?error=invalid_state` |
| Env vars ausentes | `500` | — |
| Error de red al canjear code (excepción de fetch) | `302` | `/login?error=token_fetch` |
| Google devuelve error de token | `302` | `/login?error=<error_de_google>` |
| Error al obtener userinfo | `302` | `/login?error=userinfo_fetch` |

La cookie `war_session` es `HttpOnly; Secure; SameSite=Lax; Max-Age=604800` (7 días).
Su valor es `base64(payload).base64url(HMAC-SHA256)` donde payload = `{ sub, name, email, picture }`.
Ver formato completo en [auth.md](auth.md).
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

## `GET /gamers/<username>` — página pública de perfil

Ruta de **página** (no `/api`), servida por la Pages Function de ruta dinámica
`functions/gamers/[username].js`. Sin autenticación. A diferencia del resto, **devuelve HTML**
(no JSON): una tarjeta con el `username` y sus `wins`. La enlaza cada fila del ranking
(`gamers/index.html` → `/gamers/${encodeURIComponent(username)}`).

Query: `SELECT username, wins FROM users WHERE username = ? COLLATE NOCASE` (búsqueda
insensible a mayúsculas).

| Caso | Status | Body |
|---|---|---|
| Username existe | `200` | Página HTML de perfil (`Content-Type: text/html`). |
| Username no existe | `404` | Página HTML "Jugador no encontrado" con enlace a `/gamers`. |

`username` y `wins` se interpolan en el HTML, pero `username` está restringido a `[a-zA-Z0-9_]`
en el registro y `wins` es `INTEGER` → sin XSS (ver [security.md](security.md)).

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

# API — Cartas de jugador (`/api/cards/*`)

Endpoints para gestionar el inventario de cartas del jugador autenticado. Las cartas
se obtienen reclamando recompensas del battle pass. Cada carta tiene un `effect_type`
(`EXTRA_UNITS`, `DOUBLE_ATTACK` o `SHIELD`) y se aplica en partida desde `js/ui.js`.

## `GET /api/cards/inventory` — inventario del jugador

Sin body. Devuelve todas las cartas del jugador (activas; sin importar si están usadas).
Sin sesión o sin usuario en DB → devuelve `[]` en vez de 401 (degradación silenciosa).

**200 OK** (con sesión válida):
```json
[
  { "id": 5, "used_at": null, "name": "Refuerzo", "description": "...",
    "effect_type": "EXTRA_UNITS", "effect_value": 3 },
  { "id": 6, "used_at": 1718000000000, "name": "Escudo", "description": "...",
    "effect_type": "SHIELD", "effect_value": 0 }
]
```

`used_at` es epoch-ms si la carta ya fue usada, `null` si aún está disponible.

## `POST /api/cards/use` — usar una carta en partida

Requiere `war_session`. Body JSON `{ "card_id": <id> }`.
Marca la carta como usada (`used_at = Date.now()`) y devuelve el efecto para aplicarlo.

| Caso | Status | Body |
|---|---|---|
| Sin sesión | `401` | `{ "error": "No autenticado" }` |
| Usuario no encontrado en DB | `404` | `{ "error": "Usuario no encontrado" }` |
| `card_id` faltante | `400` | `{ "error": "Falta card_id" }` |
| Carta no encontrada, ajena o inactiva | `404` | `{ "error": "Carta no disponible" }` |
| Carta ya usada (guard a nivel de UPDATE) | `409` | `{ "error": "Carta ya fue usada" }` |
| Éxito | `200` | `{ "effect_type": "EXTRA_UNITS", "effect_value": 3, "name": "Refuerzo" }` |

Lo llama `js/ui.js → _useCard()`. El efecto se aplica en local primero (optimista); luego hace `await fetch` y si el servidor responde `409` (carta ya usada en otra pestaña o doble envío) conserva la carta marcada como usada de todas formas. Solo loguea warning si status no es `200` ni `409`.

## `DELETE /api/cards/delete?id=<card_id>` — descartar una carta

Requiere `war_session`. El `card_id` va en la URL como query param `?id=`.
Elimina la fila de `user_cards` si pertenece al jugador.

| Caso | Status | Body |
|---|---|---|
| Sin sesión | `401` | `{ "error": "No autenticado" }` |
| Usuario no encontrado | `404` | `{ "error": "Usuario no encontrado" }` |
| `id` faltante | `400` | `{ "error": "Falta id" }` |
| Carta no encontrada o ajena | `404` | `{ "error": "Carta no encontrada" }` |
| Éxito | `200` | `{ "ok": true }` |

Lo llama `js/ui.js → _discardCard()` en background.

---

# API — Battle Pass (`/api/battle-pass/*`)

Sistema de recompensa diaria por login. Cada mes tiene un calendario de días con cartas
configurado por el admin. El jugador puede reclamar una vez por día; si ese día tiene
recompensa en el calendario, recibe las cartas directamente en `user_cards`.

## `GET /api/battle-pass/status` — estado del battle pass del jugador

Requiere `war_session`.

| Caso | Status | Body |
|---|---|---|
| Sin sesión | `401` | `{ "error": "No autenticado" }` |
| Usuario no encontrado | `404` | `{ "error": "Usuario no encontrado" }` |
| Éxito | `200` | (ver abajo) |

**200 OK**:
```json
{
  "month": 6,
  "current_day": 21,
  "days_in_month": 30,
  "claimed_days": [1, 5, 10],
  "can_claim_today": true,
  "today_reward": { "day": 21, "quantity": 1, "name": "Refuerzo", "description": "...",
                    "effect_type": "EXTRA_UNITS", "effect_value": 3 },
  "rewards": [ ... ]
}
```

`can_claim_today` es `true` si `last_claim_date` del progreso no coincide con la fecha de hoy (`YYYY-MM-DD`). `today_reward` es `null` si ese día no hay carta en el calendario. `rewards` es el calendario completo del mes.

## `POST /api/battle-pass/claim` — reclamar recompensa del día

Requiere `war_session`. Sin body.

| Caso | Status | Body |
|---|---|---|
| Sin sesión | `401` | `{ "error": "No autenticado" }` |
| Usuario no encontrado | `404` | `{ "error": "Usuario no encontrado" }` |
| Ya reclamó hoy | `200` | `{ "already_claimed": true, "claimed_days": [...] }` |
| Día sin recompensa (sin carta en calendario) | `200` | `{ "no_reward": true, "claimed_days": [...] }` (no escribe en DB) |
| Éxito con carta | `200` | `{ "claimed": true, "reward": { "name": "...", "quantity": 2, ... }, "claimed_days": [...] }` |

**Lógica de reset mensual:** si `progress.current_month !== mes_actual`, se resetean `claimed_days` y `last_claim_date` a `[]`/`null` antes de procesar el claim.
**Batch insert:** si `quantity > 1`, se insertan N filas en `user_cards` usando `env.DB.batch([stmt1, stmt2, ...])`.

---

# API — Tienda & On-Chain (`/api/shop/*`, `/api/claim-wgt`, `/api/deliver-item`)

Endpoints para consultar WGT acumulado, gestionar el inventario de items de tienda y
procesar el ciclo on-chain. Todos requieren cookie `war_session`. Los contratos viven en
**Base Sepolia** (chain 84532); ver [onchain.md](onchain.md) para direcciones y ABI.

## `GET /api/shop/pending-wgt` — WGT reclamable

| Caso | Status | Body |
|---|---|---|
| Sin cookie / cookie inválida / usuario no en DB | `200` | `{ "total": 0 }` |
| Éxito | `200` | `{ "total": N }` |

`total` es la suma de `wins` en `user_monthly_wins` donde `claimed_at IS NULL` y
`year_month < mes actual`. Solo meses ya cerrados son reclamables; el mes en curso
no cuenta hasta que cierre.

## `GET /api/shop/inventory` — inventario de items del jugador

| Caso | Status | Body |
|---|---|---|
| Sin cookie / cookie inválida / usuario no en DB | `200` | `{ "items": [] }` |
| Éxito | `200` | `{ "items": [...] }` |

Devuelve solo items con `quantity > 0` y `is_active = 1` (join `user_shop_items` + `card_definitions`):
```json
{ "items": [
  { "card_def_id": 1, "quantity": 5, "name": "Refuerzos Extra",
    "effect_type": "EXTRA_UNITS", "effect_value": 3 }
] }
```

## `GET /api/shop/listings` — cartas disponibles en la tienda

Endpoint **público** (sin auth). Devuelve todas las cartas con `is_listed = 1` y `is_active = 1`, ordenadas por `listed_at ASC`.

**200 OK**:
```json
[
  { "card_def_id": 1, "name": "Refuerzos Extra", "description": "...",
    "effect_type": "EXTRA_UNITS", "effect_value": 3, "wgt_price": 2 }
]
```

Array vacío si no hay cartas listadas. No hay códigos de error: si `env.DB` falla, el runtime propaga el 500.

## `POST /api/claim-wgt` — reclamar WGT acumulado

**Request body**: `{ "signature": "0x...", "timestamp": 1234567890 }`

El cliente firma el mensaje `claim-wgt:{user.id}:{timestamp}` con su wallet. Requiere
wallet vinculada en `users.wallet_address`.

| Caso | Status | Body |
|---|---|---|
| Sin cookie / cookie inválida | `401` | `{ "error": "No autenticado" }` |
| Sin wallet vinculada | `400` | `{ "error": "No tienes una wallet vinculada" }` |
| Firma expirada (>5 min) | `400` | `{ "error": "Firma expirada" }` |
| Firma inválida | `400` | `{ "error": "Firma inválida" }` |
| Sin wins de meses cerrados | `400` | `{ "error": "No tienes wins pendientes de meses anteriores" }` |
| Éxito | `200` | `{ "ok": true, "amount": N, "txHash": "0x..." }` |

**Anti-doble-reclamo:** el Worker marca `claimed_at` en D1 **antes** de llamar
`WGTToken.mint()`. Si el mint falla, revierte el `claimed_at` a `NULL`.

## `POST /api/deliver-item` — entregar item tras compra on-chain

**Request body**: `{ "txHash": "0x..." }`

Llamar después de que `ItemShop.buyItem()` esté confirmado en Base.

| Caso | Status | Body |
|---|---|---|
| Sin cookie / cookie inválida | `401` | `{ "error": "No autenticado" }` |
| Sin wallet vinculada | `400` | `{ "error": "No tienes una wallet vinculada" }` |
| `txHash` ya procesado | `400` | `{ "error": "Este txHash ya fue entregado" }` |
| Formato de `txHash` inválido | `400` | `{ "error": "txHash inválido" }` |
| Tx rechazada en chain | `400` | `{ "error": "Transacción no exitosa en la chain" }` |
| Evento `ItemPurchased` no encontrado o buyer incorrecto | `400` | (varios mensajes) |
| Éxito | `200` | `{ "ok": true, "itemId": N, "quantity": N }` |

**Verificación on-chain:** busca el receipt por `txHash` en la RPC de Base, verifica
`status=1` y destino=`SHOP_CONTRACT`, parsea el evento `ItemPurchased` y verifica que
`buyer == wallet_address` del usuario autenticado. Previene re-entrega vía `delivered_txs`.

---

# API — Admin (`/api/admin/*`)

Endpoints de gestión restringidos a administradores. **Auth:** la cookie `war_session`
debe contener un `email` presente en el env var `ADMIN_EMAILS` (CSV, case-insensitive).
Si no se cumple → `403 { "error": "No autorizado" }`.

## `GET|POST|PUT|DELETE /api/admin/cards` — CRUD de definiciones de carta

Gestiona el catálogo `card_definitions`.

| Método | Qué hace |
|---|---|
| `GET` | Lista todas las definiciones ordenadas por `created_at DESC`. |
| `POST` | Crea una nueva. Body: `{ name, description, effect_type, effect_value? }`. → `201 { "id": <new_id> }`. Campos `name`, `description` y `effect_type` son requeridos (400 si faltan o vacíos). |
| `PUT` | Edita una existente. Body: `{ id, name, description, effect_type, effect_value, is_active }`. `is_active=0` la oculta. → `200 { "ok": true }`. |
| `DELETE` | Elimina por `?id=<id>` (query param). → `200 { "ok": true }`. |

## `GET|POST|DELETE /api/admin/shop-listings` — gestión del catálogo de la tienda

Gestiona la tabla `shop_listings` (qué cartas aparecen en la tienda y a qué precio).

| Método | Parámetros / Body | Qué hace |
|---|---|---|
| `GET` | — | Lista todas las `card_definitions` activas con su estado en `shop_listings` (LEFT JOIN). Devuelve `{ card_def_id, name, description, effect_type, effect_value, is_listed, wgt_price }` para cada carta. |
| `POST` | Body `{ card_def_id, is_listed?, wgt_price? }` | Upsert del listing por `card_def_id`. `is_listed` defecto `false`; `wgt_price` defecto `1`, mínimo `0`. → `200 { "ok": true }`. `card_def_id` es requerido (400 si falta). |
| `DELETE` | `?card_def_id=<id>` | Elimina el listing de esa carta. → `200 { "ok": true }`. 400 si falta el param. |

Método no listado → `405 Method Not Allowed` (texto plano).

## `GET|POST|DELETE /api/admin/battle-pass` — CRUD del calendario de recompensas

Gestiona la tabla `battle_pass_rewards` (qué carta se entrega cada día del mes).

| Método | Parámetros / Body | Qué hace |
|---|---|---|
| `GET` | `?month=N` (default: mes actual) | Lista las recompensas del mes con nombre de carta unido de `card_definitions`. |
| `POST` | Body `{ month, day, card_def_id, quantity? }` | Inserta o reemplaza (`INSERT OR REPLACE`) la recompensa de ese día. → `200 { "ok": true }`. `month`, `day` y `card_def_id` son requeridos (400 si faltan). |
| `DELETE` | `?month=N&day=N` | Elimina la recompensa de ese día del mes. → `200 { "ok": true }`. |

---

# API — Sala multijugador (`/api/game-room`)

Endpoint **WebSocket**. El routing lo hace la Pages Function
`functions/api/game-room.js`, que enruta al Durable Object `GameRoom` (clase
definida en `worker/index.js`, desplegado como Worker separado
`war-game-room`) por `roomId`.

## `GET /api/game-room?match=1` — matchmaking público

No requiere `roomId`. Devuelve la sala pública activa y el tiempo restante para el auto-inicio.

**200 OK**
```json
{ "roomId": "pub-<uuid>", "secondsLeft": 42 }
```

Lo implementa `handleMatch` en `functions/api/game-room.js`: almacena en el Durable Object el `roomId` actual y la hora de creación; rota la sala (genera un nuevo `roomId`) cuando se cumplen 60 s o cuando hay 6 jugadores conectados. Lo consume `requestMatch()` en `js/multiplayer.js` antes de llamar `joinRoom`.

---

## `GET /api/game-room?roomId=<id>&playerId=<id>&playerName=<nombre>` (upgrade WebSocket)

| Caso | Status | Resultado |
|---|---|---|
| Header `Upgrade: websocket` presente y la sala no inició | `101` | Conexión WebSocket aceptada en la sala `roomId`. |
| Sin ese header | `426` | `Expected WebSocket`. |
| Sala iniciada y `playerId` **pertenece** a la partida (en `playerIds`) | `101` | **Reconexión**: se acepta el socket y se recibe `state_sync` con el último estado. |
| Sala iniciada y `playerId` **desconocido** | `409` | `Room already started`. |

Mensajes (JSON `{ type, payload }`): el cliente envía `game_state` (se persiste y
retransmite), `set_ready` (marca al jugador listo en el lobby) o `start_game`
(el host arranca la partida). El servidor reenvía a los demás con
`from: <playerId>`, emite `lobby_update` con la lista de jugadores, `player_left`
al cerrar, y `player_rejoined` + `state_sync` cuando un jugador reconecta a media
partida. Fuera de banda JSON, el cliente envía `ping` cada 25 s y el Durable Object
responde `pong` automáticamente (heartbeat). Protocolo y semántica completos en
[realtime.md](realtime.md).
