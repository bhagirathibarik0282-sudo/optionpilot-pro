import {
  buildRecorderContractKey,
  type RecorderOptionSnapshot,
  type RecorderStrategyVerdict,
  type RecorderSymbol,
} from "./option-recorder-shadow.js";
import type { RecorderIngestPayload } from "./option-recorder-runtime.js";

type SourceLeg = {
  strike?: number;
  ltp?: number | null;
  iv?: number | null;
  theta?: number | null;
  vega?: number | null;
  delta?: number | null;
  oi?: number | null;
};

type SourceIndex = {
  spot?: number | null;
  change?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  vwap?: number | null;
  atmStrike?: number | null;
  ceLtp?: number | null;
  peLtp?: number | null;
  ceOi?: number | null;
  peOi?: number | null;
  ceStrikesNear?: SourceLeg[] | null;
  peStrikesNear?: SourceLeg[] | null;
  exchangeTimestamp?: string | null;
  snapshotId?: string | null;
};

type SourceSnapshot = {
  snapshotId?: string;
  backendTimestamp?: string;
  snapshotStatus?: "LIVE" | "PARTIAL" | "STALE" | "INVALID" | string;
  NIFTY?: SourceIndex | null;
  BANKNIFTY?: SourceIndex | null;
  SENSEX?: SourceIndex | null;
};

type SourceSession = { snapshots?: SourceSnapshot[] };

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function directionFromHistory(symbol: RecorderSymbol, history: SourceSnapshot[]): "CE" | "PE" | "NONE" {
  const current = history.at(-1)?.[symbol];
  const previous = history.at(-2)?.[symbol];
  const spot = finite(current?.spot);
  const prevSpot = finite(previous?.spot);
  const vwap = finite(current?.vwap);
  if (spot == null || prevSpot == null || vwap == null) return "NONE";
  if (spot > prevSpot && spot > vwap) return "CE";
  if (spot < prevSpot && spot < vwap) return "PE";
  return "NONE";
}

function premiumConfirmed(symbol: RecorderSymbol, history: SourceSnapshot[], side: "CE" | "PE"): boolean {
  const current = history.at(-1)?.[symbol];
  const previous = history.at(-2)?.[symbol];
  const key = side === "CE" ? "ceLtp" : "peLtp";
  const now = finite(current?.[key]);
  const before = finite(previous?.[key]);
  return now != null && before != null && now > before;
}

function persistentDirection(symbol: RecorderSymbol, history: SourceSnapshot[], side: "CE" | "PE"): boolean {
  const rows = history.slice(-3).map((s) => finite(s[symbol]?.spot)).filter((v): v is number => v != null);
  if (rows.length < 3) return false;
  return side === "CE"
    ? rows[0] < rows[1] && rows[1] < rows[2]
    : rows[0] > rows[1] && rows[1] > rows[2];
}

function verdicts(symbol: RecorderSymbol, history: SourceSnapshot[]): RecorderStrategyVerdict[] {
  const dir = directionFromHistory(symbol, history);
  const confirmed = dir !== "NONE" && premiumConfirmed(symbol, history, dir);
  const persistent = dir !== "NONE" && persistentDirection(symbol, history, dir);

  const scalp: RecorderStrategyVerdict = {
    mode: "SCALP",
    state: dir !== "NONE" && confirmed ? "TRADEABLE" : "WATCH",
    direction: dir !== "NONE" && confirmed ? dir : "NONE",
    quality: dir !== "NONE" && confirmed ? "MEDIUM" : "LOW",
    evidence: dir !== "NONE" && confirmed
      ? ["SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION"]
      : ["SCALP_CONFIRMATION_INCOMPLETE"],
    conflicts: [],
  };

  const trader: RecorderStrategyVerdict = {
    mode: "TRADER",
    state: dir !== "NONE" && confirmed && persistent ? "TRADEABLE" : "WATCH",
    direction: dir !== "NONE" && confirmed && persistent ? dir : "NONE",
    quality: dir !== "NONE" && confirmed && persistent ? "MEDIUM" : "LOW",
    evidence: dir !== "NONE" && confirmed && persistent
      ? ["THREE_SNAPSHOT_PERSISTENCE", "SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION"]
      : ["INTRADAY_PERSISTENCE_INCOMPLETE"],
    conflicts: [],
  };

  const swing: RecorderStrategyVerdict = {
    mode: "SWING",
    state: "WATCH",
    direction: "NONE",
    quality: "UNAVAILABLE",
    evidence: ["MULTI_EXPIRY_SOURCE_REQUIRED"],
    conflicts: ["CURRENT_RECORDER_FEED_DOES_NOT_CARRY_MULTI_EXPIRY_HISTORY"],
  };

  return [scalp, trader, swing];
}

