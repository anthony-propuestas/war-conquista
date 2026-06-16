import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";

import { onRequestPost } from "../../../functions/api/wallet/link.js";

const wallet = Wallet.createRandom();
const messageFor = (sub) => `Vincular esta wallet a mi cuenta WAR (${sub})`;

const makeSession = (sub) => `war_session=${btoa(JSON.stringify({ sub }))}`;

const makeRequest = (body, cookie) =>
  new Request("http://localhost/api/wallet/link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

function makeDb({ runError = null } = {}) {
  return {
    prepare: () => ({
      bind: () => ({
        run: async () => {
          if (runError) throw runError;
        },
      }),
    }),
  };
}

test("sin cookie de sesión → 401", async () => {
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature: "x" }, null),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 401);
});

test("body JSON inválido → 400", async () => {
  const req = new Request("http://localhost/api/wallet/link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: makeSession("u1") },
    body: "not json",
  });
  const res = await onRequestPost({ request: req, env: { DB: makeDb() } });
  assert.equal(res.status, 400);
});

test("falta address o signature → 400", async () => {
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address }, makeSession("u1")),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("firma no corresponde a address → 400", async () => {
  const otherWallet = Wallet.createRandom();
  const signature = await otherWallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }, makeSession("u1")),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 400);
});

test("firma válida y UPDATE exitoso → 200 {wallet_address}", async () => {
  const signature = await wallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }, makeSession("u1")),
    env: { DB: makeDb() },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { wallet_address: wallet.address });
});

test("firma válida pero wallet ya vinculada a otra cuenta → 409", async () => {
  const signature = await wallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: makeRequest({ address: wallet.address, signature }, makeSession("u1")),
    env: { DB: makeDb({ runError: new Error("UNIQUE constraint failed: idx_users_wallet") }) },
  });
  assert.equal(res.status, 409);
});
