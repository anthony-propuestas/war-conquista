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

La sesión se guarda en una cookie `war_session` (`HttpOnly; SameSite=Lax`).
No hay uploads/archivos. La wallet Web3 (`wallet.js`) es experimental (sin contratos
desplegados en producción).

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
- **Sin rate-limiting** en los endpoints de escritura en general (abuso/spam de escrituras).
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
- **RESUELTO (2026-06-21) — Cookie `war_session` sin firma (HMAC):** ahora se firma con
  HMAC-SHA256 vía `functions/_lib/session.js` (ver Historial). Las cookies forjadas se
  rechazan; los riesgos derivados (escrituras en D1 con `sub` ajeno, lectura de perfiles,
  backdoor de `wallet/link`) quedan cerrados. Texto histórico debajo:
  ~~el valor es JSON base64 sin verificación criptográfica.~~ Con la adición de `/api/profile`, `/api/register` y,
  desde esta sesión, **`/api/win`**, la cookie ya no es solo cosmética: ahora **controla
  escrituras en D1**. Un atacante que
  forje una cookie con un `sub` arbitrario puede (1) registrar cuentas con identidades
  inventadas y (2) leer el perfil de cualquier `sub` conocido. Escenario: forja
  `war_session = btoa(JSON.stringify({ sub: "<sub_real_de_víctima>" }))` y llama a
  `GET /api/profile` o `POST /api/register`. En HTTPS requiere compromiso del cliente o
  MitM (poco probable en Cloudflare Pages), pero el impacto ha crecido de cosmético a
  escritura real en DB. Mitigación futura: HMAC del payload con un secret de Workers
  (`crypto.subtle.sign`). **Aceptado para MVP, prioridad elevada respecto a sesiones anteriores.**
