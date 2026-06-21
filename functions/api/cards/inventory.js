import { getSession } from '../../_lib/session.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!session) return Response.json([]);

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub=?').bind(session.sub).first();
  if (!user) return Response.json([]);

  const { results } = await env.DB.prepare(`
    SELECT uc.id, uc.used_at, cd.name, cd.description, cd.effect_type, cd.effect_value
    FROM user_cards uc
    JOIN card_definitions cd ON uc.card_def_id = cd.id
    WHERE uc.user_id = ? AND cd.is_active = 1
    ORDER BY uc.acquired_at
  `).bind(user.id).all();

  return Response.json(results);
}
