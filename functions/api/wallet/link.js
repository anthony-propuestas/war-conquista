import { verifyMessage } from "ethers";
import { getSession } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  const message = `Vincular esta wallet a mi cuenta WAR (${session.sub})`;

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

  try {
    await env.DB.prepare("UPDATE users SET wallet_address = ? WHERE sub = ?")
      .bind(address, session.sub)
      .run();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Esta wallet ya está vinculada a otra cuenta" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ wallet_address: address }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
