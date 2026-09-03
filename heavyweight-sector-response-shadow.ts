import type { TemporalDirection, TemporalEvidenceSnapshot, TemporalState } from "./temporal-evidence-fusion.js";

export type HeavyweightRoleState = "LEADING" | "CONFIRMING" | "LAGGING" | "FADING" | "CONFLICTING" | "UNAVAILABLE";
export type SectorResponseState = "EARLY_RESPONSE" | "CONFIRMED_RESPONSE" | "SUSTAINED_RESPONSE" | "FADING_RESPONSE" | "CONFLICTING" | "UNAVAILABLE";
export type ResponseBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTING" | "UNAVAILABLE";

export interface ResponseWindowSet {
  clue3m?: TemporalEvidenceSnapshot | null;
  confirm6m?: TemporalEvidenceSnapshot | null;
  validate15m?: TemporalEvidenceSnapshot | null;
  sustain30m?: TemporalEvidenceSnapshot | null;
}

export interface HeavyweightResponseInput {
  symbol: string;
  weightPct?: number | null;
  windows: ResponseWindowSet;
}

export interface SectorResponseInput {
  sector: string;
  windows: ResponseWindowSet;
}

export interface HeavyweightResponseSnapshot {
  symbol: string;
  weightPct: number | null;
  bias: ResponseBias;
  roleState: HeavyweightRoleState;
  usableWindows: number;
  reasons: string[];
}

export interface SectorResponseSnapshot {
  sector: string;
  bias: ResponseBias;
  state: SectorResponseState;
  usableWindows: number;
  reasons: string[];
}

