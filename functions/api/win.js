import { getSession } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE sub = ?")
    .bind(session.sub)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const yearMonth = new Date().toISOString().slice(0, 7); // "2026-06"

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET wins = wins + 1 WHERE id = ?").bind(user.id),
    env.DB.prepare(`
      INSERT INTO user_monthly_wins (user_id, year_month, wins)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, year_month) DO UPDATE SET wins = wins + 1
    `).bind(user.id, yearMonth),
  ]);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
