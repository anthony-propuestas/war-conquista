# Workflow — Documentación sincronizada con el código

**Propósito:** mantener una estructura documental completa y granular para WAR, creando los archivos faltantes y sincronizándolos con el código tras cada sesión de cambios. El foco es explicar **cómo funciona el código**, no qué líneas se tocaron.

> Estado actual del proyecto: la única documentación existente es `README.md`. **No existe la carpeta `Docs/`** — el Paso 0 la crea y puebla por primera vez desde el código real.

## Estructura documental que este workflow mantiene

**Docs base** (siempre aplican — crear si no existen):

| Archivo | Qué documenta |
|---|---|
| `Docs/database.md` | Esquema D1 (`schema.sql`): tabla `scores` (`name` PK, `wins`, `updated_at`), índice `idx_scores_wins`, queries del `INSERT … ON CONFLICT` y del `SELECT … LIMIT 10`, comandos de migración (`db:init`, `db:init:remote`) |
| `Docs/api.md` | Endpoint `functions/api/scores.js`: `onRequestGet` (top 10) y `onRequestPost` (`{ name }` → +1 victoria). Shapes de request/response JSON, códigos de error (`bad-json` 400, `no-name` 400, `db-error` 500, degradación a `[]`/`{ok:false}` sin D1) |
| `Docs/stack.md` | Stack y por qué: HTML/CSS/JS puro **sin frameworks ni build**, ES Modules (`type: module`), Cloudflare Pages + Pages Functions + D1, `wrangler ^4` como única devDependency |
| `Docs/architecture.md` | Estructura de carpetas y flujos: `js/map-data.js` (42 territorios/6 continentes/adyacencias), `js/game.js` (motor de lógica pura), `js/ui.js` (render SVG e interacción), `js/main.js` (arranque + leaderboard), `functions/api/scores.js` (backend). Separación lógica-pura / render / arranque |
| `Docs/environment.md` | Binding D1 `DB` en `wrangler.toml` (`database_name = war-scores`, `database_id`), `compatibility_date`, `pages_build_output_dir = "."`. No hay secrets ni env vars de aplicación; cómo enlazar el binding en local y en el panel de Pages |
| `Docs/deployment.md` | `npm run deploy` (`wrangler pages deploy .`), creación e init de D1 remota (`db:create` → pegar `database_id` → `db:init:remote`), opción CI/CD desde GitHub (build vacío, output `/`, binding `DB`), notas de `_headers` |
| `Docs/style.md` | Tokens de color/tipografía/spacing en `css/style.css` (paleta navy + gold, Cinzel/Oswald), reglas de uso (mate, sin gradientes/glows salvo excepciones), qué páginas siguen el sistema y qué queda fuera de alcance (tablero SVG) |

**Docs compartidos con otros workflows** (no duplicar si ya existen — solo referenciar):

| Archivo | Notas |
|---|---|
| `Docs/security.md` | Lo crea/mantiene `workflow-security.md`. Este workflow solo lo enlaza. |
| `Docs/testing.md` | Lo crea/mantiene `workflow-test-despues-de-cambios.md`. Este workflow solo lo enlaza. |

**Docs opcionales** (agregar solo si el proyecto los necesita):
- `Docs/game-engine.md` — solo si la lógica de `game.js` (combate por dados, cálculo de refuerzos, fases de turno) crece lo bastante para no caber en `architecture.md`.
- `Docs/data-flow.md` — solo si el flujo `main.js → game.js → ui.js → /api/scores → D1` deja de ser obvio.
- El resto de opcionales de la plantilla (auth, onchain, storage, realtime) **no aplican**: no hay autenticación, blockchain, uploads ni websockets en este proyecto.

---

## Paso 0 — Crear los docs faltantes

Verificar qué archivos de la estructura anterior existen. La carpeta `Docs/` aún no existe, así que créala. Por cada doc base faltante, créalo con **contenido inicial poblado desde el código real** (no plantillas vacías ni `TODO`). El contenido refleja el estado **actual** del proyecto, no el del último commit. No crees `Docs/security.md` ni `Docs/testing.md`: son responsabilidad de los otros workflows.

## Paso 1 — Ver qué cambió

Ejecutar `git diff HEAD~1` (y `git status` si hay cambios sin commitear). Leer el diff completo antes de decidir nada.

## Paso 2 — Decidir qué amerita documentar

Mapeo cambio → doc:

- ¿Cambió `schema.sql` o las queries de `functions/api/scores.js`? → `Docs/database.md`
- ¿Se agregó/eliminó un endpoint o cambió un shape de request/response? → `Docs/api.md` y `Docs/architecture.md`
- ¿Cambió el stack o `package.json` (scripts, dependencias)? → `Docs/stack.md`
- ¿Se agregó un módulo `js/*.js` nuevo o cambió la responsabilidad de uno existente? → `Docs/architecture.md`
- ¿Cambió `wrangler.toml`, el binding `DB` o `_headers`? → `Docs/environment.md`
- ¿Cambió el proceso de deploy o los scripts `db:*`? → `Docs/deployment.md`
- ¿Creció la lógica del motor (`game.js`) lo suficiente? → evaluar crear `Docs/game-engine.md`
- ¿Cambiaron los tokens de `css/style.css` (colores, radios, sombras, tipografía) o se agregó/migró una página de chrome al sistema de diseño matte navy + gold? → `Docs/style.md`
- **Excluir:** fixes de bugs sin cambio de interfaz, refactors internos, retoques visuales menores que no tocan tokens ni adoptan/abandonan el sistema de diseño.

## Paso 3 — Documentar

Describir el **flujo y el porqué**, no el diff. Actualizar tablas/listas desactualizadas (p. ej. la lista de territorios, los códigos de error, los scripts de `package.json`). Eliminar secciones obsoletas. Mantener `README.md` como portada de alto nivel; el detalle vive en `Docs/`.

## Paso 4 — Reportar en el chat

Resumir qué docs se crearon/actualizaron, qué secciones cambiaron y por qué.