- **RESUELTO (2026-06-21) — Validación de email débil en `/api/register`:** reemplazado
  `email.includes("@")` por regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` que rechaza `@`, `a@`,
  `@@@` y similares. Texto histórico: ~~el email se almacenaba sin validación de formato
  mínima — vector de datos basura sin riesgo de seguridad estricto~~.
- **Sin rate-limiting en `/api/register`:** la constraint `UNIQUE(sub)` limita a una
  fila por `sub`, pero no limita el volumen de intentos. Mitigación futura: Cloudflare
  Rate Limiting o verificación Turnstile en el formulario.
- **RESUELTO (2026-06-21) — Sin parámetro `state` en OAuth (Login CSRF):** `/api/auth/google`
  genera un `state` aleatorio en cookie `oauth_state` y `/api/auth/callback` lo verifica
  (rechaza con `invalid_state`). Texto histórico debajo:
  ~~`/api/auth/google` no genera un `state` ni `/api/auth/callback` lo verifica.~~ Permite **Login CSRF**: un atacante
  puede hacer que una víctima complete el flujo OAuth con la cuenta del atacante (la
  víctima queda logueada como el atacante). Impacto bajo en WAR (leaderboard de vanidad,
  sin datos personales expuestos). **Pendiente de corrección:** generar un `state`
  aleatorio en `/api/auth/google` (guardarlo en cookie temporal), verificarlo en el
  callback y rechazar si no coincide.
- **`tokenData.error` sin `encodeURIComponent` en redirect:** en `callback.js`,
  `${url.origin}/login?error=${tokenData.error}` no escapa el valor de `error` de Google.
  Si contiene `&` o `=` podría contaminar el query string del redirect. No es XSS ni SQL
  (no se renderiza en DOM), pero es un defecto menor de encoding. Riesgo muy bajo.
- **Resuelto — XSS por nombre de jugador en el modal de victoria (`main.js`,
  `onGameOver`):** este riesgo se documentó como pendiente desde 2026-06-14 y se repitió
  en varias entradas del historial. Verificado en esta sesión: el código actual ya usa
  `${escapeHtml(winner.name)}` (`js/main.js:209`) — el fix ya está aplicado, el doc nunca
  se actualizó. Relevante ahora porque el lobby online introduce nombres que llegan por
  WebSocket (no input local); confirmado que ese sink también queda cubierto por el mismo
  `escapeHtml`, así que **no hay XSS entre jugadores remotos** vía nombre de sala.
  `winner.color` se interpola sin escapar en el `style` del modal, pero viene de
  `PLAYER_COLORS` (array fijo del código, no input de usuario) — no explotable.

- **Firma de wallet sin nonce/expiración:** los mensajes firmados para login
  (`/api/auth/wallet`) y vinculación (`/api/wallet/link`) son texto estático sin
  desafío del servidor. Una firma capturada una vez es válida para siempre — no hay
  revocación ni expiración. Aceptado para MVP. Mitigación futura: nonce de un solo uso
  emitido por el servidor + expiración corta, estilo SIWE.
- **Firma de wallet sin binding de dominio:** el mensaje no incluye el origen de la
  app, por lo que un sitio de phishing puede solicitar la misma firma y reproducirla
  contra el backend real de WAR. Aceptado para MVP. Mitigación futura: incluir el
  dominio en el mensaje firmado y verificarlo en el backend.
- **Escalada del riesgo de cookie sin HMAC vía `/api/wallet/link`:** quien ya pueda
  forjar `war_session` con un `sub` arbitrario (riesgo ya documentado arriba) puede
  ahora vincular su propia wallet a la cuenta de la víctima firmando con su propia
  clave, y desde ahí entrar de forma persistente con `/api/auth/wallet` sin necesidad
  de seguir forjando cookies. Convierte un riesgo de lectura/escritura puntual en una
  **puerta trasera persistente**. Sube la prioridad de firmar `war_session` con HMAC.

- **2026-06-18** — Rediseño de fase de turno + dados + refuerzos: `js/game.js` (fases `reinforce`/`attack`/`fortify` unificadas en `play`; eliminados `endReinforce`/`endAttack`/`fortifyDone`; `reinforcementsFor` reemplazado por `floor(territorios/2)` sin bonus de continente), `js/ui.js` (`TURN_SECONDS` 30→90; `placingMode` toggle para colocar refuerzos; `handlePlayClick` unifica ataque y movimiento de tropas en un solo flujo; `showDice` rediseñado con pares verticales atk/def vía `innerHTML`; clave del timer simplificada a `currentIndex`; viewBox ampliado), `css/style.css` (`.dice-tray` de `absolute` a `fixed`; nueva barra `.action-guide`; ajuste de altura `.game-layout`), `game/index.html` (SVG viewBox 0 15 1000 460 → 0 0 1000 560; `#dice-tray` movido fuera de `.map-wrap`; nueva barra `#action-guide`). **Hallazgo: ninguno.** El nuevo `showDice` inyecta `atk[i]`/`def[i]` en `innerHTML` — son enteros 1-6 de `Math.random()` en `game.js`, nunca input de usuario ni dato de DB → sin XSS. La barra `#action-guide` es HTML estático sin datos de usuario. `placingMode` es estado UI interno, sin sinks nuevos. La unificación de fases es 100% client-side sin cambios en endpoints, queries D1, esquema, cookies, cabeceras ni secrets.

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
- **2026-06-15** — Registro de usuarios: `functions/api/auth/callback.js` (bifurca
  `/register` vs `/game` consultando D1), `functions/api/gamers.js`, `functions/api/profile.js`,
  `functions/api/register.js`, `migrations/0001_users.sql` (tabla `users`). **Hallazgos:**
  (1) **Cookie sin HMAC — impacto escalado:** la cookie ahora controla escrituras en D1
  (`POST /api/register`); un `sub` forjado puede crear registros en `users`. Antes era
  cosmético; ahora es una escritura real. Aceptado para MVP, prioridad elevada. (2) Email
  débil en `/api/register` (`includes("@")`) — vector de datos basura, sin riesgo de
  seguridad directo. (3) Sin rate-limiting en `/api/register`. Mecanismos positivos: todas
  las queries parametrizadas; `username` restringido a `[a-zA-Z0-9_]` (XSS imposible desde
  este campo en cualquier sink DOM); `getSession()` aísla excepciones de cookies malformadas.
  Sin cambios en cabeceras ni secrets.
