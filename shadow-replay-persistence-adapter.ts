import { verifyShadowReplayPersistence } from "./shadow-replay-persistence.js";

export interface ShadowReplayDurableRecord {
  stableReplayKey: string;
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1";
  actionState: string;
  finalTarget: string;
  resultFingerprint: string;
}

export interface ShadowReplayDurableStore {
  write(record: ShadowReplayDurableRecord): Promise<void>;
  read(stableReplayKey: string): Promise<ShadowReplayDurableRecord | null>;
}

export interface ShadowReplayPersistenceAdapterInput {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1";
  journalDecision: "RECORD_NEW" | "REUSE_IDENTICAL" | "BLOCK_CONFLICT" | "BLOCK_INVALID";
  stableReplayKey: string | null;
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1";
  actionState: string;
  finalTarget: string;
  resultFingerprint: string;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowReplayPersistenceAdapterResult {
  version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1";
  decision: "PERSISTENCE_CONFIRMED" | "REUSE_CONFIRMED" | "BLOCK";
  persistenceConfirmed: boolean;
  reusableAfterRestart: boolean;
  stableReplayKey: string | null;
  semanticReadBackConfirmed: boolean;
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

function blocked(reasonCodes: string[], stableReplayKey: string | null = null): ShadowReplayPersistenceAdapterResult {
  return {
    version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
    decision: "BLOCK",
    persistenceConfirmed: false,
    reusableAfterRestart: false,
    stableReplayKey,
    semanticReadBackConfirmed: false,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function persistShadowReplayThroughAdapter(
  input: ShadowReplayPersistenceAdapterInput,
  store: ShadowReplayDurableStore,
): Promise<ShadowReplayPersistenceAdapterResult> {
  if (!store || typeof store.write !== "function" || typeof store.read !== "function") {
    return blocked(["INVALID_DURABLE_STORE"]);
  }

  if (input?.authorizesOrder !== false || input?.brokerOrderAllowed !== false || input?.placesOrder !== false || input?.shadowOnly !== true || input?.failClosed !== true) {
    return blocked(["ORDER_OR_SHADOW_INVARIANT_VIOLATED"], input?.stableReplayKey ?? null);
  }

  if (input?.journalDecision === "BLOCK_CONFLICT" || input?.journalDecision === "BLOCK_INVALID") {
    return blocked(["UPSTREAM_REPLAY_JOURNAL_BLOCKED"], input?.stableReplayKey ?? null);
  }

  if (input?.journalVersion !== "SHADOW_EXECUTION_REPLAY_JOURNAL_V1") {
    return blocked(["INVALID_JOURNAL_VERSION"], input?.stableReplayKey ?? null);
  }

  if (
    !valid(input?.stableReplayKey) ||
    input?.snapshotVersion !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1" ||
    input?.harnessVersion !== "SHADOW_EXECUTION_E2E_HARNESS_V1" ||
    !valid(input?.actionState) ||
    !valid(input?.finalTarget) ||
    !valid(input?.resultFingerprint)
  ) {
    return blocked(["INVALID_REPLAY_PERSISTENCE_SEMANTICS"], input?.stableReplayKey ?? null);
  }

  let writeAttempted = false;
  let writeSucceeded = false;
  let readBackFound = false;
  let readBackReplayKey: string | null = null;
  let readBackResultFingerprint: string | null = null;
  let readBack: ShadowReplayDurableRecord | null = null;

  try {
    if (input.journalDecision === "RECORD_NEW") {
      writeAttempted = true;
      await store.write({
        stableReplayKey: input.stableReplayKey,
        snapshotVersion: input.snapshotVersion,
        harnessVersion: input.harnessVersion,
        actionState: input.actionState,
        finalTarget: input.finalTarget,
        resultFingerprint: input.resultFingerprint,
      });
      writeSucceeded = true;
    }

    readBack = await store.read(input.stableReplayKey);
    if (readBack) {
      readBackFound = true;
      readBackReplayKey = readBack.stableReplayKey;
      readBackResultFingerprint = readBack.resultFingerprint;
    }
  } catch {
    return blocked(["DURABLE_STORE_OPERATION_FAILED"], input.stableReplayKey);
  }

  const verified = verifyShadowReplayPersistence({
    journalVersion: input.journalVersion,
    journalDecision: input.journalDecision,
    stableReplayKey: input.stableReplayKey,
    resultFingerprint: input.resultFingerprint,
    writeAttempted,
    writeSucceeded,
    readBackFound,
    readBackReplayKey,
    readBackResultFingerprint,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  });

  if (verified.decision === "BLOCK" || !readBack) {
    return {
      version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
      decision: "BLOCK",
      persistenceConfirmed: false,
      reusableAfterRestart: false,
      stableReplayKey: input.stableReplayKey,
      semanticReadBackConfirmed: false,
      reasonCodes: verified.reasonCodes,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  }

  if (
    readBack.snapshotVersion !== input.snapshotVersion ||
    readBack.harnessVersion !== input.harnessVersion ||
    !valid(readBack.actionState) || readBack.actionState.trim() !== input.actionState.trim() ||
    !valid(readBack.finalTarget) || readBack.finalTarget.trim() !== input.finalTarget.trim()
  ) {
    return blocked(["DURABLE_READ_BACK_SEMANTIC_MISMATCH"], input.stableReplayKey);
  }

  return {
    version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
    decision: verified.decision,
    persistenceConfirmed: verified.persistenceConfirmed,
    reusableAfterRestart: verified.reusableAfterRestart,
    stableReplayKey: input.stableReplayKey,
    semanticReadBackConfirmed: true,
    reasonCodes: [...verified.reasonCodes, "DURABLE_REPLAY_SEMANTICS_CONFIRMED"],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
