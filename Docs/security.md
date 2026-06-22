# Seguridad

Línea base de la postura de seguridad de WAR. Documenta **cómo está protegido hoy** y
qué riesgos se aceptan por diseño. Mantenido por `workflow-security.md`.

## Modelo de seguridad / alcance

WAR es un juego de estrategia multijugador. La superficie de red comprende:
- `/api/win` — registra +1 victoria del usuario autenticado (requiere `war_session`, escribe en DB)
- `/api/gamers` — ranking de jugadores registrados (público, sin auth)
- `/api/profile` — perfil del usuario autenticado (requiere `war_session`)
- `/api/register` — registro de nuevo usuario en D1 (requiere `war_session`, escribe en DB)
- `/api/auth/google` y `/api/auth/callback` — login con Google OAuth 2.0
- `/api/auth/wallet` — login alterno firmando un mensaje con MetaMask
- `/api/wallet/link` — vincula una wallet a la cuenta de la sesión actual (requiere `war_session`, escribe en DB)
- `/api/game-room` — WebSocket a través de un Durable Object (`GameRoom`)
- `/api/cards/inventory` — lista cartas no usadas del usuario autenticado (requiere `war_session`)
- `/api/cards/use` — marca una carta como usada (requiere `war_session`, escribe en DB)
- `/api/cards/delete` — elimina una carta del inventario (requiere `war_session`, escribe en DB)
- `/api/battle-pass/status` — devuelve calendario del mes y días reclamados (requiere `war_session`)
- `/api/battle-pass/claim` — reclama la recompensa del día actual (requiere `war_session`, escribe en DB)
- `/api/admin/cards` — CRUD de definiciones de cartas (requiere `war_session` con email en `ADMIN_EMAILS`)
- `/api/admin/battle-pass` — CRUD de recompensas del calendario (requiere `war_session` con email en `ADMIN_EMAILS`)
- `/api/admin/shop-listings` — gestión del catálogo de la tienda (requiere `war_session` con email en `ADMIN_EMAILS`)
- `/api/shop/listings` — listado público de cartas en venta (sin auth, solo lectura)
- `/api/claim-wgt` — reclama tokens WGT acumulados por victorias de meses pasados (requiere `war_session` + firma ECDSA de wallet, escribe en DB + llama contrato en Base)
- `/api/deliver-item` — entrega un ítem tras verificar una compra on-chain (requiere `war_session` + `txHash` verificado en Base, escribe en DB)
- `/api/shop/inventory` — lista ítems del usuario en el shop (requiere `war_session`)
- `/api/shop/pending-wgt` — WGT reclamable pendiente del usuario (requiere `war_session`)

La sesión se guarda en una cookie `war_session` (`HttpOnly; SameSite=Lax`).
No hay uploads/archivos. Los contratos on-chain (`contracts/src/`) existen en el repo
pero **no están desplegados en producción todavía**; la capa on-chain se considera
pre-producción.

## Backend — `functions/api/win.js`

- **Método correcto:** solo `POST` (`onRequestPost`); no hay mutación por GET.
- **Query parametrizada:** `UPDATE users SET wins = wins + 1 WHERE sub = ?` — el
  `sub` viene de la cookie, nunca se interpola en el SQL → sin inyección.
- **Cookie validada con `try/catch`:** `JSON.parse(atob(...))` aislado; cookie
  ausente, malformada o sin `sub` responde `200 {ok:false}` sin tocar la DB (no
  hay rama `500`: no hay try/catch alrededor de la query en sí).
- **Hallazgo — sin verificación de que el usuario ganó realmente:** el endpoint
  confía por completo en que el cliente solo lo llama tras un `gameover` legítimo
  (`onGameOver` en `js/main.js`). No hay token de partida ni verificación
  server-side de que hubo una victoria real. Cualquier usuario autenticado puede
  llamar `POST /api/win` repetidamente desde devtools/curl e inflar su propio
  contador sin jugar. Es la misma clase de riesgo que el "inflado de wins" ya
  aceptado para el leaderboard legacy (ver *Riesgos aceptados*), pero ahora afecta
  a **cuentas reales** que se muestran en `/api/gamers`. **Aceptado para MVP**
  (juego casual); mitigación futura: token de partida firmado server-side al
  iniciar la sala, verificado al reportar la victoria.
  - **Nota (2026-06-19):** desde esta sesión el cliente solo llama `POST /api/win` en
    el **modo online de emparejamiento** (`rankedOnline` en `js/main.js`; local y salas
    manuales ya no reportan). Es una decisión de **producto/UX, no un control de
    seguridad**: el endpoint no cambió y sigue confiando en el caller, por lo que el
    inflado por curl/devtools es idéntico.
- **Hallazgo — otro endpoint de escritura gateado solo por la cookie sin HMAC:**
  se suma a `profile`/`register`/`wallet/link` en la lista de endpoints cuyo único
  control de acceso es el campo `sub` de `war_session`, que no está firmado (ver
  hallazgo de cookie sin HMAC más abajo).

## Backend — endpoints de usuario (`gamers`, `profile`, `register`)

### `GET /api/gamers`
- Lectura pública; sin auth por diseño.
- `LIMIT 100` fijo en servidor — el cliente no controla el tamaño de la respuesta.
- Expone solo `username` y `wins`; ningún campo interno (`sub`, `email`, `age`).
- **XSS desde username:** la validación en `/api/register` restringe `username` a `[a-zA-Z0-9_]` → ningún carácter HTML especial (`<`, `>`, `"`, `&`) puede estar almacenado en DB → dato seguro al renderizarse en el DOM incluso sin `escapeHtml` adicional. Esta es una **defensa en la entrada** que protege todos los sinks futuros del campo.

### `GET /gamers/<username>` (`functions/gamers/[username].js`)
- Ruta de página pública (HTML), sin auth, solo lectura: `SELECT username, wins … WHERE username = ? COLLATE NOCASE` (parametrizada).
- **XSS:** interpola `user.username` y `user.wins` en el HTML de respuesta por template literal **sin `escapeHtml`**, pero ambos son seguros por la **defensa en la entrada** ya descrita: `username` está restringido a `[a-zA-Z0-9_]` en `/api/register` y `wins` es `INTEGER`. No explotable hoy; si en el futuro se relaja el charset de `username`, este sink se vuelve XSS reflejado y habría que escaparlo.
- Expone solo `username` y `wins` (mismos campos que el ranking público); ninguna columna interna.

