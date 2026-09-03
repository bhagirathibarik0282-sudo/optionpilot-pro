import { dbLoadRecent } from "./db.js";
import type { NarrativeMemoryRecord, NarrativeSymbol } from "./meaningful-market-narrative.js";
import { getLastTelegramTriggerDiagnostic } from "./message-trigger-engine.js";

const INSTALL_FLAG = "__OPTIONPILOT_MEANINGFUL_ACCEPTANCE_MONITOR_V1__";
const MEMORY_KIND = "meaningful_narrative_event";
const SYMBOLS: readonly NarrativeSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

export type MeaningfulMonitorOutcome =
  | "MEANINGFUL_SENT"
  | "SUPPRESSED_UNCHANGED"
  | "PASS_THROUGH"
  | "SEND_FAILURE";

export interface MeaningfulRuntimeCounter {
  telegramAttempts: number;
  meaningfulSent: number;
  suppressedUnchanged: number;
  passThrough: number;
  sendFailures: number;
  lastObservedAt: string | null;
  lastOutcome: MeaningfulMonitorOutcome | null;
}

export interface PersistedMeaningfulEvent {
  memory?: NarrativeMemoryRecord;
  text?: string;
  html?: string;
  generatedAt?: string;
}

function emptyCounter(): MeaningfulRuntimeCounter {
  return {
    telegramAttempts: 0,
    meaningfulSent: 0,
    suppressedUnchanged: 0,
    passThrough: 0,
    sendFailures: 0,
    lastObservedAt: null,
    lastOutcome: null,
  };
}

export class MeaningfulAcceptanceRuntime {
  private readonly counters = new Map<NarrativeSymbol, MeaningfulRuntimeCounter>();

  record(symbol: NarrativeSymbol, outcome: MeaningfulMonitorOutcome, atIso = new Date().toISOString()): void {
    const current = this.counters.get(symbol) ?? emptyCounter();
    current.telegramAttempts += 1;
    if (outcome === "MEANINGFUL_SENT") current.meaningfulSent += 1;
    else if (outcome === "SUPPRESSED_UNCHANGED") current.suppressedUnchanged += 1;
    else if (outcome === "PASS_THROUGH") current.passThrough += 1;
    else current.sendFailures += 1;
    current.lastObservedAt = atIso;
    current.lastOutcome = outcome;
    this.counters.set(symbol, current);
  }

  get(symbol: NarrativeSymbol): MeaningfulRuntimeCounter {
    const value = this.counters.get(symbol) ?? emptyCounter();
    return { ...value };
  }

  reset(): void {
    this.counters.clear();
  }
}

const runtime = new MeaningfulAcceptanceRuntime();

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
  const markers = ["PCR", "Wall", "WALL", "Intrinsic", "Extrinsic", "OI", "Premium", "PREMIUM"];
  return markers.filter((marker) => text.includes(marker)).length >= 3;
}

export function classifyMeaningfulTelegramResponseBody(
  httpOk: boolean,
  body: unknown,
): MeaningfulMonitorOutcome {
  if (!httpOk) return "SEND_FAILURE";
  if (!body || typeof body !== "object") return "PASS_THROUGH";
  const parsed = body as { ok?: boolean; result?: { text?: string } };
  if (parsed.ok === false) return "SEND_FAILURE";
  const text = typeof parsed.result?.text === "string" ? parsed.result.text : "";
  if (text === "OPTIONPILOT_MEANINGFUL_SUPPRESSED_UNCHANGED") return "SUPPRESSED_UNCHANGED";
  if (text.includes("OPTIONPILOT MEANINGFUL V1")) return "MEANINGFUL_SENT";
  return "PASS_THROUGH";
}

async function classifyResponse(response: Response): Promise<MeaningfulMonitorOutcome> {
  try {
    const body = await response.clone().json();
    return classifyMeaningfulTelegramResponseBody(response.ok, body);
  } catch {
    return response.ok ? "PASS_THROUGH" : "SEND_FAILURE";
  }
}

export function installMeaningfulLiveAcceptanceMonitor(): void {
  const holder = globalThis as typeof globalThis & Record<string, unknown>;
  if (holder[INSTALL_FLAG] === true) return;
  holder[INSTALL_FLAG] = true;

  // Install this AFTER installMeaningfulLiveTelegramBridge(). It observes the
  // response returned by that bridge and never mutates the outgoing request.
  const observedFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    if (!url.includes("api.telegram.org/") || !url.includes("/sendMessage") || typeof init?.body !== "string") {
      return observedFetch(input, init);
    }

    let symbol: NarrativeSymbol | null = null;
    try {
      const payload = JSON.parse(init.body) as { text?: string };
      const text = typeof payload.text === "string" ? payload.text : "";
      symbol = inferSymbol(text);
      if (!symbol || !looksLikeFastMarketSnapshot(text)) return observedFetch(input, init);
    } catch {
      return observedFetch(input, init);
    }

    try {
      const response = await observedFetch(input, init);
      runtime.record(symbol, await classifyResponse(response));
      return response;
    } catch (err) {
      runtime.record(symbol, "SEND_FAILURE");
      throw err;
    }
  }) as typeof fetch;
}

