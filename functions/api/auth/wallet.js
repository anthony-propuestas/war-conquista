import { verifyMessage } from "ethers";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Cuerpo inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { address, signature } = body;
  if (!address || !signature) {
    return new Response(JSON.stringify({ error: "Faltan datos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = `Iniciar sesión en WAR con esta wallet (${address})`;

  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch (_) {
    return new Response(JSON.stringify({ error: "Firma inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return new Response(JSON.stringify({ error: "Firma inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await env.DB.prepare(
    "SELECT sub, username, email FROM users WHERE wallet_address = ? COLLATE NOCASE"
  ).bind(address).first();

  if (!user) {
    return new Response(JSON.stringify({ error: "Wallet no vinculada a ninguna cuenta" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = btoa(JSON.stringify({
    sub: user.sub,
    name: user.username,
    email: user.email,
    picture: null,
  }));

  const cookie = `war_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}
