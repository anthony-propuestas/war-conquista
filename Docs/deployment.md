# Despliegue

WAR tiene **dos líneas de producción** separadas: el sitio/Functions en **Cloudflare
Pages** y el Durable Object de multijugador en un **Worker** aparte (`war-game-room`).

El Pages sube la raíz del repo tal cual (no hay paso de bundling propio para los
assets), pero requiere `npm install` como build command: `ethers` se usa server-side en
Functions (`functions/api/auth/wallet.js`, `functions/api/wallet/link.js`) y el bundler
necesita `node_modules` para resolver ese import. El frontend, en cambio, carga `ethers`
y `pixi.js` desde **esm.sh** vía `importmap` (ver [onchain.md](onchain.md)) y no depende
de `node_modules`.

## Preparar la base D1 (una sola vez)

```bash
npm run db:create        # crea la base "war-scores"
# copia el database_id impreso y pégalo en wrangler.toml ([[d1_databases]].database_id)
wrangler d1 execute war-scores --remote --file migrations/0001_users.sql
```

## Opción A — deploy desde la terminal

```bash
npx wrangler login
npm run deploy           # wrangler pages deploy .
```

Sube todo el directorio (`pages_build_output_dir = "."`). `tests/` se excluye vía
`.assetsignore`.

## Opción B — CI/CD desde GitHub (recomendado)

1. Panel de Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
2. Selecciona este repositorio.
3. **Build command:** `npm install` · **Output directory:** `/`.
4. **Settings → Functions → D1 database bindings:** añade `DB` → `war-scores`
   (el binding del `wrangler.toml` no se hereda automáticamente en builds de Git).
5. Cada `git push` a `main` despliega a producción.

## Durable Object (multijugador)

El binding `GAME_ROOM` y la migración `v1` viven en `wrangler.toml` (ver
[environment.md](environment.md)). La migración se aplica al desplegar; en CI/CD desde Git,
verificar que el binding del Durable Object esté presente en el panel de Pages si no se
hereda del `wrangler.toml`.

## Worker `war-game-room` — segunda línea de producción

La clase `GameRoom` (coordina las salas de multijugador en tiempo real) corre en un
**Worker separado**, `war-game-room` (`worker/index.js` + `worker/wrangler.toml`), porque
Pages no soporta Durable Objects directamente. El binding `GAME_ROOM` de la app de Pages
apunta a este Worker vía `script_name` en `wrangler.toml` (ver [environment.md](environment.md)).

Despliegue manual (fallback):
```bash
npm run deploy:worker    # wrangler deploy --config worker/wrangler.toml
```

Despliegue automático (**Workers Builds**, configurado en el panel):
1. Panel de Cloudflare → **Workers & Pages → `war-game-room` → Settings → Builds → Connect to Git**.
2. Selecciona el mismo repositorio `war-conquista`.
3. **Root directory:** `worker` · **Build command:** *(vacío, sin dependencias npm)* ·
   **Deploy command:** `npx wrangler deploy`.
4. **Branch:** `main`.
5. Cada `git push` a `main` redespliega este Worker, igual que Pages.

**Migraciones del Durable Object:** si se cambia la clase `GameRoom` con storage ya
existente en producción, hay que agregar una nueva entrada `[[migrations]]` con `tag`
incremental (`v2`, `v3`, ...) en `worker/wrangler.toml` *antes* de pushear — la migración
se aplica automáticamente en cada deploy de Workers Builds.

## Notas

- **`_headers`** se aplica en el deploy (seguridad + caché de `/assets/*`); ver
  [environment.md](environment.md).
- **`_redirects`**: `/ → /home` (301), `/game → /game/index.html` (200, rewrite) y
  `/lobby → /lobby/index.html` (200, rewrite). Cloudflare Pages lo procesa
  automáticamente; no requiere configuración adicional.
- **Demo en vivo:** https://war-conquista.pages.dev
- **Secrets de Google OAuth:** antes del primer deploy con auth activo, ejecutar:
  ```bash
  wrangler pages secret put GOOGLE_CLIENT_ID --project-name war-conquista
  wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name war-conquista
  ```
  Ver [environment.md](environment.md) para obtener las credenciales de Google Cloud Console.

Ver también: [database.md](database.md) (migraciones), [stack.md](stack.md) (scripts).
