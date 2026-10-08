import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decodeConnectedDriveSession, persistConnectedDriveSession, loadConnectedDriveRefreshToken, DRIVE_CONNECTED_SESSION_KIND } from "../drive-connected-session.js";
import { dbQuerySafe } from "../db.js";

function fixture() {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update("fixture-secret").digest(), iv);
  const bytes = Buffer.concat([cipher.update("fixture-refresh", "utf8"), cipher.final()]);
  return { version: DRIVE_CONNECTED_SESSION_KIND, refreshTokenEncrypted: [iv.toString("hex"), cipher.getAuthTag().toString("hex"), bytes.toString("hex")].join(":"), connectedAt: "2026-10-08T19:35:43.131Z", clientFingerprint: createHash("sha256").update("fixture-client").digest("hex") };
}

test("connected session decrypts existing AES-GCM format and rejects client/key/tampering", () => {
  const f = fixture();
  assert.equal(decodeConnectedDriveSession(f, "fixture-client", "fixture-secret"), "fixture-refresh");
  assert.throws(() => decodeConnectedDriveSession(f, "wrong-client", "fixture-secret"), /CLIENT_MISMATCH/);
  assert.throws(() => decodeConnectedDriveSession(f, "fixture-client", "wrong-secret"), /DECRYPT_FAILED/);
  assert.throws(() => decodeConnectedDriveSession({ ...f, refreshTokenEncrypted: f.refreshTokenEncrypted + "00" }, "fixture-client", "fixture-secret"), /DECRYPT_FAILED/);
  assert.equal(JSON.stringify(f).includes("fixture-refresh"), false);
});

test("storage readback is required; stored session errors never downgrade to stale env credentials", async () => {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DATABASE_URL"];
  const old = names.map(n => process.env[n]);
  ["fixture-client", "fixture-secret", "fixture-db"].forEach((v, i) => { process.env[names[i]] = v; });
  try {
    const f = fixture();
    let stored: unknown;
    const query = (async (sql: string, params: unknown[]) => {
      if (sql.startsWith("INSERT")) { stored = JSON.parse(String(params[1])); return { rows: [{ id: 1 }] }; }
      return { rows: stored ? [{ payload: stored }] : [] };
    }) as typeof dbQuerySafe;
    assert.equal(await persistConnectedDriveSession(f.refreshTokenEncrypted, f.connectedAt, query), true);
    assert.equal(JSON.stringify(stored).includes("fixture-refresh"), false);
    assert.equal(await loadConnectedDriveRefreshToken("fixture-client", "fixture-secret", query), "fixture-refresh");
    await assert.rejects(loadConnectedDriveRefreshToken("wrong-client", "fixture-secret", query), /CLIENT_MISMATCH/);
    const unavailable = (async () => null) as typeof dbQuerySafe;
    assert.equal(await persistConnectedDriveSession(f.refreshTokenEncrypted, f.connectedAt, unavailable), false);
    await assert.rejects(loadConnectedDriveRefreshToken("fixture-client", "fixture-secret", unavailable), /STORAGE_UNAVAILABLE/);
    const empty = (async () => ({ rows: [] })) as typeof dbQuerySafe;
    assert.equal(await loadConnectedDriveRefreshToken("fixture-client", "fixture-secret", empty), null);
    assert.equal(await persistConnectedDriveSession(f.refreshTokenEncrypted, "invalid", query), false);
  } finally { names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }); }
});
