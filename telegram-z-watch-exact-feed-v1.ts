import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";

export interface ExactWatchSideFeed {
  premium3mPct: number | null;
  spreadPct: number | null;
  ready: boolean;
  blockers: string[];
}

export interface ExactWatchFeed {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  ce: ExactWatchSideFeed;
  pe: ExactWatchSideFeed;
  future3m: null;
  ceOi3m: null;
  peOi3m: null;
  semantics: "EXACT_OPTION_PAIR_ONLY_NO_INFERENCE";
}

function pctChange(previous: number, current: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current) || current <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function sameContract(a: H1ExactSnapshotBundle, b: H1ExactSnapshotBundle): boolean {
  if (!a.identity || !b.identity) return false;
  return a.identity.symbol === b.identity.symbol &&
    a.identity.expiryDate === b.identity.expiryDate &&
    a.identity.strike === b.identity.strike &&
    a.identity.side === b.identity.side &&
    a.identity.dte === b.identity.dte;
}

function buildSide(previous: H1ExactSnapshotBundle | null, current: H1ExactSnapshotBundle | null): ExactWatchSideFeed {
  const blockers: string[] = [];
  if (!previous?.ready) blockers.push("PREVIOUS_EXACT_SNAPSHOT_NOT_READY");
  if (!current?.ready) blockers.push("CURRENT_EXACT_SNAPSHOT_NOT_READY");
  if (!previous?.priceGreek || !current?.priceGreek || !previous?.depth || !current?.depth) blockers.push("EXACT_FIELDS_MISSING");
  if (previous?.ready && current?.ready && !sameContract(previous, current)) blockers.push("CONTRACT_IDENTITY_MISMATCH");

  const prevTs = previous?.observedAt ? Date.parse(previous.observedAt) : NaN;
  const currTs = current?.observedAt ? Date.parse(current.observedAt) : NaN;
  const elapsedMs = currTs - prevTs;
  // Accept only a genuine ~3 minute pair. This prevents a 1m/6m pair being mislabeled as 3m.
  if (!Number.isFinite(elapsedMs) || elapsedMs < 150_000 || elapsedMs > 240_000) blockers.push("NOT_A_3M_EXACT_PAIR");

  if (blockers.length) return { premium3mPct: null, spreadPct: null, ready: false, blockers: [...new Set(blockers)] };

  const premium3mPct = pctChange(previous!.priceGreek!.ltp, current!.priceGreek!.ltp);
  const bid = current!.depth!.bid;
  const ask = current!.depth!.ask;
  const mid = (bid + ask) / 2;
  const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : null;
  if (premium3mPct === null || spreadPct === null || !Number.isFinite(spreadPct) || spreadPct < 0) {
    return { premium3mPct: null, spreadPct: null, ready: false, blockers: ["INVALID_EXACT_DERIVED_VALUE"] };
  }
  return { premium3mPct, spreadPct, ready: true, blockers: [] };
}

export function buildExactWatchFeed(input: {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  cePrevious: H1ExactSnapshotBundle | null;
  ceCurrent: H1ExactSnapshotBundle | null;
  pePrevious: H1ExactSnapshotBundle | null;
  peCurrent: H1ExactSnapshotBundle | null;
}): ExactWatchFeed {
  return {
    symbol: input.symbol,
    ce: buildSide(input.cePrevious, input.ceCurrent),
    pe: buildSide(input.pePrevious, input.peCurrent),
    future3m: null,
    ceOi3m: null,
    peOi3m: null,
    semantics: "EXACT_OPTION_PAIR_ONLY_NO_INFERENCE",
  };
}
