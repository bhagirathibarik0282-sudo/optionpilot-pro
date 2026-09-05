import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";
import { analyzeH1CasProxy, type H1CasProxyResult } from "./h1-cas-proxy.js";

export type TheoryDirection = "BULLISH" | "BEARISH" | "BALANCED" | "UNAVAILABLE";
export type TheoryStatus = "VERIFIED_OBSERVATION" | "PARTIAL_EVIDENCE" | "INSUFFICIENT_DATA";

export interface TheoryWindowEvidence {
  windowMinutes: 3 | 6 | 15 | 30;
  stage: "EARLY_CLUE" | "INITIAL_CONFIRMATION" | "TRANSITION_VALIDATION" | "SUSTAINED_REGIME";
  start: string | null;
  end: string | null;
  elapsedMinutes: number | null;
  marketSamples: number;
  chainSamples: number;
  optionSamples: number;
  spotChangePct: number | null;
  futureChangePct: number | null;
  futureOiChange: number | null;
  pcrChange: number | null;
  callWallShift: number | null;
  putWallShift: number | null;
  atmIvChange: number | null;
  cePremiumChangePct: number | null;
  pePremiumChangePct: number | null;
  direction: TheoryDirection;
  status: TheoryStatus;
  blockers: string[];
}

export interface TheoryTransitionEvent {
  timestamp: string;
  direction: Exclude<TheoryDirection, "UNAVAILABLE">;
  priorDirection: TheoryDirection;
  clue3m: TheoryDirection;
  confirm6m: TheoryDirection;
  validate15m: TheoryDirection;
  responseEfficiency: "CONFIRMED" | "FAILED_EXPECTED_RESPONSE" | "MIXED" | "UNAVAILABLE";
  evidence: string[];
  label: "PROVISIONAL_HYPOTHESIS";
}

export interface H1TheoryAnalysisResult {
  ok: boolean;
  mode: "READ_ONLY_H1_DATEWISE_THEORY_ANALYSIS_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  dataQuality: {
    markerCount: number;
    marketMinutes: number;
    chainRows: number;
    optionRows: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    coverageStatus: "COMPLETE_ENOUGH" | "PARTIAL" | "INSUFFICIENT";
  };
  latestWindows: TheoryWindowEvidence[];
  transitions: TheoryTransitionEvent[];
  cas: H1CasProxyResult;
  dayVerdict: TheoryDirection;
  theorySequence: readonly [
    "RESPONSE_EFFICIENCY",
    "RATE_OF_CHANGE",
    "PREMIUM_WALL_PCR",
    "FUTURES_OI",
    "PRICE_REGIME"
  ];
  limitations: string[];
  labels: readonly ["RESEARCH_ONLY", "PROVISIONAL_HYPOTHESIS", "NO_EXECUTION_AUTHORITY"];
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  reason?: string;
}

type Row = Record<string, unknown>;
type Snapshot = {
  timestamp: string;
  market: Row;
  primaryChain: Row | null;
  primaryAtmCe: Row | null;
  primaryAtmPe: Row | null;
  chainCount: number;
  optionCount: number;
};

const WINDOWS = [3, 6, 15, 30] as const;
const STAGES = ["EARLY_CLUE", "INITIAL_CONFIRMATION", "TRANSITION_VALIDATION", "SUSTAINED_REGIME"] as const;

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function time(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(start: unknown, end: unknown): number | null {
  const a = finite(start);
  const b = finite(end);
  return a == null || b == null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
}

function delta(start: unknown, end: unknown): number | null {
  const a = finite(start);
  const b = finite(end);
  return a == null || b == null ? null : b - a;
}

function signDirection(value: number | null, epsilon = 0.000_001): TheoryDirection {
  if (value == null) return "UNAVAILABLE";
  if (value > epsilon) return "BULLISH";
  if (value < -epsilon) return "BEARISH";
  return "BALANCED";
}

function primaryRows(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => String(a.expiry ?? "").localeCompare(String(b.expiry ?? "")));
  const expiry = sorted[0]?.expiry;
  return expiry == null ? [] : sorted.filter((row) => row.expiry === expiry);
}

