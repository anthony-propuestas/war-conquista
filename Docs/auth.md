# Autenticación — Google OAuth 2.0

WAR usa el flujo **Authorization Code** de OAuth 2.0 con Google. La sesión se guarda
en una cookie `HttpOnly` en el navegador; los datos del usuario se persisten en D1 (`users`).

## Flujo completo

```
Usuario → /login
    │ clic "Continuar con Google"
    ▼
GET /api/auth/google
    │ construye URL de Google con client_id, redirect_uri, scope
    ▼ 302
accounts.google.com/o/oauth2/v2/auth  (pantalla de consentimiento Google)
    │ usuario autoriza
    ▼ 302 con ?code=…
GET /api/auth/callback?code=<code>
    │ POST https://oauth2.googleapis.com/token  → access_token
    │ GET  https://openidconnect.googleapis.com/v1/userinfo → perfil
    │ Set-Cookie: war_session=<base64>
    │ SELECT id FROM users WHERE sub = ?
    ├─ fila encontrada ──302──> /game  (usuario ya registrado)
    └─ sin fila      ──302──> /register  (primer login: completar registro)
```

## Cookie de sesión (`war_session`)

Valor: **JSON codificado en Base64** (no firmado — MVP).

```json
{
  "sub":     "1234567890",
  "name":    "Ana García",
  "email":   "ana@example.com",
  "picture": "https://lh3.googleusercontent.com/…"
}
```

Atributos de la cookie: `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` (7 días).

### Leer la sesión desde otra Pages Function

```js
export async function onRequestGet({ request }) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/war_session=([^;]+)/);
  if (!match) return new Response("no autenticado", { status: 401 });
  const session = JSON.parse(atob(match[1]));
  // session.sub, session.name, session.email, session.picture
}
```

## Configuración en Google Cloud Console

1. Ir a **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth 2.0**
2. Tipo: **Aplicación web**
3. **URIs de redirección autorizados:**
   - `https://<tu-dominio>/api/auth/callback` (producción)
   - `http://localhost:8788/api/auth/callback` (desarrollo local)
4. Copiar **Client ID** y **Client secret** → configurar como secrets (ver [environment.md](environment.md))

## Limitaciones del MVP

| Aspecto | Estado actual |
|---|---|
| Firma de cookie | No — la cookie es base64 sin HMAC. Cualquiera puede forjar una sesión si no usa HTTPS. Válido en HTTPS (Cloudflare Pages siempre usa HTTPS en producción). |
| Logout | No implementado. La sesión expira sola en 7 días o borrando la cookie manualmente. |
| Renovación de token | No — solo se usa el `access_token` para obtener el perfil en el callback; no se guarda para llamadas posteriores. |
| Revocación | No — si el usuario revoca el acceso en Google, la cookie sigue válida hasta que expire. |
| Registro obligatorio | El primer login no entra directamente a `/game`: el usuario debe completar el formulario de `/register` (`POST /api/register`) antes de poder jugar. |

Ver endpoints en [api.md](api.md), secrets en [environment.md](environment.md).
