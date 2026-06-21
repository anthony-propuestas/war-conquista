import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequest } from "../../../functions/api/admin/cards.js";

const SECRET = "test-secret";
const ADMIN_EMAIL = "admin@test.com";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET, ADMIN_EMAILS: ADMIN_EMAIL });

function makeDb(allResults = []) {
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        all: async () => ({ results: allResults }),
        run: async () => ({ meta: { last_row_id: 42 } }),
      };
      return stmt;
    },
  };
}

async function makeAdminCookie() {
  const header = await createSessionCookie({ email: ADMIN_EMAIL, sub: "admin" }, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

test("sin sesión de admin → 403", async () => {
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/cards", { method: "GET" }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 403);
});

test("GET → lista de card_definitions", async () => {
  const cards = [{ id: 1, name: "Refuerzo", effect_type: "EXTRA_UNITS" }];
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/cards", { method: "GET", headers: { Cookie: cookie } }),
    env: makeEnv(makeDb(cards)),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), cards);
});

test("POST válido → 201 {id}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/cards", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Refuerzo", description: "Desc", effect_type: "EXTRA_UNITS", effect_value: 3 }),
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: 42 });
});

test("POST sin campos requeridos → 400", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/cards", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 400);
});

test("DELETE → 200 {ok:true}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/cards?id=1", {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
