import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequest } from "../../../functions/api/admin/battle-pass.js";

const SECRET = "test-secret";
const ADMIN_EMAIL = "admin@test.com";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET, ADMIN_EMAILS: ADMIN_EMAIL });

function makeDb(allResults = []) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            all: async () => ({ results: allResults }),
            run: async () => {},
          };
        },
      };
    },
  };
}

async function makeAdminCookie() {
  const header = await createSessionCookie({ email: ADMIN_EMAIL, sub: "admin" }, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

test("sin sesión de admin → 403", async () => {
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/battle-pass?month=6", { method: "GET" }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 403);
});

test("GET con month → array de rewards", async () => {
  const rewards = [{ id: 1, month: 6, day: 1, quantity: 1, card_name: "Refuerzo" }];
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/battle-pass?month=6", { method: "GET", headers: { Cookie: cookie } }),
    env: makeEnv(makeDb(rewards)),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), rewards);
});

test("POST → inserta reward y retorna {ok:true}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/battle-pass", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ month: 6, day: 1, card_def_id: 3, quantity: 2 }),
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("DELETE → elimina reward y retorna {ok:true}", async () => {
  const cookie = await makeAdminCookie();
  const res = await onRequest({
    request: new Request("http://localhost/api/admin/battle-pass?month=6&day=1", {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
    env: makeEnv(makeDb()),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
