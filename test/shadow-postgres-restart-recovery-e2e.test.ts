import test from "node:test";
import assert from "node:assert/strict";
import { runShadowPostgresRestartRecoveryE2E } from "../shadow-postgres-restart-recovery-e2e.js";
import type { ShadowReplayDbQuery } from "../shadow-replay-postgres-store.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "SHADOW_EXEC:exec-5e:NIFTY:CE:25000:2026-09-03",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "READY",
  finalTarget: "SHADOW_ONLY",
  resultFingerprint: "fp-5e",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

const brokerRecovery = {
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1" as const,
  state: "ACKNOWLEDGED" as const,
  stateFactsFresh: true,
  filledQuantity: 0,
  totalQuantity: 1,
  cancelled: false,
  exactContractBound: true,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function memoryQuery(): ShadowReplayDbQuery {
  const rows = new Map<string, any>();
  return async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    if (/CREATE TABLE/i.test(sql)) return { rows: [] as T[] };
    if (/INSERT INTO shadow_replay_durable_v1/i.test(sql)) {
      const [key, snapshotVersion, harnessVersion, actionState, finalTarget, fingerprint] = params as string[];
      if (!rows.has(key)) {
        rows.set(key, {
          stable_replay_key: key,
          snapshot_version: snapshotVersion,
          harness_version: harnessVersion,
          action_state: actionState,
          final_target: finalTarget,
          result_fingerprint: fingerprint,
        });
      }
      return { rows: [] as T[] };
    }
    if (/FROM shadow_replay_durable_v1/i.test(sql)) {
      const row = rows.get(String(params[0]));
      return { rows: (row ? [row] : []) as T[] };
    }
    throw new Error("unexpected query");
  };
}

test("Postgres-backed restart recovery safely resumes idle shadow without entry replay", async () => {
  const out = await runShadowPostgresRestartRecoveryE2E({ persistence, brokerRecovery }, memoryQuery());
  assert.equal(out.decision, "RESUME_IDLE_SHADOW");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.semanticReadBackConfirmed, true);
  assert.equal(out.newEntryResumeAllowed, false);
  assert.equal(out.placesOrder, false);
});

test("Postgres-backed restart recovery permits management-only shadow for open exposure", async () => {
  const out = await runShadowPostgresRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, state: "FILLED", filledQuantity: 1 },
  }, memoryQuery());
  assert.equal(out.decision, "RESUME_MANAGEMENT_SHADOW");
  assert.equal(out.managementResumeAllowed, true);
  assert.equal(out.effectiveOpenQuantity, 1);
  assert.equal(out.newEntryResumeAllowed, false);
});

test("database unavailability halts restart recovery fail closed", async () => {
  const query: ShadowReplayDbQuery = async () => null;
  const out = await runShadowPostgresRestartRecoveryE2E({ persistence, brokerRecovery }, query);
  assert.equal(out.decision, "HALT");
  assert.equal(out.persistenceDecision, "BLOCK");
  assert.equal(out.newEntryResumeAllowed, false);
});

test("immutable durable semantic conflict halts restart recovery", async () => {
  const query = memoryQuery();
  const first = await runShadowPostgresRestartRecoveryE2E({ persistence, brokerRecovery }, query);
  assert.equal(first.decision, "RESUME_IDLE_SHADOW");

  const second = await runShadowPostgresRestartRecoveryE2E({
    persistence: { ...persistence, actionState: "CHANGED" },
    brokerRecovery,
  }, query);
  assert.equal(second.decision, "HALT");
  assert.equal(second.persistenceDecision, "BLOCK");
  assert.equal(second.semanticReadBackConfirmed, false);
});

test("broker/order invariant tampering halts before touching Postgres", async () => {
  let touched = false;
  const query: ShadowReplayDbQuery = async <T = Record<string, unknown>>() => {
    touched = true;
    return { rows: [] as T[] };
  };
  const unsafe = "places" + "Order";
  const out = await runShadowPostgresRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, [unsafe]: true } as any,
  }, query);
  assert.equal(out.decision, "HALT");
  assert.equal(touched, false);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
  assert.equal(out.placesOrder, false);
});
