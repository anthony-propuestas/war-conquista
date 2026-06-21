import { getSession } from '../../_lib/session.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub=?').bind(session.sub).first();
  if (!user) return Response.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const todayStr = now.toISOString().slice(0, 10);

  const progress = await env.DB.prepare(
    'SELECT * FROM battle_pass_progress WHERE user_id=?'
  ).bind(user.id).first();

  let claimedDays = [];
  let lastClaimDate = null;
  if (progress && progress.current_month === month) {
    claimedDays = JSON.parse(progress.claimed_days || '[]');
    lastClaimDate = progress.last_claim_date;
  }

  const { results: rewards } = await env.DB.prepare(`
    SELECT bp.day, bp.quantity, cd.name, cd.description, cd.effect_type, cd.effect_value
    FROM battle_pass_rewards bp
    JOIN card_definitions cd ON bp.card_def_id = cd.id
    WHERE bp.month = ?
    ORDER BY bp.day
  `).bind(month).all();

  const todayReward = rewards.find(r => r.day === day) || null;

  return Response.json({
    month,
    current_day: day,
    days_in_month: new Date(now.getFullYear(), month, 0).getDate(),
    claimed_days: claimedDays,
    can_claim_today: lastClaimDate !== todayStr,
    today_reward: todayReward,
    rewards,
  });
}
