import {
  buildRecorderContractKey,
  type RecorderOptionSnapshot,
  type RecorderStrategyVerdict,
  type RecorderSymbol,
} from "./option-recorder-shadow.js";
import type { RecorderIngestPayload } from "./option-recorder-runtime.js";

type Side = "CE" | "PE";

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

type ExportLeg = {
  strike?: number | null;
  side?: Side | null;
  isAtm?: boolean;
  expiryDate?: string | null;
  expiryBucket?: string | null;
  tradingSymbol?: string | null;
  instrumentToken?: number | null;
  bid?: number | null;
  ask?: number | null;
  lastPrice?: number | null;
  volume?: number | null;
  oi?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  vega?: number | null;
  theta?: number | null;
  quoteTimestamp?: string | null;
};

type ExportExpiry = {
  label?: string | null;
  expiryDate?: string | null;
  ce?: ExportLeg[];
  pe?: ExportLeg[];
};

type ExportFuture = {
  label?: string | null;
  expiry?: string | null;
  ltp?: number | null;
  oi?: number | null;
  volume?: number | null;
  basis?: number | null;
  quoteTimestamp?: string | null;
};

type ExportIndex = {
  snapshotId?: string | null;
  backendTimestamp?: string | null;
  exchangeTimestamp?: string | null;
  spot?: number | null;
  vwap?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  atmStrike?: number | null;
  pcr?: number | null;
  volumePcr?: number | null;
  maxPain?: number | null;
  futuresVwapBias?: "UP" | "DOWN" | "UNKNOWN" | null;
  gapScore?: { score?: number; verdict?: string; trend?: string; fullChainPcr?: number | null } | null;
  futuresContracts?: ExportFuture[];
  expiries?: ExportExpiry[];
};

type RecorderExport = {
  ok?: boolean;
  architectureRole?: string;
  generatedAt?: string;
  symbols?: Partial<Record<RecorderSymbol, ExportIndex>>;
  recorderSnapshots?: SourceSnapshot[];
};

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function validHistory(session: SourceSession | RecorderExport): SourceSnapshot[] {
  const snapshots = "recorderSnapshots" in session ? session.recorderSnapshots : session.snapshots;
  return Array.isArray(snapshots)
    ? snapshots.filter((s) => s && s.snapshotStatus !== "STALE" && s.snapshotStatus !== "INVALID").slice(-20)
    : [];
}

function directionFromHistory(symbol: RecorderSymbol, history: SourceSnapshot[], fallback?: ExportIndex): Side | "NONE" {
  const current = history.at(-1)?.[symbol];
  const previous = history.at(-2)?.[symbol];
  const spot = finite(current?.spot) ?? finite(fallback?.spot);
  const prevSpot = finite(previous?.spot);
  const vwap = finite(current?.vwap) ?? finite(fallback?.vwap);
  if (spot == null || vwap == null) return "NONE";
  if (prevSpot != null) {
    if (spot > prevSpot && spot > vwap) return "CE";
    if (spot < prevSpot && spot < vwap) return "PE";
    return "NONE";
  }
  if (spot > vwap) return "CE";
  if (spot < vwap) return "PE";
  return "NONE";
}

function premiumConfirmed(symbol: RecorderSymbol, history: SourceSnapshot[], side: Side): boolean {
  const current = history.at(-1)?.[symbol];
  const previous = history.at(-2)?.[symbol];
  const key = side === "CE" ? "ceLtp" : "peLtp";
  const now = finite(current?.[key]);
  const before = finite(previous?.[key]);
  return now != null && before != null && now > before;
}

function persistentDirection(symbol: RecorderSymbol, history: SourceSnapshot[], side: Side): boolean {
  const rows = history.slice(-3).map((s) => finite(s[symbol]?.spot)).filter((v): v is number => v != null);
  if (rows.length < 3) return false;
  return side === "CE"
    ? rows[0] < rows[1] && rows[1] < rows[2]
    : rows[0] > rows[1] && rows[1] > rows[2];
}

