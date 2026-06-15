# Arquitectura

WAR separa **lógica pura**, **render/interacción** y **arranque**. El motor del
juego no conoce el DOM; la UI no contiene reglas; `main.js` orquesta y habla con la red.

## Estructura de carpetas

```
WAR/
├── index.html              # 2 pantallas: inicio y juego (.screen)
├── css/style.css           # estilos
├── js/
│   ├── map-data.js         # datos del mapa (puro)
│   ├── game.js             # motor del juego (puro)
│   ├── ui.js               # render SVG + interacción (DOM)
│   └── main.js             # arranque + leaderboard (DOM + fetch)
├── functions/api/scores.js # Pages Function: /api/scores (D1)
├── tests/                  # node --test (excluido del deploy)
├── schema.sql              # esquema D1
├── wrangler.toml           # config Cloudflare (binding DB)
├── _headers                # cabeceras de seguridad/caché
└── .assetsignore           # excluye tests/ del upload de Pages
```

## Módulos y responsabilidades

| Módulo | Tipo | Responsabilidad |
|---|---|---|
| `js/map-data.js` | Datos puros | 42 territorios, 6 continentes (con bonus), grafo de adyacencias (bidireccional vía `buildAdjacency()`), ejércitos iniciales, colores, valores de canje de cartas. |
| `js/game.js` | Lógica pura (clase `Game`) | Estado del tablero, turnos y fases, combate por dados, refuerzos, canje de cartas, conquista, eliminación y victoria. **Sin DOM.** |
| `js/ui.js` | Vista (clase `UI`) | Construye el mapa SVG una vez, refresca nodos/sidebar/banner según el estado, traduce clics a llamadas del motor, muestra dados y modales (conquista/fortificación). **No decide reglas**, solo refleja y delega en `Game`. |
| `js/main.js` | Arranque | Pantalla de inicio (config de 2–6 jugadores), crea `Game` + `UI`, y conecta el salón de la fama (`POST`/`GET` a `/api/scores`). |
| `functions/api/scores.js` | Backend | Endpoint del salón de la fama sobre D1 (ver [api.md](api.md)). |

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
```

- **Game → UI:** la UI nunca muta el tablero directamente; llama métodos de `Game`
  (que validan con sus guardas: `canAttack`, `canFortify`, fase, etc.) y luego
  `refresh()` para re-leer el estado.
- **Conquista/fortificación:** `Game` deja `pendingConquest`; la UI abre un modal con
  un rango `[min, max]` y confirma con `moveAfterConquest` / `fortify`.
- **Red:** solo `main.js` toca `fetch`; el resto del juego funciona offline.

## Por qué esta separación

`game.js` y `map-data.js` son ESM puros → testeables sin DOM (ver [testing.md](testing.md))
y reutilizables. Si la lógica del motor creciera demasiado para esta página,
extraer un `game-engine.md` dedicado.
