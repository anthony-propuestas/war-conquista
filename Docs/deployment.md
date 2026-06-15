# Despliegue

WAR se publica en **Cloudflare Pages**. Al no haber build, el deploy es subir la raíz
del repo tal cual y vincular la D1.

## Preparar la base D1 (una sola vez)

```bash
npm run db:create        # crea la base "war-scores"
# copia el database_id impreso y pégalo en wrangler.toml ([[d1_databases]].database_id)
npm run db:init:remote   # aplica schema.sql a la D1 remota
```

Sin este paso el salón de la fama queda vacío, pero el juego funciona igual
(la API degrada — ver [api.md](api.md)).

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

## Notas

- **`_headers`** se aplica en el deploy (seguridad + caché de `/assets/*`); ver
  [environment.md](environment.md).
- **Demo en vivo:** https://war-conquista.pages.dev
- No hay variables de entorno ni secrets que configurar.

Ver también: [database.md](database.md) (migraciones), [stack.md](stack.md) (scripts).
