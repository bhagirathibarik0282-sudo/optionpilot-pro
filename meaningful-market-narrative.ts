export type NarrativeSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export type NarrativeState =
  | "OBSERVING"
  | "COMPRESSION_BUILDING"
  | "BULLISH_PRESSURE"
  | "BEARISH_PRESSURE"
  | "BULLISH_TRANSITION"
  | "BEARISH_TRANSITION"
  | "BULLISH_RELEASE"
  | "BEARISH_RELEASE"
  | "BULLISH_WITH_DRAG"
  | "BEARISH_WITH_SUPPORT"
  | "STRONG_BULLISH"
  | "STRONG_BEARISH"
  | "DUAL_PREMIUM_ENERGY"
  | "EXHAUSTION_WATCH"
  | "TRUE_DIVERGENCE"
  | "DATA_QUALITY_BLOCKED";

export type DataQualityState = "OK" | "STALE" | "QUARANTINE";

export type FootprintSource =
  | "OI_WALL"
  | "HEAVYWEIGHT_BANK"
  | "FUTURES"
  | "SPOT"
  | "CURRENT_DTE_PREMIUM"
  | "NEXT_DTE_PREMIUM"
  | "OPPOSITE_PREMIUM";

export type FootprintRole = "SUPPORTS_LOCKED_DIRECTION" | "OPPOSES_LOCKED_DIRECTION" | "NEUTRAL";

export type FootprintLeader =
  | "OI_WALL_LED"
  | "HEAVYWEIGHT_BANK_LED"
  | "FUTURES_LED"
  | "PREMIUM_LED_CROSS_DTE_CONFIRMED"
  | "CURRENT_DTE_ONLY_NON_CONFIRMED"
  | "UNRESOLVED";

export interface FootprintEvent {
  source: FootprintSource;
  observedAtMs: number;
  meaningful: boolean;
  fresh: boolean;
  role: FootprintRole;
  detail?: string | null;
}

export interface MarketFootprintInput {
  symbol: NarrativeSymbol;
  lockedDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
  previousLeader: FootprintLeader | null;
  events: FootprintEvent[];
}

export interface MarketFootprintResult {
  version: "MARKET_FOOTPRINT_ATTRIBUTION_V1";
  semantics: "OBSERVED_SEQUENCE_NOT_CAUSAL_CLAIM";
  symbol: NarrativeSymbol;
  leader: FootprintLeader;
  classification: FootprintLeader | "FOOTPRINT_ROTATION";
  rotationDetected: boolean;
  rotationFrom: FootprintLeader | null;
  leadChain: FootprintSource[];
  opposingSources: FootprintSource[];
  reason: string;
  affectsVerdict: false;
  affectsExecution: false;
  haikuMayOverride: false;
}

const LEAD_PRIORITY: Readonly<Record<FootprintSource, number>> = {
  OI_WALL: 0,
  HEAVYWEIGHT_BANK: 1,
  FUTURES: 2,
  CURRENT_DTE_PREMIUM: 3,
  NEXT_DTE_PREMIUM: 4,
  SPOT: 5,
  OPPOSITE_PREMIUM: 6,
};

function sortEvents(events: FootprintEvent[]): FootprintEvent[] {
  return [...events].sort((a, b) => {
    if (a.observedAtMs !== b.observedAtMs) return a.observedAtMs - b.observedAtMs;
    return LEAD_PRIORITY[a.source] - LEAD_PRIORITY[b.source];
  });
}

function unresolved(input: MarketFootprintInput, reason: string, supporting: FootprintEvent[], opposing: FootprintEvent[]): MarketFootprintResult {
  return {
    version: "MARKET_FOOTPRINT_ATTRIBUTION_V1",
    semantics: "OBSERVED_SEQUENCE_NOT_CAUSAL_CLAIM",
    symbol: input.symbol,
    leader: "UNRESOLVED",
    classification: "UNRESOLVED",
    rotationDetected: false,
    rotationFrom: null,
    leadChain: sortEvents(supporting).map((event) => event.source),
    opposingSources: sortEvents(opposing).map((event) => event.source),
    reason,
    affectsVerdict: false,
    affectsExecution: false,
    haikuMayOverride: false,
  };
}

