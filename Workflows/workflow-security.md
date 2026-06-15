# Workflow — Análisis de seguridad de los cambios

**Propósito:** analizar los cambios recientes desde la perspectiva de seguridad y registrar los hallazgos en `Docs/security.md`. **Si `Docs/security.md` no existe, el Paso 3 lo crea.**

## Paso 1 — Ver qué cambió

`git diff HEAD~1`, con atención especial a la superficie de ataque real de WAR:
- `functions/api/scores.js` — el único backend: handlers `onRequestGet` / `onRequestPost`, queries a D1, validación del input `name`.
- `js/main.js` — `escapeHtml` y el render del leaderboard (único punto donde datos de la DB vuelven al DOM).
- `wrangler.toml` y `_headers` — binding `DB` y cabeceras de seguridad.
- `schema.sql` — cambios de esquema que afecten integridad.

## Paso 2 — Checklist por tipo de cambio

Adaptada al stack real (Cloudflare Pages Functions + D1 + JS de navegador, **sin auth, sin sesiones, sin uploads**):

- **Endpoints / Pages Functions** (`onRequestGet` / `onRequestPost`):
  - ¿Las mutaciones siguen siendo solo `POST`? ¿Las lecturas solo `GET`?
  - El leaderboard es **público y sin autenticación por diseño**. Si un cambio añade un endpoint que escribe o expone datos sensibles, ¿debería seguir siendo anónimo? Documentar la decisión.
  - **Integridad sin auth:** `POST /api/scores` permite que cualquiera incremente victorias sin haber jugado. ¿El cambio empeora este abuso (p. ej. permite fijar `wins` arbitrario en vez de `+1`)? ¿Conviene rate-limit o un token de partida?
- **Queries a D1:**
  - ¿Siguen parametrizadas con `.prepare(...).bind(...)`? Nunca interpolar valores del usuario en el SQL.
  - ¿El `INSERT … ON CONFLICT` y el `SELECT … LIMIT` mantienen límites acotados (no `LIMIT` controlado por el cliente)?
- **Inputs del usuario** (`body.name`):
  - ¿Se mantiene la normalización `String(...).trim().slice(0, 16)` y el rechazo de vacío? ¿Algún input nuevo carece de límite de longitud/tipo?
- **Datos devueltos al cliente:**
  - El `SELECT` expone solo `name` y `wins`. ¿Un cambio filtra columnas internas (`updated_at`, ids) o datos de otros contextos?
  - **XSS:** todo dato de la DB renderizado en el DOM debe pasar por `escapeHtml` (ver `js/main.js`). ¿El cambio renderiza `name` u otro campo sin escaparlo (`innerHTML`)?
- **Cabeceras y config:**
  - ¿`_headers` conserva `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`? ¿Un cambio las debilita?
  - ¿`wrangler.toml` no introduce secrets en texto plano? (`database_id` no es secreto; tokens/API keys sí lo serían y van en secrets de Pages, nunca en el repo.)
- **No aplican** (anotar solo si el cambio los introduce por primera vez): uploads/archivos, manejo de cookies/tokens/sesiones, OAuth.

## Paso 3 — Registrar en `Docs/security.md`

Si no existe, crearlo. Registrar: mecanismos de seguridad nuevos o modificados, superficies de ataque que el cambio introduce, vectores posibles aunque no sean vulnerabilidades confirmadas (p. ej. inflado de `wins` por falta de auth), y cualquier cambio al checklist pre-producción.

## Paso 4 — Reportar en el chat

Resumir solo qué se registró y el hallazgo principal (si lo hubo).
