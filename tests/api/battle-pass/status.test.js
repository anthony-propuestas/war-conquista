import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequestGet } from "../../../functions/api/battle-pass/status.js";

const SECRET = "test-secret";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET });
const currentMonth = new Date().getMonth() + 1;

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

test("sin sesión → 401", async () => {
  const res = await onRequestGet({ request: new Request("http://localhost/api/battle-pass/status"), env: makeEnv(makeDb()) });
  assert.equal(res.status, 401);
});

test("usuario no encontrado → 404", async () => {
  const db = makeDb({ "SELECT id FROM users": null });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestGet({
    request: new Request("http://localhost/api/battle-pass/status", { headers: { Cookie: cookie } }),
    env: makeEnv(db),
  });
  assert.equal(res.status, 404);
});

test("éxito → responde con month, claimed_days, can_claim_today y rewards", async () => {
  const progress = { current_month: currentMonth, claimed_days: "[1]", last_claim_date: "2000-01-01" };
  const rewards = [{ day: 1, quantity: 1, name: "Carta A", description: "Desc", effect_type: "EXTRA_UNITS", effect_value: 3 }];
  const db = makeDb(
    { "SELECT id FROM users": { id: 7 }, "battle_pass_progress": progress },
    { "FROM battle_pass_rewards": rewards }
  );
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestGet({
    request: new Request("http://localhost/api/battle-pass/status", { headers: { Cookie: cookie } }),
    env: makeEnv(db),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.month, currentMonth);
  assert.ok(typeof body.current_day === "number");
  assert.ok(typeof body.days_in_month === "number");
  assert.deepEqual(body.claimed_days, [1]);
  assert.equal(body.can_claim_today, true); // last_claim_date es "2000-01-01", no hoy
  assert.ok(Array.isArray(body.rewards));
  assert.equal(body.rewards.length, 1);
});
