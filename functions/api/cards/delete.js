import { getSession } from '../../_lib/session.js';

export async function onRequestDelete(context) {
  const { request, env } = context;
  const session = await getSession(request, env);
  if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE sub=?').bind(session.sub).first();
  if (!user) return Response.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const card_id = searchParams.get('id');
  if (!card_id) return Response.json({ error: 'Falta id' }, { status: 400 });

  const card = await env.DB.prepare('SELECT id FROM user_cards WHERE id=? AND user_id=?')
    .bind(card_id, user.id).first();
  if (!card) return Response.json({ error: 'Carta no encontrada' }, { status: 404 });

  await env.DB.prepare('DELETE FROM user_cards WHERE id=? AND user_id=?').bind(card_id, user.id).run();

  return Response.json({ ok: true });
}
