import type { LagTransitionSnapshot } from "./lag-transition-research.js";
import type { MdiBias } from "./mdi-research-shadow.js";

export type MdiLagDirection = "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
export type MdiLagAlignment = "ALIGNED" | "CONTRADICTING" | "NEUTRAL" | "UNAVAILABLE";

export interface MdiLagObservation {
  firstQualifiedAt: string | null;
  bias: MdiBias;
  mdi: number | null;
  sourceQualityVerified: boolean;
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

export function deriveMdiLagOverlay(input: MdiLagOverlayInput): MdiLagOverlayResult {
  const reasons: string[] = [];
  const mdiAt = input.mdi.firstQualifiedAt;
  const mdiDir = mdiDirection(input.mdi.bias);
  const niftyAt = input.lag.measurements.find((m) => m.stage === "NIFTY")?.firstQualifiedAt ?? null;
  const premiumAt = input.lag.measurements.find((m) => m.stage === "PREMIUM")?.firstQualifiedAt ?? null;

  let alignment: MdiLagAlignment = "UNAVAILABLE";
  if (!input.mdi.sourceQualityVerified) {
    reasons.push("MDI_SOURCE_QUALITY_NOT_VERIFIED");
  } else if (input.mdi.mdi == null || mdiAt == null || mdiDir === "UNKNOWN") {
    reasons.push("MDI_CONFIRMATION_UNAVAILABLE");
  } else if (mdiDir === "NEUTRAL") {
    alignment = "NEUTRAL";
    reasons.push("MDI_IS_NEUTRAL_CONTEXT");
  } else if (input.lag.directionalIntegrity === "UNKNOWN") {
    reasons.push("LAG_DIRECTION_UNKNOWN");
  } else if (input.lag.directionalIntegrity === "MIXED") {
    alignment = "CONTRADICTING";
    reasons.push("LAG_DIRECTION_MIXED");
  } else {
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
    mdiFirstQualifiedAt: input.mdi.sourceQualityVerified ? mdiAt : null,
    mdiLagFromHeavyweightT0Minutes: input.mdi.sourceQualityVerified ? lagMinutes(input.lag.t0At, mdiAt) : null,
    mdiLagFromNiftyMinutes: input.mdi.sourceQualityVerified ? lagMinutes(niftyAt, mdiAt) : null,
    mdiLagFromPremiumMinutes: input.mdi.sourceQualityVerified ? lagMinutes(premiumAt, mdiAt) : null,
    mdiDirection: input.mdi.sourceQualityVerified ? mdiDir : "UNKNOWN",
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
