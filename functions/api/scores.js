// ============================================================
//  Cloudflare Pages Function - /api/scores
//  Salon de la fama persistido en Cloudflare D1 (binding: DB)
//  GET  -> top 10 ganadores
//  POST -> { name } registra/incrementa una victoria
//  Si no hay D1 vinculado, degrada de forma segura (lista vacia).
// ============================================================

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function onRequestGet({ env }) {
  if (!env.DB) return json([]); // sin D1 vinculado
  try {
    const { results } = await env.DB.prepare(
      "SELECT name, wins FROM scores ORDER BY wins DESC, updated_at DESC LIMIT 10"
    ).all();
    return json(results ?? []);
  } catch (_) {
    return json([]);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, reason: "no-db" });

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, reason: "bad-json" }, 400);
  }

  const name = String(body?.name ?? "").trim().slice(0, 16);
  if (!name) return json({ ok: false, reason: "no-name" }, 400);

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO scores (name, wins, updated_at) VALUES (?, 1, ?)
       ON CONFLICT(name) DO UPDATE SET wins = wins + 1, updated_at = ?`
    ).bind(name, now, now).run();
    return json({ ok: true });
  } catch (_) {
    return json({ ok: false, reason: "db-error" }, 500);
  }
}
