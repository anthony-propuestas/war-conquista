# Despliegue

WAR se publica en **Cloudflare Pages**. Al no haber build, el deploy es subir la raíz
del repo tal cual y vincular la D1.

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
3. **Build command:** *(vacío)* · **Output directory:** `/`.
4. **Settings → Functions → D1 database bindings:** añade `DB` → `war-scores`
   (el binding del `wrangler.toml` no se hereda automáticamente en builds de Git).
5. Cada `git push` a `main` despliega a producción.

## Durable Object (multijugador)

El binding `GAME_ROOM` y la migración `v1` viven en `wrangler.toml` (ver
[environment.md](environment.md)). La migración se aplica al desplegar; en CI/CD desde Git,
verificar que el binding del Durable Object esté presente en el panel de Pages si no se
hereda del `wrangler.toml`.

## Notas

- **`_headers`** se aplica en el deploy (seguridad + caché de `/assets/*`); ver
  [environment.md](environment.md).
- **`_redirects`**: `/ → /home` (301) y `/game → /game/index.html` (200, rewrite).
  Cloudflare Pages lo procesa automáticamente; no requiere configuración adicional.
- **Demo en vivo:** https://war-conquista.pages.dev
- **Secrets de Google OAuth:** antes del primer deploy con auth activo, ejecutar:
  ```bash
  wrangler pages secret put GOOGLE_CLIENT_ID --project-name war-conquista
  wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name war-conquista
  ```
  Ver [environment.md](environment.md) para obtener las credenciales de Google Cloud Console.

Ver también: [database.md](database.md) (migraciones), [stack.md](stack.md) (scripts).
