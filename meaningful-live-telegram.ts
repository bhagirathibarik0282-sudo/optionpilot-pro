import pg from "pg";
import {
  attributeMarketFootprint,
  buildMeaningfulMarketNarrative,
  PerIndexNarrativeMemory,
  type DataQualityState,
  type FootprintEvent,
  type FootprintLeader,
  type MarketFootprintResult,
  type NarrativeMemoryRecord,
  type NarrativeMetricLine,
  type NarrativeState,
  type NarrativeSymbol,
  type PremiumNarrativeBlock,
} from "./meaningful-market-narrative.js";
import { evaluateMessageTrigger } from "./message-trigger-engine.js";

const { Pool } = pg;

const INSTALL_FLAG = "__OPTIONPILOT_MEANINGFUL_LIVE_TELEGRAM_V1__";
const MAX_LIVE_TEXT = 3900;
const MEMORY_KIND = "meaningful_narrative_event";
const SYMBOLS: readonly NarrativeSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

export type LiveSide = "CE" | "PE";

export interface LiveMarketPoint {
  atMs: number;
  atLabel: string;
  freshnessStatus: string | null;
  spot: number;
  future: number | null;
  pdh: number | null;
  pdl: number | null;
}

export interface LiveChainPoint {
  atMs: number;
  validationStatus: string | null;
  pcr: number | null;
  callWallStrike: number | null;
  callWallOi: number | null;
  putWallStrike: number | null;
  putWallOi: number | null;
}

export interface LivePremiumPoint {
  atMs: number;
  contractKey: string;
  side: LiveSide;
  expiry: string;
  dte: number | null;
  strike: number;
  ltp: number;
  pdh: number | null;
  pdl: number | null;
  validationStatus: string | null;
}

export interface LiveNarrativeWindow {
  symbol: NarrativeSymbol;
  market: LiveMarketPoint[];
  chain: LiveChainPoint[];
  candidate: LivePremiumPoint[];
  opposite: LivePremiumPoint[];
  nextDte: LivePremiumPoint[];
}

export interface LiveMeaningfulDecision {
  ok: boolean;
  reason: string;
  symbol: NarrativeSymbol;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  dataQuality: DataQualityState;
  state: NarrativeState;
  candidateKey: string | null;
  oppositeKey: string | null;
  footprint: MarketFootprintResult | null;
  meaningfulChanges: string[];
  triggerFingerprint: string | null;
  narrativeText: string | null;
  narrativeHtml: string | null;
  candidateState: string | null;
  oppositeState: string | null;
  crossDteSupporting: boolean;
  structuralBoundaryChanged: boolean;
  oppositePremiumStateChanged: boolean;
  crossDteCoherenceChanged: boolean;
}

type TelegramPayload = {
  chat_id?: string | number;
  text?: string;
  parse_mode?: string;
  [key: string]: unknown;
};

type PersistedEvent = {
  memory?: NarrativeMemoryRecord;
  text?: string;
  html?: string;
  generatedAt?: string;
};

let pool: InstanceType<typeof Pool> | null = null;
let poolAttempted = false;
const memory = new PerIndexNarrativeMemory();
let memoryHydrated = false;
let memoryHydration: Promise<void> | null = null;

export class MeaningfulConfirmationTracker {
  private readonly pending = new Map<NarrativeSymbol, { key: string; count: number }>();

  observe(symbol: NarrativeSymbol, key: string): number {
    const previous = this.pending.get(symbol);
    const count = previous?.key === key ? previous.count + 1 : 1;
    this.pending.set(symbol, { key, count });
    return count;
  }

  reset(symbol: NarrativeSymbol): void {
    this.pending.delete(symbol);
  }
}

const confirmationTracker = new MeaningfulConfirmationTracker();

function getPool(): InstanceType<typeof Pool> | null {
  if (pool) return pool;
  if (poolAttempted) return null;
  poolAttempted = true;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString: url, max: 2, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
    pool.on("error", (err: Error) => console.error("[Meaningful Telegram] DB pool error:", err.message));
    return pool;
  } catch (err) {
    console.error("[Meaningful Telegram] DB unavailable:", err instanceof Error ? err.message : String(err));
    pool = null;
    return null;
  }
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function ms(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function istLabel(atMs: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(atMs)) + " IST";
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function inferSymbol(text: string): NarrativeSymbol | null {
  if (/\bBANKNIFTY\b/i.test(text)) return "BANKNIFTY";
  if (/\bSENSEX\b/i.test(text)) return "SENSEX";
  if (/\bNIFTY\b/i.test(text)) return "NIFTY";
  return null;
}

function looksLikeFastMarketSnapshot(text: string): boolean {
  if (/WHAT MARKET FOLLOWED|OPTIONPILOT MEANINGFUL V1/i.test(text)) return false;
  const markers = ["PCR", "Wall", "WALL", "Intrinsic", "Extrinsic", "OI", "Premium", "PREMIUM"];
  return markers.filter((marker) => text.includes(marker)).length >= 3;
}

function inferSideFromOriginal(text: string): LiveSide | null {
  const ce = /\b(STRONG\s+BUY\s+CE|BUY\s+CE|BEST[_\s-]?CE|CE[_\s-]?FAVOURED|ALIGNED[_\s-]?CE|CANDIDATE[^\n]*\bCE\b)\b/i.test(text);
  const pe = /\b(STRONG\s+BUY\s+PE|BUY\s+PE|BEST[_\s-]?PE|PE[_\s-]?FAVOURED|ALIGNED[_\s-]?PE|CANDIDATE[^\n]*\bPE\b)\b/i.test(text);
  if (ce === pe) return null;
  return ce ? "CE" : "PE";
}

function sideDirection(side: LiveSide): "BULLISH" | "BEARISH" {
  return side === "CE" ? "BULLISH" : "BEARISH";
}

function directionSign(direction: "BULLISH" | "BEARISH"): number {
  return direction === "BULLISH" ? 1 : -1;
}

function qualityFrom(window: LiveNarrativeWindow): DataQualityState {
  const statuses = [
    window.market.at(-1)?.freshnessStatus,
    window.chain.at(-1)?.validationStatus,
    window.candidate.at(-1)?.validationStatus,
  ].filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase());

  if (statuses.some((value) => /QUARANTINE|INVALID|ANOMALOUS|CONTRACT_MISMATCH|ASYNC/.test(value))) return "QUARANTINE";
  if (statuses.some((value) => /STALE/.test(value))) return "STALE";
  return "OK";
}