### `GET /api/profile`
- Requiere cookie `war_session` válida; sin ella devuelve 401.
- `getSession()` (de `functions/_lib/session.js`) verifica la firma HMAC-SHA256 antes de deserializar; cookies ausentes, manipuladas o sin firma devuelven `null` → 401, sin excepción.
- Solo expone `username` y `wins`; no filtra `sub`, `email`, `age` ni `id`.
- 401 y 404 no revelan si el `sub` existe o no (respuestas genéricas).

### `POST /api/register`
- `POST` correcto para una mutación.
- Todas las queries a D1 están parametrizadas: `SELECT … WHERE sub = ?`, `SELECT … WHERE username = ?`, `INSERT INTO users … VALUES (?, ?, …)`.
- Validaciones presentes: tipo de campo, longitud de username (3–30), regex `[a-zA-Z0-9_]`, rango de edad (5–120), email con regex básica `^[^\s@]+@[^\s@]+\.[^\s@]+$`, allowlist de `how_heard`.
- `username.trim()` y `email.trim()` eliminan whitespace antes de almacenar.

## Auth — `functions/api/auth/`

- **Secrets fuera del repo:** `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` se leen de
  `env` (Cloudflare Secrets); `.dev.vars` está en `.gitignore`. No hay secrets en
  `wrangler.toml` ni en ningún archivo versionado.
- **Métodos correctos:** ambas functions son `GET` (redirigen; no mutan datos del servidor).
- **Sin queries D1:** no hay acceso a base de datos en el flujo de auth.
- **XSS:** los campos de `userInfo` (`name`, `email`, `picture`, `sub`) solo se escriben en
  la cookie — **no se renderizan en el DOM** en el callback. Cuando en el futuro se use la
  sesión para mostrar el nombre en la UI, debe pasar por `escapeHtml`.
- **Redirects seguros:** los redirects de error usan el origen fijado por el runtime de
  Cloudflare (no controlable por el cliente) → sin open redirect. El redirect "sin code /
  error de Google" va a `/login.html?error=…`; el resto van a `/login?error=…`.
- **Cookie:** `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`. `HttpOnly` impide acceso
  desde JS; `SameSite=Lax` mitiga CSRF de formularios cross-site.

## Backend — login y vinculación de wallet (`functions/api/auth/wallet.js`, `functions/api/wallet/link.js`)

- **Mecanismos correctos:** ambos endpoints son `POST`; ambas queries a D1 están
  parametrizadas (`WHERE wallet_address = ?`, `UPDATE … WHERE sub = ?`); el `try/catch`
  alrededor de `ethers.verifyMessage` captura firmas malformadas y responde `400` sin
  filtrar detalles; la cookie que emite `auth/wallet.js` usa los mismos atributos que el
  login con Google (`HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`).
- **Hallazgo — firma sin nonce/expiración (replay indefinido):** el mensaje firmado es
  estático: `Iniciar sesión en WAR con esta wallet (${address})` /
  `Vincular esta wallet a mi cuenta WAR (${sub})`. No incluye nonce, timestamp ni
  desafío emitido por el servidor. Una firma capturada una sola vez (logs, proxy, MitM,
  historial del navegador) sirve para autenticarse **para siempre**: no expira ni se
  puede revocar. Compárese con SIWE (Sign-In with Ethereum), que exige nonce + dominio +
  expiración por diseño. **Aceptado para MVP**, pendiente de decisión.
- **Hallazgo — mensaje sin binding de dominio (phishing cross-site):** el texto firmado
  no incluye el origen (`war-conquista.pages.dev`). Un sitio de phishing puede mostrar
  un botón "Conectar wallet" y pedirle a la víctima que firme exactamente ese mismo
  mensaje; la firma resultante es válida en el backend real de WAR. La víctima nunca
  interactúa con el sitio real pero el atacante obtiene acceso completo a su cuenta.
  **Aceptado para MVP**, mitigación futura: incluir el dominio en el mensaje firmado
  (estilo SIWE) y verificarlo.
- **Hallazgo — escalada del riesgo ya conocido de cookie sin HMAC:**
  `functions/api/wallet/link.js` confía en `session.sub` leído de la cookie **no
  firmada** para decidir a qué cuenta vincular la wallet. Quien ya pudiera forjar
  `war_session = btoa({sub: "<sub_de_la_víctima>"})` (riesgo documentado abajo) y firme
  el mensaje de vinculación **con su propia wallet** (la firma solo necesita coincidir
  con el `sub` que él mismo puso en la cookie forjada) puede vincular su wallet a la
  cuenta de la víctima. Desde ahí ya no necesita seguir forjando cookies: entra con
  `POST /api/auth/wallet` usando su wallet real, de forma persistente, como **puerta
  trasera** a la cuenta ajena. Sube la prioridad de firmar `war_session` con HMAC.

## Backend — endpoints on-chain (`functions/api/claim-wgt.js`, `functions/api/deliver-item.js`, `functions/api/shop/`)

### `POST /api/claim-wgt`

- **Auth:** sesión HMAC (`getSession()` → 401) + firma ECDSA sobre mensaje `<userId>:<timestamp>`.
- **Replay protection:** el backend verifica `|Date.now() - timestamp| ≤ 5 min`; una firma capturada expira. Mejora sobre `auth/wallet.js` (firma estática sin expiración).
- **Wallet ownership:** `ethers.verifyMessage` recupera la address y la compara case-insensitive con `users.wallet_address`.
- **Queries parametrizadas:** `SELECT … WHERE sub = ?`, `SELECT … WHERE user_id = ? AND claimed_at IS NULL AND year_month < ?`. El `UPDATE … WHERE id IN (${placeholders})` usa IDs devueltos por la propia query (nunca input del usuario) → sin inyección.
- **Anti-doble-mint:** `claimed_at` se setea en D1 **antes** de la llamada al contrato; si la tx falla, el UPDATE se revierte → no es posible mintear dos veces el mismo mes.
- **Solo meses cerrados:** `year_month < mes_actual` — no puede reclamarse el mes en curso.
- **Hallazgo — [INFO] Sin rate limit:** un atacante autenticado podría hacer polling frecuente. Riesgo bajo (la query devuelve vacío si no hay meses pendientes). Extiende el riesgo ya documentado de sin rate-limiting general.

### `POST /api/deliver-item`

- **Input `txHash`:** validado con `/^0x[0-9a-fA-F]{64}$/` — formato incorrecto → 400.
- **Anti-replay:** `SELECT id FROM delivered_txs WHERE tx_hash = ?` antes de procesar; hash ya usado → 409.
- **Verificación on-chain (lectura):** `receipt.status === 1` (tx exitosa), `receipt.to === env.SHOP_CONTRACT` (case-insensitive), evento `ItemPurchased` con `buyer === user.wallet_address`. Sin estas tres condiciones → rechazo.
- **Queries parametrizadas:** `SELECT … WHERE sub = ?`, `SELECT … WHERE id = ? AND is_active = 1`, `INSERT INTO user_shop_items … ON CONFLICT DO UPDATE`, `INSERT INTO delivered_txs`. Batch atómico.
- **Secreto `SHOP_CONTRACT`:** viene de `env` (binding de Pages), no del repo.

