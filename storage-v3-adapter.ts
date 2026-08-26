import { persistStorageV3Minute, minuteBucketUtcIso, type StorageV3Symbol, type StorageV3WriteResult } from "./storage-v3-writer.js";
import type { MarketSnapshot1mRow, OptionSnapshot1mRow, ChainState1mRow } from "./db.js";
import { classifyFreshness, type FreshnessResult } from "./freshness-engine.js";
import { classifyExpiryBuckets, resolveFrontFuture } from "./instrument-truth.js";
import { openingGapPct } from "./source-truth-storage.js";
import type { SourceTruthPersistenceRecord, SourceTruthRecordKind } from "./source-truth-db.js";
import type {
  ContractIdentity,
  IdentityState,
  SourceProvider,
  SourceTruthReasonCode,
} from "./source-truth-types.js";

type Numeric = number | null | undefined;

type ProvenanceLike = {
  sourceProvider?: string | null;
  receivedAt?: string | null;
  sourceVersion?: string | null;
  exchange?: string | null;
  segment?: string | null;
  instrumentToken?: string | number | null;
  tradingSymbol?: string | null;
};

type PremiumLike = ProvenanceLike & {
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

type FutureLike = ProvenanceLike & {
  expiry?: string | null;
  ltp?: Numeric;
  oi?: Numeric;
  volume?: Numeric;
  basis?: Numeric;
  quoteTimestamp?: string | null;
};

export type ExistingMarketSnapshotLike = ProvenanceLike & {
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

export type ExistingFastChainLike = ProvenanceLike & {
  oiPcr?: Numeric;
  volumePcr?: Numeric;
  fullChainPcr?: Numeric;
  maxPain?: Numeric;
  sourceTimestamp?: string | null;
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

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
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

function provider(value: string | null | undefined): SourceProvider {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "KITE" || v === "ZERODHA") return "KITE";
  if (v === "DHAN" || v === "DHANHQ") return "DHAN";
  if (v === "INTERNAL_MODEL") return "INTERNAL_MODEL";
  if (v === "EXCHANGE_REFERENCE") return "EXCHANGE_REFERENCE";
  return "UNKNOWN";
}

function configuredFreshness(sourceTimestamp: string | null | undefined, receivedAt: string): FreshnessResult {
  if (!sourceTimestamp) {
    return { state: "UNKNOWN", dataAgeMs: null, usability: "BLOCKED", reasons: ["SOURCE_TS_MISSING"] };
  }
  const sourceMs = new Date(sourceTimestamp).getTime();
  const receivedMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(sourceMs) || !Number.isFinite(receivedMs)) {
    return { state: "UNKNOWN", dataAgeMs: null, usability: "BLOCKED", reasons: ["SOURCE_TS_INVALID"] };
  }

  // Phase 30 deliberately does not freeze a universal market-data threshold.
  // Until shadow-calibrated values are configured, age is stored but evidence is blocked.
  const freshMaxMs = Number(process.env.SOURCE_TRUTH_FRESH_MS);
  const agingMaxMs = Number(process.env.SOURCE_TRUTH_AGING_MS);
  if (!Number.isFinite(freshMaxMs) || !Number.isFinite(agingMaxMs) || freshMaxMs < 0 || agingMaxMs < freshMaxMs) {
    return {
      state: "UNKNOWN",
      dataAgeMs: receivedMs - sourceMs,
      usability: "BLOCKED",
      reasons: ["CRITICAL_FIELD_UNKNOWN"],
    };
  }
  return classifyFreshness(sourceTimestamp, receivedAt, { freshMaxMs, agingMaxMs });
}

function observedTruthRecord(args: {
  recordKind: SourceTruthRecordKind;
  symbol: StorageV3Symbol;
  minuteBucket: string;
  identity: ContractIdentity;
  sourceProvider?: string | null;
  sourceTimestamp?: string | null;
  receivedAt?: string | null;
  adapterNow: string;
  sourceVersion?: string | null;
  calculationVersion: string;
  forcedIdentityState?: IdentityState;
  forcedReasons?: SourceTruthReasonCode[];
  requireDerivativeIdentity?: boolean;
}): SourceTruthPersistenceRecord {
  const explicitReceivedAt = validIso(args.receivedAt);
  const receivedAt = explicitReceivedAt ?? args.adapterNow;
  const freshness = configuredFreshness(args.sourceTimestamp, receivedAt);
  const reasons = [...freshness.reasons, ...(args.forcedReasons ?? [])];
  if (!explicitReceivedAt) reasons.push("RECEIVED_AT_APPROXIMATED");

  const p = provider(args.sourceProvider);
  const derivativeMetadataComplete = args.identity.instrumentToken != null &&
    !!args.identity.tradingSymbol && !!args.identity.segment && !!args.identity.expiry;
  const basicSourceKnown = p !== "UNKNOWN";

  let identityState: IdentityState;
  if (args.forcedIdentityState) {
    identityState = args.forcedIdentityState;
  } else if (args.requireDerivativeIdentity) {
    identityState = derivativeMetadataComplete ? "PARTIAL" : "UNKNOWN";
  } else {
    identityState = basicSourceKnown ? "PARTIAL" : "UNKNOWN";
  }

  if (identityState === "PARTIAL") reasons.push("IDENTITY_NOT_CROSSCHECKED");
  if (identityState === "UNKNOWN" && args.requireDerivativeIdentity && args.identity.instrumentToken == null) reasons.push("TOKEN_MISSING");
  if (identityState === "UNKNOWN") reasons.push("CRITICAL_FIELD_UNKNOWN");

  const uniqueReasons = [...new Set(reasons)];
  const hardIdentity = identityState === "MISMATCH" || identityState === "AMBIGUOUS" || identityState === "UNKNOWN";
  const usability = hardIdentity || freshness.usability === "BLOCKED" ? "BLOCKED" : "CONTEXT_ONLY";

  return {
    recordKind: args.recordKind,
    symbol: args.symbol,
    minuteBucket: args.minuteBucket,
    expiry: args.identity.expiry ?? null,
    strike: args.identity.strike ?? null,
    optionType: args.identity.optionType ?? null,
    sourceProvider: p,
    sourceTimestamp: validIso(args.sourceTimestamp),
    receivedAt,
    computedAt: args.adapterNow,
    dataAgeMs: freshness.dataAgeMs,
    freshnessState: freshness.state,
    identityState,
    qualityState: hardIdentity ? "UNKNOWN" : "PARTIAL",
    usability,
    reasonCodes: uniqueReasons,
    identity: args.identity,
    sourceVersion: args.sourceVersion ?? null,
    calculationVersion: args.calculationVersion,
  };
}

const INDIA_TIME_ZONE = "Asia/Kolkata";
const MARKET_OPEN_MINUTE_IST = 9 * 60 + 15;
const MARKET_CLOSE_MINUTE_IST = 15 * 60 + 30;

function storageSessionGate(now: Date = new Date()): { allowed: boolean; reason?: string } {
  if (!Number.isFinite(now.getTime())) return { allowed: false, reason: "INVALID_SERVER_TIME" };

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { allowed: false, reason: "INVALID_IST_TIME" };
  }
  if (weekday === "Sat" || weekday === "Sun") {
    return { allowed: false, reason: "MARKET_CLOSED_DAY" };
  }

  const minuteOfDay = hour * 60 + minute;
  if (minuteOfDay < MARKET_OPEN_MINUTE_IST) {
    return { allowed: false, reason: "BEFORE_MARKET_OPEN" };
  }
  if (minuteOfDay > MARKET_CLOSE_MINUTE_IST) {
    return { allowed: false, reason: "AFTER_MARKET_CLOSE" };
  }
  return { allowed: true };
}

