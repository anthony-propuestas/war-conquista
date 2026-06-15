import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet } from "../../../functions/api/auth/google.js";

const req = (url) => new Request(url);

test("sin GOOGLE_CLIENT_ID retorna 500", async () => {
  const res = await onRequestGet({ request: req("http://localhost/api/auth/google"), env: {} });
  assert.equal(res.status, 500);
});

test("con GOOGLE_CLIENT_ID redirige a Google OAuth con params correctos", async () => {
  const env = { GOOGLE_CLIENT_ID: "test-client-id" };
  const res = await onRequestGet({ request: req("http://localhost/api/auth/google"), env });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("Location"));
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(location.searchParams.get("client_id"), "test-client-id");
  assert.equal(location.searchParams.get("redirect_uri"), "http://localhost/api/auth/callback");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.ok(location.searchParams.get("scope").includes("openid"));
});
