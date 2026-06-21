import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../../functions/api/auth/callback.js";

const callbackUrl = "http://localhost/api/auth/callback";
const STATE = "test-state-uuid-abc";
const baseEnv = {
  GOOGLE_CLIENT_ID: "test-id",
  GOOGLE_CLIENT_SECRET: "test-secret",
  SESSION_SECRET: "test-session-secret",
};

function reqWithState(code, extraCookie = "") {
  const cookie = [`oauth_state=${STATE}`, extraCookie].filter(Boolean).join("; ");
  return new Request(`${callbackUrl}?code=${code}&state=${STATE}`, {
    headers: { Cookie: cookie },
  });
}

test("sin ?code → redirige a /login.html?error=no_code", async () => {
  const res = await onRequestGet({ request: new Request(callbackUrl), env: baseEnv });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("Location")).searchParams.get("error"), "no_code");
});

test("sin state CSRF (no state en URL ni cookie) → 302 a login.html?error=invalid_state", async () => {
  const res = await onRequestGet({
    request: new Request(`${callbackUrl}?code=abc`),
    env: baseEnv,
  });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("Location").includes("invalid_state"));
});

test("state no coincide con cookie → 302 a login.html?error=invalid_state", async () => {
  const res = await onRequestGet({
    request: new Request(`${callbackUrl}?code=abc&state=other-state`, {
      headers: { Cookie: `oauth_state=${STATE}` },
    }),
    env: baseEnv,
  });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get("Location").includes("invalid_state"));
});

test("sin GOOGLE_CLIENT_ID/SECRET → 500", async () => {
  const res = await onRequestGet({
    request: reqWithState("abc"),
    env: { SESSION_SECRET: "s" },
  });
  assert.equal(res.status, 500);
});

test("Google retorna error en token → 302 a login?error=...", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }))
  );
  try {
    const res = await onRequestGet({ request: reqWithState("bad"), env: baseEnv });
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get("Location")).searchParams.get("error"), "invalid_grant");
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

test("flujo exitoso: usuario registrado → 302 a /lobby con cookie firmada", async () => {
  const fetchMock = makeFetchMock();
  try {
    const res = await onRequestGet({
      request: reqWithState("ok"),
      env: { ...baseEnv, DB: dbWithUser },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "/lobby");
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.includes("war_session=")));
    assert.ok(cookies.some(c => c.includes("oauth_state=") && c.includes("Max-Age=0")));
  } finally {
    fetchMock.mock.restore();
  }
});

test("flujo exitoso: usuario nuevo → 302 a /register con cookie firmada", async () => {
  const fetchMock = makeFetchMock();
  try {
    const res = await onRequestGet({
      request: reqWithState("ok"),
      env: { ...baseEnv, DB: dbNoUser },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "/register");
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.includes("war_session=")));
  } finally {
    fetchMock.mock.restore();
  }
});