function pct(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function lastTwo<T>(values: T[]): [T, T] | null {
  if (values.length < 2) return null;
  return [values[values.length - 2], values[values.length - 1]];
}

function lastThree<T>(values: T[]): [T, T, T] | null {
  if (values.length < 3) return null;
  return [values[values.length - 3], values[values.length - 2], values[values.length - 1]];
}

function roleForSignedChange(change: number, direction: "BULLISH" | "BEARISH"): FootprintEvent["role"] {
  if (change === 0) return "NEUTRAL";
  return Math.sign(change) === directionSign(direction) ? "SUPPORTS_LOCKED_DIRECTION" : "OPPOSES_LOCKED_DIRECTION";
}

function premiumRole(change: number, isOpposite: boolean): FootprintEvent["role"] {
  if (change === 0) return "NEUTRAL";
  if (isOpposite) return change < 0 ? "SUPPORTS_LOCKED_DIRECTION" : "OPPOSES_LOCKED_DIRECTION";
  return change > 0 ? "SUPPORTS_LOCKED_DIRECTION" : "OPPOSES_LOCKED_DIRECTION";
}

function event(source: FootprintEvent["source"], atMs: number, role: FootprintEvent["role"], detail: string): FootprintEvent {
  return { source, observedAtMs: atMs, meaningful: role !== "NEUTRAL", fresh: true, role, detail };
}

function chainEvent(previous: LiveChainPoint, current: LiveChainPoint, direction: "BULLISH" | "BEARISH"): FootprintEvent | null {
  const pcrDelta = previous.pcr == null || current.pcr == null ? null : current.pcr - previous.pcr;
  const callPct = pct(previous.callWallOi, current.callWallOi);
  const putPct = pct(previous.putWallOi, current.putWallOi);
  if (pcrDelta == null || callPct == null || putPct == null) return null;

  // One OI-imbalance layer: PCR and wall asymmetry must agree in sign.
  // This avoids double-counting PCR and wall OI as separate independent votes.
  const wallAsym = putPct - callPct;
  const expected = directionSign(direction);
  const pcrRole = Math.sign(pcrDelta) === expected ? 1 : Math.sign(pcrDelta) === -expected ? -1 : 0;
  const wallRole = Math.sign(wallAsym) === expected ? 1 : Math.sign(wallAsym) === -expected ? -1 : 0;
  const role: FootprintEvent["role"] = pcrRole === 1 && wallRole === 1
    ? "SUPPORTS_LOCKED_DIRECTION"
    : pcrRole === -1 && wallRole === -1
      ? "OPPOSES_LOCKED_DIRECTION"
      : "NEUTRAL";

  return event(
    "OI_WALL",
    current.atMs,
    role,
    `PCR Δ${pcrDelta.toFixed(3)} | Call wall ${callPct.toFixed(2)}% | Put wall ${putPct.toFixed(2)}%`,
  );
}

export function buildFootprintEvents(window: LiveNarrativeWindow, direction: "BULLISH" | "BEARISH"): FootprintEvent[] {
  const events: FootprintEvent[] = [];

  for (let i = 1; i < window.market.length; i++) {
    const previous = window.market[i - 1];
    const current = window.market[i];
    const spotChange = current.spot - previous.spot;
    events.push(event("SPOT", current.atMs, roleForSignedChange(spotChange, direction), `Spot Δ${spotChange.toFixed(2)}`));
    if (previous.future != null && current.future != null) {
      const futureChange = current.future - previous.future;
      events.push(event("FUTURES", current.atMs, roleForSignedChange(futureChange, direction), `Future Δ${futureChange.toFixed(2)}`));
    }
  }

  for (let i = 1; i < window.chain.length; i++) {
    const e = chainEvent(window.chain[i - 1], window.chain[i], direction);
    if (e) events.push(e);
  }

  const addPremiumEvents = (source: FootprintEvent["source"], points: LivePremiumPoint[], opposite: boolean) => {
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const change = current.ltp - previous.ltp;
      events.push(event(source, current.atMs, premiumRole(change, opposite), `${current.contractKey} Δ₹${change.toFixed(2)}`));
    }
  };

  addPremiumEvents("CURRENT_DTE_PREMIUM", window.candidate, false);
  addPremiumEvents("OPPOSITE_PREMIUM", window.opposite, true);
  addPremiumEvents("NEXT_DTE_PREMIUM", window.nextDte, false);
  return events;
}

