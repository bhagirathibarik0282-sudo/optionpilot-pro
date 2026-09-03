import { deriveMdiResearchShadow, type MdiInput, type MdiBias } from "./mdi-research-shadow.js";
import type { ObservedCandidate30mSample } from "./h1-observed-candidate-30m-gross.js";

export interface ObservedCandidateMdiSample {
  sampleId: string;
  payoff: ObservedCandidate30mSample;
  mdiInput: MdiInput;
}

export interface ObservedCandidateMdiAvoidanceResult {
  state: "USABLE" | "UNAVAILABLE";
  baselineCount: number;
  mdiAlignedCount: number;
  avoidedCount: number;
  retainedWinners: number;
  retainedLosers: number;
  avoidedLosers: number;
  missedWinners: number;
  baselineWinners: number;
  baselineLosers: number;
  retentionPct: number | null;
  avoidedLoserRatePct: number | null;
  missedWinnerRatePct: number | null;
  baselineAverageGrossReturnPct: number | null;
  mdiAlignedAverageGrossReturnPct: number | null;
  grossReturnLiftPctPoints: number | null;
  blockers: string[];
  semantics: "OBSERVED_H1_EXACT30M_GROSS_MDI_AVOIDANCE_DESCRIPTIVE_ONLY";
  mdiPolicy: "MDI_RESEARCH_SHADOW_V1_EXACT_SIGNAL_TIMESTAMP_DIRECTIONAL_ALIGNMENT";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

function aligned(side: "CE" | "PE", bias: MdiBias): boolean {
  return side === "CE"
    ? bias === "MILD_BULLISH" || bias === "STRONG_BULLISH"
    : bias === "MILD_BEARISH" || bias === "STRONG_BEARISH";
}

const avg = (values: number[]): number | null => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;

export function analyzeObservedCandidateMdiAvoidance(samples: ObservedCandidateMdiSample[]): ObservedCandidateMdiAvoidanceResult {
  const blockers: string[] = [];
  const ids = new Set<string>();
  const usable: Array<{ ret:number; keep:boolean }> = [];

  for (const sample of samples) {
    if (!sample.sampleId?.trim()) { blockers.push("MISSING_SAMPLE_ID"); continue; }
    if (ids.has(sample.sampleId)) { blockers.push("DUPLICATE_SAMPLE_ID"); continue; }
    ids.add(sample.sampleId);
    if (sample.mdiInput.current.ts !== sample.payoff.signalTs) {
      blockers.push("MDI_TIMESTAMP_NOT_BOUND_TO_SIGNAL_TIMESTAMP");
      continue;
    }
    const mdi = deriveMdiResearchShadow(sample.mdiInput);
    usable.push({ ret: sample.payoff.grossReturnPct, keep: aligned(sample.payoff.side, mdi.bias) });
  }

  const baseline = usable.map(x=>x.ret);
  const retained = usable.filter(x=>x.keep).map(x=>x.ret);
  const avoided = usable.filter(x=>!x.keep).map(x=>x.ret);
  const baselineWinners = baseline.filter(x=>x>0).length;
  const baselineLosers = baseline.filter(x=>x<0).length;
  const retainedWinners = retained.filter(x=>x>0).length;
  const retainedLosers = retained.filter(x=>x<0).length;
  const avoidedLosers = avoided.filter(x=>x<0).length;
  const missedWinners = avoided.filter(x=>x>0).length;
  const baselineAvg = avg(baseline);
  const retainedAvg = avg(retained);

  if (!baseline.length) blockers.push("NO_OBSERVED_CANDIDATE_MDI_SAMPLES");
  if (!retained.length) blockers.push("NO_MDI_ALIGNED_OBSERVED_CANDIDATES");

  return {
    state: blockers.length ? "UNAVAILABLE" : "USABLE",
    baselineCount: baseline.length,
    mdiAlignedCount: retained.length,
    avoidedCount: avoided.length,
    retainedWinners,
    retainedLosers,
    avoidedLosers,
    missedWinners,
    baselineWinners,
    baselineLosers,
    retentionPct: baseline.length ? retained.length / baseline.length * 100 : null,
    avoidedLoserRatePct: baselineLosers ? avoidedLosers / baselineLosers * 100 : null,
    missedWinnerRatePct: baselineWinners ? missedWinners / baselineWinners * 100 : null,
    baselineAverageGrossReturnPct: baselineAvg,
    mdiAlignedAverageGrossReturnPct: retainedAvg,
    grossReturnLiftPctPoints: baselineAvg == null || retainedAvg == null ? null : retainedAvg - baselineAvg,
    blockers: [...new Set(blockers)],
    semantics: "OBSERVED_H1_EXACT30M_GROSS_MDI_AVOIDANCE_DESCRIPTIVE_ONLY",
    mdiPolicy: "MDI_RESEARCH_SHADOW_V1_EXACT_SIGNAL_TIMESTAMP_DIRECTIONAL_ALIGNMENT",
    affectsVerdict:false,
    affectsTelegram:false,
    affectsExecution:false,
    createsOrders:false,
    aiMayOverride:false,
  };
}