/**
 * Attributes observed sequence only; it never claims causality.
 * Upstream deterministic engines decide whether an event is fresh, meaningful,
 * and supportive/opposing. This layer only orders those verified events.
 */
export function attributeMarketFootprint(input: MarketFootprintInput): MarketFootprintResult {
  const usable = input.events.filter((event) => event.fresh && event.meaningful && Number.isFinite(event.observedAtMs));
  const supporting = usable.filter((event) => event.role === "SUPPORTS_LOCKED_DIRECTION");
  const opposing = usable.filter((event) => event.role === "OPPOSES_LOCKED_DIRECTION");

  if (input.lockedDirection === "NEUTRAL") {
    return unresolved(input, "LOCKED_DIRECTION_NEUTRAL", supporting, opposing);
  }

  const spot = sortEvents(supporting.filter((event) => event.source === "SPOT"))[0];
  if (!spot) {
    return unresolved(input, "NO_MEANINGFUL_SPOT_FOLLOW_THROUGH_YET", supporting, opposing);
  }

  const beforeOrAtSpot = sortEvents(
    supporting.filter((event) => event.observedAtMs <= spot.observedAtMs && event.source !== "SPOT" && event.source !== "OPPOSITE_PREMIUM"),
  );
  const leadChain = sortEvents(supporting).map((event) => event.source);
  const opposingSources = sortEvents(opposing).map((event) => event.source);

  if (beforeOrAtSpot.length === 0) {
    return unresolved(input, "SPOT_MOVED_WITHOUT_A_VERIFIED_PRIOR_LEAD", supporting, opposing);
  }

  const first = beforeOrAtSpot[0];
  let leader: FootprintLeader;
  let reason: string;

  if (first.source === "OI_WALL") {
    leader = "OI_WALL_LED";
    reason = "OI_WALL_WAS_FIRST_VERIFIED_SUPPORT_BEFORE_SPOT";
  } else if (first.source === "HEAVYWEIGHT_BANK") {
    leader = "HEAVYWEIGHT_BANK_LED";
    reason = "HEAVYWEIGHT_BANK_WAS_FIRST_VERIFIED_SUPPORT_BEFORE_SPOT";
  } else if (first.source === "FUTURES") {
    leader = "FUTURES_LED";
    reason = "FUTURES_WAS_FIRST_VERIFIED_SUPPORT_BEFORE_SPOT";
  } else if (first.source === "CURRENT_DTE_PREMIUM") {
    const nextDteConfirmed = supporting.some((event) => event.source === "NEXT_DTE_PREMIUM");
    if (nextDteConfirmed) {
      leader = "PREMIUM_LED_CROSS_DTE_CONFIRMED";
      reason = "CURRENT_DTE_PREMIUM_LED_AND_NEXT_DTE_CONFIRMED_IN_SAME_WINDOW";
    } else {
      leader = "CURRENT_DTE_ONLY_NON_CONFIRMED";
      reason = "CURRENT_DTE_PREMIUM_LED_WITHOUT_NEXT_DTE_CONFIRMATION";
    }
  } else {
    return unresolved(input, "NO_SUPPORTED_LEADER_CLASS_FOR_FIRST_EVENT", supporting, opposing);
  }

  const rotationDetected =
    input.previousLeader !== null &&
    input.previousLeader !== "UNRESOLVED" &&
    leader !== "UNRESOLVED" &&
    input.previousLeader !== leader;

  return {
    version: "MARKET_FOOTPRINT_ATTRIBUTION_V1",
    semantics: "OBSERVED_SEQUENCE_NOT_CAUSAL_CLAIM",
    symbol: input.symbol,
    leader,
    classification: rotationDetected ? "FOOTPRINT_ROTATION" : leader,
    rotationDetected,
    rotationFrom: rotationDetected ? input.previousLeader : null,
    leadChain,
    opposingSources,
    reason,
    affectsVerdict: false,
    affectsExecution: false,
    haikuMayOverride: false,
  };
}