function unresolvedFootprint(symbol: NarrativeSymbol, supporting: FootprintEvent[], opposing: FootprintEvent[], reason: string): MarketFootprintResult {
  const ordered = (items: FootprintEvent[]) => [...items].sort((a, b) => a.observedAtMs - b.observedAtMs).map((item) => item.source);
  return {
    version: "MARKET_FOOTPRINT_ATTRIBUTION_V1",
    semantics: "OBSERVED_SEQUENCE_NOT_CAUSAL_CLAIM",
    symbol,
    leader: "UNRESOLVED",
    classification: "UNRESOLVED",
    rotationDetected: false,
    rotationFrom: null,
    leadChain: ordered(supporting),
    opposingSources: ordered(opposing),
    reason,
    affectsVerdict: false,
    affectsExecution: false,
    haikuMayOverride: false,
  };
}

/** Rejects false leadership when two evidence families first speak in the same timestamp bucket. */
export function attributeMarketFootprintConservatively(
  symbol: NarrativeSymbol,
  direction: "BULLISH" | "BEARISH",
  previousLeader: FootprintLeader | null,
  events: FootprintEvent[],
): MarketFootprintResult {
  const usable = events.filter((e) => e.fresh && e.meaningful);
  const supporting = usable.filter((e) => e.role === "SUPPORTS_LOCKED_DIRECTION");
  const opposing = usable.filter((e) => e.role === "OPPOSES_LOCKED_DIRECTION");
  const spot = [...supporting].filter((e) => e.source === "SPOT").sort((a, b) => a.observedAtMs - b.observedAtMs)[0];
  if (!spot) return unresolvedFootprint(symbol, supporting, opposing, "NO_MEANINGFUL_SPOT_FOLLOW_THROUGH_YET");

  const leaders = supporting.filter((e) =>
    e.source !== "SPOT" && e.source !== "OPPOSITE_PREMIUM" && e.observedAtMs <= spot.observedAtMs
  );
  if (leaders.length === 0) return unresolvedFootprint(symbol, supporting, opposing, "SPOT_MOVED_WITHOUT_A_VERIFIED_PRIOR_LEAD");
  const firstAt = Math.min(...leaders.map((e) => e.observedAtMs));
  const firstSources = new Set(leaders.filter((e) => e.observedAtMs === firstAt).map((e) => e.source));
  if (firstSources.size > 1) {
    return unresolvedFootprint(symbol, supporting, opposing, "LEAD_TIMESTAMP_TIE_UNRESOLVED");
  }

  return attributeMarketFootprint({ symbol, lockedDirection: direction, previousLeader, events });
}

function premiumState(points: LivePremiumPoint[], opposite = false): string | null {
  const pair = lastTwo(points);
  if (!pair) return null;
  const [previous, current] = pair;
  const change = current.ltp - previous.ltp;
  const triple = lastThree(points);
  if (triple) {
    const [a, b, c] = triple;
    if (opposite && a.ltp > b.ltp && c.ltp > b.ltp) return "LL FAILURE / RECOVERING";
    if (opposite && a.ltp < b.ltp && c.ltp < b.ltp) return "HH FAILURE / FADING";
  }
  if (change > 0) return opposite ? "RECOVERING" : "EXPANDING / HH";
  if (change < 0) return opposite ? "FADING / LL" : "FADING";
  return "RESTING";
}

function crossed(previous: number, current: number, boundary: number | null): "UP" | "DOWN" | null {
  if (boundary == null) return null;
  if (previous < boundary && current >= boundary) return "UP";
  if (previous > boundary && current <= boundary) return "DOWN";
  return null;
}

function latestRole(events: FootprintEvent[], source: FootprintEvent["source"]): FootprintEvent["role"] | null {
  const matches = events.filter((e) => e.source === source && e.meaningful).sort((a, b) => b.observedAtMs - a.observedAtMs);
  return matches[0]?.role ?? null;
}