function buildSnapshots(replay: H1ReplayHttpResult): Snapshot[] {
  const market = [...(replay.market ?? [])]
    .filter((row) => String(row.truth_verdict ?? "").toUpperCase() === "TRUE")
    .sort((a, b) => String(a.minute_bucket).localeCompare(String(b.minute_bucket)));
  const chainByMinute = new Map<string, Row[]>();
  const optionByMinute = new Map<string, Row[]>();
  for (const row of replay.chain ?? []) {
    const key = String(row.minute_bucket ?? "");
    chainByMinute.set(key, [...(chainByMinute.get(key) ?? []), row]);
  }
  for (const row of replay.options ?? []) {
    const key = String(row.minute_bucket ?? "");
    optionByMinute.set(key, [...(optionByMinute.get(key) ?? []), row]);
  }
  return market.map((marketRow) => {
    const timestamp = String(marketRow.minute_bucket ?? "");
    const chainRows = primaryRows(chainByMinute.get(timestamp) ?? []);
    const optionRows = primaryRows(optionByMinute.get(timestamp) ?? []);
    const atm = optionRows.filter((row) => finite(row.atm_offset) === 0);
    return {
      timestamp,
      market: marketRow,
      primaryChain: chainRows[0] ?? null,
      primaryAtmCe: atm.find((row) => String(row.option_type).toUpperCase() === "CE") ?? null,
      primaryAtmPe: atm.find((row) => String(row.option_type).toUpperCase() === "PE") ?? null,
      chainCount: chainByMinute.get(timestamp)?.length ?? 0,
      optionCount: optionByMinute.get(timestamp)?.length ?? 0,
    };
  }).filter((row) => time(row.timestamp) != null);
}

function atOrBefore(snapshots: Snapshot[], targetMs: number): Snapshot | null {
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const t = time(snapshots[i].timestamp);
    if (t != null && t <= targetMs) return snapshots[i];
  }
  return null;
}

