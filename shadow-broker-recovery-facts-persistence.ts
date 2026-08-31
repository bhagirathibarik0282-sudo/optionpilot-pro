import { dbInsert, dbLoadRecent } from "./db.js";
import type { ShadowBrokerState } from "./shadow-broker-submission-state.js";
import type { ShadowBrokerStateRecoveryGuardInput } from "./shadow-broker-state-recovery-guard.js";

export const SHADOW_BROKER_RECOVERY_FACTS_DB_KIND = "SHADOW_BROKER_RECOVERY_FACTS_V1" as const;
const HISTORY_LIMIT = 1000;

export interface ShadowBrokerRecoveryFactsEnvelope {
  version: "SHADOW_BROKER_RECOVERY_FACTS_PERSISTENCE_V1";
  executionId: string;
  persistedAt: string;
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1";
  state: ShadowBrokerState;
  filledQuantity: number;
  totalQuantity: number;
  cancelled: boolean;
  exactContractBound: true;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowBrokerRecoveryFactsIo {
  insert(kind: string, payload: unknown): Promise<void>;
  loadRecent<T>(kind: string, limit: number): Promise<T[]>;
}

const defaultIo: ShadowBrokerRecoveryFactsIo = { insert: dbInsert, loadRecent: dbLoadRecent };

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validState(value: unknown): value is ShadowBrokerState {
  return typeof value === "string" && [
    "BLOCKED","AUTHORIZED","SUBMISSION_SIMULATED","ACKNOWLEDGED","REJECTED","PARTIALLY_FILLED","FILLED","CANCELLED",
  ].includes(value);
}

function validEnvelope(row: unknown): row is ShadowBrokerRecoveryFactsEnvelope {
  if (!row || typeof row !== "object") return false;
  const value = row as ShadowBrokerRecoveryFactsEnvelope;
  return value.version === "SHADOW_BROKER_RECOVERY_FACTS_PERSISTENCE_V1" &&
    typeof value.executionId === "string" && value.executionId.trim().length > 0 &&
    validTimestamp(value.persistedAt) &&
    value.stateVersion === "SHADOW_BROKER_SUBMISSION_STATE_V1" &&
    validState(value.state) &&
    Number.isInteger(value.filledQuantity) && value.filledQuantity >= 0 &&
    Number.isInteger(value.totalQuantity) && value.totalQuantity > 0 &&
    value.filledQuantity <= value.totalQuantity &&
    typeof value.cancelled === "boolean" &&
    value.exactContractBound === true &&
    value.authorizesOrder === false && value.brokerOrderAllowed === false && value.placesOrder === false &&
    value.shadowOnly === true && value.failClosed === true;
}

function claimsExecutionId(row: unknown, executionId: string): boolean {
  if (!row || typeof row !== "object") return false;
  const candidate = row as { executionId?: unknown };
  return typeof candidate.executionId === "string" && candidate.executionId.trim() === executionId;
}

function sameFacts(left: ShadowBrokerRecoveryFactsEnvelope, right: ShadowBrokerRecoveryFactsEnvelope): boolean {
  return left.stateVersion === right.stateVersion && left.state === right.state &&
    left.filledQuantity === right.filledQuantity && left.totalQuantity === right.totalQuantity &&
    left.cancelled === right.cancelled && left.exactContractBound === right.exactContractBound;
}

export function buildShadowBrokerRecoveryFactsEnvelope(
  executionId: string,
  facts: Omit<ShadowBrokerStateRecoveryGuardInput, "stateFactsFresh" | "authorizesOrder" | "brokerOrderAllowed" | "placesOrder" | "shadowOnly" | "failClosed">,
  persistedAt = new Date().toISOString(),
): ShadowBrokerRecoveryFactsEnvelope | null {
  if (typeof executionId !== "string" || !executionId.trim() || !validTimestamp(persistedAt)) return null;
  const envelope: ShadowBrokerRecoveryFactsEnvelope = {
    version: "SHADOW_BROKER_RECOVERY_FACTS_PERSISTENCE_V1",
    executionId: executionId.trim(),
    persistedAt,
    stateVersion: facts.stateVersion,
    state: facts.state,
    filledQuantity: facts.filledQuantity,
    totalQuantity: facts.totalQuantity,
    cancelled: facts.cancelled,
    exactContractBound: facts.exactContractBound,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
  return validEnvelope(envelope) ? envelope : null;
}

export async function persistShadowBrokerRecoveryFacts(
  executionId: string,
  facts: Omit<ShadowBrokerStateRecoveryGuardInput, "stateFactsFresh" | "authorizesOrder" | "brokerOrderAllowed" | "placesOrder" | "shadowOnly" | "failClosed">,
  persistedAt = new Date().toISOString(),
  io: ShadowBrokerRecoveryFactsIo = defaultIo,
): Promise<boolean> {
  const envelope = buildShadowBrokerRecoveryFactsEnvelope(executionId, facts, persistedAt);
  if (!envelope || !io || typeof io.insert !== "function" || typeof io.loadRecent !== "function") return false;
  try {
    const before = await io.loadRecent<ShadowBrokerRecoveryFactsEnvelope>(SHADOW_BROKER_RECOVERY_FACTS_DB_KIND, HISTORY_LIMIT);
    if (!Array.isArray(before) || before.length >= HISTORY_LIMIT) return false;
    if (before.some((row) => claimsExecutionId(row, envelope.executionId) && !validEnvelope(row))) return false;
    const existing = before.filter((row) => validEnvelope(row) && row.executionId === envelope.executionId);
    if (existing.some((row) => !sameFacts(row, envelope))) return false;
    if (existing.some((row) => sameFacts(row, envelope))) return true;

    await io.insert(SHADOW_BROKER_RECOVERY_FACTS_DB_KIND, envelope);
    const after = await io.loadRecent<ShadowBrokerRecoveryFactsEnvelope>(SHADOW_BROKER_RECOVERY_FACTS_DB_KIND, HISTORY_LIMIT);
    if (!Array.isArray(after) || after.length >= HISTORY_LIMIT) return false;
    if (after.some((row) => claimsExecutionId(row, envelope.executionId) && !validEnvelope(row))) return false;
    const matches = after.filter((row) => validEnvelope(row) && row.executionId === envelope.executionId);
    if (matches.some((row) => !sameFacts(row, envelope))) return false;
    return matches.some((row) => row.persistedAt === envelope.persistedAt && sameFacts(row, envelope));
  } catch {
    return false;
  }
}

export async function loadShadowBrokerRecoveryFacts(
  executionId: string,
  nowIso = new Date().toISOString(),
  maxAgeMs = 5 * 60 * 1000,
  io: ShadowBrokerRecoveryFactsIo = defaultIo,
): Promise<ShadowBrokerStateRecoveryGuardInput | null> {
  if (typeof executionId !== "string" || !executionId.trim() || !validTimestamp(nowIso) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return null;
  try {
    const rows = await io.loadRecent<ShadowBrokerRecoveryFactsEnvelope>(SHADOW_BROKER_RECOVERY_FACTS_DB_KIND, HISTORY_LIMIT);
    if (!Array.isArray(rows) || rows.length >= HISTORY_LIMIT) return null;
    const normalized = executionId.trim();
    if (rows.some((row) => claimsExecutionId(row, normalized) && !validEnvelope(row))) return null;
    const matches = rows.filter((row) => validEnvelope(row) && row.executionId === normalized);
    if (matches.length === 0) return null;
    const reference = matches[0];
    if (matches.some((row) => !sameFacts(row, reference))) return null;
    matches.sort((a, b) => Date.parse(b.persistedAt) - Date.parse(a.persistedAt));
    const latest = matches[0];
    const ageMs = Date.parse(nowIso) - Date.parse(latest.persistedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return null;
    return {
      stateVersion: latest.stateVersion,
      state: latest.state,
      stateFactsFresh: ageMs <= maxAgeMs,
      filledQuantity: latest.filledQuantity,
      totalQuantity: latest.totalQuantity,
      cancelled: latest.cancelled,
      exactContractBound: latest.exactContractBound,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return null;
  }
}