function stateFor(
  direction: "BULLISH" | "BEARISH",
  dq: DataQualityState,
  events: FootprintEvent[],
  candidateState: string | null,
  oppositeState: string | null,
  crossDteSupporting: boolean,
  footprint: MarketFootprintResult,
): NarrativeState {
  if (dq !== "OK") return "DATA_QUALITY_BLOCKED";
  const bullish = direction === "BULLISH";
  const release = bullish ? "BULLISH_RELEASE" : "BEARISH_RELEASE";
  const transition = bullish ? "BULLISH_TRANSITION" : "BEARISH_TRANSITION";
  const pressure = bullish ? "BULLISH_PRESSURE" : "BEARISH_PRESSURE";
  const drag = bullish ? "BULLISH_WITH_DRAG" : "BEARISH_WITH_SUPPORT";

  if (candidateState?.startsWith("FADING") && oppositeState?.includes("FAILURE / RECOVERING")) {
    return "EXHAUSTION_WATCH";
  }
  if (candidateState?.includes("EXPANDING") && oppositeState === "RECOVERING") {
    return "DUAL_PREMIUM_ENERGY";
  }

  const spotSupport = latestRole(events, "SPOT") === "SUPPORTS_LOCKED_DIRECTION";
  const futureSupport = latestRole(events, "FUTURES") === "SUPPORTS_LOCKED_DIRECTION";
  const premiumSupport = latestRole(events, "CURRENT_DTE_PREMIUM") === "SUPPORTS_LOCKED_DIRECTION";
  const oiSupport = latestRole(events, "OI_WALL") === "SUPPORTS_LOCKED_DIRECTION";
  const oppositeDrag = latestRole(events, "OPPOSITE_PREMIUM") === "OPPOSES_LOCKED_DIRECTION";

  if (spotSupport && futureSupport && premiumSupport && (oiSupport || crossDteSupporting) && footprint.leader !== "UNRESOLVED") return release;
  if (spotSupport && futureSupport && premiumSupport) return transition;
  if (spotSupport && futureSupport && (oppositeDrag || !premiumSupport)) return drag;
  if (premiumSupport || oiSupport || futureSupport) return pressure;
  return "OBSERVING";
}

function latestTransitionBlock(points: LivePremiumPoint[], state: string | null): PremiumNarrativeBlock | null {
  const pair = lastTwo(points);
  if (!pair) return null;
  const [previous, current] = pair;
  return {
    label: `${current.strike} ${current.side}${current.dte != null ? ` • DTE${current.dte}` : ""}`,
    transition: { previous: previous.ltp, current: current.ltp, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1 },
    state,
  };
}

function metricLines(window: LiveNarrativeWindow): NarrativeMetricLine[] {
  const metrics: NarrativeMetricLine[] = [];
  const chain = lastTwo(window.chain);
  if (chain) {
    const [previous, current] = chain;
    if (previous.pcr != null && current.pcr != null) {
      metrics.push({
        label: "PCR",
        transition: { previous: previous.pcr, current: current.pcr, valueDecimals: 3, deltaDecimals: 3, percentDecimals: 1, useGrouping: false },
      });
    }
    if (previous.callWallOi != null && current.callWallOi != null) {
      metrics.push({
        label: `CW${current.callWallStrike != null ? ` ${current.callWallStrike}` : ""}`,
        transition: { previous: previous.callWallOi / 100000, current: current.callWallOi / 100000, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1, suffix: "L" },
      });
    }
    if (previous.putWallOi != null && current.putWallOi != null) {
      metrics.push({
        label: `PW${current.putWallStrike != null ? ` ${current.putWallStrike}` : ""}`,
        transition: { previous: previous.putWallOi / 100000, current: current.putWallOi / 100000, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1, suffix: "L" },
      });
    }
  }
  const next = lastTwo(window.nextDte);
  if (next) {
    const [previous, current] = next;
    metrics.push({
      label: `Next ${current.side}`,
      transition: { previous: previous.ltp, current: current.ltp, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 1 },
    });
  }
  return metrics;
}

function markdownBoldToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}

export function toTelegramHtml(text: string): string {
  return markdownBoldToHtml(text);
}