### `GET|POST|DELETE /api/admin/shop-listings` y `GET /api/shop/listings`

- **Auth:** `GET|POST|DELETE /api/admin/shop-listings` requiere `war_session` HMAC + `ADMIN_EMAILS` (403 si no). `GET /api/shop/listings` es público — sin auth por diseño (catálogo de tienda, equivalente a `/api/gamers`).
- **Queries parametrizadas:** GET usa LEFT JOIN con `WHERE cd.is_active = 1` (sin input de usuario); POST usa UPSERT con `.bind(Number(card_def_id), …)`; DELETE usa `WHERE card_def_id = ?` con el param de URL. Sin interpolación de strings.
- **Validación de inputs POST:** `!card_def_id → 400`; `wgt_price = Math.max(0, Number(wgt_price) || 1)` — convierte a número, impide precios negativos, defecto 1.
- **Datos expuestos:** admin GET devuelve `card_def_id`, `name`, `description`, `effect_type`, `effect_value`, `is_listed`, `wgt_price` — sin columnas internas (`listed_at`, timestamps). Público GET excluye `is_listed` (solo devuelve cartas con `is_listed=1`).
- **Método no reconocido → 405** (texto plano; no filtra información interna).
- **`card_def_id` en onclick admin:** `onclick="saveListing(${l.card_def_id})"` en `admin/index.html` — `card_def_id` es `INTEGER` de D1, nunca string de usuario → sin inyección de JS.
- **Hallazgo — [BAJO] XSS en `shop/index.html` vía descripción/nombre admin:** `card.innerHTML` interpola `${item.name}` y `${item.description}` (de `card_definitions`) sin `escapeHtml()`. La fuente es data admin-controlled (creada por `/api/admin/cards`); explotar requiere comprometer una cuenta admin. Por contraste, `admin/index.html` sí usa `esc(l.name)` para los mismos campos en la sección de shop-listings. **Aceptado MVP.** Mitigación: aplicar la función `esc()` ya existente en `admin/index.html` a esos sinks en `shop/index.html`.

### `GET /api/shop/inventory` y `GET /api/shop/pending-wgt`

- **Auth:** sesión HMAC → 401 si inválida.
- **Queries parametrizadas:** `WHERE user_id = ?` en ambos; JOIN con `card_definitions` en inventory filtra ítems inactivos y cantidad cero.
- **Datos devueltos:** inventory expone solo `id`, `name`, `description`, `quantity`. pending-wgt expone solo `wins` y `year_month`. Sin columnas internas.
- **Sin rate limit** — mismo riesgo aceptado que el resto de endpoints.

## Contratos on-chain (`contracts/src/`)

### ItemShop.sol

- ✅ Control de acceso: OpenZeppelin `AccessControl` con `ITEM_MANAGER_ROLE`.
- ✅ WGT quemado al comprar (`burnFrom`) — sin posibilidad de refund ni doble-gasto.
- **[BAJO] Sin `ReentrancyGuard`:** `burnFrom()` es una llamada externa que ocurre antes de la emisión del evento (violación del patrón CEI). Riesgo bajo en práctica: el contrato WGT es propio y de confianza; no hay actor externo en el flujo. Aceptado MVP. Mitigación: heredar `ReentrancyGuard` y marcar `purchaseItem` como `nonReentrant`.
- **[BAJO] `updateItem` sin validación de precio/cantidad:** acepta `price=0` o `quantity=type(uint256).max`. Riesgo admin-only (solo `ITEM_MANAGER_ROLE` puede llamarlo). Aceptado MVP. Mitigación: `require(price > 0)`.
- **[INFO] Sin eventos en `updateItem` / `setItemActive`:** las actualizaciones de items no emiten eventos, lo que dificulta la auditoría on-chain off-chain. No es una vulnerabilidad de seguridad.

### WGTToken.sol

- ✅ OpenZeppelin ERC20 + ERC20Burnable; mint gateado por `MINTER_ROLE`.
- **[BAJO] Sin cap de supply:** `MINTER_ROLE` puede mintear ilimitadamente. En práctica el único minter es el worker `claim-wgt.js`, gateado por auth + `claimed_at` + solo meses cerrados. Riesgo real: si la cuenta del worker fuera comprometida, habría inflación ilimitada. Aceptado MVP. Mitigación futura: `ERC20Capped`.

## Backend — Cards, Battle Pass & Admin (`functions/api/cards/`, `functions/api/battle-pass/`, `functions/api/admin/`)

### Mecanismos de seguridad confirmados

- **Auth:** todos los endpoints requieren `war_session` HMAC válida (`getSession()` → 401 si falta o manipulada). Los endpoints admin además verifican que el email de la sesión esté en la variable de entorno `ADMIN_EMAILS` (403 si no).
- **Ownership en use/delete de cartas:** las queries usan `WHERE id = ? AND user_id = ?`; si la carta no existe o pertenece a otro usuario, devuelven 404 sin exponer información de la otra cuenta. **Desde 2026-06-22:** el `DELETE FROM user_cards` también incluye `AND user_id=?` (antes solo el SELECT previo verificaba ownership; ahora la eliminación misma es atómica con la verificación de pertenencia).
- **Mutaciones en métodos correctos:** `POST` para use/claim, `DELETE` para delete/remove, `PUT` para update admin, `GET` para lecturas. Sin mutaciones por GET.
- **Queries parametrizadas:** todas usan `.prepare(...).bind(...)`. El `INSERT … ON CONFLICT` de claim y los `SELECT … WHERE user_id = ?` de inventario nunca interpolan valores del usuario.
- **Datos devueltos al cliente:** cards API expone solo `id`, `name`, `description`, `effect_type`, `effect_value`. No se filtran columnas internas (`user_id`, `used_at`, `created_at`). Admin endpoints exponen `is_active` adicionalmente — solo accesible por admins.
- **XSS:** todo dato de carta renderizado en el DOM pasa por `esc()` en `admin/index.html` y `battle-pass/index.html`, y por `escapeHtml()` en `js/ui.js:renderItemsPanel()`. Sin sinks de `innerHTML` con datos de DB sin escapar.
- **Schema D1 (`migrations/0002_items.sql`):** índices en `user_id`; `UNIQUE(month, day)` en `battle_pass_rewards` evita asignaciones duplicadas de recompensa; `used_at` nullable como estado de carta (NULL = disponible, timestamp = usada).

