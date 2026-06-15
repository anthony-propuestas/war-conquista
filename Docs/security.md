# Seguridad

Línea base de la postura de seguridad de WAR. Documenta **cómo está protegido hoy** y
qué riesgos se aceptan por diseño. Mantenido por `workflow-security.md`.

## Modelo de seguridad / alcance

WAR es un juego **hotseat local**: toda la partida ocurre en el navegador. La única
superficie de red es el endpoint `/api/scores` (salón de la fama).

Por diseño **no hay**: autenticación, sesiones, cookies, tokens, uploads/archivos,
OAuth, ni blockchain. El salón de la fama es **público y anónimo** a propósito.

## Backend — `functions/api/scores.js`

- **Separación de métodos:** lecturas solo `GET` (`onRequestGet`), mutación solo `POST`
  (`onRequestPost`). No hay mutación por GET.
- **Queries parametrizadas:** todo acceso a D1 usa `.prepare(...).bind(...)`; ningún
  valor del usuario se interpola en el SQL → sin inyección.
- **Validación de input:** `name = String(body?.name ?? "").trim().slice(0, 16)`;
  se rechaza vacío (`400 no-name`) y JSON inválido (`400 bad-json`).
- **`SELECT` acotado:** `ORDER BY wins DESC, updated_at DESC LIMIT 10` con límite
  **fijo en el servidor** (no controlado por el cliente). Expone solo `name` y `wins`
  (no `updated_at` ni columnas internas).
- **Degradación segura:** sin `env.DB` responde `[]` (GET) o `{ok:false,"no-db"}` (POST)
  en vez de fallar; los errores de DB devuelven `[]` / `{ok:false,"db-error"}` sin filtrar
  detalles internos. Ver [api.md](api.md) y [database.md](database.md).

## Frontend — `js/main.js` y `js/ui.js`

- **XSS (output encoding):** el `name` que vuelve de la DB pasa por `escapeHtml()` antes
  de inyectarse con `innerHTML` en el render del leaderboard (`main.js`). La defensa está
  en la **salida**: el `name` se almacena crudo (solo `trim`/truncado a 16), así que
  cualquier renderizado nuevo de datos de DB **debe** escaparse igual.
- `wins` se renderiza sin escapar pero es numérico (columna `INTEGER` de D1).
- **Banner de turno (`ui.js`):** `updateBanner()` inyecta el nombre del jugador (input de
  la pantalla de inicio, `maxLength=16`) y su inicial con `innerHTML`; ambos pasan por una
  copia local de `escapeHtml`. Sink nuevo, **correctamente escapado**.
- **Duplicación de `escapeHtml`:** existe la misma función en `main.js` y en `ui.js`. No es
  una vulnerabilidad, pero el riesgo es divergencia futura; si crece la lógica de escape,
  unificarla en un módulo compartido.

## Cabeceras — `_headers`

Baseline aplicado a todo el sitio (no debilitar):

| Cabecera | Valor |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (anti-clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |

`/assets/*` además lleva `Cache-Control: public, max-age=31536000, immutable`.

## Configuración y secretos

- `database_id` en `wrangler.toml` **no es un secreto**: es un identificador de recurso;
  el acceso lo controla el binding `DB` y la cuenta de Cloudflare, no el ID.
- **No hay** tokens ni API keys en el repo. `.gitignore` excluye `.dev.vars*`, `.env*`,
  `*.pem`, `*.key`, `secrets.json`, `.cloudflare/`.
- Cualquier secret futuro va en **Secrets de Pages**, nunca versionado.

## Riesgos aceptados / vectores conocidos

No son vulnerabilidades confirmadas, pero se registran:

- **Inflado de `wins`:** cualquiera puede `POST /api/scores` con un `name` y sumar
  victorias sin haber jugado — no hay auth, rate-limit ni token de partida. **Aceptado
  por diseño** (juego casual, leaderboard de vanidad). Mitigaciones posibles si llegara
  a importar: Cloudflare Turnstile, rate-limit en la Function, o un token de partida
  emitido y verificado server-side.
- **Sin rate-limiting** en el endpoint en general (abuso/spam de escrituras).
- **XSS por nombre de jugador en el modal de victoria (`main.js`, `onGameOver`):** el modal
  inyecta `winner.name` con `innerHTML` **sin** `escapeHtml` (a diferencia del banner y el
  leaderboard, que sí escapan). El nombre es input local de la pantalla de inicio, así que
  hoy es a lo sumo un **self-XSS** en una partida hotseat (el límite de 16 caracteres aún
  permite payloads como `<svg/onload=...>`). **Pendiente de decisión del usuario:** envolver
  `winner.name` (y por consistencia `winner.color`) con `escapeHtml`. No corregido aquí
  porque queda fuera del cambio de esta sesión (visual) y el workflow de seguridad solo
  registra; la corrección de código se confirma aparte.

## Checklist pre-producción

Para cada cambio que toque la superficie de ataque:

- [ ] Lecturas siguen en `GET`, mutaciones en `POST`.
- [ ] Toda query a D1 sigue parametrizada con `.bind(...)`.
- [ ] Inputs nuevos tienen límite de tipo/longitud y se rechaza el vacío.
- [ ] El `SELECT` no expone columnas internas ni acepta `LIMIT` del cliente.
- [ ] Todo dato de DB renderizado en el DOM pasa por `escapeHtml`.
- [ ] `_headers` conserva las cuatro cabeceras de seguridad.
- [ ] No se añaden secretos en texto plano al repo.

## Historial de revisiones

- **2026-06-14** — Línea base inicial. Cambio revisado: `database_id` real en
  `wrangler.toml` + enlace a la demo en `README.md`. **Hallazgo: ninguno** (no introduce
  superficie nueva; se confirma que `database_id` no es secreto).
- **2026-06-14** — Rediseño visual del mapa y del banner (`ui.js`, `css`, fuentes). Nuevo
  sink de DOM en `updateBanner()` para el nombre de jugador: **escapado** con `escapeHtml`.
  **Hallazgo:** `winner.name` se renderiza **sin escapar** en el modal de victoria de
  `main.js` (`onGameOver`) — self-XSS de bajo impacto en hotseat; registrado en *Riesgos
  conocidos* a la espera de decisión. Sin cambios en backend, queries ni cabeceras.
- **2026-06-15** — Mapa con geometría real: `ui.js` deja de generar costas procedurales y
  consume paths pregenerados de `js/map-shapes.js` (nuevo, generado por
  `scripts/build-map-shapes.mjs`); nuevas `devDependencies` de build (`d3-geo`,
  `d3-geo-projection`, `topojson-client`, `world-atlas`). **Hallazgo: ninguno en runtime.**
  Las formas son datos estáticos del repo (no input de usuario) asignadas vía `setAttribute`,
  no introducen sink de DOM nuevo; el sink de `name` en `updateBanner()` sigue escapado. Las
  cuatro dependencias nuevas son **superficie de cadena de suministro solo en build** (las
  usa exclusivamente el script `.mjs` dev-only; no se cargan en el cliente ni se despliegan).
  Sin cambios en backend, queries, esquema ni cabeceras. El self-XSS de `winner.name` sigue
  pendiente (no tocado en esta sesión).
