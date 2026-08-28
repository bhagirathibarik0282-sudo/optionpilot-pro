import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptKiteAccessTokenForAuthority,
  encryptKiteAccessTokenForAuthority,
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
