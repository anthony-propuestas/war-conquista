# Workflow — Comparación código ⟷ documentación

**Propósito:** detectar desfases entre el código real y la documentación, y reportarlos al usuario para que decida. **Es de análisis y reporte: nunca edita código ni docs.**

## Documentos del proyecto a verificar

- `README.md` — portada, características, instrucciones y arquitectura.
- `Docs/database.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/api.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/stack.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/architecture.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/environment.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/deployment.md` — *(lo crea `workflow-documentacion.md`)*
- `Docs/security.md` — *(lo crea `workflow-security.md`)*
- `Docs/testing.md` — *(lo crea `workflow-test-despues-de-cambios.md`)*
- `Docs/style.md` — *(lo crea `workflow-documentacion.md`)*

> Hoy solo existe `README.md`. Verificar únicamente los documentos que existan; anotar como "pendiente de crear" los que aún no estén.

## Paso 1 — Leer todos los documentos existentes

Leer cada `.md` de la lista anterior que exista en el repo.

## Paso 2 — Verificar cada documento contra el código real

Preguntas concretas por documento:

**README.md**
- ¿La arquitectura listada (`js/map-data.js`, `js/game.js`, `js/ui.js`, `js/main.js`, `functions/api/scores.js`, `schema.sql`, `wrangler.toml`, `_headers`) coincide con los archivos reales? ¿Hay archivos nuevos sin listar?
- ¿Los comandos (`npm run dev`, `deploy`, `db:create`, `db:init:remote`) coinciden con los `scripts` de `package.json`?
- ¿El stack descrito ("HTML/CSS/JS puro, sin frameworks", Pages + D1) sigue siendo cierto? ¿`package.json` añadió dependencias que lo contradigan?
- ¿La URL de la demo y el flujo de juego (fases, nº de jugadores, 42 territorios/6 continentes) coinciden con `js/map-data.js` y `js/game.js`?

**Docs/database.md** (si existe)
- ¿La tabla `scores` documentada (`name` PK, `wins`, `updated_at`) y el índice `idx_scores_wins` coinciden con `schema.sql`?
- ¿Las queries descritas coinciden con el `SELECT` y el `INSERT … ON CONFLICT` de `functions/api/scores.js`?

**Docs/api.md** (si existe)
- ¿Los métodos/handlers (`onRequestGet`, `onRequestPost`) y sus shapes coinciden con `functions/api/scores.js`?
- ¿Los códigos de error documentados (`bad-json`, `no-name`, `db-error`, degradación sin `DB`) siguen vigentes?

**Docs/stack.md / Docs/environment.md / Docs/deployment.md** (si existen)
- ¿El binding `DB`, `database_name`, `compatibility_date` y `pages_build_output_dir` coinciden con `wrangler.toml`?
- ¿Las cabeceras documentadas coinciden con `_headers`?
- ¿Los pasos de deploy coinciden con los scripts reales de `package.json`?

**Docs/testing.md** (si existe)
- ¿Cada suite listada tiene su archivo en `tests/`? ¿Hay tests no registrados? ¿El runner/comando documentado coincide con `package.json`?

**Docs/security.md** (si existe)
- ¿Los mecanismos documentados (parametrización D1, `escapeHtml`, validación de `name`, cabeceras `_headers`) siguen en el código? ¿Hay endpoints nuevos en `functions/` sin analizar?

**Docs/style.md** (si existe)
- ¿Los valores de la tabla de tokens (`--bg`, `--accent`, `--radius`, `--shadow`, etc.) coinciden con los `:root` reales de `css/style.css`?
- ¿La lista de "Páginas que siguen este sistema" sigue completa (sin páginas nuevas sin listar, sin páginas eliminadas que sigan listadas)?
- ¿Sigue siendo cierto que el tablero SVG (`.map-wrap`, `.terr`, `--sea`/`--sea-2`) está fuera de alcance, o el código lo contradice?

## Paso 3 — Reportar cada diferencia en el chat

Por cada desfase encontrado:
```
[ARCHIVO_DOC] Sección: X
- Doc dice: "..."
- Código dice: "..."
- Acción sugerida: actualizar doc / actualizar código / investigar más
```

## Paso 4 — Esperar la decisión del usuario

No editar nada hasta que el usuario indique cómo resolver cada diferencia.
