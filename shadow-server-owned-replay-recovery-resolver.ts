import { dbQuerySafe } from "./db.js";
import type { ShadowReplayPersistenceAdapterInput } from "./shadow-replay-persistence-adapter.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";

interface DurableReplayDbRow {
  stable_replay_key: string;
  snapshot_version: string;
  harness_version: string;
  action_state: string;
  final_target: string;
  result_fingerprint: string;
}

export interface ShadowServerOwnedReplayRecoveryResolution {
  version: "SHADOW_SERVER_OWNED_REPLAY_RECOVERY_RESOLVER_V1";
  decision: "FOUND" | "BLOCK";
  persistence: ShadowReplayPersistenceAdapterInput | null;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validExecutionId(value: unknown): value is string {
  return validText(value) && !value.includes(":");
}

function blocked(reasonCode: string): ShadowServerOwnedReplayRecoveryResolution {
  return {
    version: "SHADOW_SERVER_OWNED_REPLAY_RECOVERY_RESOLVER_V1",
    decision: "BLOCK",
    persistence: null,
    reasonCodes: [reasonCode],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

function validRow(row: DurableReplayDbRow, expectedPrefix: string): boolean {
  return !!row &&
    validText(row.stable_replay_key) && row.stable_replay_key.startsWith(expectedPrefix) &&
    row.snapshot_version === "EXECUTION_CONSISTENCY_SNAPSHOT_V1" &&
    row.harness_version === "SHADOW_EXECUTION_E2E_HARNESS_V1" &&
    validText(row.action_state) &&
    validText(row.final_target) &&
    validText(row.result_fingerprint);
}

export async function resolveShadowServerOwnedReplayRecovery(
  executionId: string,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowServerOwnedReplayRecoveryResolution> {
  if (!validExecutionId(executionId)) return blocked("INVALID_SERVER_OWNED_REPLAY_EXECUTION_ID");
  if (typeof query !== "function") return blocked("INVALID_SERVER_OWNED_REPLAY_QUERY_ADAPTER");

  const normalizedExecutionId = executionId.trim();
  const stablePrefix = `SHADOW_EXEC:${normalizedExecutionId}:`;

  try {
    const result = await query<DurableReplayDbRow>(
      `
        SELECT
          stable_replay_key,
          snapshot_version,
          harness_version,
          action_state,
          final_target,
          result_fingerprint
        FROM shadow_replay_durable_v1
        WHERE LEFT(stable_replay_key, LENGTH($1)) = $1
        ORDER BY stable_replay_key ASC
        LIMIT 2
      `,
      [stablePrefix],
    );

    if (!result || !Array.isArray(result.rows)) return blocked("SERVER_OWNED_REPLAY_STORE_UNAVAILABLE");
    if (result.rows.length === 0) return blocked("SERVER_OWNED_REPLAY_RECORD_NOT_FOUND");
    if (result.rows.length !== 1) return blocked("SERVER_OWNED_REPLAY_IDENTITY_AMBIGUOUS");

    const row = result.rows[0];
    if (!validRow(row, stablePrefix)) return blocked("SERVER_OWNED_REPLAY_RECORD_INVALID");

    return {
      version: "SHADOW_SERVER_OWNED_REPLAY_RECOVERY_RESOLVER_V1",
      decision: "FOUND",
      persistence: {
        journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1",
        journalDecision: "REUSE_IDENTICAL",
        stableReplayKey: row.stable_replay_key,
        snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1",
        harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1",
        actionState: row.action_state.trim(),
        finalTarget: row.final_target.trim(),
        resultFingerprint: row.result_fingerprint.trim(),
        authorizesOrder: false,
        brokerOrderAllowed: false,
        placesOrder: false,
        shadowOnly: true,
        failClosed: true,
      },
      reasonCodes: ["SERVER_OWNED_DURABLE_REPLAY_RESOLVED"],
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return blocked("SERVER_OWNED_REPLAY_RESOLUTION_FAILED");
  }
}