function uniqueChanges(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function deriveLiveMeaningfulDecision(
  window: LiveNarrativeWindow,
  previousMemory: NarrativeMemoryRecord | null,
): LiveMeaningfulDecision {
  const symbol = window.symbol;
  const marketPair = lastTwo(window.market);
  const candidatePair = lastTwo(window.candidate);
  if (!marketPair || !candidatePair) {
    return {
      ok: false, reason: "INSUFFICIENT_LIVE_WINDOW", symbol, direction: "NEUTRAL", dataQuality: "QUARANTINE",
      state: "DATA_QUALITY_BLOCKED", candidateKey: null, oppositeKey: null, footprint: null,
      meaningfulChanges: [], triggerFingerprint: null, narrativeText: null, narrativeHtml: null,
      candidateState: null, oppositeState: null, crossDteSupporting: false,
      structuralBoundaryChanged: false, oppositePremiumStateChanged: false, crossDteCoherenceChanged: false,
    };
  }

  const [previousMarket, currentMarket] = marketPair;
  const [previousCandidate, currentCandidate] = candidatePair;
  const direction = sideDirection(currentCandidate.side);
  const dq = qualityFrom(window);
  const events = buildFootprintEvents(window, direction);
  const previousLeader = previousMemory?.footprintLeader ?? null;
  const footprint = attributeMarketFootprintConservatively(symbol, direction, previousLeader, events);
  const candidateState = premiumState(window.candidate, false);
  const oppositeState = premiumState(window.opposite, true);
  const nextPair = lastTwo(window.nextDte);
  const crossDteSupporting = Boolean(nextPair && nextPair[1].ltp > nextPair[0].ltp);
  const nextTriple = lastThree(window.nextDte);
  const crossDteCoherenceChanged = Boolean(nextTriple && ((nextTriple[2].ltp > nextTriple[1].ltp) !== (nextTriple[1].ltp > nextTriple[0].ltp)));
  const oppositePremiumStateChanged = oppositeState?.includes("FAILURE") === true;

  const changes: string[] = [];
  const state = stateFor(direction, dq, events, candidateState, oppositeState, crossDteSupporting, footprint);
  if (!previousMemory) {
    if (state !== "OBSERVING") changes.push(`INITIAL ${state.replaceAll("_", " ")}`);
  } else if (previousMemory.state !== state) {
    changes.push(`${previousMemory.state.replaceAll("_", " ")} → ${state.replaceAll("_", " ")}`);
  }
  if (previousMemory && previousMemory.candidateKey !== currentCandidate.contractKey) {
    changes.push(`CANDIDATE ROTATION → ${currentCandidate.strike} ${currentCandidate.side}`);
  }
  if (footprint.rotationDetected) changes.push(`FOOTPRINT ROTATION ${footprint.rotationFrom} → ${footprint.leader}`);
  if (oppositePremiumStateChanged && oppositeState) changes.push(`OPPOSITE PREMIUM ${oppositeState}`);
  if (crossDteCoherenceChanged) changes.push(crossDteSupporting ? "NEXT-DTE JOINED" : "NEXT-DTE FADED");

  let structuralBoundaryChanged = false;
  const spotPdhCross = crossed(previousMarket.spot, currentMarket.spot, currentMarket.pdh);
  const spotPdlCross = crossed(previousMarket.spot, currentMarket.spot, currentMarket.pdl);
  if (spotPdhCross === "UP") { changes.push(`${symbol} PDH BREAK`); structuralBoundaryChanged = true; }
  if (spotPdlCross === "DOWN") { changes.push(`${symbol} PDL BREAK`); structuralBoundaryChanged = true; }
  const premiumPdhCross = crossed(previousCandidate.ltp, currentCandidate.ltp, currentCandidate.pdh);
  const premiumPdlCross = crossed(previousCandidate.ltp, currentCandidate.ltp, currentCandidate.pdl);
  if (premiumPdhCross === "UP") { changes.push(`${currentCandidate.side}-PDH BREAK`); structuralBoundaryChanged = true; }
  if (premiumPdlCross === "DOWN") { changes.push(`${currentCandidate.side}-PDL BREAK`); structuralBoundaryChanged = true; }

  if (dq !== "OK" && previousMemory?.state !== "DATA_QUALITY_BLOCKED") changes.push(`DATA QUALITY ${dq}`);
  const meaningfulChanges = uniqueChanges(changes);
  if (meaningfulChanges.length === 0) {
    return {
      ok: true, reason: "NO_MEANINGFUL_CHANGE", symbol, direction, dataQuality: dq, state,
      candidateKey: currentCandidate.contractKey, oppositeKey: window.opposite.at(-1)?.contractKey ?? null,
      footprint, meaningfulChanges, triggerFingerprint: null, narrativeText: null, narrativeHtml: null,
      candidateState, oppositeState, crossDteSupporting, structuralBoundaryChanged,
      oppositePremiumStateChanged, crossDteCoherenceChanged,
    };
  }

  const previousLink = previousMemory
    ? { at: istLabel(previousMemory.lastMeaningfulAtMs), state: previousMemory.state }
    : null;
  const narrative = buildMeaningfulMarketNarrative({
    symbol,
    at: currentMarket.atLabel,
    state,
    dataQuality: dq,
    previous: previousLink,
    price: { previous: previousMarket.spot, current: currentMarket.spot, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 2 },
    futures: previousMarket.future != null && currentMarket.future != null
      ? { previous: previousMarket.future, current: currentMarket.future, valueDecimals: 2, deltaDecimals: 2, percentDecimals: 2 }
      : null,
    metrics: metricLines(window),
    candidate: latestTransitionBlock(window.candidate, candidateState),
    opposite: latestTransitionBlock(window.opposite, oppositeState),
    meaningfulChanges,
    footprint,
  });

  const triggerFingerprint = `${currentCandidate.contractKey}:${narrative.fingerprint}`;
  const cart = `\n\n🛒 **CARTED / WATCH: ${currentCandidate.strike} ${currentCandidate.side}${currentCandidate.dte != null ? ` • DTE${currentCandidate.dte}` : ""}**\nNOT TRADE EXECUTION`;
  const text = `🧭 OPTIONPILOT MEANINGFUL V1\n${narrative.text}${cart}`;
  const html = toTelegramHtml(text);

  return {
    ok: true,
    reason: "MEANINGFUL_CANDIDATE_READY",
    symbol,
    direction,
    dataQuality: dq,
    state,
    candidateKey: currentCandidate.contractKey,
    oppositeKey: window.opposite.at(-1)?.contractKey ?? null,
    footprint,
    meaningfulChanges,
    triggerFingerprint,
    narrativeText: text,
    narrativeHtml: html,
    candidateState,
    oppositeState,
    crossDteSupporting,
    structuralBoundaryChanged,
    oppositePremiumStateChanged,
    crossDteCoherenceChanged,
  };
}

async function hydrateMemory(): Promise<void> {
  if (memoryHydrated) return;
  if (memoryHydration) return memoryHydration;
  memoryHydration = (async () => {
    const p = getPool();
    if (!p) { memoryHydrated = true; return; }
    try {
      const result = await p.query(
        "SELECT payload FROM app_state_log WHERE kind=$1 ORDER BY created_at DESC LIMIT 30",
        [MEMORY_KIND],
      );
      const rows = [...result.rows].reverse() as Array<{ payload?: PersistedEvent }>;
      for (const row of rows) {
        const record = row.payload?.memory;
        if (!record || !SYMBOLS.includes(record.symbol)) continue;
        try { memory.commit(record); } catch { /* ignore stale/out-of-order persisted rows */ }
      }
    } catch (err) {
      console.error("[Meaningful Telegram] memory hydration failed; live bridge will fail-open:", err instanceof Error ? err.message : String(err));
    } finally {
      memoryHydrated = true;
    }
  })();
  return memoryHydration;
}

async function persistMeaningfulEvent(record: NarrativeMemoryRecord, text: string, html: string): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    const payload: PersistedEvent = { memory: record, text, html, generatedAt: new Date(record.lastMeaningfulAtMs).toISOString() };
    await p.query("INSERT INTO app_state_log (kind,payload) VALUES ($1,$2::jsonb)", [MEMORY_KIND, JSON.stringify(payload)]);
  } catch (err) {
    console.error("[Meaningful Telegram] journal persistence failed; sent message remains valid:", err instanceof Error ? err.message : String(err));
  }
}

