import { getSession } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
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
