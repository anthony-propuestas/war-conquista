const HOW_HEARD_OPTIONS = [
  "YouTube",
  "Twitter / X",
  "Un amigo me lo recomendó",
  "Reddit",
  "Discord",
  "Encontré el link por casualidad",
];

import { getSession } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session?.sub) {
    return Response.redirect(new URL("/login.html", request.url).href, 302);
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

  const { username, age, email, how_heard } = body;

  if (!username || typeof username !== "string" || username.trim().length < 3 || username.trim().length > 30) {
    return new Response(JSON.stringify({ error: "El nombre de usuario debe tener entre 3 y 30 caracteres" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
    return new Response(JSON.stringify({ error: "Solo letras, números y guion bajo" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 5 || ageNum > 120) {
    return new Response(JSON.stringify({ error: "Edad inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return new Response(JSON.stringify({ error: "Correo inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!HOW_HEARD_OPTIONS.includes(how_heard)) {
    return new Response(JSON.stringify({ error: "Opción inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verificar si el usuario ya existe por sub
  const existing = await env.DB.prepare("SELECT id FROM users WHERE sub = ?").bind(session.sub).first();
  if (existing) {
    return new Response(JSON.stringify({ error: "Usuario ya registrado" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verificar si el username ya está tomado
  const takenUsername = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username.trim()).first();
  if (takenUsername) {
    return new Response(JSON.stringify({ error: "Ese nombre de usuario ya está en uso" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  await env.DB.prepare(
    "INSERT INTO users (sub, username, age, email, how_heard, wins, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
  ).bind(session.sub, username.trim(), ageNum, email.trim(), how_heard, Date.now()).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
