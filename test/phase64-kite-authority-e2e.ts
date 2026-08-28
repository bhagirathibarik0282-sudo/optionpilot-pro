import assert from "node:assert/strict";
import {
  persistKiteAuthoritySession,
  resolveKiteAuthoritySession,
  kiteSessionIdMatchesFingerprint,
} from "../kite-session-authority.js";
import { revokeKiteAuthoritySession } from "../kite-session-authority-revoke.js";

const mode = process.argv[2];
const TOKEN = "phase64-test-token-not-a-real-broker-token";
const SESSION_ID = "phase64-browser-session-A";
const USER_ID = "phase64-test-user";
const EMAIL = "phase64@example.invalid";
const loginTime = Date.now() - 60_000;
const expiresAt = Date.now() + 60 * 60_000;

async function main() {
  if (mode === "persist") {
    const result = await persistKiteAuthoritySession({
      accessToken: TOKEN,
      sessionId: SESSION_ID,
      userId: USER_ID,
      email: EMAIL,
      loginTime,
      expiresAt,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status.code, "ACTIVE");
    assert.equal(result.status.tokenExposed, false);
    assert.equal(result.status.sessionIdExposed, false);
    console.log("PHASE64_PASS:PERSIST");
    return;
  }

  if (mode === "restore") {
    const result = await resolveKiteAuthoritySession();
    assert.equal(result.status.code, "ACTIVE");
    assert.ok(result.session);
    assert.equal(result.session?.accessToken, TOKEN);
    assert.equal(result.session?.userId, USER_ID);
    assert.equal(result.session?.source, "SHARED_DB_AUTHORITY");
    assert.equal(kiteSessionIdMatchesFingerprint(SESSION_ID, result.session!.sessionIdFingerprint), true);
    assert.equal(kiteSessionIdMatchesFingerprint("forged-session", result.session!.sessionIdFingerprint), false);
    console.log("PHASE64_PASS:RESTORE_AFTER_NEW_PROCESS");
    return;
  }

  if (mode === "revoke") {
    const result = await revokeKiteAuthoritySession();
    assert.equal(result.ok, true);
    assert.equal(result.code, "REVOKED");
    assert.equal(result.tokenExposed, false);
    assert.equal(result.sessionIdExposed, false);
    console.log("PHASE64_PASS:REVOKE");
    return;
  }

  if (mode === "assert-revoked") {
    const result = await resolveKiteAuthoritySession();
    assert.equal(result.session, null);
    assert.equal(result.status.code, "RECONNECT_REQUIRED");
    assert.equal(result.status.active, false);
    console.log("PHASE64_PASS:RESTORE_BLOCKED_AFTER_REVOKE");
    return;
  }

  throw new Error(`Unknown Phase64 mode: ${mode || "<missing>"}`);
}

main().catch((err) => {
  console.error("PHASE64_FAIL", err);
  process.exit(1);
});
