# Arquitectura

WAR separa **lógica pura**, **render/interacción** y **arranque**. El motor del
juego no conoce el DOM; la UI no contiene reglas; `main.js` orquesta y habla con la red.

## Estructura de carpetas

```
WAR/
├── home/index.html         # landing page (/home) — primera pantalla pública
├── index.html              # pantallas de inicio/juego (.screen)
├── login.html              # pantalla de login (/login)
├── lobby/index.html        # hub de navegación (/lobby) — landing tras login; enlaza a /game, /my-profile, /gamers
├── game/index.html         # pantalla de juego servida en /game (importmap de pixi/ethers)
├── register/index.html     # formulario de registro (/register) — primer login
├── gamers/index.html       # ranking de jugadores (/gamers)
├── my-profile/index.html   # perfil del jugador autenticado (/my-profile)
├── map-preview.html        # dev-only: SVG estático del mapa para QA visual (sin JS, sin enlaces desde la app; NO excluido del deploy — accesible pero no enlazado)
├── css/style.css           # estilos
├── js/
│   ├── map-data.js         # datos del mapa: territorios/continentes/adyacencias (puro)
│   ├── map-shapes.js       # formas SVG + centros de etiqueta (GENERADO, puro)
│   ├── game.js             # motor del juego (puro)
│   ├── ui.js               # render SVG + interacción (DOM) + overlay Pixi
│   ├── pixi-overlay.js     # animaciones de batalla sobre el mapa (Pixi.js, DOM)
│   ├── multiplayer.js      # cliente WebSocket de la sala (red)
│   ├── wallet.js           # wallet Web3 / ethers (red externa)
│   └── main.js             # arranque + wallet + sala (DOM + fetch)
├── functions/api/win.js     # Pages Function: /api/win — +1 victoria del usuario autenticado (D1)
├── functions/api/gamers.js # Pages Function: /api/gamers — ranking top 100 (D1)
├── functions/api/profile.js # Pages Function: /api/profile — perfil autenticado (D1)
├── functions/api/register.js # Pages Function: /api/register — registro de usuario (D1)
├── functions/gamers/[username].js # Pages Function: /gamers/<username> — perfil HTML público (D1)
├── functions/api/game-room.js # Pages Function: routing de /api/game-room (WS) al Durable Object
├── worker/index.js          # Durable Object GameRoom (Worker separado, script_name "war-game-room")
├── functions/api/auth/
│   ├── google.js           # inicia OAuth con Google (/api/auth/google)
│   ├── callback.js         # completa OAuth, guarda cookie, bifurca /lobby o /register
│   └── wallet.js           # login alterno con wallet (/api/auth/wallet)
├── functions/api/wallet/
│   └── link.js             # vincula wallet a la cuenta de la sesión (/api/wallet/link)
├── migrations/
│   └── 0001_users.sql      # migración: borra scores, crea users
├── scripts/build-map-shapes.mjs # dev-only: genera map-shapes.js desde Natural Earth
├── scripts/dev.mjs              # dev-only: arranca DO Worker + Pages en paralelo con TLS compartido
├── tests/                  # node --test (excluido del deploy)
├── wrangler.toml           # config Cloudflare (binding DB)
├── _headers                # cabeceras de seguridad/caché
├── _redirects              # redirige / → /home (Cloudflare Pages)
└── .assetsignore           # excluye tests/ del upload de Pages
```

## Módulos y responsabilidades

