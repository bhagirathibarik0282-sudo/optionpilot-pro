import { dbInsert, dbLoadRecent } from "./db.js";
import {
  validateShadowContractIdentity,
  type ShadowContractIdentity,
} from "./live-shadow-market-binding.js";

export const PRE_TRADE_DECISION_DB_KIND = "PRE_TRADE_DECISION_V1" as const;

export type PreTradeQuantumStatus = "READY" | "FALLBACK";
export type PreTradeOverallDecision = "PASS" | "WATCH" | "BLOCK";
export type PreTradeConflictDecision = "NEW" | "REUSE" | "CONFLICT";

export interface PreTradeDecisionEvidenceInput {
  tradeId: string;
  candidateKey: string;
  idempotencyKey: string;
  contract: ShadowContractIdentity;
  candidateDecision: "SELECT" | "BLOCK";
  liquidityDecision: "ALLOW" | "BLOCK";
  riskDecision: "ALLOW" | "BLOCK";
  killSwitchDecision: "RUN" | "HALT_NEW_ENTRIES" | "EMERGENCY_EXIT_INTENT";
  idempotencyDecision: "ALLOW" | "BLOCK";
  orderBuildDecision: "BUILD" | "BLOCK";
  quantumStatus: PreTradeQuantumStatus;
  overallDecision: PreTradeOverallDecision;
  evaluatedAt: string;
}

export interface PreTradeDecisionEvidence extends PreTradeDecisionEvidenceInput {
  version: "PRE_TRADE_DECISION_V1";
  brokerOrderAllowed: false;
}

export interface PreTradeDecisionPersistenceEnvelope {
  version: "PRE_TRADE_DECISION_PERSISTENCE_V1";
  persistedAt: string;
  evidence: PreTradeDecisionEvidence;
  brokerOrderAllowed: false;
}

export interface PersistPreTradeDecisionResult {
  persisted: boolean;
  decision: "PERSISTED" | "REUSED" | "CONFLICT" | "INVALID" | "PERSISTENCE_UNCONFIRMED";
  reasonCodes: string[];
  evidence: PreTradeDecisionEvidence | null;
  brokerOrderAllowed: false;
}

const nonEmpty = (v: string): boolean => typeof v === "string" && v.trim().length > 0;
const validTs = (v: string): boolean => typeof v === "string" && Number.isFinite(Date.parse(v));
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && allowed.includes(value as T);

function normalizedToken(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value).trim();
}

function sameContract(a: ShadowContractIdentity, b: ShadowContractIdentity): boolean {
  return a.index === b.index &&
    a.optionType === b.optionType &&
    a.strike === b.strike &&
    a.expiry === b.expiry &&
    normalizedToken(a.instrumentToken) === normalizedToken(b.instrumentToken);
}

export function buildPreTradeDecisionEvidence(
  input: PreTradeDecisionEvidenceInput,
): PreTradeDecisionEvidence | null {
  if (!input || !nonEmpty(input.tradeId) || !nonEmpty(input.candidateKey) || !nonEmpty(input.idempotencyKey)) return null;
  if (!validateShadowContractIdentity(input.contract) || !validTs(input.evaluatedAt)) return null;
  if (!oneOf(input.candidateDecision, ["SELECT", "BLOCK"] as const)) return null;
  if (!oneOf(input.liquidityDecision, ["ALLOW", "BLOCK"] as const)) return null;
  if (!oneOf(input.riskDecision, ["ALLOW", "BLOCK"] as const)) return null;
  if (!oneOf(input.killSwitchDecision, ["RUN", "HALT_NEW_ENTRIES", "EMERGENCY_EXIT_INTENT"] as const)) return null;
  if (!oneOf(input.idempotencyDecision, ["ALLOW", "BLOCK"] as const)) return null;
  if (!oneOf(input.orderBuildDecision, ["BUILD", "BLOCK"] as const)) return null;
  if (!oneOf(input.quantumStatus, ["READY", "FALLBACK"] as const)) return null;
  if (!oneOf(input.overallDecision, ["PASS", "WATCH", "BLOCK"] as const)) return null;

  return {
    version: "PRE_TRADE_DECISION_V1",
    ...input,
    tradeId: input.tradeId.trim(),
    candidateKey: input.candidateKey.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    contract: {
      ...input.contract,
      instrumentToken: normalizedToken(input.contract.instrumentToken),
    },
    brokerOrderAllowed: false,
  };
}

export function validatePreTradeDecisionEvidence(record: PreTradeDecisionEvidence): boolean {
  if (!record || record.version !== "PRE_TRADE_DECISION_V1" || record.brokerOrderAllowed !== false) return false;
  return buildPreTradeDecisionEvidence(record) !== null;
}

