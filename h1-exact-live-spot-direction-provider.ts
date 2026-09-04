import type { H1ExactUnderlyingObservation } from "./h1-kite-exact-price-greek-adapter.js";

export type H1ExactLiveSpotDirection = "UP" | "DOWN";

export interface H1ExactLiveSpotDirectionPolicy {
  maxObservationGapMs: number;
  minAbsoluteSpotMovePct: number;
}

export interface H1ExactLiveSpotDirectionResult {
  version: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1";
  ready: boolean;
  direction: H1ExactLiveSpotDirection | null;
  source: "VERIFIED_DETERMINISTIC_RUNTIME";
  sourceId: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1";
  liveRuntimeExact: true;
  deterministic: true;
  previousObservedAt: string | null;
  currentObservedAt: string | null;
  spotMovePct: number | null;
  blockers: string[];
  failClosed: true;
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
}

const VERSION = "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1" as const;

function validTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validObservation(value: H1ExactUnderlyingObservation | null | undefined): value is H1ExactUnderlyingObservation {
  const observedMs = validTime(value?.observedAt);
  const receivedMs = validTime(value?.receivedAt);
  return Boolean(value && value.source === "LIVE_RUNTIME_EXACT" &&
    (value.symbol === "NIFTY" || value.symbol === "SENSEX" || value.symbol === "BANKNIFTY") &&
    Number.isFinite(value.price) && value.price > 0 &&
    observedMs != null && receivedMs != null && observedMs <= receivedMs);
}

function result(
  ready: boolean,
  direction: H1ExactLiveSpotDirection | null,
  previous: H1ExactUnderlyingObservation | null,
  current: H1ExactUnderlyingObservation | null,
  spotMovePct: number | null,
  blockers: string[],
): H1ExactLiveSpotDirectionResult {
  return {
    version: VERSION,
    ready,
    direction,
    source: "VERIFIED_DETERMINISTIC_RUNTIME",
    sourceId: VERSION,
    liveRuntimeExact: true,
    deterministic: true,
    previousObservedAt: previous?.observedAt ?? null,
    currentObservedAt: current?.observedAt ?? null,
    spotMovePct,
    blockers: [...new Set(blockers)],
    failClosed: true,
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
  };
}

export function deriveH1ExactLiveSpotDirection(
  previous: H1ExactUnderlyingObservation | null | undefined,
  current: H1ExactUnderlyingObservation | null | undefined,
  policy: H1ExactLiveSpotDirectionPolicy,
): H1ExactLiveSpotDirectionResult {
  const blockers: string[] = [];
  if (!Number.isFinite(policy?.maxObservationGapMs) || policy.maxObservationGapMs <= 0 ||
      !Number.isFinite(policy?.minAbsoluteSpotMovePct) || policy.minAbsoluteSpotMovePct < 0) {
    return result(false, null, null, null, null, ["DIRECTION_POLICY_INVALID"]);
  }
  if (!validObservation(previous) || !validObservation(current)) {
    return result(false, null, validObservation(previous) ? previous : null, validObservation(current) ? current : null, null, ["LIVE_RUNTIME_EXACT_SPOT_PAIR_REQUIRED"]);
  }
  if (previous.symbol !== current.symbol) blockers.push("SPOT_SYMBOL_MISMATCH");
  const previousMs = validTime(previous.observedAt)!;
  const currentMs = validTime(current.observedAt)!;
  if (currentMs <= previousMs) blockers.push("NON_FORWARD_SPOT_CHRONOLOGY");
  if (currentMs - previousMs > policy.maxObservationGapMs) blockers.push("SPOT_OBSERVATION_GAP_EXCEEDED");
  if (blockers.length) return result(false, null, previous, current, null, blockers);

  const spotMovePct = ((current.price - previous.price) / previous.price) * 100;
  if (!Number.isFinite(spotMovePct)) return result(false, null, previous, current, null, ["SPOT_MOVE_INVALID"]);
  if (Math.abs(spotMovePct) < policy.minAbsoluteSpotMovePct) {
    return result(false, null, previous, current, spotMovePct, ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"]);
  }
  if (spotMovePct === 0) return result(false, null, previous, current, spotMovePct, ["SPOT_DIRECTION_NEUTRAL"]);
  return result(true, spotMovePct > 0 ? "UP" : "DOWN", previous, current, spotMovePct, []);
}
