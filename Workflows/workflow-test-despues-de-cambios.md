# Workflow — Tests después de cambios

**Propósito:** mantener los tests sincronizados con el código tras cada sesión de cambios.

> ℹ️ **El runner ya está configurado.** El repo usa **`node --test`** (integrado, cero dependencias) con una suite en `tests/`. El detalle de suites y casos vive en `Docs/testing.md`. No hace falta instalar nada: el Paso 0 solo recuerda el setup vigente.

## Paso 0 — Prerequisitos (ya configurados)

El código es ES Modules (`"type": "module"`) sin build.

- **Runner:** `node --test` integrado, **Node ≥21** (probado en Node 24). Sin Vitest ni jsdom.
- **Scripts** (`package.json`): `npm test` → `node --test "tests/**/*.test.js"`; `npm run test:watch`.
- `tests/` está versionado y **excluido del deploy** vía `.assetsignore`.
- **Lógica pura testeable sin DOM:** `js/game.js`, `js/map-data.js`, `js/map-shapes.js`, los `functions/api/**` y el DO `worker/index.js` (con fakes de `state`/WebSocket).
- **Diferidos** por depender de DOM/Web3/canvas: `js/ui.js`, `js/main.js`, `js/wallet.js`, `js/pixi-overlay.js`.

## Paso 1 — Identificar archivos cambiados

`git diff --name-only HEAD~1` (y `git status` si hay cambios sin commitear). Filtrar solo código fuente: **`js/`, `functions/` y `worker/`**. Ignorar `css/`, `index.html`, `*.md`, `schema.sql`, `wrangler.toml`, `_headers` y `scripts/` (tooling de dev).

## Paso 2 — Mapear cada archivo a su test

Convención: `js/<archivo>.js` → `tests/<archivo>.test.js`; `functions/api/<archivo>.js` → `tests/api/<archivo>.test.js`. Caso especial: `worker/index.js` (clase `GameRoom`) → `tests/api/game-room.test.js`, que **también** cubre el router `functions/api/game-room.js`.

| Situación | Acción |
|-----------|--------|
| Archivo nuevo sin test | Crear test según la convención |
| Archivo modificado con test | Editar el test si cambió la interfaz pública |
| Archivo eliminado | Eliminar su test |
| Archivo modificado sin test | Evaluar si amerita test; documentar la decisión |

Prioridad de cobertura (lógica de mayor riesgo): `js/game.js` (combate por dados, refuerzos, condición de victoria), `functions/api/register.js` y `functions/api/win.js` (validación, ramas de error, degradación sin `DB`), y `worker/index.js` (emparejador, alarma de 60s, estado que sobrevive a la hibernación). `ui.js`/`main.js` solo si el cambio es testeable de forma estable bajo DOM simulado.

## Paso 3 — Ejecutar los tests una sola vez (modo CI, sin watch)

`npm test`  (equivale a `node --test "tests/**/*.test.js"`).

## Paso 4 — Actualizar el doc de tests

Actualizar `Docs/testing.md` (tabla de suites). Agregar/editar/eliminar filas y el total:

| Suite | Archivo bajo prueba | Casos | Estado |
|---|---|---|---|

## Paso 5 — Comunicar resultado

- **Si falla algo:** reportar qué test falló, el error exacto, la causa raíz probable y la acción recomendada. No marcar el workflow como completo hasta que pasen o el usuario decida posponer.
- **Si todo pasa:** resumir archivos cambiados, tests creados/editados/eliminados, total de tests y confirmar que `Docs/testing.md` quedó actualizado.
