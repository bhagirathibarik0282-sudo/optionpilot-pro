import {
  dbInsert,
  dbUpsertChainState1m,
  dbUpsertMarketSnapshot1m,
  dbUpsertOptionSnapshot1m,
  type ChainState1mRow,
  type MarketSnapshot1mRow,
  type OptionSnapshot1mRow,
} from "./db.js";

export type H1TruthVerdict = "TRUE" | "PARTIAL" | "STALE" | "INVALID";

export interface H1PremiumInput {
  strike: number;
  isAtm: boolean;
  expiryDate: string | null;
  expiryBucket: string | null;
  optionType: "CE" | "PE" | null;
  bid: number;
  ask: number;
  lastPrice: number;
  iv: number;
  oi: number;
  volume: number | null;
  quoteTimestamp: string | null;
  dayHigh: number;
  dayLow: number;
  pdh: number;
  pdl: number;
  vega: number;
  theta: number;
  delta: number;
  gamma: number;
}

export interface H1ExpiryInput {
  expiry: string;
  expiryDate: Date;
  ceStrikes: H1PremiumInput[];
  peStrikes: H1PremiumInput[];
}

export interface H1FuturesInput {
  label: "Near" | "Next" | "Far";
  expiry: string;
  ltp: number;
  oi: number | null;
  volume: number | null;
  basis: number | null;
  quoteTimestamp: string | null;
}

export interface H1IndexInput {
  symbol: string;
  snapshotId: string;
  exchangeTimestamp: string | null;
  timestamp?: string;
  spot: number;
  atmStrike: number;
  vwap: number;
  pdh: number;
  pdl: number;
  pdcClose: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  vix: number;
  vixChange: number;
  maxPain: number;
  pcr: number | null;
  volumePcr: number | null;
  futuresContracts: H1FuturesInput[];
  expiries: H1ExpiryInput[];
}

export interface H1RecordRequest {
  market: H1IndexInput;
  truthVerdict: H1TruthVerdict;
  rejectedFields?: string[];
  calculationVersion: string;
  now?: Date;
  candidateKeys?: ReadonlySet<string>;
  wallKeys?: ReadonlySet<string>;
}

const RESEARCH_ELIGIBLE = new Set<H1TruthVerdict>(["TRUE"]);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minuteBucketIso(date: Date): string {
  const d = new Date(date);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

function safeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const exact = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (exact) return value;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Expiry is an exchange calendar date. Shift to IST before extracting the date
  // so a UTC representation around midnight cannot silently move the contract day.
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istDateOnly(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function dteFrom(expiry: string, now: Date): number | null {
  const expiryMatch = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const today = istDateOnly(now).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!expiryMatch || !today) return null;
  const expiryUtc = Date.UTC(Number(expiryMatch[1]), Number(expiryMatch[2]) - 1, Number(expiryMatch[3]));
  const todayUtc = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3]));
  return Math.max(0, Math.round((expiryUtc - todayUtc) / 86_400_000));
}

function optionKey(symbol: string, expiry: string, strike: number, side: "CE" | "PE"): string {
  return `${symbol}|${expiry}|${strike}|${side}`;
}

function validationStatus(verdict: H1TruthVerdict): string {
  return RESEARCH_ELIGIBLE.has(verdict) ? "RESEARCH_ELIGIBLE" : `DIAGNOSTIC_${verdict}`;
}

function quoteAgeSeconds(ts: string | null, now: Date): number | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 1000));
}

function liquidityStatus(bid: number, ask: number): string {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return "INVALID_QUOTE";
  const mid = (bid + ask) / 2;
  if (mid <= 0) return "INVALID_QUOTE";
  const spreadPct = ((ask - bid) / mid) * 100;
  // Provisional research buckets only. They are labels, not execution approval.
  if (spreadPct <= 0.5) return "TIGHT";
  if (spreadPct <= 1.5) return "NORMAL";
  if (spreadPct <= 3) return "WIDE";
  return "VERY_WIDE";
}

function intrinsicExtrinsic(spot: number, strike: number, side: "CE" | "PE", premium: number): { intrinsic: number | null; extrinsic: number | null } {
  if (![spot, strike, premium].every(Number.isFinite)) return { intrinsic: null, extrinsic: null };
  const intrinsic = side === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  return { intrinsic, extrinsic: Math.max(0, premium - intrinsic) };
}

function band7<T extends H1PremiumInput>(legs: T[], atmStrike: number): T[] {
  const ordered = [...legs].sort((a, b) => a.strike - b.strike);
  if (ordered.length <= 15) return ordered;
  const atmIndex = ordered.reduce((best, leg, i) =>
    Math.abs(leg.strike - atmStrike) < Math.abs(ordered[best].strike - atmStrike) ? i : best, 0);
  return ordered.slice(Math.max(0, atmIndex - 7), Math.min(ordered.length, atmIndex + 8));
}

