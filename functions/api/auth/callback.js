import { createSessionCookie } from "../../_lib/session.js";

// Recibe el code de Google, lo canjea por tokens, guarda la sesión en cookie
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (oauthError || !code) {
    return Response.redirect(`${url.origin}/login.html?error=${encodeURIComponent(oauthError || 'no_code')}`, 302);
  }

  // Anti Login-CSRF: el state debe coincidir con el de la cookie emitida en /api/auth/google.
  const cookie = request.headers.get("Cookie") || "";
  const stateCookie = cookie.match(/oauth_state=([^;]+)/)?.[1];
  if (!state || !stateCookie || state !== stateCookie) {
    return Response.redirect(`${url.origin}/login.html?error=invalid_state`, 302);
  }
  const clearState = "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response("Variables de entorno de Google no configuradas", { status: 500 });
  }

  const redirectUri = `${url.origin}/api/auth/callback`;

  // Canjear code por access_token
  let tokenData;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenData = await res.json();
  } catch (_) {
    return Response.redirect(`${url.origin}/login?error=token_fetch`, 302);
  }

  if (tokenData.error) {
    return Response.redirect(`${url.origin}/login?error=${encodeURIComponent(tokenData.error)}`, 302);
  }

  // Obtener perfil del usuario
  let userInfo;
  try {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    userInfo = await res.json();
  } catch (_) {
    return Response.redirect(`${url.origin}/login?error=userinfo_fetch`, 302);
  }

  // Sesión firmada con HMAC en una cookie HttpOnly
  const sessionCookie = await createSessionCookie({
    sub: userInfo.sub,
    name: userInfo.name,
    email: userInfo.email,
    picture: userInfo.picture,
  }, env);

  // Verificar si el usuario ya está registrado
  let isRegistered = false;
  try {
    const row = await env.DB.prepare("SELECT id FROM users WHERE sub = ?").bind(userInfo.sub).first();
    isRegistered = !!row;
  } catch (_) {
    // Si la tabla no existe aún, tratar como no registrado
  }

  const headers = new Headers({ Location: isRegistered ? "/lobby" : "/register" });
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", clearState);

  return new Response(null, { status: 302, headers });
}
