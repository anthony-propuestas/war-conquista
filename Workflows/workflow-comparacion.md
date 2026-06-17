# Workflow — Comparación código ⟷ documentación + reparación

**Propósito:** detectar desfases entre el código real y la documentación, reportarlos y repararlos en la misma sesión.

## Documentos del proyecto a verificar

- `README.md` — portada, características, arquitectura, instrucciones de deploy
- `Docs/database.md` — tablas D1, queries, migraciones
- `Docs/api.md` — rutas HTTP, handlers, shapes de request/response, errores
- `Docs/stack.md` — dependencias y versiones, razones técnicas
- `Docs/architecture.md` — estructura de carpetas, patrones, flujos
- `Docs/environment.md` — env vars, bindings, wrangler.toml
- `Docs/deployment.md` — comandos de deploy, infra, notas de producción
- `Docs/security.md` — mecanismos de auth/validación, superficies de ataque
- `Docs/testing.md` — suites, runner, convención de tests
- `Docs/style.md` — tokens de diseño, paleta, tipografía
- `Docs/realtime.md` — WebSockets, Durable Object, protocolo de mensajes
- `Docs/auth.md` — autenticación, sesiones, wallet (si aplica)
- `Docs/onchain.md` — contratos, ABIs, ethers.js (si aplica)

## Paso 1 — Leer todos los documentos existentes

Leer cada `.md` de la lista anterior que exista en el repo. Todos existen en `Docs/`; verificar igual que no se haya borrado alguno.

## Paso 2 — Verificar cada documento contra el código real

Preguntas concretas por documento:

**README.md**
- ¿El árbol de carpetas listado en Arquitectura coincide con los archivos reales? En particular: ¿menciona archivos que ya no existen (`schema.sql`, `functions/game-room.js`, `functions/api/scores.js`)? ¿Falta listar archivos nuevos (`functions/api/game-room.js`, `functions/api/win.js`, `worker/index.js`, `js/multiplayer.js`)?
- ¿Las Características describen el multijugador online real (salas WebSocket + Durable Object, lobby con ready/start) además del hotseat local?
- ¿Los comandos (`npm run dev`, `deploy`, `deploy:worker`) coinciden con los `scripts` de `package.json`?
- ¿El stack descrito sigue siendo cierto en `package.json` (dependencias, devDependencies)?

**Docs/architecture.md**
- ¿Todos los archivos listados en la estructura de carpetas existen realmente? (`schema.sql` no existe; verificar que no esté listado)
- ¿Están documentados `worker/index.js` (Durable Object GameRoom), `functions/api/game-room.js`, `functions/api/win.js` y `js/multiplayer.js`?
- ¿El flujo de sala multijugador (crear sala → join → WebSocket → ready → start) está descrito?

**Docs/api.md**
- ¿Están documentados todos los endpoints actuales: `GET/POST /api/game-room`, `POST /api/win`, y los handlers WebSocket del Durable Object?
- ¿Los shapes de request/response y códigos de error reflejan el código en `functions/api/game-room.js` y `functions/api/win.js`?

**Docs/database.md**
- ¿El esquema documentado refleja las tablas actuales en D1? (`schema.sql` no existe; el esquema debe derivarse de las queries reales en el código o de las migraciones)
- ¿La tabla `wins` (o equivalente usada por `functions/api/win.js`) está documentada?

**Docs/stack.md**
- ¿La tabla de `dependencies` lista `ethers` correctamente como dependencia de producción (no devDependency)?
- ¿La tabla de `devDependencies` incluye `pixi.js`, `d3-geo`, `d3-geo-projection`, `topojson-client`, `world-atlas`, `wrangler`?
- ¿Menciona el Durable Object `GameRoom` (`worker/index.js`) como parte del stack?

**Docs/environment.md**
- ¿Los bindings documentados en `wrangler.toml` / `worker/wrangler.toml` coinciden con los archivos reales?
- ¿Está documentado el binding del Durable Object `GameRoom`?

**Docs/deployment.md**
- ¿El comando `deploy:worker` (`wrangler deploy --config worker/wrangler.toml`) está documentado?
- ¿El flujo de deploy del Worker del Durable Object está separado del deploy de Pages?

**Docs/realtime.md**
- ¿El protocolo de mensajes WebSocket documentado coincide con el código en `worker/index.js` y `js/multiplayer.js`?
- ¿Los tipos de mensaje (crear sala, join, ready, start, game-state, etc.) están actualizados?

**Docs/testing.md**
- ¿Cada suite listada tiene su archivo en `tests/`? ¿Hay tests no registrados (`tests/api/win.test.js`)?
- ¿El runner/comando documentado (`node --test`) coincide con `package.json`?

**Docs/security.md**
- ¿Hay endpoints nuevos en `functions/` o en el Durable Object sin analizar?
- ¿Los mecanismos documentados siguen vigentes en el código actual?

**Docs/style.md**
- ¿Los valores de la tabla de tokens (`--bg`, `--accent`, etc.) coinciden con los `:root` reales de `css/style.css`?

**Docs/auth.md / Docs/onchain.md**
- ¿El contenido refleja el uso actual de `ethers` en el código?

## Paso 3 — Reportar cada diferencia en el chat

Por cada desfase encontrado, antes de editar nada:
```
[ARCHIVO_DOC] Sección: X
- Doc dice: "..."
- Código dice: "..."
- Acción sugerida: actualizar doc / eliminar sección / agregar sección
```
Si no hay desfases: confirmarlo en una oración y terminar.

## Paso 4 — Reparar los desfases

Sin esperar más confirmación, editar cada doc para resolver los desfases reportados en Paso 3:
- Actualizar listas, tablas y rutas de archivos para que coincidan con el código real.
- Eliminar referencias a archivos que ya no existen (`schema.sql`, `functions/api/scores.js`, etc.).
- Agregar secciones para archivos/flujos nuevos que faltan.
- No reescribir secciones que ya están correctas.

## Paso 5 — Confirmar en el chat

Un resumen de qué docs se editaron, qué secciones cambiaron y cuáles estaban correctas.