function mapMarketRows(rows: Array<Record<string, unknown>>): LiveMarketPoint[] {
  return rows.map((row) => {
    const at = ms(row.exchange_timestamp) ?? ms(row.minute_bucket);
    const spot = finite(row.spot_ltp);
    if (at == null || spot == null) return null;
    return {
      atMs: at,
      atLabel: istLabel(at),
      freshnessStatus: typeof row.freshness_status === "string" ? row.freshness_status : null,
      spot,
      future: finite(row.future_ltp),
      pdh: finite(row.pdh),
      pdl: finite(row.pdl),
    };
  }).filter((value): value is LiveMarketPoint => value !== null);
}

function mapChainRows(rows: Array<Record<string, unknown>>): LiveChainPoint[] {
  return rows.map((row) => {
    const at = ms(row.minute_bucket);
    if (at == null) return null;
    return {
      atMs: at,
      validationStatus: typeof row.validation_status === "string" ? row.validation_status : null,
      pcr: finite(row.band7_oi_pcr) ?? finite(row.full_chain_oi_pcr),
      callWallStrike: finite(row.call_wall_strike),
      callWallOi: finite(row.call_wall_oi),
      putWallStrike: finite(row.put_wall_strike),
      putWallOi: finite(row.put_wall_oi),
    };
  }).filter((value): value is LiveChainPoint => value !== null);
}

function mapPremiumRows(rows: Array<Record<string, unknown>>): LivePremiumPoint[] {
  return rows.map((row) => {
    const at = ms(row.quote_timestamp) ?? ms(row.minute_bucket);
    const side = row.option_type === "CE" || row.option_type === "PE" ? row.option_type : null;
    const strike = finite(row.strike);
    const ltp = finite(row.ltp);
    const expiry = typeof row.expiry === "string" ? row.expiry.slice(0, 10) : row.expiry instanceof Date ? row.expiry.toISOString().slice(0, 10) : null;
    if (at == null || !side || strike == null || ltp == null || !expiry) return null;
    return {
      atMs: at,
      contractKey: `${String(row.symbol)}|${expiry}|${strike}|${side}`,
      side,
      expiry,
      dte: finite(row.dte),
      strike,
      ltp,
      pdh: finite(row.pdh),
      pdl: finite(row.pdl),
      validationStatus: typeof row.validation_status === "string" ? row.validation_status : null,
    };
  }).filter((value): value is LivePremiumPoint => value !== null);
}

