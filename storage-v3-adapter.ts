import { persistStorageV3Minute, minuteBucketUtcIso, type StorageV3Symbol, type StorageV3WriteResult } from "./storage-v3-writer.js";
import type { MarketSnapshot1mRow, OptionSnapshot1mRow, ChainState1mRow } from "./db.js";

type Numeric = number | null | undefined;

type PremiumLike = {
  strike?: Numeric;
  isAtm?: boolean;
  expiryDate?: string | null;
  expiryBucket?: string | null;
  optionType?: "CE" | "PE" | null;
  bid?: Numeric;
  ask?: Numeric;
  lastPrice?: Numeric;
  iv?: Numeric;
  oi?: Numeric;
  volume?: Numeric;
  quoteTimestamp?: string | null;
  dayHigh?: Numeric;
  dayLow?: Numeric;
  pdh?: Numeric;
  pdl?: Numeric;
  delta?: Numeric;
  gamma?: Numeric;
  vega?: Numeric;
  theta?: Numeric;
};

type ExpiryLike = {
  expiry?: string;
  ceStrikes?: PremiumLike[];
  peStrikes?: PremiumLike[];
};

type FutureLike = {
  ltp?: Numeric;
  oi?: Numeric;
  volume?: Numeric;
  basis?: Numeric;
  quoteTimestamp?: string | null;
};

export type ExistingMarketSnapshotLike = {
  current?: Numeric;
  spot?: Numeric;
  dayOpen?: Numeric;
  dayHigh?: Numeric;
  dayLow?: Numeric;
  pdcClose?: Numeric;
  vwap?: Numeric;
  pdh?: Numeric;
  pdl?: Numeric;
  vix?: Numeric;
  vixChange?: Numeric;
  atmStrike?: Numeric;
  snapshotId?: string | null;
  exchangeTimestamp?: string | null;
  timestamp?: string | null;
  futuresContracts?: FutureLike[];
  expiries?: ExpiryLike[];
};

export type ExistingFastChainLike = {
  oiPcr?: Numeric;
  volumePcr?: Numeric;
  fullChainPcr?: Numeric;
  maxPain?: Numeric;
};

export interface StorageV3AdapterResult extends StorageV3WriteResult {
  skipped: boolean;
  reason?: string;
}

function finite(value: Numeric): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function dteFromExpiry(expiry: string, atIso: string): number | null {
  const exp = new Date(`${expiry}T00:00:00+05:30`).getTime();
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((exp - at) / 86_400_000));
}

function quoteAgeSeconds(quoteTimestamp: string | null | undefined, backendIso: string): number | null {
  if (!quoteTimestamp) return null;
  const quote = new Date(quoteTimestamp).getTime();
  const backend = new Date(backendIso).getTime();
  if (!Number.isFinite(quote) || !Number.isFinite(backend)) return null;
  return Math.max(0, Math.round((backend - quote) / 1000));
}