- **2026-06-16** — Reglas de partida: `js/map-data.js` (mapa de 42 a 44 territorios,
  reasignación de continentes, `INITIAL_ARMIES`/`PLAYER_COLORS` de 2-6 a 1-3 jugadores),
  `js/game.js` (`_distributeTerritories` ahora asigna un continente completo por jugador en
  vez de territorios sueltos al azar) y `game/index.html` (opciones del `<select
  id="player-count">` actualizadas a 1/2/3). También color fijo `#888888` para territorios
  sin dueño en `ui.js` (antes derivado de `CONTINENTS[...].color`). **Hallazgo: ninguno.**
  Todo es lógica/datos puros sin DOM ni red (`map-data.js`, `game.js`), un `<select>` nativo
  sin nuevo vector de input (`index.html`), y un literal de color sin dato de usuario ni
  `innerHTML` involucrado (`ui.js`). Sin cambios en endpoints, queries, esquema, cabeceras
  ni secrets.
- **2026-06-16** — Login y vinculación de wallet: `functions/api/auth/wallet.js` (nuevo),
  `functions/api/wallet/link.js` (nuevo), `signMessage()` en `js/wallet.js`,
  `wallet_address` en `migrations/0001_users.sql`, UI en `login.html`/`my-profile/index.html`.
  Mecanismos correctos: queries parametrizadas, `try/catch` en `verifyMessage`, mismos
  atributos de cookie que el login con Google. **Hallazgos:** (1) el mensaje firmado no
  tiene nonce ni expiración → una firma capturada una vez es válida para siempre
  (replay indefinido); (2) el mensaje no incluye el dominio de la app → phishable (un
  sitio falso puede pedir la misma firma y reproducirla contra el backend real); (3)
  **escalada del riesgo de cookie sin HMAC:** quien ya forje `war_session` con un `sub`
  ajeno puede usar `/api/wallet/link` para vincular su propia wallet a la cuenta de la
  víctima y entrar después de forma persistente por `/api/auth/wallet`, sin seguir
  forjando cookies — convierte el riesgo ya conocido en una puerta trasera persistente.
  Los tres aceptados para MVP; suben la prioridad de firmar `war_session` con HMAC. Sin
  cambios en `_headers` ni secrets. El self-XSS de `winner.name` sigue pendiente (no
  tocado en esta sesión).
- **2026-06-17** — Corrección de export en `functions/api/game-room.js` (Worker format → Pages Functions `onRequest`) y eliminación de `loadLeaderboard()` al inicio de `js/main.js`. **Hallazgo: ninguno.** El cambio de export es una corrección de convención sin modificación de comportamiento; el routing al DO `GameRoom` es idéntico. La eliminación de `loadLeaderboard()` suprime un `GET /api/gamers` en el arranque; el sink de `escapeHtml` en esa función queda inactivo (código muerto, no un riesgo). Sin cambios en endpoints, queries, esquema, cabeceras ni secrets.
- **2026-06-16** — Página `/lobby` (hub de navegación): `lobby/index.html` (nuevo) +
  enlaces agregados/cambiados en `home/index.html`, `my-profile/index.html`,
  `gamers/index.html`, `game/index.html`. **Hallazgo: ninguno.** `lobby/index.html`
  repite el patrón ya auditado de `my-profile/index.html`: `fetch('/api/profile')`,
  redirect a `/login.html` si `401`/`404`, username renderizado con `textContent` (no
  `innerHTML`). Los enlaces nuevos son anchors estáticos (`href="/lobby"`, `/game`, etc.)
  sin interpolar datos de usuario ni de DB → sin XSS ni open redirect. Sin cambios en
  `functions/api/`, `schema.sql`, `_headers`, `wrangler.toml` ni secrets.
