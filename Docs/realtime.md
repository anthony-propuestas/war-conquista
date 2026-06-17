# Tiempo real — Multijugador (WebSocket + Durable Object)

WAR permite jugar la misma partida en varios navegadores sincronizando el estado por
WebSocket. La sala vive en un **Durable Object** de Cloudflare (`GameRoom`); cada cliente
se conecta y recibe/emite el estado del juego.

## Piezas

| Pieza | Archivo | Rol |
|---|---|---|
| Cliente WS | `js/multiplayer.js` | Abre el socket, parsea mensajes, expone `send*`. |
| Endpoint + routing | `functions/api/game-room.js` (default export) | Pages Function que enruta `/api/game-room` al Durable Object por `roomId`. |
| Sala (estado) | `worker/index.js` (clase `GameRoom`) | Durable Object, desplegado como Worker separado (`script_name = "war-game-room"`): mantiene las conexiones, el lobby, persiste el estado y hace broadcast. |
| Orquestación | `js/main.js` | Une el cliente con el motor `Game` (ver más abajo). |

## Cliente — `js/multiplayer.js`

API (un único socket por pestaña, guardado en módulo):

| Función | Qué hace |
|---|---|
| `joinRoom(roomId, playerId, onMessage, playerName = 'Jugador', onJoinFailed)` | Cierra cualquier socket previo y abre `ws(s)://<host>/api/game-room?roomId=…&playerId=…&playerName=…`. El protocolo es `wss` en HTTPS y `ws` en HTTP. `onMessage(data)` recibe cada mensaje ya parseado de JSON (JSON inválido se ignora sin lanzar). Si el socket se cierra antes de llegar a abrirse (p. ej. la sala respondió `409` porque ya inició), llama `onJoinFailed?.()`. |
| `setMessageHandler(onMessage)` | Reemplaza el handler de mensajes del socket activo (lo usa `beginOnlineGame` al salir del lobby y entrar a la partida). |
| `sendAction(type, payload = {})` | Envía `{ type, payload }`. **No-op** si el socket no está `OPEN`. |
| `sendGameState(state)` | Atajo de `sendAction('game_state', state)`. |
| `setReady(ready)` | Atajo de `sendAction('set_ready', { ready })`. |
| `startGame(players)` | Atajo de `sendAction('start_game', { players })`. Solo el host debería llamarlo. |
| `disconnect()` | Cierra el socket y lo descarta. |
| `isConnected()` | `true` solo si hay socket y está `OPEN`. |

## Sala — Durable Object `GameRoom` (`worker/index.js`)

El default export de `functions/api/game-room.js` resuelve el DO por nombre de sala
(`env.GAME_ROOM.idFromName(roomId)`) y delega la request en él. La clase mantiene un
mapa `players` (`playerId` → `{ name, ready }`) y una bandera `started`:

- **`fetch(request)`** — exige el header `Upgrade: websocket` (si no, responde `426`).
  Si `started` es `true`, responde `409` (sala ya en partida, no admite más jugadores).
  Si no, crea un `WebSocketPair`, toma `playerId` y `playerName` del query (o un
  `crypto.randomUUID()` para el id) y lo acepta con `state.acceptWebSocket(server,
  [playerId])` — el `playerId` queda como **tag** del socket. Agrega el jugador a
  `players` con `ready: false` y difunde `lobby_update`. Responde `101` devolviendo el
  extremo cliente.
- **`webSocketMessage(ws, message)`** — parsea el JSON (inválido → ignora):
  - `type === 'game_state'` → persiste el payload en `state.storage` bajo la clave
    `gameState`, hace `broadcast` (con `from: playerId`) a todos menos al emisor, y si
    `payload.phase === 'gameover'` llama `resetRoom()`.
  - `type === 'set_ready'` → marca `players.get(playerId).ready` y difunde
    `lobby_update`.
  - `type === 'start_game'` → marca `started = true` y hace `broadcast(null, …)` (a
    **todos**, incluido el emisor) para que cada cliente arranque `beginOnlineGame`.
  - cualquier otro tipo → se retransmite igual que `game_state` (broadcast a todos
    menos el emisor).