function summarizeWindow(snapshots: Snapshot[], endIndex: number, windowMinutes: 3 | 6 | 15 | 30): TheoryWindowEvidence {
  const end = snapshots[endIndex] ?? null;
  const endMs = end ? time(end.timestamp) : null;
  const start = endMs == null ? null : atOrBefore(snapshots.slice(0, endIndex + 1), endMs - windowMinutes * 60_000);
  const startMs = start ? time(start.timestamp) : null;
  const elapsedMinutes = startMs == null || endMs == null ? null : (endMs - startMs) / 60_000;
  const inWindow = startMs == null || endMs == null ? [] : snapshots.filter((row) => {
    const t = time(row.timestamp);
    return t != null && t >= startMs && t <= endMs;
  });
  const spotChangePct = start && end ? pct(start.market.spot_ltp, end.market.spot_ltp) : null;
  const futureChangePct = start && end ? pct(start.market.future_ltp, end.market.future_ltp) : null;
  const futureOiChange = start && end ? delta(start.market.future_oi, end.market.future_oi) : null;
  const pcrChange = start && end ? delta(start.primaryChain?.band7_oi_pcr ?? start.primaryChain?.full_chain_oi_pcr, end.primaryChain?.band7_oi_pcr ?? end.primaryChain?.full_chain_oi_pcr) : null;
  const callWallShift = start && end ? delta(start.primaryChain?.call_wall_strike, end.primaryChain?.call_wall_strike) : null;
  const putWallShift = start && end ? delta(start.primaryChain?.put_wall_strike, end.primaryChain?.put_wall_strike) : null;
  const atmIvChange = start && end ? delta(start.primaryChain?.atm_iv, end.primaryChain?.atm_iv) : null;
  const cePremiumChangePct = start && end ? pct(start.primaryAtmCe?.ltp, end.primaryAtmCe?.ltp) : null;
  const pePremiumChangePct = start && end ? pct(start.primaryAtmPe?.ltp, end.primaryAtmPe?.ltp) : null;
  const direction = signDirection(spotChangePct);
  const blockers: string[] = [];
  if (!start || elapsedMinutes == null || elapsedMinutes < windowMinutes) blockers.push(`INSUFFICIENT_${windowMinutes}M_TIME_COVERAGE`);
  if (spotChangePct == null) blockers.push("SPOT_CHANGE_UNAVAILABLE");
  if (futureChangePct == null || futureOiChange == null) blockers.push("FUTURES_OI_EVIDENCE_INCOMPLETE");
  if (pcrChange == null || callWallShift == null || putWallShift == null) blockers.push("PCR_WALL_EVIDENCE_INCOMPLETE");
  if (cePremiumChangePct == null || pePremiumChangePct == null) blockers.push("OPPOSITE_PREMIUM_EVIDENCE_INCOMPLETE");
  const critical = blockers.filter((b) => b.startsWith("INSUFFICIENT_") || b === "SPOT_CHANGE_UNAVAILABLE");
  const status: TheoryStatus = critical.length ? "INSUFFICIENT_DATA" : blockers.length ? "PARTIAL_EVIDENCE" : "VERIFIED_OBSERVATION";
  return {
    windowMinutes,
    stage: STAGES[WINDOWS.indexOf(windowMinutes)],
    start: start?.timestamp ?? null,
    end: end?.timestamp ?? null,
    elapsedMinutes,
    marketSamples: inWindow.length,
    chainSamples: inWindow.reduce((sum, row) => sum + row.chainCount, 0),
    optionSamples: inWindow.reduce((sum, row) => sum + row.optionCount, 0),
    spotChangePct,
    futureChangePct,
    futureOiChange,
    pcrChange,
    callWallShift,
    putWallShift,
    atmIvChange,
    cePremiumChangePct,
    pePremiumChangePct,
    direction,
    status,
    blockers,
  };
}

function responseEfficiency(window: TheoryWindowEvidence): TheoryTransitionEvent["responseEfficiency"] {
  if (window.direction === "UNAVAILABLE" || window.cePremiumChangePct == null || window.pePremiumChangePct == null) return "UNAVAILABLE";
  if (window.direction === "BALANCED") return "MIXED";
  const favored = window.direction === "BULLISH" ? window.cePremiumChangePct : window.pePremiumChangePct;
  const opposite = window.direction === "BULLISH" ? window.pePremiumChangePct : window.cePremiumChangePct;
  if (favored > 0 && opposite < 0) return "CONFIRMED";
  if (favored <= 0 || opposite >= favored) return "FAILED_EXPECTED_RESPONSE";
  return "MIXED";
}

function detectTransitions(snapshots: Snapshot[]): TheoryTransitionEvent[] {
  const events: TheoryTransitionEvent[] = [];
  let previous15: TheoryDirection = "UNAVAILABLE";
  for (let i = 0; i < snapshots.length; i += 1) {
    const clue = summarizeWindow(snapshots, i, 3);
    const confirm = summarizeWindow(snapshots, i, 6);
    const validate = summarizeWindow(snapshots, i, 15);
    if (validate.status === "INSUFFICIENT_DATA") continue;
    const changed = previous15 !== "UNAVAILABLE" && validate.direction !== previous15;
    const directional = validate.direction === "BULLISH" || validate.direction === "BEARISH";
    const aligned = directional && clue.direction === validate.direction && confirm.direction === validate.direction;
    if (changed && aligned) {
      const evidence = [
        `3m ${clue.direction} ${clue.spotChangePct?.toFixed(3) ?? "NA"}%`,
        `6m ${confirm.direction} ${confirm.spotChangePct?.toFixed(3) ?? "NA"}%`,
        `15m ${validate.direction} ${validate.spotChangePct?.toFixed(3) ?? "NA"}%`,
        `PCR Δ ${validate.pcrChange?.toFixed(3) ?? "NA"}`,
        `CE/PE Δ ${validate.cePremiumChangePct?.toFixed(2) ?? "NA"}%/${validate.pePremiumChangePct?.toFixed(2) ?? "NA"}%`,
        `Futures OI Δ ${validate.futureOiChange ?? "NA"}`,
      ];
      events.push({
        timestamp: snapshots[i].timestamp,
        direction: validate.direction,
        priorDirection: previous15,
        clue3m: clue.direction,
        confirm6m: confirm.direction,
        validate15m: validate.direction,
        responseEfficiency: responseEfficiency(validate),
        evidence,
        label: "PROVISIONAL_HYPOTHESIS",
      });
    }
    previous15 = validate.direction;
  }
  return events;
}

