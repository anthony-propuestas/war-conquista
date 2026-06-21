import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../../functions/api/win.js";
import { createSessionCookie } from "../../functions/_lib/session.js";

const TEST_SECRET = "test-secret";

async function makeHmacCookie(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeRequest = (cookie) =>
  new Request("http://localhost/api/win", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
  });

function makeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => {} };
        },
      };
    },
  };
}

const makeEnv = (db) => ({ DB: db, SESSION_SECRET: TEST_SECRET });

test("sin cookie → 200 {ok:false}, no toca la DB", async () => {
  const db = makeDb();
  const res = await onRequestPost({ request: makeRequest(null), env: makeEnv(db) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(db.calls.length, 0);
});

test("cookie con formato inválido → 200 {ok:false}", async () => {
  const db = makeDb();
  const res = await onRequestPost({
    request: makeRequest("war_session=!!!invalid!!!"),
    env: makeEnv(db),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(db.calls.length, 0);
});

test("sesión válida → suma 1 victoria al sub correcto y responde {ok:true}", async () => {
  const db = makeDb();
  const res = await onRequestPost({
    request: makeRequest(await makeHmacCookie("u1")),
    env: makeEnv(db),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql, "UPDATE users SET wins = wins + 1 WHERE sub = ?");
  assert.deepEqual(db.calls[0].args, ["u1"]);
});
