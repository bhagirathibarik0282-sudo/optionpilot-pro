import { deriveMdiResearchShadow, type MdiInput, type MdiResult } from "./mdi-research-shadow.js";

export type SwingMdiBias = "BULLISH_PERSISTENCE" | "BEARISH_PERSISTENCE" | "TRANSITION_UP" | "TRANSITION_DOWN" | "NEUTRAL" | "UNAVAILABLE";

export interface SwingMdiSessionInput {
  tradeDate: string;
  mdiInput: MdiInput;
}

export interface SwingMdiWindow {
  sessions: 3 | 5 | 20;
  availableSessions: number;
  usableSessions: number;
  averageMdi: number | null;
  slopePerSession: number | null;
  positivePct: number | null;
  negativePct: number | null;
  persistencePct: number | null;
  bias: SwingMdiBias;
  reasons: string[];
}

export interface SwingMdiResearchResult {
  latestTradeDate: string | null;
  windows: SwingMdiWindow[];
  latestMdi: number | null;
  latestMdiBias: MdiResult["bias"];
  ruleVersion: "SWING_MDI_RESEARCH_V1";
  semantics: "MULTI_DAY_RESEARCH_ONLY";
  sourcePolicy: "DERIVE_FROM_VERIFIED_MDI_INPUTS_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function deriveSession(session: SwingMdiSessionInput): { tradeDate: string; result: MdiResult } | null {
  if (!validDate(session.tradeDate)) return null;
  const result = deriveMdiResearchShadow(session.mdiInput);
  return { tradeDate: session.tradeDate, result };
}

function linearSlope(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? null : round1(num / den);
}

function classify(values: number[], slope: number | null): { bias: SwingMdiBias; persistencePct: number | null; reasons: string[] } {
  if (values.length < 2) return { bias: "UNAVAILABLE", persistencePct: null, reasons: ["At least two usable verified MDI sessions are required."] };
  const positive = values.filter((v) => v >= 25).length;
  const negative = values.filter((v) => v <= -25).length;
  const persistencePct = round1((Math.max(positive, negative) / values.length) * 100);
  const last = values[values.length - 1];
  const first = values[0];

  if (positive / values.length >= 0.6 && last >= 25) {
    return { bias: "BULLISH_PERSISTENCE", persistencePct, reasons: ["At least 60% of usable sessions are bullish and the latest session remains bullish."] };
  }
  if (negative / values.length >= 0.6 && last <= -25) {
    return { bias: "BEARISH_PERSISTENCE", persistencePct, reasons: ["At least 60% of usable sessions are bearish and the latest session remains bearish."] };
  }
  if (first < 0 && last >= 25 && slope != null && slope > 0) {
    return { bias: "TRANSITION_UP", persistencePct, reasons: ["Verified MDI moved from negative territory to bullish territory with positive multi-session slope."] };
  }
  if (first > 0 && last <= -25 && slope != null && slope < 0) {
    return { bias: "TRANSITION_DOWN", persistencePct, reasons: ["Verified MDI moved from positive territory to bearish territory with negative multi-session slope."] };
  }
  return { bias: "NEUTRAL", persistencePct, reasons: ["Usable sessions do not show persistent or transition-grade directional structure under the research thresholds."] };
}

function buildWindow(derived: Array<{ tradeDate: string; result: MdiResult }>, sessions: 3 | 5 | 20): SwingMdiWindow {
  const slice = derived.slice(-sessions);
  const values = slice.map((x) => x.result.mdi).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const averageMdi = values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const slopePerSession = linearSlope(values);
  const positivePct = values.length ? round1((values.filter((v) => v >= 25).length / values.length) * 100) : null;
  const negativePct = values.length ? round1((values.filter((v) => v <= -25).length / values.length) * 100) : null;
  const classification = classify(values, slopePerSession);
  const reasons = [...classification.reasons];
  if (slice.length < sessions) reasons.push(`Only ${slice.length} of ${sessions} requested sessions are available.`);
  if (values.length < slice.length) reasons.push(`${slice.length - values.length} session(s) were excluded because verified MDI was unavailable.`);
  return {
    sessions,
    availableSessions: slice.length,
    usableSessions: values.length,
    averageMdi,
    slopePerSession,
    positivePct,
    negativePct,
    persistencePct: classification.persistencePct,
    bias: classification.bias,
    reasons,
  };
}

export function deriveSwingMdiResearch(inputs: SwingMdiSessionInput[]): SwingMdiResearchResult {
  const byDate = new Map<string, SwingMdiSessionInput>();
  for (const input of inputs) {
    if (validDate(input.tradeDate) && !byDate.has(input.tradeDate)) byDate.set(input.tradeDate, input);
  }
  const ordered = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const derived = ordered.map(deriveSession).filter((x): x is { tradeDate: string; result: MdiResult } => x !== null);
  const latest = derived[derived.length - 1] ?? null;
  return {
    latestTradeDate: latest?.tradeDate ?? null,
    windows: ([3, 5, 20] as const).map((sessions) => buildWindow(derived, sessions)),
    latestMdi: latest?.result.mdi ?? null,
    latestMdiBias: latest?.result.bias ?? "UNAVAILABLE",
    ruleVersion: "SWING_MDI_RESEARCH_V1",
    semantics: "MULTI_DAY_RESEARCH_ONLY",
    sourcePolicy: "DERIVE_FROM_VERIFIED_MDI_INPUTS_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