### Hallazgos

- **RESUELTO (2026-06-22) — [MEDIO] Race condition en `POST /api/battle-pass/claim`:** la UPDATE ahora es atómica: `WHERE user_id=? AND (last_claim_date IS NULL OR last_claim_date != ?)` + check `meta.changes === 0` → devuelve `already_claimed: true` sin crear cartas duplicadas. El doble-claim simultáneo ya no es posible con D1.
- **[BAJO] Admin card `PUT` sin validación de campos vacíos:** el endpoint `POST /api/admin/cards` valida `!name?.trim()` y `!description?.trim()` y devuelve 400, pero el `PUT` no replica esas validaciones. Un admin puede actualizar una carta dejando el nombre o la descripción vacíos. No es un vector de ataque externo; riesgo de inconsistencia de datos.
- **[BAJO] Parámetro `month` sin rango en admin battle-pass:** `parseInt(searchParams.get('month'))` acepta cualquier entero (0, -1, 13, 9999). La query es parametrizada (sin inyección SQL), pero meses fuera de [1-12] devuelven resultados vacíos sin error claro al cliente. Riesgo de lógica, no de seguridad.
- **RESUELTO (2026-06-22) — [INFO] Fire-and-forget en uso de cartas:** `_useCard` ahora es `async` y verifica el status de respuesta; `WHERE used_at IS NULL` + `meta.changes === 0` → 409 previene el doble-uso concurrente. La desincronización de UI por error de red sigue siendo posible (la carta se marca usada localmente de todas formas), pero ya no hay riesgo de que el servidor procese dos usos del mismo id.

## Frontend — `js/main.js` y `js/ui.js`

- **XSS (output encoding):** el `name` que vuelve de la DB pasa por `escapeHtml()` antes
  de inyectarse con `innerHTML` en el render del leaderboard (`main.js`). La defensa está
  en la **salida**: el `name` se almacena crudo (solo `trim`/truncado a 16), así que
  cualquier renderizado nuevo de datos de DB **debe** escaparse igual.
- `wins` se renderiza sin escapar pero es numérico (columna `INTEGER` de D1).
- **Banner de turno (`ui.js`):** `updateBanner()` inyecta el nombre del jugador (input de
  la pantalla de inicio, `maxLength=16`) y su inicial con `innerHTML`; ambos pasan por una
  copia local de `escapeHtml`. Sink nuevo, **correctamente escapado**.
- **Pantalla de fin ganó/perdió (`main.js`, `onGameOver`, 2026-06-19):** además del nombre
  del ganador, renderiza con `innerHTML` una **clasificación con todos los nombres de
  jugadores** (que en online llegan por WebSocket). Todos pasan por `escapeHtml`
  (`escapeHtml(winner.name)`, `escapeHtml(p.name)`); el color sale de `PLAYER_COLORS`
  (constante) y la ronda es numérica → **sin XSS**. Amplía la lista de sinks del nombre
  remoto, todos cubiertos por el escape de salida.
- **`showEnemyCardNotification` (`js/ui.js:730`, desde 2026-06-22):** nuevo sink que recibe `playerName` desde el payload WebSocket y lo renderiza con `escapeHtml(playerName)`; `card.name` y `card.description` usan `textContent`. Sin XSS. Registrado como sink nuevo cubierto.
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
| `multiplayer.js` | `encodeURIComponent` en parámetros URL del WebSocket (incluye `playerName` desde esta sesión). JSON parse con `try/catch`; mensajes con JSON inválido descartados. Si el socket se cierra sin abrir (`409` por sala ya iniciada), `onJoinFailed` avisa al usuario en vez de fallar en silencio. |
| `worker/index.js` (`GameRoom`, routing en `functions/api/game-room.js`) | Solo acepta conexiones con cabecera `Upgrade: websocket` (426 si falta) y rechaza nuevas conexiones con `409` si la sala ya inició (`started`). Parse JSON con `try/catch` en `webSocketMessage`. **Sin autorización de host:** cualquier conectado puede enviar `set_ready`/`start_game`; el servidor no valida quién es el host ni el contenido de `payload.players` — ver hallazgo abajo. |
| `js/wallet.js` | MetaMask requiere aprobación explícita del usuario antes de cualquier transacción o firma. Sin contratos desplegados en producción, no hay riesgo on-chain real. Desde esta sesión `signMessage()` también se usa para **auth real** (`/api/auth/wallet`, `/api/wallet/link`) — ver hallazgos en la sección de wallet arriba. |

## Riesgos aceptados / vectores conocidos

No son vulnerabilidades confirmadas, pero se registran:

- **Inflado de `wins`:** cualquier usuario autenticado puede llamar `POST /api/win`
  repetidas veces (devtools/curl) y sumar victorias sin haber jugado — no hay token de
  partida, rate-limit, ni verificación server-side de que hubo un `gameover` real.
  **Aceptado por diseño** (juego casual), pero ahora el contador inflado es visible en
  `/api/gamers` bajo una **cuenta real registrada**, no un nombre anónimo como con el
  leaderboard legacy. Mitigaciones posibles si llegara a importar: Cloudflare Turnstile,
  rate-limit en la Function, o un token de partida emitido al crear la sala y verificado
  al reportar la victoria.
- **RESUELTO (2026-06-22) — Race condition en `POST /api/battle-pass/claim`:** UPDATE ahora atómica con `WHERE (last_claim_date IS NULL OR last_claim_date != ?) + meta.changes === 0`. Ver sección Hallazgos.
- **Sin rate-limiting** en los endpoints de escritura en general (abuso/spam de escrituras). Los endpoints de shop (`/api/shop/inventory`, `/api/shop/pending-wgt`, `/api/claim-wgt`) extienden este riesgo.
- **Spoofing de identidad en WebSocket (`worker/index.js`):** `playerId` se toma del
  parámetro URL sin verificar contra la cookie `war_session`. Cualquier cliente puede
  conectarse declarando el `playerId` de otro jugador y enviar acciones como si fuera él.
  Aceptado para MVP (partidas efímeras de bajo valor). Mitigación futura: leer `war_session`
  en el DO y rechazar si `sub` no coincide con `playerId`.
