import type { LagTransitionSnapshot } from "./lag-transition-research.js";
import { deriveMdiResearchShadow, type MdiBias, type MdiInput } from "./mdi-research-shadow.js";

export type MdiLagDirection = "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
export type MdiLagAlignment = "ALIGNED" | "CONTRADICTING" | "NEUTRAL" | "UNAVAILABLE";

export interface MdiLagOverlayInput {
  lag: LagTransitionSnapshot;
  /**
   * Raw MDI observation pairs only. The overlay derives MDI internally so callers
   * cannot inject a prebuilt score/bias or an independent qualification timestamp.
   */
  mdiObservations: MdiInput[];
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
  sourcePolicy: "DERIVE_MDI_INTERNALLY_FROM_RAW_VERIFIED_INPUTS";
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

interface QualifiedMdiObservation {
  at: string;
  bias: MdiBias;
  mdi: number;
}

function firstQualifiedObservation(observations: MdiInput[], reasons: string[]): QualifiedMdiObservation | null {
  const qualified: QualifiedMdiObservation[] = [];

  for (const observation of observations) {
    const previousMs = epochMs(observation.previous.ts);
    const currentMs = epochMs(observation.current.ts);
    if (previousMs == null || currentMs == null || currentMs <= previousMs) {
      reasons.push("MDI_OBSERVATION_TIMESTAMP_INVALID_OR_NON_FORWARD");
      continue;
    }

    const result = deriveMdiResearchShadow(observation);
    if (result.mdi == null || result.bias === "UNAVAILABLE") {
      reasons.push("MDI_OBSERVATION_NOT_QUALIFIED");
      continue;
    }

    qualified.push({ at: observation.current.ts, bias: result.bias, mdi: result.mdi });
  }

  qualified.sort((a, b) => (epochMs(a.at) as number) - (epochMs(b.at) as number));
  return qualified[0] ?? null;
}

export function deriveMdiLagOverlay(input: MdiLagOverlayInput): MdiLagOverlayResult {
  const reasons: string[] = [];
  const qualified = firstQualifiedObservation(input.mdiObservations, reasons);
  const mdiAt = qualified?.at ?? null;
  const mdiDir = qualified ? mdiDirection(qualified.bias) : "UNKNOWN";
  const niftyAt = input.lag.measurements.find((m) => m.stage === "NIFTY")?.firstQualifiedAt ?? null;
  const premiumAt = input.lag.measurements.find((m) => m.stage === "PREMIUM")?.firstQualifiedAt ?? null;

  if (!qualified) reasons.push("MDI_CONFIRMATION_UNAVAILABLE");

  const hwLag = qualified ? lagMinutes(input.lag.t0At, mdiAt) : null;
  const niftyLag = qualified ? lagMinutes(niftyAt, mdiAt) : null;
  const premiumLag = qualified ? lagMinutes(premiumAt, mdiAt) : null;
  if (hwLag != null && hwLag < 0) reasons.push("MDI_PRECEDES_HEAVYWEIGHT_T0");
  if (niftyLag != null && niftyLag < 0) reasons.push("MDI_PRECEDES_NIFTY_CONFIRMATION");
  if (premiumLag != null && premiumLag < 0) reasons.push("MDI_PRECEDES_PREMIUM_CONFIRMATION");

  let alignment: MdiLagAlignment = "UNAVAILABLE";
  if (qualified && mdiDir === "NEUTRAL") {
    alignment = "NEUTRAL";
    reasons.push("MDI_IS_NEUTRAL_CONTEXT");
  } else if (qualified && input.lag.directionalIntegrity === "UNKNOWN") {
    reasons.push("LAG_DIRECTION_UNKNOWN");
  } else if (qualified && input.lag.directionalIntegrity === "MIXED") {
    reasons.push("LAG_DIRECTION_MIXED_ALIGNMENT_UNAVAILABLE");
  } else if (qualified) {
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
    mdiFirstQualifiedAt: mdiAt,
    mdiLagFromHeavyweightT0Minutes: hwLag,
    mdiLagFromNiftyMinutes: niftyLag,
    mdiLagFromPremiumMinutes: premiumLag,
    mdiDirection: qualified ? mdiDir : "UNKNOWN",
    alignmentWithLagDirection: alignment,
    reasons,
    ruleVersion: "MDI_LAG_OVERLAY_RESEARCH_V1",
    semantics: "RESEARCH_REPLAY_ONLY",
    sourcePolicy: "DERIVE_MDI_INTERNALLY_FROM_RAW_VERIFIED_INPUTS",
    affectsLagSequence: false,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
