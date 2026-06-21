# Autenticación — Google OAuth 2.0

WAR usa el flujo **Authorization Code** de OAuth 2.0 con Google. La sesión se guarda
en una cookie `HttpOnly` firmada con HMAC-SHA256 en el navegador; los datos del usuario
se persisten en D1 (`users`).

## Flujo completo

```
Usuario → /login
    │ clic "Continuar con Google"
    ▼
GET /api/auth/google
    │ genera state = crypto.randomUUID()
    │ Set-Cookie: oauth_state=<state>  (HttpOnly; Secure; Max-Age=600)
    │ construye URL de Google con client_id, redirect_uri, scope, state
    ▼ 302
accounts.google.com/o/oauth2/v2/auth  (pantalla de consentimiento Google)
    │ usuario autoriza
    ▼ 302 con ?code=…&state=<state>
GET /api/auth/callback?code=<code>&state=<state>
    │ verifica state contra cookie oauth_state  → 302 /login?error=invalid_state si no coincide
    │ POST https://oauth2.googleapis.com/token  → access_token
    │ GET  https://openidconnect.googleapis.com/v1/userinfo → perfil
    │ Set-Cookie: war_session=<payload.hmac>  (firmada con SESSION_SECRET)
    │ Set-Cookie: oauth_state=  (Max-Age=0, limpiar)
    │ SELECT id FROM users WHERE sub = ?
    ├─ fila encontrada ──302──> /lobby  (usuario ya registrado)
    └─ sin fila      ──302──> /register  (primer login: completar registro)
```

## Cookie de sesión (`war_session`)

Valor: **`base64(payload).base64url(HMAC-SHA256)`**, firmado con `SESSION_SECRET`
(Cloudflare Pages Secret). Módulo compartido: `functions/_lib/session.js`.

Payload JSON:
```json
{
  "sub":     "1234567890",
  "name":    "Ana García",
  "email":   "ana@example.com",
  "picture": "https://lh3.googleusercontent.com/…"
}
```

Atributos de la cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` (7 días).
Una cookie manipulada o forjada devuelve `null` en `getSession` (la firma no coincide).
Las sesiones del formato antiguo (plain base64, sin punto) también se rechazan.

### Usar la sesión desde otra Pages Function

```js
import { getSession } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) return new Response("no autenticado", { status: 401 });
  // session.sub, session.name, session.email, session.picture
}
```

`getSession` retorna `null` si la cookie está ausente, la firma no coincide o
`env.SESSION_SECRET` no está configurado.

## Login alternativo: wallet (MetaMask)

Además de Google, una cuenta ya registrada puede iniciar sesión firmando un mensaje
con su wallet vinculada — sin pasar por OAuth. Emite la misma cookie `war_session`
(mismo `sub`/`username`/`email`; `picture: null`).

```
/my-profile → conectar wallet → firmar "Vincular esta wallet a mi cuenta WAR (${sub})"
    ▼
POST /api/wallet/link  → guarda wallet_address en users (requiere sesión existente)

/login → "Conectar MetaMask" → firmar "Iniciar sesión en WAR con esta wallet (${address})"
    ▼
POST /api/auth/wallet  → busca users WHERE wallet_address = ? → Set-Cookie: war_session
```

Es decir: la wallet **no reemplaza el registro**, solo agrega una segunda puerta a una
cuenta que ya existe. Detalle de las firmas y `signMessage` en [onchain.md](onchain.md);
shapes de request/response en [api.md](api.md).

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
| Firma de cookie | ✅ HMAC-SHA256 con `SESSION_SECRET` (`functions/_lib/session.js`). Forja y manipulación rechazadas. |
| Login CSRF | ✅ Parámetro `state` generado en `/api/auth/google`, verificado en `/api/auth/callback`. |
| Logout | No implementado. La sesión expira sola en 7 días o borrando la cookie manualmente. |
| Renovación de token | No — solo se usa el `access_token` para obtener el perfil en el callback; no se guarda para llamadas posteriores. |
| Revocación | No — si el usuario revoca el acceso en Google, la cookie sigue válida hasta que expire. |
| Registro obligatorio | El primer login no entra directamente a `/lobby`: el usuario debe completar el formulario de `/register` (`POST /api/register`) antes de poder jugar. |
| Login por wallet sin registro propio | `/api/auth/wallet` solo funciona si la wallet ya fue vinculada a una cuenta existente vía `/api/wallet/link`; no hay alta de cuenta nueva directamente por wallet. |

Ver endpoints en [api.md](api.md), secrets en [environment.md](environment.md).
