import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequestPost } from "../../../functions/api/cards/use.js";

const SECRET = "test-secret";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET });

function makeDb(firstMap = {}) {
  const runs = [];
  const db = {
    runs,
    prepare(sql) {
      return {
        bind() {
          const result = Object.entries(firstMap).find(([k]) => sql.includes(k))?.[1] ?? null;
          return {
            first: async () => result,
            run: async () => { runs.push(sql); return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  return db;
}

async function makeCookie(payload) {
  const header = await createSessionCookie(payload, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeReq = (cookie, body = { card_id: 1 }) =>
  new Request("http://localhost/api/cards/use", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

test("sin sesión → 401", async () => {
  const res = await onRequestPost({ request: makeReq(null), env: makeEnv(makeDb()) });
  assert.equal(res.status, 401);
});

test("usuario no encontrado → 404", async () => {
  const db = makeDb({ "SELECT id FROM users": null });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 404);
});

test("carta no disponible → 404", async () => {
  const db = makeDb({ "SELECT id FROM users": { id: 7 }, "FROM user_cards": null });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 404);
});

test("uso exitoso → 200 con effect_type y UPDATE ejecutado", async () => {
  const card = { id: 1, effect_type: "EXTRA_UNITS", effect_value: 3, name: "Refuerzo" };
  const db = makeDb({ "SELECT id FROM users": { id: 7 }, "FROM user_cards": card });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.effect_type, "EXTRA_UNITS");
  assert.equal(body.effect_value, 3);
  assert.equal(body.name, "Refuerzo");
  assert.ok(db.runs.some((s) => s.includes("UPDATE user_cards SET used_at")));
});

test("carta ya fue usada (UPDATE changes=0) → 409", async () => {
  const card = { id: 1, effect_type: "EXTRA_UNITS", effect_value: 3, name: "Refuerzo" };
  function makeDbUsed() {
    const db = {
      prepare(sql) {
        return {
          bind() {
            const firstMap = {
              "SELECT id FROM users": { id: 7 },
              "FROM user_cards": card,
            };
            const result = Object.entries(firstMap).find(([k]) => sql.includes(k))?.[1] ?? null;
            return {
              first: async () => result,
              run: async () => ({ meta: { changes: 0 } }),
            };
          },
        };
      },
    };
    return db;
  }
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(makeDbUsed()) });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "Carta ya fue usada");
});