- **`webSocketClose(ws)`** — borra al jugador de `players`, difunde
  `{ type: 'player_left', playerId }` y `lobby_update`; si `players` queda vacío llama
  `resetRoom()`.
- **`resetRoom()`** — `state.storage.deleteAll()`, vacía `players` y pone
  `started = false`. Se llama al vaciarse la sala o al llegar a `gameover`, para que el
  mismo `roomId` se pueda reusar en una partida nueva.
- **`broadcastLobby()`** — emite `{ type: 'lobby_update', players: [{id, name, ready}, …] }`
  a todos los conectados (el orden del `Map` determina quién es el host: el primero en
  unirse).
- **`broadcast(excludeId, message)`** — itera `state.getWebSockets()`, lee el tag de cada
  uno con `state.getTags(ws)` y envía a los que no coinciden con `excludeId` (`null`
  envía a todos; errores de envío se tragan en try/catch).

El binding `GAME_ROOM` y la migración `v1` se declaran en `wrangler.toml`
(ver [environment.md](environment.md)).

## Sincronización en `js/main.js`

Al crear o unirse a una sala, `enterLobby(code, playerName)`:

1. Llama `joinRoom(roomId, playerId, onLobbyMessage, playerName, onJoinFailed)`. El
   `playerId` es la dirección de wallet si hay una conectada (ver [onchain.md](onchain.md)),
   o un id anónimo aleatorio. Muestra `#screen-lobby`.
2. `onLobbyMessage` reacciona a dos tipos: `lobby_update` (redibuja la lista de
   jugadores y su estado "listo"; el botón "Iniciar" solo aparece para el host —primer
   jugador de la lista— cuando todos están listos) y `start_game` (llama
   `beginOnlineGame(payload.players)`).
3. El checkbox "Estoy listo" llama `setReady(checked)`; el botón "Iniciar" (solo host)
   llama `startGame(players)`.
4. `beginOnlineGame(players)` crea el `Game` + `UI` (con `myIndex` = posición del
   jugador local), reemplaza el handler con `setMessageHandler` para procesar
   `game_state` durante la partida, y **parchea los métodos mutadores de `Game`**
   (`placeSetupArmy`, `placeReinforcement`, `attack`, `endReinforce`, `endAttack`,
   `skipFortify`, `fortify`, `moveAfterConquest`, `autoPlaceSetup`): cada uno, tras
   ejecutar el original, llama `sendGameState({ board, currentIndex, phase })`. Así
   cualquier acción local se propaga sin tocar el motor.
5. En el handler de partida, al recibir `game_state` aplica el estado remoto sobre el
   `Game` local (`Object.assign(game.board, …)`, `currentIndex`, `phase`) y hace
   `ui.refresh()`.

Al terminar la partida (gana el jugador local) hace `POST /api/win` (ver
[api.md](api.md)); al terminar o salir, `main.js` llama `disconnect()`.

En partidas online, `ui.js` bloquea clics y acciones cuando no es tu turno
(`isMyTurn()`) y corre un temporizador de 30s por fase (`syncTimer`/`startTimer`); si
se agota, `handleTimeout()` resuelve la fase automáticamente (coloca refuerzos al
azar, confirma el mínimo de conquista, salta fortificación) para que un jugador
inactivo no bloquee la partida.

> **Modelo de consistencia (MVP):** es *last-write-wins* por broadcast; no hay autoridad
> de servidor ni resolución de conflictos. El DO solo retransmite y guarda el último
> `gameState`. Adecuado para partidas cooperativas/confiadas, no para anti-cheat.

## Tests

`tests/multiplayer.test.js` (cliente, con `WebSocket`/`location` mockeados) y
`tests/api/game-room.test.js` (DO con un `state` falso) — ver [testing.md](testing.md).

Ver también: [environment.md](environment.md) (binding y migración),
[api.md](api.md) (endpoints), [architecture.md](architecture.md).
