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
| tests/map-data.test.js | js/map-data.js | 5 | ✅ |
| tests/game.test.js | js/game.js | 21 | ✅ |
| tests/map-shapes.test.js | js/map-shapes.js | 4 | ✅ |
| tests/api/auth/google.test.js | functions/api/auth/google.js | 2 | ✅ |
| tests/api/auth/callback.test.js | functions/api/auth/callback.js | 5 | ✅ |
| tests/multiplayer.test.js | js/multiplayer.js | 16 | ✅ |
| tests/api/game-room.test.js | worker/index.js | 12 | ✅ |
| tests/api/gamers.test.js | functions/api/gamers.js | 1 | ✅ |
| tests/api/profile.test.js | functions/api/profile.js | 4 | ✅ |
| tests/api/register.test.js | functions/api/register.js | 10 | ✅ |
| tests/api/auth/wallet.test.js | functions/api/auth/wallet.js | 5 | ✅ |
| tests/api/wallet/link.test.js | functions/api/wallet/link.js | 6 | ✅ |
| tests/api/win.test.js | functions/api/win.js | 3 | ✅ |
| **Total** | | **94** | ✅ |

## Pendiente (diferido)

`js/ui.js` y `js/main.js` no están cubiertos: dependen de `document`/`fetch` y
requieren un DOM simulado (p. ej. jsdom). Se testearán cuando un cambio en ellos
lo amerite y sea estable bajo DOM simulado.

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
