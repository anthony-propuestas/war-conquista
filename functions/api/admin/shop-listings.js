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

  if (method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT
        cd.id AS card_def_id,
        cd.name,
        cd.description,
        cd.effect_type,
        cd.effect_value,
        COALESCE(sl.is_listed, 0) AS is_listed,
        COALESCE(sl.wgt_price, 1) AS wgt_price
      FROM card_definitions cd
      LEFT JOIN shop_listings sl ON cd.id = sl.card_def_id
      WHERE cd.is_active = 1
      ORDER BY cd.created_at DESC
    `).all();
    return Response.json(results);
  }

  if (method === 'POST') {
    const { card_def_id, is_listed, wgt_price } = await request.json();
    if (!card_def_id) return Response.json({ error: 'Falta card_def_id' }, { status: 400 });
    const price = Math.max(0, Number(wgt_price) || 1);
    await env.DB.prepare(`
      INSERT INTO shop_listings (card_def_id, is_listed, listed_at, wgt_price)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(card_def_id) DO UPDATE SET
        is_listed = excluded.is_listed,
        listed_at = excluded.listed_at,
        wgt_price = excluded.wgt_price
    `).bind(
      Number(card_def_id),
      is_listed ? 1 : 0,
      Date.now(),
      price
    ).run();
    return Response.json({ ok: true });
  }

  if (method === 'DELETE') {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('card_def_id');
    if (!id) return Response.json({ error: 'Falta card_def_id' }, { status: 400 });
    await env.DB.prepare('DELETE FROM shop_listings WHERE card_def_id = ?').bind(id).run();
    return Response.json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
