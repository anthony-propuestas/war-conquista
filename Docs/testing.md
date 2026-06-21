# Testing

Runner: **`node --test`** (integrado en Node, sin dependencias). Requiere **Node ≥21**
(el script usa un patrón glob que el test runner soporta desde Node 21; el proyecto se
prueba en Node 24). Ejecutar:

```bash
npm test          # corre una vez (modo CI)
npm run test:watch
```

Los tests viven en `tests/` (versionados, excluidos del deploy vía `.assetsignore`).

## Suites

| Suite | Archivo bajo prueba | Casos | Estado |
|---|---|---|---|
| tests/_lib/session.test.js | functions/_lib/session.js | 7 | ✅ |
| tests/map-data.test.js | js/map-data.js | 5 | ✅ |
| tests/game.test.js | js/game.js | 31 | ✅ |
| tests/map-shapes.test.js | js/map-shapes.js | 4 | ✅ |
| tests/api/auth/google.test.js | functions/api/auth/google.js | 2 | ✅ |
| tests/api/auth/callback.test.js | functions/api/auth/callback.js | 7 | ✅ |
| tests/multiplayer.test.js | js/multiplayer.js | 27 | ✅ |
| tests/api/game-room.test.js | worker/index.js + functions/api/game-room.js | 30 | ✅ |
| tests/api/gamers.test.js | functions/api/gamers.js | 1 | ✅ |
| tests/api/profile.test.js | functions/api/profile.js | 4 | ✅ |
| tests/api/register.test.js | functions/api/register.js | 10 | ✅ |
| tests/api/auth/wallet.test.js | functions/api/auth/wallet.js | 5 | ✅ |
| tests/api/wallet/link.test.js | functions/api/wallet/link.js | 6 | ✅ |
| tests/api/win.test.js | functions/api/win.js | 3 | ✅ |
| tests/api/cards/inventory.test.js | functions/api/cards/inventory.js | 3 | ✅ |
| tests/api/cards/use.test.js | functions/api/cards/use.js | 4 | ✅ |
| tests/api/cards/delete.test.js | functions/api/cards/delete.js | 3 | ✅ |
| tests/api/battle-pass/claim.test.js | functions/api/battle-pass/claim.js | 5 | ✅ |
| tests/api/battle-pass/status.test.js | functions/api/battle-pass/status.js | 3 | ✅ |
| tests/api/admin/cards.test.js | functions/api/admin/cards.js | 5 | ✅ |
| tests/api/admin/battle-pass.test.js | functions/api/admin/battle-pass.js | 4 | ✅ |
| **Total** | | **169** | ✅ |

## Pendiente (diferido)

`js/ui.js` y `js/main.js` no están cubiertos: dependen de `document`/`fetch` y
requieren un DOM simulado (p. ej. jsdom). Se testearán cuando un cambio en ellos
lo amerite y sea estable bajo DOM simulado. El flujo de modo online nuevo en
`js/main.js` (emparejamiento, modal de espera, contador con `setInterval`) y el
temporizador de turno de `js/ui.js` siguen diferidos por esa razón: dependen de
DOM y timers no estables bajo `node --test`. La lógica pura del modo online sí se
cubre en `js/multiplayer.js` (`requestMatch`, params `public`/`openUntil`, y la
reconexión automática con backoff + heartbeat ping/pong usando `mock.timers`) y en el
router de Pages (`functions/api/game-room.js`). El banner de reconexión y el manejo de
`state_sync` en `js/main.js` siguen diferidos (DOM).

`scripts/dev.mjs` (lanzador de desarrollo que hace `spawn` de los procesos de
wrangler) no tiene test: es tooling con efectos de proceso, sin lógica pura.

`js/wallet.js` (incluye `signMessage`; depende de `ethers` + `window.ethereum`) y `js/pixi-overlay.js`
(canvas/WebGL vía Pixi.js) tampoco se cubren: requieren mockear la cadena Web3 y un
contexto gráfico que no son estables bajo `node --test`. Diferidos hasta que el cambio
lo amerite.

La geometría del mapa se extrajo de `js/ui.js` a `js/map-shapes.js` (datos generados
por `scripts/build-map-shapes.mjs` a partir de Natural Earth). `ui.js` ya solo consume
esas formas, así que los helpers puros que antes vivían inline (`convexHull`,
`expandCoast`, `smoothClosedPath`, `mixColor`/`lighten`/`darken`) desaparecieron. La
validación de las formas (todas dentro del viewBox, la etiqueta cae dentro de su zona,
sin formas huérfanas, rutas marítimas adyacentes) la cubre `tests/map-shapes.test.js`.

`home/index.html` (landing page) y `_redirects` no tienen tests: el primero es HTML
estático sin lógica JS propia, el segundo es configuración de Cloudflare Pages.
