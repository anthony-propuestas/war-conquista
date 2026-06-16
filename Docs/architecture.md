# Arquitectura

WAR separa **lógica pura**, **render/interacción** y **arranque**. El motor del
juego no conoce el DOM; la UI no contiene reglas; `main.js` orquesta y habla con la red.

## Estructura de carpetas

```
WAR/
├── home/index.html         # landing page (/home) — primera pantalla pública
├── index.html              # pantallas de inicio/juego (.screen)
├── login.html              # pantalla de login (/login)
├── game/index.html         # pantalla de juego servida en /game (importmap de pixi/ethers)
├── css/style.css           # estilos
├── js/
│   ├── map-data.js         # datos del mapa: territorios/continentes/adyacencias (puro)
│   ├── map-shapes.js       # formas SVG + centros de etiqueta (GENERADO, puro)
│   ├── game.js             # motor del juego (puro)
│   ├── ui.js               # render SVG + interacción (DOM) + overlay Pixi
│   ├── pixi-overlay.js     # animaciones de batalla sobre el mapa (Pixi.js, DOM)
│   ├── multiplayer.js      # cliente WebSocket de la sala (red)
│   ├── wallet.js           # wallet Web3 / ethers (red externa)
│   └── main.js             # arranque + leaderboard + wallet + sala (DOM + fetch)
├── functions/api/scores.js # Pages Function: /api/scores (D1)
├── functions/game-room.js  # Durable Object GameRoom + routing de /api/game-room (WS)
├── functions/api/auth/
│   ├── google.js           # inicia OAuth con Google (/api/auth/google)
│   └── callback.js         # completa OAuth, guarda cookie (/api/auth/callback)
├── scripts/build-map-shapes.mjs # dev-only: genera map-shapes.js desde Natural Earth
├── tests/                  # node --test (excluido del deploy)
├── schema.sql              # esquema D1
├── wrangler.toml           # config Cloudflare (binding DB)
├── _headers                # cabeceras de seguridad/caché
├── _redirects              # redirige / → /home (Cloudflare Pages)
└── .assetsignore           # excluye tests/ del upload de Pages
```

## Módulos y responsabilidades

| Módulo | Tipo | Responsabilidad |
|---|---|---|
| `js/map-data.js` | Datos puros | 42 territorios, 6 continentes (con bonus), grafo de adyacencias (bidireccional vía `buildAdjacency()`), ejércitos iniciales, colores. |
| `js/map-shapes.js` | Datos puros (**generado**) | Geometría del mapa: `TERRITORY_SHAPES` (paths SVG por territorio), `TERRITORY_CENTERS` (punto de etiqueta interior), `MAP_VIEWBOX`, `SEA_ROUTES` y `TERRITORY_CLIPS`. **No editar a mano**: lo regenera `scripts/build-map-shapes.mjs` (`npm run build:map`). |
| `js/game.js` | Lógica pura (clase `Game`) | Estado del tablero, turnos y fases, combate por dados, refuerzos, conquista, eliminación y victoria. **Sin DOM.** |
| `js/ui.js` | Vista (clase `UI`) | Construye el mapa SVG una vez a partir de las formas de `map-shapes.js` (paths reales con proyección geográfica, `clipPath` para los países partidos); cada nodo lleva el nombre del territorio (`<text class="label">`) sobre el contador de ejércitos (`<text class="count">`). Refresca nodos/sidebar/banner según el estado, traduce clics a llamadas del motor, muestra dados y modales (conquista/fortificación). **No decide reglas ni genera geometría**: solo refleja el estado y delega en `Game`. El banner de turno se renderiza como tarjeta de jugador + *stepper* de fases (refuerzo › ataque › fortificación), escapando el nombre con `escapeHtml`. |
| `js/main.js` | Arranque | Pantalla de inicio (config de 2–6 jugadores), crea `Game` + `UI`, conecta el salón de la fama (`POST`/`GET` a `/api/scores`), la wallet y la sala multijugador. |
| `js/pixi-overlay.js` | Vista (overlay) | Canvas Pixi.js superpuesto al mapa SVG; dibuja partículas/línea/etiqueta de cada batalla. Lo inicia y dispara `ui.js`. Ver [stack.md](stack.md). |
| `js/multiplayer.js` | Cliente de red | Cliente WebSocket de la sala (`joinRoom`/`sendGameState`/…). Detalle en [realtime.md](realtime.md). |
| `js/wallet.js` | Web3 | Conexión a MetaMask vía ethers; identidad de jugador y mint/claim experimental. Detalle en [onchain.md](onchain.md). |
| `functions/api/scores.js` | Backend | Endpoint del salón de la fama sobre D1 (ver [api.md](api.md)). |
| `functions/game-room.js` | Backend (Durable Object) | Sala multijugador `GameRoom`: WebSocket, broadcast y persistencia del estado. Ver [realtime.md](realtime.md). |
| `functions/api/auth/google.js` | Backend | Inicia el flujo OAuth 2.0: redirige a Google con los parámetros del cliente. |
| `functions/api/auth/callback.js` | Backend | Completa OAuth: canjea el code, obtiene el perfil del usuario y guarda la sesión en cookie `war_session`. |

## Flujo principal

```
main.js  ──crea──>  Game (estado/reglas)
   │                  ▲
   │ crea            │ llamadas (attack, placeReinforcement, …)
   ▼                  │
  UI  ──clics──────────┘
   │  (refresh: lee Game y redibuja)
   │
  fin de partida ──> main.onGameOver ──POST /api/scores──> Function ──> D1
   │
  volver al menú ──GET /api/scores──> render salón de la fama

/login ──clic──> GET /api/auth/google ──302──> Google OAuth
                                                    │
                                             GET /api/auth/callback?code=…
                                                    │
                                         Set-Cookie war_session ──302──> /game
```

- **Game → UI:** la UI nunca muta el tablero directamente; llama métodos de `Game`
  (que validan con sus guardas: `canAttack`, `canFortify`, fase, etc.) y luego
  `refresh()` para re-leer el estado.
- **Conquista/fortificación:** `Game` deja `pendingConquest`; la UI abre un modal con
  un rango `[min, max]` y confirma con `moveAfterConquest` / `fortify`.
- **Red:** `main.js` toca `fetch` solo para `/api/scores` (leaderboard al volver al menú y registro de victoria). Los endpoints `/api/auth/*` se invocan por **navegación del browser** desde `login.html` (vía `<a href>`), no por `fetch` programático.
- **Multijugador (opcional):** si el jugador indica una sala, `main.js` abre un WebSocket
  (`joinRoom`) y **parchea los métodos mutadores de `Game`** para emitir `sendGameState`
  tras cada acción → el Durable Object `GameRoom` hace `broadcast` → los demás reciben
  `game_state`, lo aplican al `Game` local y hacen `ui.refresh()`. Detalle en
  [realtime.md](realtime.md).
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
