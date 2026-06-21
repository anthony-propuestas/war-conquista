import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../functions/api/profile.js";
import { createSessionCookie } from "../../functions/_lib/session.js";

const TEST_SECRET = "test-secret";

async function makeHmacCookie(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeRequest = (cookie) =>
  new Request("http://localhost/api/profile", {
    headers: cookie ? { Cookie: cookie } : {},
  });

const makeDb = (user) => ({
  prepare: () => ({ bind: () => ({ first: async () => user }) }),
});

const makeEnv = (user) => ({ DB: makeDb(user), SESSION_SECRET: TEST_SECRET });

test("sin cookie → 401", async () => {
  const res = await onRequestGet({ request: makeRequest(null), env: makeEnv(null) });
  assert.equal(res.status, 401);
});

test("cookie con formato inválido → 401", async () => {
  const res = await onRequestGet({
    request: makeRequest("war_session=!!!invalid!!!"),
    env: makeEnv(null),
  });
  assert.equal(res.status, 401);
});

test("sesión válida pero usuario no en DB → 404", async () => {
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(null),
  });
  assert.equal(res.status, 404);
});

test("sesión válida y usuario encontrado → 200 con {username, wins, wallet_address, sub}", async () => {
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv({ username: "Ana", wins: 7, wallet_address: null }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { username: "Ana", wins: 7, wallet_address: null, sub: "u1" });
});
