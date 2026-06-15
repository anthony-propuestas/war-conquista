// Recibe el code de Google, lo canjea por tokens, guarda la sesión en cookie
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return Response.redirect(`${url.origin}/login?error=no_code`, 302);
  }

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
    return Response.redirect(`${url.origin}/login?error=${tokenData.error}`, 302);
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

  // Sesión simple: JSON en base64 en una cookie HttpOnly
  const session = btoa(JSON.stringify({
    sub: userInfo.sub,
    name: userInfo.name,
    email: userInfo.email,
    picture: userInfo.picture,
  }));

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `war_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    },
  });
}
