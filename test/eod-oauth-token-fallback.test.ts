import test from "node:test";
import assert from "node:assert/strict";
import { refreshOAuthAccessTokenWithFallback } from "../eod-drive-upload.js";

function oauthMock(
  outcomes: Record<string, { status: number; body: Record<string, string> }>,
  attempts: string[],
): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const refreshToken = new URLSearchParams(String(init?.body || "")).get("refresh_token") || "";
    attempts.push(refreshToken);
    const outcome = outcomes[refreshToken];
    if (!outcome) throw new Error("Unexpected fixture refresh token");
    return Response.json(outcome.body, { status: outcome.status });
  }) as typeof fetch;
}

test("one bounded fallback after invalid_grant on connected token", async () => {
  const attempts: string[] = [];
  const mocked = oauthMock({
    "db-revoked": { status: 400, body: { error: "invalid_grant", error_description: "revoked" } },
    "env-valid": { status: 200, body: { access_token: "access-from-env" } },
  }, attempts);
  const result = await refreshOAuthAccessTokenWithFallback("client", "secret", "db-revoked", "env-valid", mocked);
  assert.equal(result, "access-from-env");
  assert.deepEqual(attempts, ["db-revoked", "env-valid"]);
});

test("valid connected token is preferred without consulting alternate", async () => {
  const attempts: string[] = [];
  const mocked = oauthMock({
    "db-valid": { status: 200, body: { access_token: "access-from-db" } },
  }, attempts);
  assert.equal(await refreshOAuthAccessTokenWithFallback("client", "secret", "db-valid", "env-valid", mocked), "access-from-db");
  assert.deepEqual(attempts, ["db-valid"]);
});

test("no alternate token, or identical revoked token, does not loop", async () => {
  for (const alternate of [null, "db-revoked"]) {
    const attempts: string[] = [];
    const mocked = oauthMock({
      "db-revoked": { status: 400, body: { error: "invalid_grant" } },
    }, attempts);
    await assert.rejects(
      refreshOAuthAccessTokenWithFallback("client", "secret", "db-revoked", alternate, mocked),
      /GOOGLE_OAUTH_TOKEN_FAILED:invalid_grant/,
    );
    assert.deepEqual(attempts, ["db-revoked"]);
  }
});

test("non-revocation failures are not masked by fallback", async () => {
  for (const response of [
    { status: 503, body: { error: "temporarily_unavailable" } },
    { status: 403, body: { error: "insufficient_scope" } },
  ]) {
    const attempts: string[] = [];
    const mocked = oauthMock({ "db-token": response }, attempts);
    await assert.rejects(
      refreshOAuthAccessTokenWithFallback("client", "secret", "db-token", "env-token", mocked),
      /GOOGLE_OAUTH_TOKEN_FAILED/,
    );
    assert.deepEqual(attempts, ["db-token"]);
  }
});

test("missing credentials fail closed without network access", async () => {
  let attempts = 0;
  const mocked = (async () => { attempts++; throw new Error("unexpected fetch"); }) as typeof fetch;
  await assert.rejects(
    refreshOAuthAccessTokenWithFallback("client", "secret", null, null, mocked),
    /GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED/,
  );
  assert.equal(attempts, 0);
});
