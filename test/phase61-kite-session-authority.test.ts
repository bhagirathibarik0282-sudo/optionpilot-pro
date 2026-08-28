import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptKiteAccessTokenForAuthority,
  encryptKiteAccessTokenForAuthority,
  kiteSessionIdFingerprint,
  kiteSessionIdMatchesFingerprint,
  kiteTokenFingerprint,
} from "../kite-session-authority.js";

const SECRET = "phase61-test-secret-that-is-definitely-more-than-32-characters";

test("Phase61 token encryption round-trips without plaintext leakage", () => {
  const token = "sensitive-kite-access-token-value";
  const sealed = encryptKiteAccessTokenForAuthority(token, SECRET);
  assert.notEqual(sealed, token);
  assert.equal(sealed.includes(token), false);
  assert.equal(decryptKiteAccessTokenForAuthority(sealed, SECRET), token);
});

test("Phase61 wrong encryption key fails closed", () => {
  const sealed = encryptKiteAccessTokenForAuthority("token-A", SECRET);
  const wrong = "another-test-secret-that-is-also-definitely-more-than-32-characters";
  assert.equal(decryptKiteAccessTokenForAuthority(sealed, wrong), null);
});

test("Phase61 short encryption key is rejected", () => {
  assert.throws(
    () => encryptKiteAccessTokenForAuthority("token-A", "short"),
    /KITE_SESSION_ENCRYPTION_KEY_INVALID/,
  );
  assert.equal(decryptKiteAccessTokenForAuthority("aa:bb:cc", "short"), null);
});

test("Phase61 token fingerprint is deterministic and does not reveal token", () => {
  const token = "secret-token-123";
  const fp1 = kiteTokenFingerprint(token);
  const fp2 = kiteTokenFingerprint(token);
  assert.equal(fp1, fp2);
  assert.equal(fp1.length, 16);
  assert.equal(fp1.includes(token), false);
});

test("Phase62 session id fingerprint validates only the original browser session", () => {
  const sessionId = "browser-session-random-id-A";
  const fingerprint = kiteSessionIdFingerprint(sessionId);
  assert.equal(fingerprint.length, 64);
  assert.equal(fingerprint.includes(sessionId), false);
  assert.equal(kiteSessionIdMatchesFingerprint(sessionId, fingerprint), true);
  assert.equal(kiteSessionIdMatchesFingerprint("forged-session-id", fingerprint), false);
  assert.equal(kiteSessionIdMatchesFingerprint("", fingerprint), false);
});
