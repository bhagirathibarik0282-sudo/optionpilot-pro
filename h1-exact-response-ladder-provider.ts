import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";

export const H1_EXACT_RESPONSE_LADDER_PROVIDER_V1 = "H1_EXACT_RESPONSE_LADDER_PROVIDER_V1" as const;

export type H1ResponseLadderDirection = "UP" | "DOWN";
export type H1ResponseWindowMinutes = 3 | 6 | 15 | 30;

export interface H1ExactResponsePoint {
  provenance: "LIVE_RUNTIME_EXACT";
  symbol: CanonicalMarketSymbol;
  observedAtMs: number;
  spot: number;
  sourceId: string;
  devilFlags: string[];
}

export interface H1ExactResponseLadderPolicy {
  maxLatestAgeMs: number;
  minWindowCoveragePct: number;
  minSamplesPerStage: number;
  requiredMatureStages: number;
  minAbsoluteMovePctByWindow: Record<H1ResponseWindowMinutes, number>;
}

export interface H1ExactResponseStage {
  windowMinutes: H1ResponseWindowMinutes;
  mature: boolean;
  confirmed: boolean;
  sampleCount: number;
  coveragePct: number | null;
  movePct: number | null;
  blocker: string | null;
}

export interface H1ExactResponseLadderResult {
  version: typeof H1_EXACT_RESPONSE_LADDER_PROVIDER_V1;
  ready: boolean;
  symbol: CanonicalMarketSymbol | null;
  direction: H1ResponseLadderDirection | null;
  observedAtMs: number | null;
  sourceId: typeof H1_EXACT_RESPONSE_LADDER_PROVIDER_V1;
  confirmedStages: number;
  matureStages: number;
  totalStages: 4;
  stages: H1ExactResponseStage[];
  blockers: string[];
  deterministic: true;
  liveRuntimeExact: true;
  scoreComputed: false;
  probabilityClaimed: false;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const WINDOWS: readonly H1ResponseWindowMinutes[] = [3, 6, 15, 30] as const;
const VERSION = H1_EXACT_RESPONSE_LADDER_PROVIDER_V1;

const safety = {
  deterministic: true as const,
  liveRuntimeExact: true as const,
  scoreComputed: false as const,
  probabilityClaimed: false as const,
  sendsTelegram: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  failClosed: true as const,
};

function empty(blockers: string[], symbol: CanonicalMarketSymbol | null = null): H1ExactResponseLadderResult {
  return {
    version: VERSION,
    ready: false,
    symbol,
    direction: null,
    observedAtMs: null,
    sourceId: VERSION,
    confirmedStages: 0,
    matureStages: 0,
    totalStages: 4,
    stages: WINDOWS.map((windowMinutes) => ({
      windowMinutes,
      mature: false,
      confirmed: false,
      sampleCount: 0,
      coveragePct: null,
      movePct: null,
      blocker: "NOT_EVALUATED",
    })),
    blockers: [...new Set(blockers)],
    ...safety,
  };
}

function exactDirection(source: H1ExactLiveSpotDirectionResult | null | undefined): H1ResponseLadderDirection | null {
  return source?.ready === true
    && source.source === "VERIFIED_DETERMINISTIC_RUNTIME"
    && source.sourceId === "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1"
    && source.liveRuntimeExact === true
    && source.deterministic === true
    && source.failClosed === true
    && Array.isArray(source.blockers)
    && source.blockers.length === 0
    && (source.direction === "UP" || source.direction === "DOWN")
    ? source.direction
    : null;
}

function validPolicy(policy: H1ExactResponseLadderPolicy | null | undefined): boolean {
  return Boolean(
    policy
    && Number.isFinite(policy.maxLatestAgeMs) && policy.maxLatestAgeMs > 0
    && Number.isFinite(policy.minWindowCoveragePct) && policy.minWindowCoveragePct > 0 && policy.minWindowCoveragePct <= 100
    && Number.isInteger(policy.minSamplesPerStage) && policy.minSamplesPerStage >= 2
    && Number.isInteger(policy.requiredMatureStages) && policy.requiredMatureStages >= 1 && policy.requiredMatureStages <= 4
    && WINDOWS.every((window) => Number.isFinite(policy.minAbsoluteMovePctByWindow?.[window]) && policy.minAbsoluteMovePctByWindow[window] >= 0)
  );
}

function validPoint(point: H1ExactResponsePoint, symbol: CanonicalMarketSymbol): boolean {
  return Boolean(
    point
    && point.provenance === "LIVE_RUNTIME_EXACT"
    && point.symbol === symbol
    && Number.isFinite(point.observedAtMs) && point.observedAtMs > 0
    && Number.isFinite(point.spot) && point.spot > 0
    && typeof point.sourceId === "string" && point.sourceId.trim().length > 0
    && Array.isArray(point.devilFlags) && point.devilFlags.length === 0
  );
}

function movePct(first: H1ExactResponsePoint, last: H1ExactResponsePoint): number {
  return ((last.spot - first.spot) / first.spot) * 100;
}

/**
 * Deterministic 3m -> 6m -> 15m -> 30m response ladder.
 *
 * This provider intentionally does not reuse the legacy V2 regime classifier,
 * whose thresholds are labelled research-only. Stage move thresholds are an
 * explicit caller-owned policy. A stage matures only when the real elapsed-time
 * coverage and sample-count requirements are met; each mature stage confirms
 * independently when its net spot move agrees with the separately-attested
 * exact live spot direction and clears that stage's explicit move threshold.
 */
export function deriveH1ExactResponseLadder(input: {
  symbol: CanonicalMarketSymbol;
  directionSource: H1ExactLiveSpotDirectionResult;
  points: H1ExactResponsePoint[];
  policy: H1ExactResponseLadderPolicy;
  nowMs: number;
}): H1ExactResponseLadderResult {
  const blockers: string[] = [];
  const symbol = input?.symbol;
  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(symbol)) blockers.push("INVALID_SYMBOL");
  if (!Number.isFinite(input?.nowMs) || input.nowMs <= 0) blockers.push("INVALID_NOW");
  if (!validPolicy(input?.policy)) blockers.push("INVALID_RESPONSE_LADDER_POLICY");
  const direction = exactDirection(input?.directionSource);
  if (!direction) blockers.push("INDEPENDENT_EXACT_DIRECTION_NOT_READY");
  if (blockers.length > 0) return empty(blockers, ["NIFTY", "SENSEX", "BANKNIFTY"].includes(symbol) ? symbol : null);

