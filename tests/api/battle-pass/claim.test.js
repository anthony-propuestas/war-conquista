import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie } from "../../../functions/_lib/session.js";
import { onRequestPost } from "../../../functions/api/battle-pass/claim.js";

const SECRET = "test-secret";
const makeEnv = (db) => ({ DB: db, SESSION_SECRET: SECRET });
const todayStr = new Date().toISOString().slice(0, 10);
const currentMonth = new Date().getMonth() + 1;

function makeDb(firstMap = {}) {
  const runs = [];
  const batches = [];
  const db = {
    runs,
    batches,
    prepare(sql) {
      return {
        bind() {
          const result = Object.entries(firstMap).find(([k]) => sql.includes(k))?.[1] ?? null;
          return {
            first: async () => result,
            run: async () => { runs.push(sql); return { meta: { last_row_id: 1 } }; },
          };
        },
      };
    },
    async batch(stmts) {
      batches.push(...stmts);
      return [];
    },
  };
  return db;
}

async function makeCookie(payload) {
  const header = await createSessionCookie(payload, { SESSION_SECRET: SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeReq = (cookie) =>
  new Request("http://localhost/api/battle-pass/claim", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
  });

test("sin sesión → 401", async () => {
  const res = await onRequestPost({ request: makeReq(null), env: makeEnv(makeDb()) });
  assert.equal(res.status, 401);
});

test("ya reclamó hoy → {already_claimed:true}", async () => {
  const progress = { current_month: currentMonth, claimed_days: "[1]", last_claim_date: todayStr };
  const db = makeDb({ "SELECT id FROM users": { id: 7 }, "battle_pass_progress": progress });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.already_claimed, true);
});

test("día sin recompensa → {no_reward:true}", async () => {
  const progress = { current_month: currentMonth, claimed_days: "[]", last_claim_date: null };
  const db = makeDb({
    "SELECT id FROM users": { id: 7 },
    "battle_pass_progress": progress,
    "FROM battle_pass_rewards": null,
  });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  const body = await res.json();
  assert.equal(body.no_reward, true);
  assert.ok(Array.isArray(body.claimed_days));
});

test("recompensa disponible → claimed:true con reward y user_cards en batch", async () => {
  const progress = { current_month: currentMonth, claimed_days: "[]", last_claim_date: null };
  const reward = { quantity: 2, card_def_id: 5, name: "Escudo", description: "Prot", effect_type: "SHIELD", effect_value: 0 };
  const db = makeDb({
    "SELECT id FROM users": { id: 7 },
    "battle_pass_progress": progress,
    "FROM battle_pass_rewards": reward,
  });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  const body = await res.json();
  assert.equal(body.claimed, true);
  assert.equal(body.reward.name, "Escudo");
  assert.equal(body.reward.quantity, 2);
  assert.equal(db.batches.length, 2); // quantity:2 → 2 inserts en batch
});

test("primera reclamación (sin progress) → crea registro e inserta y retorna no_reward", async () => {
  const db = makeDb({
    "SELECT id FROM users": { id: 7 },
    "battle_pass_progress": null,
    "FROM battle_pass_rewards": null,
  });
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  const body = await res.json();
  assert.equal(body.no_reward, true);
  assert.ok(db.runs.some((s) => s.includes("INSERT INTO battle_pass_progress")));
});

test("UPDATE returns changes=0 (race condition) → {already_claimed:true}", async () => {
  const progress = { current_month: currentMonth, claimed_days: "[]", last_claim_date: null };
  const reward = { quantity: 1, card_def_id: 5, name: "Escudo", description: "Prot", effect_type: "SHIELD", effect_value: 0 };
  function makeDbZeroChanges() {
    const runs = [];
    const db = {
      runs,
      prepare(sql) {
        return {
          bind() {
            const firstMap = {
              "SELECT id FROM users": { id: 7 },
              "battle_pass_progress": progress,
              "FROM battle_pass_rewards": reward,
            };
            const result = Object.entries(firstMap).find(([k]) => sql.includes(k))?.[1] ?? null;
            return {
              first: async () => result,
              run: async () => { runs.push(sql); return { meta: { changes: 0 } }; },
            };
          },
        };
      },
      async batch(stmts) { return []; },
    };
    return db;
  }
  const db = makeDbZeroChanges();
  const cookie = await makeCookie({ sub: "u1" });
  const res = await onRequestPost({ request: makeReq(cookie), env: makeEnv(db) });
  const body = await res.json();
  assert.equal(body.already_claimed, true);
});
