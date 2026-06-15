# Seguridad

Línea base de la postura de seguridad de WAR. Documenta **cómo está protegido hoy** y
qué riesgos se aceptan por diseño. Mantenido por `workflow-security.md`.

## Modelo de seguridad / alcance

WAR es un juego **hotseat local**: toda la partida ocurre en el navegador. La
superficie de red comprende:
- `/api/scores` — salón de la fama (público y anónimo por diseño)
- `/api/auth/google` y `/api/auth/callback` — login con Google OAuth 2.0 (nuevo)

La sesión se guarda en una cookie `war_session` (`HttpOnly; SameSite=Lax`).
**No hay** uploads/archivos, blockchain ni WebSockets.

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

## Auth — `functions/api/auth/`

- **Secrets fuera del repo:** `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` se leen de
  `env` (Cloudflare Secrets); `.dev.vars` está en `.gitignore`. No hay secrets en
  `wrangler.toml` ni en ningún archivo versionado.
- **Métodos correctos:** ambas functions son `GET` (redirigen; no mutan datos del servidor).
- **Sin queries D1:** no hay acceso a base de datos en el flujo de auth.
- **XSS:** los campos de `userInfo` (`name`, `email`, `picture`, `sub`) solo se escriben en
  la cookie — **no se renderizan en el DOM** en el callback. Cuando en el futuro se use la
  sesión para mostrar el nombre en la UI, debe pasar por `escapeHtml`.
- **Redirects seguros:** todos los redirects de error usan `${url.origin}/login?error=…`
  (origen fijado por el runtime de Cloudflare, no controlado por el cliente) → sin open redirect.
- **Cookie:** `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`. `HttpOnly` impide acceso
  desde JS; `SameSite=Lax` mitiga CSRF de formularios cross-site.

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

- `database_id` en `wrangler.toml` **no es un secreto**: el acceso lo controla el
  binding `DB` y la cuenta de Cloudflare, no el ID.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` van en **Secrets de Pages** (no en el repo).
  `.gitignore` excluye `.dev.vars*`, `.env*`, `*.pem`, `*.key`, `secrets.json`, `.cloudflare/`.
- Ningún token ni API key está versionado.

## Riesgos aceptados / vectores conocidos

No son vulnerabilidades confirmadas, pero se registran:

- **Inflado de `wins`:** cualquiera puede `POST /api/scores` con un `name` y sumar
  victorias sin haber jugado — no hay auth, rate-limit ni token de partida. **Aceptado
  por diseño** (juego casual, leaderboard de vanidad). Mitigaciones posibles si llegara
  a importar: Cloudflare Turnstile, rate-limit en la Function, o un token de partida
  emitido y verificado server-side.
- **Sin rate-limiting** en el endpoint en general (abuso/spam de escrituras).
- **Cookie `war_session` sin firma (HMAC):** el valor es JSON base64 sin verificación
  criptográfica. Alguien con acceso al dispositivo (o con JS malicioso ya ejecutándose)
  puede forjar o alterar la cookie y suplantar otro `sub`/`email`. En HTTPS (Cloudflare
  Pages) requiere compromiso previo del cliente. La cookie hoy solo guarda datos de
  presentación; **no controla acceso a recursos protegidos**. Mitigación futura: HMAC
  con un secret de Cloudflare Workers. **Aceptado para MVP.**
- **Sin parámetro `state` en OAuth (Login CSRF):** `/api/auth/google` no genera un
  `state` ni `/api/auth/callback` lo verifica. Permite **Login CSRF**: un atacante
  puede hacer que una víctima complete el flujo OAuth con la cuenta del atacante (la
  víctima queda logueada como el atacante). Impacto bajo en WAR (leaderboard de vanidad,
  sin datos personales expuestos). **Pendiente de corrección:** generar un `state`
  aleatorio en `/api/auth/google` (guardarlo en cookie temporal), verificarlo en el
  callback y rechazar si no coincide.
- **`tokenData.error` sin `encodeURIComponent` en redirect:** en `callback.js`,
  `${url.origin}/login?error=${tokenData.error}` no escapa el valor de `error` de Google.
  Si contiene `&` o `=` podría contaminar el query string del redirect. No es XSS ni SQL
  (no se renderiza en DOM), pero es un defecto menor de encoding. Riesgo muy bajo.
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
- [ ] (Si toca auth) El flujo OAuth envía y verifica el parámetro `state`.
- [ ] (Si toca auth) Los redirects de error usan `encodeURIComponent` para el valor de `error`.
- [ ] (Si toca auth) Todo campo de `userInfo` renderizado en el DOM pasa por `escapeHtml`.

## Historial de revisiones

- **2026-06-14** — Línea base inicial. Cambio revisado: `database_id` real en
  `wrangler.toml` + enlace a la demo en `README.md`. **Hallazgo: ninguno** (no introduce
  superficie nueva; se confirma que `database_id` no es secreto).
- **2026-06-14** — Rediseño visual del mapa y del banner (`ui.js`, `css`, fuentes). Nuevo
  sink de DOM en `updateBanner()` para el nombre de jugador: **escapado** con `escapeHtml`.
  **Hallazgo:** `winner.name` se renderiza **sin escapar** en el modal de victoria de
  `main.js` (`onGameOver`) — self-XSS de bajo impacto en hotseat; registrado en *Riesgos
  conocidos* a la espera de decisión. Sin cambios en backend, queries ni cabeceras.
- **2026-06-15** — Google OAuth login: `login.html`, `functions/api/auth/google.js`,
  `functions/api/auth/callback.js`. Secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
  fuera del repo. Cookie `HttpOnly; SameSite=Lax`. **Hallazgos:** (1) cookie sin firma
  HMAC — aceptado MVP; (2) sin parámetro `state` → Login CSRF posible, impacto bajo,
  pendiente de corrección; (3) `tokenData.error` sin `encodeURIComponent` en redirect —
  riesgo muy bajo, registrado. Sin cambios en `/api/scores`, D1, esquema ni cabeceras.
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
