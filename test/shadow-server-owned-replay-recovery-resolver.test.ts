import test from "node:test";
import assert from "node:assert/strict";
import { resolveShadowServerOwnedReplayRecovery } from "../shadow-server-owned-replay-recovery-resolver.js";

const validRow = {
  stable_replay_key: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  snapshot_version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1",
  harness_version: "SHADOW_EXECUTION_E2E_HARNESS_V1",
  action_state: "READY",
  final_target: "SHADOW_SUBMISSION_STATE",
  result_fingerprint: "fp-123",
};

test("resolves exactly one server-owned durable replay as REUSE_IDENTICAL", async () => {
  let sqlSeen = "";
  let paramsSeen: unknown[] | undefined;
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async (sql, params) => {
    sqlSeen = sql;
    paramsSeen = params;
    return { rows: [validRow] } as any;
  });
  assert.equal(out.decision, "FOUND");
  assert.equal(out.persistence?.journalDecision, "REUSE_IDENTICAL");
  assert.equal(out.persistence?.stableReplayKey, validRow.stable_replay_key);
  assert.equal(out.persistence?.placesOrder, false);
  assert.equal(out.persistence?.authorizesOrder, false);
  assert.equal(out.persistence?.brokerOrderAllowed, false);
  assert.deepEqual(paramsSeen, ["SHADOW_EXEC:exec-1:"]);
  assert.match(sqlSeen, /LIMIT 2/);
  assert.match(sqlSeen, /LEFT\(stable_replay_key, LENGTH\(\$1\)\) = \$1/);
});

test("blocks when no durable replay record exists", async () => {
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => ({ rows: [] }) as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_RECORD_NOT_FOUND"));
});

test("blocks ambiguous multiple durable rows for one execution id", async () => {
  const second = { ...validRow, stable_replay_key: "SHADOW_EXEC:exec-1:NIFTY:PE:25000:2026-09-03" };
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => ({ rows: [validRow, second] }) as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_IDENTITY_AMBIGUOUS"));
});

test("blocks corrupt durable replay semantics", async () => {
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => ({
    rows: [{ ...validRow, snapshot_version: "OTHER" }],
  }) as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_RECORD_INVALID"));
});

test("blocks prefix mismatch even if the DB adapter returns a row", async () => {
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => ({
    rows: [{ ...validRow, stable_replay_key: "SHADOW_EXEC:exec-2:NIFTY:CE:25000:2026-09-03" }],
  }) as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_RECORD_INVALID"));
});

test("rejects colon-bearing execution ids so replay key boundary stays unambiguous", async () => {
  let called = false;
  const out = await resolveShadowServerOwnedReplayRecovery("exec:1", async () => {
    called = true;
    return { rows: [validRow] } as any;
  });
  assert.equal(out.decision, "BLOCK");
  assert.equal(called, false);
  assert.ok(out.reasonCodes.includes("INVALID_SERVER_OWNED_REPLAY_EXECUTION_ID"));
});

test("fails closed when Postgres query is unavailable", async () => {
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => null as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_STORE_UNAVAILABLE"));
  assert.equal(out.failClosed, true);
});

test("fails closed when Postgres query throws", async () => {
  const out = await resolveShadowServerOwnedReplayRecovery("exec-1", async () => {
    throw new Error("db down");
  });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("SERVER_OWNED_REPLAY_RESOLUTION_FAILED"));
  assert.equal(out.placesOrder, false);
});
