import { getSession } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await env.DB.prepare(
    "SELECT username, wins, wallet_address FROM users WHERE sub = ?"
  ).bind(session.sub).first();

  if (!user) {
    return new Response(JSON.stringify({ error: "Usuario no registrado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    username: user.username,
    wins: user.wins,
    wallet_address: user.wallet_address || null,
    sub: session.sub,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
