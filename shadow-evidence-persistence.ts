import { dbInsert, dbLoadRecent } from "./db.js";
import type { ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";

export const SHADOW_EVIDENCE_DB_KIND = "SHADOW_TRADE_EVIDENCE_V1" as const;

export interface ShadowEvidencePersistenceEnvelope {
  version: "SHADOW_EVIDENCE_PERSISTENCE_V1";
  persistedAt: string;
  tradeId: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  closed: boolean;
  evidence: ShadowTradeEvidence;
  brokerOrderAllowed: false;
}

function validTs(v: string): boolean {
  return typeof v === "string" && Number.isFinite(Date.parse(v));
}

export function buildShadowEvidencePersistenceEnvelope(
  evidence: ShadowTradeEvidence,
  persistedAt: string,
): ShadowEvidencePersistenceEnvelope | null {
  if (!evidence || evidence.version !== "SHADOW_TRADE_EVIDENCE_V1") return null;
  if (!evidence.tradeId?.trim() || !validTs(persistedAt)) return null;
  if (evidence.brokerOrderAllowed !== false) return null;
  if (!Array.isArray(evidence.events) || evidence.events.length < 1) return null;
  if (evidence.events.some((e) => e.tradeId !== evidence.tradeId || e.index !== evidence.index || e.brokerOrderAllowed !== false || !validTs(e.ts))) return null;

  return {
    version: "SHADOW_EVIDENCE_PERSISTENCE_V1",
    persistedAt,
    tradeId: evidence.tradeId,
    index: evidence.index,
    closed: evidence.closed,
    evidence,
    brokerOrderAllowed: false,
  };
}

function isValidEnvelope(row: ShadowEvidencePersistenceEnvelope | null | undefined): row is ShadowEvidencePersistenceEnvelope {
  return !!row &&
    row.version === "SHADOW_EVIDENCE_PERSISTENCE_V1" &&
    row.brokerOrderAllowed === false &&
    !!row.tradeId?.trim() &&
    validTs(row.persistedAt) &&
    row.evidence?.version === "SHADOW_TRADE_EVIDENCE_V1" &&
    row.evidence.tradeId === row.tradeId &&
    row.evidence.index === row.index &&
    row.evidence.brokerOrderAllowed === false;
}

export async function persistShadowTradeEvidence(
  evidence: ShadowTradeEvidence,
  persistedAt = new Date().toISOString(),
): Promise<boolean> {
  const envelope = buildShadowEvidencePersistenceEnvelope(evidence, persistedAt);
  if (!envelope) return false;

  await dbInsert(SHADOW_EVIDENCE_DB_KIND, envelope);

  // dbInsert intentionally swallows DB failures to protect the running app. Therefore a write
  // attempt is NOT treated as durable success until the exact envelope can be read back.
  const rows = await dbLoadRecent<ShadowEvidencePersistenceEnvelope>(SHADOW_EVIDENCE_DB_KIND, 50);
  return rows.some((row) =>
    isValidEnvelope(row) &&
    row.tradeId === envelope.tradeId &&
    row.persistedAt === envelope.persistedAt &&
    row.evidence.events.length === envelope.evidence.events.length &&
    row.evidence.lastPremium === envelope.evidence.lastPremium &&
    row.evidence.remainingQty === envelope.evidence.remainingQty
  );
}

export async function loadRecentShadowTradeEvidence(limit = 100): Promise<ShadowEvidencePersistenceEnvelope[]> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) return [];
  const rows = await dbLoadRecent<ShadowEvidencePersistenceEnvelope>(SHADOW_EVIDENCE_DB_KIND, limit);
  return rows.filter(isValidEnvelope);
}
