import { deriveEvidenceFamilies } from "./evidence-family-engine.js";
import { deriveFamilyStateFusion } from "./family-state-fusion.js";
import { persistH1DerivedState } from "./h1-derived-db.js";
import type { DerivedHistoryState, EvidenceFamilyState, EvidenceQuality, TradeMode } from "./h1-derived-history.js";

export interface H1IntelligenceBridgeRequest {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  observedAt: string;
  snapshotId: string | null;
  mode: TradeMode;
  regime?: DerivedHistoryState["regime"];
  maturity?: DerivedHistoryState["maturity"];
  candidateAgeMinutes?: number | null;
  noChase?: boolean;
  overextended?: boolean;
  multiHorizonAlignment?: DerivedHistoryState["multiHorizonAlignment"];
  regimeSurvivalCount?: number;
  premiumPair?: DerivedHistoryState["premiumPair"];
  fiiDiiContext?: DerivedHistoryState["fiiDiiContext"];
  additionalReasonCodes?: string[];
}

function mapFamilyState(state: string): EvidenceFamilyState["state"] {
  if (state === "SUPPORTIVE") return "SUPPORTIVE";
  if (state === "CONFLICTING" || state === "WARNING") return "CONTRADICTORY";
  if (state === "NEUTRAL") return "NEUTRAL";
  return "UNAVAILABLE";
}

function evidenceQuality(available: number, conflicts: number, warnings: number): EvidenceQuality {
  if (available <= 0) return "INSUFFICIENT";
  if (conflicts > 0) return "LOW";
  if (warnings > 0) return "MEDIUM";
  return available >= 5 ? "HIGH" : "MEDIUM";
}

function directionFromFusion(bias: string): DerivedHistoryState["direction"] {
  if (bias === "BULLISH") return "BULLISH";
  if (bias === "BEARISH") return "BEARISH";
  if (bias === "MIXED") return "CONFLICTING";
  return "NEUTRAL";
}

function completeness(available: number, expected: number): number | null {
  if (!Number.isFinite(available) || !Number.isFinite(expected) || expected <= 0) return null;
  return Math.max(0, Math.min(100, (available / expected) * 100));
}

/**
 * Historical-only intelligence bridge.
 *
 * It persists already-existing COMB/evidence-family/fusion outputs into H1 derived history.
 * It does NOT create a live verdict, candidate, Telegram message, execution state or score.
 */
export async function persistH1IntelligenceSnapshot(request: H1IntelligenceBridgeRequest): Promise<boolean> {
  try {
    const [families, fusion] = await Promise.all([
      deriveEvidenceFamilies(request.symbol),
      deriveFamilyStateFusion(request.symbol),
    ]);

    const familyRows: EvidenceFamilyState[] = families.families.map((family) => ({
      familyId: family.id,
      state: mapFamilyState(family.state),
      strength: null,
      quality: family.state === "UNAVAILABLE" ? "INSUFFICIENT" : family.state === "CONFLICTING" ? "LOW" : family.state === "WARNING" ? "MEDIUM" : "HIGH",
      reasonCodes: family.reasons.slice(0, 6),
    }));

    const quality = evidenceQuality(
      families.availableFamilyCount,
      families.conflictFamilyCount,
      families.warningFamilyCount,
    );

    const reasonCodes = [
      `FUSION_STATE:${fusion.state}`,
      `FUSION_BIAS:${fusion.bias}`,
      ...fusion.reasons.map((r) => `FUSION:${r}`),
      ...(request.additionalReasonCodes ?? []),
    ];

    const row: DerivedHistoryState = {
      symbol: request.symbol,
      observedAt: request.observedAt,
      snapshotId: request.snapshotId,
      mode: request.mode,
      direction: directionFromFusion(fusion.bias),
      regime: request.regime ?? "TRANSITION",
      maturity: request.maturity ?? "UNKNOWN",
      evidenceQuality: quality,
      evidenceCompletenessPct: completeness(families.availableFamilyCount, families.families.length),
      conflictCount: families.conflictFamilyCount + families.warningFamilyCount,
      candidateAgeMinutes: request.candidateAgeMinutes ?? null,
      noChase: request.noChase ?? false,
      overextended: request.overextended ?? false,
      multiHorizonAlignment: request.multiHorizonAlignment ?? "UNAVAILABLE",
      regimeSurvivalCount: request.regimeSurvivalCount ?? 0,
      premiumPair: request.premiumPair ?? null,
      evidenceFamilies: familyRows,
      fiiDiiContext: request.fiiDiiContext ?? "UNAVAILABLE",
      reasonCodes,
      ruleVersion: `H1_INTELLIGENCE_BRIDGE_V1|${families.ruleVersion}|${fusion.ruleVersion}`,
    };

    return await persistH1DerivedState(row);
  } catch {
    return false;
  }
}
