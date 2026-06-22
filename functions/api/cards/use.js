import { getSession } from '../../_lib/session.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub=?').bind(session.sub).first();
  if (!user) return Response.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const { card_id } = await request.json();
  if (!card_id) return Response.json({ error: 'Falta card_id' }, { status: 400 });

  const card = await env.DB.prepare(`
    SELECT uc.id, cd.effect_type, cd.effect_value, cd.name
    FROM user_cards uc
    JOIN card_definitions cd ON uc.card_def_id = cd.id
    WHERE uc.id = ? AND uc.user_id = ? AND uc.used_at IS NULL AND cd.is_active = 1
  `).bind(card_id, user.id).first();

  if (!card) return Response.json({ error: 'Carta no disponible' }, { status: 404 });

  const result = await env.DB.prepare(
    'UPDATE user_cards SET used_at=? WHERE id=? AND used_at IS NULL'
  ).bind(Date.now(), card_id).run();
  if (result.meta.changes === 0)
    return Response.json({ error: 'Carta ya fue usada' }, { status: 409 });

  return Response.json({ effect_type: card.effect_type, effect_value: card.effect_value, name: card.name });
}
