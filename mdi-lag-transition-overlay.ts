import type { LagTransitionSnapshot } from "./lag-transition-research.js";
import type { MdiBias, MdiResult } from "./mdi-research-shadow.js";

export type MdiLagDirection = "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
export type MdiLagAlignment = "ALIGNED" | "CONTRADICTING" | "NEUTRAL" | "UNAVAILABLE";

export interface MdiLagObservation {
  firstQualifiedAt: string | null;
  result: MdiResult;
}

export interface MdiLagOverlayInput {
  lag: LagTransitionSnapshot;
  mdi: MdiLagObservation;
}

export interface MdiLagOverlayResult {
  tradeDate: string;
  mdiFirstQualifiedAt: string | null;
  mdiLagFromHeavyweightT0Minutes: number | null;
  mdiLagFromNiftyMinutes: number | null;
  mdiLagFromPremiumMinutes: number | null;
  mdiDirection: MdiLagDirection;
  alignmentWithLagDirection: MdiLagAlignment;
  reasons: string[];
  ruleVersion: "MDI_LAG_OVERLAY_RESEARCH_V1";
  semantics: "RESEARCH_REPLAY_ONLY";
  affectsLagSequence: false;
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

function epochMs(v: string | null): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function lagMinutes(from: string | null, to: string | null): number | null {
  const a = epochMs(from);
  const b = epochMs(to);
  if (a == null || b == null) return null;
  return Math.round(((b - a) / 60000) * 10) / 10;
}

function mdiDirection(bias: MdiBias): MdiLagDirection {
  if (bias === "STRONG_BULLISH" || bias === "MILD_BULLISH") return "UP";
  if (bias === "STRONG_BEARISH" || bias === "MILD_BEARISH") return "DOWN";
  if (bias === "NEUTRAL") return "NEUTRAL";
  return "UNKNOWN";
}

function expectedBias(score: number): MdiBias {
  if (score >= 60) return "STRONG_BULLISH";
  if (score >= 25) return "MILD_BULLISH";
  if (score <= -60) return "STRONG_BEARISH";
  if (score <= -25) return "MILD_BEARISH";
  return "NEUTRAL";
}

function trustedMdiResult(result: MdiResult): boolean {
  return result.ruleVersion === "MDI_RESEARCH_SHADOW_V1"
    && result.semantics === "RESEARCH_SHADOW_ONLY"
    && result.sourcePolicy === "VERIFIED_COMPONENT_SOURCES_ONLY"
    && result.affectsVerdict === false
    && result.affectsTelegram === false
    && result.affectsExecution === false
    && result.createsOrders === false
    && result.aiMayOverride === false;
}

export function deriveMdiLagOverlay(input: MdiLagOverlayInput): MdiLagOverlayResult {
  const reasons: string[] = [];
  const mdiResult = input.mdi.result;
  const provenanceTrusted = trustedMdiResult(mdiResult);
  const mdiAt = input.mdi.firstQualifiedAt;
  const mdiConsistent = mdiResult.mdi == null || expectedBias(mdiResult.mdi) === mdiResult.bias;
  const mdiUsable = provenanceTrusted && mdiConsistent && mdiResult.mdi != null && mdiAt != null && mdiResult.bias !== "UNAVAILABLE";
  const mdiDir = mdiUsable ? mdiDirection(mdiResult.bias) : "UNKNOWN";
  const niftyAt = input.lag.measurements.find((m) => m.stage === "NIFTY")?.firstQualifiedAt ?? null;
  const premiumAt = input.lag.measurements.find((m) => m.stage === "PREMIUM")?.firstQualifiedAt ?? null;

  if (!provenanceTrusted) reasons.push("MDI_PROVENANCE_CONTRACT_NOT_TRUSTED");
  if (provenanceTrusted && !mdiConsistent) reasons.push("MDI_SCORE_BIAS_INCONSISTENT");
  if (provenanceTrusted && mdiConsistent && !mdiUsable) reasons.push("MDI_CONFIRMATION_UNAVAILABLE");

  const hwLag = mdiUsable ? lagMinutes(input.lag.t0At, mdiAt) : null;
  const niftyLag = mdiUsable ? lagMinutes(niftyAt, mdiAt) : null;
  const premiumLag = mdiUsable ? lagMinutes(premiumAt, mdiAt) : null;
  if (hwLag != null && hwLag < 0) reasons.push("MDI_PRECEDES_HEAVYWEIGHT_T0");
  if (niftyLag != null && niftyLag < 0) reasons.push("MDI_PRECEDES_NIFTY_CONFIRMATION");
  if (premiumLag != null && premiumLag < 0) reasons.push("MDI_PRECEDES_PREMIUM_CONFIRMATION");

  let alignment: MdiLagAlignment = "UNAVAILABLE";
  if (mdiUsable && mdiDir === "NEUTRAL") {
    alignment = "NEUTRAL";
    reasons.push("MDI_IS_NEUTRAL_CONTEXT");
  } else if (mdiUsable && input.lag.directionalIntegrity === "UNKNOWN") {
    reasons.push("LAG_DIRECTION_UNKNOWN");
  } else if (mdiUsable && input.lag.directionalIntegrity === "MIXED") {
    reasons.push("LAG_DIRECTION_MIXED_ALIGNMENT_UNAVAILABLE");
  } else if (mdiUsable) {
    const firstDirectional = input.lag.measurements.find((m) => m.present && (m.direction === "UP" || m.direction === "DOWN"));
    if (!firstDirectional) {
      reasons.push("NO_DIRECTIONAL_LAG_STAGE");
    } else if (firstDirectional.direction === mdiDir) {
      alignment = "ALIGNED";
      reasons.push("MDI_DIRECTION_ALIGNS_WITH_OBSERVED_LAG_DIRECTION");
    } else {
      alignment = "CONTRADICTING";
      reasons.push("MDI_DIRECTION_CONTRADICTS_OBSERVED_LAG_DIRECTION");
    }
  }

  return {
    tradeDate: input.lag.tradeDate,
    mdiFirstQualifiedAt: mdiUsable ? mdiAt : null,
    mdiLagFromHeavyweightT0Minutes: hwLag,
    mdiLagFromNiftyMinutes: niftyLag,
    mdiLagFromPremiumMinutes: premiumLag,
    mdiDirection: mdiUsable ? mdiDir : "UNKNOWN",
    alignmentWithLagDirection: alignment,
    reasons,
    ruleVersion: "MDI_LAG_OVERLAY_RESEARCH_V1",
    semantics: "RESEARCH_REPLAY_ONLY",
    affectsLagSequence: false,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
