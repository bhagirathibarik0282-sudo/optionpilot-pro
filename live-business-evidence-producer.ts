import { scoreToStars, type BusinessHorizon, type BusinessHorizonInput } from "./business-buyer-seller-layer.js";

export const LIVE_BUSINESS_EVIDENCE_PRODUCER_VERSION = "LIVE_BUSINESS_EVIDENCE_PRODUCER_V1" as const;

export type LiveBusinessEvidenceFamily =
  | "PRICE_STRUCTURE"
  | "FUTURES_CONFIRMATION"
  | "PREMIUM_RESPONSE"
  | "OI_POSITIONING"
  | "MULTI_DTE"
  | "VOLATILITY"
  | "CROSS_INDEX_BREADTH"
  | "RESPONSE_LADDER"
  | "LIQUIDITY_EXECUTABILITY";

export interface VerifiedLiveBusinessFact {
  provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1";
  horizon: BusinessHorizon;
  family: LiveBusinessEvidenceFamily;
  buyerSupport: number;
  sellerSupport: number;
  ready: boolean;
  observedAtMs: number;
  source: string;
  devilFlags?: string[];
  reasons?: string[];
}

export interface LiveBusinessEvidenceProducerInput {
  provenance: "LIVE_BUSINESS_FACT_VERIFIED_V1";
  asOfMs: number;
  telegramHorizon: BusinessHorizon;
  facts: VerifiedLiveBusinessFact[];
  maxAgeMs?: number;
}

export interface ProducedVerifiedLiveBusinessInputs {
  provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1";
  observedAtMs: number;
  telegramQualityStars: number;
  telegramHorizon: BusinessHorizon;
  horizons: BusinessHorizonInput[];
  devilFlags: string[];
}

export interface LiveBusinessEvidenceProducerResult {
  version: typeof LIVE_BUSINESS_EVIDENCE_PRODUCER_VERSION;
  ready: boolean;
  business: ProducedVerifiedLiveBusinessInputs | null;
  blockers: string[];
  failClosed: true;
  equalWeightPolicy: true;
  affectsExecution: false;
  aiMayOverride: false;
}

const HORIZONS: BusinessHorizon[] = ["INTRADAY", "MULTIDAY", "EXPIRY"];
const FAMILIES: LiveBusinessEvidenceFamily[] = [
  "PRICE_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "PREMIUM_RESPONSE",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "CROSS_INDEX_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

function boundedScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function mean(values: number[]): number | null {
  if (values.length === 0 || values.some((v) => !boundedScore(v))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function produceVerifiedLiveBusinessEvidence(input: LiveBusinessEvidenceProducerInput): LiveBusinessEvidenceProducerResult {
  const blockers: string[] = [];
  const base = {
    version: LIVE_BUSINESS_EVIDENCE_PRODUCER_VERSION,
    failClosed: true as const,
    equalWeightPolicy: true as const,
    affectsExecution: false as const,
    aiMayOverride: false as const,
  };

  if (!input || input.provenance !== "LIVE_BUSINESS_FACT_VERIFIED_V1") {
    return { ...base, ready: false, business: null, blockers: ["INVALID_LIVE_BUSINESS_FACT_PROVENANCE"] };
  }
  if (!Number.isFinite(input.asOfMs) || input.asOfMs <= 0) {
    return { ...base, ready: false, business: null, blockers: ["INVALID_ASOF_TIMESTAMP"] };
  }
  if (!HORIZONS.includes(input.telegramHorizon)) {
    return { ...base, ready: false, business: null, blockers: ["INVALID_TELEGRAM_HORIZON"] };
  }
  if (!Array.isArray(input.facts)) {
    return { ...base, ready: false, business: null, blockers: ["FACTS_ARRAY_REQUIRED"] };
  }

  const maxAgeMs = Number.isFinite(input.maxAgeMs) && (input.maxAgeMs ?? 0) > 0 ? input.maxAgeMs! : 90_000;
  const horizons: BusinessHorizonInput[] = [];
  const aggregateDevilFlags: string[] = [];

  for (const horizon of HORIZONS) {
    const rows = input.facts.filter((fact) => fact?.horizon === horizon);
    const seen = new Set<LiveBusinessEvidenceFamily>();
    const buyer: number[] = [];
    const seller: number[] = [];
    const reasons: string[] = [];
    const horizonDevilFlags: string[] = [];
    let evidenceReady = true;

    for (const family of FAMILIES) {
      const matches = rows.filter((row) => row.family === family);
      if (matches.length !== 1) {
        blockers.push(`${horizon}:${family}:${matches.length === 0 ? "MISSING" : "DUPLICATE"}`);
        evidenceReady = false;
        continue;
      }
      const row = matches[0];
      seen.add(family);
      if (row.provenance !== "LIVE_BUSINESS_FACT_VERIFIED_V1") {
        blockers.push(`${horizon}:${family}:INVALID_PROVENANCE`);
        evidenceReady = false;
      }
      if (!row.ready) {
        blockers.push(`${horizon}:${family}:NOT_READY`);
        evidenceReady = false;
      }
      if (!Number.isFinite(row.observedAtMs) || row.observedAtMs <= 0) {
        blockers.push(`${horizon}:${family}:INVALID_TIMESTAMP`);
        evidenceReady = false;
      } else {
        const age = input.asOfMs - row.observedAtMs;
        if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) {
          blockers.push(`${horizon}:${family}:STALE_OR_FUTURE`);
          evidenceReady = false;
        }
      }
      if (!boundedScore(row.buyerSupport) || !boundedScore(row.sellerSupport)) {
        blockers.push(`${horizon}:${family}:INVALID_SUPPORT_SCORE`);
        evidenceReady = false;
      } else {
        buyer.push(row.buyerSupport);
        seller.push(row.sellerSupport);
      }
      if (typeof row.source !== "string" || !row.source.trim()) {
        blockers.push(`${horizon}:${family}:SOURCE_REQUIRED`);
        evidenceReady = false;
      }
      horizonDevilFlags.push(...(row.devilFlags ?? []));
      reasons.push(...(row.reasons ?? []));
    }

    const unexpected = rows.filter((row) => !FAMILIES.includes(row.family));
    if (unexpected.length > 0) {
      blockers.push(`${horizon}:UNSUPPORTED_FAMILY`);
      evidenceReady = false;
    }

    const buyerScore = evidenceReady ? mean(buyer) : null;
    const sellerScore = evidenceReady ? mean(seller) : null;
    const devilFlags = unique(horizonDevilFlags);
    aggregateDevilFlags.push(...devilFlags);

    horizons.push({
      horizon,
      buyerScore,
      sellerScore,
      evidenceReady: evidenceReady && buyerScore !== null && sellerScore !== null && devilFlags.length === 0,
      devilFlags,
      reasons: unique(reasons),
    });
  }

  const telegramView = horizons.find((h) => h.horizon === input.telegramHorizon) ?? null;
  if (!telegramView || !telegramView.evidenceReady || telegramView.buyerScore == null) {
    blockers.push("TELEGRAM_HORIZON_NOT_READY");
  }

  const uniqueBlockers = unique(blockers);
  if (uniqueBlockers.length > 0) {
    return { ...base, ready: false, business: null, blockers: uniqueBlockers };
  }

  return {
    ...base,
    ready: true,
    business: {
      provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1",
      observedAtMs: input.asOfMs,
      telegramQualityStars: scoreToStars(telegramView!.buyerScore),
      telegramHorizon: input.telegramHorizon,
      horizons,
      devilFlags: unique(aggregateDevilFlags),
    },
    blockers: [],
  };
}