function indiaDate(atMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(atMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function eventTimeMs(event: PersistedMeaningfulEvent): number | null {
  if (event.memory && Number.isFinite(event.memory.lastMeaningfulAtMs)) return event.memory.lastMeaningfulAtMs;
  if (event.generatedAt) {
    const parsed = Date.parse(event.generatedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface MeaningfulJournalSummary {
  eventCountToday: number;
  latest: null | {
    at: string;
    ageMinutes: number;
    state: string;
    footprintLeader: string;
    candidateKey: string | null;
    fingerprint: string;
  };
}

export function summarizePersistedMeaningfulEvents(
  symbol: NarrativeSymbol,
  events: PersistedMeaningfulEvent[],
  nowMs = Date.now(),
): MeaningfulJournalSummary {
  const today = indiaDate(nowMs);
  const matching = events
    .filter((event) => event.memory?.symbol === symbol)
    .map((event) => ({ event, atMs: eventTimeMs(event) }))
    .filter((item): item is { event: PersistedMeaningfulEvent; atMs: number } => item.atMs !== null)
    .sort((a, b) => a.atMs - b.atMs);

  const todays = matching.filter((item) => indiaDate(item.atMs) === today);
  const latest = matching.at(-1);
  if (!latest?.event.memory) return { eventCountToday: todays.length, latest: null };

  return {
    eventCountToday: todays.length,
    latest: {
      at: new Date(latest.atMs).toISOString(),
      ageMinutes: Math.max(0, Math.round(((nowMs - latest.atMs) / 60_000) * 10) / 10),
      state: latest.event.memory.state,
      footprintLeader: latest.event.memory.footprintLeader,
      candidateKey: latest.event.memory.candidateKey,
      fingerprint: latest.event.memory.fingerprint,
    },
  };
}

function acceptanceState(runtimeState: MeaningfulRuntimeCounter, journal: MeaningfulJournalSummary): string {
  if (runtimeState.meaningfulSent > 0 && journal.eventCountToday > 0) return "PASS_MEANINGFUL_EVENT_AND_JOURNAL_VERIFIED";
  if (runtimeState.meaningfulSent > 0) return "WAITING_FOR_JOURNAL_PERSISTENCE";
  if (runtimeState.sendFailures > 0) return "TELEGRAM_SEND_FAILURE_OBSERVED";
  if (runtimeState.suppressedUnchanged > 0) return "WAITING_FOR_MEANINGFUL_CHANGE_REPEATS_SUPPRESSED";
  if (runtimeState.passThrough > 0) return "EVIDENCE_INSUFFICIENT_OR_LEGACY_PASS_THROUGH";
  return "NO_FAST_SNAPSHOT_OBSERVED_SINCE_PROCESS_START";
}

export async function getMeaningfulLiveAcceptanceStatus(requestedSymbol?: string | null) {
  const selected = requestedSymbol?.trim().toUpperCase();
  const symbols = selected && SYMBOLS.includes(selected as NarrativeSymbol)
    ? [selected as NarrativeSymbol]
    : [...SYMBOLS];
  const events = await dbLoadRecent<PersistedMeaningfulEvent>(MEMORY_KIND, 300);
  const nowMs = Date.now();

  return {
    ok: true,
    mode: "READ_ONLY_MEANINGFUL_LIVE_ACCEPTANCE_V1",
    generatedAt: new Date(nowMs).toISOString(),
    meaningfulTelegramEnabled: process.env.OPTIONPILOT_MEANINGFUL_TELEGRAM_ENABLED !== "false",
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    processCountersResetOnRestart: true,
    journalPersistence: "POSTGRES_APP_STATE_LOG",
    symbols: Object.fromEntries(symbols.map((symbol) => {
      const runtimeState = runtime.get(symbol);
      const journal = summarizePersistedMeaningfulEvents(symbol, events, nowMs);
      const triggerDiagnostic = getLastTelegramTriggerDiagnostic(symbol);
      return [symbol, {
        acceptance: acceptanceState(runtimeState, journal),
        runtime: runtimeState,
        triggerDiagnostic,
        journal,
      }];
    })),
    safety: {
      readOnlyEndpoint: true,
      changesTelegramPayload: false,
      changesVerdict: false,
      changesExecution: false,
      createsOrders: false,
    },
  };
}
