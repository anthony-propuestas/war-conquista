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
| tests/game.test.js | js/game.js | 14 | ✅ |
| tests/api/scores.test.js | functions/api/scores.js | 9 | ✅ |
| tests/map-shapes.test.js | js/map-shapes.js | 4 | ✅ |
| **Total** | | **32** | ✅ |

## Pendiente (diferido)

`js/ui.js` y `js/main.js` no están cubiertos: dependen de `document`/`fetch` y
requieren un DOM simulado (p. ej. jsdom). Se testearán cuando un cambio en ellos
lo amerite y sea estable bajo DOM simulado.

La geometría del mapa se extrajo de `js/ui.js` a `js/map-shapes.js` (datos generados
por `scripts/build-map-shapes.mjs` a partir de Natural Earth). `ui.js` ya solo consume
esas formas, así que los helpers puros que antes vivían inline (`convexHull`,
`expandCoast`, `smoothClosedPath`, `mixColor`/`lighten`/`darken`) desaparecieron. La
validación de las formas (todas dentro del viewBox, la etiqueta cae dentro de su zona,
sin formas huérfanas, rutas marítimas adyacentes) la cubre `tests/map-shapes.test.js`.