| Módulo | Tipo | Responsabilidad |
|---|---|---|
| `js/map-data.js` | Datos puros | 44 territorios, 6 continentes (cada uno con campo `bonus`, actualmente sin uso en cálculo de refuerzos), grafo de adyacencias (bidireccional vía `buildAdjacency()`), ejércitos iniciales, colores. |
| `js/map-shapes.js` | Datos puros (**generado**) | Geometría del mapa: `TERRITORY_SHAPES` (paths SVG por territorio), `TERRITORY_CENTERS` (punto de etiqueta interior), `MAP_VIEWBOX`, `SEA_ROUTES` y `TERRITORY_CLIPS`. **No editar a mano**: lo regenera `scripts/build-map-shapes.mjs` (`npm run build:map`). |
| `js/game.js` | Lógica pura (clase `Game`) | Estado del tablero, turnos y fases, combate por dados, refuerzos, conquista, eliminación y victoria. **Sin DOM.** El reparto inicial asigna un continente completo a cada jugador (resto del mapa sin dueño), en vez de territorios sueltos al azar. El setup es fijo: cada jugador coloca exactamente 5 ejércitos (`setupRemaining[i] = 5`); el turno no rota hasta agotar los 5. **Refuerzos:** `floor(territorios / 2)` — fórmula plana, sin mínimo ni bonus de continente. Los ataques comienzan bloqueados (`attackUnlocked = false`); `endTurn()` decrementa `firstRoundTurnsLeft` y activa `attackUnlocked` al completar la primera ronda completa. `canAttack()` exige `attackUnlocked === true`. |
| `js/ui.js` | Vista (clase `UI`) | Construye el mapa SVG una vez a partir de las formas de `map-shapes.js` (paths reales con proyección geográfica, `clipPath` para los países partidos); cada nodo lleva el nombre del territorio (`<text class="label">`) sobre el contador de ejércitos (`<text class="count">`). Refresca nodos/sidebar/banner según el estado, traduce clics a llamadas del motor, muestra dados y modales (conquista/movimiento de tropas). **No decide reglas ni genera geometría**: solo refleja el estado y delega en `Game`. El banner de turno se renderiza como tarjeta de jugador + etiqueta de fase ("Despliegue" o "Turno libre"), escapando el nombre con `escapeHtml`. En fase `play`, el modo "Colocar tropas" (`placingMode`) se activa con un botón toggle; sin él, los clics unifican ataque y movimiento de tropas en un solo flujo. En partidas online (`opts.myIndex` presente) bloquea clics/acciones fuera de tu turno (`isMyTurn()`) y corre un temporizador de 90s por turno que auto-resuelve el turno si se agota (`handleTimeout`). Si `attackUnlocked === false`, muestra un indicador 🔒; el botón "Terminar turno" cierra el turno en cualquier momento. |
| `js/main.js` | Arranque | Pantalla de inicio con pestañas Local / Online / Crear sala / Unirse. `startLocalGame()` arranca una partida hotseat sin red. En el flujo "Online", llama `requestMatch()` para obtener la sala pública activa (`GET /api/game-room?match=1`) y muestra un modal de cuenta regresiva (60 s); al unirse usa `enterLobby()` igual que en "Crear sala" / "Unirse". `enterLobby()` une al jugador a la sala (lobby con lista de jugadores y "listo"), y al recibir `start_game` llama `beginOnlineGame(players, initialBoard, initialSetup, initialAttackUnlocked, initialFirstRoundTurnsLeft)`, que crea `Game` + `UI`, aplica el estado inicial del host (incluyendo `attackUnlocked` y `firstRoundTurnsLeft`) y parchea los métodos mutadores para sincronizar por WebSocket (el payload de `sendGameState` incluye `attackUnlocked` y `firstRoundTurnsLeft`). Al terminar una partida online, si el jugador local ganó, hace `POST /api/win`. |
| `js/pixi-overlay.js` | Vista (overlay) | Canvas Pixi.js superpuesto al mapa SVG; dibuja partículas/línea/etiqueta de cada batalla. Lo inicia y dispara `ui.js`. Ver [stack.md](stack.md). |
| `js/multiplayer.js` | Cliente de red | Cliente WebSocket de la sala (`joinRoom`/`sendGameState`/…), con heartbeat ping/pong y reconexión automática con backoff. Detalle en [realtime.md](realtime.md). |
| `js/wallet.js` | Web3 | Conexión a MetaMask vía ethers; identidad de jugador, login/vinculación por firma (`signMessage`) y mint/claim experimental. Detalle en [onchain.md](onchain.md). |
| `functions/api/win.js` | Backend | `POST /api/win`: incrementa `wins` del usuario autenticado (`war_session`). Ver [api.md](api.md). |
| `functions/api/gamers.js` | Backend | `GET /api/gamers`: devuelve top 100 jugadores por wins desde `users`. Sin auth. |
| `functions/api/profile.js` | Backend | `GET /api/profile`: devuelve `{username, wins}` del usuario autenticado. Requiere `war_session`. |
| `functions/api/register.js` | Backend | `POST /api/register`: valida y persiste el registro de un nuevo usuario en `users`. Requiere `war_session`. |
| `functions/gamers/[username].js` | Backend (página) | `GET /gamers/<username>`: renderiza una página HTML de perfil público (`username` + `wins`) desde `users`; 404 HTML si no existe. Sin auth. La enlaza el ranking. Ver [api.md](api.md). |
| `functions/api/game-room.js` | Backend | Routing de `/api/game-room`: resuelve el Durable Object `GameRoom` por `roomId` y delega la request. |
| `worker/index.js` | Backend (Durable Object) | Sala multijugador `GameRoom`: lobby (jugadores/listos), WebSocket, broadcast, persistencia del estado y reconexión con ventana de gracia (auto-pong + reingreso por `playerId`). Ver [realtime.md](realtime.md). |
| `functions/api/auth/google.js` | Backend | Inicia el flujo OAuth 2.0: redirige a Google con los parámetros del cliente. |
| `functions/api/auth/callback.js` | Backend | Completa OAuth: canjea el code, obtiene el perfil del usuario, guarda cookie `war_session` y redirige a `/lobby` (registrado) o `/register` (nuevo). |
| `functions/api/auth/wallet.js` | Backend | `POST /api/auth/wallet`: verifica firma (`ethers.verifyMessage`) y, si la wallet ya está vinculada a una cuenta, emite la misma cookie `war_session` que el login con Google. |
| `functions/api/wallet/link.js` | Backend | `POST /api/wallet/link`: requiere `war_session`; verifica firma y guarda `wallet_address` en `users` (409 si ya pertenece a otra cuenta). |

## Flujo principal