async function loadWindow(symbol: NarrativeSymbol, originalText: string): Promise<LiveNarrativeWindow | null> {
  const p = getPool();
  if (!p) return null;
  const marketResult = await p.query(`
    SELECT minute_bucket, exchange_timestamp, freshness_status, spot_ltp, future_ltp, pdh, pdl
    FROM market_snapshot_1m WHERE symbol=$1 ORDER BY minute_bucket DESC LIMIT 4
  `, [symbol]);
  const market = mapMarketRows([...marketResult.rows].reverse());
  if (market.length < 2) return null;
  const latestMarket = market.at(-1)!;

  const candidateResult = await p.query(`
    SELECT symbol, minute_bucket, quote_timestamp, expiry::text, dte, strike, option_type, ltp, pdh, pdl, validation_status
    FROM option_snapshot_1m
    WHERE symbol=$1 AND is_candidate=true AND ltp IS NOT NULL AND minute_bucket >= to_timestamp($2/1000.0) - interval '3 minutes'
    ORDER BY minute_bucket DESC, dte ASC NULLS LAST, abs(COALESCE(atm_offset, 99)) ASC
    LIMIT 20
  `, [symbol, latestMarket.atMs]);
  const candidateLatest = mapPremiumRows(candidateResult.rows);
  if (candidateLatest.length === 0) return null;

  const hintedSide = inferSideFromOriginal(originalText);
  const latestMinute = Math.max(...candidateLatest.map((point) => point.atMs));
  const nearLatest = candidateLatest.filter((point) => Math.abs(point.atMs - latestMinute) <= 90_000);
  const sides = [...new Set(nearLatest.map((point) => point.side))];
  const chosenSide = hintedSide && nearLatest.some((point) => point.side === hintedSide)
    ? hintedSide
    : sides.length === 1 ? sides[0] : null;
  if (!chosenSide) return null;
  const chosen = nearLatest.find((point) => point.side === chosenSide) ?? null;
  if (!chosen) return null;

  const candidateHistoryResult = await p.query(`
    SELECT symbol, minute_bucket, quote_timestamp, expiry::text, dte, strike, option_type, ltp, pdh, pdl, validation_status
    FROM option_snapshot_1m
    WHERE symbol=$1 AND expiry=$2::date AND strike=$3 AND option_type=$4
    ORDER BY minute_bucket DESC LIMIT 4
  `, [symbol, chosen.expiry, chosen.strike, chosen.side]);
  const candidate = mapPremiumRows([...candidateHistoryResult.rows].reverse());
  if (candidate.length < 2) return null;

  const oppositeSide: LiveSide = chosen.side === "CE" ? "PE" : "CE";
  const oppositePick = await p.query(`
    SELECT strike FROM option_snapshot_1m
    WHERE symbol=$1 AND expiry=$2::date AND option_type=$3 AND minute_bucket=(
      SELECT max(minute_bucket) FROM option_snapshot_1m WHERE symbol=$1 AND expiry=$2::date
    ) AND ltp IS NOT NULL
    ORDER BY abs(strike-$4) ASC LIMIT 1
  `, [symbol, chosen.expiry, oppositeSide, latestMarket.spot]);
  const oppositeStrike = finite(oppositePick.rows[0]?.strike);
  let opposite: LivePremiumPoint[] = [];
  if (oppositeStrike != null) {
    const r = await p.query(`
      SELECT symbol, minute_bucket, quote_timestamp, expiry::text, dte, strike, option_type, ltp, pdh, pdl, validation_status
      FROM option_snapshot_1m WHERE symbol=$1 AND expiry=$2::date AND strike=$3 AND option_type=$4
      ORDER BY minute_bucket DESC LIMIT 4
    `, [symbol, chosen.expiry, oppositeStrike, oppositeSide]);
    opposite = mapPremiumRows([...r.rows].reverse());
  }

  const nextPick = await p.query(`
    SELECT expiry::text AS expiry, strike FROM option_snapshot_1m
    WHERE symbol=$1 AND expiry>$2::date AND option_type=$3 AND minute_bucket=(
      SELECT max(minute_bucket) FROM option_snapshot_1m WHERE symbol=$1 AND expiry>$2::date
    ) AND ltp IS NOT NULL
    ORDER BY expiry ASC, abs(strike-$4) ASC LIMIT 1
  `, [symbol, chosen.expiry, chosen.side, latestMarket.spot]);
  const nextExpiry = typeof nextPick.rows[0]?.expiry === "string" ? nextPick.rows[0].expiry.slice(0, 10) : null;
  const nextStrike = finite(nextPick.rows[0]?.strike);
  let nextDte: LivePremiumPoint[] = [];
  if (nextExpiry && nextStrike != null) {
    const r = await p.query(`
      SELECT symbol, minute_bucket, quote_timestamp, expiry::text, dte, strike, option_type, ltp, pdh, pdl, validation_status
      FROM option_snapshot_1m WHERE symbol=$1 AND expiry=$2::date AND strike=$3 AND option_type=$4
      ORDER BY minute_bucket DESC LIMIT 4
    `, [symbol, nextExpiry, nextStrike, chosen.side]);
    nextDte = mapPremiumRows([...r.rows].reverse());
  }

  const chainResult = await p.query(`
    SELECT minute_bucket, full_chain_oi_pcr, band7_oi_pcr, call_wall_strike, call_wall_oi,
           put_wall_strike, put_wall_oi, validation_status
    FROM chain_state_1m WHERE symbol=$1 AND expiry=$2::date ORDER BY minute_bucket DESC LIMIT 4
  `, [symbol, chosen.expiry]);
  const chain = mapChainRows([...chainResult.rows].reverse());

  return { symbol, market, chain, candidate, opposite, nextDte };
}

export function syntheticSuppressedResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: { message_id: 0, date: Math.floor(Date.now() / 1000), text: "OPTIONPILOT_MEANINGFUL_SUPPRESSED_UNCHANGED" },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function telegramResponseOk(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const clone = response.clone();
    const body = await clone.json() as { ok?: boolean };
    return body.ok !== false;
  } catch {
    return true;
  }
}

