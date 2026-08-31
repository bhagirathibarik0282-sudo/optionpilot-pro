export type ShadowReplayPersistenceDecision = "PERSISTENCE_CONFIRMED" | "REUSE_CONFIRMED" | "BLOCK";

export interface ShadowReplayPersistenceInput {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1";
  journalDecision: "RECORD_NEW" | "REUSE_IDENTICAL" | "BLOCK_CONFLICT" | "BLOCK_INVALID";
  stableReplayKey: string | null;
  resultFingerprint: string;
  writeAttempted: boolean;
  writeSucceeded: boolean;
  readBackFound: boolean;
  readBackReplayKey: string | null;
  readBackResultFingerprint: string | null;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowReplayPersistenceResult {
  version: "SHADOW_REPLAY_PERSISTENCE_V1";
  decision: ShadowReplayPersistenceDecision;
  persistenceConfirmed: boolean;
  reusableAfterRestart: boolean;
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

function out(decision: ShadowReplayPersistenceDecision, reasons: string[], confirmed = false, reusable = false): ShadowReplayPersistenceResult {
  return {
    version: "SHADOW_REPLAY_PERSISTENCE_V1",
    decision,
    persistenceConfirmed: confirmed,
    reusableAfterRestart: reusable,
    reasonCodes: reasons,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function verifyShadowReplayPersistence(input: ShadowReplayPersistenceInput): ShadowReplayPersistenceResult {
  const reasons: string[] = [];
  if (input?.journalVersion !== "SHADOW_EXECUTION_REPLAY_JOURNAL_V1") reasons.push("INVALID_JOURNAL_VERSION");
  if (!["RECORD_NEW", "REUSE_IDENTICAL", "BLOCK_CONFLICT", "BLOCK_INVALID"].includes(input?.journalDecision)) reasons.push("INVALID_JOURNAL_DECISION");
  if (!valid(input?.resultFingerprint)) reasons.push("INVALID_RESULT_FINGERPRINT");
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");
  if (reasons.length) return out("BLOCK", reasons);

  if (input.journalDecision === "BLOCK_CONFLICT" || input.journalDecision === "BLOCK_INVALID") {
    return out("BLOCK", ["UPSTREAM_REPLAY_JOURNAL_BLOCKED"]);
  }

  if (!valid(input.stableReplayKey)) return out("BLOCK", ["MISSING_STABLE_REPLAY_KEY"]);

  if (input.journalDecision === "RECORD_NEW") {
    if (!input.writeAttempted) return out("BLOCK", ["DURABLE_WRITE_NOT_ATTEMPTED"]);
    if (!input.writeSucceeded) return out("BLOCK", ["DURABLE_WRITE_FAILED"]);
  }

  if (!input.readBackFound) return out("BLOCK", ["DURABLE_READ_BACK_MISSING"]);
  if (!valid(input.readBackReplayKey) || input.readBackReplayKey.trim() !== input.stableReplayKey.trim()) {
    return out("BLOCK", ["DURABLE_READ_BACK_KEY_MISMATCH"]);
  }
  if (!valid(input.readBackResultFingerprint) || input.readBackResultFingerprint.trim() !== input.resultFingerprint.trim()) {
    return out("BLOCK", ["DURABLE_READ_BACK_FINGERPRINT_MISMATCH"]);
  }

  if (input.journalDecision === "REUSE_IDENTICAL") {
    return out("REUSE_CONFIRMED", ["IDENTICAL_DURABLE_REPLAY_CONFIRMED"], true, true);
  }

  return out("PERSISTENCE_CONFIRMED", ["DURABLE_REPLAY_WRITE_READ_BACK_CONFIRMED"], true, true);
}
