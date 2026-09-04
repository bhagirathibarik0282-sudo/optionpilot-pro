export type H1VolatilitySymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export interface H1VolatilitySnapshot {
  symbol: H1VolatilitySymbol;
  observedAt: string;
  indiaVix: number;
  atmIv?: number | null;
  ivVelocityPerMinute?: number | null;
  ivQuality?: "VALID" | "PARTIAL" | "NOT_CONFIGURED" | "INVALID";
}

export interface H1VolatilityContextPolicy {
  maxObservationGapMs: number;
}

export interface H1VolatilityContextEvidence {
  version: "H1_VOLATILITY_CONTEXT_EVIDENCE_V1";
  ready: boolean;
  symbol: H1VolatilitySymbol | null;
  previousObservedAt: string | null;
  currentObservedAt: string | null;
  previousVix: number | null;
  currentVix: number | null;
  vixChange: number | null;
  vixChangePct: number | null;
  vixState: "RISING" | "FALLING" | "UNCHANGED" | null;
  ivAvailable: boolean;
  atmIv: number | null;
  ivVelocityPerMinute: number | null;
  ivStatus: "VALID" | "PARTIAL" | "NOT_CONFIGURED" | "INVALID";
  blockers: string[];
  semantics: "VOLATILITY_CONTEXT_ONLY_NO_DIRECTION_TRUTH";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

const VERSION = "H1_VOLATILITY_CONTEXT_EVIDENCE_V1" as const;
const SEMANTICS = "VOLATILITY_CONTEXT_ONLY_NO_DIRECTION_TRUTH" as const;

function validSnapshot(value: H1VolatilitySnapshot | null | undefined): value is H1VolatilitySnapshot {
  return !!value &&
    (value.symbol === "NIFTY" || value.symbol === "SENSEX" || value.symbol === "BANKNIFTY") &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    Number.isFinite(value.indiaVix) && value.indiaVix > 0;
}

function normalizedIvStatus(value: H1VolatilitySnapshot): H1VolatilityContextEvidence["ivStatus"] {
  return value.ivQuality ?? "NOT_CONFIGURED";
}

function blocked(blockers: string[]): H1VolatilityContextEvidence {
  return {
    version: VERSION,
    ready: false,
    symbol: null,
    previousObservedAt: null,
    currentObservedAt: null,
    previousVix: null,
    currentVix: null,
    vixChange: null,
    vixChangePct: null,
    vixState: null,
    ivAvailable: false,
    atmIv: null,
    ivVelocityPerMinute: null,
    ivStatus: "NOT_CONFIGURED",
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

export function buildH1VolatilityContextEvidence(
  previous: H1VolatilitySnapshot | null,
  current: H1VolatilitySnapshot | null,
  policy: H1VolatilityContextPolicy,
): H1VolatilityContextEvidence {
  const blockers: string[] = [];
  if (!validSnapshot(previous)) blockers.push("INVALID_PREVIOUS_VOLATILITY_SNAPSHOT");
  if (!validSnapshot(current)) blockers.push("INVALID_CURRENT_VOLATILITY_SNAPSHOT");
  if (!policy || !Number.isFinite(policy.maxObservationGapMs) || policy.maxObservationGapMs <= 0) {
    blockers.push("INVALID_VOLATILITY_CONTEXT_POLICY");
  }
  if (blockers.length > 0 || !previous || !current) return blocked(blockers);
  if (previous.symbol !== current.symbol) return blocked(["VOLATILITY_SYMBOL_MISMATCH"]);

  const previousMs = Date.parse(previous.observedAt);
  const currentMs = Date.parse(current.observedAt);
  const gapMs = currentMs - previousMs;
  if (gapMs <= 0) return blocked(["NON_FORWARD_CHRONOLOGY"]);
  if (gapMs > policy.maxObservationGapMs) return blocked(["OBSERVATION_GAP_TOO_LARGE"]);

  const vixChange = current.indiaVix - previous.indiaVix;
  const vixChangePct = (vixChange / previous.indiaVix) * 100;
  const ivStatus = normalizedIvStatus(current);
  const ivAvailable = ivStatus === "VALID" && Number.isFinite(current.atmIv) && (current.atmIv ?? 0) > 0;

  return {
    version: VERSION,
    ready: true,
    symbol: current.symbol,
    previousObservedAt: previous.observedAt,
    currentObservedAt: current.observedAt,
    previousVix: previous.indiaVix,
    currentVix: current.indiaVix,
    vixChange,
    vixChangePct,
    vixState: vixChange > 0 ? "RISING" : vixChange < 0 ? "FALLING" : "UNCHANGED",
    ivAvailable,
    atmIv: ivAvailable ? (current.atmIv as number) : null,
    ivVelocityPerMinute: ivAvailable && Number.isFinite(current.ivVelocityPerMinute)
      ? (current.ivVelocityPerMinute as number)
      : null,
    ivStatus,
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