export interface HeavyweightSectorResponseSnapshot {
  heavyweights: HeavyweightResponseSnapshot[];
  sectors: SectorResponseSnapshot[];
  aggregateHeavyweightBias: ResponseBias;
  aggregateSectorBias: ResponseBias;
  transition: "HEAVYWEIGHT_LEADS" | "SECTOR_CONFIRMS" | "ALIGNED" | "DIVERGENT" | "INSUFFICIENT_DATA";
  ruleVersion: "HEAVYWEIGHT_SECTOR_RESPONSE_SHADOW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const windowOrder: Array<keyof ResponseWindowSet> = ["clue3m", "confirm6m", "validate15m", "sustain30m"];

function usable(snapshot: TemporalEvidenceSnapshot | null | undefined): snapshot is TemporalEvidenceSnapshot {
  return !!snapshot && snapshot.state !== "INSUFFICIENT_DATA" && snapshot.direction !== "UNKNOWN";
}

function directionToBias(direction: TemporalDirection): ResponseBias {
  if (direction === "UP") return "BULLISH";
  if (direction === "DOWN") return "BEARISH";
  if (direction === "FLAT") return "NEUTRAL";
  return "UNAVAILABLE";
}

function aggregateBias(windows: ResponseWindowSet): ResponseBias {
  const biases = windowOrder.map((k) => windows[k]).filter(usable).map((s) => directionToBias(s.direction));
  const directional = biases.filter((b) => b === "BULLISH" || b === "BEARISH");
  if (directional.length === 0) return biases.includes("NEUTRAL") ? "NEUTRAL" : "UNAVAILABLE";
  const bull = directional.filter((b) => b === "BULLISH").length;
  const bear = directional.length - bull;
  if (bull > 0 && bear > 0) return "CONFLICTING";
  return bull > 0 ? "BULLISH" : "BEARISH";
}

function stateIsPositive(state: TemporalState): boolean {
  return state === "STRENGTHENING" || state === "STABLE";
}

function deriveHeavyweightRole(windows: ResponseWindowSet): { state: HeavyweightRoleState; reasons: string[] } {
  const w3 = windows.clue3m;
  const w6 = windows.confirm6m;
  const w15 = windows.validate15m;
  const w30 = windows.sustain30m;
  const reasons: string[] = [];

  const usableCount = [w3, w6, w15, w30].filter(usable).length;
  if (usableCount === 0) return { state: "UNAVAILABLE", reasons: ["No usable 3m/6m/15m/30m temporal evidence."] };

  const bias = aggregateBias(windows);
  if (bias === "CONFLICTING") return { state: "CONFLICTING", reasons: ["Response windows disagree directionally."] };

  if (usable(w3) && stateIsPositive(w3.state) && (!usable(w6) || w6.direction === w3.direction)) {
    reasons.push("3m clue emerged before full higher-window confirmation.");
    if (!usable(w15)) return { state: "LEADING", reasons };
  }

  if (usable(w3) && usable(w6) && w3.direction === w6.direction && stateIsPositive(w6.state)) {
    reasons.push("3m and 6m align with initial confirmation.");
    if (!usable(w15) || w15.direction !== w6.direction) return { state: "CONFIRMING", reasons };
  }

  if (usable(w15) && usable(w30) && w15.direction === w30.direction && stateIsPositive(w30.state)) {
    reasons.push("15m and 30m alignment shows sustained response after early windows.");
    return { state: "LAGGING", reasons };
  }

  const faded = [w3, w6, w15, w30].some((s) => usable(s) && (s.state === "WEAKENING" || s.state === "REVERSING"));
  if (faded) return { state: "FADING", reasons: ["At least one usable response window is weakening or reversing."] };

  return { state: "CONFIRMING", reasons: ["Directional evidence exists but transition maturity is incomplete."] };
}

function deriveSectorState(windows: ResponseWindowSet): { state: SectorResponseState; reasons: string[] } {
  const w3 = windows.clue3m;
  const w6 = windows.confirm6m;
  const w15 = windows.validate15m;
  const w30 = windows.sustain30m;
  const usableCount = [w3, w6, w15, w30].filter(usable).length;
  if (usableCount === 0) return { state: "UNAVAILABLE", reasons: ["No usable sector temporal evidence."] };
  if (aggregateBias(windows) === "CONFLICTING") return { state: "CONFLICTING", reasons: ["Sector response windows disagree directionally."] };
  if (usable(w30) && stateIsPositive(w30.state) && usable(w15) && w30.direction === w15.direction) {
    return { state: "SUSTAINED_RESPONSE", reasons: ["15m validation persists into 30m sustained confirmation."] };
  }
  if (usable(w15) && stateIsPositive(w15.state) && usable(w6) && w15.direction === w6.direction) {
    return { state: "CONFIRMED_RESPONSE", reasons: ["6m initial confirmation progressed into 15m validation."] };
  }
  if (usable(w3) && stateIsPositive(w3.state)) {
    return { state: "EARLY_RESPONSE", reasons: ["3m sector clue is present before higher-window validation."] };
  }
  if ([w3, w6, w15, w30].some((s) => usable(s) && (s.state === "WEAKENING" || s.state === "REVERSING"))) {
    return { state: "FADING_RESPONSE", reasons: ["Sector response is weakening or reversing."] };
  }
  return { state: "EARLY_RESPONSE", reasons: ["Usable sector direction exists but confirmation is incomplete."] };
}

function weightedAggregate(items: HeavyweightResponseSnapshot[]): ResponseBias {
  const valid = items.filter((i) => i.bias === "BULLISH" || i.bias === "BEARISH");
  if (valid.length === 0) return "UNAVAILABLE";
  let bull = 0;
  let bear = 0;
  for (const item of valid) {
    const weight = item.weightPct != null && Number.isFinite(item.weightPct) && item.weightPct > 0 ? item.weightPct : 1;
    if (item.bias === "BULLISH") bull += weight;
    if (item.bias === "BEARISH") bear += weight;
  }
  if (bull > 0 && bear > 0 && Math.min(bull, bear) / Math.max(bull, bear) >= 0.35) return "CONFLICTING";
  return bull >= bear ? "BULLISH" : "BEARISH";
}

function simpleAggregate(items: SectorResponseSnapshot[]): ResponseBias {
  const valid = items.filter((i) => i.bias === "BULLISH" || i.bias === "BEARISH");
  if (valid.length === 0) return "UNAVAILABLE";
  const bull = valid.filter((i) => i.bias === "BULLISH").length;
  const bear = valid.length - bull;
  if (bull > 0 && bear > 0) return "CONFLICTING";
  return bull > 0 ? "BULLISH" : "BEARISH";
}

export function deriveHeavyweightSectorResponse(
  heavyweightInputs: HeavyweightResponseInput[],
  sectorInputs: SectorResponseInput[],
): HeavyweightSectorResponseSnapshot {
  const heavyweights = heavyweightInputs.map((input) => {
    const role = deriveHeavyweightRole(input.windows);
    return {
      symbol: input.symbol,
      weightPct: typeof input.weightPct === "number" && Number.isFinite(input.weightPct) ? input.weightPct : null,
      bias: aggregateBias(input.windows),
      roleState: role.state,
      usableWindows: windowOrder.filter((k) => usable(input.windows[k])).length,
      reasons: role.reasons,
    } satisfies HeavyweightResponseSnapshot;
  });

  const sectors = sectorInputs.map((input) => {
    const state = deriveSectorState(input.windows);
    return {
      sector: input.sector,
      bias: aggregateBias(input.windows),
      state: state.state,
      usableWindows: windowOrder.filter((k) => usable(input.windows[k])).length,
      reasons: state.reasons,
    } satisfies SectorResponseSnapshot;
  });

  const aggregateHeavyweightBias = weightedAggregate(heavyweights);
  const aggregateSectorBias = simpleAggregate(sectors);
  const hwLeading = heavyweights.some((h) => h.roleState === "LEADING" || h.roleState === "CONFIRMING");
  const sectorConfirmed = sectors.some((s) => s.state === "CONFIRMED_RESPONSE" || s.state === "SUSTAINED_RESPONSE");

  let transition: HeavyweightSectorResponseSnapshot["transition"] = "INSUFFICIENT_DATA";
  if (aggregateHeavyweightBias === "UNAVAILABLE" || aggregateSectorBias === "UNAVAILABLE") transition = "INSUFFICIENT_DATA";
  else if (aggregateHeavyweightBias === "CONFLICTING" || aggregateSectorBias === "CONFLICTING" || aggregateHeavyweightBias !== aggregateSectorBias) transition = "DIVERGENT";
  else if (hwLeading && !sectorConfirmed) transition = "HEAVYWEIGHT_LEADS";
  else if (sectorConfirmed) transition = "SECTOR_CONFIRMS";
  else transition = "ALIGNED";

  return {
    heavyweights,
    sectors,
    aggregateHeavyweightBias,
    aggregateSectorBias,
    transition,
    ruleVersion: "HEAVYWEIGHT_SECTOR_RESPONSE_SHADOW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