- **2026-06-17** — Primera ronda sin ataques + sincronización de estado inicial online:
  `js/game.js` (`attackUnlocked = false` en `initBoard()`; `canAttack()` lo exige;
  `endTurn()` lo activa tras `firstRoundTurnsLeft <= 0`; setup fijo a 5 ejércitos por
  jugador), `js/main.js` (`beginOnlineGame` aplica `initialBoard`, `initialSetup` e
  `initialAttackUnlocked` del host; handler de `game_state` propaga `setupRemaining` y
  `attackUnlocked`; broadcast incluye ambos campos), `js/ui.js` (🔒 literal en código
  cuando `!g.attackUnlocked`; sin datos de usuario en innerHTML), `js/multiplayer.js`
  (`startGame` acepta payload completo `{players, board, setupRemaining, attackUnlocked}`).
  **Hallazgo: ninguno nuevo.** Los riesgos WebSocket ya aceptados se extienden en alcance:
  (1) "start_game no restringido al host" ahora cubre `board`, `setupRemaining` y
  `attackUnlocked` en el payload inicial — un peer puede forzar tablero arbitrario o
  `attackUnlocked: true` desde el arranque; (2) "`game_state` sin validación server-side"
  ahora incluye `attackUnlocked` — cualquier peer puede emitir
  `{type:'game_state', payload:{attackUnlocked:true}}` durante la primera ronda y
  desbloquear sus propios ataques sin esperar; misma raíz que el spoofing de `phase`,
  `currentIndex`, etc. ya aceptados; (3) "`Object.assign` sin schema" aplica al estado
  inicial además del estado en-juego. Misma disposición: aceptados para MVP. Sin cambios
  en endpoints HTTP, queries D1, esquema, cookies, cabeceras ni secrets.
- **2026-06-18** — Mejoras de lobby: `worker/index.js` (cap de 6 jugadores → 403, jugadores
  auto-listos `ready: true` al unirse), `js/multiplayer.js` (callback `onClose` para
  desconexiones post-apertura), `js/main.js` (flag `inLobby` evita callback doble,
  limpieza de estado al desconectarse), `game/index.html` (checkbox "Estoy listo"
  eliminado), `js/map-data.js` (+3 colores de jugador). **Hallazgo: ninguno nuevo.**
  El cap de 6 jugadores es una mejora de seguridad menor (evita crecimiento ilimitado
  del `Map` `players`). `onClose` es solo gestión de estado cliente; no abre nueva
  superficie. Los colores son constantes UI. Sin cambios en endpoints HTTP, queries D1,
  esquema, cookies, cabeceras ni secrets.
- **2026-06-17** — Rediseño del combate (elegir unidades de ataque; ocupación
  automática al conquistar): `js/game.js` (`attack(from,to,attackUnits)` nuevo 3.º
  parámetro, `maxAttackUnits()`, se eliminan `pendingConquest`/`moveAfterConquest`;
  el defensor tira con todas sus tropas y los supervivientes ocupan la zona),
  `js/ui.js` (`openAttackModal`/`resolveAttack` reemplazan el modal de conquista),
  `js/main.js` (`moveAfterConquest` fuera de la lista de métodos parcheados online).
  **Hallazgo: ninguno nuevo.** Cambio 100% client-side: sin endpoints HTTP, queries
  D1, esquema, cabeceras ni secrets nuevos. `attackUnits` se **acota** en `attack` a
  `[1, armies-1]` (`Math.max(1, Math.min(attackUnits|0||maxAtk, maxAtk))`), así que un
  valor manipulado no permite atacar con más tropas de las disponibles ni dejar el
  origen en 0 (`armies - atkCount ≥ 1`, sin underflow). El modal solo interpola
  `TERRITORIES[*].name` (constantes de `map-data.js`) y números — sin datos de usuario
  ni de DB en `innerHTML`, sin XSS. La falta de validación server-side del `game_state`
  sincronizado (ya aceptada para MVP) ahora abarca también el board resultante del
  ataque; misma raíz y disposición que el spoofing de `phase`/`currentIndex` ya
  registrado.
