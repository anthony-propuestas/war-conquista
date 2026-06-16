# Seguridad

Línea base de la postura de seguridad de WAR. Documenta **cómo está protegido hoy** y
qué riesgos se aceptan por diseño. Mantenido por `workflow-security.md`.

## Modelo de seguridad / alcance

WAR es un juego de estrategia multijugador. La superficie de red comprende:
- `/api/scores` — salón de la fama (público y anónimo por diseño)
- `/api/auth/google` y `/api/auth/callback` — login con Google OAuth 2.0
- `/api/game-room` — WebSocket a través de un Durable Object (`GameRoom`)

La sesión se guarda en una cookie `war_session` (`HttpOnly; SameSite=Lax`).
No hay uploads/archivos. La wallet Web3 (`wallet.js`) es experimental (sin contratos
desplegados en producción).

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

## WebSocket y wallet — mecanismos activos

| Componente | Mecanismo |
|---|---|
| `multiplayer.js` | `encodeURIComponent` en parámetros URL del WebSocket. JSON parse con `try/catch`; mensajes con JSON inválido descartados. |
| `functions/game-room.js` | Solo acepta conexiones con cabecera `Upgrade: websocket` (responde 426 en caso contrario). Parse JSON con `try/catch` en `webSocketMessage`. |
| `js/wallet.js` | MetaMask requiere aprobación explícita del usuario antes de cualquier transacción. Sin contratos desplegados en producción, no hay riesgo on-chain real. |

## Riesgos aceptados / vectores conocidos

No son vulnerabilidades confirmadas, pero se registran:

- **Inflado de `wins`:** cualquiera puede `POST /api/scores` con un `name` y sumar
  victorias sin haber jugado — no hay auth, rate-limit ni token de partida. **Aceptado
  por diseño** (juego casual, leaderboard de vanidad). Mitigaciones posibles si llegara
  a importar: Cloudflare Turnstile, rate-limit en la Function, o un token de partida
  emitido y verificado server-side.
- **Sin rate-limiting** en el endpoint en general (abuso/spam de escrituras).
- **Spoofing de identidad en WebSocket (`game-room.js:14`):** `playerId` se toma del
  parámetro URL sin verificar contra la cookie `war_session`. Cualquier cliente puede
  conectarse declarando el `playerId` de otro jugador y enviar acciones como si fuera él.
  Aceptado para MVP (partidas efímeras de bajo valor). Mitigación futura: leer `war_session`
  en el DO y rechazar si `sub` no coincide con `playerId`.
- **Persistencia de payload sin validar (`game-room.js:28`):** `data.payload` se escribe
  en DO storage directamente. Un cliente malicioso puede corromper el estado compartido de
  la sala. Aceptado para MVP. Mitigación futura: validar `payload` contra schema mínimo
  (tipos y rangos de `board`, `currentIndex`, `phase`) antes de persistir.
- **`Object.assign` sin schema (`main.js:85`):** `Object.assign(game.board, msg.payload.board ?? {})`
  acepta cualquier objeto del WebSocket. Permite sobrescribir campos internos del board
  desde la red. Aceptado para MVP. Mitigación futura: validar claves y tipos del payload
  antes de asignar, o reconstruir el objeto en vez de mutar el existente.
- **Sin `Content-Security-Policy`:** los scripts inline existentes en los HTML y la carga
  de esm.sh no están explícitamente allowlisteados. Sin CSP cualquier script inyectado
  en el DOM (requiere otro vector previo) se ejecutaría sin restricción. Aceptado por
  complejidad de configurar CSP con `unsafe-inline` y CDN externo. Mitigación futura:
  añadir CSP permisiva pero explícita a `_headers`.
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
- [ ] (Si toca WebSocket) `playerId` se valida contra la cookie `war_session` en el DO.
- [ ] (Si toca WebSocket) El payload del mensaje se valida contra schema antes de persistir.
- [ ] (Si toca estado de juego en red) Los datos asignados al board tienen schema y tipo verificado.

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
- **2026-06-15** — Landing page y redirect raíz: `home/index.html` (página pública en `/home`) y `_redirects` (`/ → /home 302`). **Hallazgo: ninguno.** `home/index.html` es HTML estático sin formularios, sin input de usuario, sin backend y sin cookies — superficie de ataque nula. `_redirects` solo afecta el enrutamiento de Cloudflare Pages; el destino `/home` es interno. Sin cambios en endpoints, queries, esquema, cabeceras ni secrets.
- **2026-06-15** — Multiplayer (WebSocket + Durable Object), wallet Web3 y Pixi.js:
  `functions/game-room.js` (DO), `js/multiplayer.js`, `js/wallet.js`, `js/pixi-overlay.js`.
  Importmaps migrados de `node_modules/` a esm.sh CDN (riesgo de deploy eliminado).
  **Hallazgos:** (C1) spoofing de `playerId` en WebSocket — aceptado MVP; (C2) payload
  WebSocket persiste sin validar en DO storage — aceptado MVP; (C3) `Object.assign` sobre
  board sin schema (`main.js:85`) — aceptado MVP; (M3) falta CSP — aceptado por complejidad.
  `wallet.js` no añade riesgo server-side (MetaMask requiere aprobación del usuario; sin
  contratos desplegados). El self-XSS de `winner.name` sigue pendiente (no tocado).
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
