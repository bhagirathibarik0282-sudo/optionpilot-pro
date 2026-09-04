export type H1PositioningSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export interface H1PositioningSnapshot {
  symbol: H1PositioningSymbol;
  expiry: string;
  observedAt: string;
  fullChainOiPcr: number;
  band7OiPcr: number;
  volumePcr: number;
  callWallStrike: number;
  callWallStrength: number;
  putWallStrike: number;
  putWallStrength: number;
}

export interface H1PositioningChangePolicy {
  maxObservationGapMs: number;
}

export interface H1PositioningChangeEvidence {
  version: "H1_POSITIONING_CHANGE_EVIDENCE_V1";
  ready: boolean;
  symbol: H1PositioningSymbol | null;
  expiry: string | null;
  previousObservedAt: string | null;
  currentObservedAt: string | null;
  fullChainOiPcrDelta: number | null;
  band7OiPcrDelta: number | null;
  volumePcrDelta: number | null;
  callWallMigration: number | null;
  putWallMigration: number | null;
  callWallStrengthChangePct: number | null;
  putWallStrengthChangePct: number | null;
  callWallState: "BUILDING" | "SHEDDING" | "UNCHANGED" | null;
  putWallState: "BUILDING" | "SHEDDING" | "UNCHANGED" | null;
  blockers: string[];
  semantics: "POSITIONING_CHANGE_CONTEXT_ONLY_NO_DIRECTION_TRUTH";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

const VERSION = "H1_POSITIONING_CHANGE_EVIDENCE_V1" as const;
const SEMANTICS = "POSITIONING_CHANGE_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validSnapshot(value: H1PositioningSnapshot | null | undefined): value is H1PositioningSnapshot {
  return !!value &&
    (value.symbol === "NIFTY" || value.symbol === "SENSEX" || value.symbol === "BANKNIFTY") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.expiry) &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    finitePositive(value.fullChainOiPcr) &&
    finitePositive(value.band7OiPcr) &&
    finitePositive(value.volumePcr) &&
    finitePositive(value.callWallStrike) &&
    finitePositive(value.callWallStrength) &&
    finitePositive(value.putWallStrike) &&
    finitePositive(value.putWallStrength);
}

function stateFromPct(value: number): "BUILDING" | "SHEDDING" | "UNCHANGED" {
  if (value > 0) return "BUILDING";
  if (value < 0) return "SHEDDING";
  return "UNCHANGED";
}

function blocked(blockers: string[]): H1PositioningChangeEvidence {
  return {
    version: VERSION,
    ready: false,
    symbol: null,
    expiry: null,
    previousObservedAt: null,
    currentObservedAt: null,
    fullChainOiPcrDelta: null,
    band7OiPcrDelta: null,
    volumePcrDelta: null,
    callWallMigration: null,
    putWallMigration: null,
    callWallStrengthChangePct: null,
    putWallStrengthChangePct: null,
    callWallState: null,
    putWallState: null,
    blockers: [...new Set(blockers)],
    semantics: SEMANTICS,
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}

export function buildH1PositioningChangeEvidence(
  previous: H1PositioningSnapshot | null,
  current: H1PositioningSnapshot | null,
  policy: H1PositioningChangePolicy,
): H1PositioningChangeEvidence {
  const blockers: string[] = [];
  if (!validSnapshot(previous)) blockers.push("INVALID_PREVIOUS_POSITIONING_SNAPSHOT");
  if (!validSnapshot(current)) blockers.push("INVALID_CURRENT_POSITIONING_SNAPSHOT");
  if (!policy || !Number.isFinite(policy.maxObservationGapMs) || policy.maxObservationGapMs <= 0) {
    blockers.push("INVALID_POSITIONING_CHANGE_POLICY");
  }
  if (blockers.length > 0 || !previous || !current) return blocked(blockers);

  if (previous.symbol !== current.symbol || previous.expiry !== current.expiry) {
    return blocked(["POSITIONING_IDENTITY_MISMATCH"]);
  }

  const previousMs = Date.parse(previous.observedAt);
  const currentMs = Date.parse(current.observedAt);
  const gapMs = currentMs - previousMs;
  if (gapMs <= 0) return blocked(["NON_FORWARD_CHRONOLOGY"]);
  if (gapMs > policy.maxObservationGapMs) return blocked(["OBSERVATION_GAP_TOO_LARGE"]);

  const callStrengthPct = ((current.callWallStrength - previous.callWallStrength) / previous.callWallStrength) * 100;
  const putStrengthPct = ((current.putWallStrength - previous.putWallStrength) / previous.putWallStrength) * 100;

  return {
    version: VERSION,
    ready: true,
    symbol: current.symbol,
    expiry: current.expiry,
    previousObservedAt: previous.observedAt,
    currentObservedAt: current.observedAt,
    fullChainOiPcrDelta: current.fullChainOiPcr - previous.fullChainOiPcr,
    band7OiPcrDelta: current.band7OiPcr - previous.band7OiPcr,
    volumePcrDelta: current.volumePcr - previous.volumePcr,
    callWallMigration: current.callWallStrike - previous.callWallStrike,
    putWallMigration: current.putWallStrike - previous.putWallStrike,
    callWallStrengthChangePct: callStrengthPct,
    putWallStrengthChangePct: putStrengthPct,
    callWallState: stateFromPct(callStrengthPct),
    putWallState: stateFromPct(putStrengthPct),
    blockers: [],
    semantics: SEMANTICS,
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
