# Tiempo real — Multijugador (WebSocket + Durable Object)

WAR permite jugar la misma partida en varios navegadores sincronizando el estado por
WebSocket. La sala vive en un **Durable Object** de Cloudflare (`GameRoom`); cada cliente
se conecta y recibe/emite el estado del juego.

## Piezas

| Pieza | Archivo | Rol |
|---|---|---|
| Cliente WS | `js/multiplayer.js` | Abre el socket, parsea mensajes, expone `send*`. |
| Endpoint + routing | `functions/game-room.js` (default export) | Pages Function que enruta `/api/game-room` al Durable Object por `roomId`. |
| Sala (estado) | `functions/game-room.js` (clase `GameRoom`) | Durable Object: mantiene las conexiones, persiste el estado y hace broadcast. |
| Orquestación | `js/main.js` | Une el cliente con el motor `Game` (ver más abajo). |

## Cliente — `js/multiplayer.js`

API (un único socket por pestaña, guardado en módulo):

| Función | Qué hace |
|---|---|
| `joinRoom(roomId, playerId, onMessage)` | Cierra cualquier socket previo y abre `ws(s)://<host>/api/game-room?roomId=…&playerId=…`. El protocolo es `wss` en HTTPS y `ws` en HTTP. `onMessage(data)` recibe cada mensaje ya parseado de JSON (JSON inválido se ignora sin lanzar). |
| `sendAction(type, payload = {})` | Envía `{ type, payload }`. **No-op** si el socket no está `OPEN`. |
| `sendGameState(state)` | Atajo de `sendAction('game_state', state)`. |
| `disconnect()` | Cierra el socket y lo descarta. |
| `isConnected()` | `true` solo si hay socket y está `OPEN`. |

## Sala — Durable Object `GameRoom`

El default export de `functions/game-room.js` resuelve el DO por nombre de sala
(`env.GAME_ROOM.idFromName(roomId)`) y delega la request en él. La clase:

- **`fetch(request)`** — exige el header `Upgrade: websocket` (si no, responde `426`).
  Crea un `WebSocketPair`, toma el `playerId` del query (o un `crypto.randomUUID()`) y lo
  acepta con `state.acceptWebSocket(server, [playerId])` — el `playerId` queda como **tag**
  del socket. Responde `101` devolviendo el extremo cliente.
- **`webSocketMessage(ws, message)`** — parsea el JSON (inválido → ignora). Si
  `type === 'game_state'`, persiste el payload en `state.storage` bajo la clave
  `gameState`. Luego hace `broadcast` del mensaje (con `from: playerId`) **a todos menos
  al emisor**.
- **`webSocketClose(ws)`** — difunde `{ type: 'player_left', playerId }` al resto.
- **`broadcast(excludeId, message)`** — itera `state.getWebSockets()`, lee el tag de cada
  uno con `state.getTags(ws)` y envía a los que no coinciden con `excludeId` (errores de
  envío se tragan en try/catch).

El binding `GAME_ROOM` y la migración `v1` se declaran en `wrangler.toml`
(ver [environment.md](environment.md)).

## Sincronización en `js/main.js`

Cuando el jugador indica una sala (`#room-input`), `startGame()`:

1. Llama `joinRoom(roomId, playerId, …)`. El `playerId` es la dirección de wallet si hay
   una conectada (ver [onchain.md](onchain.md)), o un id anónimo aleatorio.
2. **Parchea los métodos mutadores de `Game`** (`placeSetupArmy`, `placeReinforcement`,
   `attack`, `endReinforce`, `endAttack`, `skipFortify`, `fortify`, `moveAfterConquest`,
   `autoPlaceSetup`): cada uno, tras ejecutar el original, llama `sendGameState({ board,
   currentIndex, phase })`. Así cualquier acción local se propaga sin tocar el motor.
3. En `onMessage`, al recibir `game_state` aplica el estado remoto sobre el `Game` local
   (`Object.assign(game.board, …)`, `currentIndex`, `phase`) y hace `ui.refresh()`.

Al terminar la partida o salir, `main.js` llama `disconnect()`.

> **Modelo de consistencia (MVP):** es *last-write-wins* por broadcast; no hay autoridad
> de servidor ni resolución de conflictos. El DO solo retransmite y guarda el último
> `gameState`. Adecuado para partidas cooperativas/confiadas, no para anti-cheat.

## Tests

`tests/multiplayer.test.js` (cliente, con `WebSocket`/`location` mockeados) y
`tests/api/game-room.test.js` (DO con un `state` falso) — ver [testing.md](testing.md).

Ver también: [environment.md](environment.md) (binding y migración),
[api.md](api.md) (endpoints), [architecture.md](architecture.md).