- **2026-06-18** — Matchmaking público + DO hibernation-safe + dev script unificado:
  `functions/api/game-room.js` (`?match=1` ruta al DO `__matchmaker__`), `worker/index.js`
  (`handleMatch`, alarma pública, WebSocket attachments, `started` en storage persistente),
  `js/main.js` (`loadProfile`, `enterOnline`, countdown modal, `renderOnlinePlayers`),
  `js/multiplayer.js` (`requestMatch`), `scripts/dev.mjs` (nuevo, solo devtools).
  **Mecanismos positivos:** (1) `started` ahora persiste en DO storage — **cierra el bypass
  de hibernación**: antes, si el DO se hibernaba tras arrancar la partida, `this.started`
  se reiniciaba y una conexión nueva podía colarse a una sala ya iniciada; ahora `storage.get('started')`
  persiste a través de ciclos de vida del DO. (2) Roster derivado de `state.getWebSockets()` +
  attachments — más robusto que el `Map` in-memory anterior. (3) `renderOnlinePlayers()` usa
  `document.createElement` + `textContent` para nombres — sin riesgo XSS. (4) `loadProfile()`
  en `main.js` usa `data.username` (restringido a `[a-zA-Z0-9_]` en DB) como `playerName` en
  el WS URL — sin chars peligrosos inyectables. (5) No hay nuevas queries D1, cambios en
  cookies, `_headers` ni secrets.
  **Hallazgo — inflado de contador de sala vía `?match=1` sin autenticación:**
  `handleMatch()` incrementa `mm.count` en cada llamada, sin auth ni rate-limit. Un script
  puede llamarlo repetidamente y forzar la rotación de la sala pública (hacer que `mm.count`
  llegue a 6) sin que ningún jugador real se conecte; los jugadores que luego llamen
  `?match=1` recibirán una sala nueva vacía. Misma clase de riesgo que los gaps de
  rate-limiting ya aceptados en el resto de endpoints. Aceptado para MVP.
  **Hallazgo — bypass de hibernación cerrado (registrar como corrección):** el riesgo ya
  aceptado de "sala iniciada con `started` in-memory se perdía al hibernar" queda mitigado
  por persistir `started` en storage. La ventana de bypass era estrecha (un jugador nuevo
  debía conectarse justo tras la hibernación y antes del primer mensaje) pero real.
  **Hallazgo — `you_start` extiende el riesgo de `start_game` no restringido al host:**
  la alarma pública envía `{type:'you_start', players}` al primer socket (`roster()[0]`),
  quien entonces llama `hostStart` y emite `start_game`. Si el primer socket pertenece a
  un jugador malintencionado, puede ignorar `you_start` o emitir un `start_game` con un
  `payload.players` arbitrario antes de que la alarma dispare — mismo vector ya aceptado
  para MVP. Sin disposición nueva.
  Sin cambios en checklist pre-producción.

- **2026-06-16** — Lobby de sala (ready/start) y registro de victorias:
  `functions/api/win.js` (nuevo), `worker/index.js` (mapa `players`, flag `started`,
  mensajes `set_ready`/`start_game`/`lobby_update`, `resetRoom()`), `js/multiplayer.js`
  (`playerName`, `onJoinFailed`, `setMessageHandler`, `setReady`, `startGame`),
  `js/main.js` (pantalla de lobby, `enterLobby`/`beginOnlineGame`, `POST /api/win` al
  ganar online), `js/ui.js` (bloqueo de turno + temporizador de 30s, sin red ni input
  nuevo). **Hallazgos:** (1) `/api/win` no verifica que la victoria sea real — inflado de
  `wins` ahora posible sobre cuentas reales, y es otro endpoint de escritura que depende
  solo de la cookie sin HMAC; (2) `start_game` no está restringido al host en el
  servidor — cualquier conectado puede forzarlo con un `payload.players` arbitrario
  (extiende los hallazgos ya aceptados de spoofing de `playerId` y payload sin validar);
  (3) `payload.phase: 'gameover'` puede disparar `resetRoom()` sin que haya ganado
  realmente quien lo envía; (4) `playerName` sin límite server-side, mitigado por que los
  sinks de nombre ya escapan. Todos aceptados para MVP. **Corrección de documentación:**
  cerrado el hallazgo de self-XSS de `winner.name` en el modal de victoria — el código ya
  lo escapa (`escapeHtml`), confirmado que el lobby online no lo reabre. Sin cambios en
  `_headers` ni secrets.