- **Reconexión a sala iniciada autorizada solo por `playerId` adivinable (`worker/index.js`,
  desde 2026-06-19) — extensión del spoofing anterior:** una sala con `started` acepta el
  reingreso de cualquier socket cuyo `playerId` esté en `playerIds`, le envía el estado completo
  vía `state_sync` y difunde `player_rejoined`. Como el `playerId` no se valida contra
  `war_session` y suele ser la **dirección de wallet (pública)** o un id anónimo, quien lo conozca
  puede **reingresar a una partida en curso ocupando el asiento de la víctima** y **leer el board
  completo** (divulgación de estado), además de inyectar `game_state` como ese jugador. Impacto
  bajo (el board es visible para todos los jugadores de la sala de todos modos; partidas efímeras),
  pero amplía la superficie del spoofing de `playerId`. Aceptado para MVP. Misma mitigación: validar
  `playerId` contra `war_session` en el DO, o emitir un **token de partida por jugador** al
  iniciar y exigirlo en el reingreso.
- **Persistencia de payload sin validar (`worker/index.js`, `webSocketMessage`):**
  `data.payload` se escribe en DO storage directamente. Un cliente malicioso puede
  corromper el estado compartido de la sala, **e incluso forzar `resetRoom()`** enviando
  `game_state` con `payload.phase: 'gameover'` sin haber ganado realmente (borra storage
  y la lista de jugadores de la sala). Aceptado para MVP. Mitigación futura: validar
  `payload` contra schema mínimo (tipos y rangos de `board`, `currentIndex`, `phase`)
  antes de persistir o actuar sobre él.
- **`start_game` no restringido al host (`worker/index.js`):** el servidor acepta
  `{type:'start_game', payload:{players}}` de **cualquier** cliente conectado a la sala,
  no solo del host — marca `started=true` y retransmite el `payload.players` tal cual a
  todos. La regla "solo el host inicia cuando todos están listos" es **solo una
  afordancia de UI** (`isHost`/`allReady` en `renderLobby()`, `js/main.js`); quien hable
  el protocolo WS directamente puede forzar el inicio con una lista de jugadores
  arbitraria (nombres, orden, colores) que los demás clientes adoptan sin más validación
  para construir su `Game` local. Mismo patrón que los dos hallazgos anteriores —
  aceptado para MVP. Mitigación futura: que el DO derive `players` de su propio estado
  (`this.players`) en vez de confiar en el payload del cliente, y registre quién es el
  host (primer `playerId` aceptado) para autorizar `start_game`.
- **`playerName` sin límite de longitud/charset en el servidor:** el DO toma
  `url.searchParams.get('playerName') || 'Jugador'` sin `slice` ni validación; el único
  límite es el `maxlength="16"` del `<input>` del formulario, que no aplica a quien abra
  el WebSocket directamente. Hoy no es XSS — los dos sinks de nombre (`updateBanner()` en
  `ui.js` y el modal de victoria en `main.js`) ya pasan por `escapeHtml` — pero depende
  enteramente del escape de salida en vez de validar en la entrada, y permite nombres
  arbitrariamente largos en el broadcast/storage del DO. Riesgo bajo, registrado.
  Mitigación futura: aplicar `String(playerName).trim().slice(0, 16)` en
  `worker/index.js` antes de guardarlo en `players`, igual que ya se hace con `name` en
  el leaderboard legacy.
- **[BAJO] `shield` sincronizado por WebSocket sin validación (`js/main.js`, desde 2026-06-22):** `msg.payload.shield` se asigna directamente a `game._shield` sin validar tipo ni rango. Un peer malicioso en la misma sala puede otorgar o revocar el escudo de cualquier jugador enviando `{type:'game_state', payload:{shield: <playerId>|null}}`. Extiende el riesgo ya aceptado de `game_state` sin schema. Mismo nivel de disposición: aceptado para MVP. Mitigación futura: validar `shield` contra la lista de `playerIds` en el DO antes de persistir/broadcast.
- **[INFO] `card_used` transmitido por cliente, no servidor (`js/main.js` + `js/ui.js`, desde 2026-06-22):** cuando un jugador usa una carta, el cliente emite `sendAction('card_used', {playerName, card})` y el servidor lo hace broadcast tal cual. El receptor muestra la notificación con `textContent`/`escapeHtml(playerName)` — sin XSS. Pero la validez del evento no está verificada: un peer puede emitir `card_used` con carta inventada o nombre falso. Impacto: engaño cosmético (notificación falsa), sin efecto en el estado del juego ni en la DB. Aceptado para MVP.
- **`Object.assign` sin schema (`main.js`):** `Object.assign(game.board, msg.payload.board ?? {})`
  acepta cualquier objeto del WebSocket. Permite sobrescribir campos internos del board
  desde la red. Aceptado para MVP. Mitigación futura: validar claves y tipos del payload
  antes de asignar, o reconstruir el objeto en vez de mutar el existente.
- **Win forzado a otro jugador vía `game_state` sincronizado (`main.js`, desde 2026-06-19)
  — extensión del `game_state` sin validación:** desde esta sesión el estado sincronizado
  incluye `winner` (índice del ganador) y `alive[]`. `onGameOver` se dispara cuando
  `phase === 'gameover'` (campo ya sincronizado) y hace `POST /api/win` si
  `rankedOnline && winner.id === myIndex`. Un peer malicioso en una partida online puede
  difundir `{type:'game_state', payload:{phase:'gameover', winner:<índice de la víctima>}}`
  y forzar que **el cliente de la víctima reporte una victoria** (inflado dirigido a la
  cuenta de otro), además del `resetRoom()` que ese mismo `gameover` ya provocaba. Misma
  raíz y disposición que "`game_state` sin validación server-side" y
  "`payload.phase:'gameover'` dispara `resetRoom()`" — aceptado para MVP; misma mitigación
  (validar el payload contra schema y/o que el DO derive el resultado de su propio estado).
  El sync de `winner` además **corrige un fallo latente**: antes un `gameover` real en un
  cliente no-actor llamaba `onGameOver(null)` (winner no viajaba) y podía romper el render.
- **Sin `Content-Security-Policy`:** los scripts inline existentes en los HTML y la carga
  de esm.sh no están explícitamente allowlisteados. Sin CSP cualquier script inyectado
  en el DOM (requiere otro vector previo) se ejecutaría sin restricción. Aceptado por
  complejidad de configurar CSP con `unsafe-inline` y CDN externo. Mitigación futura:
  añadir CSP permisiva pero explícita a `_headers`.
- **RESUELTO (2026-06-21) — Cookie `war_session` sin firma (HMAC):** firmada con HMAC-SHA256 en `functions/_lib/session.js`. Cookies forjadas devuelven `null`; los riesgos derivados (escrituras en D1 con `sub` ajeno, lectura de perfiles, backdoor de `wallet/link`) quedan cerrados. Ver Historial.
- **RESUELTO (2026-06-21) — Validación de email débil en `/api/register`:** reemplazado `email.includes("@")` por regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
- **Sin rate-limiting en `/api/register`:** la constraint `UNIQUE(sub)` limita a una
  fila por `sub`, pero no limita el volumen de intentos. Mitigación futura: Cloudflare
  Rate Limiting o verificación Turnstile en el formulario.
