import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";

import { onRequestPost } from "../../../functions/api/wallet/link.js";
import { createSessionCookie } from "../../../functions/_lib/session.js";

const wallet = Wallet.createRandom();
const messageFor = (sub) => `Vincular esta wallet a mi cuenta WAR (${sub})`;

const TEST_SECRET = "test-secret";

async function makeHmacCookie(sub) {
  const header = await createSessionCookie({ sub }, { SESSION_SECRET: TEST_SECRET });
  return header.match(/war_session=[^;]+/)[0];
}

const makeRequest = async (body, cookie) =>
  new Request("http://localhost/api/wallet/link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie !== undefined ? { Cookie: cookie } : {}),
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

const makeEnv = (dbOpts) => ({ DB: makeDb(dbOpts), SESSION_SECRET: TEST_SECRET });

test("sin cookie de sesión → 401", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ address: wallet.address, signature: "x" }, undefined),
    env: makeEnv(),
  });
  assert.equal(res.status, 401);
});

test("body JSON inválido → 400", async () => {
  const req = new Request("http://localhost/api/wallet/link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await makeHmacCookie("u1") },
    body: "not json",
  });
  const res = await onRequestPost({ request: req, env: makeEnv() });
  assert.equal(res.status, 400);
});

test("falta address o signature → 400", async () => {
  const res = await onRequestPost({
    request: await makeRequest({ address: wallet.address }, await makeHmacCookie("u1")),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("firma no corresponde a address → 400", async () => {
  const otherWallet = Wallet.createRandom();
  const signature = await otherWallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: await makeRequest({ address: wallet.address, signature }, await makeHmacCookie("u1")),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

test("firma válida y UPDATE exitoso → 200 {wallet_address}", async () => {
  const signature = await wallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: await makeRequest({ address: wallet.address, signature }, await makeHmacCookie("u1")),
    env: makeEnv(),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { wallet_address: wallet.address });
});

test("firma válida pero wallet ya vinculada a otra cuenta → 409", async () => {
  const signature = await wallet.signMessage(messageFor("u1"));
  const res = await onRequestPost({
    request: await makeRequest({ address: wallet.address, signature }, await makeHmacCookie("u1")),
    env: makeEnv({ runError: new Error("UNIQUE constraint failed: idx_users_wallet") }),
  });
  assert.equal(res.status, 409);
});
