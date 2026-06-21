import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../../functions/api/register.js";
import { createSessionCookie } from "../../functions/_lib/session.js";

const TEST_SECRET = "test-secret";

const HOW_HEARD_OPTIONS = [
  "YouTube",
  "Twitter / X",
  "Reddit",
  "Un amigo",
  "Encontré el link por casualidad",
];

async function makeSessionValue(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=([^;]+)/)[1];
}

async function makeRequest(body, sub = "u1") {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `war_session=${await makeSessionValue(sub)}`,
    },
    body: JSON.stringify(body),
  });
}

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

const makeEnv = (dbOpts) => ({ DB: makeDb(dbOpts), SESSION_SECRET: TEST_SECRET });

test("sin sesión → 302 a /login.html", async () => {
  const req = new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validBody),
  });
  const res = await onRequestPost({ request: req, env: makeEnv() });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("Location").includes("/login.html"));
});

test("body JSON inválido → 400", async () => {
  const req = new Request("http://localhost/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `war_session=${await makeSessionValue("u1")}`,
    },
    body: "not json",
  });
  const res = await onRequestPost({ request: req, env: makeEnv() });
  assert.equal(res.status, 400);
});

test("username demasiado corto → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ ...validBody, username: "ab" }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("username con caracteres inválidos → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ ...validBody, username: "ana-99" }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("edad fuera de rango → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ ...validBody, age: 200 }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("email sin @ → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ ...validBody, email: "noemail" }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("how_heard inválido → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ ...validBody, how_heard: "TikTok" }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("usuario ya registrado por sub → 409", async () => {
  const res = await onRequestPost({
    request: await makeRequest(validBody),
    env: makeEnv({ existsBySub: { id: 1 } }),
  });
  assert.equal(res.status, 409);
});

test("username ya tomado → 409", async () => {
  const res = await onRequestPost({
    request: await makeRequest(validBody),
    env: makeEnv({ existsBySub: null, existsByUsername: { id: 2 } }),
  });
  assert.equal(res.status, 409);
});

test("registro exitoso → 200 {ok: true}", async () => {
  const res = await onRequestPost({
    request: await makeRequest(validBody),
    env: makeEnv(),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});
