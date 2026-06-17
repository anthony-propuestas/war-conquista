# Stack tecnológico

Filosofía: **lo mínimo que funciona**. Sin paso de build ni bundler: el navegador carga
los ES Modules directamente, y las pocas librerías de runtime (`pixi.js`, `ethers`) se
resuelven con un **`importmap`** que apunta a **esm.sh** (CDN ESM-native). No hay
framework de UI (React/Vue) ni transpilación.

## Frontend

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | HTML + CSS + JavaScript puro | Juego pequeño; un framework sería sobrepeso. |
| Módulos | ES Modules nativos (`"type": "module"`) | `import`/`export` en el navegador sin transpilar. |
| Render del mapa | SVG por DOM API en `js/ui.js`, con paths **pregenerados** en `js/map-shapes.js` | Vectorial y escalable. Las formas reales del mundo se calculan offline (ver build abajo). |
| Animaciones de batalla | **Pixi.js** (`js/pixi-overlay.js`), canvas superpuesto al SVG | Partículas/línea/etiqueta por ataque sin recargar el SVG. Ver [architecture.md](architecture.md). |
| Wallet Web3 | **ethers v6** (`js/wallet.js`) + MetaMask | Identidad de jugador y mint/claim experimental. Ver [onchain.md](onchain.md). |
| Estilos | CSS plano (`css/style.css`) | Sin preprocesador ni utilidades. Ver [style.md](style.md) para los tokens y reglas del sistema de diseño. |
| Tipografía | **Google Fonts** (`Cinzel`, `Oswald`) vía `<link>` en `index.html` | Títulos/UI; se cargan desde el CDN de Google (con `preconnect`), no están auto-hospedadas. |

No hay React/Vue, ni TypeScript, ni Webpack/Vite. El single-player funciona sirviendo los
estáticos; las fuentes requieren conexión a `fonts.googleapis.com`/`fonts.gstatic.com` (si
no, el navegador usa el fallback serif/sans). `pixi.js` y `ethers` se sirven desde
**esm.sh** (CDN) vía `importmap` (ver "Dependencias" abajo).

## Backend / plataforma (Cloudflare)

| Servicio | Uso |
|---|---|
| **Pages** | Hosting de los estáticos. |
| **Pages Functions** | Endpoints `/api/win`, `/api/gamers`, `/api/profile`, `/api/register`, `/api/auth/*` y routing de `/api/game-room`. |
| **D1** | Base SQLite de usuarios y victorias (binding `DB`). |
| **Durable Objects** | Sala multijugador `GameRoom` (binding `GAME_ROOM`). Ver [realtime.md](realtime.md). |

## Dependencias

**Dependencias de runtime** (llegan al navegador vía `importmap` declarado en
`game/index.html`, `login.html` y `home/index.html`; se cargan desde **esm.sh** — CDN
ESM-native — sin bundler):

| dependency | CDN | Para qué |
|---|---|---|
| `pixi.js 8.19.0` | `https://esm.sh/pixi.js@8.19.0` | Animaciones de batalla (`js/pixi-overlay.js`). |
| `ethers 6.16.0` | `https://esm.sh/ethers@6.16.0` | Wallet Web3 (`js/wallet.js`). |

Las `devDependencies` existen para tareas locales (incluyendo `pixi.js` y `ethers` por si
se quieren tipos o resolución local, aunque el navegador los resuelve desde CDN):

| devDependency | Para qué |
|---|---|
| `wrangler ^4` | CLI de Cloudflare: dev local, deploy y gestión de D1. |
| `d3-geo`, `d3-geo-projection` | Proyección `geoNaturalEarth1` y recorte por antimeridiano al generar el mapa. |
| `topojson-client` | Disuelve fronteras internas (`merge`) y decodifica TopoJSON al generar el mapa. |
| `world-atlas` | Datos Natural Earth (dominio público) que alimentan el generador. |

Las cuatro últimas solo las usa `scripts/build-map-shapes.mjs` (build del mapa, ver
abajo); no llegan al cliente ni al deploy.

## Scripts (`package.json`)

| Script | Acción |
|---|---|
| `npm run build:map` | `node scripts/build-map-shapes.mjs` — regenera `js/map-shapes.js` desde Natural Earth. Dev-only; correr solo si cambia el reparto de territorios. |
| `npm run dev` | `wrangler pages dev .` — sirve estáticos + Functions + D1 local. |
| `npm run deploy` | `wrangler pages deploy .` — publica a Pages. |
| `npm test` | `node --test` sobre `tests/**/*.test.js` (runner integrado, sin deps). |
| `npm run test:watch` | Igual en modo watch. |
| `npm run db:create` | Crea la D1 `war-scores` (ver [database.md](database.md)). Las migraciones se aplican manualmente con `wrangler d1 execute war-scores --local/--remote --file migrations/0001_users.sql` — no son scripts de `package.json`. |

Tests: ver [testing.md](testing.md). Deploy: ver [deployment.md](deployment.md).
