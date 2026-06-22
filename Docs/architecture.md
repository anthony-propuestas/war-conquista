# Arquitectura

WAR separa **lógica pura**, **render/interacción** y **arranque**. El motor del
juego no conoce el DOM; la UI no contiene reglas; `main.js` orquesta y habla con la red.

## Estructura de carpetas

```
WAR/
├── home/index.html         # landing page (/home) — primera pantalla pública
├── index.html              # pantallas de inicio/juego (.screen)
├── login.html              # pantalla de login (/login)
├── lobby/index.html        # hub de navegación (/lobby) — landing tras login; enlaza a /game, /battle-pass, /my-profile, /gamers
├── game/index.html         # pantalla de juego servida en /game (importmap de pixi/ethers); incluye panel #items-panel
├── register/index.html     # formulario de registro (/register) — primer login
├── gamers/index.html       # ranking de jugadores (/gamers)
├── my-profile/index.html   # perfil del jugador autenticado (/my-profile)
├── battle-pass/index.html  # página de battle pass (/battle-pass) — calendario + botón claim
├── admin/index.html        # panel de administración (/admin) — gestión de cartas y calendario
├── shop/index.html         # tienda on-chain (/shop) — balance WGT, inventario, compra de items
├── contracts/              # contratos Solidity (Foundry) — no se despliegan como parte del build
│   └── src/WGTToken.sol · src/ItemShop.sol · script/Deploy.s.sol
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
├── functions/_lib/
│   └── session.js          # módulo compartido: createSessionCookie / getSession (HMAC-SHA256)
├── functions/api/auth/
│   ├── google.js           # inicia OAuth con Google (/api/auth/google)
│   ├── callback.js         # completa OAuth, guarda cookie, bifurca /lobby o /register
│   └── wallet.js           # login alterno con wallet (/api/auth/wallet)
├── functions/api/wallet/
│   └── link.js             # vincula wallet a la cuenta de la sesión (/api/wallet/link)
├── functions/api/cards/
│   ├── inventory.js        # GET /api/cards/inventory — inventario de cartas del jugador
│   ├── use.js              # POST /api/cards/use — usar carta en partida (marca used_at)
│   └── delete.js           # DELETE /api/cards/delete?id= — descartar carta del inventario
├── functions/api/battle-pass/
│   ├── status.js           # GET /api/battle-pass/status — estado del battle pass del jugador
│   └── claim.js            # POST /api/battle-pass/claim — reclamar recompensa diaria
├── functions/api/shop/
│   ├── inventory.js        # GET /api/shop/inventory — inventario de items comprados del jugador
│   ├── pending-wgt.js      # GET /api/shop/pending-wgt — total WGT reclamable
│   └── listings.js         # GET /api/shop/listings — cartas disponibles en la tienda (público)
├── functions/api/claim-wgt.js  # POST /api/claim-wgt — verifica firma ECDSA + mintea WGT en Base
├── functions/api/deliver-item.js # POST /api/deliver-item — verifica txHash en Base + entrega item en D1
├── functions/api/admin/
│   ├── cards.js            # GET|POST|PUT|DELETE /api/admin/cards — CRUD card_definitions
│   ├── battle-pass.js      # GET|POST|DELETE /api/admin/battle-pass — CRUD battle_pass_rewards
│   └── shop-listings.js    # GET|POST|DELETE /api/admin/shop-listings — catálogo de la tienda
├── migrations/
│   ├── 0001_users.sql          # migración: borra scores, crea users
│   ├── 0002_items.sql          # migración: crea card_definitions, user_cards, battle_pass_rewards, battle_pass_progress
│   ├── 0003_onchain.sql        # migración: crea user_monthly_wins, user_shop_items, delivered_txs; inserta los 3 items iniciales
│   ├── 0004_shop_listings.sql  # migración: crea shop_listings (catálogo de la tienda)
│   └── 0005_shop_price.sql     # migración: añade wgt_price a shop_listings
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
| `js/game.js` | Lógica pura (clase `Game`) | Estado del tablero, turnos y fases, combate por dados, refuerzos, conquista, eliminación y victoria. **Sin DOM.** El reparto inicial asigna un continente completo a cada jugador (resto del mapa sin dueño), en vez de territorios sueltos al azar. El setup es fijo: cada jugador coloca exactamente 5 ejércitos (`setupRemaining[i] = 5`); el turno no rota hasta agotar los 5. **Refuerzos:** `floor(territorios / 2)` — fórmula plana, sin mínimo ni bonus de continente. Los ataques comienzan bloqueados (`attackUnlocked = false`); `endTurn()` decrementa `firstRoundTurnsLeft` y activa `attackUnlocked` al completar la primera ronda completa. `canAttack()` exige `attackUnlocked === true`. **Rondas:** `endTurn()` lleva un contador `round` (avanza un punto cada vez que se completa un ciclo de todos los jugadores). **Rendición:** `canSurrender()` es `true` desde la **ronda 7**; `surrender(playerId)` marca al jugador como `alive: false` pero **deja sus territorios en el mapa** (siguen conquistables por los demás) y, si era su turno, avanza al siguiente. **Victoria:** `_checkWin()` declara ganador al **último jugador vivo** (o a quien logre la dominación total del mapa), con guard para no falsear victoria en partidas de 1 jugador. **Items de mejora:** `applyCardEffect(playerId, effectType, effectValue)` aplica cartas del inventario al jugador en turno (requiere fase `play` y que sea el turno del jugador). `EXTRA_UNITS` suma `effectValue` a `this.reinforcements`; `DOUBLE_ATTACK` activa el flag `_doubleAttack` que en el próximo `attack()` duplica el número de dados del atacante (se consume al usarse); `SHIELD` activa `_shield = playerId` que, si el owner del territorio defensor coincide, fuerza todos sus dados a 6 (se consume al resolverse el combate). |
| `js/ui.js` | Vista (clase `UI`) | Construye el mapa SVG una vez a partir de las formas de `map-shapes.js` (paths reales con proyección geográfica, `clipPath` para los países partidos); cada nodo lleva el nombre del territorio (`<text class="label">`) sobre el contador de ejércitos (`<text class="count">`). Refresca nodos/sidebar/banner según el estado, traduce clics a llamadas del motor, muestra dados y modales (conquista/movimiento de tropas). **No decide reglas ni genera geometría**: solo refleja el estado y delega en `Game`. El banner de turno se renderiza como tarjeta de jugador + etiqueta de fase ("Despliegue" o "Turno libre"), escapando el nombre con `escapeHtml`. En fase `play`, el modo "Colocar tropas" (`placingMode`) se activa con un botón toggle; sin él, los clics implementan un **flujo de ataque de dos pasos**: clic en zona enemiga → establece `pendingTarget` y muestra con `.source-hint` las zonas propias que pueden atacarla; clic en zona propia con `pendingTarget` activo → lanza el ataque abriendo el modal de dados. `arrowsLayer` superpone flechas SVG animadas (`.attack-arrow`) desde la zona seleccionada hacia sus enemigos adyacentes atacables. Las zonas atacables se marcan con `.attack-target`; las de fortify con `.fortify-target`. En partidas online (`opts.myIndex` presente) bloquea clics/acciones fuera de tu turno (`isMyTurn()`) y corre un temporizador de 90s por turno que auto-resuelve el turno si se agota (`handleTimeout`). Si `attackUnlocked === false`, muestra un indicador 🔒; el botón "Terminar turno" cierra el turno en cualquier momento. El panel de fase muestra la **ronda actual** y un botón "Rendirse" deshabilitado hasta la ronda 7 (`canSurrender()`). **Panel de cartas:** acepta `opts.playerCards` en el constructor (copia local de `{ id, name, description, effect_type, effect_value, used_at }`); `renderItemsPanel()` dibuja cada carta con ícono de efecto, nombre, descripción y botones "Usar"/"Descartar" (activos solo en `isMyTurn() && game.phase === 'play'`). `_useCard(id)` es `async`: llama `game.applyCardEffect()` inmediatamente, añade el id a `usedInSession` (sincronía optimista), llama el callback `onCardUsed(card, playerName)` (provisto por `main.js` en partidas online, emite `card_used` por WS) y luego hace `await fetch` a `POST /api/cards/use`; si el servidor devuelve 409 (doble uso concurrente) conserva la carta como usada de todas formas. `_discardCard(id)` filtra la carta del array local y llama `DELETE /api/cards/delete?id=` en background. |
| `js/main.js` | Arranque | Pantalla de inicio con pestañas Local / Online / Crear sala / Unirse. `startLocalGame()` arranca una partida hotseat sin red. En el flujo "Online", llama `requestMatch()` para obtener la sala pública activa (`GET /api/game-room?match=1`) y muestra un modal de cuenta regresiva (60 s); al unirse usa `enterLobby()` igual que en "Crear sala" / "Unirse". `enterLobby()` une al jugador a la sala (lobby con lista de jugadores y "listo"), y al recibir `start_game` llama `beginOnlineGame(players, initialBoard, initialSetup, initialAttackUnlocked, initialFirstRoundTurnsLeft)`, que crea `Game` + `UI`, aplica el estado inicial del host (incluyendo `attackUnlocked` y `firstRoundTurnsLeft`) y parchea los métodos mutadores (incluido `surrender` y `applyCardEffect`) para sincronizar por WebSocket (el payload de `sendGameState` incluye `round`, `winner` y `alive`, además de `attackUnlocked`/`firstRoundTurnsLeft`). Al terminar cualquier partida muestra una pantalla **ganó/perdió** con la clasificación final; el `POST /api/win` se hace **solo en el modo online de emparejamiento** (`rankedOnline`) cuando el ganador es el jugador local — el modo local y el de sala no reportan victorias. **Cartas:** `loadCards()` llama `GET /api/cards/inventory` al arrancar y guarda la promesa en `_cardsPromise` (esperada antes de crear la `UI` en partidas online). Pasa `{ playerCards: [...playerCards], onCardUsed }` a `UI` en `startLocalGame()` y `beginOnlineGame()`; el callback `onCardUsed` emite `sendAction('card_used', { playerName, card })` para notificar a los demás clientes, quienes muestran la notificación de carta vía `ui.showEnemyCardNotification()`. |
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
| `functions/_lib/session.js` | Utilidad compartida | Firma y verifica la cookie `war_session` con HMAC-SHA256. Exports: `createSessionCookie(payload, env)` y `getSession(request, env)`. El secreto vive en `env.SESSION_SECRET` (Cloudflare Pages Secret). |
| `functions/api/auth/google.js` | Backend | Inicia el flujo OAuth 2.0: genera `state` anti-CSRF, emite cookie `oauth_state` temporal y redirige a Google. |
| `functions/api/auth/callback.js` | Backend | Completa OAuth: verifica `state` contra `oauth_state`, canjea el code, obtiene el perfil del usuario, guarda cookie `war_session` firmada (HMAC) y redirige a `/lobby` (registrado) o `/register` (nuevo). |
| `functions/api/auth/wallet.js` | Backend | `POST /api/auth/wallet`: verifica firma (`ethers.verifyMessage`) y, si la wallet ya está vinculada a una cuenta, emite la misma cookie `war_session` firmada que el login con Google. |
| `functions/api/wallet/link.js` | Backend | `POST /api/wallet/link`: requiere `war_session` válida (HMAC); verifica firma y guarda `wallet_address` en `users` (409 si ya pertenece a otra cuenta). |
| `functions/api/cards/inventory.js` | Backend | `GET /api/cards/inventory`: devuelve las cartas del jugador (`user_cards JOIN card_definitions`). Sin sesión → `[]` (degradación silenciosa). |
| `functions/api/cards/use.js` | Backend | `POST /api/cards/use { card_id }`: verifica que la carta pertenezca al jugador y no esté usada; marca `used_at = Date.now()`; devuelve `{ effect_type, effect_value, name }`. |
| `functions/api/cards/delete.js` | Backend | `DELETE /api/cards/delete?id=<card_id>`: verifica pertenencia y borra la fila de `user_cards`. |
| `functions/api/battle-pass/status.js` | Backend | `GET /api/battle-pass/status`: devuelve estado del mes actual (días reclamados, `can_claim_today`, `today_reward`, calendario completo). |
| `functions/api/battle-pass/claim.js` | Backend | `POST /api/battle-pass/claim`: reclama la recompensa del día; resetea el progreso al cambiar de mes; inserta N cartas en `user_cards` vía `DB.batch()` si hay recompensa. |
| `functions/api/shop/inventory.js` | Backend | `GET /api/shop/inventory`: devuelve items comprados del jugador con `quantity > 0` (join `user_shop_items` + `card_definitions`). Sin sesión → `{ items: [] }`. |
| `functions/api/shop/pending-wgt.js` | Backend | `GET /api/shop/pending-wgt`: suma `wins` de meses cerrados sin reclamar en `user_monthly_wins`. Sin sesión → `{ total: 0 }`. |
| `functions/api/claim-wgt.js` | Backend | `POST /api/claim-wgt { signature, timestamp }`: verifica firma ECDSA del mensaje `claim-wgt:{user.id}:{timestamp}`, suma wins reclamables, marca `claimed_at` antes del mint y llama `WGTToken.mint()` en Base Sepolia. Anti-doble-reclamo: revierte si el mint falla. |
| `functions/api/deliver-item.js` | Backend | `POST /api/deliver-item { txHash }`: verifica tx en Base RPC (`status=1`, destino=`SHOP_CONTRACT`, evento `ItemPurchased`, buyer == wallet del usuario), upsert en `user_shop_items`, registra en `delivered_txs` (idempotente). |
| `functions/api/admin/cards.js` | Backend | `GET|POST|PUT|DELETE /api/admin/cards`: CRUD sobre `card_definitions`. Requiere que `session.email` esté en `ADMIN_EMAILS` (→ 403 si no). |
| `functions/api/admin/battle-pass.js` | Backend | `GET|POST|DELETE /api/admin/battle-pass`: CRUD sobre `battle_pass_rewards`. Misma guard de admin. |
| `functions/api/admin/shop-listings.js` | Backend | `GET|POST|DELETE /api/admin/shop-listings`: gestiona qué cartas aparecen en la tienda pública y a qué precio (`shop_listings`). Misma guard de admin. |
| `functions/api/shop/listings.js` | Backend | `GET /api/shop/listings`: devuelve las cartas con `is_listed=1` y `is_active=1` ordenadas por `listed_at`. Sin auth (público). |

## Flujo principal

```
main.js  ──crea──>  Game (estado/reglas)
   │                  ▲
   │ crea            │ llamadas (attack, placeReinforcement, …)
   ▼                  │
  UI  ──clics──────────┘
   │  (refresh: lee Game y redibuja)
   │
  fin de partida (online ranked, gané) ──> main.onGameOver ──POST /api/win──> Function ──> D1

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
/lobby ──hub──> /game · /battle-pass · /my-profile · /gamers
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
- **Red:** `main.js` toca `fetch` solo para `/api/win`, y solo al ganar en el **modo
  online de emparejamiento** (`rankedOnline`); las salas creadas/unidas manualmente y el
  modo local **no** registran victorias. Los endpoints `/api/auth/*` se invocan por
  **navegación del browser** desde `login.html` (vía `<a href>`), no por `fetch` programático.
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
