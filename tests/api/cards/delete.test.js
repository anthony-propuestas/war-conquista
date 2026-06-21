import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequestDelete } from "../../../functions/api/cards/delete.js";

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
            run: async () => { runs.push(sql); },
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

const makeReq = (cookie, id = "1") =>
  new Request(`http://localhost/api/cards/delete?id=${id}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });

test("sin sesión → 401", async () => {
  const res = await onRequestDelete({ request: makeReq(null), env: makeEnv(makeDb()) });
  assert.equal(res.status, 401);
});

test("carta no encontrada → 404", async () => {
  const db = makeDb({ "SELECT id FROM users": { id: 7 }, "SELECT id FROM user_cards": null });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestDelete({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 404);
});

test("eliminación exitosa → 200 {ok:true} y DELETE ejecutado", async () => {
  const db = makeDb({ "SELECT id FROM users": { id: 7 }, "SELECT id FROM user_cards": { id: 1 } });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestDelete({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.ok(db.runs.some((s) => s.includes("DELETE FROM user_cards")));
});