function atmOffset(expiry: H1ExpiryInput, strike: number, atmStrike: number): number | null {
  const strikes = [...new Set([...expiry.ceStrikes, ...expiry.peStrikes].map((x) => x.strike))].sort((a, b) => a - b);
  if (strikes.length === 0) return null;
  const atmIndex = strikes.reduce((best, value, i) =>
    Math.abs(value - atmStrike) < Math.abs(strikes[best] - atmStrike) ? i : best, 0);
  const strikeIndex = strikes.indexOf(strike);
  return strikeIndex >= 0 ? strikeIndex - atmIndex : null;
}

function band7Pcr(expiry: H1ExpiryInput, atmStrike: number): number | null {
  const ceOi = band7(expiry.ceStrikes, atmStrike).reduce((sum, x) => sum + (finiteOrNull(x.oi) ?? 0), 0);
  const peOi = band7(expiry.peStrikes, atmStrike).reduce((sum, x) => sum + (finiteOrNull(x.oi) ?? 0), 0);
  return ceOi > 0 ? peOi / ceOi : null;
}

function atmIv(expiry: H1ExpiryInput, atmStrike: number): number | null {
  const legs = [...expiry.ceStrikes, ...expiry.peStrikes]
    .filter((x) => Number.isFinite(x.iv))
    .sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike));
  if (legs.length === 0) return null;
  const nearestStrike = legs[0].strike;
  const sameStrike = legs.filter((x) => x.strike === nearestStrike);
  return sameStrike.reduce((s, x) => s + x.iv, 0) / sameStrike.length;
}

function straddleLtp(expiry: H1ExpiryInput, atmStrike: number): number | null {
  const ce = [...expiry.ceStrikes].sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike))[0];
  const pe = [...expiry.peStrikes].sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike))[0];
  if (!ce || !pe || !Number.isFinite(ce.lastPrice) || !Number.isFinite(pe.lastPrice)) return null;
  return ce.lastPrice + pe.lastPrice;
}

function isCurrentExpiryLabel(label: string): boolean {
  return /current/i.test(label);
}

/**
 * H1 side-channel recorder.
 *
 * Safety contract:
 * - Never throws into the live decision path.
 * - TRUE records are research-eligible.
 * - PARTIAL/STALE are persisted only as diagnostics.
 * - INVALID does not write normalized market/option/chain rows; it only writes an audit event.
 * - No trading verdict, target, SL or candidate decision is calculated here.
 */