- **RESUELTO (2026-06-21) — Sin parámetro `state` en OAuth (Login CSRF):** `auth/google.js` genera `state` aleatorio en cookie temporal; `auth/callback.js` lo verifica y rechaza con `invalid_state` si no coincide.
- **`tokenData.error` sin `encodeURIComponent` en redirect:** en `callback.js`,
  `${url.origin}/login?error=${tokenData.error}` no escapa el valor de `error` de Google.
  Si contiene `&` o `=` podría contaminar el query string del redirect. No es XSS ni SQL
  (no se renderiza en DOM), pero es un defecto menor de encoding. Riesgo muy bajo.
- **Resuelto — XSS por nombre de jugador en el modal de victoria (`main.js`, `onGameOver`):** `escapeHtml` confirmado en `js/main.js:209`; todos los sinks de nombre remoto (lobby online, clasificación final) también escapados.

- **2026-06-22 (shop listings)** — Tienda de cartas: `functions/api/admin/shop-listings.js`, `functions/api/shop/listings.js`, `migrations/0004_shop_listings.sql`, `migrations/0005_shop_price.sql`, `admin/index.html` (sección shop-listings), `shop/index.html`, `lobby/index.html`. **Positivos:** auth guard correcto en admin (antes de cualquier DB); queries parametrizadas; `wgt_price` normalizado con `Math.max(0, Number(...))` — precios negativos imposibles; `card_def_id` validado en POST/DELETE; `esc(l.name)` en admin.html; endpoint público solo lee, sin input de usuario, expone campos seguros; `card_def_id` en onclick es entero de DB. **Hallazgo aceptado MVP:** [BAJO] `shop/index.html` inyecta `item.name` e `item.description` en `innerHTML` sin escapar — XSS stored vía admin que requiere cuenta admin comprometida. Sin cambios en `_headers` ni en `wrangler.toml`.
- **2026-06-22 (on-chain)** — Capa on-chain: `functions/api/claim-wgt.js`, `functions/api/deliver-item.js`, `functions/api/shop/inventory.js`, `functions/api/shop/pending-wgt.js`, `contracts/src/ItemShop.sol`, `contracts/src/WGTToken.sol`, `js/wallet.js`, `migrations/0003_onchain.sql`. **Positivos:** replay protection en `claim-wgt` (firma ECDSA con timestamp de 5 min — mejora sobre `auth/wallet.js`); proof-of-purchase en `deliver-item` (verificación de receipt + evento on-chain); anti-doble-mint via `claimed_at` pre-TX; wallet ownership por `verifyMessage`; queries D1 parametrizadas en todos los endpoints nuevos; anti-replay de `txHash` via `delivered_txs`. **Hallazgos aceptados MVP:** (H1) [BAJO] `ItemShop.sol` sin `ReentrancyGuard` — `burnFrom()` externo antes de evento, riesgo bajo porque WGT es contrato propio; (H2) [BAJO] `WGTToken` sin cap de supply — minter único es el worker, gateado por auth + `claimed_at`; (H3) [INFO] `updateItem`/`setItemActive` sin eventos — auditoría on-chain limitada; (H4) [INFO] sin rate limit en endpoints shop. Sin cambios en `_headers` ni en `wrangler.toml`.
- **2026-06-22** — Notificaciones de cartas + hardening de race conditions: `functions/api/cards/delete.js`, `functions/api/cards/use.js`, `functions/api/battle-pass/claim.js`, `js/game.js`, `js/main.js`, `js/ui.js`, `tests/`. **Resueltos:** (R1) TOCTOU en `DELETE user_cards` — query ahora incluye `AND user_id=?`; (R2) race condition de doble-claim en `/api/battle-pass/claim` — UPDATE atómica con `last_claim_date != ?` + `meta.changes === 0`; (R3) doble-uso concurrente de carta — `WHERE used_at IS NULL` + 409. **Nuevos hallazgos aceptados MVP:** (N1) [BAJO] `shield` sincronizado sin validación de tipo/rango en WebSocket — extiende el riesgo ya aceptado de `game_state` sin schema; (N2) [INFO] `card_used` broadcast no autenticado — impacto cosmético, sin efecto en DB. **Positivos:** `escapeHtml` en `showEnemyCardNotification` (nuevo sink cubierto); sanitización de `effectValue` con `Math.max/floor`; `_cardsPromise` elimina race de carga del inventario; `_useCard` migrado de fire-and-forget a async con manejo de errores. Sin cambios en `_headers` ni `wrangler.toml`.
- **2026-06-18** — Rediseño de fase de turno + dados + refuerzos: `js/game.js`, `js/ui.js`, `css/style.css`, `game/index.html`. **Hallazgo: ninguno** (`showDice` inyecta solo enteros de `Math.random()`, lógica 100% client-side).

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
- [ ] (Si toca WebSocket) La reconexión a una sala iniciada autoriza por algo más que un `playerId` adivinable (token de partida / `war_session`), y `state_sync` no expone estado a quien no es jugador legítimo.
- [ ] (Si toca WebSocket) El payload del mensaje se valida contra schema antes de persistir.
- [ ] (Si toca WebSocket) `start_game`/`set_ready` (o cualquier acción de control de sala) están restringidos al host en el servidor, no solo en la UI.
- [ ] (Si toca estado de juego en red) Los datos asignados al board tienen schema y tipo verificado.
- [ ] (Si toca wallet) El mensaje firmado incluye nonce/expiración y el dominio de la app.
- [ ] (Si toca wallet) Vincular una wallet no depende únicamente de un campo de la cookie sin verificar.
- [ ] (Si toca on-chain) Las funciones del contrato que hacen llamadas externas usan `ReentrancyGuard` (`nonReentrant`).
- [ ] (Si toca on-chain) Todas las mutaciones de estado del contrato emiten eventos.
- [ ] (Si toca on-chain) Los contratos que mienten tokens tienen un cap de supply o lo justifican explícitamente.

## WebSocket y wallet — mecanismos actualizados

La tabla de la sección anterior refleja el estado al momento del despliegue. Actualizaciones relevantes de esta sesión:

