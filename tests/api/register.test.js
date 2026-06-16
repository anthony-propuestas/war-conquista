import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../../functions/api/register.js";

const makeSession = (sub) => btoa(JSON.stringify({ sub }));

const makeRequest = (body, sub = "u1") =>
  new Request("http://localhost/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `war_session=${makeSession(sub)}`,
    },
    body: JSON.stringify(body),
  });

const validBody = {
  username: "Ana_99",
  age: 25,
  email: "ana@example.com",
  how_heard: "YouTube",
};

function makeDb({ existsBySub = null, existsByUsername = null } = {}) {
  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => (sql.includes("username =") ? existsByUsername : existsBySub),
        run: async () => {},
      }),
    }),
  };
}

test("sin sesión → 302 a /login.html", async () => {
  const req = new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validBody),
  });
  const res = await onRequestPost({ request: req, env: { DB: makeDb() } });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("Location").includes("/login.html"));
});

test("body JSON inválido → 400", async () => {
  const req = new Request("http://localhost/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `war_session=${makeSession("u1")}`,
    },
    body: "not json",
  });
  const res = await onRequestPost({ request: req, env: { DB: makeDb() } });
  assert.equal(res.status, 400);
});

test("username demasiado corto → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ ...validBody, username: "ab" }),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("username con caracteres inválidos → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ ...validBody, username: "ana-99" }),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("edad fuera de rango → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ ...validBody, age: 200 }),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("email sin @ → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ ...validBody, email: "noemail" }),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("how_heard inválido → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ ...validBody, how_heard: "TikTok" }),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("usuario ya registrado por sub → 409", async () => {
  const res = await onRequestPost({
    request: makeRequest(validBody),
    env: { DB: makeDb({ existsBySub: { id: 1 } }) },
  });
  assert.equal(res.status, 409);
});

test("username ya tomado → 409", async () => {
  const res = await onRequestPost({
    request: makeRequest(validBody),
    env: { DB: makeDb({ existsBySub: null, existsByUsername: { id: 2 } }) },
  });
  assert.equal(res.status, 409);
});

test("registro exitoso → 200 {ok: true}", async () => {
  const res = await onRequestPost({
    request: makeRequest(validBody),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});
