# Tiempo real — Multijugador (WebSocket + Durable Object)

WAR permite jugar la misma partida en varios navegadores sincronizando el estado por
WebSocket. La sala vive en un **Durable Object** de Cloudflare (`GameRoom`); cada cliente
se conecta y recibe/emite el estado del juego.

## Piezas

| Pieza | Archivo | Rol |
|---|---|---|
| Cliente WS | `js/multiplayer.js` | Abre el socket, parsea mensajes, expone `send*`. |
| Endpoint + routing | `functions/api/game-room.js` | Pages Function (`onRequest`) que enruta `/api/game-room` al Durable Object por `roomId`. |
| Sala (estado) | `worker/index.js` (clase `GameRoom`) | Durable Object, desplegado como Worker separado (`script_name = "war-game-room"`): mantiene las conexiones, el lobby, persiste el estado y hace broadcast. |
| Orquestación | `js/main.js` | Une el cliente con el motor `Game` (ver más abajo). |

## Cliente — `js/multiplayer.js`

API (un único socket por pestaña, guardado en módulo):

| Función | Qué hace |
|---|---|
| `requestMatch()` | `GET /api/game-room?match=1` → devuelve `{ roomId, secondsLeft }`. Usado por el flujo "Online" para obtener la sala pública activa antes de llamar `joinRoom`. |
| `joinRoom(roomId, playerId, onMessage, playerName = 'Jugador', onJoinFailed, onClose, opts = {})` | Cierra cualquier socket previo y abre `ws(s)://<host>/api/game-room?roomId=…&playerId=…&playerName=…`. El protocolo es `wss` en HTTPS y `ws` en HTTP. `onMessage(data)` recibe cada mensaje ya parseado de JSON (JSON inválido y el mensaje fuera de banda `pong` se ignoran sin lanzar). Si el socket se cierra **antes** de abrirse (p. ej. la sala respondió `409` porque ya inició), llama `onJoinFailed?.()`. Si se cierra **después** de haber abierto: con `opts.reconnect` activo intenta **reconectar** (ver "Heartbeat y reconexión"); sin él, llama `onClose?.()`. `opts` acepta `{ public, openUntil, reconnect, onReconnecting, onReconnect }`. |
| `setMessageHandler(onMessage)` | Reemplaza el handler de mensajes del socket activo (lo usa `beginOnlineGame` al salir del lobby y entrar a la partida). |
| `sendAction(type, payload = {})` | Envía `{ type, payload }`. **No-op** si el socket no está `OPEN`. |
| `sendGameState(state)` | Atajo de `sendAction('game_state', state)`. |
| `setReady(ready)` | Atajo de `sendAction('set_ready', { ready })`. |
| `startGame(payload)` | Atajo de `sendAction('start_game', payload)`. El host le pasa `{ players, board, setupRemaining, attackUnlocked, firstRoundTurnsLeft }` — el estado inicial ya generado — para que todos los clientes (incluido el host) arranquen con un estado idéntico. |
| `disconnect()` | Cierra el socket y lo descarta. |
| `isConnected()` | `true` solo si hay socket y está `OPEN`. |

### Heartbeat y reconexión

El cliente mantiene la conexión viva y se recupera solo de cortes, porque los proxies de
Cloudflare cierran sockets inactivos y las redes móviles se caen a media partida:

- **Heartbeat:** mientras el socket está `OPEN`, envía `'ping'` cada **25 s** (`HEARTBEAT_MS`).
  El DO responde `'pong'` automáticamente (auto-response, ver más abajo); el cliente consume ese
  `'pong'` para refrescar su marca de vida y **no** lo entrega a `onMessage`. Si no llega ningún
  `'pong'` en **60 s** (`PONG_TIMEOUT_MS`), considera la conexión muerta y fuerza el cierre (lo
  que dispara la reconexión).
- **Reconexión con backoff:** solo si `opts.reconnect`. Cuando un socket ya abierto se cae,
  reintenta con esperas crecientes `[1, 2, 4, 8, 15, 15]s` (`BACKOFFS`). Antes de cada intento
  llama `onReconnecting(intento)`; al reabrir con éxito llama `onReconnect()`. Si se agotan los
  6 intentos, se rinde y llama `onClose?.()`. Cada nuevo intento reabre la URL con el mismo
  `playerId`, lo que permite al DO reconocer al jugador y reenviarle el estado (`state_sync`).
- **Sockets viejos:** los handlers ignoran eventos de un socket que ya no es el activo
  (`ws !== socket`), evitando que un cierre tardío del socket anterior aborte la nueva conexión.
- `disconnect()` marca el cierre como **manual** (no reconecta) y cancela los timers de heartbeat
  y de reconexión pendientes.

