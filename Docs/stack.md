# Stack tecnológico

Filosofía: **lo mínimo que funciona**. Sin frameworks, sin paso de build, sin
bundler. El navegador carga los ES Modules directamente.

## Frontend

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | HTML + CSS + JavaScript puro | Juego pequeño; un framework sería sobrepeso. |
| Módulos | ES Modules nativos (`"type": "module"`) | `import`/`export` en el navegador sin transpilar. |
| Render del mapa | SVG construido por DOM API en `js/ui.js` | Vectorial, escalable, sin librería de gráficos. |
| Estilos | CSS plano (`css/style.css`) | Sin preprocesador ni utilidades. |

No hay React/Vue, ni TypeScript, ni Webpack/Vite. Abrir `index.html` en un servidor
estático basta para jugar (sin salón de la fama).

## Backend / plataforma (Cloudflare)

| Servicio | Uso |
|---|---|
| **Pages** | Hosting de los estáticos. |
| **Pages Functions** | El endpoint `/api/scores` (`functions/api/scores.js`). |
| **D1** | Base SQLite del salón de la fama (binding `DB`). |

## Dependencias

`package.json` declara **una sola devDependency**: `wrangler ^4` (CLI de Cloudflare
para dev local y deploy). No hay dependencias de runtime.

## Scripts (`package.json`)

| Script | Acción |
|---|---|
| `npm run dev` | `wrangler pages dev .` — sirve estáticos + Functions + D1 local. |
| `npm run deploy` | `wrangler pages deploy .` — publica a Pages. |
| `npm test` | `node --test` sobre `tests/**/*.test.js` (runner integrado, sin deps). |
| `npm run test:watch` | Igual en modo watch. |
| `npm run db:create` / `db:init` / `db:init:remote` | Gestión de la D1 (ver [database.md](database.md)). |

Tests: ver [testing.md](testing.md). Deploy: ver [deployment.md](deployment.md).
