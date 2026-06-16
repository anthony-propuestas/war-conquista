function getSession(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/war_session=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(atob(match[1]));
  } catch (_) {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  const session = getSession(request);
  if (!session?.sub) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await env.DB.prepare(
    "SELECT username, wins FROM users WHERE sub = ?"
  ).bind(session.sub).first();

  if (!user) {
    return new Response(JSON.stringify({ error: "Usuario no registrado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ username: user.username, wins: user.wins }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