- `worker/index.js` — `started` ahora persiste en DO storage (`state.storage.put('started', true)`), no en memoria. Cierra el bypass por hibernación documentado abajo.
- `worker/index.js` — estado de jugadores migrado de `this.players` Map (in-memory, no sobrevivía hibernación) a WebSocket attachments (`serializeAttachment` / `deserializeAttachment`). El DO ya puede hibernar sin perder el roster.
- `worker/index.js` (reconexión, 2026-06-19) — el `409` de "sala iniciada" ya **no es
  incondicional**: ahora `fetch` acepta el **reingreso** de un socket cuyo `playerId` esté en la
  lista persistida `playerIds` (devuelve `101` + `state_sync` con el estado guardado, difunde
  `player_rejoined`); solo un `playerId` desconocido recibe `409`. La autorización del reingreso
  depende **solo del `playerId` del query**, sin verificarlo contra `war_session` → ver el hallazgo
  de reconexión en *Riesgos aceptados*.
- `worker/index.js` (hardening, 2026-06-19) — `webSocketMessage`, `webSocketClose` y `alarm` corren
  en `try/catch` y se agrega `webSocketError`: un mensaje mal formado o un error en un handler ya
  **no propaga ni tumba el DO** (antes podía desconectar a toda la sala). Mitigación parcial de DoS.
- `worker/index.js` (auto-pong, 2026-06-19) — el constructor registra
  `setWebSocketAutoResponse('ping' → 'pong')`: el runtime contesta el heartbeat **sin despertar al
  DO**, reduciendo invocaciones (leve positivo de costo/DoS). El heartbeat del cliente
  (`js/multiplayer.js`) es un string fijo sin datos de usuario → sin inyección.

## Historial de revisiones

