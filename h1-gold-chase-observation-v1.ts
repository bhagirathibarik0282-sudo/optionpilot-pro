import {
  CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalOneRoofMarketSnapshot,
} from "./canonical-one-roof-market-snapshot.js";

export const H1_GOLD_CHASE_OBSERVATION_V1 = "H1_GOLD_CHASE_OBSERVATION_V1" as const;

export type H1GoldChaseSymbol = "NIFTY" | "SENSEX";
export type H1GoldChaseSide = "CE" | "PE";

export interface H1GoldChaseContractIdentity {
  expiry: string;
  strike: number;
  optionType: H1GoldChaseSide;
  dte: number;
}

export interface H1GoldChasePremiumPoint {
  source: "LIVE_RUNTIME_EXACT";
  symbol: H1GoldChaseSymbol;
  expiry: string;
  strike: number;
  optionType: H1GoldChaseSide;
  ltp: number;
  observedAt: string;
  receivedAt: string;
}

export interface H1GoldChaseObservationInput {
  symbol: H1GoldChaseSymbol;
  side: H1GoldChaseSide;
  observedAt: string;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  contract: H1GoldChaseContractIdentity;
  premiumPoints: H1GoldChasePremiumPoint[];
}

export interface H1GoldChaseObservationFeatures {
  pointCount: number;
  firstObservedAt: string | null;
  currentObservedAt: string | null;
  minutesSinceMarketOpen: number | null;
  observationSpanMinutes: number | null;
  firstPremium: number | null;
  currentPremium: number | null;
  sessionHighPremium: number | null;
  sessionHighObservedAt: string | null;
  sessionLowPremium: number | null;
  sessionLowObservedAt: string | null;
  currentVsFirstPct: number | null;
  currentVsSessionHighPct: number | null;
  sessionRangePct: number | null;
}

export interface H1GoldChaseObservationResult {
  version: typeof H1_GOLD_CHASE_OBSERVATION_V1;
  state: "OBSERVABLE" | "MISSING";
  readyForForwardCalibration: boolean;
  symbol: H1GoldChaseSymbol;
  side: H1GoldChaseSide;
  observedAt: string;
  snapshotId: string;
  contract: H1GoldChaseContractIdentity;
  features: H1GoldChaseObservationFeatures;
  blockers: string[];
  chaseVerdict: null;
  goldFamilySignal: null;
  thresholdPolicy: null;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  registersGoldFamily: false;
  usesFutureOutcome: false;
  failClosed: true;
  businessUse: "FORWARD_CALIBRATION_ONLY_NOT_CHASE_VERDICT";
  semantics: "EXACT_T0_SAME_CONTRACT_PREMIUM_PATH_FACTS_ONLY_NO_CHASE_CLASSIFICATION_NO_THRESHOLD";
}

const SEMANTICS = "EXACT_T0_SAME_CONTRACT_PREMIUM_PATH_FACTS_ONLY_NO_CHASE_CLASSIFICATION_NO_THRESHOLD" as const;

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function pct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from <= 0) return null;
  return ((to - from) / from) * 100;
}

function marketOpenUtcMsFor(timestampMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), 3, 45, 0, 0); // 09:15 IST
}

function emptyFeatures(): H1GoldChaseObservationFeatures {
  return {
    pointCount: 0,
    firstObservedAt: null,
    currentObservedAt: null,
    minutesSinceMarketOpen: null,
    observationSpanMinutes: null,
    firstPremium: null,
    currentPremium: null,
    sessionHighPremium: null,
    sessionHighObservedAt: null,
    sessionLowPremium: null,
    sessionLowObservedAt: null,
    currentVsFirstPct: null,
    currentVsSessionHighPct: null,
    sessionRangePct: null,
  };
}