## Sala — Durable Object `GameRoom` (`worker/index.js`)

La Pages Function `functions/api/game-room.js` resuelve el DO por nombre de sala
(`env.GAME_ROOM.idFromName(roomId)`) y delega la request en él. El estado del lobby vive en
los *attachments* de cada socket (`{ name, ready }`); banderas y datos que sobreviven a la
hibernación se guardan en `state.storage`: `started`, el último `gameState` y `playerIds`
(ids autorizados a reconectar). El **constructor** registra un auto-response
`setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'))`: el runtime
contesta los `ping` del heartbeat **sin despertar al DO**, manteniendo viva la conexión
durante la inactividad (guardado en try/catch por si el runtime no expone la API).

- **`fetch(request)`** — exige el header `Upgrade: websocket` (si no, responde `426`).
  - Si `started` es `true`: solo se permite **reingreso**. Si el `playerId` está en
    `playerIds` (jugador que ya pertenecía a la partida), acepta el socket, le envía
    `state_sync` con el `gameState` guardado, **cancela la alarma de gracia**
    (`deleteAlarm`) y difunde `player_rejoined`. Cualquier `playerId` desconocido → `409`
    (`Room already started`).
  - Si la sala no inició y ya hay 6 sockets, responde `403` (sala llena; límite de 6).
  - Si no, crea un `WebSocketPair`, toma `playerId` y `playerName` del query (o un
    `crypto.randomUUID()` para el id) y lo acepta con `state.acceptWebSocket(server,
    [playerId])` — el `playerId` queda como **tag** del socket. Marca el attachment con
    `ready: true` (auto-listo al unirse) y difunde `lobby_update`. Responde `101`
    devolviendo el extremo cliente.
- **`webSocketMessage(ws, message)`** — parsea el JSON (inválido → ignora):
  - `type === 'game_state'` → persiste el payload en `state.storage` bajo la clave
    `gameState`, hace `broadcast` (con `from: playerId`) a todos menos al emisor, y si
    `payload.phase === 'gameover'` llama `resetRoom()`.
  - `type === 'set_ready'` → marca `players.get(playerId).ready` y difunde
    `lobby_update`.
  - `type === 'start_game'` → marca `started = true`, **persiste `playerIds`** (los ids de
    `payload.players`, para autorizar reconexiones a media partida) y retransmite el payload
    tal como llegó — `{ players, board, setupRemaining, attackUnlocked, firstRoundTurnsLeft }` — a
    **todos** (incluido el emisor) via `broadcast(null, …)`. El DO no genera ni
    modifica el estado inicial; lo calcula el host en el cliente (crea un `Game`
    temporal) y lo envía dentro del mensaje `start_game`.
  - cualquier otro tipo → se retransmite igual que `game_state` (broadcast a todos
    menos el emisor).

  Todo el handler corre dentro de un try/catch: un mensaje mal formado se loguea pero **no
  tumba el DO** ni desconecta al resto.
- **`webSocketClose(ws)`** — difunde `{ type: 'player_left', playerId }`. Si quedan otros
  sockets, emite `lobby_update`. Si la sala queda **vacía**: con partida en curso (`started`)
  agenda una **alarma de gracia de 45 s** (`RECONNECT_GRACE_MS`) conservando el estado para
  una posible reconexión; sin partida, llama `resetRoom()` de inmediato. (También en try/catch.)
- **`webSocketError(ws, error)`** — solo loguea; no propaga, para que un error de socket no
  tumbe el DO.
- **`alarm()`** — tiene **doble rol** según `started`:
  - Sala pública sin iniciar: se dispara 60 s después de que el primer jugador entra. Si hay
    ≥ 2 jugadores conectados arranca la partida automáticamente (equivale a que el host pulse
    "Iniciar"); si hay < 2, cancela y llama `resetRoom()`. Evita que las salas públicas queden
    bloqueadas esperando al host.
  - Partida en curso (gracia de reconexión agotada): si la sala sigue **vacía**, libera el
    estado con `resetRoom()`; si alguien volvió mientras tanto, no hace nada.
- **`resetRoom()`** — `state.storage.deleteAll()`, vacía `players` y pone
  `started = false`. Se llama al vaciarse la sala o al llegar a `gameover`, para que el
  mismo `roomId` se pueda reusar en una partida nueva.
- **`broadcastLobby()`** — emite `{ type: 'lobby_update', players: [{id, name, ready}, …] }`
  a todos los conectados (el orden del `Map` determina quién es el host: el primero en
  unirse).
