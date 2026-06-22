import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../../../functions/api/shop/listings.js";

function makeDb(allResults = []) {
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        all: async () => ({ results: allResults }),
      };
      return stmt;
    },
  };
}

const makeEnv = (db) => ({ DB: db });

test("GET → lista de listings activos", async () => {
  const listings = [
    { card_def_id: 1, name: "Refuerzo", description: "Desc", effect_type: "EXTRA_UNITS", effect_value: 3, wgt_price: 2 },
  ];
  const res = await onRequest({
    request: new Request("http://localhost/api/shop/listings"),
    env: makeEnv(makeDb(listings)),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), listings);
});

test("GET sin listings → array vacío", async () => {
  const res = await onRequest({
    request: new Request("http://localhost/api/shop/listings"),
    env: makeEnv(makeDb([])),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});