export interface NumericTransition {
  previous: number;
  current: number;
  valueDecimals?: number;
  deltaDecimals?: number;
  percentDecimals?: number;
  suffix?: string;
  showPercent?: boolean;
  useGrouping?: boolean;
}

function formatNumber(value: number, decimals: number, grouping: boolean): string {
  return value.toLocaleString("en-IN", {
    useGrouping: grouping,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatNumericTransition(input: NumericTransition): string {
  if (!Number.isFinite(input.previous) || !Number.isFinite(input.current)) {
    throw new Error("transition values must be finite");
  }
  const valueDecimals = input.valueDecimals ?? 2;
  const deltaDecimals = input.deltaDecimals ?? valueDecimals;
  const percentDecimals = input.percentDecimals ?? 2;
  const suffix = input.suffix ?? "";
  const useGrouping = input.useGrouping ?? true;
  const delta = input.current - input.previous;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const signedDelta = `${delta > 0 ? "+" : ""}${formatNumber(delta, deltaDecimals, useGrouping)}${suffix}`;
  const base = `${formatNumber(input.previous, valueDecimals, useGrouping)}${suffix}→${formatNumber(input.current, valueDecimals, useGrouping)}${suffix} ${arrow} ${signedDelta}`;
  if (input.showPercent === false) return base;
  if (input.previous === 0) return `${base} (n/a%)`;
  const pct = (delta / Math.abs(input.previous)) * 100;
  const signedPct = `${pct > 0 ? "+" : ""}${formatNumber(pct, percentDecimals, false)}%`;
  return `${base} (${signedPct})`;
}

export interface NarrativeMetricLine {
  label: string;
  transition: NumericTransition;
  state?: string | null;
  bold?: boolean;
}

export interface PremiumNarrativeBlock {
  label: string;
  transition: NumericTransition;
  state?: string | null;
}

export interface MeaningfulNarrativeInput {
  symbol: NarrativeSymbol;
  at: string;
  state: NarrativeState;
  dataQuality: DataQualityState;
  previous?: { at: string; state: NarrativeState } | null;
  price: NumericTransition;
  futures?: NumericTransition | null;
  metrics?: NarrativeMetricLine[];
  candidate?: PremiumNarrativeBlock | null;
  opposite?: PremiumNarrativeBlock | null;
  meaningfulChanges: string[];
  footprint: MarketFootprintResult;
}

export interface MeaningfulNarrativeResult {
  version: "MEANINGFUL_MARKET_NARRATIVE_V1";
  semantics: "VERIFIED_FACT_RENDER_ONLY";
  text: string;
  fingerprint: string;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  canInventNumbers: false;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function renderMetric(metric: NarrativeMetricLine): string {
  const body = `${metric.label} ${formatNumericTransition(metric.transition)}${metric.state?.trim() ? ` | ${clean(metric.state)}` : ""}`;
  return metric.bold ? `**${body}**` : body;
}

export function buildMeaningfulMarketNarrative(input: MeaningfulNarrativeInput): MeaningfulNarrativeResult {
  if (input.footprint.symbol !== input.symbol) throw new Error("FOOTPRINT_SYMBOL_MISMATCH");
  if (input.meaningfulChanges.length === 0) throw new Error("MEANINGFUL_CHANGE_REQUIRED");

  const lines: string[] = [];
  lines.push(`**${input.symbol} • ${input.state.replaceAll("_", " ")}**`);
  lines.push(`${clean(input.at)} | DQ: ${input.dataQuality}`);
  if (input.previous) lines.push(`Linked: ${clean(input.previous.at)} **${input.previous.state.replaceAll("_", " ")}**`);
  lines.push("");
  lines.push(`${input.symbol} ${formatNumericTransition(input.price)}`);
  if (input.futures) lines.push(`FUT ${formatNumericTransition(input.futures)}`);

  if (input.metrics && input.metrics.length > 0) {
    lines.push("");
    for (const metric of input.metrics) lines.push(renderMetric(metric));
  }

  if (input.candidate) {
    lines.push("");
    lines.push(`**CANDIDATE: ${clean(input.candidate.label)}**`);
    lines.push(`${formatNumericTransition(input.candidate.transition)}${input.candidate.state?.trim() ? ` | **${clean(input.candidate.state)}**` : ""}`);
  }

  if (input.opposite) {
    lines.push(`OPP ${clean(input.opposite.label)} ${formatNumericTransition(input.opposite.transition)}${input.opposite.state?.trim() ? ` | **${clean(input.opposite.state)}**` : ""}`);
  }

  lines.push("");
  lines.push("**MEANINGFUL CHANGE**");
  for (const change of input.meaningfulChanges.map(clean).filter(Boolean)) lines.push(`• **${change}**`);

  lines.push("");
  lines.push("**WHAT MARKET FOLLOWED**");
  if (input.footprint.rotationDetected) {
    lines.push(`**FOOTPRINT ROTATION:** ${input.footprint.rotationFrom} → ${input.footprint.leader}`);
  } else {
    lines.push(`**FOOTPRINT: ${input.footprint.leader}**`);
  }
  if (input.footprint.leadChain.length > 0) lines.push(`Observed chain: ${input.footprint.leadChain.join(" → ")}`);
  if (input.footprint.opposingSources.length > 0) lines.push(`Opposing/dragging: ${input.footprint.opposingSources.join(", ")}`);
  lines.push(`Reason: ${input.footprint.reason}`);

  const text = lines.join("\n");
  const fingerprint = [
    input.symbol,
    input.state,
    input.at,
    input.footprint.classification,
    input.candidate?.label ?? "NONE",
    input.opposite?.label ?? "NONE",
    ...input.meaningfulChanges.map(clean),
  ].join("|");

  return {
    version: "MEANINGFUL_MARKET_NARRATIVE_V1",
    semantics: "VERIFIED_FACT_RENDER_ONLY",
    text,
    fingerprint,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    canInventNumbers: false,
  };
}

export interface NarrativeMemoryRecord {
  symbol: NarrativeSymbol;
  state: NarrativeState;
  stateSinceMs: number;
  lastMeaningfulAtMs: number;
  lastMessageId: string;
  candidateKey: string | null;
  oppositeKey: string | null;
  footprintLeader: FootprintLeader;
  fingerprint: string;
}

export class PerIndexNarrativeMemory {
  private readonly records = new Map<NarrativeSymbol, NarrativeMemoryRecord>();

  get(symbol: NarrativeSymbol): NarrativeMemoryRecord | null {
    const value = this.records.get(symbol);
    return value ? { ...value } : null;
  }

  commit(next: NarrativeMemoryRecord): NarrativeMemoryRecord | null {
    if (!next.lastMessageId.trim()) throw new Error("MESSAGE_ID_REQUIRED");
    if (!next.fingerprint.trim()) throw new Error("FINGERPRINT_REQUIRED");
    if (!Number.isFinite(next.stateSinceMs) || !Number.isFinite(next.lastMeaningfulAtMs)) {
      throw new Error("MEMORY_TIMESTAMP_INVALID");
    }
    const previous = this.records.get(next.symbol) ?? null;
    if (previous && next.lastMeaningfulAtMs < previous.lastMeaningfulAtMs) {
      throw new Error("OUT_OF_ORDER_MEANINGFUL_MESSAGE");
    }
    this.records.set(next.symbol, { ...next });
    return previous ? { ...previous } : null;
  }
}