function tradeDateIst(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function chooseBand(strikes: number[], atm: number, radius = 7): Set<number> {
  const unique = [...new Set(strikes.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!unique.length) return new Set<number>();
  const atmIndex = unique.reduce((best, value, index) =>
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
  validationStatus: string;
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
    validationStatus: args.validationStatus,
    calculationVersion: "STORAGE_V3_PHASE30",
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
  if (!market) return { ok: false, skipped: true, reason: "NO_EXISTING_MARKET_SNAPSHOT", marketWrites: 0, optionWrites: 0, chainWrites: 0, truthWrites: 0 };

  const session = storageSessionGate();
  if (!session.allowed) {
    return { ok: false, skipped: true, reason: session.reason, marketWrites: 0, optionWrites: 0, chainWrites: 0, truthWrites: 0 };
  }

  const adapterNow = new Date().toISOString();
  const backendIso = market.timestamp && Number.isFinite(new Date(market.timestamp).getTime()) ? new Date(market.timestamp).toISOString() : adapterNow;
  const minuteBucket = minuteBucketUtcIso(backendIso);
  const tradeDate = tradeDateIst(backendIso);
  const spot = finite(market.current) ?? finite(market.spot);
  const atmStrike = finite(market.atmStrike);
  if (spot === null || atmStrike === null) {
    return { ok: false, skipped: true, reason: "MISSING_SPOT_OR_ATM", marketWrites: 0, optionWrites: 0, chainWrites: 0, truthWrites: 0 };
  }

  const futuresContracts = market.futuresContracts ?? [];
  const futureResolution = resolveFrontFuture(tradeDate, futuresContracts);
  const future = (futureResolution.state === "VALID" ? futureResolution.contract as FutureLike : futuresContracts[0]) ?? undefined;
  const pdc = finite(market.pdcClose);

  const marketTruth = observedTruthRecord({
    recordKind: "MARKET",
    symbol,
    minuteBucket,
    identity: {
      underlying: symbol,
      exchange: market.exchange ?? null,
      segment: market.segment ?? null,
      instrumentToken: market.instrumentToken ?? null,
      tradingSymbol: market.tradingSymbol ?? null,
    },
    sourceProvider: market.sourceProvider,
    sourceTimestamp: market.exchangeTimestamp,
    receivedAt: market.receivedAt,
    adapterNow,
    sourceVersion: market.sourceVersion,
    calculationVersion: "STORAGE_V3_PHASE30",
  });

  const marketRow: MarketSnapshot1mRow = {
    symbol,
    minuteBucket,
    snapshotId: market.snapshotId ?? null,
    exchangeTimestamp: market.exchangeTimestamp ?? null,
    backendTimestamp: backendIso,
    freshnessStatus: marketTruth.freshnessState,
    spotLtp: spot,
    spotOpen: finite(market.dayOpen),
    spotHigh: finite(market.dayHigh),
    spotLow: finite(market.dayLow),
    spotPrevClose: pdc,
    vwap: finite(market.vwap),
    pdh: finite(market.pdh),
    pdl: finite(market.pdl),
    gapPercent: openingGapPct(finite(market.dayOpen), pdc),
    futureLtp: finite(future?.ltp),
    futureVwap: null,
    futureOi: finite(future?.oi),
    futureOiChange: null,
    futureVolume: finite(future?.volume),
    futureBasis: finite(future?.basis),
    indiaVix: finite(market.vix),
    indiaVixChange: finite(market.vixChange),
    calculationVersion: "STORAGE_V3_PHASE30",
  };

  const options: OptionSnapshot1mRow[] = [];
  const chains: ChainState1mRow[] = [];
  const sourceTruth: SourceTruthPersistenceRecord[] = [marketTruth];

  if (future) {
    sourceTruth.push(observedTruthRecord({
      recordKind: "FUTURES",
      symbol,
      minuteBucket,
      identity: {
        underlying: symbol,
        exchange: future.exchange ?? null,
        segment: future.segment ?? null,
        instrumentToken: future.instrumentToken ?? null,
        tradingSymbol: future.tradingSymbol ?? null,
        expiry: dateOnly(future.expiry),
      },
      sourceProvider: future.sourceProvider ?? market.sourceProvider,
      sourceTimestamp: future.quoteTimestamp,
      receivedAt: future.receivedAt ?? market.receivedAt,
      adapterNow,
      sourceVersion: future.sourceVersion ?? market.sourceVersion,
      calculationVersion: "STORAGE_V3_PHASE30",
      requireDerivativeIdentity: true,
      forcedIdentityState: futureResolution.state === "VALID" ? undefined : futureResolution.state,
      forcedReasons: futureResolution.reasons,
    }));
  }

  const preparedExpiries = (market.expiries ?? []).map((exp) => {
    const ceRows = exp.ceStrikes ?? [];
    const peRows = exp.peStrikes ?? [];
    const expiry = dateOnly(ceRows.find((r) => r.expiryDate)?.expiryDate ?? peRows.find((r) => r.expiryDate)?.expiryDate);
    return expiry ? { exp, ceRows, peRows, expiry } : null;
  }).filter((x): x is { exp: ExpiryLike; ceRows: PremiumLike[]; peRows: PremiumLike[]; expiry: string } => !!x);

  const expiryClass = classifyExpiryBuckets(tradeDate, preparedExpiries.map((x) => x.expiry));
  const bucketByExpiry = new Map(expiryClass.map((x) => [x.expiry, x.bucket]));

  for (const prepared of preparedExpiries) {
    const { ceRows, peRows, expiry } = prepared;
    const expiryBucket = bucketByExpiry.get(expiry) ?? "UNKNOWN";
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

    const mapPremium = (row: PremiumLike, side: "CE" | "PE") => {
      const strike = finite(row.strike);
      if (strike === null) return;
      const truth = observedTruthRecord({
        recordKind: "OPTION",
        symbol,
        minuteBucket,
        identity: {
          underlying: symbol,
          exchange: row.exchange ?? null,
          segment: row.segment ?? null,
          instrumentToken: row.instrumentToken ?? null,
          tradingSymbol: row.tradingSymbol ?? null,
          expiry,
          strike,
          optionType: side,
        },
        sourceProvider: row.sourceProvider ?? market.sourceProvider,
        sourceTimestamp: row.quoteTimestamp,
        receivedAt: row.receivedAt ?? market.receivedAt,
        adapterNow,
        sourceVersion: row.sourceVersion ?? market.sourceVersion,
        calculationVersion: "STORAGE_V3_PHASE30",
        requireDerivativeIdentity: true,
      });
      const mapped = premiumToRow({
        symbol,
        minuteBucket,
        backendIso,
        snapshotId: market.snapshotId ?? null,
        expiry,
        expiryBucket,
        spot,
        atmStrike,
        strikeStep,
        side,
        row,
        callWall: callWall.strike,
        putWall: putWall.strike,
        validationStatus: `${truth.identityState}:${truth.freshnessState}:${truth.usability}`,
      });
      if (mapped) {
        options.push(mapped);
        sourceTruth.push(truth);
      }
    };

    for (const row of selectedCe) mapPremium(row, "CE");
    for (const row of selectedPe) mapPremium(row, "PE");

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
    const isCurrent = expiryBucket === "CURRENT";

    const chainTruth = observedTruthRecord({
      recordKind: "CHAIN",
      symbol,
      minuteBucket,
      identity: { underlying: symbol, expiry },
      sourceProvider: fast?.sourceProvider ?? market.sourceProvider,
      sourceTimestamp: isCurrent ? fast?.sourceTimestamp : null,
      receivedAt: fast?.receivedAt ?? market.receivedAt,
      adapterNow,
      sourceVersion: fast?.sourceVersion ?? market.sourceVersion,
      calculationVersion: "STORAGE_V3_PHASE30",
      forcedIdentityState: provider(fast?.sourceProvider ?? market.sourceProvider) === "UNKNOWN" ? "UNKNOWN" : "PARTIAL",
      forcedReasons: isCurrent ? [] : ["PARTIAL_EXPIRY_COVERAGE"],
    });
    sourceTruth.push(chainTruth);

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
      validationStatus: `${chainTruth.identityState}:${chainTruth.freshnessState}:${chainTruth.usability}`,
      calculationVersion: "STORAGE_V3_PHASE30",
    });
  }

  const result = await persistStorageV3Minute({ market: marketRow, options, chains, sourceTruth });
  return { ...result, skipped: false };
}