function appendExistingAi(html: string, originalText: string): string {
  const match = originalText.match(/(?:^|\n)(?:🧠\s*)?(?:AI|Haiku)\s*:\s*([^\n]{1,500})/i);
  if (!match?.[1]) return html;
  const safe = match[1].trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${html}\n\n🧠 <i>${safe}</i>`;
}

export function installMeaningfulLiveTelegramBridge(): void {
  const enabled = process.env.OPTIONPILOT_MEANINGFUL_TELEGRAM_ENABLED !== "false";
  if (!enabled) return;
  const holder = globalThis as typeof globalThis & Record<string, unknown>;
  if (holder[INSTALL_FLAG] === true) return;
  holder[INSTALL_FLAG] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      const url = requestUrl(input);
      if (!url.includes("api.telegram.org/") || !url.includes("/sendMessage") || typeof init?.body !== "string") {
        return originalFetch(input, init);
      }
      const payload = JSON.parse(init.body) as TelegramPayload;
      const originalText = typeof payload.text === "string" ? payload.text : "";
      const symbol = inferSymbol(originalText);
      if (!symbol || !looksLikeFastMarketSnapshot(originalText)) return originalFetch(input, init);

      await hydrateMemory();
      const window = await loadWindow(symbol, originalText);
      // Meaningful mode owns recognised fast-snapshot messages. If the
      // evidence window is incomplete, suppress the legacy payload instead
      // of leaking the same old card every recorder minute. This remains
      // fail-closed: no narrative is invented and no Telegram message is
      // sent until sufficient evidence exists.
      if (!window) return syntheticSuppressedResponse();

      const previous = memory.get(symbol);
      const decision = deriveLiveMeaningfulDecision(window, previous);
      if (!decision.ok || !decision.candidateKey) return syntheticSuppressedResponse();

      if (decision.reason === "NO_MEANINGFUL_CHANGE") {
        confirmationTracker.reset(symbol);
        return syntheticSuppressedResponse();
      }
      if (!decision.triggerFingerprint || !decision.narrativeHtml || !decision.narrativeText || !decision.footprint) {
        return syntheticSuppressedResponse();
      }

      const confirmationKey = `${decision.candidateKey}|${decision.state}|${decision.footprint.classification}|${decision.meaningfulChanges.join("|")}`;
      const consecutiveConfirmations = confirmationTracker.observe(symbol, confirmationKey);
      const trigger = evaluateMessageTrigger({
        dataFresh: decision.dataQuality === "OK",
        lifecycle: "WATCH",
        candidateKey: decision.candidateKey,
        candidateSelectionChanged: previous?.candidateKey !== decision.candidateKey,
        lifecycleChanged: previous?.state !== decision.state,
        premiumBehaviourChanged: decision.candidateState !== null,
        buyerSellerStateChanged: false,
        behaviourRiskChanged: decision.state === "EXHAUSTION_WATCH" || decision.state === "DATA_QUALITY_BLOCKED",
        materialEvidenceChange: decision.meaningfulChanges.length > 0,
        footprintLeadershipChanged: decision.footprint.rotationDetected,
        structuralBoundaryChanged: decision.structuralBoundaryChanged,
        oppositePremiumStateChanged: decision.oppositePremiumStateChanged,
        crossDteCoherenceChanged: decision.crossDteCoherenceChanged,
        breadthStateChanged: false,
        consecutiveConfirmations,
        requiredConfirmations: decision.dataQuality === "OK" ? 2 : 1,
        cooldownSatisfied: true,
        currentFingerprint: decision.triggerFingerprint,
        lastSpokenFingerprint: previous?.fingerprint ?? null,
      });

      if (!trigger.shouldSpeak) {
        return syntheticSuppressedResponse();
      }

      let html = appendExistingAi(decision.narrativeHtml, originalText);
      if (html.length > MAX_LIVE_TEXT) html = decision.narrativeHtml;
      if (html.length > MAX_LIVE_TEXT) return syntheticSuppressedResponse();

      const response = await originalFetch(input, {
        ...init,
        body: JSON.stringify({ ...payload, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (await telegramResponseOk(response)) {
        const current = window.market.at(-1)!;
        const stateSinceMs = previous?.state === decision.state ? previous.stateSinceMs : current.atMs;
        const record: NarrativeMemoryRecord = {
          symbol,
          state: decision.state,
          stateSinceMs,
          lastMeaningfulAtMs: current.atMs,
          lastMessageId: `${symbol}:${current.atMs}`,
          candidateKey: decision.candidateKey,
          oppositeKey: decision.oppositeKey,
          footprintLeader: decision.footprint.leader,
          fingerprint: decision.triggerFingerprint,
        };
        memory.commit(record);
        confirmationTracker.reset(symbol);
        void persistMeaningfulEvent(record, decision.narrativeText, html);
      }
      return response;
    } catch (err) {
      console.error("[Meaningful Telegram] bridge failed open:", err instanceof Error ? err.message : String(err));
      return originalFetch(input, init);
    }
  }) as typeof fetch;
}
