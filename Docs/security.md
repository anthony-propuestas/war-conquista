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

## Frontend — `js/main.js`

- **XSS (output encoding):** el `name` que vuelve de la DB pasa por `escapeHtml()` antes
  de inyectarse con `innerHTML` en el render del leaderboard. La defensa está en la
  **salida**: el `name` se almacena crudo (solo `trim`/truncado a 16), así que cualquier
  renderizado nuevo de datos de DB **debe** escaparse igual.
- `wins` se renderiza sin escapar pero es numérico (columna `INTEGER` de D1).

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