function validateCanonical(input: H1GoldChaseObservationInput): string[] {
  const reasons: string[] = [];
  const snapshot = input?.canonicalSnapshot;
  const observedAtMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;
  if (!snapshot) return ["MISSING_CANONICAL_SNAPSHOT"];
  if (snapshot.version !== CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2) reasons.push("INVALID_CANONICAL_SNAPSHOT_VERSION");
  if (!snapshot.snapshotId?.trim()) reasons.push("MISSING_CANONICAL_SNAPSHOT_ID");
  if (snapshot.symbol !== input.symbol) reasons.push("CANONICAL_SYMBOL_MISMATCH");
  if (!Number.isFinite(observedAtMs)) reasons.push("INVALID_DECISION_TIMESTAMP");
  if (!Number.isFinite(snapshot.asOfMs) || snapshot.asOfMs !== observedAtMs) reasons.push("CANONICAL_DECISION_TIMESTAMP_MISMATCH");

  const rebuilt = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    asOfMs: snapshot.asOfMs,
    minuteClosed: snapshot.minuteClosed,
    connectionId: snapshot.connectionId,
    instrumentMasterVersion: snapshot.instrumentMasterVersion,
    components: snapshot.components,
    freshnessBudgetsMs: snapshot.freshnessBudgetsMs,
    ingestTelemetry: snapshot.ingestTelemetry,
  });
  if (!rebuilt.readyForStrictFiltering) reasons.push("CANONICAL_NOT_READY_FOR_STRICT_FILTERING");
  if (rebuilt.qualityState !== "VERIFIED") reasons.push("CANONICAL_QUALITY_NOT_VERIFIED");
  if (rebuilt.newEntryGate !== "ALLOW_NEW_ENTRIES") reasons.push("CANONICAL_NEW_ENTRY_GATE_BLOCKED");
  if (rebuilt.internalBlockers.length > 0) reasons.push("CANONICAL_INTERNAL_BLOCKERS_PRESENT");
  return unique(reasons);
}

function sameTradingDateIst(aMs: number, bMs: number): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(aMs)) === fmt.format(new Date(bMs));
}

/**
 * Collects exact, same-contract facts that may later be calibrated into a
 * chase-phase policy. It deliberately does not decide CHASE/NOT_CHASE and does
 * not emit or register a Gold family signal. Rising premium, proximity to the
 * session high, time-of-day and DTE remain observables rather than thresholds.
 */
