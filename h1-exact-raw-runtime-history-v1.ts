import type { H1LiveExactRawEvidenceRow } from "./h1-live-exact-raw-evidence-store.js";

export type H1ExactWatchSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
export type H1ExactWatchSide = "CE" | "PE";

export interface H1ExactRawRuntimePair {
  previous: H1LiveExactRawEvidenceRow | null;
  current: H1LiveExactRawEvidenceRow | null;
  blockers: string[];
  failClosed: true;
}

const SAMPLE_STEP_MS = 5_000;
const RETAIN_MS = 6 * 60_000;
const MAX_PER_CONTRACT = 80;
const CURRENT_MAX_AGE_MS = 15_000;
const TARGET_GAP_MS = 180_000;
const MIN_GAP_MS = 150_000;
const MAX_GAP_MS = 240_000;

const historyByContract = new Map<string, H1LiveExactRawEvidenceRow[]>();

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function contractKey(row: H1LiveExactRawEvidenceRow): string | null {
  if (row.role !== "OPTION" || (row.optionSide !== "CE" && row.optionSide !== "PE") || !row.expiry || !Number.isFinite(row.strike) || Number(row.strike) <= 0) return null;
  return `${row.instrumentToken}|${row.symbol}|${row.expiry}|${Number(row.strike)}|${row.optionSide}`;
}

export function publishH1ExactRawRuntimeRow(row: H1LiveExactRawEvidenceRow): void {
  const key = contractKey(row);
  const observedMs = time(row.observedAt);
  if (!key || observedMs == null || !Number.isFinite(row.ltp) || row.ltp <= 0) return;

  const existing = historyByContract.get(key) ?? [];
  const last = existing[existing.length - 1] ?? null;
  const lastMs = time(last?.observedAt);
  if (lastMs != null && observedMs < lastMs) return;

  let next = existing;
  if (lastMs != null && observedMs - lastMs < SAMPLE_STEP_MS) {
    next = [...existing.slice(0, -1), { ...row }];
  } else {
    next = [...existing, { ...row }];
  }
  next = next.filter((item) => {
    const ms = time(item.observedAt);
    return ms != null && observedMs - ms <= RETAIN_MS;
  }).slice(-MAX_PER_CONTRACT);
  historyByContract.set(key, next);
}

function latestContractRows(symbol: H1ExactWatchSymbol, side: H1ExactWatchSide): H1LiveExactRawEvidenceRow[] | null {
  const candidates: Array<{ rows: H1LiveExactRawEvidenceRow[]; expiry: string; observedMs: number; strike: number }> = [];
  for (const rows of historyByContract.values()) {
    const current = rows[rows.length - 1];
    if (!current || current.symbol !== symbol || current.optionSide !== side || !current.expiry || !Number.isFinite(current.strike)) continue;
    const observedMs = time(current.observedAt);
    if (observedMs == null) continue;
    candidates.push({ rows, expiry: current.expiry, observedMs, strike: Number(current.strike) });
  }
  candidates.sort((a, b) => a.expiry.localeCompare(b.expiry) || b.observedMs - a.observedMs || a.strike - b.strike);
  return candidates[0]?.rows ?? null;
}

export function getH1ExactRawRuntimePair(
  symbol: H1ExactWatchSymbol,
  side: H1ExactWatchSide,
  nowIso: string = new Date().toISOString(),
): H1ExactRawRuntimePair {
  const blockers: string[] = [];
  const nowMs = time(nowIso);
  if (nowMs == null) blockers.push("INVALID_NOW");

  const rows = latestContractRows(symbol, side);
  if (!rows?.length) return { previous: null, current: null, blockers: [...blockers, "CURRENT_EXACT_ROW_UNAVAILABLE"], failClosed: true };

  const current = rows[rows.length - 1];
  const currentMs = time(current.observedAt);
  if (currentMs == null || nowMs == null || currentMs > nowMs || nowMs - currentMs > CURRENT_MAX_AGE_MS) {
    blockers.push("CURRENT_EXACT_ROW_STALE_OR_INVALID");
  }

  let previous: H1LiveExactRawEvidenceRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  if (currentMs != null) {
    for (const row of rows.slice(0, -1)) {
      const rowMs = time(row.observedAt);
      if (rowMs == null) continue;
      const gap = currentMs - rowMs;
      if (gap < MIN_GAP_MS || gap > MAX_GAP_MS) continue;
      const distance = Math.abs(gap - TARGET_GAP_MS);
      if (distance < bestDistance) {
        previous = row;
        bestDistance = distance;
      }
    }
  }
  if (!previous) blockers.push("PREVIOUS_3M_EXACT_ROW_UNAVAILABLE");

  if (blockers.length) return { previous, current, blockers: [...new Set(blockers)], failClosed: true };
  return { previous, current, blockers: [], failClosed: true };
}

export function resetH1ExactRawRuntimeHistoryForTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("H1_EXACT_RAW_RUNTIME_HISTORY_RESET_TEST_ONLY");
  historyByContract.clear();
}
