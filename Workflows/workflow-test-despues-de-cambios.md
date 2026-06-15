# Workflow — Tests después de cambios

**Propósito:** mantener los tests sincronizados con el código tras cada sesión de cambios.

> ⚠️ **El proyecto no tiene tests ni runner configurado.** No hay `package.json > scripts.test`, ni carpeta de tests, ni dependencia de testing. **El Paso 0 configura lo mínimo antes de poder mapear o ejecutar nada.**

## Paso 0 — Configuración mínima (solo la primera vez)

El código es ES Modules (`"type": "module"`) sin build. `js/game.js` y `js/map-data.js` son **lógica pura** (sin DOM) → directamente testeables; `js/ui.js` y `js/main.js` usan `document`/`fetch` y requieren un entorno con DOM simulado.

Runner sugerido: **Vitest** (ESM nativo, trae `jsdom` para los módulos con DOM). Alternativa cero-dependencias: el runner integrado `node --test` para los módulos puros.

1. Instalar: `npm i -D vitest` (y `jsdom` si se van a testear `ui.js`/`main.js`).
2. Añadir a `package.json`:
   ```json
   "scripts": { "test": "vitest run", "test:watch": "vitest" }
   ```
3. Crear la carpeta `tests/` en la raíz (fuera de `js/`, para que Pages no la sirva ni la despliegue) con un primer test de humo sobre `js/game.js`.
4. Añadir `tests/` a `.gitignore`? **No** — los tests sí se versionan; solo asegurarse de que el deploy no los publique (viven fuera de la raíz servida o se excluyen vía configuración de Pages).

## Paso 1 — Identificar archivos cambiados

`git diff --name-only HEAD~1` (y `git status` si hay cambios sin commitear). Filtrar solo código fuente: **`js/` y `functions/`**. Ignorar `css/`, `index.html`, `*.md`, `schema.sql`, `wrangler.toml`, `_headers`.

## Paso 2 — Mapear cada archivo a su test

Convención: `js/<archivo>.js` → `tests/<archivo>.test.js`; `functions/api/<archivo>.js` → `tests/api/<archivo>.test.js`.

| Situación | Acción |
|-----------|--------|
| Archivo nuevo sin test | Crear test según la convención |
| Archivo modificado con test | Editar el test si cambió la interfaz pública |
| Archivo eliminado | Eliminar su test |
| Archivo modificado sin test | Evaluar si amerita test; documentar la decisión |

Prioridad de cobertura: `game.js` (combate por dados, canje de cartas, refuerzos, condición de victoria) y `functions/api/scores.js` (validación de `name`, ramas de error, degradación sin `DB`) por ser la lógica de mayor riesgo. `ui.js`/`main.js` solo si el cambio es testeable de forma estable con `jsdom`.

## Paso 3 — Ejecutar los tests una sola vez (modo CI, sin watch)

`npm run test`  (equivale a `vitest run`). Para los módulos puros sin Vitest: `node --test tests/`.

## Paso 4 — Actualizar el doc de tests

Actualizar `Docs/testing.md` (si no existe, crearlo con una tabla de suites). Agregar/editar/eliminar filas y el total:

| Suite | Archivo bajo prueba | Casos | Estado |
|---|---|---|---|

## Paso 5 — Comunicar resultado

- **Si falla algo:** reportar qué test falló, el error exacto, la causa raíz probable y la acción recomendada. No marcar el workflow como completo hasta que pasen o el usuario decida posponer.
- **Si todo pasa:** resumir archivos cambiados, tests creados/editados/eliminados, total de tests y confirmar que `Docs/testing.md` quedó actualizado.
