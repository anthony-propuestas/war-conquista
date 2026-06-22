import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequest } from "../../../functions/api/admin/shop-listings.js";

const SECRET = "test-secret";
const ADMIN_EMAIL = "admin@test.com";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET, ADMIN_EMAILS: ADMIN_EMAIL });

function makeDb(allResults = []) {
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        all: async () => ({ results: allResults }),
        run: async () => ({}),
      };
      return stmt;
    },
  };
}

async function makeAdminCookie() {
  const header = await createSessionCookie({ email: ADMIN_EMAIL, sub: "admin" }, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

test("sin sesión → 403", async () => {
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", { method: "GET" }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 403);
});

test("email no admin → 403", async () => {
  const header = await createSessionCookie({ email: "otro@test.com", sub: "x" }, { SESSION_SECRET: SECRET });
  const cookie = header.match(/war_session=[^;]+/)[0];
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", { method: "GET", headers: { Cookie: cookie } }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 403);
});

test("GET → lista de cards con is_listed y wgt_price", async () => {
  const cards = [{ card_def_id: 1, name: "Refuerzo", is_listed: 1, wgt_price: 2 }];
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", { method: "GET", headers: { Cookie: cookie } }),
    env: makeEnv(makeDb(cards)),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), cards);
});

test("POST con card_def_id → {ok:true}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ card_def_id: 1, is_listed: true, wgt_price: 3 }),
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("POST sin card_def_id → 400", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ is_listed: true }),
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 400);
});

test("DELETE con card_def_id → {ok:true}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings?card_def_id=1", {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("DELETE sin card_def_id → 400", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 400);
});

test("método PATCH → 405", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/shop-listings", {
      method: "PATCH",
      headers: { Cookie: cookie },
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 405);
});
