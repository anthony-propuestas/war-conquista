import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../../functions/api/shop/inventory.js";
import { createSessionCookie } from "../../../functions/_lib/session.js";

const TEST_SECRET = "test-secret";

async function makeHmacCookie(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeRequest = (cookie) =>
  new Request("http://localhost/api/shop/inventory", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });

function makeDb({ user = { id: 1 }, items = [] } = {}) {
  return {
    prepare(sql) {
      const stmt = {
        bind(...args) { return stmt; },
        first: async () => user,
        all: async () => ({ results: items }),
      };
      return stmt;
    },
  };
}

const makeEnv = (db) => ({ DB: db, SESSION_SECRET: TEST_SECRET });

test("sin sesión → 200 {items:[]}", async () => {
  const db = makeDb();
  const res = await onRequestGet({ request: makeRequest(null), env: makeEnv(db) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: [] });
});

test("usuario no encontrado → {items:[]}", async () => {
  const db = makeDb({ user: null });
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(db),
  });
  assert.deepEqual(await res.json(), { items: [] });
});

test("con items activos → devuelve array con campos esperados", async () => {
  const fakeItems = [
    { card_def_id: 1, quantity: 2, name: "Escudo", effect_type: "SHIELD", effect_value: 1 },
  ];
  const db = makeDb({ user: { id: 1 }, items: fakeItems });
  const res = await onRequestGet({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(db),
  });
  assert.deepEqual(await res.json(), { items: fakeItems });
});
