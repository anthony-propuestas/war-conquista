import { getSession } from '../../_lib/session.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub=?').bind(session.sub).first();
  if (!user) return Response.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const month = now.getMonth() + 1;
  const day = now.getDate();

  let progress = await env.DB.prepare(
    'SELECT * FROM battle_pass_progress WHERE user_id=?'
  ).bind(user.id).first();

  let claimedDays = [];

  if (!progress) {
    await env.DB.prepare(
      'INSERT INTO battle_pass_progress (user_id, current_month, claimed_days, last_claim_date) VALUES (?, ?, ?, NULL)'
    ).bind(user.id, month, '[]').run();
    progress = { user_id: user.id, current_month: month, claimed_days: '[]', last_claim_date: null };
  }

  // Reset if new month
  if (progress.current_month !== month) {
    claimedDays = [];
    await env.DB.prepare(
      'UPDATE battle_pass_progress SET current_month=?, claimed_days=?, last_claim_date=NULL WHERE user_id=?'
    ).bind(month, '[]', user.id).run();
    progress = { ...progress, current_month: month, claimed_days: '[]', last_claim_date: null };
  } else {
    claimedDays = JSON.parse(progress.claimed_days || '[]');
  }

  if (progress.last_claim_date === todayStr) {
    return Response.json({ already_claimed: true, claimed_days: claimedDays });
  }

  const reward = await env.DB.prepare(`
    SELECT bp.quantity, cd.id AS card_def_id, cd.name, cd.description, cd.effect_type, cd.effect_value
    FROM battle_pass_rewards bp
    JOIN card_definitions cd ON bp.card_def_id = cd.id
    WHERE bp.month = ? AND bp.day = ? AND cd.is_active = 1
  `).bind(month, day).first();

  claimedDays.push(day);
  await env.DB.prepare(
    'UPDATE battle_pass_progress SET claimed_days=?, last_claim_date=? WHERE user_id=?'
  ).bind(JSON.stringify(claimedDays), todayStr, user.id).run();

  if (!reward) {
    return Response.json({ claimed: true, reward: null, claimed_days: claimedDays });
  }

  const inserts = [];
  for (let i = 0; i < reward.quantity; i++) {
    inserts.push(
      env.DB.prepare('INSERT INTO user_cards (user_id, card_def_id, acquired_at) VALUES (?, ?, ?)')
        .bind(user.id, reward.card_def_id, Date.now())
    );
  }
  await env.DB.batch(inserts);

  return Response.json({
    claimed: true,
    reward: {
      name: reward.name,
      description: reward.description,
      effect_type: reward.effect_type,
      effect_value: reward.effect_value,
      quantity: reward.quantity,
    },
    claimed_days: claimedDays,
  });
}