function futuresConfirmed(index: ExportIndex | undefined, side: Side): boolean {
  if (!index) return false;
  if (side === "CE" && index.futuresVwapBias === "UP") return true;
  if (side === "PE" && index.futuresVwapBias === "DOWN") return true;
  const near = index.futuresContracts?.find((f) => f.label === "Near") ?? index.futuresContracts?.[0];
  const spot = finite(index.spot);
  const future = finite(near?.ltp);
  if (spot == null || future == null) return false;
  return side === "CE" ? future >= spot : future <= spot;
}

function liquidityAvailable(index: ExportIndex | undefined): boolean {
  const current = index?.expiries?.[0];
  const legs = [...(current?.ce ?? []), ...(current?.pe ?? [])];
  return legs.some((l) => finite(l.bid) != null && finite(l.ask) != null && finite(l.volume) != null);
}

function expiryOiDirection(expiry: ExportExpiry | undefined): Side | "NONE" {
  if (!expiry) return "NONE";
  const ceOi = (expiry.ce ?? []).reduce((sum, l) => sum + (finite(l.oi) ?? 0), 0);
  const peOi = (expiry.pe ?? []).reduce((sum, l) => sum + (finite(l.oi) ?? 0), 0);
  if (ceOi <= 0 || peOi <= 0) return "NONE";
  const ratio = peOi / ceOi;
  if (ratio >= 1.08) return "CE";
  if (ratio <= 0.92) return "PE";
  return "NONE";
}

function multiExpiryDirection(index: ExportIndex | undefined): Side | "NONE" {
  const expiries = (index?.expiries ?? []).filter((e) => Boolean(e.expiryDate));
  if (expiries.length < 2) return "NONE";
  const dirs = expiries.slice(0, 3).map(expiryOiDirection).filter((d): d is Side => d !== "NONE");
  if (dirs.length < 2) return "NONE";
  return dirs.every((d) => d === dirs[0]) ? dirs[0] : "NONE";
}

function legacyVerdicts(symbol: RecorderSymbol, history: SourceSnapshot[]): RecorderStrategyVerdict[] {
  const dir = directionFromHistory(symbol, history);
  const confirmed = dir !== "NONE" && premiumConfirmed(symbol, history, dir);
  const persistent = dir !== "NONE" && persistentDirection(symbol, history, dir);
  return [
    {
      mode: "SCALP",
      state: dir !== "NONE" && confirmed ? "TRADEABLE" : "WATCH",
      direction: dir !== "NONE" && confirmed ? dir : "NONE",
      quality: dir !== "NONE" && confirmed ? "MEDIUM" : "LOW",
      evidence: dir !== "NONE" && confirmed ? ["SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION"] : ["SCALP_CONFIRMATION_INCOMPLETE"],
      conflicts: [],
    },
    {
      mode: "TRADER",
      state: dir !== "NONE" && confirmed && persistent ? "TRADEABLE" : "WATCH",
      direction: dir !== "NONE" && confirmed && persistent ? dir : "NONE",
      quality: dir !== "NONE" && confirmed && persistent ? "MEDIUM" : "LOW",
      evidence: dir !== "NONE" && confirmed && persistent
        ? ["THREE_SNAPSHOT_PERSISTENCE", "SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION"]
        : ["INTRADAY_PERSISTENCE_INCOMPLETE"],
      conflicts: [],
    },
    {
      mode: "SWING",
      state: "WATCH",
      direction: "NONE",
      quality: "UNAVAILABLE",
      evidence: ["MULTI_EXPIRY_SOURCE_REQUIRED"],
      conflicts: ["LEGACY_RECORDER_FEED_DOES_NOT_CARRY_MULTI_EXPIRY_LIQUIDITY"],
    },
  ];
}

