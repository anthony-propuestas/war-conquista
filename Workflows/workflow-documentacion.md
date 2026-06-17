# Workflow — Documentación sincronizada con el código

**Propósito:** mantener una estructura documental completa y granular para WAR, creando los archivos faltantes y sincronizándolos con el código tras cada sesión de cambios. El foco es explicar **cómo funciona el código**, no qué líneas se tocaron.

## Estructura documental que este workflow mantiene

**Docs base** (todos existen actualmente en `Docs/`):

| Archivo | Qué documenta |
|---|---|
| `Docs/database.md` | Tablas D1 (estructura, índices), queries clave, historial de migraciones |
| `Docs/api.md` | Rutas HTTP: `GET/POST /api/game-room`, `POST /api/win`; handlers del Durable Object; shapes de request/response; códigos de error |
| `Docs/stack.md` | Stack completo: HTML/CSS/JS + Cloudflare Pages + Pages Functions + Durable Objects + D1; `dependencies` (`ethers ^6`) y `devDependencies` (`pixi.js`, `d3-geo`, `wrangler`, etc.); razones técnicas |
| `Docs/architecture.md` | Estructura de carpetas (`js/`, `functions/api/`, `worker/`, `game/`, `css/`, `tests/`); flujos principales (juego local, sala online); separación lógica/render/red |
| `Docs/environment.md` | Bindings en `wrangler.toml` y `worker/wrangler.toml` (D1 `DB`, Durable Object `GameRoom`), `compatibility_date`, configuración local vs producción |
| `Docs/deployment.md` | `npm run deploy` (Pages), `npm run deploy:worker` (Durable Object Worker), setup de D1, CI/CD desde GitHub |
| `Docs/style.md` | Tokens de color/tipografía/spacing en `css/style.css` (paleta navy + gold, Cinzel/Oswald), reglas del sistema de diseño matte |
| `Docs/realtime.md` | WebSockets, Durable Object `GameRoom` (`worker/index.js`), protocolo de mensajes (tipos, estados de sala), cliente `js/multiplayer.js` |

**Docs compartidos con otros workflows** (no duplicar — solo referenciar):

| Archivo | Notas |
|---|---|
| `Docs/security.md` | Lo mantiene `workflow-security.md`. Este workflow solo lo enlaza. |
| `Docs/testing.md` | Lo mantiene `workflow-test-despues-de-cambios.md`. Este workflow solo lo enlaza. |

**Docs opcionales** (existen porque el proyecto los necesita):
- `Docs/auth.md` — autenticación / sesiones de sala; wallet con `ethers`
- `Docs/onchain.md` — uso de `ethers.js`, interacción con contratos, firma de transacciones

---

## Paso 0 — Crear los docs faltantes

Verificar qué archivos de la estructura anterior existen. Actualmente `Docs/` existe con todos los docs base. Si alguno falta (borrado accidentalmente), recrearlo con contenido poblado desde el código real — no plantillas vacías ni `TODO`.

## Paso 1 — Ver qué cambió

Ejecutar `git diff HEAD~1` y `git status` (para cambios sin commitear). Leer el diff completo antes de decidir nada.

## Paso 2 — Decidir qué amerita documentar

Mapeo cambio → doc:

- ¿Cambió una tabla D1 o una query en `functions/api/*.js` o `worker/index.js`? → `Docs/database.md`
- ¿Se agregó/eliminó/cambió un endpoint en `functions/api/` o un handler en el Durable Object? → `Docs/api.md` + `Docs/architecture.md`
- ¿Cambió el protocolo de mensajes WebSocket o la lógica de sala en `worker/index.js`? → `Docs/realtime.md`
- ¿Cambió `js/multiplayer.js` (cliente WebSocket)? → `Docs/realtime.md`
- ¿Cambió el stack o `package.json` (scripts, dependencias, versiones)? → `Docs/stack.md`
- ¿Se agregó/renombró un módulo `js/*.js` o cambió su responsabilidad? → `Docs/architecture.md`
- ¿Cambió `wrangler.toml`, `worker/wrangler.toml` o algún binding? → `Docs/environment.md`
- ¿Cambió el proceso de deploy o los scripts `db:*` / `deploy:*`? → `Docs/deployment.md`
- ¿Cambió la lógica de wallet/firma con `ethers`? → `Docs/auth.md` o `Docs/onchain.md`
- ¿Cambiaron los tokens de `css/style.css` (colores, tipografía, radios)? → `Docs/style.md`
- **Excluir:** fixes de bugs sin cambio de interfaz, refactors internos, retoques visuales menores sin cambio de tokens.

## Paso 3 — Documentar

Describir el **flujo y el porqué**, no el diff. Actualizar tablas/listas desactualizadas. Eliminar secciones obsoletas (p. ej. referencias a `schema.sql` o `functions/api/scores.js` si quedaron en algún doc). Mantener `README.md` como portada de alto nivel; el detalle vive en `Docs/`.

## Paso 4 — Reportar en el chat

Resumir qué docs se crearon/actualizaron, qué secciones cambiaron y por qué.
