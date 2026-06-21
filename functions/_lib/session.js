// Sesión firmada con HMAC-SHA256. Formato de cookie: base64(payload).base64url(firma)
// El secreto vive en env.SESSION_SECRET (Pages Secret / .dev.vars), nunca en el repo.

const COOKIE_NAME = "war_session";
const MAX_AGE = 604800; // 7 días

function b64urlFromBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payloadB64, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return b64urlFromBytes(new Uint8Array(sig));
}

// Comparación en tiempo constante para no filtrar la firma por timing.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Firma el payload y devuelve el header Set-Cookie completo.
export async function createSessionCookie(payload, env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET no configurado");
  const payloadB64 = btoa(JSON.stringify(payload));
  const sig = await hmac(payloadB64, env.SESSION_SECRET);
  const value = `${payloadB64}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

// Lee y verifica la cookie. Devuelve el payload o null si falta/está manipulada.
export async function getSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/war_session=([^;]+)/);
  if (!match) return null;

  const parts = match[1].split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = await hmac(payloadB64, env.SESSION_SECRET);
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    return JSON.parse(atob(payloadB64));
  } catch (_) {
    return null;
  }
}
