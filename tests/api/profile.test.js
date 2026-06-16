import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../functions/api/profile.js";

const makeSession = (sub) => `war_session=${btoa(JSON.stringify({ sub }))}`;

const makeRequest = (cookie) =>
  new Request("http://localhost/api/profile", {
    headers: cookie ? { Cookie: cookie } : {},
  });

const makeDb = (user) => ({
  prepare: () => ({ bind: () => ({ first: async () => user }) }),
});

test("sin cookie → 401", async () => {
  const res = await onRequestGet({ request: makeRequest(null), env: { DB: makeDb(null) } });
  assert.equal(res.status, 401);
});

test("cookie con base64 inválido → 401", async () => {
  const res = await onRequestGet({
    request: makeRequest("war_session=!!!invalid!!!"),
    env: { DB: makeDb(null) },
  });
  assert.equal(res.status, 401);
});

test("sesión válida pero usuario no en DB → 404", async () => {
  const res = await onRequestGet({
    request: makeRequest(makeSession("u1")),
    env: { DB: makeDb(null) },
  });
  assert.equal(res.status, 404);
});

test("sesión válida y usuario encontrado → 200 con {username, wins}", async () => {
  const res = await onRequestGet({
    request: makeRequest(makeSession("u1")),
    env: { DB: makeDb({ username: "Ana", wins: 7 }) },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { username: "Ana", wins: 7 });
});
