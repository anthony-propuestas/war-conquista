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

export async function onRequestPost({ request, env }) {
  const session = getSession(request);
  if (!session?.sub) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await env.DB.prepare("UPDATE users SET wins = wins + 1 WHERE sub = ?")
    .bind(session.sub)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