function enrichedVerdicts(symbol: RecorderSymbol, history: SourceSnapshot[], index: ExportIndex): RecorderStrategyVerdict[] {
  const dir = directionFromHistory(symbol, history, index);
  const premium = dir !== "NONE" && premiumConfirmed(symbol, history, dir);
  const persistent = dir !== "NONE" && persistentDirection(symbol, history, dir);
  const futures = dir !== "NONE" && futuresConfirmed(index, dir);
  const liquidity = liquidityAvailable(index);
  const crossExpiry = multiExpiryDirection(index);

  const scalpPass = dir !== "NONE" && premium && futures && liquidity;
  const traderPass = scalpPass && persistent;
  const swingPass = dir !== "NONE" && persistent && futures && liquidity && crossExpiry === dir;

  const scalp: RecorderStrategyVerdict = {
    mode: "SCALP",
    state: scalpPass ? "TRADEABLE" : "WATCH",
    direction: scalpPass ? dir : "NONE",
    quality: scalpPass ? "MEDIUM" : "LOW",
    evidence: scalpPass
      ? ["SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION", "FUTURES_CONFIRMATION", "LIQUIDITY_FIELDS_PRESENT"]
      : ["SCALP_GATE_INCOMPLETE"],
    conflicts: liquidity ? [] : ["LIQUIDITY_DATA_INCOMPLETE"],
  };

  const trader: RecorderStrategyVerdict = {
    mode: "TRADER",
    state: traderPass ? "TRADEABLE" : "WATCH",
    direction: traderPass ? dir : "NONE",
    quality: traderPass ? "MEDIUM" : "LOW",
    evidence: traderPass
      ? ["THREE_SNAPSHOT_PERSISTENCE", "SPOT_VWAP_DIRECTION", "PREMIUM_CONTINUATION", "FUTURES_CONFIRMATION"]
      : ["TRADER_GATE_INCOMPLETE"],
    conflicts: [],
  };

  const swing: RecorderStrategyVerdict = {
    mode: "SWING",
    state: swingPass ? "TRADEABLE" : "WATCH",
    direction: swingPass ? dir : "NONE",
    quality: swingPass ? "MEDIUM" : crossExpiry === "NONE" ? "UNAVAILABLE" : "LOW",
    evidence: swingPass
      ? ["MULTI_EXPIRY_OI_ALIGNMENT", "THREE_SNAPSHOT_PERSISTENCE", "FUTURES_CONFIRMATION", "LIQUIDITY_FIELDS_PRESENT"]
      : ["SWING_MULTI_EXPIRY_CONFIRMATION_INCOMPLETE"],
    conflicts: crossExpiry !== "NONE" && dir !== "NONE" && crossExpiry !== dir ? ["MULTI_EXPIRY_DIRECTION_CONFLICT"] : [],
  };

  return [scalp, trader, swing];
}