  const supplied = Array.isArray(input.points) ? input.points : [];
  if (supplied.length < 2) return empty(["RESPONSE_HISTORY_INSUFFICIENT"], symbol);
  if (supplied.some((point) => !validPoint(point, symbol))) return empty(["RESPONSE_HISTORY_CONTAINS_INVALID_POINT"], symbol);

  const points = [...supplied].sort((a, b) => a.observedAtMs - b.observedAtMs);
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].observedAtMs <= points[i - 1].observedAtMs) return empty(["RESPONSE_HISTORY_NON_FORWARD_OR_DUPLICATE"], symbol);
  }

  const latest = points[points.length - 1];
  const latestAgeMs = input.nowMs - latest.observedAtMs;
  if (latestAgeMs < 0 || latestAgeMs > input.policy.maxLatestAgeMs) {
    return empty(["RESPONSE_HISTORY_LATEST_STALE_OR_FUTURE"], symbol);
  }

  const stages: H1ExactResponseStage[] = WINDOWS.map((windowMinutes) => {
    const windowMs = windowMinutes * 60_000;
    const cutoff = latest.observedAtMs - windowMs;
    const stagePoints = points.filter((point) => point.observedAtMs >= cutoff && point.observedAtMs <= latest.observedAtMs);
    if (stagePoints.length < input.policy.minSamplesPerStage) {
      return { windowMinutes, mature: false, confirmed: false, sampleCount: stagePoints.length, coveragePct: null, movePct: null, blocker: "INSUFFICIENT_SAMPLES" };
    }
    const coverageMs = latest.observedAtMs - stagePoints[0].observedAtMs;
    const coveragePct = Math.min(100, coverageMs / windowMs * 100);
    if (coveragePct < input.policy.minWindowCoveragePct) {
      return { windowMinutes, mature: false, confirmed: false, sampleCount: stagePoints.length, coveragePct, movePct: null, blocker: "INSUFFICIENT_ELAPSED_COVERAGE" };
    }

    const netMovePct = movePct(stagePoints[0], latest);
    const signedMovePct = direction === "UP" ? netMovePct : -netMovePct;
    const threshold = input.policy.minAbsoluteMovePctByWindow[windowMinutes];
    const confirmed = Number.isFinite(signedMovePct) && signedMovePct >= threshold;
    return {
      windowMinutes,
      mature: true,
      confirmed,
      sampleCount: stagePoints.length,
      coveragePct,
      movePct: netMovePct,
      blocker: confirmed ? null : "DIRECTION_OR_MOVE_THRESHOLD_NOT_CONFIRMED",
    };
  });

  const matureStages = stages.filter((stage) => stage.mature).length;
  const confirmedStages = stages.filter((stage) => stage.confirmed).length;
  if (matureStages < input.policy.requiredMatureStages) blockers.push("RESPONSE_LADDER_NOT_MATURE");

  return {
    version: VERSION,
    ready: blockers.length === 0,
    symbol,
    direction,
    observedAtMs: latest.observedAtMs,
    sourceId: VERSION,
    confirmedStages,
    matureStages,
    totalStages: 4,
    stages,
    blockers,
    ...safety,
  };
}