function optionsFor(symbol: RecorderSymbol, snapshot: SourceSnapshot): RecorderOptionSnapshot[] {
  const idx = snapshot[symbol];
  if (!idx) return [];
  const snapshotId = snapshot.snapshotId || idx.snapshotId || "";
  const backendTimestamp = snapshot.backendTimestamp || new Date().toISOString();
  const exchangeTimestamp = idx.exchangeTimestamp || null;
  const expiry = "CURRENT_RECORDER_EXPIRY";
  const spot = finite(idx.spot);

  const toOption = (leg: SourceLeg, side: "CE" | "PE"): RecorderOptionSnapshot | null => {
    const strike = finite(leg.strike);
    const ltp = finite(leg.ltp);
    if (strike == null || strike <= 0 || ltp == null || ltp <= 0) return null;
    const intrinsic = spot == null ? null : Math.max(side === "CE" ? spot - strike : strike - spot, 0);
    return {
      snapshotId,
      symbol,
      expiry,
      strike,
      side,
      contractKey: buildRecorderContractKey(symbol, expiry, strike, side),
      exchangeTimestamp,
      backendTimestamp,
      ltp,
      bid: null,
      ask: null,
      volume: null,
      oi: finite(leg.oi),
      oiChange: null,
      iv: finite(leg.iv),
      delta: finite(leg.delta),
      gamma: null,
      vega: finite(leg.vega),
      theta: finite(leg.theta),
      intrinsic,
      extrinsic: intrinsic == null ? null : ltp - intrinsic,
    };
  };

  return [
    ...(idx.ceStrikesNear || []).map((x) => toOption(x, "CE")),
    ...(idx.peStrikesNear || []).map((x) => toOption(x, "PE")),
  ].filter((x): x is RecorderOptionSnapshot => x != null);
}

export function adaptRecorderSession(session: SourceSession): RecorderIngestPayload[] {
  const snapshots = Array.isArray(session?.snapshots)
    ? session.snapshots.filter((s) => s && s.snapshotStatus !== "STALE" && s.snapshotStatus !== "INVALID")
    : [];
  const latest = snapshots.at(-1);
  if (!latest) return [];

  const history = snapshots.slice(-20);
  const symbols: RecorderSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  return symbols.flatMap((symbol) => {
    const idx = latest[symbol];
    if (!idx || finite(idx.spot) == null) return [];
    const market = {
      snapshotId: latest.snapshotId || idx.snapshotId || "",
      symbol,
      exchangeTimestamp: idx.exchangeTimestamp || null,
      backendTimestamp: latest.backendTimestamp || new Date().toISOString(),
      spot: finite(idx.spot),
      future: null,
      futureOi: null,
      futureVolume: null,
      vwap: finite(idx.vwap),
      pdh: finite(idx.pdh),
      pdl: finite(idx.pdl),
    };
    return [{ market, options: optionsFor(symbol, latest), verdicts: verdicts(symbol, history) }];
  });
}

export async function fetchSourcePayloads(sourceUrl: string, sourceToken = ""): Promise<RecorderIngestPayload[]> {
  const response = await fetch(sourceUrl, {
    headers: sourceToken ? { authorization: `Bearer ${sourceToken}` } : undefined,
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const session = await response.json() as SourceSession;
  return adaptRecorderSession(session);
}
