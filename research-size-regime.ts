import type { DataQualityStatus, ResearchIndexCode, ResearchIndexMetrics } from "./research-index-types.js";

export type SizeRegimeState =
  | "BROAD_RISK_ON"
  | "NARROW_LARGECAP_RALLY"
  | "MIDCAP_EXPANSION"
  | "SMALLCAP_SPECULATION"
  | "EMERGING_LARGECAP_ROTATION"
  | "SIZE_ROTATION"
  | "BROAD_RISK_OFF"
  | "MIXED_UNCLASSIFIED";

export type RegimeStrength = "WEAK" | "MODERATE" | "STRONG" | "UNKNOWN";
export type RegimeTransition = "ACCELERATING" | "DECELERATING" | "STABLE" | "EARLY" | "UNKNOWN";

export interface SizeRegimeInput {
  metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics>>;
  dataQuality: DataQualityStatus;
}

export interface SizeRegimeOutput {
  state: SizeRegimeState;
  strength: RegimeStrength;
  transition: RegimeTransition;
  conflict: boolean;
  dataQuality: DataQualityStatus;
  evidence: string[];
  warnings: string[];
}

function rs(m: ResearchIndexMetrics | undefined, horizon: "5d" | "20d" | "60d"): number | null {
  if (!m) return null;
  if (horizon === "5d") return m.rsVsNifty50_5d;
  if (horizon === "20d") return m.rsVsNifty50_20d;
  return m.rsVsNifty50_60d;
}

function absoluteReturn(m: ResearchIndexMetrics | undefined, horizon: "5d" | "20d"): number | null {
  if (!m) return null;
  return horizon === "5d" ? m.return5d : m.return20d;
}

function positive(value: number | null, threshold = 0): boolean {
  return value !== null && value > threshold;
}

function negative(value: number | null, threshold = 0): boolean {
  return value !== null && value < threshold;
}

export function classifySizeRegime(input: SizeRegimeInput): SizeRegimeOutput {
  const evidence: string[] = [];
  const warnings: string[] = [];
  const { metrics, dataQuality } = input;

  if (dataQuality === "INVALID") {
    return {
      state: "MIXED_UNCLASSIFIED",
      strength: "UNKNOWN",
      transition: "UNKNOWN",
      conflict: true,
      dataQuality,
      evidence,
      warnings: ["Core broad-market data is invalid or stale; regime classification suppressed."],
    };
  }

  const next20 = rs(metrics.NEXT50, "20d");
  const mid20 = rs(metrics.MIDCAP150, "20d");
  const small20 = rs(metrics.SMALLCAP250, "20d");
  const broad20 = rs(metrics.NIFTY500, "20d");
  const mid5 = rs(metrics.MIDCAP150, "5d");
  const small5 = rs(metrics.SMALLCAP250, "5d");
  const broad5 = rs(metrics.NIFTY500, "5d");
  const broad60 = rs(metrics.NIFTY500, "60d");

  const broadAbs20 = absoluteReturn(metrics.NIFTY500, "20d");
  const midAbs20 = absoluteReturn(metrics.MIDCAP150, "20d");
  const smallAbs20 = absoluteReturn(metrics.SMALLCAP250, "20d");
  const broadAbs5 = absoluteReturn(metrics.NIFTY500, "5d");

  const broadening = positive(broad20) && positive(mid20) && positive(small20);
  const narrowing = negative(broad20) && negative(mid20) && negative(small20);
  const midLeadership = positive(mid20) && positive(mid5) && (small20 === null || mid20 >= small20);
  const smallLeadership = positive(small20) && positive(small5) && (mid20 === null || small20 > mid20);
  const nextLeadership = positive(next20) && (mid20 === null || next20 > mid20) && (small20 === null || next20 > small20);
  const riskOff =
    narrowing &&
    negative(broadAbs20) &&
    negative(midAbs20) &&
    negative(smallAbs20) &&
    (broadAbs5 === null || negative(broadAbs5));

  let state: SizeRegimeState = "MIXED_UNCLASSIFIED";

  if (riskOff) {
    state = "BROAD_RISK_OFF";
    evidence.push("Broad, mid and small-cap absolute returns are negative and all underperform NIFTY50.");
  } else if (broadening) {
    state = "BROAD_RISK_ON";
    evidence.push("Broad market, midcaps and smallcaps are outperforming NIFTY50 on 20D horizon.");
  } else if (narrowing) {
    state = "NARROW_LARGECAP_RALLY";
    evidence.push("Broad, mid and small-cap relative strength is weaker than NIFTY50 without sufficient absolute-return evidence for broad risk-off.");
  } else if (midLeadership) {
    state = "MIDCAP_EXPANSION";
    evidence.push("Midcap150 shows positive 5D and 20D relative strength leadership.");
  } else if (smallLeadership) {
    state = "SMALLCAP_SPECULATION";
    evidence.push("Smallcap250 is the strongest smaller-cap relative-strength leg.");
    warnings.push("Small-cap leadership alone is not treated as healthy risk-on; breadth, volatility and quality confirmation are required later.");
  } else if (nextLeadership) {
    state = "EMERGING_LARGECAP_ROTATION";
    evidence.push("NIFTY Next50 leads the size complex versus NIFTY50.");
  } else {
    state = "SIZE_ROTATION";
    evidence.push("Size segments disagree; treating the tape as rotation rather than forcing a directional regime.");
  }

  const finiteRs = [broad20, mid20, small20, next20].filter((v): v is number => v !== null && Number.isFinite(v));
  const avgAbs = finiteRs.length ? finiteRs.reduce((a, b) => a + Math.abs(b), 0) / finiteRs.length : 0;
  const strength: RegimeStrength = finiteRs.length < 3 ? "UNKNOWN" : avgAbs >= 3 ? "STRONG" : avgAbs >= 1 ? "MODERATE" : "WEAK";

  let transition: RegimeTransition = "UNKNOWN";
  if (broad5 !== null && broad20 !== null) {
    if (broad5 > broad20 && (mid5 ?? 0) > (mid20 ?? 0) && (small5 ?? 0) > (small20 ?? 0)) transition = "ACCELERATING";
    else if (broad5 < broad20 && (mid5 ?? 0) < (mid20 ?? 0) && (small5 ?? 0) < (small20 ?? 0)) transition = "DECELERATING";
    else if (Math.abs(broad5 - broad20) < 0.5) transition = "STABLE";
    else transition = "EARLY";
  }

  if (broad60 !== null && broad20 !== null && Math.sign(broad60) !== 0 && Math.sign(broad60) !== Math.sign(broad20)) {
    warnings.push("20D and 60D broad-market relative strength disagree; structural transition may be in progress.");
  }

  const signs = finiteRs.map((v) => Math.sign(v)).filter((s) => s !== 0);
  const conflict = signs.includes(1) && signs.includes(-1);
  if (dataQuality !== "GOOD") warnings.push(`Data quality is ${dataQuality}; confidence must not exceed this gate.`);

  return { state, strength, transition, conflict, dataQuality, evidence, warnings };
}
