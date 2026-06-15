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
| tests/game.test.js | js/game.js | 19 | ✅ |
| tests/api/scores.test.js | functions/api/scores.js | 9 | ✅ |
| **Total** | | **33** | ✅ |

## Pendiente (diferido)

`js/ui.js` y `js/main.js` no están cubiertos: dependen de `document`/`fetch` y
requieren un DOM simulado (p. ej. jsdom). Se testearán cuando un cambio en ellos
lo amerite y sea estable bajo DOM simulado.