export function analyzeH1TheoryReplay(request: H1ReplayRequest, replay: H1ReplayHttpResult): H1TheoryAnalysisResult {
  const base = {
    mode: "READ_ONLY_H1_DATEWISE_THEORY_ANALYSIS_V1" as const,
    productionImpact: "NONE" as const,
    request,
    theorySequence: ["RESPONSE_EFFICIENCY", "RATE_OF_CHANGE", "PREMIUM_WALL_PCR", "FUTURES_OI", "PRICE_REGIME"] as const,
    labels: ["RESEARCH_ONLY", "PROVISIONAL_HYPOTHESIS", "NO_EXECUTION_AUTHORITY"] as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };
  const snapshots = buildSnapshots(replay);
  const firstTimestamp = snapshots[0]?.timestamp ?? null;
  const lastTimestamp = snapshots[snapshots.length - 1]?.timestamp ?? null;
  // A regular 09:15-15:30 session has about 126 three-minute boundaries.
  // Require roughly 80% coverage before using the positive label; sparse
  // full-day rows must remain PARTIAL even when the first/last timestamps span
  // the whole session.
  const quality = snapshots.length >= 100 ? "COMPLETE_ENOUGH" : snapshots.length >= 10 ? "PARTIAL" : "INSUFFICIENT";
  const dataQuality = {
    // Only truth-eligible rows are displayed here. replay.counts.markers may
    // also include STALE/INVALID marker states and would overstate coverage.
    markerCount: snapshots.length,
    marketMinutes: snapshots.length,
    chainRows: replay.counts?.chain ?? 0,
    optionRows: replay.counts?.options ?? 0,
    firstTimestamp,
    lastTimestamp,
    coverageStatus: quality as "COMPLETE_ENOUGH" | "PARTIAL" | "INSUFFICIENT",
  };
  if (!replay.ok || snapshots.length === 0) {
    return {
      ...base,
      ok: false,
      dataQuality,
      latestWindows: [],
      transitions: [],
      cas: analyzeH1CasProxy(request, replay),
      dayVerdict: "UNAVAILABLE",
      limitations: [replay.reason ?? "NO_VERIFIED_REPLAY_ROWS"],
      reason: replay.reason ?? "NO_VERIFIED_REPLAY_ROWS",
    };
  }
  const latestWindows = WINDOWS.map((window) => summarizeWindow(snapshots, snapshots.length - 1, window));
  const transitions = detectTransitions(snapshots);
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const dayVerdict = signDirection(pct(first.market.spot_ltp, last.market.spot_ltp));
  const limitations = [
    "All directions are descriptive signs of recorded change; no statistical threshold is claimed as validated.",
    "Wall movement is strike migration, not proof of option writing or buying.",
    "VIX/IV describe volatility magnitude and must not be used as standalone direction.",
    "Missing or stale evidence remains unavailable and never counts as neutral confirmation.",
    "Historical findings cannot override live evidence, verdict, Telegram, candidate selection or execution.",
  ];
  if (quality !== "COMPLETE_ENOUGH") limitations.unshift("Recorded-day coverage is incomplete; conclusions are partial.");
  return { ...base, ok: true, dataQuality, latestWindows, transitions, cas: analyzeH1CasProxy(request, replay), dayVerdict, limitations };
}
