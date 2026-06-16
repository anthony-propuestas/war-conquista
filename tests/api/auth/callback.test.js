import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../../functions/api/auth/callback.js";

const callbackUrl = "http://localhost/api/auth/callback";
const env = { GOOGLE_CLIENT_ID: "test-id", GOOGLE_CLIENT_SECRET: "test-secret" };

test("sin ?code redirige a /login?error=no_code", async () => {
  const res = await onRequestGet({ request: new Request(callbackUrl), env });
  assert.equal(res.status, 302);
  assert.ok(new URL(res.headers.get("Location")).searchParams.get("error") === "no_code");
});

test("sin env vars retorna 500", async () => {
  const res = await onRequestGet({
    request: new Request(`${callbackUrl}?code=abc`),
    env: {},
  });
  assert.equal(res.status, 500);
});

test("Google retorna error en token -> redirige a /login?error=...", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }))
  );
  try {
    const res = await onRequestGet({ request: new Request(`${callbackUrl}?code=bad`), env });
    assert.equal(res.status, 302);
    assert.ok(new URL(res.headers.get("Location")).searchParams.get("error") === "invalid_grant");
  } finally {
    fetchMock.mock.restore();
  }
});

const dbWithUser = { prepare: () => ({ bind: () => ({ first: async () => ({ id: 1 }) }) }) };
const dbNoUser   = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };

function makeFetchMock() {
  let call = 0;
  return mock.method(globalThis, "fetch", async () => {
    call++;
    if (call === 1) return new Response(JSON.stringify({ access_token: "tok123" }));
    return new Response(JSON.stringify({ sub: "u1", name: "Ana", email: "ana@x.com", picture: "" }));
  });
}

test("flujo exitoso: usuario registrado → 302 a /lobby con cookie", async () => {
  const fetchMock = makeFetchMock();
  try {
    const res = await onRequestGet({
      request: new Request(`${callbackUrl}?code=ok`),
      env: { ...env, DB: dbWithUser },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "/lobby");
    assert.ok(res.headers.get("Set-Cookie").includes("war_session="));
  } finally {
    fetchMock.mock.restore();
  }
});

test("flujo exitoso: usuario nuevo → 302 a /register con cookie", async () => {
  const fetchMock = makeFetchMock();
  try {
    const res = await onRequestGet({
      request: new Request(`${callbackUrl}?code=ok`),
      env: { ...env, DB: dbNoUser },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "/register");
    assert.ok(res.headers.get("Set-Cookie").includes("war_session="));
  } finally {
    fetchMock.mock.restore();
  }
});