function chooseBand(strikes: number[], atm: number, radius = 7): Set<number> {
  const unique = [...new Set(strikes.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!unique.length) return new Set<number>();
  let atmIndex = unique.reduce((best, value, index) =>
    Math.abs(value - atm) < Math.abs(unique[best] - atm) ? index : best, 0);
  const start = Math.max(0, atmIndex - radius);
  const end = Math.min(unique.length, atmIndex + radius + 1);
  return new Set(unique.slice(start, end));
}

function maxOiWall(rows: PremiumLike[]): { strike: number | null; oi: number | null; strength: number | null } {
  const valid = rows
    .map((row) => ({ strike: finite(row.strike), oi: finite(row.oi) }))
    .filter((row): row is { strike: number; oi: number } => row.strike !== null && row.oi !== null && row.oi >= 0);
  if (!valid.length) return { strike: null, oi: null, strength: null };
  const total = valid.reduce((sum, row) => sum + row.oi, 0);
  const top = valid.reduce((a, b) => (b.oi > a.oi ? b : a));
  return { strike: top.strike, oi: top.oi, strength: total > 0 ? top.oi / total : null };
}

function premiumToRow(args: {
  symbol: StorageV3Symbol;
  minuteBucket: string;
  backendIso: string;
  snapshotId: string | null;
  expiry: string;
  expiryBucket: string | null;
  spot: number;
  atmStrike: number;
  strikeStep: number | null;
  side: "CE" | "PE";
  row: PremiumLike;
  callWall: number | null;
  putWall: number | null;
}): OptionSnapshot1mRow | null {
  const strike = finite(args.row.strike);
  if (strike === null) return null;
  const ltp = finite(args.row.lastPrice);
  const intrinsic = args.side === "CE" ? Math.max(args.spot - strike, 0) : Math.max(strike - args.spot, 0);
  const extrinsic = ltp === null ? null : Math.max(ltp - intrinsic, 0);
  const bid = finite(args.row.bid);
  const ask = finite(args.row.ask);
  return {
    symbol: args.symbol,
    minuteBucket: args.minuteBucket,
    snapshotId: args.snapshotId,
    expiry: args.expiry,
    expiryBucket: args.expiryBucket,
    dte: dteFromExpiry(args.expiry, args.backendIso),
    strike,
    optionType: args.side,
    atmOffset: args.strikeStep && args.strikeStep > 0 ? Math.round((strike - args.atmStrike) / args.strikeStep) : null,
    isCandidate: false,
    isWall: (args.side === "CE" && strike === args.callWall) || (args.side === "PE" && strike === args.putWall),
    ltp,
    bid,
    ask,
    spread: bid !== null && ask !== null ? Math.max(0, ask - bid) : null,
    volume: finite(args.row.volume),
    oi: finite(args.row.oi),
    oiChange: null,
    iv: finite(args.row.iv),
    delta: finite(args.row.delta),
    gamma: finite(args.row.gamma),
    vega: finite(args.row.vega),
    theta: finite(args.row.theta),
    intrinsic,
    extrinsic,
    dayHigh: finite(args.row.dayHigh),
    dayLow: finite(args.row.dayLow),
    pdh: finite(args.row.pdh),
    pdl: finite(args.row.pdl),
    quoteTimestamp: args.row.quoteTimestamp ?? null,
    quoteAgeSeconds: quoteAgeSeconds(args.row.quoteTimestamp, args.backendIso),
    liquidityStatus: null,
    validationStatus: args.row.quoteTimestamp ? "TIMESTAMP_PRESENT" : "TIMESTAMP_UNAVAILABLE",
    calculationVersion: "STORAGE_V3_PHASE1",
  };
}

/**
 * Converts data ALREADY present in OptionPilot's live snapshot/cache into the
 * normalized 1-minute store. It performs no network/API request and has no
 * scoring, verdict, Telegram, candidate or execution side effect.
 */
export async function persistStorageV3FromExistingSnapshot(
  symbol: StorageV3Symbol,
  market: ExistingMarketSnapshotLike | null | undefined,
  fast: ExistingFastChainLike | null | undefined,
): Promise<StorageV3AdapterResult> {
  if (!market) return { ok: false, skipped: true, reason: "NO_EXISTING_MARKET_SNAPSHOT", marketWrites: 0, optionWrites: 0, chainWrites: 0 };

  const backendIso = market.timestamp && Number.isFinite(new Date(market.timestamp).getTime()) ? market.timestamp : new Date().toISOString();
  const minuteBucket = minuteBucketUtcIso(backendIso);
  const spot = finite(market.current) ?? finite(market.spot);
  const atmStrike = finite(market.atmStrike);
  if (spot === null || atmStrike === null) {
    return { ok: false, skipped: true, reason: "MISSING_SPOT_OR_ATM", marketWrites: 0, optionWrites: 0, chainWrites: 0 };
  }

  const future = market.futuresContracts?.[0];
  const pdc = finite(market.pdcClose);
  const marketRow: MarketSnapshot1mRow = {
    symbol,
    minuteBucket,
    snapshotId: market.snapshotId ?? null,
    exchangeTimestamp: market.exchangeTimestamp ?? null,
    backendTimestamp: backendIso,
    freshnessStatus: null,
    spotLtp: spot,
    spotOpen: finite(market.dayOpen),
    spotHigh: finite(market.dayHigh),
    spotLow: finite(market.dayLow),
    spotPrevClose: pdc,
    vwap: finite(market.vwap),
    pdh: finite(market.pdh),
    pdl: finite(market.pdl),
    gapPercent: pdc && pdc !== 0 ? ((spot - pdc) / pdc) * 100 : null,
    futureLtp: finite(future?.ltp),
    futureVwap: null,
    futureOi: finite(future?.oi),
    futureOiChange: null,
    futureVolume: finite(future?.volume),
    futureBasis: finite(future?.basis),
    indiaVix: finite(market.vix),
    indiaVixChange: finite(market.vixChange),
    calculationVersion: "STORAGE_V3_PHASE1",
  };

  const options: OptionSnapshot1mRow[] = [];
  const chains: ChainState1mRow[] = [];

  for (const exp of market.expiries ?? []) {
    const ceRows = exp.ceStrikes ?? [];
    const peRows = exp.peStrikes ?? [];
    const expiry = dateOnly(ceRows.find((r) => r.expiryDate)?.expiryDate ?? peRows.find((r) => r.expiryDate)?.expiryDate);
    if (!expiry) continue;

    const expiryBucket = ceRows.find((r) => r.expiryBucket)?.expiryBucket ?? peRows.find((r) => r.expiryBucket)?.expiryBucket ?? exp.expiry ?? null;
    const allStrikes = [...ceRows, ...peRows].map((r) => finite(r.strike)).filter((v): v is number => v !== null);
    const uniqueSorted = [...new Set(allStrikes)].sort((a, b) => a - b);
    const positiveSteps = uniqueSorted.slice(1).map((value, i) => value - uniqueSorted[i]).filter((v) => v > 0);
    const strikeStep = positiveSteps.length ? Math.min(...positiveSteps) : null;
    const band = chooseBand(uniqueSorted, atmStrike, 7);
    const callWall = maxOiWall(ceRows);
    const putWall = maxOiWall(peRows);

    const selectedCe = ceRows.filter((r) => {
      const s = finite(r.strike);
      return s !== null && (band.has(s) || s === callWall.strike);
    });
    const selectedPe = peRows.filter((r) => {
      const s = finite(r.strike);
      return s !== null && (band.has(s) || s === putWall.strike);
    });

    for (const row of selectedCe) {
      const mapped = premiumToRow({ symbol, minuteBucket, backendIso, snapshotId: market.snapshotId ?? null, expiry, expiryBucket, spot, atmStrike, strikeStep, side: "CE", row, callWall: callWall.strike, putWall: putWall.strike });
      if (mapped) options.push(mapped);
    }
    for (const row of selectedPe) {
      const mapped = premiumToRow({ symbol, minuteBucket, backendIso, snapshotId: market.snapshotId ?? null, expiry, expiryBucket, spot, atmStrike, strikeStep, side: "PE", row, callWall: callWall.strike, putWall: putWall.strike });
      if (mapped) options.push(mapped);
    }

    const atmCe = ceRows.reduce<PremiumLike | null>((best, row) => {
      const s = finite(row.strike); if (s === null) return best;
      if (!best) return row;
      const bs = finite(best.strike); return bs === null || Math.abs(s - atmStrike) < Math.abs(bs - atmStrike) ? row : best;
    }, null);
    const atmPe = peRows.reduce<PremiumLike | null>((best, row) => {
      const s = finite(row.strike); if (s === null) return best;
      if (!best) return row;
      const bs = finite(best.strike); return bs === null || Math.abs(s - atmStrike) < Math.abs(bs - atmStrike) ? row : best;
    }, null);
    const atmCeLtp = finite(atmCe?.lastPrice), atmPeLtp = finite(atmPe?.lastPrice);
    const atmCeIv = finite(atmCe?.iv), atmPeIv = finite(atmPe?.iv);
    const isCurrent = /current/i.test(expiryBucket ?? "") || (market.expiries ?? [])[0] === exp;

    chains.push({
      symbol,
      minuteBucket,
      expiry,
      expiryBucket,
      atmStrike,
      fullChainOiPcr: isCurrent ? finite(fast?.fullChainPcr) : null,
      band7OiPcr: isCurrent ? finite(fast?.oiPcr) : null,
      volumePcr: isCurrent ? finite(fast?.volumePcr) : null,
      maxPain: isCurrent ? finite(fast?.maxPain) : null,
      callWallStrike: callWall.strike,
      callWallOi: callWall.oi,
      callWallStrength: callWall.strength,
      callWallDistance: callWall.strike === null ? null : callWall.strike - spot,
      callWallMigration: null,
      putWallStrike: putWall.strike,
      putWallOi: putWall.oi,
      putWallStrength: putWall.strength,
      putWallDistance: putWall.strike === null ? null : putWall.strike - spot,
      putWallMigration: null,
      atmIv: atmCeIv !== null && atmPeIv !== null ? (atmCeIv + atmPeIv) / 2 : atmCeIv ?? atmPeIv,
      straddleLtp: atmCeLtp !== null && atmPeLtp !== null ? atmCeLtp + atmPeLtp : null,
      straddleChange: null,
      validationStatus: "FROM_EXISTING_LIVE_SNAPSHOT",
      calculationVersion: "STORAGE_V3_PHASE1",
    });
  }

  const result = await persistStorageV3Minute({ market: marketRow, options, chains });
  return { ...result, skipped: false };
}