- **2026-06-21** — Sistema de cartas, battle pass y panel admin: `functions/api/cards/`, `functions/api/battle-pass/`, `functions/api/admin/`, `migrations/0002_items.sql`, `admin/index.html`, `battle-pass/index.html`, `js/ui.js`, `js/game.js`. **Hallazgos:** (1) [MEDIO] race condition en `POST /api/battle-pass/claim` — doble claim simultáneo posible, aceptado MVP; (2) [BAJO] admin card PUT sin validación de campos vacíos; (3) [BAJO] `month` sin rango [1-12] en admin battle-pass. **Positivos:** todos los endpoints autenticados con HMAC; ownership verificado con `WHERE id = ? AND user_id = ?`; admin gateado por `ADMIN_EMAILS`; XSS cubierto con `esc()` / `escapeHtml()` en todos los sinks nuevos; queries D1 parametrizadas. Sin cambios en `_headers` ni `wrangler.toml`.
- **2026-06-21** — **Endurecimiento de sesión y auth (correcciones, no solo registro).**
  Cambios revisados y aplicados:
  - **RESUELTO — Cookie `war_session` sin HMAC:** nuevo módulo `functions/_lib/session.js`
    (`createSessionCookie` / `getSession`) que firma el payload con **HMAC-SHA256**
    (`crypto.subtle`, secret `SESSION_SECRET`) y verifica con **comparación en tiempo
    constante**. Formato: `base64(payload).base64url(firma)`. Migrados todos los
    consumidores (`profile.js`, `win.js`, `register.js`, `wallet/link.js`) y emisores
    (`auth/callback.js`, `auth/wallet.js`). Una cookie forjada o manipulada ahora devuelve
    `null` → **caen en cascada** los riesgos escalados: forja de `sub` para escribir en D1
    (`/api/win`, `/api/register`), lectura de perfiles ajenos (`/api/profile`) y la
    **puerta trasera por `/api/wallet/link`**. La cookie además ahora lleva `Secure`.
    **Requisito de despliegue:** `wrangler pages secret put SESSION_SECRET` (en dev va en
    `.dev.vars`, gitignored). Sin el secret, `getSession` devuelve `null` y
    `createSessionCookie` lanza → login inoperante por diseño. Las sesiones legacy (sin
    firma) quedan invalidadas: los usuarios deben reloguear (aceptable).
  - **RESUELTO — Login CSRF (sin `state` en OAuth):** `auth/google.js` genera un `state`
    aleatorio (`crypto.randomUUID`) y lo guarda en cookie temporal `oauth_state`
    (`HttpOnly; Secure; SameSite=Lax; Max-Age=600`); `auth/callback.js` lo verifica contra
    el query y rechaza con `invalid_state` si falta o no coincide, limpiando la cookie tras
    el login.
  - **RESUELTO — `encodeURIComponent` en redirects de error de auth:** `oauthError` y
    `tokenData.error` ahora se escapan en `callback.js`.
  - **Mitigado — `playerName` sin límite server-side (`worker/index.js`):** ahora
    `String(playerName).trim().slice(0,16)` antes de guardarlo en el attachment del socket.
  - **Mitigado — email débil en `/api/register`:** `includes("@")` reemplazado por regex
    básica `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
  - **Pendiente (no tocado, riesgo de romper online sin test):** binding de `playerId`
    contra `war_session` en el DO. El `playerId` suele ser la wallet pública o un id
    anónimo (≠ `sub`) y el cliente referencia jugadores por ese id, así que el fix requiere
    cambio coordinado cliente+servidor y prueba del flujo multijugador. Sigue como riesgo
    aceptado para MVP (spoofing de `playerId`, robo de asiento en reconexión, win forzado).
  Sin cambios en `_headers` ni en el esquema D1.
- **2026-06-14** — Línea base inicial. Cambio revisado: `database_id` real en
  `wrangler.toml` + enlace a la demo en `README.md`. **Hallazgo: ninguno** (no introduce
  superficie nueva; se confirma que `database_id` no es secreto).
- **2026-06-14** — Rediseño visual del mapa y del banner (`ui.js`, `css`, fuentes). `updateBanner()` escapa el nombre de jugador. **Hallazgo:** `winner.name` sin escapar en modal de victoria — self-XSS hotseat registrado; resuelto.
- **2026-06-15** — Google OAuth login: `login.html`, `functions/api/auth/google.js`, `auth/callback.js`. **Hallazgos (todos resueltos 2026-06-21):** (1) cookie sin HMAC; (2) sin `state` → Login CSRF; (3) `tokenData.error` sin `encodeURIComponent`.
- **2026-06-15** — Landing page y redirect raíz: `home/index.html`, `_redirects`. **Hallazgo: ninguno** (HTML estático, sin input ni backend).
- **2026-06-15** — Multiplayer (WebSocket + DO), wallet Web3, Pixi.js: `functions/game-room.js`, `js/multiplayer.js`, `js/wallet.js`. **Hallazgos aceptados MVP:** (C1) spoofing de `playerId`; (C2) payload WS sin validar en DO storage; (C3) `Object.assign` sobre board sin schema; (M3) sin CSP.
- **2026-06-15** — Mapa con geometría real: `js/map-shapes.js` (paths pregenerados), `scripts/build-map-shapes.mjs`. **Hallazgo: ninguno en runtime** (datos estáticos; `d3-geo`/`topojson-client` son devDependencies de build, no se despliegan).
- **2026-06-15** — Registro de usuarios: `functions/api/gamers.js`, `profile.js`, `register.js`, `migrations/0001_users.sql`. **Hallazgos:** (1) cookie sin HMAC escala a escrituras D1 — resuelto 2026-06-21; (2) email débil (`includes("@")`) — resuelto 2026-06-21; (3) sin rate-limiting en `/api/register` — aceptado. Queries parametrizadas; `username` restringido a `[a-zA-Z0-9_]`.
- **2026-06-16** — Reglas de partida: `js/map-data.js` (44 territorios, 1-3 jugadores), `js/game.js`, `game/index.html`. **Hallazgo: ninguno** (lógica/datos puros, sin DOM ni red).
- **2026-06-16** — Login y vinculación de wallet: `functions/api/auth/wallet.js`, `wallet/link.js`, `signMessage()`, `wallet_address` en schema. **Hallazgos aceptados MVP:** (1) firma sin nonce/expiración (replay indefinido); (2) mensaje sin binding de dominio (phishable); (3) escalada cookie sin HMAC → puerta trasera persistente vía `wallet/link` — riesgo HMAC resuelto 2026-06-21.
- **2026-06-17** — Corrección export `functions/api/game-room.js` (Worker → Pages Functions); eliminación de `loadLeaderboard()` en `main.js`. **Hallazgo: ninguno.**
- **2026-06-16** — Página `/lobby` (hub de navegación): `lobby/index.html` + enlaces en páginas existentes. **Hallazgo: ninguno** (patrón auditado: `textContent` para username, anchors estáticos).
- **2026-06-17** — Primera ronda sin ataques + sync de estado inicial online: `js/game.js` (`attackUnlocked`), `js/main.js`, `js/multiplayer.js`. **Sin hallazgos nuevos:** los riesgos WS ya aceptados (start_game no restringido al host, `game_state` sin validación, `Object.assign` sin schema) se extienden a `board`/`setupRemaining`/`attackUnlocked`.
- **2026-06-18** — Mejoras de lobby: `worker/index.js` (cap 6 jugadores → 403, auto-ready), `js/multiplayer.js` (callback `onClose`), `js/main.js`, `game/index.html`. **Hallazgo: ninguno nuevo** (cap de jugadores mejora menor de seguridad).
- **2026-06-17** — Rediseño del combate (elegir unidades, ocupación automática): `js/game.js` (`attack(from,to,attackUnits)`, `maxAttackUnits()`), `js/ui.js`, `js/main.js`. **Sin hallazgos nuevos:** `attackUnits` acotado a `[1, armies-1]`; modal interpola solo constantes y números. El riesgo ya aceptado de `game_state` sin validación se extiende al board resultante del ataque.
- **2026-06-18** — Matchmaking público + DO hibernation-safe: `functions/api/game-room.js` (`?match=1`), `worker/index.js` (alarma, WebSocket attachments, `started` en storage persistente), `js/main.js`, `js/multiplayer.js` (`requestMatch`). **Corrección:** `started` en DO storage — cierra el bypass de hibernación. **Hallazgos aceptados MVP:** (1) inflado de contador de sala vía `?match=1` sin auth; (2) `you_start` extiende el riesgo de `start_game` no restringido al host.

- **2026-06-16** — Lobby de sala (ready/start) y registro de victorias: `functions/api/win.js`, `worker/index.js` (`set_ready`/`start_game`/`lobby_update`, `resetRoom()`), `js/multiplayer.js`, `js/main.js`, `js/ui.js`. **Hallazgos aceptados MVP:** (1) `/api/win` sin verificación de victoria real; (2) `start_game` no restringido al host; (3) `payload.phase:'gameover'` dispara `resetRoom()` sin victoria real; (4) `playerName` sin límite server-side — resuelto 2026-06-21.
- **2026-06-19** — Reconexión automática: `worker/index.js` (reingreso por `playerId`, `state_sync`, alarma de gracia 45 s, auto-pong, `try/catch` en handlers), `js/multiplayer.js` (heartbeat + backoff), `js/main.js`. **Hallazgo aceptado MVP:** reingreso autorizado solo por `playerId` sin verificar `war_session` — permite tomar el asiento de otro jugador. **Positivo:** `try/catch` en todos los handlers (resistencia parcial a DoS); auto-pong sin despertar el DO.
- **2026-06-19** — Refuerzo lógica de victorias: `js/game.js` (`round`, `canSurrender()`, `_checkWin()`), `js/main.js` (flag `rankedOnline`, sync `round`/`winner`/`alive`, pantalla de fin), `js/ui.js`, `css/style.css`. **Hallazgos aceptados MVP:** (1) win forzado a otro jugador — peer envía `game_state {phase:'gameover', winner:<índice>}` → fuerza `POST /api/win` de la víctima; (2) `rankedOnline` es gating UX, no control de seguridad. Pantalla de fin escapa todos los sinks de nombre con `escapeHtml`.
- **2026-06-19** — Flujo de ataque de dos clics y flechas SVG: `js/ui.js` (`pendingTarget`, `arrowsLayer`, flujo de dos pasos, botón Rendirse), `css/style.css`. **Sin hallazgos nuevos:** `arrowsLayer` usa solo coordenadas constantes; `reinforcements` añadido al payload extiende el riesgo ya aceptado de `Object.assign` sin schema.
- **2026-06-22** — `currentMonth` en `/api/shop/pending-wgt` y rediseño lobby: `functions/api/shop/pending-wgt.js`, `shop/index.html`, `lobby/index.html`, `tests/api/shop/pending-wgt.test.js`. **Positivos:** nueva query D1 parametrizada (`.bind()`); `currentMonth` es campo informativo — el enforcement de claim sigue server-side con `claimed_at IS NULL AND year_month < mes_actual`; `profile.username` en lobby usa `textContent`; renders de fecha en shop usan `textContent`. **Hallazgo [BAJO] — XSS via `innerHTML` en `renderInventory()` (lobby):** `g.name` y `g.desc` (datos de `/api/cards/inventory`) se interpolan en `innerHTML` sin `escapeHtml`. El mismo patrón existe en `shop/index.html#loadItems()` (pre-existente, no auditado hasta ahora). Vector admin→usuario; requiere que un admin cree carta con payload HTML. Sugerencia: reemplazar `innerHTML` con construcción DOM o pasar por `escapeHtml`. **Nota:** respuesta de endpoint inconsistente (unauthenticated devuelve `{total:0}`, autenticado devuelve `{total, currentMonth}`); no es riesgo, el cliente lo maneja. Sin cambios en `_headers`, `wrangler.toml`, ni esquema D1.
