import { deriveMdiResearchShadow, type MdiBias, type MdiInput } from "./mdi-research-shadow.js";

export type OutcomeHorizon = 3 | 6 | 15 | 30;
export type OutcomeAlignment = "ALIGNED" | "CONTRADICTED" | "MIXED" | "UNAVAILABLE";

export interface PremiumContractPoint {
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  ltp: number | null;
}

export interface MdiOutcomeSignal {
  mdiInput: MdiInput;
  signalTs: string;
  spotLtp: number | null;
  ce: PremiumContractPoint;
  pe: PremiumContractPoint;
}

export interface MdiOutcomeFuturePoint {
  ts: string;
  spotLtp: number | null;
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
  sourcePolicy: "FULLY_VERIFIED_MDI_AND_SAME_CONTRACT_OUTCOMES_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const HORIZONS: OutcomeHorizon[] = [3, 6, 15, 30];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

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

function classify(
  bias: MdiBias,
  spotReturnPct: number | null,
  ceReturnPct: number | null,
  peReturnPct: number | null,
): { alignment: OutcomeAlignment; dominantPremium: MdiOutcomeWindow["dominantPremium"]; reasons: string[] } {
  if (spotReturnPct == null || ceReturnPct == null || peReturnPct == null) {
    return { alignment: "UNAVAILABLE", dominantPremium: "UNAVAILABLE", reasons: ["Spot and both same-contract CE/PE outcomes are required."] };
  }
  const dominantPremium = ceReturnPct > peReturnPct ? "CE" : peReturnPct > ceReturnPct ? "PE" : "TIE";
  const direction = directionalBias(bias);
  if (direction === "NONE") {
    return { alignment: "MIXED", dominantPremium, reasons: ["Neutral/unavailable MDI has no directional outcome claim."] };
  }
  if (direction === "BULLISH") {
    if (spotReturnPct > 0 && dominantPremium === "CE") return { alignment: "ALIGNED", dominantPremium, reasons: ["Spot rose and same-contract CE outperformed PE after bullish MDI."] };
    if (spotReturnPct < 0 && dominantPremium === "PE") return { alignment: "CONTRADICTED", dominantPremium, reasons: ["Spot fell and same-contract PE outperformed CE after bullish MDI."] };
    return { alignment: "MIXED", dominantPremium, reasons: ["Bullish MDI outcome evidence is mixed across spot and premiums."] };
  }
  if (spotReturnPct < 0 && dominantPremium === "PE") return { alignment: "ALIGNED", dominantPremium, reasons: ["Spot fell and same-contract PE outperformed CE after bearish MDI."] };
  if (spotReturnPct > 0 && dominantPremium === "CE") return { alignment: "CONTRADICTED", dominantPremium, reasons: ["Spot rose and same-contract CE outperformed PE after bearish MDI."] };
  return { alignment: "MIXED", dominantPremium, reasons: ["Bearish MDI outcome evidence is mixed across spot and premiums."] };
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
  if (signal.ce.optionType !== "CE" || signal.pe.optionType !== "PE") blockers.push("INVALID_SIGNAL_PREMIUM_LEGS");

  const windows = HORIZONS.map((horizonMinutes): MdiOutcomeWindow => {
    const targetMs = signalMs == null ? null : signalMs + horizonMinutes * 60_000;
    const targetTs = targetMs == null ? "INVALID" : new Date(targetMs).toISOString();
    if (blockers.length || targetMs == null) {
      return { horizonMinutes, targetTs, observedTs: null, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: [...blockers] };
    }
    const point = future.find((x) => parseMs(x.ts) === targetMs) ?? null;
    if (!point) {
      return { horizonMinutes, targetTs, observedTs: null, spotReturnPct: null, ceReturnPct: null, peReturnPct: null, dominantPremium: "UNAVAILABLE", alignment: "UNAVAILABLE", reasons: ["Exact replay horizon is unavailable; nearest-minute substitution is forbidden."] };
    }
    const ce = point.premiums.find((p) => sameContract(signal.ce, p)) ?? null;
    const pe = point.premiums.find((p) => sameContract(signal.pe, p)) ?? null;
    const spotReturnPct = pct(signal.spotLtp, point.spotLtp);
    const ceReturnPct = pct(signal.ce.ltp, ce?.ltp ?? null);
    const peReturnPct = pct(signal.pe.ltp, pe?.ltp ?? null);
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
    sourcePolicy: "FULLY_VERIFIED_MDI_AND_SAME_CONTRACT_OUTCOMES_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
