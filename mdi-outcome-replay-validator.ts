import { deriveMdiResearchShadow, type MdiBias, type MdiInput } from "./mdi-research-shadow.js";

export type OutcomeHorizon = 3 | 6 | 15 | 30;
export type OutcomeAlignment = "ALIGNED" | "CONTRADICTED" | "MIXED" | "UNAVAILABLE";
export type OutcomePriceQuality = "VERIFIED" | "PROXY" | "DEGRADED" | "STALE" | "UNKNOWN";

export interface PremiumContractPoint {
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  ltp: number | null;
  quality: OutcomePriceQuality;
}

export interface MdiOutcomeSignal {
  mdiInput: MdiInput;
  signalTs: string;
  spotLtp: number | null;
  spotQuality: OutcomePriceQuality;
  ce: PremiumContractPoint;
  pe: PremiumContractPoint;
}

export interface MdiOutcomeFuturePoint {
  ts: string;
  spotLtp: number | null;
  spotQuality: OutcomePriceQuality;
  premiums: PremiumContractPoint[];
}

export interface MdiOutcomeWindow {
  horizonMinutes: OutcomeHorizon;
  targetTs: string;
  observedTs: string | null;
  spotReturnPct: number | null;
  ceReturnPct: number | null;
  peReturnPct: number | null;
  dominantPremium: "CE" | "PE" | "TIE" | "UNAVAILABLE";
  alignment: OutcomeAlignment;
  reasons: string[];
}

