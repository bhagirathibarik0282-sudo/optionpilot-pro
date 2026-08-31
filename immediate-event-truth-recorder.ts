import type { ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";
import type { RecorderSymbol } from "./option-recorder-shadow.js";

export type ImmediateTruthRecord = {
  version: "IMMEDIATE_EVENT_TRUTH_RECORD_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  symbol: RecorderSymbol;
  source: string;
  snapshotId: string | null;
  receivedAt: string;
  event: ImmediateVerifiedEvent;
  affectsVerdict: false;
  affectsExecution: false;
};

export type ImmediateTruthAppendResult =
  | { ok: true; accepted: true; duplicate: false; record: ImmediateTruthRecord }
  | { ok: true; accepted: false; duplicate: true; record: ImmediateTruthRecord }
  | { ok: false; accepted: false; duplicate: false; error: string };

const VALID_SYMBOLS = new Set<RecorderSymbol>(["NIFTY", "BANKNIFTY", "SENSEX"]);
const VALID_FAMILIES = new Set([
  "SPOT", "FUTURES", "FUTURES_OI", "PCR", "CALL_WALL", "PUT_WALL", "CE_PREMIUM", "PE_PREMIUM",
  "CE_IV", "PE_IV", "ATM_IV", "INDIA_VIX", "CROSS_INDEX",
]);
const VALID_ALIGNMENTS = new Set(["FAVOURS_TREND", "CONFLICTS_TREND", "VOLATILITY_ONLY", "NEUTRAL"]);

function parseIso(value: string): number | null {
  if (!value || typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function keyOf(record: ImmediateTruthRecord): string {
  return [record.symbol, record.source, record.snapshotId ?? "NONE", record.event.id, record.event.occurredAt].join("|");
}

export class ImmediateEventTruthRecorder {
  private readonly rowsBySymbol = new Map<RecorderSymbol, ImmediateTruthRecord[]>();
  private readonly keys = new Set<string>();

  constructor(private readonly maxRowsPerSymbol = 5000) {
    if (!Number.isInteger(maxRowsPerSymbol) || maxRowsPerSymbol < 1) {
      throw new Error("maxRowsPerSymbol must be a positive integer");
    }
  }

  append(input: {
    symbol: RecorderSymbol;
    source: string;
    snapshotId?: string | null;
    receivedAt?: string;
    event: ImmediateVerifiedEvent;
  }): ImmediateTruthAppendResult {
    if (!VALID_SYMBOLS.has(input.symbol)) return { ok: false, accepted: false, duplicate: false, error: "INVALID_SYMBOL" };
    if (!input.source?.trim()) return { ok: false, accepted: false, duplicate: false, error: "SOURCE_REQUIRED" };
    if (!input.event?.id?.trim()) return { ok: false, accepted: false, duplicate: false, error: "EVENT_ID_REQUIRED" };
    if (!VALID_FAMILIES.has(input.event.family)) return { ok: false, accepted: false, duplicate: false, error: "INVALID_EVENT_FAMILY" };
    if (!VALID_ALIGNMENTS.has(input.event.alignment)) return { ok: false, accepted: false, duplicate: false, error: "INVALID_ALIGNMENT" };
    if (!input.event.fact?.trim()) return { ok: false, accepted: false, duplicate: false, error: "FACT_REQUIRED" };
    if (parseIso(input.event.occurredAt) === null) return { ok: false, accepted: false, duplicate: false, error: "INVALID_OCCURRED_AT" };

    const receivedAt = input.receivedAt ?? new Date().toISOString();
    if (parseIso(receivedAt) === null) return { ok: false, accepted: false, duplicate: false, error: "INVALID_RECEIVED_AT" };

    const record: ImmediateTruthRecord = {
      version: "IMMEDIATE_EVENT_TRUTH_RECORD_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      symbol: input.symbol,
      source: input.source.trim(),
      snapshotId: input.snapshotId?.trim() || null,
      receivedAt,
      event: {
        ...input.event,
        id: input.event.id.trim(),
        fact: input.event.fact.trim(),
      },
      affectsVerdict: false,
      affectsExecution: false,
    };

    const key = keyOf(record);
    if (this.keys.has(key)) {
      return { ok: true, accepted: false, duplicate: true, record };
    }

    const rows = this.rowsBySymbol.get(record.symbol) ?? [];
    rows.push(record);
    this.keys.add(key);

    while (rows.length > this.maxRowsPerSymbol) {
      const removed = rows.shift();
      if (removed) this.keys.delete(keyOf(removed));
    }
    this.rowsBySymbol.set(record.symbol, rows);

    return { ok: true, accepted: true, duplicate: false, record };
  }

  list(symbol: RecorderSymbol, limit = 100): ImmediateTruthRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return [...(this.rowsBySymbol.get(symbol) ?? [])]
      .sort((a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt) || a.receivedAt.localeCompare(b.receivedAt))
      .slice(-safeLimit);
  }

  latest(symbol: RecorderSymbol): ImmediateTruthRecord | null {
    return this.list(symbol, 1).at(-1) ?? null;
  }

  stats() {
    const counts = Object.fromEntries(
      (["NIFTY", "BANKNIFTY", "SENSEX"] as RecorderSymbol[]).map((symbol) => [symbol, this.rowsBySymbol.get(symbol)?.length ?? 0]),
    );
    return {
      version: "IMMEDIATE_EVENT_TRUTH_RECORDER_V1" as const,
      semantics: "RESEARCH_SHADOW_ONLY" as const,
      storage: "BOUNDED_IN_MEMORY" as const,
      maxRowsPerSymbol: this.maxRowsPerSymbol,
      counts,
      affectsVerdict: false as const,
      affectsExecution: false as const,
    };
  }
}
