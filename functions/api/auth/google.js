// Inicia el flujo OAuth 2.0 con Google
export async function onRequestGet({ request, env }) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response("GOOGLE_CLIENT_ID no configurado", { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/callback`;

  // Anti Login-CSRF: state aleatorio guardado en cookie temporal y verificado en el callback.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
