import type { H1ExactContractIdentity } from "./h1-live-exact-snapshot-aggregator.js";
import type { H1LiveExactRawEvidenceRow } from "./h1-live-exact-raw-evidence-store.js";
import { getH1DynamicReadOnlyExactOptionRows } from "./h1-dynamic-readonly-server-bootstrap.js";
import { getH1ExactRawRuntimePair, publishH1ExactRawRuntimeRow, type H1ExactWatchSymbol } from "./h1-exact-raw-runtime-history-v1.js";
import { buildExactWatchFeedFromRawRows, type ExactWatchFeed, type ExactWatchSideFeed } from "./telegram-z-watch-exact-feed-v1.js";

export interface LiveExactZWatchRuntimeResult {
  version: "TELEGRAM_Z_WATCH_LIVE_EXACT_RUNTIME_V1";
  symbol: H1ExactWatchSymbol;
  ready: boolean;
  feed: ExactWatchFeed;
  ceIdentity: H1ExactContractIdentity | null;
  peIdentity: H1ExactContractIdentity | null;
  ceLtp: number | null;
  peLtp: number | null;
  blockers: string[];
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function identity(row: H1LiveExactRawEvidenceRow | null): H1ExactContractIdentity | null {
  if (!row || row.role !== "OPTION" || !row.expiry || !Number.isFinite(row.strike) || (row.optionSide !== "CE" && row.optionSide !== "PE")) return null;
  const expiryMs = Date.parse(`${row.expiry}T00:00:00.000Z`);
  const observedMs = Date.parse(row.observedAt);
  if (!Number.isFinite(expiryMs) || !Number.isFinite(observedMs)) return null;
  const observedDateMs = Date.parse(`${new Date(observedMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const dte = Math.max(0, Math.round((expiryMs - observedDateMs) / 86_400_000));
  return { symbol: row.symbol, expiryDate: row.expiry, strike: Number(row.strike), side: row.optionSide, dte };
}

function blockSide(side: ExactWatchSideFeed, blocker: string): ExactWatchSideFeed {
  return { premium3mPct: null, spreadPct: null, ready: false, blockers: [...new Set([...side.blockers, blocker])] };
}

function sameCrossPair(ce: H1ExactContractIdentity | null, pe: H1ExactContractIdentity | null): boolean {
  return !!ce && !!pe && ce.symbol === pe.symbol && ce.expiryDate === pe.expiryDate && ce.strike === pe.strike && ce.dte === pe.dte;
}

export function buildLiveExactZWatchRuntime(
  symbol: H1ExactWatchSymbol,
  nowIso: string = new Date().toISOString(),
): LiveExactZWatchRuntimeResult {
  // Pull only already-validated, fresh exact option rows. The H1 source remains
  // read-only and does not push into Telegram or change any authority boundary.
  for (const row of getH1DynamicReadOnlyExactOptionRows(nowIso)) publishH1ExactRawRuntimeRow(row);

  const ce = getH1ExactRawRuntimePair(symbol, "CE", nowIso);
  const pe = getH1ExactRawRuntimePair(symbol, "PE", nowIso);
  let feed = buildExactWatchFeedFromRawRows({
    symbol,
    cePrevious: ce.previous,
    ceCurrent: ce.current,
    pePrevious: pe.previous,
    peCurrent: pe.current,
  });

  const ceIdentity = identity(ce.current);
  const peIdentity = identity(pe.current);
  const blockers = [...ce.blockers.map((x) => `CE_${x}`), ...pe.blockers.map((x) => `PE_${x}`)];
  if (ce.current && pe.current && !sameCrossPair(ceIdentity, peIdentity)) {
    blockers.push("CE_PE_CONTRACT_PAIR_MISMATCH");
    feed = {
      ...feed,
      ce: blockSide(feed.ce, "CE_PE_CONTRACT_PAIR_MISMATCH"),
      pe: blockSide(feed.pe, "CE_PE_CONTRACT_PAIR_MISMATCH"),
    };
  }

  return {
    version: "TELEGRAM_Z_WATCH_LIVE_EXACT_RUNTIME_V1",
    symbol,
    ready: blockers.length === 0 && feed.ce.ready && feed.pe.ready,
    feed,
    ceIdentity,
    peIdentity,
    ceLtp: ce.current?.ltp ?? null,
    peLtp: pe.current?.ltp ?? null,
    blockers: [...new Set(blockers)],
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
