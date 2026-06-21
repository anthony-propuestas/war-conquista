import { getSession } from '../../_lib/session.js';

function isAdmin(session, env) {
  if (!session) return false;
  const admins = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes((session.email || '').toLowerCase());
}

export async function onRequest(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!isAdmin(session, env)) {
    return Response.json({ error: 'No autorizado' }, { status: 403 });
  }

  const method = request.method;
  const { searchParams } = new URL(request.url);

  if (method === 'GET') {
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1), 10);
    const { results } = await env.DB.prepare(`
      SELECT bp.id, bp.month, bp.day, bp.quantity, bp.card_def_id,
             cd.name AS card_name, cd.effect_type, cd.effect_value
      FROM battle_pass_rewards bp
      JOIN card_definitions cd ON bp.card_def_id = cd.id
      WHERE bp.month = ?
      ORDER BY bp.day
    `).bind(month).all();
    return Response.json(results);
  }

  if (method === 'POST') {
    const body = await request.json();
    const { month, day, card_def_id, quantity = 1 } = body;
    if (!month || !day || !card_def_id) {
      return Response.json({ error: 'Faltan campos: month, day, card_def_id' }, { status: 400 });
    }
    await env.DB.prepare(
      'INSERT OR REPLACE INTO battle_pass_rewards (month, day, card_def_id, quantity) VALUES (?, ?, ?, ?)'
    ).bind(Number(month), Number(day), Number(card_def_id), Number(quantity)).run();
    return Response.json({ ok: true });
  }

  if (method === 'DELETE') {
    const month = searchParams.get('month');
    const day = searchParams.get('day');
    if (!month || !day) return Response.json({ error: 'Faltan month y day' }, { status: 400 });
    await env.DB.prepare('DELETE FROM battle_pass_rewards WHERE month=? AND day=?')
      .bind(Number(month), Number(day)).run();
    return Response.json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
