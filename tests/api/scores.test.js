import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, onRequestPost } from "../../functions/api/scores.js";

const read = async (res) => ({ status: res.status, body: await res.json() });
const postReq = (body) =>
  new Request("http://x/api/scores", { method: "POST", body });

// ---------- GET ----------
test("GET sin DB degrada a lista vacia", async () => {
  const { status, body } = await read(await onRequestGet({ env: {} }));
  assert.equal(status, 200);
  assert.deepEqual(body, []);
});

test("GET con DB devuelve los resultados", async () => {
  const rows = [{ name: "Ana", wins: 3 }];
  const env = { DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } };
  const { body } = await read(await onRequestGet({ env }));
  assert.deepEqual(body, rows);
});

test("GET con DB que lanza degrada a lista vacia", async () => {
  const env = { DB: { prepare: () => ({ all: async () => { throw new Error("boom"); } }) } };
  const { body } = await read(await onRequestGet({ env }));
  assert.deepEqual(body, []);
});

// ---------- POST ----------
test("POST sin DB responde no-db", async () => {
  const { body } = await read(await onRequestPost({ request: postReq("{}"), env: {} }));
  assert.deepEqual(body, { ok: false, reason: "no-db" });
});

test("POST con JSON invalido -> 400 bad-json", async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } };
  const { status, body } = await read(await onRequestPost({ request: postReq("no-json"), env }));
  assert.equal(status, 400);
  assert.equal(body.reason, "bad-json");
});

test("POST con name vacio -> 400 no-name", async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } };
  const { status, body } = await read(
    await onRequestPost({ request: postReq(JSON.stringify({ name: "   " })), env })
  );
  assert.equal(status, 400);
  assert.equal(body.reason, "no-name");
});

test("POST recorta y trunca el name a 16 caracteres", async () => {
  let bound = null;
  const env = {
    DB: { prepare: () => ({ bind: (...args) => { bound = args; return { run: async () => {} }; } }) },
  };
  const raw = "  NombreSuperLargoQueExcede  ";
  await onRequestPost({ request: postReq(JSON.stringify({ name: raw })), env });
  assert.equal(bound[0], raw.trim().slice(0, 16));
});

test("POST exitoso responde ok:true", async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } };
  const { status, body } = await read(
    await onRequestPost({ request: postReq(JSON.stringify({ name: "Ana" })), env })
  );
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});

test("POST con error de DB -> 500 db-error", async () => {
  const env = {
    DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("boom"); } }) }) },
  };
  const { status, body } = await read(
    await onRequestPost({ request: postReq(JSON.stringify({ name: "Ana" })), env })
  );
  assert.equal(status, 500);
  assert.equal(body.reason, "db-error");
});
