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
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dteFrom(expiry: string, now: Date): number | null {
  const e = new Date(`${expiry}T00:00:00Z`);
  if (Number.isNaN(e.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = e.getTime() - today;
  return Math.max(0, Math.ceil(diff / 86_400_000));
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
    const previousNearOi: number | null = null; // intentionally not fabricated; future adapter state may supply a verified delta

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
      futureOiChange: near && previousNearOi !== null && near.oi !== null ? near.oi - previousNearOi : null,
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
          atmOffset: Math.round((leg.strike - market.atmStrike) / Math.max(1, Math.abs(leg.strike - market.atmStrike) || 1)),
          isCandidate: request.candidateKeys?.has(key) ?? false,
          isWall: request.wallKeys?.has(key) ?? false,
          ltp: finiteOrNull(leg.lastPrice),
          bid: finiteOrNull(leg.bid),
          ask: finiteOrNull(leg.ask),
          spread: Number.isFinite(leg.bid) && Number.isFinite(leg.ask) ? Math.max(0, leg.ask - leg.bid) : null,
          volume: finiteOrNull(leg.volume),
          oi: finiteOrNull(leg.oi),
          oiChange: null,
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

      const chainRow: ChainState1mRow = {
        symbol: market.symbol,
        minuteBucket: bucket,
        expiry: expiryDate,
        expiryBucket: expiry.expiry,
        atmStrike: finiteOrNull(market.atmStrike),
        fullChainOiPcr: finiteOrNull(market.pcr),
        band7OiPcr: band7Pcr(expiry, market.atmStrike),
        volumePcr: finiteOrNull(market.volumePcr),
        maxPain: finiteOrNull(market.maxPain),
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
