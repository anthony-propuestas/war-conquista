import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../functions/api/gamers.js";

test("devuelve lista de gamers con 200", async () => {
  const rows = [{ username: "Ana", wins: 10 }, { username: "Bob", wins: 5 }];
  const db = { prepare: () => ({ all: async () => ({ results: rows }) }) };
  const res = await onRequestGet({ env: { DB: db } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, rows);
});
