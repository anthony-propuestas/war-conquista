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
    const { results } = await env.DB.prepare(
      'SELECT * FROM card_definitions ORDER BY created_at DESC'
    ).all();
    return Response.json(results);
  }

  if (method === 'POST') {
    const body = await request.json();
    const { name, description, effect_type, effect_value = 0 } = body;
    if (!name?.trim() || !description?.trim() || !effect_type?.trim()) {
      return Response.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    const { meta } = await env.DB.prepare(
      'INSERT INTO card_definitions (name, description, effect_type, effect_value, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).bind(name.trim(), description.trim(), effect_type.trim(), Number(effect_value), Date.now()).run();
    return Response.json({ id: meta.last_row_id }, { status: 201 });
  }

  if (method === 'PUT') {
    const body = await request.json();
    const { id, name, description, effect_type, effect_value, is_active } = body;
    if (!id) return Response.json({ error: 'Falta id' }, { status: 400 });
    await env.DB.prepare(
      'UPDATE card_definitions SET name=?, description=?, effect_type=?, effect_value=?, is_active=? WHERE id=?'
    ).bind(name, description, effect_type, Number(effect_value), is_active ? 1 : 0, id).run();
    return Response.json({ ok: true });
  }

  if (method === 'DELETE') {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'Falta id' }, { status: 400 });
    await env.DB.prepare('DELETE FROM card_definitions WHERE id=?').bind(id).run();
    return Response.json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