export async function recordH1Snapshot(request: H1RecordRequest): Promise<void> {
  const now = request.now ?? new Date();
  const market = request.market;
  const bucket = minuteBucketIso(now);

  try {
    if (request.truthVerdict === "INVALID") {
      await dbInsert("H1_RECORDER_REJECT", {
        symbol: market.symbol,
        snapshotId: market.snapshotId,
        minuteBucket: bucket,
        truthVerdict: request.truthVerdict,
        rejectedFields: request.rejectedFields ?? [],
        calculationVersion: request.calculationVersion,
      });
      return;
    }

    const near = market.futuresContracts.find((x) => x.label === "Near") ?? market.futuresContracts[0];

    const marketRow: MarketSnapshot1mRow = {
      symbol: market.symbol,
      minuteBucket: bucket,
      snapshotId: market.snapshotId,
      exchangeTimestamp: market.exchangeTimestamp,
      backendTimestamp: market.timestamp ?? now.toISOString(),
      freshnessStatus: request.truthVerdict,
      spotLtp: finiteOrNull(market.spot),
      spotOpen: finiteOrNull(market.dayOpen),
      spotHigh: finiteOrNull(market.dayHigh),
      spotLow: finiteOrNull(market.dayLow),
      spotPrevClose: finiteOrNull(market.pdcClose),
      vwap: finiteOrNull(market.vwap),
      pdh: finiteOrNull(market.pdh),
      pdl: finiteOrNull(market.pdl),
      gapPercent: Number.isFinite(market.pdcClose) && market.pdcClose !== 0
        ? ((market.dayOpen - market.pdcClose) / market.pdcClose) * 100
        : null,
      futureLtp: near ? finiteOrNull(near.ltp) : null,
      futureVwap: null,
      futureOi: near ? finiteOrNull(near.oi) : null,
      futureOiChange: null, // never synthesize a delta without a verified prior observation
      futureVolume: near ? finiteOrNull(near.volume) : null,
      futureBasis: near ? finiteOrNull(near.basis) : null,
      indiaVix: finiteOrNull(market.vix),
      indiaVixChange: finiteOrNull(market.vixChange),
      calculationVersion: request.calculationVersion,
    };

    await dbUpsertMarketSnapshot1m(marketRow);

    for (const expiry of market.expiries) {
      const expiryDate = safeDateOnly(expiry.expiryDate);
      if (!expiryDate) {
        await dbInsert("H1_EXPIRY_REJECT", {
          symbol: market.symbol,
          snapshotId: market.snapshotId,
          minuteBucket: bucket,
          expiry: expiry.expiry,
          reason: "INVALID_EXPIRY_DATE",
        });
        continue;
      }

      const selectedLegs = [
        ...band7(expiry.ceStrikes, market.atmStrike),
        ...band7(expiry.peStrikes, market.atmStrike),
      ];

      for (const leg of selectedLegs) {
        const side = leg.optionType;
        if (side !== "CE" && side !== "PE") continue;
        const key = optionKey(market.symbol, expiryDate, leg.strike, side);
        const ie = intrinsicExtrinsic(market.spot, leg.strike, side, leg.lastPrice);
        const row: OptionSnapshot1mRow = {
          symbol: market.symbol,
          minuteBucket: bucket,
          snapshotId: market.snapshotId,
          expiry: expiryDate,
          expiryBucket: leg.expiryBucket ?? expiry.expiry,
          dte: dteFrom(expiryDate, now),
          strike: leg.strike,
          optionType: side,
          atmOffset: atmOffset(expiry, leg.strike, market.atmStrike),
          isCandidate: request.candidateKeys?.has(key) ?? false,
          isWall: request.wallKeys?.has(key) ?? false,
          ltp: finiteOrNull(leg.lastPrice),
          bid: finiteOrNull(leg.bid),
          ask: finiteOrNull(leg.ask),
          spread: Number.isFinite(leg.bid) && Number.isFinite(leg.ask) ? Math.max(0, leg.ask - leg.bid) : null,
          volume: finiteOrNull(leg.volume),
          oi: finiteOrNull(leg.oi),
          oiChange: null, // requires a verified prior contract observation
          iv: finiteOrNull(leg.iv),
          delta: finiteOrNull(leg.delta),
          gamma: finiteOrNull(leg.gamma),
          vega: finiteOrNull(leg.vega),
          theta: finiteOrNull(leg.theta),
          intrinsic: ie.intrinsic,
          extrinsic: ie.extrinsic,
          dayHigh: finiteOrNull(leg.dayHigh),
          dayLow: finiteOrNull(leg.dayLow),
          pdh: finiteOrNull(leg.pdh),
          pdl: finiteOrNull(leg.pdl),
          quoteTimestamp: leg.quoteTimestamp,
          quoteAgeSeconds: quoteAgeSeconds(leg.quoteTimestamp, now),
          liquidityStatus: liquidityStatus(leg.bid, leg.ask),
          validationStatus: validationStatus(request.truthVerdict),
          calculationVersion: request.calculationVersion,
        };
        await dbUpsertOptionSnapshot1m(row);
      }

      // IndexMetrics currently exposes aggregate PCR/VolumePCR/MaxPain rather than
      // a guaranteed per-expiry version. Persist those only for the explicitly
      // labelled current expiry; otherwise NULL is safer than false precision.
      const currentExpiry = isCurrentExpiryLabel(expiry.expiry);
      const chainRow: ChainState1mRow = {
        symbol: market.symbol,
        minuteBucket: bucket,
        expiry: expiryDate,
        expiryBucket: expiry.expiry,
        atmStrike: finiteOrNull(market.atmStrike),
        fullChainOiPcr: currentExpiry ? finiteOrNull(market.pcr) : null,
        band7OiPcr: band7Pcr(expiry, market.atmStrike),
        volumePcr: currentExpiry ? finiteOrNull(market.volumePcr) : null,
        maxPain: currentExpiry ? finiteOrNull(market.maxPain) : null,
        callWallStrike: null,
        callWallOi: null,
        callWallStrength: null,
        callWallDistance: null,
        callWallMigration: null,
        putWallStrike: null,
        putWallOi: null,
        putWallStrength: null,
        putWallDistance: null,
        putWallMigration: null,
        atmIv: atmIv(expiry, market.atmStrike),
        straddleLtp: straddleLtp(expiry, market.atmStrike),
        straddleChange: null,
        validationStatus: validationStatus(request.truthVerdict),
        calculationVersion: request.calculationVersion,
      };
      await dbUpsertChainState1m(chainRow);
    }
  } catch (err) {
    await dbInsert("H1_RECORDER_ERROR", {
      symbol: market.symbol,
      snapshotId: market.snapshotId,
      minuteBucket: bucket,
      truthVerdict: request.truthVerdict,
      error: err instanceof Error ? err.message : String(err),
      calculationVersion: request.calculationVersion,
    });
  }
}
