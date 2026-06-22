import { getSession } from '../../_lib/session.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) return Response.json({ items: [] });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub = ?')
    .bind(session.sub).first();
  if (!user) return Response.json({ items: [] });

  const { results } = await env.DB.prepare(`
    SELECT usi.card_def_id, usi.quantity, cd.name, cd.effect_type, cd.effect_value
    FROM user_shop_items usi
    JOIN card_definitions cd ON usi.card_def_id = cd.id
    WHERE usi.user_id = ? AND usi.quantity > 0 AND cd.is_active = 1
    ORDER BY usi.card_def_id
  `).bind(user.id).all();

  return Response.json({ items: results });
}