function sameStableIdentity(a: PreTradeDecisionEvidence, b: PreTradeDecisionEvidence): boolean {
  return a.tradeId === b.tradeId &&
    a.candidateKey === b.candidateKey &&
    a.idempotencyKey === b.idempotencyKey;
}

function sameDecisionPayload(a: PreTradeDecisionEvidence, b: PreTradeDecisionEvidence): boolean {
  return sameStableIdentity(a, b) &&
    sameContract(a.contract, b.contract) &&
    a.candidateDecision === b.candidateDecision &&
    a.liquidityDecision === b.liquidityDecision &&
    a.riskDecision === b.riskDecision &&
    a.killSwitchDecision === b.killSwitchDecision &&
    a.idempotencyDecision === b.idempotencyDecision &&
    a.orderBuildDecision === b.orderBuildDecision &&
    a.quantumStatus === b.quantumStatus &&
    a.overallDecision === b.overallDecision;
}

export function classifyPreTradeDecisionConflict(
  incoming: PreTradeDecisionEvidence,
  existing: PreTradeDecisionEvidence | null,
): PreTradeConflictDecision {
  if (!existing) return "NEW";
  if (!sameStableIdentity(incoming, existing)) return "NEW";
  return sameDecisionPayload(incoming, existing) ? "REUSE" : "CONFLICT";
}

function isValidEnvelope(row: PreTradeDecisionPersistenceEnvelope | null | undefined): row is PreTradeDecisionPersistenceEnvelope {
  return !!row &&
    row.version === "PRE_TRADE_DECISION_PERSISTENCE_V1" &&
    row.brokerOrderAllowed === false &&
    validTs(row.persistedAt) &&
    validatePreTradeDecisionEvidence(row.evidence);
}

export async function loadRecentPreTradeDecisionEvidence(limit = 100): Promise<PreTradeDecisionPersistenceEnvelope[]> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) return [];
  const rows = await dbLoadRecent<PreTradeDecisionPersistenceEnvelope>(PRE_TRADE_DECISION_DB_KIND, limit);
  return rows.filter(isValidEnvelope);
}

export async function findPreTradeDecisionByIdentity(
  tradeId: string,
  idempotencyKey: string,
  candidateKey: string,
): Promise<PreTradeDecisionEvidence | null> {
  if (!nonEmpty(tradeId) || !nonEmpty(idempotencyKey) || !nonEmpty(candidateKey)) return null;
  const rows = await loadRecentPreTradeDecisionEvidence(250);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const e = rows[i].evidence;
    if (e.tradeId === tradeId.trim() && e.idempotencyKey === idempotencyKey.trim() && e.candidateKey === candidateKey.trim()) return e;
  }
  return null;
}

export async function persistPreTradeDecisionEvidence(
  input: PreTradeDecisionEvidenceInput | PreTradeDecisionEvidence,
  persistedAt = new Date().toISOString(),
): Promise<PersistPreTradeDecisionResult> {
  const evidence = buildPreTradeDecisionEvidence(input);
  if (!evidence || !validTs(persistedAt)) {
    return { persisted: false, decision: "INVALID", reasonCodes: ["INVALID_PRE_TRADE_EVIDENCE"], evidence: null, brokerOrderAllowed: false };
  }

  const existing = await findPreTradeDecisionByIdentity(evidence.tradeId, evidence.idempotencyKey, evidence.candidateKey);
  const conflict = classifyPreTradeDecisionConflict(evidence, existing);
  if (conflict === "CONFLICT") {
    return { persisted: false, decision: "CONFLICT", reasonCodes: ["CONFLICTING_PRE_TRADE_RECORD"], evidence: existing, brokerOrderAllowed: false };
  }
  if (conflict === "REUSE") {
    return { persisted: true, decision: "REUSED", reasonCodes: ["PRE_TRADE_EVIDENCE_REUSED"], evidence: existing, brokerOrderAllowed: false };
  }

  const envelope: PreTradeDecisionPersistenceEnvelope = {
    version: "PRE_TRADE_DECISION_PERSISTENCE_V1",
    persistedAt,
    evidence,
    brokerOrderAllowed: false,
  };

  await dbInsert(PRE_TRADE_DECISION_DB_KIND, envelope);

  const rows = await loadRecentPreTradeDecisionEvidence(100);
  const confirmed = rows.some((row) =>
    row.persistedAt === envelope.persistedAt &&
    sameDecisionPayload(row.evidence, evidence) &&
    row.evidence.evaluatedAt === evidence.evaluatedAt
  );

  return confirmed
    ? { persisted: true, decision: "PERSISTED", reasonCodes: ["PRE_TRADE_EVIDENCE_PERSISTED"], evidence, brokerOrderAllowed: false }
    : { persisted: false, decision: "PERSISTENCE_UNCONFIRMED", reasonCodes: ["PRE_TRADE_EVIDENCE_READBACK_FAILED"], evidence, brokerOrderAllowed: false };
}