export interface MdiOutcomeValidationResult {
  signalTs: string;
  mdi: number | null;
  mdiBias: MdiBias;
  mdiCoveragePct: number;
  windows: MdiOutcomeWindow[];
  blockers: string[];
  ruleVersion: "MDI_OUTCOME_REPLAY_VALIDATOR_V1";
  semantics: "REPLAY_OUTCOME_RESEARCH_ONLY";
  sourcePolicy: "FULLY_VERIFIED_MDI_AND_VERIFIED_SAME_CONTRACT_OUTCOMES_ONLY";
  materialityPolicy: "RAW_SIGN_ALIGNMENT_ONLY_NO_PROFIT_CLAIM";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const HORIZONS: OutcomeHorizon[] = [3, 6, 15, 30];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const verified = (q: OutcomePriceQuality) => q === "VERIFIED";

function parseMs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function pct(a: number | null, b: number | null): number | null {
  if (!finite(a) || !finite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

function sameContract(a: PremiumContractPoint, b: PremiumContractPoint): boolean {
  return a.optionType === b.optionType && a.expiry === b.expiry && a.strike === b.strike;
}

function directionalBias(bias: MdiBias): "BULLISH" | "BEARISH" | "NONE" {
  if (bias === "STRONG_BULLISH" || bias === "MILD_BULLISH") return "BULLISH";
  if (bias === "STRONG_BEARISH" || bias === "MILD_BEARISH") return "BEARISH";
  return "NONE";
}

function classify(bias: MdiBias, spot: number | null, ce: number | null, pe: number | null) {
  if (spot == null || ce == null || pe == null) return { alignment: "UNAVAILABLE" as const, dominantPremium: "UNAVAILABLE" as const, reasons: ["Spot and both verified same-contract CE/PE outcomes are required."] };
  const dominantPremium = ce > pe ? "CE" as const : pe > ce ? "PE" as const : "TIE" as const;
  const direction = directionalBias(bias);
  if (direction === "NONE") return { alignment: "MIXED" as const, dominantPremium, reasons: ["Neutral MDI has no directional outcome claim."] };
  if (direction === "BULLISH") {
    if (spot > 0 && dominantPremium === "CE") return { alignment: "ALIGNED" as const, dominantPremium, reasons: ["Spot rose and verified same-contract CE outperformed PE after bullish MDI."] };
    if (spot < 0 && dominantPremium === "PE") return { alignment: "CONTRADICTED" as const, dominantPremium, reasons: ["Spot fell and verified same-contract PE outperformed CE after bullish MDI."] };
    return { alignment: "MIXED" as const, dominantPremium, reasons: ["Bullish MDI outcome signs are mixed across spot and premiums."] };
  }
  if (spot < 0 && dominantPremium === "PE") return { alignment: "ALIGNED" as const, dominantPremium, reasons: ["Spot fell and verified same-contract PE outperformed CE after bearish MDI."] };
  if (spot > 0 && dominantPremium === "CE") return { alignment: "CONTRADICTED" as const, dominantPremium, reasons: ["Spot rose and verified same-contract CE outperformed PE after bearish MDI."] };
  return { alignment: "MIXED" as const, dominantPremium, reasons: ["Bearish MDI outcome signs are mixed across spot and premiums."] };
}

export function validateMdiReplayOutcome(signal: MdiOutcomeSignal, future: MdiOutcomeFuturePoint[]): MdiOutcomeValidationResult {
  const mdi = deriveMdiResearchShadow(signal.mdiInput);
  const blockers: string[] = [];
  const signalMs = parseMs(signal.signalTs);
  const currentMs = parseMs(signal.mdiInput.current.ts);
  const previousMs = parseMs(signal.mdiInput.previous.ts);
  if (signalMs == null || currentMs == null || previousMs == null) blockers.push("INVALID_SIGNAL_OR_MDI_TIMESTAMP");
  if (signalMs != null && currentMs != null && signalMs !== currentMs) blockers.push("SIGNAL_TIMESTAMP_NOT_BOUND_TO_MDI_CURRENT");
  if (previousMs != null && currentMs != null && previousMs >= currentMs) blockers.push("MDI_INPUT_NOT_FORWARD");
  if (mdi.mdi == null || mdi.bias === "UNAVAILABLE") blockers.push("MDI_UNAVAILABLE");
  if (mdi.coveragePct !== 100) blockers.push("MDI_NOT_FULLY_VERIFIED");
  if (!finite(signal.spotLtp) || !finite(signal.ce.ltp) || !finite(signal.pe.ltp)) blockers.push("SIGNAL_PRICE_INPUTS_INCOMPLETE");
  if (!verified(signal.spotQuality) || !verified(signal.ce.quality) || !verified(signal.pe.quality)) blockers.push("SIGNAL_OUTCOME_SOURCES_NOT_VERIFIED");
  if (signal.ce.optionType !== "CE" || signal.pe.optionType !== "PE") blockers.push("INVALID_SIGNAL_PREMIUM_LEGS");
  if (signal.ce.expiry !== signal.pe.expiry || signal.ce.strike !== signal.pe.strike) blockers.push("SIGNAL_PREMIUM_PAIR_NOT_MATCHED");

  const windows = HORIZONS.map((horizonMinutes): MdiOutcomeWindow => {
    const targetMs = signalMs == null ? null : signalMs + horizonMinutes * 60_000;
    const targetTs = targetMs == null ? "INVALID" : new Date(targetMs).toISOString();
    if (blockers.length || targetMs == null) return { horizonMinutes, targetTs, observedTs: null, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: [...blockers] };

    const points = future.filter((x) => parseMs(x.ts) === targetMs);
    if (points.length !== 1) {
      const reason = points.length === 0 ? "Exact replay horizon is unavailable; nearest-minute substitution is forbidden." : "Duplicate exact-horizon replay points detected; fail closed.";
      return { horizonMinutes, targetTs, observedTs: null, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: [reason] };
    }
    const point = points[0];
    if (!verified(point.spotQuality)) return { horizonMinutes, targetTs, observedTs: point.ts, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: ["Outcome spot source is not VERIFIED."] };

    const ceMatches = point.premiums.filter((p) => sameContract(signal.ce, p));
    const peMatches = point.premiums.filter((p) => sameContract(signal.pe, p));
    if (ceMatches.length !== 1 || peMatches.length !== 1) return { horizonMinutes, targetTs, observedTs: point.ts, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: ["Exactly one same-contract CE and one PE outcome are required; duplicates/substitutions fail closed."] };
    const ce = ceMatches[0];
    const pe = peMatches[0];
    if (!verified(ce.quality) || !verified(pe.quality)) return { horizonMinutes, targetTs, observedTs: point.ts, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: ["Outcome CE/PE sources are not VERIFIED."] };

    const spotReturnPct = pct(signal.spotLtp, point.spotLtp);
    const ceReturnPct = pct(signal.ce.ltp, ce.ltp);
    const peReturnPct = pct(signal.pe.ltp, pe.ltp);
    const verdict = classify(mdi.bias, spotReturnPct, ceReturnPct, peReturnPct);
    return { horizonMinutes, targetTs, observedTs: point.ts, spotReturnPct, ceReturnPct, peReturnPct, dominantPremium: verdict.dominantPremium, alignment: verdict.alignment, reasons: verdict.reasons };
  });

  return {
    signalTs: signal.signalTs,
    mdi: mdi.mdi,
    mdiBias: mdi.bias,
    mdiCoveragePct: mdi.coveragePct,
    windows,
    blockers,
    ruleVersion: "MDI_OUTCOME_REPLAY_VALIDATOR_V1",
    semantics: "REPLAY_OUTCOME_RESEARCH_ONLY",
    sourcePolicy: "FULLY_VERIFIED_MDI_AND_VERIFIED_SAME_CONTRACT_OUTCOMES_ONLY",
    materialityPolicy: "RAW_SIGN_ALIGNMENT_ONLY_NO_PROFIT_CLAIM",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