```
main.js  ──crea──>  Game (estado/reglas)
   │                  ▲
   │ crea            │ llamadas (attack, placeReinforcement, …)
   ▼                  │
  UI  ──clics──────────┘
   │  (refresh: lee Game y redibuja)
   │
  fin de partida (online, gané) ──> main.onGameOver ──POST /api/win──> Function ──> D1

/game ──pestaña "Local"──> startLocalGame() ──> Game + UI (hotseat, sin red)

/game ──pestaña "Crear sala"/"Unirse"──> enterLobby(code, name)
                                              │ joinRoom (WS /api/game-room)
                                              ▼
                                        #screen-lobby (lobby_update: jugadores + listos)
                                              │ host pulsa "Iniciar" cuando todos listos
                                              ▼ start_game
                                        beginOnlineGame() ──> Game + UI sincronizados

/login ──clic──> GET /api/auth/google ──302──> Google OAuth
                                                    │
                                             GET /api/auth/callback?code=…
                                                    │ Set-Cookie war_session
                                                    ├─ registrado ──302──> /lobby
                                                    └─ nuevo      ──302──> /register
                                                                               │ POST /api/register
                                                                               └──302──> /lobby

/login ──clic "Conectar MetaMask"──> firma mensaje ──POST /api/auth/wallet──> Set-Cookie war_session ──> /lobby
/my-profile ──clic "Conectar wallet"──> firma mensaje ──POST /api/wallet/link──> guarda wallet_address

/home ──clic "Jugar Ahora"──> /lobby (GET /api/profile; sin sesión ──> /login)
/lobby ──hub──> /game · /my-profile · /gamers
/game, /my-profile, /gamers ──"← Lobby"──> /lobby
```

- **Game → UI:** la UI nunca muta el tablero directamente; llama métodos de `Game`
  (que validan con sus guardas: `canAttack`, `canFortify`, fase, etc.) y luego
  `refresh()` para re-leer el estado.
- **Ataque:** al elegir origen+destino, la UI abre un modal donde el jugador elige
  con **cuántas unidades** atacar (1 hasta `maxAttackUnits` = `armies-1`, siempre deja
  1 atrás) = ese número de dados; el defensor tira con **todas** sus tropas. `attack`
  resuelve los dados de una vez y, si el defensor llega a 0, los atacantes
  supervivientes **ocupan la zona automáticamente**. No hay transición de fase; el turno
  sigue en `play` y el jugador puede seguir atacando o mover tropas antes de terminar.
- **Movimiento de tropas:** en fase `play`, sin modo `placingMode` activo, clicar
  propio→aliado adyacente abre un modal con un rango `[min, max]` y confirma con
  `fortify`. El movimiento no termina el turno automáticamente.
- **Red:** `main.js` toca `fetch` solo para `/api/win` (registro de victoria al ganar
  una partida online). Los endpoints `/api/auth/*` se invocan por **navegación del
  browser** desde `login.html` (vía `<a href>`), no por `fetch` programático.
- **Multijugador (opcional):** al crear o unirse a una sala, `main.js` entra a un
  **lobby** (`enterLobby`) que abre un WebSocket (`joinRoom`) y muestra la lista de
  jugadores conectados con su estado "listo" (`lobby_update`). Solo el host puede
  pulsar "Iniciar" y solo cuando todos están listos; al hacerlo emite `start_game`,
  que dispara `beginOnlineGame()` en todos los clientes. El mensaje `start_game` lleva
  embebido el board inicial (`{ players, board, setupRemaining, attackUnlocked, firstRoundTurnsLeft }`) generado por el host,
  garantizando que todos arranquen con el mismo mapa sin importar la aleatoriedad local.
  A partir de ahí **parchea los
  métodos mutadores de `Game`** para emitir `sendGameState` tras cada acción → el
  Durable Object `GameRoom` hace `broadcast` → los demás reciben `game_state`, lo
  aplican al `Game` local y hacen `ui.refresh()`. En modo online, `ui.js` además
  bloquea la interacción fuera de tu turno y corre un temporizador de 90s por turno
  que lo auto-resuelve si se agota. La conexión se **recupera sola**: el cliente manda
  un heartbeat y reconecta con backoff, y el DO conserva la partida durante una ventana
  de gracia para que el jugador que se cayó reciba el estado (`state_sync`) al volver.
  Detalle en [realtime.md](realtime.md).
- **Wallet (opcional):** la dirección de MetaMask sirve como identidad de jugador
  (`playerId` en la sala) y se muestra en la topbar. Ver [onchain.md](onchain.md).
- **Animación:** en cada ataque, `ui.js` llama `playBattleAnimation` del overlay Pixi
  (`pixi-overlay.js`) sobre las coordenadas de pantalla de los territorios implicados.

## Por qué esta separación

`game.js`, `map-data.js` y `map-shapes.js` son ESM puros → testeables sin DOM (ver
[testing.md](testing.md)) y reutilizables. La geometría del mapa se **precalcula**
fuera del navegador (`build:map`) en vez de generarse en runtime: el cliente solo
carga paths estáticos, sin coste de cómputo ni dependencias de gráficos en la página.
Si la lógica del motor creciera demasiado para esta página, extraer un
`game-engine.md` dedicado.
