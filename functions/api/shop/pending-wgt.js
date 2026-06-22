import { getSession } from '../../_lib/session.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) return Response.json({ total: 0 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub = ?')
    .bind(session.sub).first();
  if (!user) return Response.json({ total: 0 });

  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(wins), 0) as total
    FROM user_monthly_wins
    WHERE user_id = ? AND claimed_at IS NULL AND year_month < ?
  `).bind(user.id, currentYearMonth).first();

  return Response.json({ total: row?.total ?? 0 });
}
