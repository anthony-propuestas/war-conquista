# Entorno y configuración

WAR usa un **binding D1** (salón de la fama), un **binding Durable Object** (sala
multijugador) y **dos secrets de Google OAuth** (autenticación). Los bindings van en
`wrangler.toml`; los secrets, fuera del repo.

## `wrangler.toml`

```toml
name = "war-conquista"
pages_build_output_dir = "."
compatibility_date = "2025-06-01"

[[d1_databases]]
binding = "DB"
database_name = "war-scores"
database_id = "405ca0f4-51eb-48bf-8d56-a1040bfb7c06"

[[durable_objects.bindings]]
name = "GAME_ROOM"
class_name = "GameRoom"
script_name = "war-game-room"
```

| Clave | Significado |
|---|---|
| `pages_build_output_dir = "."` | No hay build; la raíz del repo **es** el directorio servido. Por eso `tests/` se excluye con `.assetsignore`. |
| `compatibility_date` | Fija el runtime de Workers/Functions. |
| `[[d1_databases]]` | Declara el binding **`DB`** → base `war-scores`. La Function accede vía `env.DB`. |
| `database_id` | ID de la D1 remota (de `npm run db:create`). |
| `[[durable_objects.bindings]]` | Declara el binding **`GAME_ROOM`** → clase `GameRoom` en el Worker separado `war-game-room` (`script_name`). La Pages Function de routing (`functions/api/game-room.js`) lo usa vía `env.GAME_ROOM`. |

> La sección `[[migrations]]` (registro de la clase DO, `new_sqlite_classes = ["GameRoom"]`) vive en `worker/wrangler.toml`, no en el `wrangler.toml` principal.

## Secrets

### Google OAuth

`functions/api/auth/google.js` y `functions/api/auth/callback.js` leen
`env.GOOGLE_CLIENT_ID` y `env.GOOGLE_CLIENT_SECRET`.

Los secrets se obtienen de **Google Cloud Console → Credenciales → OAuth 2.0 → ID de cliente**.
URI de redirección autorizado: `<origen>/api/auth/callback` (añadir tanto el origen de
producción como `http://localhost:8788`).

### Firma de sesión (`SESSION_SECRET`)

`functions/_lib/session.js` firma y verifica la cookie `war_session` con HMAC-SHA256 usando
`env.SESSION_SECRET`. Sin este secret, `getSession` devuelve `null` y `createSessionCookie`
lanza → el login queda inoperante. Usar un valor aleatorio robusto (≥32 bytes de entropía).

**En local** (`npm run dev`): añadir al `.dev.vars` en la raíz (ya en `.gitignore`):
```
GOOGLE_CLIENT_ID=<tu-client-id>
GOOGLE_CLIENT_SECRET=<tu-client-secret>
SESSION_SECRET=<cadena-aleatoria-larga>
```

**En producción** (Pages → proyecto `war-conquista`):
```bash
wrangler pages secret put GOOGLE_CLIENT_ID --project-name war-conquista
wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name war-conquista
wrangler pages secret put SESSION_SECRET --project-name war-conquista
```
Wrangler pide el valor de forma interactiva (no queda en el historial del shell).
Para listar los secrets configurados: `wrangler pages secret list --project-name war-conquista`.

Ver flujo completo en [auth.md](auth.md).

## El binding `DB`

`functions/api/win.js`, `functions/api/gamers.js`, `functions/api/profile.js` y
`functions/api/register.js` leen `env.DB` (ver [api.md](api.md)).

**En local** (`npm run dev`): wrangler crea una D1 local automáticamente a partir del
binding del `wrangler.toml`. Aplica el esquema actual ejecutando la migración manualmente:
`wrangler d1 execute war-scores --local --file migrations/0001_users.sql`.

**En Pages (panel):** si despliegas vía Git en vez de CLI, añade el binding manualmente
en **Settings → Functions → D1 database bindings**: nombre de variable `DB` → base
`war-scores`.

## El binding `GAME_ROOM` (Durable Object)

`functions/api/game-room.js` usa `env.GAME_ROOM` para resolver la sala
(`idFromName(roomId)`). En `npm run dev` wrangler instancia el DO localmente a partir del
binding y la migración del `wrangler.toml`. En producción, la migración `v1` se aplica en
el deploy; en CI/CD desde Git, confirmar el binding `GAME_ROOM` en el panel de Pages si no
se hereda del `wrangler.toml`. Detalle del subsistema en [realtime.md](realtime.md).

La clase `GameRoom` en sí corre en el Worker separado `war-game-room`
(`worker/wrangler.toml`), que tiene su propio pipeline de Git (**Workers Builds**) —
ver la sección dedicada en [deployment.md](deployment.md).

## Librerías de runtime (`importmap`)

`pixi.js` y `ethers` se cargan en el navegador desde **esm.sh** (CDN ESM-native) mediante
`importmap` en cada HTML (ver [stack.md](stack.md)). No hay dependencia de `node_modules`
en los assets desplegados.

## Cabeceras (`_headers`)

Cloudflare Pages aplica `_headers` a las respuestas:

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Cabeceras de seguridad para todo el sitio + caché agresiva e inmutable para `/assets/*`.

Ver también: [deployment.md](deployment.md), [database.md](database.md).
