import { verifyShadowReplayPersistence } from "./shadow-replay-persistence.js";

export interface ShadowReplayDurableRecord {
  stableReplayKey: string;
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
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function blocked(reasonCodes: string[], stableReplayKey: string | null = null): ShadowReplayPersistenceAdapterResult {
  return {
    version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
    decision: "BLOCK",
    persistenceConfirmed: false,
    reusableAfterRestart: false,
    stableReplayKey,
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

  if (typeof input?.stableReplayKey !== "string" || input.stableReplayKey.trim().length === 0 || typeof input?.resultFingerprint !== "string" || input.resultFingerprint.trim().length === 0) {
    return blocked(["INVALID_REPLAY_PERSISTENCE_IDENTITY"], input?.stableReplayKey ?? null);
  }

  let writeAttempted = false;
  let writeSucceeded = false;
  let readBackFound = false;
  let readBackReplayKey: string | null = null;
  let readBackResultFingerprint: string | null = null;

  try {
    if (input.journalDecision === "RECORD_NEW") {
      writeAttempted = true;
      await store.write({
        stableReplayKey: input.stableReplayKey,
        resultFingerprint: input.resultFingerprint,
      });
      writeSucceeded = true;
    }

    const readBack = await store.read(input.stableReplayKey);
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

  return {
    version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
    decision: verified.decision,
    persistenceConfirmed: verified.persistenceConfirmed,
    reusableAfterRestart: verified.reusableAfterRestart,
    stableReplayKey: input.stableReplayKey,
    reasonCodes: verified.reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