- **`broadcast(excludeId, message)`** — itera `state.getWebSockets()`, lee el tag de cada
  uno con `state.getTags(ws)` y envía a los que no coinciden con `excludeId` (`null`
  envía a todos; errores de envío se tragan en try/catch).

El binding `GAME_ROOM` se declara en `wrangler.toml`; la migración `v1` está en `worker/wrangler.toml`
(ver [environment.md](environment.md)).

## Sincronización en `js/main.js`

Al crear o unirse a una sala, `enterLobby(code, playerName)`:

1. Llama `joinRoom(roomId, playerId, onLobbyMessage, playerName, onJoinFailed, onClose,
   { reconnect: true, onReconnecting, onReconnect })` (igual en el flujo online con
   `enterOnline`, que además incluye `public`/`openUntil`). El `playerId` es la dirección de
   wallet si hay una conectada (ver [onchain.md](onchain.md)), o un id anónimo aleatorio.
   Muestra `#screen-lobby`. Mientras se reintenta, `onReconnecting(n)` muestra un **banner de
   reconexión** no bloqueante ("Reconectando… (intento n)") y `onReconnect` lo oculta. `onClose`
   solo se invoca si la reconexión se **agota**: limpia el estado de lobby y vuelve a
   `#screen-start`.
2. `onLobbyMessage` reacciona a dos tipos: `lobby_update` (redibuja la lista de
   jugadores; el botón "Iniciar" solo aparece para el host —primer jugador de la lista—
   cuando **todos ≥ 2 jugadores** están listos; como todos se marcan auto-listos al
   unirse, basta con que haya 2+) y `start_game` (llama
   `beginOnlineGame(payload.players, payload.board, payload.setupRemaining, payload.attackUnlocked, payload.firstRoundTurnsLeft)`).
3. No hay checkbox de "listo"; cada jugador queda auto-listo al unirse (`ready: true` en
   el DO). El botón "Iniciar" (solo host) crea un `Game` temporal para generar el
   reparto de continentes y llama
   `startGame({ players, board, setupRemaining, attackUnlocked, firstRoundTurnsLeft })` —
   el estado inicial viaja dentro del mensaje para que todos arranquen de forma idéntica.
4. `beginOnlineGame(players, initialBoard, initialSetup, initialAttackUnlocked, initialFirstRoundTurnsLeft)` crea el `Game` + `UI` (con
   `myIndex` = posición del jugador local) y, si recibe `initialBoard`, pisa
   inmediatamente el board aleatorio local con el del host — eliminando la divergencia
   que producía `Math.random()` en `_distributeTerritories()`; también aplica `setupRemaining`,
   `initialAttackUnlocked` e `initialFirstRoundTurnsLeft` del host. Luego reemplaza el
   handler con `setMessageHandler` y **parchea los métodos mutadores de `Game`**
   (`placeSetupArmy`, `placeReinforcement`, `attack`, `endTurn`, `fortify`,
   `autoPlaceSetup`): cada uno, tras
   ejecutar el original, llama `sendGameState({ board, currentIndex, phase, setupRemaining, attackUnlocked, firstRoundTurnsLeft })`.
5. En el handler de partida, al recibir `game_state` —o `state_sync`, que llega tras
   reconectar a media partida y tiene la **misma forma**— aplica el estado remoto sobre el
   `Game` local (`Object.assign(game.board, …)`, `currentIndex`, `phase`, `setupRemaining`,
   `attackUnlocked`, `firstRoundTurnsLeft`) y hace `ui.refresh()`. Así un jugador que se cayó
   recupera el tablero exacto al volver.

Al terminar la partida (gana el jugador local) hace `POST /api/win` (ver
[api.md](api.md)); al terminar o salir, `main.js` llama `disconnect()`.

En partidas online, `ui.js` bloquea clics y acciones cuando no es tu turno
(`isMyTurn()`) y corre un temporizador de 90s por turno (`syncTimer`/`startTimer`); si
se agota, `handleTimeout()` resuelve el turno automáticamente (coloca refuerzos al
azar y termina el turno) para que un jugador inactivo no bloquee la partida.

> **Modelo de consistencia (MVP):** es *last-write-wins* por broadcast; no hay autoridad
> de servidor ni resolución de conflictos. El DO solo retransmite y guarda el último
> `gameState`. Adecuado para partidas cooperativas/confiadas, no para anti-cheat.

## Tests

`tests/multiplayer.test.js` (cliente, con `WebSocket`/`location` mockeados) y
`tests/api/game-room.test.js` (DO con un `state` falso) — ver [testing.md](testing.md).

Ver también: [environment.md](environment.md) (binding y migración),
[api.md](api.md) (endpoints), [architecture.md](architecture.md).
