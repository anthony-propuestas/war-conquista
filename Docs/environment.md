# Entorno y configuración

WAR **no tiene secrets ni variables de entorno de aplicación**. La única
configuración de entorno es el binding D1 que conecta la Pages Function con la base.

## `wrangler.toml`

```toml
name = "war-conquista"
pages_build_output_dir = "."
compatibility_date = "2025-06-01"

[[d1_databases]]
binding = "DB"
database_name = "war-scores"
database_id = "405ca0f4-51eb-48bf-8d56-a1040bfb7c06"
```

| Clave | Significado |
|---|---|
| `pages_build_output_dir = "."` | No hay build; la raíz del repo **es** el directorio servido. Por eso `tests/` se excluye con `.assetsignore`. |
| `compatibility_date` | Fija el runtime de Workers/Functions. |
| `[[d1_databases]]` | Declara el binding **`DB`** → base `war-scores`. La Function accede vía `env.DB`. |
| `database_id` | ID de la D1 remota (de `npm run db:create`). |

## El binding `DB`

`functions/api/scores.js` lee `env.DB`. Si el binding no existe, el endpoint degrada
(ver [api.md](api.md)) en vez de fallar.

**En local** (`npm run dev`): wrangler crea una D1 local automáticamente a partir del
binding del `wrangler.toml`. Inicializa su esquema con `npm run db:init`.

**En Pages (panel):** si despliegas vía Git en vez de CLI, añade el binding manualmente
en **Settings → Functions → D1 database bindings**: nombre de variable `DB` → base
`war-scores`.

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
