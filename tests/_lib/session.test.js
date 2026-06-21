import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie, getSession } from "../../functions/_lib/session.js";

const SECRET = "test-secret";
const payload = { sub: "u1", name: "Ana" };
const env = { SESSION_SECRET: SECRET };

test("createSessionCookie devuelve header con war_session=payload.firma", async () => {
  const header = await createSessionCookie(payload, env);
  assert.ok(header.startsWith("war_session="));
  assert.ok(header.includes("; HttpOnly"));
  const value = header.match(/war_session=([^;]+)/)[1];
  assert.ok(value.includes("."), "debe tener firma separada por punto");
});

test("createSessionCookie sin SESSION_SECRET lanza error", async () => {
  await assert.rejects(() => createSessionCookie(payload, {}), /SESSION_SECRET/);
});

test("getSession con cookie válida devuelve el payload", async () => {
  const header = await createSessionCookie(payload, env);
  const cookieValue = header.match(/war_session=[^;]+/)[0];
  const req = new Request("http://localhost", { headers: { Cookie: cookieValue } });
  assert.deepEqual(await getSession(req, env), payload);
});

test("getSession sin SESSION_SECRET devuelve null", async () => {
  const header = await createSessionCookie(payload, env);
  const cookieValue = header.match(/war_session=[^;]+/)[0];
  const req = new Request("http://localhost", { headers: { Cookie: cookieValue } });
  assert.equal(await getSession(req, {}), null);
});

test("getSession sin cookie devuelve null", async () => {
  assert.equal(await getSession(new Request("http://localhost"), env), null);
});

test("getSession con cookie plain-base64 (formato antiguo) devuelve null", async () => {
  const oldValue = btoa(JSON.stringify(payload));
  const req = new Request("http://localhost", { headers: { Cookie: `war_session=${oldValue}` } });
  assert.equal(await getSession(req, env), null);
});

test("getSession con firma manipulada devuelve null", async () => {
  const header = await createSessionCookie(payload, env);
  const value = header.match(/war_session=([^;]+)/)[1];
  const [payloadB64] = value.split(".");
  const tampered = `war_session=${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const req = new Request("http://localhost", { headers: { Cookie: tampered } });
  assert.equal(await getSession(req, env), null);
});