function legacyOptionsFor(symbol: RecorderSymbol, snapshot: SourceSnapshot): RecorderOptionSnapshot[] {
  const idx = snapshot[symbol];
  if (!idx) return [];
  const snapshotId = snapshot.snapshotId || idx.snapshotId || "";
  const backendTimestamp = snapshot.backendTimestamp || new Date().toISOString();
  const exchangeTimestamp = idx.exchangeTimestamp || null;
  const expiry = "CURRENT_RECORDER_EXPIRY";
  const spot = finite(idx.spot);

  const toOption = (leg: SourceLeg, side: Side): RecorderOptionSnapshot | null => {
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

function enrichedOptionsFor(symbol: RecorderSymbol, index: ExportIndex, generatedAt: string): RecorderOptionSnapshot[] {
  const snapshotId = index.snapshotId || "";
  const backendTimestamp = generatedAt || index.backendTimestamp || new Date().toISOString();
  const spot = finite(index.spot);

  const toOption = (leg: ExportLeg, side: Side, expiryDate: string): RecorderOptionSnapshot | null => {
    const strike = finite(leg.strike);
    const ltp = finite(leg.lastPrice);
    if (!expiryDate || strike == null || strike <= 0 || ltp == null || ltp <= 0) return null;
    const intrinsic = spot == null ? null : Math.max(side === "CE" ? spot - strike : strike - spot, 0);
    return {
      snapshotId,
      symbol,
      expiry: expiryDate,
      strike,
      side,
      contractKey: buildRecorderContractKey(symbol, expiryDate, strike, side),
      exchangeTimestamp: leg.quoteTimestamp || index.exchangeTimestamp || null,
      backendTimestamp,
      ltp,
      bid: finite(leg.bid),
      ask: finite(leg.ask),
      volume: finite(leg.volume),
      oi: finite(leg.oi),
      oiChange: null,
      iv: finite(leg.iv),
      delta: finite(leg.delta),
      gamma: finite(leg.gamma),
      vega: finite(leg.vega),
      theta: finite(leg.theta),
      intrinsic,
      extrinsic: intrinsic == null ? null : ltp - intrinsic,
    };
  };

  const out: RecorderOptionSnapshot[] = [];
  for (const expiry of index.expiries ?? []) {
    const expiryDate = typeof expiry.expiryDate === "string" ? expiry.expiryDate : "";
    if (!expiryDate) continue;
    for (const leg of expiry.ce ?? []) {
      const item = toOption(leg, "CE", expiryDate);
      if (item) out.push(item);
    }
    for (const leg of expiry.pe ?? []) {
      const item = toOption(leg, "PE", expiryDate);
      if (item) out.push(item);
    }
  }
  return out;
}

export function adaptRecorderSession(session: SourceSession): RecorderIngestPayload[] {
  const snapshots = validHistory(session);
  const latest = snapshots.at(-1);
  if (!latest) return [];
  const symbols: RecorderSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  return symbols.flatMap((symbol) => {
    const idx = latest[symbol];
    if (!idx || finite(idx.spot) == null) return [];
    return [{
      market: {
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
      },
      options: legacyOptionsFor(symbol, latest),
      verdicts: legacyVerdicts(symbol, snapshots),
    }];
  });
}

export function adaptRecorderExport(source: RecorderExport): RecorderIngestPayload[] {
  if (source.architectureRole !== "OPTION_RECORDER_EXPORT_V1") return [];
  const history = validHistory(source);
  const generatedAt = source.generatedAt || new Date().toISOString();
  const symbols: RecorderSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  return symbols.flatMap((symbol) => {
    const index = source.symbols?.[symbol];
    if (!index || finite(index.spot) == null || !index.snapshotId) return [];
    const near = index.futuresContracts?.find((f) => f.label === "Near") ?? index.futuresContracts?.[0];
    return [{
      market: {
        snapshotId: index.snapshotId,
        symbol,
        exchangeTimestamp: index.exchangeTimestamp || index.backendTimestamp || generatedAt,
        backendTimestamp: generatedAt,
        spot: finite(index.spot),
        future: finite(near?.ltp),
        futureOi: finite(near?.oi),
        futureVolume: finite(near?.volume),
        vwap: finite(index.vwap),
        pdh: finite(index.pdh),
        pdl: finite(index.pdl),
      },
      options: enrichedOptionsFor(symbol, index, generatedAt),
      verdicts: enrichedVerdicts(symbol, history, index),
    }];
  });
}

export async function fetchSourcePayloads(sourceUrl: string, sourceToken = ""): Promise<RecorderIngestPayload[]> {
  const response = await fetch(sourceUrl, {
    headers: sourceToken ? { authorization: `Bearer ${sourceToken}` } : undefined,
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const data = await response.json() as SourceSession | RecorderExport;
  if ((data as RecorderExport).architectureRole === "OPTION_RECORDER_EXPORT_V1") {
    return adaptRecorderExport(data as RecorderExport);
  }
  return adaptRecorderSession(data as SourceSession);
}