- **2026-06-19** — Reconexión automática al modo online: `worker/index.js` (reingreso a sala
  iniciada por `playerId ∈ playerIds`, `state_sync`, `player_rejoined`, alarma de gracia de 45 s,
  auto-pong, `try/catch` en todos los handlers + `webSocketError`), `js/multiplayer.js` (heartbeat
  ping/pong + reconexión con backoff) y `js/main.js` (banner de reconexión, `state_sync` tratado
  como `game_state`). **Hallazgo — extensión del spoofing de `playerId`:** el reingreso a una
  partida en curso se autoriza solo con el `playerId` del query (a menudo la wallet pública), sin
  verificar `war_session`; permite **tomar el asiento de otro jugador y recibir el board completo
  vía `state_sync`**. Impacto bajo (board ya visible para los jugadores, partidas efímeras),
  aceptado para MVP; registrado en *Riesgos aceptados* con la mitigación de token de partida.
  **Mecanismos positivos:** (1) `try/catch` en `webSocketMessage`/`webSocketClose`/`alarm` +
  `webSocketError` → un mensaje/handler con error ya no tumba el DO ni desconecta a la sala
  (resistencia parcial a DoS); (2) auto-pong responde el heartbeat sin despertar el DO; (3) el
  banner de reconexión usa `createElement` + `textContent` con texto fijo → **sin XSS**. El
  `state_sync` aplicado con `Object.assign` extiende los riesgos ya aceptados ("`Object.assign` sin
  schema", "`game_state` sin validación server-side") al camino de reconexión, sin raíz nueva. Sin
  cambios en endpoints HTTP, queries D1, esquema, cookies, `_headers` ni secrets.
- **2026-06-19** — Refuerzo de la lógica de victorias: `js/game.js` (contador `round`,
  `canSurrender()`/`surrender()` desde la ronda 7, `_checkWin()` declara ganador al último
  vivo), `js/main.js` (flag `rankedOnline` que gatea `POST /api/win`; sync de `round`/`winner`/`alive`;
  `surrender` parcheado; pantalla de fin ganó/perdió), `js/ui.js` (botón Rendirse, indicador de
  ronda), `css/style.css` (estilos de la pantalla de fin). **Hallazgos:** (1) **win forzado a
  otro jugador** — al sincronizar `winner`, un peer puede difundir `game_state` con
  `phase:'gameover'` + `winner:<índice víctima>` y forzar el `POST /api/win` de la víctima;
  extensión del riesgo ya aceptado de `game_state` sin validación server-side, registrado en
  *Riesgos aceptados*. (2) **gating `rankedOnline` no es control de seguridad** — limitar el
  reporte de victorias al modo de emparejamiento es UX/producto; `functions/api/win.js` no
  cambió y el inflado por curl/devtools es idéntico. **Mecanismos positivos:** (a) la pantalla
  de fin escapa con `escapeHtml` el nombre del ganador y todos los nombres de la clasificación
  (sinks de nombres remotos cubiertos), color de `PLAYER_COLORS` y ronda numérica → sin XSS;
  (b) el sync de `winner` corrige un fallo latente (antes `onGameOver(null)` en clientes
  no-actores). `game.js` es lógica pura sin DOM/red. Sin cambios en queries D1, esquema,
  cookies, `_headers`, secrets ni en el checklist pre-producción (los vectores son extensiones
  de ítems ya cubiertos).
- **2026-06-19** — Flujo de ataque de dos clics y flechas SVG: `js/ui.js` (`pendingTarget`
  para pre-seleccionar zona enemiga, `arrowsLayer` con flechas SVG animadas, refactor de
  `handlePlayClick` al flujo de dos pasos, clases `.attack-target`/`.fortify-target`,
  botón Rendirse con diálogo de confirmación). `css/style.css` (clases de interacción del mapa:
  `.enemy-selected`, `.source-hint`, `.attack-arrow`, `.attack-notice`, `.round-tag`, end screen).
  **Hallazgo: ninguno nuevo.** `pendingTarget` es estado DOM puro sin sink de datos de usuario.
  `arrowsLayer` inyecta coordenadas numéricas de `TERRITORY_CENTERS` (constante de build, no input
  de usuario) — sin `innerHTML` con datos de usuario. El flujo de dos clics delega en
  `game.attack()`/`game.fortify()` por el mismo camino WebSocket ya auditado; el botón Rendirse
  llama `game.surrender()` (validado por `canSurrender()` client-side) y luego emite `game_state`
  — extensión de los riesgos ya aceptados de `game_state` sin validación server-side y `surrender`
  como método sincronizado, sin raíz nueva. `js/main.js` añade `reinforcements` al payload de
  `sendGameState` y al handler de `game_state`/`state_sync`, extendiendo el riesgo ya aceptado
  de "`Object.assign` sin schema" y "`game_state` sin validación server-side" al nuevo campo;
  sin raíz nueva, misma disposición: aceptado para MVP. Sin cambios en queries D1, endpoints
  HTTP, esquema, cookies, `_headers` ni secrets.
