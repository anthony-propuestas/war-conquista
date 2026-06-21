import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequestGet } from "../../../functions/api/cards/inventory.js";

const SECRET = "test-secret";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET });

function makeDb(firstMap = {}, allMap = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          const firstResult = Object.entries(firstMap).find(([k]) => sql.includes(k))?.[1] ?? null;
          const allResult = Object.entries(allMap).find(([k]) => sql.includes(k))?.[1] ?? [];
          return {
            first: async () => firstResult,
            all: async () => ({ results: allResult }),
          };
        },
      };
    },
  };
}

async function makeCookie(payload) {
  const header = await createSessionCookie(payload, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

test("sin sesión → [] vacío", async () => {
  const res = await onRequestGet({ request: new Request("http://localhost/api/cards/inventory"), env: makeEnv(makeDb()) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("usuario no encontrado → []", async () => {
  const db = makeDb({ "SELECT id FROM users": null });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestGet({
    request: new Request("http://localhost/api/cards/inventory", { headers: { Cookie: cookie } }),
    env: makeEnv(db),
  });
  assert.deepEqual(await res.json(), []);
});

test("con sesión y cartas → devuelve array con campos esperados", async () => {
  const cards = [{ id: 1, used_at: null, name: "Refuerzo", description: "Desc", effect_type: "EXTRA_UNITS", effect_value: 3 }];
  const db = makeDb({ "SELECT id FROM users": { id: 7 } }, { "user_cards": cards });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestGet({
    request: new Request("http://localhost/api/cards/inventory", { headers: { Cookie: cookie } }),
    env: makeEnv(db),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), cards);
});
