export type ReplayJournalDecision = "RECORD_NEW" | "REUSE_IDENTICAL" | "BLOCK_CONFLICT" | "BLOCK_INVALID";

export interface ShadowExecutionReplayJournalInput {
  executionId: string;
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1";
  contractKey: string;
  actionState: string;
  finalTarget: string;
  resultFingerprint: string;
  previous?: {
    executionId: string;
    snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
    harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1";
    contractKey: string;
    actionState: string;
    finalTarget: string;
    resultFingerprint: string;
  } | null;
}

export interface ShadowExecutionReplayJournalResult {
  version: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1";
  decision: ReplayJournalDecision;
  stableReplayKey: string | null;
  durableRecordRequired: boolean;
  reuseExistingRecord: boolean;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function valid(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// stableReplayKey is SHADOW_EXEC:<executionId>:<contractKey>. contractKey is
// intentionally colon-delimited (for example NIFTY:CE:25000:2026-09-03), so
// executionId must never contain ':' or the identity boundary becomes
// ambiguous. Reject rather than escape to preserve existing durable keys.
function validExecutionId(v: unknown): v is string {
  return valid(v) && !v.trim().includes(":");
}

function result(
  decision: ReplayJournalDecision,
  reasonCodes: string[],
  stableReplayKey: string | null = null,
  durableRecordRequired = false,
  reuseExistingRecord = false,
): ShadowExecutionReplayJournalResult {
  return {
    version: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1",
    decision,
    stableReplayKey,
    durableRecordRequired,
    reuseExistingRecord,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function evaluateShadowExecutionReplayJournal(
  input: ShadowExecutionReplayJournalInput,
): ShadowExecutionReplayJournalResult {
  const reasons: string[] = [];
  if (!validExecutionId(input?.executionId)) reasons.push("INVALID_EXECUTION_ID");
  if (input?.snapshotVersion !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1") reasons.push("INVALID_SNAPSHOT_VERSION");
  if (input?.harnessVersion !== "SHADOW_EXECUTION_E2E_HARNESS_V1") reasons.push("INVALID_HARNESS_VERSION");
  if (!valid(input?.contractKey)) reasons.push("INVALID_CONTRACT_KEY");
  if (!valid(input?.actionState)) reasons.push("INVALID_ACTION_STATE");
  if (!valid(input?.finalTarget)) reasons.push("INVALID_FINAL_TARGET");
  if (!valid(input?.resultFingerprint)) reasons.push("INVALID_RESULT_FINGERPRINT");
  if (reasons.length) return result("BLOCK_INVALID", reasons);

  const stableReplayKey = ["SHADOW_EXEC", input.executionId.trim(), input.contractKey.trim()].join(":");
  const previous = input.previous;
  if (!previous) {
    return result("RECORD_NEW", ["NEW_REPLAY_RECORD_REQUIRED"], stableReplayKey, true, false);
  }

  if (
    !validExecutionId(previous.executionId) ||
    previous.snapshotVersion !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1" ||
    previous.harnessVersion !== "SHADOW_EXECUTION_E2E_HARNESS_V1" ||
    !valid(previous.contractKey) ||
    !valid(previous.actionState) ||
    !valid(previous.finalTarget) ||
    !valid(previous.resultFingerprint)
  ) {
    return result("BLOCK_INVALID", ["INVALID_PREVIOUS_REPLAY_RECORD"], stableReplayKey);
  }

  if (previous.executionId.trim() !== input.executionId.trim() || previous.contractKey.trim() !== input.contractKey.trim()) {
    return result("BLOCK_CONFLICT", ["REPLAY_IDENTITY_CONFLICT"], stableReplayKey);
  }

  if (
    previous.snapshotVersion !== input.snapshotVersion ||
    previous.harnessVersion !== input.harnessVersion ||
    previous.actionState.trim() !== input.actionState.trim() ||
    previous.finalTarget.trim() !== input.finalTarget.trim()
  ) {
    return result("BLOCK_CONFLICT", ["REPLAY_SEMANTIC_CONFLICT"], stableReplayKey);
  }

  if (previous.resultFingerprint.trim() !== input.resultFingerprint.trim()) {
    return result("BLOCK_CONFLICT", ["REPLAY_RESULT_CONFLICT"], stableReplayKey);
  }

  return result("REUSE_IDENTICAL", ["IDENTICAL_REPLAY_REUSED"], stableReplayKey, false, true);
}
