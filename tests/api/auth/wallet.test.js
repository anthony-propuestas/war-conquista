import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";

import { onRequestPost } from "../../../functions/api/auth/wallet.js";

const wallet = Wallet.createRandom();
const messageFor = (address) => `Iniciar sesión en WAR con esta wallet (${address})`;

const makeRequest = (body) =>
  new Request("http://localhost/api/auth/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const makeDb = (user) => ({
  prepare: () => ({ bind: () => ({ first: async () => user }) }),
});

test("body JSON inválido → 400", async () => {
  const req = new Request("http://localhost/api/auth/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
  const res = await onRequestPost({ request: req, env: { DB: makeDb(null) } });
  assert.equal(res.status, 400);
});

test("falta address o signature → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address }),
    env: { DB: makeDb(null) },
  });
  assert.equal(res.status, 400);
});

test("firma no corresponde a address → 400", async () => {
  const otherWallet = Wallet.createRandom();
  const signature = await otherWallet.signMessage(messageFor(wallet.address));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }),
    env: { DB: makeDb(null) },
  });
  assert.equal(res.status, 400);
});

test("firma válida pero wallet no vinculada → 404", async () => {
  const signature = await wallet.signMessage(messageFor(wallet.address));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }),
    env: { DB: makeDb(null) },
  });
  assert.equal(res.status, 404);
});

test("firma válida y wallet vinculada → 200 {ok:true} con cookie de sesión", async () => {
  const signature = await wallet.signMessage(messageFor(wallet.address));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }),
    env: { DB: makeDb({ sub: "u1", username: "Ana", email: "ana@example.com" }), SESSION_SECRET: "test-secret" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
  assert.ok(res.headers.get("Set-Cookie").includes("war_session="));
});
