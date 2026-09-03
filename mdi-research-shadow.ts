export type MdiBias = "STRONG_BULLISH" | "MILD_BULLISH" | "NEUTRAL" | "MILD_BEARISH" | "STRONG_BEARISH" | "UNAVAILABLE";

export interface MdiPoint {
  ts: string;
  fullPcr?: number | null;
  band7Pcr?: number | null;
  callWallStrike?: number | null;
  putWallStrike?: number | null;
  callWallStrength?: number | null;
  putWallStrength?: number | null;
  ceIv?: number | null;
  peIv?: number | null;
  indiaVix?: number | null;
  futureLtp?: number | null;
}

export interface MdiInput {
  previous: MdiPoint;
  current: MdiPoint;
  strikeStep: number;
}

export interface MdiComponent {
  name: "PCR_VELOCITY" | "WALL_MIGRATION" | "IV_DIFFERENTIAL" | "FUTURES_CHANGE" | "VIX_CHANGE";
  score: number | null;
  weight: number;
  reason: string;
}

export interface MdiResult {
  mdi: number | null;
  bias: MdiBias;
  coveragePct: number;
  components: MdiComponent[];
  reasons: string[];
  ruleVersion: "MDI_RESEARCH_SHADOW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clip = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const pctChange = (a: number, b: number) => a === 0 ? null : (b - a) / Math.abs(a);

function pcrScore(p: MdiPoint, c: MdiPoint): MdiComponent {
  const changes: number[] = [];
  if (finite(p.fullPcr) && finite(c.fullPcr)) changes.push(c.fullPcr - p.fullPcr);
  if (finite(p.band7Pcr) && finite(c.band7Pcr)) changes.push(c.band7Pcr - p.band7Pcr);
  if (!changes.length) return { name: "PCR_VELOCITY", score: null, weight: 20, reason: "PCR change unavailable." };
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  return { name: "PCR_VELOCITY", score: clip(avg / 0.15), weight: 20, reason: `Average PCR change ${avg.toFixed(3)}; research context only.` };
}

function wallScore(p: MdiPoint, c: MdiPoint, strikeStep: number): MdiComponent {
  if (!(strikeStep > 0)) return { name: "WALL_MIGRATION", score: null, weight: 25, reason: "Invalid strikeStep." };
  const parts: number[] = [];
  if (finite(p.callWallStrike) && finite(c.callWallStrike)) parts.push((c.callWallStrike - p.callWallStrike) / strikeStep);
  if (finite(p.putWallStrike) && finite(c.putWallStrike)) parts.push((c.putWallStrike - p.putWallStrike) / strikeStep);
  if (!parts.length) return { name: "WALL_MIGRATION", score: null, weight: 25, reason: "Wall migration unavailable." };
  let score = parts.reduce((a, b) => a + b, 0) / parts.length;
  if (finite(p.callWallStrength) && finite(c.callWallStrength) && p.callWallStrength !== 0) {
    const ch = (c.callWallStrength - p.callWallStrength) / Math.abs(p.callWallStrength);
    score += clip(-ch / 0.20) * 0.25;
  }
  if (finite(p.putWallStrength) && finite(c.putWallStrength) && p.putWallStrength !== 0) {
    const ch = (c.putWallStrength - p.putWallStrength) / Math.abs(p.putWallStrength);
    score += clip(ch / 0.20) * 0.25;
  }
  return { name: "WALL_MIGRATION", score: clip(score), weight: 25, reason: `Wall migration normalized to strike step ${strikeStep}.` };
}

function ivScore(p: MdiPoint, c: MdiPoint): MdiComponent {
  if (!finite(p.ceIv) || !finite(c.ceIv) || !finite(p.peIv) || !finite(c.peIv)) {
    return { name: "IV_DIFFERENTIAL", score: null, weight: 20, reason: "CE/PE IV pair unavailable." };
  }
  const ce = c.ceIv - p.ceIv;
  const pe = c.peIv - p.peIv;
  const diff = ce - pe;
  return { name: "IV_DIFFERENTIAL", score: clip(diff / 3), weight: 20, reason: `CE IV Δ ${ce.toFixed(2)}, PE IV Δ ${pe.toFixed(2)}.` };
}

function futuresScore(p: MdiPoint, c: MdiPoint): MdiComponent {
  if (!finite(p.futureLtp) || !finite(c.futureLtp)) return { name: "FUTURES_CHANGE", score: null, weight: 25, reason: "Futures change unavailable." };
  const ch = pctChange(p.futureLtp, c.futureLtp);
  if (ch === null) return { name: "FUTURES_CHANGE", score: null, weight: 25, reason: "Invalid previous futures value." };
  return { name: "FUTURES_CHANGE", score: clip(ch / 0.003), weight: 25, reason: `Futures change ${(ch * 100).toFixed(3)}%.` };
}

function vixScore(p: MdiPoint, c: MdiPoint): MdiComponent {
  if (!finite(p.indiaVix) || !finite(c.indiaVix)) return { name: "VIX_CHANGE", score: null, weight: 10, reason: "VIX change unavailable." };
  const ch = pctChange(p.indiaVix, c.indiaVix);
  if (ch === null) return { name: "VIX_CHANGE", score: null, weight: 10, reason: "Invalid previous VIX value." };
  return { name: "VIX_CHANGE", score: clip(-ch / 0.05), weight: 10, reason: `VIX change ${(ch * 100).toFixed(2)}%; inverse contribution is research-only.` };
}

function classify(v: number): MdiBias {
  if (v >= 60) return "STRONG_BULLISH";
  if (v >= 25) return "MILD_BULLISH";
  if (v <= -60) return "STRONG_BEARISH";
  if (v <= -25) return "MILD_BEARISH";
  return "NEUTRAL";
}

export function deriveMdiResearchShadow(input: MdiInput): MdiResult {
  const components = [
    pcrScore(input.previous, input.current),
    wallScore(input.previous, input.current, input.strikeStep),
    ivScore(input.previous, input.current),
    futuresScore(input.previous, input.current),
    vixScore(input.previous, input.current),
  ];
  const available = components.filter((c) => c.score !== null);
  const availableWeight = available.reduce((s, c) => s + c.weight, 0);
  const coveragePct = availableWeight;
  const base = {
    coveragePct,
    components,
    ruleVersion: "MDI_RESEARCH_SHADOW_V1" as const,
    semantics: "RESEARCH_SHADOW_ONLY" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    createsOrders: false as const,
    aiMayOverride: false as const,
  };
  if (availableWeight < 60) {
    return { ...base, mdi: null, bias: "UNAVAILABLE", reasons: [`Evidence coverage ${availableWeight}% is below 60%; fail closed.`] };
  }
  const weighted = available.reduce((s, c) => s + (c.score as number) * c.weight, 0) / availableWeight;
  const mdi = Math.round(clip(weighted) * 100);
  return { ...base, mdi, bias: classify(mdi), reasons: ["MDI is a normalized research score, not a live direction truth or trade trigger."] };
}