export function observeH1GoldChaseFacts(
  input: H1GoldChaseObservationInput,
): H1GoldChaseObservationResult {
  const symbol = input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY";
  const side = input?.side === "PE" ? "PE" : "CE";
  const observedAt = validIso(input?.observedAt) ? input.observedAt : new Date(0).toISOString();
  const snapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT";
  const blockers = validateCanonical(input);

  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") blockers.push("INVALID_GOLD_TARGET_SYMBOL");
  if (input?.side !== "CE" && input?.side !== "PE") blockers.push("INVALID_OPTION_SIDE");
  if (!input?.contract || typeof input.contract.expiry !== "string" || !input.contract.expiry.trim()) blockers.push("INVALID_CONTRACT_EXPIRY");
  if (!Number.isFinite(input?.contract?.strike) || input.contract.strike <= 0) blockers.push("INVALID_CONTRACT_STRIKE");
  if (input?.contract?.optionType !== side) blockers.push("CONTRACT_SIDE_MISMATCH");
  if (!Number.isInteger(input?.contract?.dte) || input.contract.dte < 0) blockers.push("INVALID_CONTRACT_DTE");

  const t0Ms = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;
  const points = Array.isArray(input?.premiumPoints) ? input.premiumPoints : [];
  if (points.length === 0) blockers.push("PREMIUM_PATH_MISSING");

  const timestamps = new Set<number>();
  const validPoints: H1GoldChasePremiumPoint[] = [];
  for (const point of points) {
    if (!point || point.source !== "LIVE_RUNTIME_EXACT") {
      blockers.push("NON_EXACT_PREMIUM_POINT");
      continue;
    }
    if (point.symbol !== input.symbol || point.expiry !== input.contract?.expiry || point.strike !== input.contract?.strike || point.optionType !== side) {
      blockers.push("PREMIUM_POINT_CONTRACT_IDENTITY_MISMATCH");
      continue;
    }
    if (!finitePositive(point.ltp)) {
      blockers.push("INVALID_PREMIUM_LTP");
      continue;
    }
    if (!validIso(point.observedAt) || !validIso(point.receivedAt)) {
      blockers.push("INVALID_PREMIUM_POINT_TIMESTAMP");
      continue;
    }
    const pointMs = Date.parse(point.observedAt);
    const receivedMs = Date.parse(point.receivedAt);
    if (receivedMs < pointMs) blockers.push("PREMIUM_POINT_RECEIVED_BEFORE_OBSERVED");
    if (Number.isFinite(t0Ms) && pointMs > t0Ms) blockers.push("FUTURE_PREMIUM_POINT");
    if (Number.isFinite(t0Ms) && !sameTradingDateIst(pointMs, t0Ms)) blockers.push("CROSS_SESSION_PREMIUM_POINT");
    if (timestamps.has(pointMs)) blockers.push("DUPLICATE_PREMIUM_POINT_TIMESTAMP");
    timestamps.add(pointMs);
    validPoints.push(point);
  }

  validPoints.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const current = validPoints.at(-1) ?? null;
  if (!current || !Number.isFinite(t0Ms) || Date.parse(current.observedAt) !== t0Ms) blockers.push("EXACT_T0_PREMIUM_POINT_REQUIRED");

  const finalBlockers = unique(blockers);
  if (finalBlockers.length > 0) {
    return {
      version: H1_GOLD_CHASE_OBSERVATION_V1,
      state: "MISSING",
      readyForForwardCalibration: false,
      symbol,
      side,
      observedAt,
      snapshotId,
      contract: input?.contract ?? { expiry: "", strike: 0, optionType: side, dte: -1 },
      features: emptyFeatures(),
      blockers: finalBlockers,
      chaseVerdict: null,
      goldFamilySignal: null,
      thresholdPolicy: null,
      productionImpact: "NONE",
      affectsSelector: false,
      affectsTelegram: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      createsOrders: false,
      registersGoldFamily: false,
      usesFutureOutcome: false,
      failClosed: true,
      businessUse: "FORWARD_CALIBRATION_ONLY_NOT_CHASE_VERDICT",
      semantics: SEMANTICS,
    };
  }

  const first = validPoints[0];
  let high = first;
  let low = first;
  for (const point of validPoints) {
    if (point.ltp > high.ltp) high = point;
    if (point.ltp < low.ltp) low = point;
  }
  const currentPoint = current!;
  const openMs = marketOpenUtcMsFor(t0Ms);
  const features: H1GoldChaseObservationFeatures = {
    pointCount: validPoints.length,
    firstObservedAt: first.observedAt,
    currentObservedAt: currentPoint.observedAt,
    minutesSinceMarketOpen: (t0Ms - openMs) / 60_000,
    observationSpanMinutes: (t0Ms - Date.parse(first.observedAt)) / 60_000,
    firstPremium: first.ltp,
    currentPremium: currentPoint.ltp,
    sessionHighPremium: high.ltp,
    sessionHighObservedAt: high.observedAt,
    sessionLowPremium: low.ltp,
    sessionLowObservedAt: low.observedAt,
    currentVsFirstPct: pct(first.ltp, currentPoint.ltp),
    currentVsSessionHighPct: pct(high.ltp, currentPoint.ltp),
    sessionRangePct: pct(low.ltp, high.ltp),
  };

  return {
    version: H1_GOLD_CHASE_OBSERVATION_V1,
    state: "OBSERVABLE",
    readyForForwardCalibration: true,
    symbol,
    side,
    observedAt,
    snapshotId,
    contract: input.contract,
    features,
    blockers: [],
    chaseVerdict: null,
    goldFamilySignal: null,
    thresholdPolicy: null,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    usesFutureOutcome: false,
    failClosed: true,
    businessUse: "FORWARD_CALIBRATION_ONLY_NOT_CHASE_VERDICT",
    semantics: SEMANTICS,
  };
}
