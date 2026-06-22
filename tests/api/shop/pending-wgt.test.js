import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../../functions/api/shop/pending-wgt.js";
import { createSessionCookie } from "../../../functions/_lib/session.js";

const TEST_SECRET = "test-secret";

async function makeHmacCookie(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeRequest = (cookie) =>
  new Request("http://localhost/api/shop/pending-wgt", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });

function makeDb({ user = { id: 1 }, total = 0 } = {}) {
  let callCount = 0;
  return {
    prepare(sql) {
      const stmt = {
        bind(...args) { return stmt; },
        first: async () => {
          callCount++;
          return callCount === 1 ? user : { total };
        },
      };
      return stmt;
    },
  };
}

const makeEnv = (db) => ({ DB: db, SESSION_SECRET: TEST_SECRET });

test("sin sesión → 200 {total:0}", async () => {
  const db = makeDb();
  const res = await onRequestGet({ request: makeRequest(null), env: makeEnv(db) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: 0 });
});

test("usuario no encontrado → {total:0}", async () => {
  const db = makeDb({ user: null });
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(db),
  });
  assert.deepEqual(await res.json(), { total: 0 });
});

test("wins de meses pasados → {total: suma}", async () => {
  const db = makeDb({ user: { id: 1 }, total: 7 });
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(db),
  });
  assert.deepEqual(await res.json(), { total: 7 });
});
