import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHash, randomBytes } from "node:crypto";

interface Instrument {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name: string;
  last_price: number;
  expiry: string;
  strike: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
}

interface ExpiryData {
  expiry: string;
  expiryDate: Date;
  ceStrikes: PremiumData[];
  peStrikes: PremiumData[];
  ceError?: string;
  peError?: string;
}

interface PremiumData {
  strike: number;
  isAtm: boolean;
  bid: number;
  ask: number;
  lastPrice: number;
  change: number;
  iv: number;
  oi: number;
  atDayHigh: boolean;
  atDayLow: boolean;
  dayHigh: number; // today's intraday high (Kite's ohlc.high)
  dayLow: number; // today's intraday low (Kite's ohlc.low)
  pdc: number; // previous day close (Kite's ohlc.close)
  pdh: number; // previous trading day's high, for this specific strike's premium
  pdl: number; // previous trading day's low, for this specific strike's premium
}

interface GapScoreComponents {
  gapDirection: -1 | 0 | 1;
  vwapPosition: -1 | 0 | 1;
  pdhPdlStatus: -1 | 0 | 1;
  oiTilt: -1 | 0 | 1;
  sectorBreadth: -1 | 0 | 1;
}

interface GapScore {
  score: number; // -100..100
  verdict: "Continuation" | "Fade Risk" | "Sideways";
  trend: "Strengthening" | "Weakening" | "Flat";
  fullChainPcr: number | null;
  components: GapScoreComponents;
}

interface IndexMetrics {
  symbol: string;
  current: number;
  change: number;
  changePercent: number;
  vix: number;
  vixChange: number;
  vixChangePercent: number;
  spot: number;
  atmStrike: number;
  vwap: number;
  pdh: number;
  pdl: number;
  maxPain: number;
  pcr: number | null;
  volumePcr: number | null;
  vwapSource: string;
  signal: "BUY" | "SELL" | "WAIT";
  futuresVwapBias: "UP" | "DOWN" | "UNKNOWN";
  gapScore?: GapScore;
  expiries: ExpiryData[];
  error?: string;
  timestamp?: string;
}

interface KiteSession {
  accessToken: string;
  userId: string;
  email: string;
  loginTime: number;
  expiresAt: number;
  marketSnapshot?: Record<string, IndexMetrics>;
  snapshotTime?: number;
  refreshPromise?: Promise<Record<string, IndexMetrics>>;
  snapshotHistory?: Array<{
    timestamp: string;
    NIFTY?: { spot: number; pcr: number | null };
    BANKNIFTY?: { spot: number; pcr: number | null };
    SENSEX?: { spot: number; pcr: number | null };
  }>;
  gapScoreHistory?: Record<string, number[]>; // symbol -> recent scores, most recent last
}

// In-memory session store (use Redis in production)
const sessions = new Map<string, KiteSession>();

// In-memory instruments cache (fetched once per app startup)
let instrumentsCache: Instrument[] = [];
let instrumentsCacheTime = 0;
let instrumentsCachePromise: Promise<Instrument[]> | null = null;
const INSTRUMENTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Kite API configuration
const KITE_API_BASE = "https://api.kite.trade";
const KITE_API_KEY = process.env.KITE_API_KEY?.trim() || "";
const KITE_API_SECRET = process.env.KITE_API_SECRET?.trim() || "";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SNAPSHOT_TTL_MS = 3 * 60 * 1000;

// Trading symbols for indices (exact Kite format)
const INDEX_SYMBOLS = {
  NIFTY: "NSE:NIFTY 50",
  BANKNIFTY: "NSE:NIFTY BANK",
  SENSEX: "BSE:SENSEX",
  INDIA_VIX: "NSE:INDIA VIX",
};

// Index name to trading symbol mapping for instrument lookup
const INDEX_NAMES = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  SENSEX: "SENSEX",
};

// Exchange codes for options
const EXCHANGE_CODES = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  SENSEX: "BFO",
};

// Strike gap for each index (NIFTY=50, others=100)
const STRIKE_STEP = {
  NIFTY: 50,
  BANKNIFTY: 100,
  SENSEX: 100,
};

// Generate login URL
function getKiteLoginUrl(): string {
  return `https://kite.trade/connect/login?api_key=${KITE_API_KEY}&v=3`;
}

function indiaDate(offsetDays = 0): string {
  return new Date(Date.now() + INDIA_OFFSET_MS + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function nextKiteExpiryTime(): number {
  const indiaNow = new Date(Date.now() + INDIA_OFFSET_MS);
  const expiryAsIndiaClock = new Date(
    Date.UTC(
      indiaNow.getUTCFullYear(),
      indiaNow.getUTCMonth(),
      indiaNow.getUTCDate() + 1,
      6,
      0,
      0
    )
  );
  return expiryAsIndiaClock.getTime() - INDIA_OFFSET_MS;
}

// Exchange request_token for access_token
async function exchangeRequestToken(
  requestToken: string
): Promise<{ accessToken: string; userId: string; email: string } | null> {
  try {
    const checksum = createHash("sha256")
      .update(`${KITE_API_KEY}${requestToken}${KITE_API_SECRET}`)
      .digest("hex");

    const response = await fetch(`${KITE_API_BASE}/session/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Kite-Version": "3",
      },
      body: new URLSearchParams({
        api_key: KITE_API_KEY,
        request_token: requestToken,
        checksum: checksum,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[KITE] Token exchange failed: HTTP ${response.status}`, errorText);
      return null;
    }

    const data = await response.json();
    if (data.status === "success" && data.data) {
      console.log(`[KITE] Token exchange successful for user: ${data.data.user_id}`);
      return {
        accessToken: data.data.access_token,
        userId: data.data.user_id,
        email: data.data.email,
      };
    }
    console.error("[KITE] Token exchange returned non-success status", data);
    return null;
  } catch (err) {
    console.error("[KITE] Token exchange error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Get session from request
function getSession(c: any): KiteSession | null {
  try {
    const cookies = c.req.header("cookie") || "";
    const sessionId = cookies
      .split("; ")
      .find((row: string) => row.startsWith("session_id="))
      ?.substring(11);

    if (!sessionId) return null;

    const session = sessions.get(sessionId);
    if (!session) return null;

    // Kite access tokens expire at 06:00 IST on the next day.
    if (Date.now() >= session.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }

    return session;
  } catch (err) {
    return null;
  }
}

// Parse expiry date from string (YYYY-MM-DD format)
function parseExpiryDate(expiryStr: string): Date | null {
  try {
    if (!expiryStr || expiryStr.length === 0) return null;
    const parts = expiryStr.split("-");
    if (parts.length !== 3) return null;
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    if (isNaN(date.getTime())) return null;
    return date;
  } catch (err) {
    console.warn(`[KITE] Failed to parse expiry date: ${expiryStr}`);
    return null;
  }
}

// Fetch and cache Kite instruments list
async function fetchInstruments(accessToken: string): Promise<Instrument[]> {
  if (instrumentsCache.length > 0 && Date.now() - instrumentsCacheTime < INSTRUMENTS_CACHE_TTL) {
    return instrumentsCache;
  }
  if (instrumentsCachePromise) return instrumentsCachePromise;

  instrumentsCachePromise = (async () => {
    console.log("[KITE] Fetching instruments list from API");
    const response = await fetch(`${KITE_API_BASE}/instruments`, {
      method: "GET",
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[KITE] Instruments fetch failed: HTTP ${response.status}`,
        errorText.substring(0, 200)
      );
      return [];
    }

    const text = await response.text();
    const lines = text.split("\n").filter((line) => line.trim());

    // Parse CSV format (skip header)
    const instruments: Instrument[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length >= 12) {
        instruments.push({
          instrument_token: parseInt(parts[0]),
          exchange_token: parseInt(parts[1]),
          tradingsymbol: parts[2],
          name: parts[3],
          last_price: parseFloat(parts[4]) || 0,
          expiry: parts[5],
          strike: parseFloat(parts[6]) || 0,
          lot_size: parseInt(parts[8]) || 1,
          instrument_type: parts[9],
          segment: parts[10],
          exchange: parts[11]?.trim(),
        });
      }
    }

    instrumentsCache = instruments;
    instrumentsCacheTime = Date.now();
    console.log(`[KITE] Cached ${instruments.length} total instruments`);
    return instruments;
  })();

  try {
    return await instrumentsCachePromise;
  } catch (err) {
    console.error("[KITE] Instruments fetch error:", err instanceof Error ? err.message : err);
    return [];
  } finally {
    instrumentsCachePromise = null;
  }
}

// Kite often leaves "name" blank for index options (NIFTY/BANKNIFTY/SENSEX),
// so match on tradingsymbol prefix as a fallback (e.g. "BANKNIFTY25JUL55000CE").
// Requires a digit right after the underlying name to avoid matching lookalikes
// like "NIFTYNXT50".
function matchesUnderlying(inst: Instrument, indexDisplayName: string): boolean {
  if (inst.name === indexDisplayName) return true;
  const prefix = inst.tradingsymbol.slice(0, indexDisplayName.length);
  const nextChar = inst.tradingsymbol.charAt(indexDisplayName.length);
  return prefix === indexDisplayName && /[0-9]/.test(nextChar);
}

// Build a fast strike/type -> instrument lookup for one expiry, so PCR band
// lookups don't have to re-scan all ~1.2 lakh instruments per strike.
function buildOptionMap(
  instruments: Instrument[],
  indexName: string,
  expiryDate: string
): Map<string, Instrument> {
  const exchange = EXCHANGE_CODES[indexName as keyof typeof EXCHANGE_CODES];
  const indexDisplayName = INDEX_NAMES[indexName as keyof typeof INDEX_NAMES];
  const map = new Map<string, Instrument>();
  for (const inst of instruments) {
    if (
      inst.exchange === exchange &&
      inst.expiry === expiryDate &&
      (inst.instrument_type === "CE" || inst.instrument_type === "PE") &&
      matchesUnderlying(inst, indexDisplayName)
    ) {
      map.set(`${inst.strike}_${inst.instrument_type}`, inst);
    }
  }
  return map;
}

interface OptionChainStats {
  oiPcr: number | null;
  volumePcr: number | null;
  maxPain: number;
  fullChainPcr: number | null;
}

// OI PCR and Volume PCR use ATM ±7 strikes. Max Pain and full-chain PCR use
// every quoted strike available for the selected expiry.
async function fetchOptionChainStats(
  accessToken: string,
  optionMap: Map<string, Instrument>,
  atmStrike: number,
  strikeStep: number,
  optExchange: string,
  bandSize = 7
): Promise<OptionChainStats> {
  const bandCeSymbols: string[] = [];
  const bandPeSymbols: string[] = [];

  for (let i = -bandSize; i <= bandSize; i++) {
    const strike = atmStrike + i * strikeStep;
    const ce = optionMap.get(`${strike}_CE`);
    const pe = optionMap.get(`${strike}_PE`);
    if (ce) bandCeSymbols.push(`${optExchange}:${ce.tradingsymbol}`);
    if (pe) bandPeSymbols.push(`${optExchange}:${pe.tradingsymbol}`);
  }

  const allInstruments = Array.from(optionMap.values());
  const allSymbols = allInstruments.map((inst) => `${optExchange}:${inst.tradingsymbol}`);
  if (allSymbols.length === 0) return { oiPcr: null, volumePcr: null, maxPain: 0, fullChainPcr: null };

  const quotes = await fetchKiteQuoteBatched(accessToken, allSymbols);
  if (!quotes) return { oiPcr: null, volumePcr: null, maxPain: 0, fullChainPcr: null };

  let totalCallOI = 0;
  let totalPutOI = 0;
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  for (const s of bandCeSymbols) {
    totalCallOI += quotes[s]?.oi || 0;
    totalCallVolume += quotes[s]?.volume || 0;
  }
  for (const s of bandPeSymbols) {
    totalPutOI += quotes[s]?.oi || 0;
    totalPutVolume += quotes[s]?.volume || 0;
  }

  // Full-chain OI PCR: every strike on this expiry, not just the ATM band.
  let fullChainCallOI = 0;
  let fullChainPutOI = 0;
  for (const inst of allInstruments) {
    const q = quotes[`${optExchange}:${inst.tradingsymbol}`];
    const oi = q?.oi || 0;
    if (!oi) continue;
    if (inst.instrument_type === "CE") fullChainCallOI += oi;
    else if (inst.instrument_type === "PE") fullChainPutOI += oi;
  }

  const strikes = Array.from(new Set(allInstruments.map((inst) => inst.strike))).sort(
    (a, b) => a - b
  );
  let maxPain = 0;
  let minimumPayout = Number.POSITIVE_INFINITY;
  for (const settlement of strikes) {
    let payout = 0;
    for (const inst of allInstruments) {
      const quote = quotes[`${optExchange}:${inst.tradingsymbol}`];
      const oi = quote?.oi || 0;
      if (!oi) continue;
      if (inst.instrument_type === "CE") {
        payout += Math.max(0, settlement - inst.strike) * oi;
      } else if (inst.instrument_type === "PE") {
        payout += Math.max(0, inst.strike - settlement) * oi;
      }
    }
    if (payout < minimumPayout) {
      minimumPayout = payout;
      maxPain = settlement;
    }
  }

  return {
    oiPcr: totalCallOI > 0 ? totalPutOI / totalCallOI : null,
    volumePcr: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : null,
    maxPain,
    fullChainPcr: fullChainCallOI > 0 ? fullChainPutOI / fullChainCallOI : null,
  };
}

// Get sorted unique expiry dates from instruments (filtered by index and CE/PE only, must be >= today)
function getExpiryDatesFromInstruments(
  instruments: Instrument[],
  indexName: string
): string[] {
  const exchange = EXCHANGE_CODES[indexName as keyof typeof EXCHANGE_CODES];
  const indexDisplayName = INDEX_NAMES[indexName as keyof typeof INDEX_NAMES];
  const today = indiaDate();

  const expiries = new Set<string>();
  let totalFound = 0;

  for (const inst of instruments) {
    if (
      inst.exchange === exchange &&
      matchesUnderlying(inst, indexDisplayName) &&
      (inst.instrument_type === "CE" || inst.instrument_type === "PE") &&
      inst.expiry
    ) {
      // ISO YYYY-MM-DD strings sort chronologically and avoid server timezone drift.
      if (parseExpiryDate(inst.expiry) && inst.expiry >= today) {
        expiries.add(inst.expiry);
        totalFound++;
      }
    }
  }

  const sortedExpiries = Array.from(expiries).sort();
  console.log(
    `[${indexName}] Found ${totalFound} CE/PE instruments, ${sortedExpiries.length} unique future expiries: ${sortedExpiries.join(", ")}`
  );
  return sortedExpiries;
}

// Find option instrument from cache
function findOptionInstrument(
  instruments: Instrument[],
  indexName: string,
  expiryDate: string,
  strike: number,
  instrumentType: "CE" | "PE"
): Instrument | null {
  const exchange = EXCHANGE_CODES[indexName as keyof typeof EXCHANGE_CODES];
  const indexDisplayName = INDEX_NAMES[indexName as keyof typeof INDEX_NAMES];

  if (!exchange) return null;

  // Filter by exchange, index name, expiry, strike, and instrument type
  const matches = instruments.filter(
    (inst) =>
      inst.exchange === exchange &&
      matchesUnderlying(inst, indexDisplayName) &&
      inst.expiry === expiryDate &&
      inst.strike === strike &&
      inst.instrument_type === instrumentType
  );

  if (matches.length > 0) {
    console.log(
      `[${indexName}] Found ${instrumentType} ${expiryDate} ${strike}: ${matches[0].tradingsymbol}`
    );
    return matches[0];
  }

  console.warn(
    `[${indexName}] No instrument found for ${instrumentType} ${expiryDate} ${strike}`
  );
  return null;
}

// Fetch quote data from Kite using /quote endpoint
async function fetchKiteQuote(
  accessToken: string,
  symbols: string[]
): Promise<any> {
  try {
    // Build query string with repeated i parameters
    const params = new URLSearchParams();
    for (const symbol of symbols) {
      params.append("i", symbol);
    }

    const url = `${KITE_API_BASE}/quote?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[KITE] Quote fetch failed: HTTP ${response.status}`,
        `symbols: ${symbols.join(",")}`,
        `error: ${errorText.substring(0, 200)}`
      );
      return null;
    }

    const data = await response.json();
    if (data.status === "success" && data.data) {
      console.log(`[KITE] Quote fetch successful for ${symbols.length} symbols`);
      return data.data;
    }

    console.error("[KITE] Quote returned non-success status", data);
    return null;
  } catch (err) {
    console.error("[KITE] Quote fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchKiteQuoteBatched(
  accessToken: string,
  symbols: string[],
  batchSize = 500
): Promise<Record<string, any> | null> {
  const merged: Record<string, any> = {};
  for (let i = 0; i < symbols.length; i += batchSize) {
    const quotes = await fetchKiteQuote(accessToken, symbols.slice(i, i + batchSize));
    if (!quotes) return null;
    Object.assign(merged, quotes);
  }
  return merged;
}

// Fetch OHLC data from Kite
async function fetchKiteOHLC(
  accessToken: string,
  symbols: string[]
): Promise<any> {
  try {
    const params = new URLSearchParams();
    for (const symbol of symbols) {
      params.append("i", symbol);
    }

    const url = `${KITE_API_BASE}/quote/ohlc?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[KITE] OHLC fetch failed: HTTP ${response.status}`,
        `symbols: ${symbols.join(",")}`,
        `error: ${errorText.substring(0, 200)}`
      );
      return null;
    }

    const data = await response.json();
    if (data.status === "success" && data.data) {
      console.log(`[KITE] OHLC fetch successful for ${symbols.length} symbols`);
      return data.data;
    }

    console.error("[KITE] OHLC returned non-success status", data);
    return null;
  } catch (err) {
    console.error("[KITE] OHLC fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ============== HISTORICAL DATA (for VIX correlation) ==============

interface DailyCandle {
  date: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
}

function findIndexInstrumentToken(
  instruments: Instrument[],
  tradingsymbol: string,
  exchange = "NSE"
): number | null {
  const match = instruments.find(
    (inst) => inst.exchange === exchange && inst.tradingsymbol === tradingsymbol
  );
  return match ? match.instrument_token : null;
}

async function fetchHistoricalDaily(
  accessToken: string,
  instrumentToken: number,
  fromDate: string,
  toDate: string
): Promise<DailyCandle[]> {
  try {
    const url = `${KITE_API_BASE}/instruments/historical/${instrumentToken}/day?from=${fromDate}&to=${toDate}&oi=0`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${KITE_API_KEY}:${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[KITE] Historical fetch failed for token ${instrumentToken}: HTTP ${response.status}`,
        errorText.substring(0, 200)
      );
      return [];
    }

    const data = await response.json();
    if (data.status === "success" && data.data?.candles) {
      // Each candle: [timestamp, open, high, low, close, volume, oi?]
      return data.data.candles.map((c: any[]) => ({
        date: String(c[0]).slice(0, 10),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
      }));
    }
    console.error("[KITE] Historical returned non-success status", data);
    return [];
  } catch (err) {
    console.error("[KITE] Historical fetch error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function fetchPreviousTradingCandle(
  accessToken: string,
  instrumentToken: number
): Promise<DailyCandle | null> {
  const candles = await fetchHistoricalDaily(
    accessToken,
    instrumentToken,
    indiaDate(-12),
    indiaDate(-1)
  );
  return candles.length > 0 ? candles[candles.length - 1] : null;
}

// ============== PER-STRIKE PDH/PDL (previous day high/low of each option) ==============
// Previous-day levels for a given option contract don't change during the
// trading day, so results are cached in-memory (shared across all sessions)
// to avoid re-hitting Kite's historical endpoint on every 3-minute refresh.
const optionPrevDayCache = new Map<number, { pdh: number; pdl: number; cachedAt: number }>();
const OPTION_PDHPDL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — well within one trading day

async function getOptionPrevDayLevelsBatch(
  accessToken: string,
  instrumentTokens: number[]
): Promise<Map<number, { pdh: number; pdl: number }>> {
  const result = new Map<number, { pdh: number; pdl: number }>();
  const toFetch: number[] = [];

  for (const token of instrumentTokens) {
    const cached = optionPrevDayCache.get(token);
    if (cached && Date.now() - cached.cachedAt < OPTION_PDHPDL_CACHE_TTL) {
      result.set(token, { pdh: cached.pdh, pdl: cached.pdl });
    } else {
      toFetch.push(token);
    }
  }

  if (toFetch.length > 0) {
    const fetched = await Promise.all(
      toFetch.map((token) => fetchPreviousTradingCandle(accessToken, token))
    );
    toFetch.forEach((token, i) => {
      const candle = fetched[i];
      const levels = { pdh: candle?.high || 0, pdl: candle?.low || 0 };
      optionPrevDayCache.set(token, { ...levels, cachedAt: Date.now() });
      result.set(token, levels);
    });
  }

  return result;
}

function findActiveIndexFuture(
  instruments: Instrument[],
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX"
): Instrument | null {
  const exchange = EXCHANGE_CODES[symbol];
  const underlying = INDEX_NAMES[symbol];
  const today = indiaDate();
  return (
    instruments
      .filter(
        (inst) =>
          inst.exchange === exchange &&
          inst.instrument_type === "FUT" &&
          inst.expiry >= today &&
          matchesUnderlying(inst, underlying)
      )
      .sort((a, b) => a.expiry.localeCompare(b.expiry))[0] || null
  );
}

// Pearson correlation coefficient between two equal-length numeric arrays
function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return null;
  return num / den;
}

// ============== COMMODITIES (Crude Oil / Natural Gas) ==============
// MCX commodities work differently from equity indices: there's no fixed
// "spot" symbol — the underlying is whichever futures contract is currently
// active, and it rolls over to a new tradingsymbol every expiry.

interface CommodityMetrics {
  symbol: string;
  current: number;
  change: number;
  changePercent: number;
  pdh: number;
  pdl: number;
  atmStrike: number;
  signal: "BUY" | "SELL" | "WAIT";
  futuresSymbol: string | null;
  optionsExpiry: string | null;
  ceStrikes: PremiumData[];
  peStrikes: PremiumData[];
  error?: string;
  timestamp?: string;
}

const COMMODITY_STRIKE_STEP: Record<string, number> = {
  CRUDEOIL: 50,
  NATURALGAS: 5,
};

// Find the nearest-expiry active futures contract for a commodity on MCX
function findActiveFuture(instruments: Instrument[], commodityName: string): Instrument | null {
  const today = indiaDate();

  const futures = instruments.filter(
    (inst) =>
      inst.exchange === "MCX" &&
      inst.instrument_type === "FUT" &&
      inst.tradingsymbol.startsWith(commodityName)
  );

  const future = futures
    .filter((inst) => parseExpiryDate(inst.expiry) && inst.expiry >= today)
    .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];

  return future || null;
}

// Nearest CE/PE expiry for a commodity on MCX
function nearestCommodityOptionExpiry(instruments: Instrument[], commodityName: string): string | null {
  const today = indiaDate();

  const expiries = new Set<string>();
  for (const inst of instruments) {
    if (
      inst.exchange === "MCX" &&
      (inst.instrument_type === "CE" || inst.instrument_type === "PE") &&
      inst.tradingsymbol.startsWith(commodityName) &&
      inst.expiry
    ) {
      if (parseExpiryDate(inst.expiry) && inst.expiry >= today) expiries.add(inst.expiry);
    }
  }
  const sorted = Array.from(expiries).sort();
  return sorted[0] || null;
}

// Build strike/type -> instrument map for a commodity's options at one expiry
function buildCommodityOptionMap(
  instruments: Instrument[],
  commodityName: string,
  expiryDate: string
): Map<string, Instrument> {
  const map = new Map<string, Instrument>();
  for (const inst of instruments) {
    if (
      inst.exchange === "MCX" &&
      inst.expiry === expiryDate &&
      (inst.instrument_type === "CE" || inst.instrument_type === "PE") &&
      inst.tradingsymbol.startsWith(commodityName)
    ) {
      map.set(`${inst.strike}_${inst.instrument_type}`, inst);
    }
  }
  return map;
}

async function fetchCommodityData(
  accessToken: string,
  instruments: Instrument[],
  commodityName: "CRUDEOIL" | "NATURALGAS"
): Promise<CommodityMetrics> {
  const baseMetrics: CommodityMetrics = {
    symbol: commodityName,
    current: 0,
    change: 0,
    changePercent: 0,
    pdh: 0,
    pdl: 0,
    atmStrike: 0,
    signal: "WAIT",
    futuresSymbol: null,
    optionsExpiry: null,
    ceStrikes: [],
    peStrikes: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const futureInst = findActiveFuture(instruments, commodityName);
    if (!futureInst) {
      baseMetrics.error = `No active ${commodityName} futures contract found`;
      return baseMetrics;
    }
    baseMetrics.futuresSymbol = futureInst.tradingsymbol;

    const quotes = await fetchKiteQuote(accessToken, [`MCX:${futureInst.tradingsymbol}`]);
    const q = quotes?.[`MCX:${futureInst.tradingsymbol}`];
    if (!q) {
      baseMetrics.error = `No live quote for ${futureInst.tradingsymbol}`;
      return baseMetrics;
    }

    baseMetrics.current = q.last_price || 0;
    baseMetrics.change = q.last_price && q.ohlc?.close ? q.last_price - q.ohlc.close : q.net_change || 0;
    baseMetrics.changePercent =
      q.last_price && q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : 0;
    const previousCandle = await fetchPreviousTradingCandle(
      accessToken,
      futureInst.instrument_token
    );
    baseMetrics.pdh = previousCandle?.high || 0;
    baseMetrics.pdl = previousCandle?.low || 0;

    const step = COMMODITY_STRIKE_STEP[commodityName] || 50;
    baseMetrics.atmStrike = Math.round(baseMetrics.current / step) * step;

    // Conservative continuation signal using actual previous-day levels.
    if (baseMetrics.pdh && baseMetrics.current > baseMetrics.pdh) {
      baseMetrics.signal = "BUY";
    } else if (baseMetrics.pdl && baseMetrics.current < baseMetrics.pdl) {
      baseMetrics.signal = "SELL";
    } else {
      baseMetrics.signal = "WAIT";
    }

    const expiry = nearestCommodityOptionExpiry(instruments, commodityName);
    baseMetrics.optionsExpiry = expiry;
    if (!expiry) {
      baseMetrics.error = `No option expiries found for ${commodityName}`;
      return baseMetrics;
    }

    const optionMap = buildCommodityOptionMap(instruments, commodityName, expiry);
    const offsets = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    const strikeList = offsets.map((o) => baseMetrics.atmStrike + o * step);

    const ceInstruments: Record<number, Instrument> = {};
    const peInstruments: Record<number, Instrument> = {};
    const symbolsToFetch: string[] = [];

    for (const strike of strikeList) {
      const ce = optionMap.get(`${strike}_CE`);
      const pe = optionMap.get(`${strike}_PE`);
      if (ce) {
        ceInstruments[strike] = ce;
        symbolsToFetch.push(`MCX:${ce.tradingsymbol}`);
      }
      if (pe) {
        peInstruments[strike] = pe;
        symbolsToFetch.push(`MCX:${pe.tradingsymbol}`);
      }
    }

    if (symbolsToFetch.length === 0) {
      baseMetrics.error = "No CE/PE instruments found for the strike band";
      return baseMetrics;
    }

    const optionQuotes = await fetchKiteQuote(accessToken, symbolsToFetch);
    if (optionQuotes) {
      const allOptionInstruments = [...Object.values(ceInstruments), ...Object.values(peInstruments)];
      const pdhPdlMap = await getOptionPrevDayLevelsBatch(
        accessToken,
        allOptionInstruments.map((inst) => inst.instrument_token)
      );

      for (const strike of strikeList) {
        const isAtm = strike === baseMetrics.atmStrike;

        const ceInst = ceInstruments[strike];
        if (ceInst) {
          const oq = optionQuotes[`MCX:${ceInst.tradingsymbol}`];
          if (oq) {
            const dayHigh = oq.ohlc?.high || oq.last_price;
            const dayLow = oq.ohlc?.low || oq.last_price;
            const levels = pdhPdlMap.get(ceInst.instrument_token) || { pdh: 0, pdl: 0 };
            baseMetrics.ceStrikes.push({
              strike,
              isAtm,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: oq.iv || 0,
              oi: oq.oi || 0,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
            });
          }
        }

        const peInst = peInstruments[strike];
        if (peInst) {
          const oq = optionQuotes[`MCX:${peInst.tradingsymbol}`];
          if (oq) {
            const dayHigh = oq.ohlc?.high || oq.last_price;
            const dayLow = oq.ohlc?.low || oq.last_price;
            const levels = pdhPdlMap.get(peInst.instrument_token) || { pdh: 0, pdl: 0 };
            baseMetrics.peStrikes.push({
              strike,
              isAtm,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: oq.iv || 0,
              oi: oq.oi || 0,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
            });
          }
        }
      }
    }

    return baseMetrics;
  } catch (err) {
    baseMetrics.error = err instanceof Error ? err.message : "Unknown error";
    return baseMetrics;
  }
}

// ============== SECTOR BREADTH (used by Gap Confirmation Score) ==============
// Live % change for the same sector universe used by /api/sectors, reused
// here so the Gap Score can factor in how broad-based the market move is.
const BREADTH_SYMBOLS: Record<string, string> = {
  "Nifty PSU Bank": "NSE:NIFTY PSU BANK",
  "Nifty Smallcap 100": "NSE:NIFTY SMLCAP 100",
  "Nifty Midcap 100": "NSE:NIFTY MIDCAP 100",
  "Nifty IT": "NSE:NIFTY IT",
  "Nifty Oil & Gas": "NSE:NIFTY OIL AND GAS",
  "Nifty Financial Services": "NSE:NIFTY FIN SERVICE",
  "Nifty Auto": "NSE:NIFTY AUTO",
  "Nifty FMCG": "NSE:NIFTY FMCG",
};

async function fetchSectorBreadthPct(accessToken: string): Promise<number | null> {
  try {
    const symbols = Object.values(BREADTH_SYMBOLS);
    const quotes = await fetchKiteQuote(accessToken, symbols);
    if (!quotes) return null;
    let green = 0;
    let counted = 0;
    for (const sym of symbols) {
      const q = quotes[sym];
      if (!q || !q.ohlc?.close) continue;
      counted++;
      const pct = ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100;
      if (pct >= 0) green++;
    }
    if (counted === 0) return null;
    return (green / counted) * 100;
  } catch (err) {
    console.error("[BREADTH] Sector breadth error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ============== GAP CONFIRMATION SCORE ==============
// Combines: gap direction (change vs prev close, proxy for opening-range
// breakout since we don't separately capture today's open), VWAP position,
// PDH/PDL reclaim/break status, full-chain OI PCR tilt, and sector breadth.
// Each component contributes -1 / 0 / +1; the sum is scaled to -100..100.
function computeGapScore(
  metrics: IndexMetrics,
  fullChainPcr: number | null,
  sectorBreadthPct: number | null,
  previousScore: number | undefined
): GapScore {
  const gapDirection: -1 | 0 | 1 =
    metrics.changePercent > 0.15 ? 1 : metrics.changePercent < -0.15 ? -1 : 0;

  const vwapPosition: -1 | 0 | 1 =
    metrics.vwap > 0 && metrics.current > metrics.vwap
      ? 1
      : metrics.vwap > 0 && metrics.current < metrics.vwap
        ? -1
        : 0;

  const pdhPdlStatus: -1 | 0 | 1 =
    metrics.signal === "BUY" ? 1 : metrics.signal === "SELL" ? -1 : 0;

  const oiTilt: -1 | 0 | 1 =
    fullChainPcr != null ? (fullChainPcr > 1.1 ? 1 : fullChainPcr < 0.85 ? -1 : 0) : 0;

  const sectorBreadth: -1 | 0 | 1 =
    sectorBreadthPct != null ? (sectorBreadthPct >= 60 ? 1 : sectorBreadthPct <= 40 ? -1 : 0) : 0;

  const sum = gapDirection + vwapPosition + pdhPdlStatus + oiTilt + sectorBreadth;
  const score = Math.round((sum / 5) * 100);

  let verdict: GapScore["verdict"] = "Sideways";
  if (gapDirection !== 0 && Math.sign(sum) === gapDirection && Math.abs(sum) >= 2) {
    verdict = "Continuation";
  } else if (gapDirection !== 0 && Math.sign(sum) !== 0 && Math.sign(sum) !== gapDirection) {
    verdict = "Fade Risk";
  } else if (gapDirection === 0 && Math.abs(sum) < 2) {
    verdict = "Sideways";
  }

  let trend: GapScore["trend"] = "Flat";
  if (previousScore != null) {
    if (score > previousScore + 5) trend = "Strengthening";
    else if (score < previousScore - 5) trend = "Weakening";
  }

  return {
    score,
    verdict,
    trend,
    fullChainPcr,
    components: { gapDirection, vwapPosition, pdhPdlStatus, oiTilt, sectorBreadth },
  };
}

// Fetch all index data from Kite
async function fetchIndexData(
  accessToken: string,
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX"
): Promise<IndexMetrics> {
  const timestamp = new Date().toISOString();
  const baseMetrics: IndexMetrics = {
    symbol,
    current: 0,
    change: 0,
    changePercent: 0,
    vix: 0,
    vixChange: 0,
    vixChangePercent: 0,
    spot: 0,
    atmStrike: 0,
    vwap: 0,
    pdh: 0,
    pdl: 0,
    maxPain: 0,
    pcr: null,
    volumePcr: null,
    vwapSource: "Unavailable",
    signal: "WAIT",
    futuresVwapBias: "UNKNOWN",
    expiries: [],
    timestamp,
  };

  try {
    console.log(`\n========== [${symbol}] STARTING FETCH ==========`);

    // Fetch spot price and India VIX
    const indexSymbol = INDEX_SYMBOLS[symbol as keyof typeof INDEX_SYMBOLS];
    const vixSymbol = INDEX_SYMBOLS.INDIA_VIX;

    const quoteData = await fetchKiteQuote(accessToken, [indexSymbol, vixSymbol]);

    if (!quoteData) {
      baseMetrics.error = "Failed to fetch spot prices from Kite";
      console.error(`[${symbol}] ${baseMetrics.error}`);
      return baseMetrics;
    }

    // Parse spot data
    const spotQuote = quoteData[indexSymbol];
    if (!spotQuote) {
      baseMetrics.error = `No data for ${indexSymbol}`;
      console.error(`[${symbol}] ${baseMetrics.error}`);
      return baseMetrics;
    }

    baseMetrics.current = spotQuote.last_price || 0;
    const previousClose = spotQuote.ohlc?.close || 0;
    baseMetrics.change =
      previousClose > 0 ? spotQuote.last_price - previousClose : spotQuote.net_change || 0;
    baseMetrics.changePercent =
      spotQuote.last_price && previousClose
        ? ((spotQuote.last_price - previousClose) / previousClose) * 100
        : 0;
    baseMetrics.spot = spotQuote.last_price || 0;

    const strikeStep = STRIKE_STEP[symbol as keyof typeof STRIKE_STEP] || 100;
    baseMetrics.atmStrike = Math.round(baseMetrics.spot / strikeStep) * strikeStep;

    console.log(
      `[${symbol}] Spot: ${baseMetrics.current}, ATM Strike: ${baseMetrics.atmStrike}`
    );

    // Parse VIX data
    const vixQuote = quoteData[vixSymbol];
    if (vixQuote) {
      baseMetrics.vix = vixQuote.last_price || 0;
      const vixPreviousClose = vixQuote.ohlc?.close || 0;
      baseMetrics.vixChange =
        vixPreviousClose > 0 ? baseMetrics.vix - vixPreviousClose : vixQuote.net_change || 0;
      baseMetrics.vixChangePercent =
        vixPreviousClose > 0 ? (baseMetrics.vixChange / vixPreviousClose) * 100 : 0;
    }

    // Fetch instruments list
    const instruments = await fetchInstruments(accessToken);
    if (instruments.length === 0) {
      baseMetrics.error = "Failed to fetch instruments list";
      console.error(`[${symbol}] ${baseMetrics.error}`);
      return baseMetrics;
    }

    console.log(
      `[${symbol}] Total instruments loaded: ${instruments.length}`
    );

    const tokenLookup =
      symbol === "SENSEX"
        ? { exchange: "BSE", tradingsymbol: "SENSEX" }
        : {
            exchange: "NSE",
            tradingsymbol: symbol === "NIFTY" ? "NIFTY 50" : "NIFTY BANK",
          };
    const indexToken = findIndexInstrumentToken(
      instruments,
      tokenLookup.tradingsymbol,
      tokenLookup.exchange
    );
    if (indexToken) {
      const previousCandle = await fetchPreviousTradingCandle(accessToken, indexToken);
      baseMetrics.pdh = previousCandle?.high || 0;
      baseMetrics.pdl = previousCandle?.low || 0;
    }

    let futuresVwapBias: "UP" | "DOWN" | "UNKNOWN" = "UNKNOWN";
    const activeFuture = findActiveIndexFuture(instruments, symbol);
    if (activeFuture) {
      const futureSymbol = `${activeFuture.exchange}:${activeFuture.tradingsymbol}`;
      const futureQuotes = await fetchKiteQuote(accessToken, [futureSymbol]);
      const futureQuote = futureQuotes?.[futureSymbol];
      baseMetrics.vwap = futureQuote?.average_price || 0;
      if (baseMetrics.vwap > 0) {
        baseMetrics.vwapSource = `${activeFuture.tradingsymbol} traded VWAP`;
        futuresVwapBias =
          futureQuote.last_price > baseMetrics.vwap
            ? "UP"
            : futureQuote.last_price < baseMetrics.vwap
              ? "DOWN"
              : "UNKNOWN";
      }
    }
    baseMetrics.futuresVwapBias = futuresVwapBias;

    if (
      baseMetrics.pdh > 0 &&
      baseMetrics.current > baseMetrics.pdh &&
      (futuresVwapBias === "UP" || futuresVwapBias === "UNKNOWN")
    ) {
      baseMetrics.signal = "BUY";
    } else if (
      baseMetrics.pdl > 0 &&
      baseMetrics.current < baseMetrics.pdl &&
      (futuresVwapBias === "DOWN" || futuresVwapBias === "UNKNOWN")
    ) {
      baseMetrics.signal = "SELL";
    }

    // Get available expiry dates for this index
    const availableExpiries = getExpiryDatesFromInstruments(instruments, symbol);

    if (availableExpiries.length === 0) {
      baseMetrics.error = "No option expiries available for this index";
      console.error(`[${symbol}] ${baseMetrics.error}`);
      console.log(`========== [${symbol}] END (ERROR) ==========\n`);
      return baseMetrics;
    }

    // Select current, next, next-to-next and the nearest distinct monthly expiry.
    const currentWeekExpiry = availableExpiries[0] || null;
    const nextWeekExpiry = availableExpiries[1] || null;
    const nextToNextWeekExpiry = availableExpiries[2] || null;
    const monthEndExpiries = Array.from(
      availableExpiries.reduce((map, expiry) => {
        map.set(expiry.slice(0, 7), expiry);
        return map;
      }, new Map<string, string>()).values()
    );
    const monthlyExpiry =
      monthEndExpiries.find((expiry) => expiry !== currentWeekExpiry) ||
      monthEndExpiries[0] ||
      null;

    const expiryMap: Record<string, string | null> = {
      "Current Expiry": currentWeekExpiry,
      "Next Expiry": nextWeekExpiry,
      "Next of Next Expiry": nextToNextWeekExpiry,
      Monthly: monthlyExpiry,
    };

    // PCR from real Kite OI: total Put OI / total Call OI across a strike
    // band around ATM, on the current-week expiry. Also captures full-chain
    // PCR (every strike) for the Gap Confirmation Score.
    let fullChainPcr: number | null = null;
    if (currentWeekExpiry) {
      try {
        const optionMap = buildOptionMap(instruments, symbol, currentWeekExpiry);
        const chainStats = await fetchOptionChainStats(
          accessToken,
          optionMap,
          baseMetrics.atmStrike,
          strikeStep,
          EXCHANGE_CODES[symbol as keyof typeof EXCHANGE_CODES],
          7
        );
        baseMetrics.pcr = chainStats.oiPcr;
        baseMetrics.volumePcr = chainStats.volumePcr;
        baseMetrics.maxPain = chainStats.maxPain;
        fullChainPcr = chainStats.fullChainPcr;
        console.log(
          `[${symbol}] OI PCR: ${baseMetrics.pcr}, Volume PCR: ${baseMetrics.volumePcr}, Max Pain: ${baseMetrics.maxPain}, Full-chain PCR: ${fullChainPcr}`
        );
      } catch (err) {
        console.error(`[${symbol}] PCR calc error:`, err instanceof Error ? err.message : err);
      }
    }

    // Sector breadth for the Gap Confirmation Score (shared computation, kept
    // local to this function's scope so callers don't need extra plumbing).
    let sectorBreadthPct: number | null = null;
    try {
      sectorBreadthPct = await fetchSectorBreadthPct(accessToken);
    } catch (err) {
      console.error(`[${symbol}] Sector breadth error:`, err instanceof Error ? err.message : err);
    }

    // Fetch option premiums for available expiries
    for (const [expiryName, expiryDate] of Object.entries(expiryMap)) {
      if (!expiryDate) {
        console.log(`[${symbol}] Skipping ${expiryName} (no expiry available)`);
        continue;
      }

      const expiryDateObj = parseExpiryDate(expiryDate);
      const expiry: ExpiryData = {
        expiry: expiryName,
        expiryDate: expiryDateObj || new Date(),
        ceStrikes: [],
        peStrikes: [],
      };

      try {
        console.log(
          `[${symbol}] Fetching ${expiryName} options (${expiryDate}): ATM ${baseMetrics.atmStrike} ±2 strikes`
        );

        const optExchange = EXCHANGE_CODES[symbol as keyof typeof EXCHANGE_CODES];
        const optionMap = buildOptionMap(instruments, symbol, expiryDate);

        // ATM-2, ATM-1, ATM, ATM+1, ATM+2
        const offsets = [-2, -1, 0, 1, 2];
        const strikeList = offsets.map((o) => baseMetrics.atmStrike + o * strikeStep);

        const ceInstruments: Record<number, Instrument> = {};
        const peInstruments: Record<number, Instrument> = {};
        const symbolsToFetch: string[] = [];

        for (const strike of strikeList) {
          const ce = optionMap.get(`${strike}_CE`);
          const pe = optionMap.get(`${strike}_PE`);
          if (ce) {
            ceInstruments[strike] = ce;
            symbolsToFetch.push(`${optExchange}:${ce.tradingsymbol}`);
          }
          if (pe) {
            peInstruments[strike] = pe;
            symbolsToFetch.push(`${optExchange}:${pe.tradingsymbol}`);
          }
        }

        if (symbolsToFetch.length === 0) {
          console.warn(
            `[${symbol}] No CE/PE instruments found for ${expiryName} (${expiryDate})`
          );
          expiry.ceError = "CE instruments not found";
          expiry.peError = "PE instruments not found";
          baseMetrics.expiries.push(expiry);
          continue;
        }

        const optionQuotes = await fetchKiteQuote(accessToken, symbolsToFetch);

        if (optionQuotes) {
          const allOptionInstruments = [...Object.values(ceInstruments), ...Object.values(peInstruments)];
          const pdhPdlMap = await getOptionPrevDayLevelsBatch(
            accessToken,
            allOptionInstruments.map((inst) => inst.instrument_token)
          );

          for (const strike of strikeList) {
            const isAtm = strike === baseMetrics.atmStrike;

            const ceInst = ceInstruments[strike];
            if (ceInst) {
              const q = optionQuotes[`${optExchange}:${ceInst.tradingsymbol}`];
              if (q) {
                const dayHigh = q.ohlc?.high || q.last_price;
                const dayLow = q.ohlc?.low || q.last_price;
                const levels = pdhPdlMap.get(ceInst.instrument_token) || { pdh: 0, pdl: 0 };
                expiry.ceStrikes.push({
                  strike,
                  isAtm,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: q.iv || 0,
                  oi: q.oi || 0,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                });
              }
            }

            const peInst = peInstruments[strike];
            if (peInst) {
              const q = optionQuotes[`${optExchange}:${peInst.tradingsymbol}`];
              if (q) {
                const dayHigh = q.ohlc?.high || q.last_price;
                const dayLow = q.ohlc?.low || q.last_price;
                const levels = pdhPdlMap.get(peInst.instrument_token) || { pdh: 0, pdl: 0 };
                expiry.peStrikes.push({
                  strike,
                  isAtm,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: q.iv || 0,
                  oi: q.oi || 0,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                });
              }
            }
          }

          console.log(
            `[${symbol}] ${expiryName}: ${expiry.ceStrikes.length} CE strikes, ${expiry.peStrikes.length} PE strikes`
          );

          if (expiry.ceStrikes.length === 0) expiry.ceError = "No CE quotes returned";
          if (expiry.peStrikes.length === 0) expiry.peError = "No PE quotes returned";
        } else {
          console.error(`[${symbol}] Quote fetch failed for ${expiryName} expiry (${expiryDate})`);
          expiry.ceError = "Quote fetch failed";
          expiry.peError = "Quote fetch failed";
        }
      } catch (err) {
        console.error(
          `[${symbol}] Error fetching ${expiryName} (${expiryDate}):`,
          err instanceof Error ? err.message : err
        );
        expiry.ceError = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
        expiry.peError = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
      }

      baseMetrics.expiries.push(expiry);
    }

    // Attach Gap Confirmation Score last, once all inputs are known. Trend is
    // filled in by the caller (refreshMarketSnapshot), which has access to
    // the session's score history.
    baseMetrics.gapScore = computeGapScore(baseMetrics, fullChainPcr, sectorBreadthPct, undefined);

    console.log(
      `[${symbol}] Successfully fetched data with ${baseMetrics.expiries.length} expiries`
    );
    console.log(`========== [${symbol}] END (SUCCESS) ==========\n`);
    return baseMetrics;
  } catch (err) {
    console.error(`[${symbol}] Error:`, err instanceof Error ? err.message : err);
    baseMetrics.error = err instanceof Error ? err.message : "Unknown error";
    console.log(`========== [${symbol}] END (ERROR) ==========\n`);
    return baseMetrics;
  }
}

// No fabricated headlines: return an empty list until a licensed live-news
// provider is configured.
async function fetchFinancialNews(): Promise<{ title: string; source: string; published: string; url: string }[]> {
  return [];
}

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/")) {
    c.header("Cache-Control", "no-store");
  }
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    kiteConfigured: Boolean(KITE_API_KEY && KITE_API_SECRET),
    timestamp: new Date().toISOString(),
  })
);

async function refreshMarketSnapshot(
  session: KiteSession
): Promise<Record<string, IndexMetrics>> {
  if (session.refreshPromise) return session.refreshPromise;

  session.refreshPromise = (async () => {
    const results = await Promise.all([
      fetchIndexData(session.accessToken, "NIFTY"),
      fetchIndexData(session.accessToken, "BANKNIFTY"),
      fetchIndexData(session.accessToken, "SENSEX"),
    ]);
    const snapshot: Record<string, IndexMetrics> = {
      NIFTY: results[0],
      BANKNIFTY: results[1],
      SENSEX: results[2],
    };

    // Fill in Gap Score trend using this session's score history, then
    // record the new scores for next time.
    session.gapScoreHistory ||= {};
    for (const sym of Object.keys(snapshot)) {
      const m = snapshot[sym];
      if (!m.gapScore) continue;
      const hist = session.gapScoreHistory[sym] || [];
      const previousScore = hist.length > 0 ? hist[hist.length - 1] : undefined;
      if (previousScore != null) {
        if (m.gapScore.score > previousScore + 5) m.gapScore.trend = "Strengthening";
        else if (m.gapScore.score < previousScore - 5) m.gapScore.trend = "Weakening";
        else m.gapScore.trend = "Flat";
      }
      hist.push(m.gapScore.score);
      if (hist.length > 50) hist.shift();
      session.gapScoreHistory[sym] = hist;
    }

    session.marketSnapshot = snapshot;
    session.snapshotTime = Date.now();
    session.snapshotHistory ||= [];
    session.snapshotHistory.push({
      timestamp: new Date(session.snapshotTime).toISOString(),
      NIFTY: { spot: snapshot.NIFTY.current, pcr: snapshot.NIFTY.pcr },
      BANKNIFTY: { spot: snapshot.BANKNIFTY.current, pcr: snapshot.BANKNIFTY.pcr },
      SENSEX: { spot: snapshot.SENSEX.current, pcr: snapshot.SENSEX.pcr },
    });
    if (session.snapshotHistory.length > 200) session.snapshotHistory.shift();
    return snapshot;
  })();

  try {
    return await session.refreshPromise;
  } finally {
    session.refreshPromise = undefined;
  }
}

// Serve the dashboard HTML (with updated frontend code)
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OptionPilot Pro - Options Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0A0F1C;
      --panel: #0F1830;
      --panel-alt: #131E3A;
      --border: #1E2B4A;
      --gold: #C9A227;
      --gold-soft: #8A7328;
      --green: #22B26B;
      --red: #E5484D;
      --text: #E8ECF3;
      --muted: #7C8AA5;
      --muted-dim: #4E5B78;
      --font-display: 'Space Grotesk', sans-serif;
      --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'IBM Plex Mono', monospace;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding-bottom: 20px;
    }

    .container {
      max-width: 100%;
      margin: 0 auto;
      padding: 12px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      gap: 10px;
      flex-wrap: wrap;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }

    .header h1 {
      font-family: var(--font-display);
      font-size: 1.4rem;
      color: var(--gold);
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .header-right {
      display: flex;
      gap: 15px;
      align-items: center;
      flex-wrap: wrap;
    }

    .kite-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.85rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--red);
      animation: pulse 1.5s infinite;
    }

    .status-dot.connected {
      background: var(--green);
      animation: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes blinkArrow {
      0% { opacity: 0.15; transform: scale(0.8); }
      35% { opacity: 1; transform: scale(1.25); }
      100% { opacity: 1; transform: scale(1); }
    }

    .tick-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      animation: blinkArrow 0.7s ease-out 1;
    }

    .tick-arrow.up { color: var(--green); }
    .tick-arrow.down { color: var(--red); }
    .tick-arrow.flat { color: var(--muted-dim); }

    @keyframes directionPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(1.06); }
    }

    .direction {
      display: inline-block;
      margin-left: 6px;
      font-weight: 700;
    }

    .direction.active {
      animation: directionPulse 1.1s ease-in-out infinite;
    }

    .direction.up { color: var(--green); }
    .direction.down { color: var(--red); }
    .direction.flat { color: var(--muted-dim); }

    @keyframes valueBlink {
      0% { opacity: 0.25; }
      100% { opacity: 1; }
    }

    /* Every metric/card value is a fresh DOM node on each refresh (full re-render),
       so this animation replays automatically on every auto-refresh cycle. */
    .metric-value, .card-value, .flash {
      animation: valueBlink 0.5s ease-out;
    }

    .status-text {
      color: var(--muted);
    }

    .status-user {
      color: var(--text);
      font-weight: 600;
    }

    .refresh-controls {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: all 0.2s ease;
      background: var(--panel);
      color: var(--gold);
      border: 1px solid var(--gold-soft);
      font-family: var(--font-body);
    }

    .btn:hover {
      background: var(--gold);
      color: var(--bg);
    }

    .btn:active {
      transform: scale(0.96);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn.primary {
      background: var(--gold);
      border-color: var(--gold);
      color: var(--bg);
    }

    .btn.primary:hover {
      background: var(--gold-soft);
    }

    .refresh-status {
      font-size: 0.75rem;
      font-family: var(--font-mono);
      color: var(--muted);
      min-width: 120px;
      text-align: right;
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      overflow-x: auto;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-weight: 600;
      font-family: var(--font-display);
      font-size: 0.95rem;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .tab-btn.active {
      color: var(--gold);
      border-bottom-color: var(--gold);
    }

    .tab-btn:hover {
      color: var(--gold);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .metric-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      text-align: center;
      min-width: 0;
    }

    .metric-label {
      font-size: 0.7rem;
      color: var(--gold-soft);
      text-transform: uppercase;
      margin-bottom: 6px;
      letter-spacing: 0.5px;
      font-family: var(--font-display);
      font-weight: 600;
    }

    .metric-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--gold);
      margin-bottom: 4px;
      font-family: var(--font-mono);
    }

    .metric-value.na {
      color: var(--red);
      font-size: 0.9rem;
    }

    .metric-change {
      font-size: 0.8rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    .metric-change.positive {
      color: var(--green);
    }

    .metric-change.negative {
      color: var(--red);
    }

    .expiry-section {
      margin-bottom: 20px;
    }

    .expiry-title {
      font-size: 0.85rem;
      color: var(--gold-soft);
      margin-bottom: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-family: var(--font-display);
    }

    .card-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }

    @media (max-width: 640px) {
      .card-row {
        grid-template-columns: 1fr;
      }
      .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .header h1 {
        font-size: 1.15rem;
      }
      .header-right {
        width: 100%;
        align-items: stretch;
        flex-direction: column;
      }
      .refresh-controls {
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .refresh-status {
        min-width: 0;
        text-align: left;
      }
    }

    .premium-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      min-width: 0;
    }

    .table-scroll {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .card-title {
      font-size: 0.8rem;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
      font-family: var(--font-display);
    }

    .card-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .card-item {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      margin-bottom: 4px;
      font-family: var(--font-mono);
    }

    .card-label {
      color: var(--muted-dim);
    }

    .card-value {
      color: var(--text);
      font-weight: 600;
    }

    .card-value.na {
      color: var(--red);
    }

    .card-value.positive {
      color: var(--green);
    }

    .card-value.negative {
      color: var(--red);
    }

    .card-value.unavailable {
      color: var(--red);
      font-size: 0.75rem;
    }

    .loading {
      text-align: center;
      padding: 20px;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    .error {
      background: rgba(229, 72, 77, 0.1);
      border: 1px solid var(--red);
      color: #fca5a5;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
      font-size: 0.9rem;
      white-space: pre-wrap;
      font-family: var(--font-mono);
    }

    .success {
      background: rgba(34, 178, 107, 0.1);
      border: 1px solid var(--green);
      color: #86efac;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
    }

    .timestamp {
      font-size: 0.7rem;
      color: var(--muted-dim);
      margin-top: 20px;
      text-align: center;
      font-family: var(--font-mono);
    }

    .news-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .news-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
    }

    .news-title {
      font-size: 0.95rem;
      color: var(--text);
      font-weight: 600;
      margin-bottom: 6px;
      line-height: 1.4;
    }

    .news-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 8px;
      gap: 10px;
      font-family: var(--font-mono);
    }

    .news-source {
      color: var(--gold-soft);
      font-weight: 600;
    }

    .news-time {
      color: var(--muted-dim);
    }

    .news-link {
      display: inline-block;
      padding: 6px 12px;
      background: var(--panel-alt);
      color: var(--gold);
      border: 1px solid var(--gold-soft);
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.8rem;
      transition: all 0.2s ease;
      font-family: var(--font-body);
    }

    .news-link:hover {
      background: var(--gold);
      color: var(--bg);
    }

    .holidays-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .holiday-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .holiday-item.next-holiday {
      border: 2px solid var(--green);
      background: rgba(34, 178, 107, 0.05);
    }

    .holiday-date {
      font-size: 1.05rem;
      color: var(--gold);
      font-weight: 700;
      min-width: 120px;
      font-family: var(--font-mono);
    }

    .holiday-name {
      flex: 1;
      margin-left: 12px;
      color: var(--text);
      font-size: 0.95rem;
    }

    .holiday-badge {
      background: var(--green);
      color: var(--bg);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .holiday-countdown {
      font-size: 0.8rem;
      color: var(--muted);
      margin-left: 10px;
      font-family: var(--font-mono);
    }

    .badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 700;
      font-family: var(--font-display);
      font-size: 0.85rem;
    }

    .gap-score-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 20px;
    }

    .gap-score-bar-track {
      width: 100%;
      height: 10px;
      border-radius: 6px;
      background: var(--panel-alt);
      overflow: hidden;
      margin: 10px 0;
      position: relative;
    }

    .gap-score-bar-fill {
      height: 100%;
      border-radius: 6px;
      transition: width 0.3s ease;
    }

    .gap-score-components {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    .gap-score-chip {
      font-size: 0.7rem;
      font-family: var(--font-mono);
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      text-align: center;
    }

    .bias-check-card {
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 20px;
      border: 2px solid var(--border);
    }

    .bias-check-signals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    .bias-check-signal {
      font-size: 0.75rem;
      font-family: var(--font-mono);
      padding: 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.15);
      text-align: center;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ OptionPilot Pro</h1>
      <div class="header-right">
        <div class="kite-status">
          <div class="status-dot" id="statusDot"></div>
          <span class="status-text">Status:</span>
          <span class="status-text" id="statusText">Checking...</span>
          <span class="status-user" id="statusUser"></span>
        </div>
        <button class="btn primary" id="kiteConnectBtn" onclick="connectKite()">🔌 Connect Kite</button>
        <div class="refresh-controls">
          <button class="btn" id="manualRefresh" onclick="refreshData()">🔄 Refresh</button>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 0.9rem;">
            <input type="checkbox" id="autoRefreshToggle" checked onchange="toggleAutoRefresh()">
            <span>Auto (3m)</span>
          </label>
          <div class="refresh-status" id="refreshStatus">Last: Just now</div>
        </div>
      </div>
    </div>

    <div id="errorContainer"></div>
    <div id="successContainer"></div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('NIFTY')">NIFTY</button>
      <button class="tab-btn" onclick="switchTab('BANKNIFTY')">BANKNIFTY</button>
      <button class="tab-btn" onclick="switchTab('SENSEX')">SENSEX</button>
      <button class="tab-btn" onclick="switchTab('HEATMAP')">🗺️ Heatmap</button>
      <button class="tab-btn" onclick="switchTab('COMMODITIES')">🛢️ Commodities</button>
      <button class="tab-btn" onclick="switchTab('SWING')">📊 Swing Tracker</button>
      <button class="tab-btn" onclick="switchTab('VIXCORR')">📉 VIX Correlation</button>
      <button class="tab-btn" onclick="switchTab('NEWS')">📰 News</button>
      <button class="tab-btn" onclick="switchTab('HOLIDAYS')">📅 Holidays</button>
    </div>

    <div id="NIFTY" class="tab-content active"></div>
    <div id="BANKNIFTY" class="tab-content"></div>
    <div id="SENSEX" class="tab-content"></div>
    <div id="HEATMAP" class="tab-content"></div>
    <div id="COMMODITIES" class="tab-content"></div>
    <div id="SWING" class="tab-content"></div>
    <div id="VIXCORR" class="tab-content"></div>
    <div id="NEWS" class="tab-content"></div>
    <div id="HOLIDAYS" class="tab-content"></div>

    <div class="timestamp" id="dataTimestamp"></div>
  </div>

  <script>
    let data = null;
    let lastRefreshTime = new Date();
    let autoRefreshInterval = null;
    let kiteConnected = false;
    let currentUser = null;
    let newsData = [];
    let holidaysData = [];

    // Restore recent chart points after minimize/reopen or page reload.
    function loadPcrHistory() {
      const empty = { NIFTY: [], BANKNIFTY: [], SENSEX: [] };
      try {
        const saved = JSON.parse(localStorage.getItem('optionpilot-pcr-history') || 'null');
        if (!saved) return empty;
        Object.keys(empty).forEach((symbol) => {
          empty[symbol] = Array.isArray(saved[symbol])
            ? saved[symbol]
                .filter((p) => Number.isFinite(p.spot) && Number.isFinite(p.pcr) && p.time)
                .slice(-200)
                .map((p) => ({ ...p, time: new Date(p.time) }))
            : [];
        });
      } catch (err) {
        console.warn('Could not restore PCR history:', err);
      }
      return empty;
    }

    const pcrHistory = loadPcrHistory();
    const lastSpot = { NIFTY: null, BANKNIFTY: null, SENSEX: null }; // for up/down tick arrow
    const pcrCharts = {}; // Chart.js instances keyed by symbol
    const MAX_PCR_POINTS = 200;

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function checkKiteStatus() {
      try {
        const response = await fetch('/api/kite/status');
        const result = await response.json();
        kiteConnected = result.connected;
        currentUser = result.user;
        updateStatusUI();
      } catch (err) {
        console.error('Status check failed:', err);
        kiteConnected = false;
        updateStatusUI();
      }
    }

    function updateStatusUI() {
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      const user = document.getElementById('statusUser');
      const btn = document.getElementById('kiteConnectBtn');
      
      if (kiteConnected && currentUser) {
        dot.classList.add('connected');
        text.textContent = 'Connected';
        user.textContent = '(' + currentUser.email + ')';
        btn.textContent = '✓ Kite Connected';
        btn.disabled = true;
      } else {
        dot.classList.remove('connected');
        text.textContent = 'Disconnected';
        user.textContent = '';
        btn.textContent = '🔌 Connect Kite';
        btn.disabled = false;
      }
    }

    function connectKite() {
      window.location.href = '/api/kite/login';
    }

    async function fetchData() {
      if (!kiteConnected) return;
      try {
        const response = await fetch('/api/data');
        const json = await response.json();
        
        if (!response.ok || json.error) {
          showError('Failed to fetch data: HTTP ' + response.status + '\\\\n' + (json.error || 'Unknown error'));
          return;
        }
        
        mergeServerHistory(json._history);
        data = {
          NIFTY: json.NIFTY,
          BANKNIFTY: json.BANKNIFTY,
          SENSEX: json.SENSEX,
        };
        updateUI();
        updateRefreshStatus();
        clearError();
      } catch (err) {
        showError('Error: ' + err.message);
      }
    }

    async function loadNews() {
      try {
        const response = await fetch('/api/news');
        newsData = await response.json();
        updateUI();
      } catch (err) {
        console.error('Failed to load news:', err);
      }
    }

    async function loadHolidays() {
      try {
        const response = await fetch('/api/holidays');
        holidaysData = await response.json();
        updateUI();
      } catch (err) {
        console.error('Failed to load holidays:', err);
      }
    }

    let heatmapData = null;
    async function loadHeatmap() {
      if (!kiteConnected) return;
      try {
        const response = await fetch('/api/sectors');
        const json = await response.json();
        if (!response.ok || json.error) {
          heatmapData = { error: json.error || 'Failed to load heatmap' };
        } else {
          heatmapData = json;
        }
        updateUI();
      } catch (err) {
        console.error('Failed to load heatmap:', err);
        heatmapData = { error: err.message };
      }
    }

    let commoditiesData = null;
    async function loadCommodities() {
      if (!kiteConnected) return;
      try {
        const response = await fetch('/api/commodities');
        const json = await response.json();
        if (!response.ok || json.error) {
          commoditiesData = { error: json.error || 'Failed to load commodities' };
        } else {
          commoditiesData = json;
        }
        updateUI();
      } catch (err) {
        console.error('Failed to load commodities:', err);
        commoditiesData = { error: err.message };
      }
    }

    let vixCorrData = null;
    let vixCorrChart = null;
    let vixCorrLoaded = false;
    let vixCorrLoading = false;
    async function loadVixCorrelation() {
      if (vixCorrLoading || vixCorrLoaded || !kiteConnected) return;
      vixCorrLoading = true;
      try {
        const response = await fetch('/api/vix-correlation');
        const json = await response.json();
        if (!response.ok || json.error) {
          vixCorrData = { error: json.error || 'Failed to load VIX correlation' };
        } else {
          vixCorrData = json;
        }
        vixCorrLoaded = true;
        updateUI();
      } catch (err) {
        console.error('Failed to load VIX correlation:', err);
        vixCorrData = { error: err.message };
        vixCorrLoaded = true;
      } finally {
        vixCorrLoading = false;
      }
    }

    function recordPcrPoint(symbol, indexData) {
      if (!indexData || indexData.error) return;
      if (indexData.current == null || indexData.pcr == null) return;
      const hist = pcrHistory[symbol];
      const last = hist[hist.length - 1];
      // Avoid piling up identical repeated points if auto-refresh fires with no new data
      if (last && last.spot === indexData.current && last.pcr === indexData.pcr) return;
      hist.push({
        time: new Date(indexData.timestamp || Date.now()),
        spot: indexData.current,
        pcr: indexData.pcr,
      });
      if (hist.length > MAX_PCR_POINTS) hist.shift();
      try {
        localStorage.setItem('optionpilot-pcr-history', JSON.stringify(pcrHistory));
      } catch (err) {
        console.warn('Could not save PCR history:', err);
      }
    }

    function mergeServerHistory(serverHistory) {
      if (!Array.isArray(serverHistory)) return;
      const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
      for (const snapshot of serverHistory) {
        const time = new Date(snapshot.timestamp);
        if (Number.isNaN(time.getTime())) continue;
        for (const symbol of symbols) {
          const point = snapshot[symbol];
          if (!point || !Number.isFinite(point.spot) || !Number.isFinite(point.pcr)) continue;
          const hist = pcrHistory[symbol];
          if (hist.some((existing) => existing.time.getTime() === time.getTime())) continue;
          hist.push({ time, spot: point.spot, pcr: point.pcr });
          hist.sort((a, b) => a.time - b.time);
          if (hist.length > MAX_PCR_POINTS) hist.splice(0, hist.length - MAX_PCR_POINTS);
        }
      }
      try {
        localStorage.setItem('optionpilot-pcr-history', JSON.stringify(pcrHistory));
      } catch (err) {
        console.warn('Could not save server PCR history:', err);
      }
    }

    // Find the intraday swing-low and swing-high points in a PCR history
    // array, and the % change from each of those points to the latest value.
    function computePcrSwing(hist) {
      if (!hist || hist.length === 0) return null;
      let lowIdx = 0;
      let highIdx = 0;
      for (let i = 1; i < hist.length; i++) {
        if (hist[i].pcr < hist[lowIdx].pcr) lowIdx = i;
        if (hist[i].pcr > hist[highIdx].pcr) highIdx = i;
      }
      const current = hist[hist.length - 1];
      const low = hist[lowIdx];
      const high = hist[highIdx];
      const fromLowPct = low.pcr !== 0 ? ((current.pcr - low.pcr) / low.pcr) * 100 : null;
      const fromHighPct = high.pcr !== 0 ? ((current.pcr - high.pcr) / high.pcr) * 100 : null;
      return { low, high, lowIdx, highIdx, current, fromLowPct, fromHighPct };
    }

    function drawPcrChart(symbol) {
      const canvas = document.getElementById('chart-' + symbol);
      if (!canvas || typeof Chart === 'undefined') return;

      const hist = pcrHistory[symbol];
      if (pcrCharts[symbol]) {
        pcrCharts[symbol].destroy();
        delete pcrCharts[symbol];
      }
      if (hist.length === 0) return;

      const labels = hist.map(p => p.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      const spotData = hist.map(p => p.spot);
      const pcrData = hist.map(p => p.pcr);

      const swing = computePcrSwing(hist);
      const pointRadius = hist.map((_, i) => (swing && (i === swing.lowIdx || i === swing.highIdx)) ? 6 : 0);
      const pointBackgroundColor = hist.map((_, i) => {
        if (!swing) return 'transparent';
        if (i === swing.lowIdx) return '#E5484D';
        if (i === swing.highIdx) return '#22B26B';
        return 'transparent';
      });

      pcrCharts[symbol] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Spot',
              data: spotData,
              borderColor: '#C9A227',
              backgroundColor: 'rgba(201,162,39,0.12)',
              yAxisID: 'ySpot',
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 2,
              fill: true,
            },
            {
              label: 'PCR (● low ● high)',
              data: pcrData,
              borderColor: '#5B8DEF',
              backgroundColor: 'transparent',
              yAxisID: 'yPcr',
              tension: 0.3,
              pointRadius: pointRadius,
              pointBackgroundColor: pointBackgroundColor,
              pointBorderColor: pointBackgroundColor,
              borderWidth: 1.5,
              borderDash: [4, 3],
            },
          ],
        },
        options: {
          responsive: true,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: { color: '#7C8AA5', font: { family: 'IBM Plex Mono', size: 10 } },
            },
          },
          scales: {
            x: {
              ticks: { color: '#4E5B78', font: { size: 9 }, maxTicksLimit: 8 },
              grid: { color: '#1E2B4A' },
            },
            ySpot: {
              position: 'left',
              ticks: { color: '#7C8AA5', font: { size: 9 } },
              grid: { color: '#1E2B4A' },
            },
            yPcr: {
              position: 'right',
              min: 0.4,
              max: 1.8,
              ticks: { color: '#7C8AA5', font: { size: 9 } },
              grid: { display: false },
            },
          },
        },
      });
    }

    function renderPcrSwingSummary(symbol) {
      const hist = pcrHistory[symbol];
      const swing = computePcrSwing(hist);
      if (!swing) return '';

      const lowTime = swing.low.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const highTime = swing.high.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const lowArrow = swing.fromLowPct != null && swing.fromLowPct >= 0 ? '▲' : '▼';
      const highArrow = swing.fromHighPct != null && swing.fromHighPct >= 0 ? '▲' : '▼';

      let html = '<div class="premium-card" style="margin-bottom:20px;">';
      html += '<div class="card-title">PCR Swing Low / Swing High Tracker (today)</div>';
      html += '<div class="card-row">';

      html += '<div class="card-item" style="flex-direction:column; align-items:flex-start; gap:4px; background: rgba(229,72,77,0.08); border: 1px solid var(--red); border-radius: 8px; padding: 8px 10px;">';
      html += '<span class="card-label">Swing Low (' + lowTime + ')</span>';
      html += '<span class="card-value" style="font-size:1rem;">' + swing.low.pcr.toFixed(3) + '</span>';
      html += '<span style="color: ' + (swing.fromLowPct != null && swing.fromLowPct >= 0 ? 'var(--green)' : 'var(--red)') + '; font-family: var(--font-mono); font-size:0.75rem;">' + lowArrow + ' ' + (swing.fromLowPct != null ? (swing.fromLowPct >= 0 ? '+' : '') + swing.fromLowPct.toFixed(1) + '% since low' : 'N/A') + '</span>';
      html += '</div>';

      html += '<div class="card-item" style="flex-direction:column; align-items:flex-start; gap:4px; background: rgba(34,178,107,0.08); border: 1px solid var(--green); border-radius: 8px; padding: 8px 10px;">';
      html += '<span class="card-label">Swing High (' + highTime + ')</span>';
      html += '<span class="card-value" style="font-size:1rem;">' + swing.high.pcr.toFixed(3) + '</span>';
      html += '<span style="color: ' + (swing.fromHighPct != null && swing.fromHighPct >= 0 ? 'var(--green)' : 'var(--red)') + '; font-family: var(--font-mono); font-size:0.75rem;">' + highArrow + ' ' + (swing.fromHighPct != null ? (swing.fromHighPct >= 0 ? '+' : '') + swing.fromHighPct.toFixed(1) + '% since high' : 'N/A') + '</span>';
      html += '</div>';

      html += '</div></div>';
      return html;
    }

    function renderGapScoreCard(indexData) {
      const gs = indexData && indexData.gapScore;
      if (!gs) return '';

      const verdictColor = gs.verdict === 'Continuation' ? 'var(--green)' : gs.verdict === 'Fade Risk' ? 'var(--red)' : 'var(--muted)';
      const barPct = Math.max(0, Math.min(100, (gs.score + 100) / 2));
      const trendArrow = gs.trend === 'Strengthening' ? '▲' : gs.trend === 'Weakening' ? '▼' : '●';
      const trendColor = gs.trend === 'Strengthening' ? 'var(--green)' : gs.trend === 'Weakening' ? 'var(--red)' : 'var(--muted)';

      function chip(label, val) {
        const color = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : 'var(--muted)';
        const arrow = val > 0 ? '▲' : val < 0 ? '▼' : '●';
        return '<div class="gap-score-chip"><div style="color:var(--muted-dim); margin-bottom:3px;">' + label + '</div><div style="color:' + color + '; font-weight:700;">' + arrow + '</div></div>';
      }

      let html = '<div class="gap-score-card">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">';
      html += '<div class="card-title" style="margin-bottom:0;">Gap Confirmation Score</div>';
      html += '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + verdictColor + ';">' + gs.verdict + '</span>';
      html += '</div>';

      html += '<div class="gap-score-bar-track"><div class="gap-score-bar-fill" style="width:' + barPct + '%; background:' + verdictColor + ';"></div></div>';

      html += '<div style="display:flex; justify-content:space-between; font-family: var(--font-mono); font-size:0.8rem; color: var(--muted);">';
      html += '<span>Score: <span style="color:' + verdictColor + '; font-weight:700;">' + gs.score + '</span></span>';
      html += '<span>Trend: <span style="color:' + trendColor + '; font-weight:700;">' + trendArrow + ' ' + gs.trend + '</span></span>';
      html += '<span>Full-chain PCR: <span style="color: var(--text); font-weight:700;">' + (gs.fullChainPcr != null ? gs.fullChainPcr.toFixed(3) : 'N/A') + '</span></span>';
      html += '</div>';

      html += '<div class="gap-score-components">';
      html += chip('Gap Dir.', gs.components.gapDirection);
      html += chip('VWAP', gs.components.vwapPosition);
      html += chip('PDH/PDL', gs.components.pdhPdlStatus);
      html += chip('OI Tilt', gs.components.oiTilt);
      html += chip('Breadth', gs.components.sectorBreadth);
      html += '</div>';
      html += '</div>';
      return html;
    }

    // "Bias Check Before Entry": combines three independent signals —
    // Gap Confirmation Score, PDH/PDL Signal, and Futures Alignment — and
    // requires at least 2 of 3 to agree before calling a bias confirmed.
    function renderBiasCheckWidget(indexData) {
      if (!indexData) return '';

      const signals = [];

      // Signal 1: Gap Confirmation Score
      const gs = indexData.gapScore;
      if (gs) {
        const dir = gs.score > 10 ? 'bullish' : gs.score < -10 ? 'bearish' : 'neutral';
        signals.push({ name: 'Gap Score', dir, detail: gs.verdict });
      } else {
        signals.push({ name: 'Gap Score', dir: 'neutral', detail: 'N/A' });
      }

      // Signal 2: PDH/PDL Signal (BUY/SELL/WAIT)
      const pdhDir = indexData.signal === 'BUY' ? 'bullish' : indexData.signal === 'SELL' ? 'bearish' : 'neutral';
      signals.push({ name: 'PDH/PDL', dir: pdhDir, detail: indexData.signal });

      // Signal 3: Futures Alignment — NIFTY vs BANKNIFTY agreement for those two,
      // or this index's own futures VWAP bias as a proxy for SENSEX/others.
      let alignDir = 'neutral';
      let alignDetail = 'N/A';
      if ((indexData.symbol === 'NIFTY' || indexData.symbol === 'BANKNIFTY') && data && data.NIFTY && data.BANKNIFTY) {
        const n = data.NIFTY.futuresVwapBias;
        const b = data.BANKNIFTY.futuresVwapBias;
        if (n && b && n !== 'UNKNOWN' && b !== 'UNKNOWN' && n === b) {
          alignDir = n === 'UP' ? 'bullish' : 'bearish';
          alignDetail = 'Aligned';
        } else if (n && b && n !== 'UNKNOWN' && b !== 'UNKNOWN') {
          alignDetail = 'Diverging';
        }
      } else if (indexData.futuresVwapBias && indexData.futuresVwapBias !== 'UNKNOWN') {
        alignDir = indexData.futuresVwapBias === 'UP' ? 'bullish' : 'bearish';
        alignDetail = 'Futures ' + indexData.futuresVwapBias;
      }
      signals.push({ name: 'Alignment', dir: alignDir, detail: alignDetail });

      const bullishCount = signals.filter((s) => s.dir === 'bullish').length;
      const bearishCount = signals.filter((s) => s.dir === 'bearish').length;

      let verdictLabel, verdictColor, borderColor;
      if (bullishCount >= 2) {
        verdictLabel = '✓ Entry Bias Confirmed: BULLISH (' + bullishCount + '/3)';
        verdictColor = 'var(--green)';
        borderColor = 'var(--green)';
      } else if (bearishCount >= 2) {
        verdictLabel = '✓ Entry Bias Confirmed: BEARISH (' + bearishCount + '/3)';
        verdictColor = 'var(--red)';
        borderColor = 'var(--red)';
      } else {
        verdictLabel = '⏳ WAIT — Signals Not Aligned (best ' + Math.max(bullishCount, bearishCount) + '/3)';
        verdictColor = 'var(--muted)';
        borderColor = 'var(--border)';
      }

      let html = '<div class="bias-check-card" style="background: var(--panel); border-color:' + borderColor + ';">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">';
      html += '<div class="card-title" style="margin-bottom:0;">Bias Check Before Entry</div>';
      html += '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + verdictColor + ';">' + verdictLabel + '</span>';
      html += '</div>';

      html += '<div class="bias-check-signals">';
      for (const s of signals) {
        const color = s.dir === 'bullish' ? 'var(--green)' : s.dir === 'bearish' ? 'var(--red)' : 'var(--muted)';
        const arrow = s.dir === 'bullish' ? '▲' : s.dir === 'bearish' ? '▼' : '●';
        html += '<div class="bias-check-signal"><div style="color:var(--muted-dim); margin-bottom:3px;">' + s.name + '</div><div style="color:' + color + '; font-weight:700;">' + arrow + ' ' + escapeHtml(s.detail) + '</div></div>';
      }
      html += '</div>';

      html += '<div class="timestamp" style="margin-top:8px;">Needs 2 of 3 signals to agree before treating a directional entry as confirmed — not investment advice.</div>';
      html += '</div>';
      return html;
    }

    function renderAlignmentBadge() {
      if (!data || !data.NIFTY || !data.BANKNIFTY) return '';
      const n = data.NIFTY.futuresVwapBias;
      const b = data.BANKNIFTY.futuresVwapBias;
      if (!n || !b || n === 'UNKNOWN' || b === 'UNKNOWN') {
        return '<div style="margin-bottom:16px;"><span class="badge-pill" style="background: rgba(124,138,165,0.14); color: var(--muted);">⏳ Alignment: Waiting for VWAP data</span></div>';
      }
      if (n === b) {
        const bull = n === 'UP';
        return '<div style="margin-bottom:16px;"><span class="badge-pill" style="background: ' + (bull ? 'rgba(34,178,107,0.14)' : 'rgba(229,72,77,0.14)') + '; color: ' + (bull ? 'var(--green)' : 'var(--red)') + ';">' + (bull ? '✓ Aligned Bullish' : '✓ Aligned Bearish') + ' — NIFTY &amp; BANKNIFTY futures agree</span></div>';
      }
      return '<div style="margin-bottom:16px;"><span class="badge-pill" style="background: rgba(201,162,39,0.14); color: var(--gold);">⚠ Diverging — Caution (NIFTY ' + n + ' / BANKNIFTY ' + b + ')</span></div>';
    }

    function updateUI() {
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach(symbol => {
        const tabContent = document.getElementById(symbol);
        if (data && data[symbol]) {
          recordPcrPoint(symbol, data[symbol]);
          tabContent.innerHTML = renderTabContent(data[symbol]);
          drawPcrChart(symbol);
        }
      });

      document.getElementById('NEWS').innerHTML = renderNews();
      document.getElementById('HOLIDAYS').innerHTML = renderHolidays();
      document.getElementById('HEATMAP').innerHTML = renderHeatmap();
      document.getElementById('COMMODITIES').innerHTML = renderCommodities();
      document.getElementById('SWING').innerHTML = renderSwingTracker();
      document.getElementById('VIXCORR').innerHTML = renderVixCorrelation();
      drawVixCorrChart();

      const firstIndex = Object.values(data || {})[0];
      if (firstIndex && firstIndex.timestamp) {
        const date = new Date(firstIndex.timestamp);
        document.getElementById('dataTimestamp').textContent = 
          'Data as of: ' + date.toLocaleString();
      }
    }

    function renderTabContent(indexData) {
      if (!indexData) return '<div class="loading">Loading...</div>';

      if (indexData.error) {
        return '<div class="error">⚠️ Error: ' + escapeHtml(indexData.error) + '</div>';
      }

      // Tick direction since the last refresh, for the blinking arrow
      const prevSpot = lastSpot[indexData.symbol];
      let tickClass = 'flat';
      let tickArrow = '●';
      if (indexData.current != null && prevSpot != null) {
        if (indexData.current > prevSpot) { tickClass = 'up'; tickArrow = '▲'; }
        else if (indexData.current < prevSpot) { tickClass = 'down'; tickArrow = '▼'; }
      }
      if (indexData.current != null) lastSpot[indexData.symbol] = indexData.current;
      // Unique key so the browser treats each tick as a fresh element and replays the blink animation
      const tickKey = indexData.symbol + '-' + Date.now();

      let html = '<div style="margin-bottom:12px;">' + renderSignalBadge(indexData.signal) + '</div>';

      if (indexData.symbol === 'NIFTY' || indexData.symbol === 'BANKNIFTY') {
        html += renderAlignmentBadge();
      }

      html += renderGapScoreCard(indexData);

      html += renderBiasCheckWidget(indexData);

      html += '<div class="metrics-grid">';
      html += '<div class="metric-card"><div class="metric-label">Current Price</div>';
      html += '<div class="metric-value">' + (indexData.current ? indexData.current.toFixed(2) : 'N/A') +
        '<span class="tick-arrow ' + tickClass + '" key="' + tickKey + '">' + tickArrow + '</span></div>';
      html += '<div class="metric-change ' + (indexData.change >= 0 ? 'positive' : 'negative') + '">';
      html += indexData.current ? (indexData.change >= 0 ? '+' : '') + indexData.change.toFixed(2) + ' (' + (indexData.changePercent >= 0 ? '+' : '') + indexData.changePercent.toFixed(2) + '%)' : 'N/A';
      html += '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">India VIX</div>';
      const vixDirection = indexData.vixChange > 0 ? 'up' : indexData.vixChange < 0 ? 'down' : 'flat';
      const vixArrow = vixDirection === 'up' ? '▲' : vixDirection === 'down' ? '▼' : '●';
      html += '<div class="metric-value">' + (indexData.vix ? indexData.vix.toFixed(2) : 'N/A') +
        '<span class="direction ' + vixDirection + (vixDirection !== 'flat' ? ' active' : '') + '">' + vixArrow + '</span></div>';
      html += '<div class="metric-change ' + (indexData.vixChange >= 0 ? 'positive' : 'negative') + '">' +
        (indexData.vix ? (indexData.vixChange >= 0 ? '+' : '') + indexData.vixChange.toFixed(2) +
        ' (' + (indexData.vixChangePercent >= 0 ? '+' : '') + indexData.vixChangePercent.toFixed(2) + '%)' : 'N/A') +
        '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">Futures VWAP</div>';
      html += '<div class="metric-value">' + (indexData.vwap ? indexData.vwap.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">' + (indexData.vwapSource || 'Unavailable') + '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">ATM Strike</div>';
      html += '<div class="metric-value">' + (indexData.atmStrike ? indexData.atmStrike.toFixed(0) : 'N/A') + '</div>';
      html += '<div class="metric-change">At The Money</div></div>';

      html += '<div class="metric-card"><div class="metric-label">PDH / PDL</div>';
      html += '<div class="metric-value">' + (indexData.pdh ? indexData.pdh.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">' + (indexData.pdl ? 'L: ' + indexData.pdl.toFixed(2) : 'N/A') + '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">Max Pain</div>';
      html += '<div class="metric-value">' + (indexData.maxPain ? indexData.maxPain.toFixed(0) : 'N/A') + '</div>';
      html += '<div class="metric-change">Strike Level</div></div>';

      html += '<div class="metric-card"><div class="metric-label">PCR (Band)</div>';
      const pcrHist = pcrHistory[indexData.symbol] || [];
      const currentPcrPoint = pcrHist[pcrHist.length - 1];
      const previousPcrPoint = pcrHist[pcrHist.length - 2];
      const pcrDirection = currentPcrPoint && previousPcrPoint
        ? currentPcrPoint.pcr > previousPcrPoint.pcr ? 'up'
          : currentPcrPoint.pcr < previousPcrPoint.pcr ? 'down' : 'flat'
        : 'flat';
      const pcrArrow = pcrDirection === 'up' ? '▲' : pcrDirection === 'down' ? '▼' : '●';
      html += '<div class="metric-value">' + (indexData.pcr != null ? indexData.pcr.toFixed(3) : 'N/A') +
        '<span class="direction ' + pcrDirection + (pcrDirection !== 'flat' ? ' active' : '') + '">' + pcrArrow + '</span></div>';
      html += '<div class="metric-change">' + (indexData.pcr != null ? (indexData.pcr > 1.1 ? 'Bullish tilt' : indexData.pcr < 0.85 ? 'Bearish tilt' : 'Neutral') : 'ATM ±7 strikes') + '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">Volume PCR</div>';
      html += '<div class="metric-value">' + (indexData.volumePcr != null ? indexData.volumePcr.toFixed(3) : 'N/A') + '</div>';
      html += '<div class="metric-change">Put volume / Call volume</div></div>';
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom: 20px;">';
      html += '<div class="card-title">Spot vs PCR — Intraday (this session)</div>';
      html += '<canvas id="chart-' + indexData.symbol + '" height="130"></canvas>';
      html += '</div>';

      html += renderPcrSwingSummary(indexData.symbol);

      if (indexData.expiries && indexData.expiries.length > 0) {
        for (let i = 0; i < indexData.expiries.length; i++) {
          const exp = indexData.expiries[i];
          html += '<div class="expiry-section">';
          html += '<div class="expiry-title">' + exp.expiry + ' Expiry — ATM ±2 Strikes</div>';
          html += '<div class="card-row">';
          html += renderStrikeBand('📈 Call (CE)', exp.ceStrikes, exp.ceError, indexData.symbol + '_' + exp.expiry + '_CE');
          html += renderStrikeBand('📉 Put (PE)', exp.peStrikes, exp.peError, indexData.symbol + '_' + exp.expiry + '_PE');
          html += '</div></div>';
        }
      }

      return html;
    }

    // Tracks the last-seen OI per strike (keyed by a stable composite key) so
    // the OI column can show an up/down arrow versus the previous refresh.
    const lastOi = {};

    function oiArrowInfo(key, currentOi) {
      const prev = lastOi[key];
      lastOi[key] = currentOi;
      if (prev == null || currentOi === prev) return { arrow: '●', cls: 'flat' };
      return currentOi > prev ? { arrow: '▲', cls: 'up' } : { arrow: '▼', cls: 'down' };
    }

    // Tracks the last-seen LTP per strike (same key scheme as lastOi) so we
    // can classify OI buildup type (needs both price direction and OI direction).
    const lastStrikePrice = {};

    function priceDirection(key, currentPrice) {
      const prev = lastStrikePrice[key];
      lastStrikePrice[key] = currentPrice;
      if (prev == null || currentPrice === prev) return 'flat';
      return currentPrice > prev ? 'up' : 'down';
    }

    // Classic OI-buildup classification, used to generate a per-strike
    // BUY/SELL/WAIT verdict: Long Buildup (price up + OI up) = fresh buying,
    // Short Buildup (price down + OI up) = fresh selling, OI down in either
    // direction = covering/unwinding = weak/no-buildup signal.
    function classifyBuildup(priceDir, oiDir) {
      if (priceDir === 'up' && oiDir === 'up') {
        return { label: 'Long Buildup', verdict: 'BUY', color: 'var(--green)' };
      }
      if (priceDir === 'down' && oiDir === 'up') {
        return { label: 'Short Buildup', verdict: 'SELL', color: 'var(--red)' };
      }
      if (oiDir === 'down' && priceDir === 'up') {
        return { label: 'Short Covering', verdict: 'WAIT', color: 'var(--muted)' };
      }
      if (oiDir === 'down' && priceDir === 'down') {
        return { label: 'Long Unwinding', verdict: 'WAIT', color: 'var(--muted)' };
      }
      return { label: 'No Data Yet', verdict: 'WAIT', color: 'var(--muted-dim)' };
    }

    function renderStrikeBand(title, strikes, errorMsg, keyPrefix) {
      let html = '<div class="premium-card">';
      html += '<div class="card-title">' + title + '</div>';

      if (!strikes || strikes.length === 0) {
        html += '<div class="card-grid"><div class="card-item"><span class="card-value unavailable">' + escapeHtml(errorMsg || 'N/A') + '</span></div></div>';
        html += '</div>';
        return html;
      }

      html += '<div class="table-scroll"><table style="width:100%; min-width:700px; font-family: var(--font-mono); font-size: 0.7rem; border-collapse: collapse;">';
      html += '<thead><tr style="color: var(--muted-dim);">' +
        '<th style="text-align:left; padding: 3px 2px;">Strike</th>' +
        '<th style="text-align:right; padding: 3px 2px;">LTP</th>' +
        '<th style="text-align:right; padding: 3px 2px;">OI</th>' +
        '<th style="text-align:right; padding: 3px 2px;">Day H</th>' +
        '<th style="text-align:right; padding: 3px 2px;">Day L</th>' +
        '<th style="text-align:right; padding: 3px 2px;">PDH</th>' +
        '<th style="text-align:right; padding: 3px 2px;">PDL</th>' +
        '<th style="text-align:center; padding: 3px 2px;">Signal</th>' +
        '</tr></thead><tbody>';

      for (const s of strikes) {
        const rowStyle = s.isAtm ? 'background: rgba(201,162,39,0.08); border-top: 1px solid var(--gold-soft); border-bottom: 1px solid var(--gold-soft);' : 'border-top: 1px solid var(--border);';
        const strikeKey = (keyPrefix || '') + '_' + s.strike;
        const oiInfo = oiArrowInfo(strikeKey, s.oi);
        const oiColor = oiInfo.cls === 'up' ? 'var(--green)' : oiInfo.cls === 'down' ? 'var(--red)' : 'var(--muted)';
        const priceDir = priceDirection(strikeKey + '_price', s.lastPrice);
        const buildup = classifyBuildup(priceDir, oiInfo.cls);
        const atPdh = s.pdh ? s.lastPrice >= s.pdh * 0.98 : false;
        const atPdl = s.pdl ? s.lastPrice <= s.pdl * 1.02 : false;
        html += '<tr style="' + rowStyle + '">';
        html += '<td style="padding: 4px 2px; color: ' + (s.isAtm ? 'var(--gold)' : 'var(--text)') + '; font-weight: ' + (s.isAtm ? '700' : '500') + ';">' + s.strike + (s.isAtm ? ' (ATM)' : '') + '</td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: var(--text);"><span class="flash">' + s.lastPrice.toFixed(2) + '</span></td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + oiColor + ';"><span class="flash">' + (s.oi != null ? s.oi.toLocaleString('en-IN') : '—') + ' <span style="font-weight:700;">' + oiInfo.arrow + '</span></span></td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + (s.atDayHigh ? 'var(--red)' : 'var(--muted)') + '; font-weight: ' + (s.atDayHigh ? '700' : '400') + ';"><span class="flash">' + (s.dayHigh ? s.dayHigh.toFixed(2) : '—') + (s.atDayHigh ? ' ⚠' : '') + '</span></td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + (s.atDayLow ? 'var(--green)' : 'var(--muted)') + '; font-weight: ' + (s.atDayLow ? '700' : '400') + ';"><span class="flash">' + (s.dayLow ? s.dayLow.toFixed(2) : '—') + (s.atDayLow ? ' ⚠' : '') + '</span></td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + (atPdh ? 'var(--red)' : 'var(--muted-dim)') + '; font-weight: ' + (atPdh ? '700' : '400') + ';">' + (s.pdh ? s.pdh.toFixed(2) : '—') + (atPdh ? ' ⚠' : '') + '</td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + (atPdl ? 'var(--green)' : 'var(--muted-dim)') + '; font-weight: ' + (atPdl ? '700' : '400') + ';">' + (s.pdl ? s.pdl.toFixed(2) : '—') + (atPdl ? ' ⚠' : '') + '</td>';
        html += '<td style="padding: 4px 2px; text-align:center;"><div style="color:' + buildup.color + '; font-weight:700;">' + buildup.verdict + '</div><div style="color:var(--muted-dim); font-size:0.62rem;">' + buildup.label + (atPdh ? ' · at PDH' : '') + (atPdl ? ' · at PDL' : '') + '</div></td>';
        html += '</tr>';
      }

      html += '</tbody></table></div>';

      const resistanceStrikes = strikes.filter(s => s.atDayHigh).map(s => s.strike);
      const supportStrikes = strikes.filter(s => s.atDayLow).map(s => s.strike);
      const pdhStrikes = strikes.filter(s => s.pdh && s.lastPrice >= s.pdh * 0.98).map(s => s.strike);
      const pdlStrikes = strikes.filter(s => s.pdl && s.lastPrice <= s.pdl * 1.02).map(s => s.strike);
      html += '<div style="margin-top:8px; font-size:0.7rem; font-family: var(--font-mono);">';
      html += '<div style="color: ' + (resistanceStrikes.length ? 'var(--red)' : 'var(--muted-dim)') + ';">Near current Day High: ' + (resistanceStrikes.length ? resistanceStrikes.join(', ') : 'none') + '</div>';
      html += '<div style="color: ' + (supportStrikes.length ? 'var(--green)' : 'var(--muted-dim)') + ';">Near current Day Low: ' + (supportStrikes.length ? supportStrikes.join(', ') : 'none') + '</div>';
      html += '<div style="color: ' + (pdhStrikes.length ? 'var(--red)' : 'var(--muted-dim)') + ';">Near Previous Day High: ' + (pdhStrikes.length ? pdhStrikes.join(', ') : 'none') + '</div>';
      html += '<div style="color: ' + (pdlStrikes.length ? 'var(--green)' : 'var(--muted-dim)') + ';">Near Previous Day Low: ' + (pdlStrikes.length ? pdlStrikes.join(', ') : 'none') + '</div>';
      html += '</div>';

      html += '</div>';
      return html;
    }

    function renderNews() {
      if (newsData.length === 0) {
        return '<div class="loading">Live news is not configured. No demo or fabricated headlines are shown.</div>';
      }

      let html = '<div class="news-list">';
      for (const item of newsData) {
        const time = new Date(item.published).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += '<div class="news-item">';
        html += '<div class="news-title">' + escapeHtml(item.title) + '</div>';
        html += '<div class="news-meta">';
        html += '<span class="news-source">' + escapeHtml(item.source) + '</span>';
        html += '<span class="news-time">' + time + '</span>';
        html += '</div>';
        const safeUrl = /^https:\\/\\//i.test(item.url || '') ? item.url : '#';
        html += '<a href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer" class="news-link">Read →</a>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderHolidays() {
      if (holidaysData.length === 0) {
        return '<div class="loading">Exchange holiday calendar is not configured. Please verify holidays on the official NSE/BSE website.</div>';
      }

      let html = '<div class="holidays-list">';
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < holidaysData.length; i++) {
        const holiday = holidaysData[i];
        const holidayDate = new Date(holiday.date + 'T00:00:00');
        const isNext = i === 0;
        const daysUntil = Math.ceil((holidayDate - today) / (1000 * 60 * 60 * 24));

        html += '<div class="holiday-item ' + (isNext ? 'next-holiday' : '') + '">';
        html += '<div class="holiday-date">' + holidayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</div>';
        html += '<div class="holiday-name">' + escapeHtml(holiday.name) + '</div>';
        if (isNext) {
          html += '<div class="holiday-badge">Next Holiday</div>';
          html += '<div class="holiday-countdown">in ' + daysUntil + ' days</div>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function heatColor(pct) {
      if (pct == null) return { bg: 'rgba(124,138,165,0.08)', border: 'var(--border)', text: 'var(--muted)' };
      if (pct <= -0.5) return { bg: 'rgba(178,32,32,0.35)', border: '#B22020', text: '#ffb4b4' }; // dark red
      if (pct >= 0.5) return { bg: 'rgba(20,110,60,0.35)', border: '#146E3C', text: '#8fe8b4' }; // dark green
      return { bg: 'rgba(124,138,165,0.10)', border: 'var(--border)', text: 'var(--muted)' };
    }

    function renderHeatmap() {
      if (!heatmapData) {
        return '<div class="loading">Loading sector heatmap...</div>';
      }
      if (heatmapData.error) {
        return '<div class="error">⚠️ ' + escapeHtml(heatmapData.error) + '</div>';
      }

      function renderCell(item) {
        const c = heatColor(item.change);
        const pctText = item.change != null ? (item.change >= 0 ? '+' : '') + item.change.toFixed(2) + '%' : 'N/A';
        return '<div style="background:' + c.bg + '; border:1px solid ' + c.border + '; border-radius: 10px; padding: 12px; display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:0.85rem; color: var(--text); font-weight:500;">' + escapeHtml(item.name) + '</span>' +
          '<span class="flash" style="font-family: var(--font-mono); font-weight:700; color:' + c.text + ';">' + pctText + '</span>' +
          '</div>';
      }

      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div class="card-title">Sector Heatmap</div>';
      html += '<div style="display:flex; flex-direction:column; gap:8px;">';
      html += heatmapData.sectors.map(renderCell).join('');
      html += '</div></div>';

      html += '<div class="premium-card">';
      html += '<div class="card-title">Key Stocks</div>';
      html += '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap:8px;">';
      html += heatmapData.stocks.map(renderCell).join('');
      html += '</div></div>';

      html += '<div class="timestamp">Color: ≤ -0.5% dark red · ≥ +0.5% dark green · updates with auto-refresh</div>';
      return html;
    }

    function renderSignalBadge(signal) {
      const map = {
        SELL: { bg: 'rgba(229,72,77,0.14)', color: 'var(--red)', label: 'BEARISH — Below PDL confirmation' },
        BUY: { bg: 'rgba(34,178,107,0.14)', color: 'var(--green)', label: 'BULLISH — Above PDH confirmation' },
        WAIT: { bg: 'rgba(124,138,165,0.14)', color: 'var(--muted)', label: 'WAIT — No confirmed break' },
      };
      const s = map[signal] || map.WAIT;
      return '<span style="background:' + s.bg + '; color:' + s.color + '; padding: 6px 14px; border-radius: 20px; font-weight:700; font-family: var(--font-display); font-size: 0.85rem;">' + s.label + '</span>';
    }

    function renderCommodityBlock(label, cData) {
      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
      html += '<div class="card-title" style="margin-bottom:0;">' + escapeHtml(label) + (cData.futuresSymbol ? ' (' + escapeHtml(cData.futuresSymbol) + ')' : '') + '</div>';
      if (!cData.error) html += renderSignalBadge(cData.signal);
      html += '</div>';

      if (cData.error) {
        html += '<div class="card-grid"><div class="card-item"><span class="card-value unavailable">' + escapeHtml(cData.error) + '</span></div></div>';
        html += '</div>';
        return html;
      }

      html += '<div class="metrics-grid" style="margin-bottom:16px;">';
      html += '<div class="metric-card"><div class="metric-label">Current Price</div>';
      html += '<div class="metric-value">' + cData.current.toFixed(2) + '</div>';
      html += '<div class="metric-change ' + (cData.change >= 0 ? 'positive' : 'negative') + '">' + (cData.change >= 0 ? '+' : '') + cData.change.toFixed(2) + ' (' + (cData.changePercent >= 0 ? '+' : '') + cData.changePercent.toFixed(2) + '%)</div></div>';
      html += '<div class="metric-card"><div class="metric-label">PDH</div><div class="metric-value">' + (cData.pdh ? cData.pdh.toFixed(2) : 'N/A') + '</div><div class="metric-change">Previous Day High</div></div>';
      html += '<div class="metric-card"><div class="metric-label">PDL</div><div class="metric-value">' + (cData.pdl ? cData.pdl.toFixed(2) : 'N/A') + '</div><div class="metric-change">Previous Day Low</div></div>';
      html += '<div class="metric-card"><div class="metric-label">ATM Strike</div><div class="metric-value">' + cData.atmStrike.toFixed(0) + '</div><div class="metric-change">At The Money</div></div>';
      html += '</div>';

      html += '<div class="card-row">';
      html += renderStrikeBand('📈 Call (CE)', cData.ceStrikes, 'No CE data', cData.symbol + '_CE');
      html += renderStrikeBand('📉 Put (PE)', cData.peStrikes, 'No PE data', cData.symbol + '_PE');
      html += '</div>';

      html += '</div>';
      return html;
    }

    function renderCommodities() {
      if (!commoditiesData) {
        return '<div class="loading">Loading commodities...</div>';
      }
      if (commoditiesData.error) {
        return '<div class="error">⚠️ ' + escapeHtml(commoditiesData.error) + '</div>';
      }

      let html = '<div class="expiry-title">Crude Oil &amp; Natural Gas — ATM ±5 Strikes (MCX)</div>';
      html += renderCommodityBlock('🛢️ Crude Oil', commoditiesData.CRUDEOIL);
      html += renderCommodityBlock('🔥 Natural Gas', commoditiesData.NATURALGAS);
      return html;
    }

    function renderSwingTracker() {
      if (!data) {
        return '<div class="loading">Loading swing tracker...</div>';
      }

      let html = renderAlignmentBadge();

      const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
      const watchExpiries = ['Next Expiry', 'Next of Next Expiry', 'Monthly'];
      const rows = [];

      symbols.forEach((symbol) => {
        const idxData = data[symbol];
        if (!idxData || idxData.error || !idxData.expiries) return;

        watchExpiries.forEach((expiryName) => {
          const exp = idxData.expiries.find((e) => e.expiry === expiryName);
          if (!exp) return;

          ['ceStrikes', 'peStrikes'].forEach((key) => {
            const optType = key === 'ceStrikes' ? 'CE' : 'PE';
            const strikes = exp[key] || [];
            const atm = strikes.find((s) => s.isAtm);
            if (!atm || !atm.lastPrice) return;

            const upFromLowPct = atm.dayLow ? ((atm.lastPrice - atm.dayLow) / atm.dayLow) * 100 : null;
            const vsPdcPct = atm.pdc ? ((atm.lastPrice - atm.pdc) / atm.pdc) * 100 : null;
            const bullishContinuation = atm.pdc > 0 && atm.lastPrice > atm.pdc && upFromLowPct != null && upFromLowPct > 1;

            rows.push({
              symbol, expiryName, optType,
              strike: atm.strike,
              lastPrice: atm.lastPrice,
              oi: atm.oi,
              dayLow: atm.dayLow,
              pdh: atm.pdh,
              pdl: atm.pdl,
              pdc: atm.pdc,
              upFromLowPct, vsPdcPct,
              bullishContinuation,
            });
          });
        });
      });

      if (rows.length === 0) {
        return html + '<div class="loading">No swing data yet — waiting for expiries to load.</div>';
      }

      html += '<div class="premium-card">';
      html += '<div class="card-title">Swing Tracker — ATM Premiums Continuously Closing Up From Day Low, Above PDC</div>';
      html += '<div class="table-scroll"><table style="width:100%; min-width:1180px; font-family: var(--font-mono); font-size: 0.72rem; border-collapse: collapse;">';
      html += '<thead><tr style="color: var(--muted-dim);">' +
        '<th style="text-align:left; padding: 4px 3px;">Symbol</th>' +
        '<th style="text-align:left; padding: 4px 3px;">Expiry</th>' +
        '<th style="text-align:left; padding: 4px 3px;">Type</th>' +
        '<th style="text-align:right; padding: 4px 3px;">Strike</th>' +
        '<th style="text-align:right; padding: 4px 3px;">LTP</th>' +
        '<th style="text-align:right; padding: 4px 3px;">OI</th>' +
        '<th style="text-align:right; padding: 4px 3px;">Day L</th>' +
        '<th style="text-align:right; padding: 4px 3px;">PDL</th>' +
        '<th style="text-align:right; padding: 4px 3px;">PDH</th>' +
        '<th style="text-align:right; padding: 4px 3px;">%Up/DayL</th>' +
        '<th style="text-align:right; padding: 4px 3px;">PDC</th>' +
        '<th style="text-align:right; padding: 4px 3px;">%vs PDC</th>' +
        '<th style="text-align:center; padding: 4px 3px;">Signal</th>' +
        '</tr></thead><tbody>';

      rows.forEach((r) => {
        const rowStyle = r.bullishContinuation ? 'background: rgba(34,178,107,0.10); border-top: 1px solid var(--green);' : 'border-top: 1px solid var(--border);';
        // Uses its own key (suffixed _swing) rather than sharing renderStrikeBand's
        // key — otherwise this would always read "flat" since the strike-band
        // table for the same expiry/strike already updates lastOi first in the
        // same render cycle.
        const oiKey = r.symbol + '_' + r.expiryName + '_' + r.optType + '_' + r.strike + '_swing';
        const oiInfo = oiArrowInfo(oiKey, r.oi);
        const oiColor = oiInfo.cls === 'up' ? 'var(--green)' : oiInfo.cls === 'down' ? 'var(--red)' : 'var(--muted)';
        const priceDir = priceDirection(oiKey + '_price', r.lastPrice);
        const buildup = classifyBuildup(priceDir, oiInfo.cls);
        html += '<tr style="' + rowStyle + '">';
        html += '<td style="padding: 4px 3px; color: var(--gold); font-weight:600;">' + r.symbol + '</td>';
        html += '<td style="padding: 4px 3px; color: var(--muted);">' + r.expiryName + '</td>';
        html += '<td style="padding: 4px 3px; color: var(--text);">' + r.optType + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--text);">' + r.strike + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--text); font-weight:600;"><span class="flash">' + r.lastPrice.toFixed(2) + '</span></td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: ' + oiColor + ';"><span class="flash">' + (r.oi != null ? r.oi.toLocaleString('en-IN') : '—') + ' <span style="font-weight:700;">' + oiInfo.arrow + '</span></span></td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--muted);">' + (r.dayLow ? r.dayLow.toFixed(2) : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--muted-dim);">' + (r.pdl ? r.pdl.toFixed(2) : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--muted-dim);">' + (r.pdh ? r.pdh.toFixed(2) : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: ' + (r.upFromLowPct != null && r.upFromLowPct > 0 ? 'var(--green)' : 'var(--muted)') + ';">' + (r.upFromLowPct != null ? (r.upFromLowPct >= 0 ? '+' : '') + r.upFromLowPct.toFixed(2) + '%' : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: var(--muted);">' + (r.pdc ? r.pdc.toFixed(2) : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:right; color: ' + (r.vsPdcPct != null && r.vsPdcPct > 0 ? 'var(--green)' : 'var(--red)') + ';">' + (r.vsPdcPct != null ? (r.vsPdcPct >= 0 ? '+' : '') + r.vsPdcPct.toFixed(2) + '%' : '—') + '</td>';
        html += '<td style="padding: 4px 3px; text-align:center;"><div style="color:' + buildup.color + '; font-weight:700;">' + buildup.verdict + '</div><div style="color:var(--muted-dim); font-size:0.62rem;">' + buildup.label + (r.bullishContinuation ? ' · ▲SWING' : '') + '</div></td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      html += '<div class="timestamp">SWING = LTP above both PDC (prev. close) and &gt;1% up from Day Low. "Day L" is the intraday low for today; "PDL"/"PDH" are the previous trading day low/high. Not investment advice.</div>';
      html += '</div>';
      return html;
    }

    function corrLabel(r) {
      if (r == null) return 'N/A';
      const abs = Math.abs(r);
      if (abs >= 0.7) return (r < 0 ? 'Strong inverse' : 'Strong direct');
      if (abs >= 0.4) return (r < 0 ? 'Moderate inverse' : 'Moderate direct');
      return (r < 0 ? 'Weak inverse' : 'Weak direct');
    }

    function renderVixCorrelation() {
      if (!vixCorrLoaded) {
        loadVixCorrelation();
        return '<div class="loading">Loading 1 year of historical data from Kite (this can take a few seconds)...</div>';
      }
      if (!vixCorrData) {
        return '<div class="loading">Loading VIX correlation...</div>';
      }
      if (vixCorrData.error) {
        return '<div class="error">⚠️ ' + escapeHtml(vixCorrData.error) + '</div>';
      }

      let html = '<div class="metrics-grid" style="margin-bottom:16px;">';
      html += '<div class="metric-card"><div class="metric-label">NIFTY vs VIX</div>';
      html += '<div class="metric-value" style="font-size:1rem;">' + (vixCorrData.niftyVixCorrelation != null ? vixCorrData.niftyVixCorrelation.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">' + corrLabel(vixCorrData.niftyVixCorrelation) + '</div></div>';
      html += '<div class="metric-card"><div class="metric-label">BANKNIFTY vs VIX</div>';
      html += '<div class="metric-value" style="font-size:1rem;">' + (vixCorrData.bankNiftyVixCorrelation != null ? vixCorrData.bankNiftyVixCorrelation.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">' + corrLabel(vixCorrData.bankNiftyVixCorrelation) + '</div></div>';
      html += '<div class="metric-card"><div class="metric-label">Data Points</div>';
      html += '<div class="metric-value" style="font-size:1rem;">' + vixCorrData.dataPoints + '</div>';
      html += '<div class="metric-change">Trading days</div></div>';
      html += '</div>';

      html += '<div class="premium-card">';
      html += '<div class="card-title">NIFTY &amp; BANKNIFTY (% change) vs India VIX — 1 year</div>';
      html += '<canvas id="chart-vixcorr" height="220"></canvas>';
      html += '</div>';

      html += '<div class="timestamp">Correlation is daily-returns based (Pearson r, -1 to +1). Negative = VIX tends to rise when the index falls, and vice versa.</div>';
      return html;
    }

    function drawVixCorrChart() {
      const canvas = document.getElementById('chart-vixcorr');
      if (!canvas || typeof Chart === 'undefined' || !vixCorrData || vixCorrData.error) return;

      if (vixCorrChart) {
        vixCorrChart.destroy();
        vixCorrChart = null;
      }

      const series = vixCorrData.series || [];
      if (series.length === 0) return;

      // Thin labels so the x-axis doesn't get crowded over a year of daily points
      const labels = series.map((p) => p.date);

      vixCorrChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'NIFTY % change',
              data: series.map((p) => p.niftyPct),
              borderColor: '#C9A227',
              backgroundColor: 'transparent',
              yAxisID: 'yPct',
              tension: 0.15,
              pointRadius: 0,
              borderWidth: 1.5,
            },
            {
              label: 'BANKNIFTY % change',
              data: series.map((p) => p.bankNiftyPct),
              borderColor: '#5B8DEF',
              backgroundColor: 'transparent',
              yAxisID: 'yPct',
              tension: 0.15,
              pointRadius: 0,
              borderWidth: 1.5,
            },
            {
              label: 'India VIX',
              data: series.map((p) => p.vix),
              borderColor: '#E5484D',
              backgroundColor: 'rgba(229,72,77,0.08)',
              yAxisID: 'yVix',
              tension: 0.15,
              pointRadius: 0,
              borderWidth: 1.5,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: { color: '#7C8AA5', font: { family: 'IBM Plex Mono', size: 10 } },
            },
          },
          scales: {
            x: {
              ticks: { color: '#4E5B78', font: { size: 8 }, maxTicksLimit: 10 },
              grid: { color: '#1E2B4A' },
            },
            yPct: {
              position: 'left',
              ticks: { color: '#7C8AA5', font: { size: 9 }, callback: (v) => v + '%' },
              grid: { color: '#1E2B4A' },
            },
            yVix: {
              position: 'right',
              ticks: { color: '#7C8AA5', font: { size: 9 } },
              grid: { display: false },
            },
          },
        },
      });
    }

    function switchTab(symbol) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(symbol).classList.add('active');
      const btns = document.querySelectorAll('button[class*="tab-btn"]');
      for (let i = 0; i < btns.length; i++) {
        if (btns[i].textContent.includes(symbol)) {
          btns[i].classList.add('active');
        }
      }
      if (symbol === 'VIXCORR') loadVixCorrelation();
    }

    function updateRefreshStatus() {
      lastRefreshTime = new Date();
      const now = lastRefreshTime;
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      document.getElementById('refreshStatus').textContent = 'Last: ' + timeStr;
    }

    async function refreshData() {
      if (!kiteConnected) return;
      document.getElementById('manualRefresh').disabled = true;
      await fetchData();
      setTimeout(() => {
        document.getElementById('manualRefresh').disabled = false;
      }, 500);
    }

    function toggleAutoRefresh() {
      const toggle = document.getElementById('autoRefreshToggle').checked;
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
      }
      if (toggle) {
        autoRefreshInterval = setInterval(refreshData, 3 * 60 * 1000);
      }
    }

    function showError(message) {
      const container = document.getElementById('errorContainer');
      container.innerHTML = '<div class="error">' + escapeHtml(message) + '</div>';
    }

    function showSuccess(message) {
      const container = document.getElementById('successContainer');
      container.innerHTML = '<div class="success">' + message + '</div>';
      setTimeout(() => {
        container.innerHTML = '';
      }, 5000);
    }

    function clearError() {
      document.getElementById('errorContainer').innerHTML = '';
    }

    async function initialize() {
      await checkKiteStatus();
      await Promise.all([loadNews(), loadHolidays()]);
      if (kiteConnected) {
        await Promise.all([fetchData(), loadHeatmap(), loadCommodities()]);
      } else {
        ['NIFTY', 'BANKNIFTY', 'SENSEX', 'HEATMAP', 'COMMODITIES', 'SWING', 'VIXCORR']
          .forEach((id) => {
            document.getElementById(id).innerHTML =
              '<div class="loading">Connect Kite to load verified live market data.</div>';
          });
        updateUI();
      }
      toggleAutoRefresh();
    }

    initialize();

    setInterval(checkKiteStatus, 30000);
    setInterval(loadNews, 20 * 60 * 1000);
    setInterval(loadHeatmap, 3 * 60 * 1000);
    setInterval(loadCommodities, 3 * 60 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && kiteConnected) refreshData();
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has('login_success')) {
      showSuccess('✓ Kite Connected Successfully!');
      window.history.replaceState({}, document.title, window.location.pathname);
      checkKiteStatus();
      setTimeout(fetchData, 1000);
    } else if (params.has('login_error')) {
      showError('Failed to connect Kite: ' + (params.get('error') || 'Unknown error'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  </script>
</body>
</html>`;
  return c.html(html);
});

// API endpoint for live Kite data
app.get("/api/data", async (c) => {
  try {
    const session = getSession(c);

    if (!session) {
      return c.json(
        {
          error: "Kite not connected. Please connect Kite to fetch live data.",
          timestamp: new Date().toISOString(),
        },
        401
      );
    }

    console.log("======================================");
    console.log("    [API] /api/data request received");
    console.log("======================================");

    const isFresh =
      session.marketSnapshot &&
      session.snapshotTime &&
      Date.now() - session.snapshotTime < SNAPSHOT_TTL_MS;
    const data = isFresh
      ? session.marketSnapshot!
      : await refreshMarketSnapshot(session);

    console.log("======================================");
    console.log("    [API] /api/data response ready");
    console.log("======================================\n");
    return c.json({ ...data, _history: session.snapshotHistory || [] });
  } catch (err) {
    console.error("[API] Data fetch error:", err instanceof Error ? err.message : err);
    return c.json(
      {
        error: err instanceof Error ? err.message : "Failed to fetch market data",
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// News endpoint
app.get("/api/news", async (c) => {
  try {
    const news = await fetchFinancialNews();
    return c.json(news);
  } catch (err) {
    return c.json([], 500);
  }
});

// Holidays endpoint
app.get("/api/holidays", (c) => {
  return c.json([]);
});

// Sector + stock heatmap — live % change from Kite, colour-coded on the frontend
// (<= -0.5% dark red, >= +0.5% dark green)
const HEATMAP_SECTORS: Record<string, string> = {
  "Nifty PSU Bank": "NSE:NIFTY PSU BANK",
  "Nifty Smallcap 100": "NSE:NIFTY SMLCAP 100",
  "Nifty Midcap 100": "NSE:NIFTY MIDCAP 100",
  "Nifty IT": "NSE:NIFTY IT",
  "Nifty Oil & Gas": "NSE:NIFTY OIL AND GAS",
  "Nifty Financial Services": "NSE:NIFTY FIN SERVICE",
  "Nifty Auto": "NSE:NIFTY AUTO",
  "Nifty FMCG": "NSE:NIFTY FMCG",
};
const HEATMAP_STOCKS: Record<string, string> = {
  "HDFC Bank": "NSE:HDFCBANK",
  "Reliance": "NSE:RELIANCE",
  "SBI": "NSE:SBIN",
};

app.get("/api/sectors", async (c) => {
  try {
    const session = getSession(c);
    if (!session) {
      return c.json({ error: "Kite not connected. Please connect Kite first." }, 401);
    }

    const allSymbols = [...Object.values(HEATMAP_SECTORS), ...Object.values(HEATMAP_STOCKS)];
    const quotes = await fetchKiteQuote(session.accessToken, allSymbols);

    if (!quotes) {
      return c.json({ error: "Failed to fetch sector/stock quotes from Kite" }, 500);
    }

    function pctChange(kiteSymbol: string): number | null {
      const q = quotes[kiteSymbol];
      if (!q || !q.ohlc?.close) return null;
      return ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100;
    }

    const sectors = Object.entries(HEATMAP_SECTORS).map(([name, kiteSymbol]) => ({
      name,
      change: pctChange(kiteSymbol),
    }));
    const stocks = Object.entries(HEATMAP_STOCKS).map(([name, kiteSymbol]) => ({
      name,
      change: pctChange(kiteSymbol),
    }));

    return c.json({ sectors, stocks, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[API] Sectors fetch error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch sector data" }, 500);
  }
});

// Commodities endpoint — Crude Oil & Natural Gas (MCX), with ATM ±5 strike
// band and a BUY/SELL/WAIT signal based on the futures price testing its own
// day-high (resistance -> SELL) or day-low (support -> BUY)
app.get("/api/commodities", async (c) => {
  try {
    const session = getSession(c);
    if (!session) {
      return c.json({ error: "Kite not connected. Please connect Kite first." }, 401);
    }

    const instruments = await fetchInstruments(session.accessToken);
    if (instruments.length === 0) {
      return c.json({ error: "Failed to fetch instruments list" }, 500);
    }

    const [crudeoil, naturalgas] = await Promise.all([
      fetchCommodityData(session.accessToken, instruments, "CRUDEOIL"),
      fetchCommodityData(session.accessToken, instruments, "NATURALGAS"),
    ]);

    return c.json({ CRUDEOIL: crudeoil, NATURALGAS: naturalgas, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[API] Commodities fetch error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch commodity data" }, 500);
  }
});

// VIX vs NIFTY vs Bank Nifty correlation — 1 year of real Kite daily candles
app.get("/api/vix-correlation", async (c) => {
  try {
    const session = getSession(c);
    if (!session) {
      return c.json({ error: "Kite not connected. Please connect Kite first." }, 401);
    }

    const instruments = await fetchInstruments(session.accessToken);
    if (instruments.length === 0) {
      return c.json({ error: "Failed to fetch instruments list" }, 500);
    }

    const niftyToken = findIndexInstrumentToken(instruments, "NIFTY 50");
    const bankNiftyToken = findIndexInstrumentToken(instruments, "NIFTY BANK");
    const vixToken = findIndexInstrumentToken(instruments, "INDIA VIX");

    if (!niftyToken || !bankNiftyToken || !vixToken) {
      return c.json({ error: "Could not find instrument tokens for NIFTY/BANKNIFTY/VIX" }, 500);
    }

    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);
    const toDate = today.toISOString().slice(0, 10);
    const fromDate = oneYearAgo.toISOString().slice(0, 10);

    const [niftyCandles, bankNiftyCandles, vixCandles] = await Promise.all([
      fetchHistoricalDaily(session.accessToken, niftyToken, fromDate, toDate),
      fetchHistoricalDaily(session.accessToken, bankNiftyToken, fromDate, toDate),
      fetchHistoricalDaily(session.accessToken, vixToken, fromDate, toDate),
    ]);

    if (niftyCandles.length === 0 || bankNiftyCandles.length === 0 || vixCandles.length === 0) {
      return c.json({ error: "Failed to fetch historical candles from Kite" }, 500);
    }

    // Align by date (intersection) since exchange holidays can differ slightly across series
    const niftyByDate = new Map(niftyCandles.map((cd) => [cd.date, cd]));
    const bankNiftyByDate = new Map(bankNiftyCandles.map((cd) => [cd.date, cd]));
    const vixByDate = new Map(vixCandles.map((cd) => [cd.date, cd]));

    const commonDates = niftyCandles
      .map((cd) => cd.date)
      .filter((d) => bankNiftyByDate.has(d) && vixByDate.has(d))
      .sort();

    const series = commonDates.map((d) => ({
      date: d,
      nifty: niftyByDate.get(d)!.close,
      bankNifty: bankNiftyByDate.get(d)!.close,
      vix: vixByDate.get(d)!.close,
    }));

    // Daily % returns for correlation (skip first day, no prior close)
    const niftyReturns: number[] = [];
    const bankNiftyReturns: number[] = [];
    const vixChanges: number[] = [];
    for (let i = 1; i < series.length; i++) {
      niftyReturns.push(((series[i].nifty - series[i - 1].nifty) / series[i - 1].nifty) * 100);
      bankNiftyReturns.push(((series[i].bankNifty - series[i - 1].bankNifty) / series[i - 1].bankNifty) * 100);
      vixChanges.push(((series[i].vix - series[i - 1].vix) / series[i - 1].vix) * 100);
    }

    const niftyVixCorrelation = pearsonCorrelation(niftyReturns, vixChanges);
    const bankNiftyVixCorrelation = pearsonCorrelation(bankNiftyReturns, vixChanges);

    // Normalize index levels to % change from the first day, for charting against VIX
    const base = series[0];
    const chartSeries = series.map((s) => ({
      date: s.date,
      niftyPct: ((s.nifty - base.nifty) / base.nifty) * 100,
      bankNiftyPct: ((s.bankNifty - base.bankNifty) / base.bankNifty) * 100,
      vix: s.vix,
    }));

    return c.json({
      series: chartSeries,
      niftyVixCorrelation,
      bankNiftyVixCorrelation,
      dataPoints: series.length,
      fromDate,
      toDate,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[API] VIX correlation error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to compute VIX correlation" }, 500);
  }
});

// Kite Login - Redirects to Kite login page
app.get("/api/kite/login", (c) => {
  if (!KITE_API_KEY || !KITE_API_SECRET) {
    return c.json(
      {
        error: "KITE_API_KEY and KITE_API_SECRET are not configured on the server.",
      },
      503
    );
  }
  const loginUrl = getKiteLoginUrl();
  console.log("[AUTH] Redirecting to Kite login");
  return c.redirect(loginUrl);
});

// Kite Callback - Exchanges request_token for access_token
app.get("/api/kite/callback", async (c) => {
  try {
    if (!KITE_API_KEY || !KITE_API_SECRET) {
      return c.redirect("/?login_error=true&error=Kite+credentials+not+configured");
    }
    const requestToken = c.req.query("request_token");
    const status = c.req.query("status");

    console.log(`[AUTH] Callback received with status=${status}`);

    if (status !== "success" || !requestToken) {
      console.warn("[AUTH] Invalid callback: missing status or token");
      return c.redirect("/?login_error=true&error=Invalid+request");
    }

    // Exchange request_token for access_token (SECURELY ON BACKEND)
    const tokenData = await exchangeRequestToken(requestToken);

    if (!tokenData) {
      console.error("[AUTH] Token exchange failed");
      return c.redirect("/?login_error=true&error=Token+exchange+failed");
    }

    console.log(`[AUTH] Token exchange successful for ${tokenData.userId}`);

    // Store session in memory/database (NEVER expose to frontend)
    const sessionId = randomBytes(32).toString("hex");
    const expiresAt = nextKiteExpiryTime();
    sessions.set(sessionId, {
      accessToken: tokenData.accessToken,
      userId: tokenData.userId,
      email: tokenData.email,
      loginTime: Date.now(),
      expiresAt,
    });

    // Store session ID in secure HTTP-only cookie
    const maxAgeSeconds = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    c.header(
      "Set-Cookie",
      `session_id=${sessionId}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAgeSeconds}`
    );

    console.log("[AUTH] Session stored, redirecting to dashboard");
    return c.redirect("/?login_success=true");
  } catch (err) {
    console.error("[AUTH] Callback error:", err instanceof Error ? err.message : err);
    return c.redirect("/?login_error=true&error=Server+error");
  }
});

app.post("/api/kite/logout", (c) => {
  const cookies = c.req.header("cookie") || "";
  const sessionId = cookies
    .split("; ")
    .find((row: string) => row.startsWith("session_id="))
    ?.substring(11);
  if (sessionId) sessions.delete(sessionId);
  c.header(
    "Set-Cookie",
    "session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return c.json({ connected: false });
});

// Kite Status - Returns connection status and user info (NEVER exposes tokens)
app.get("/api/kite/status", (c) => {
  try {
    const session = getSession(c);

    if (!session) {
      return c.json({
        connected: false,
        user: null,
      });
    }

    // NEVER return access token to frontend
    return c.json({
      connected: true,
      user: {
        userId: session.userId,
        email: session.email,
      },
    });
  } catch (err) {
    console.error("[STATUS] Error:", err instanceof Error ? err.message : err);
    return c.json({
      connected: false,
      user: null,
    });
  }
});

export default app;

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[SERVER] OptionPilot Pro listening on port ${info.port}`);
  });

  setInterval(() => {
    for (const [sessionId, session] of sessions) {
      if (Date.now() >= session.expiresAt) {
        sessions.delete(sessionId);
        continue;
      }
      if (!session.snapshotTime || Date.now() - session.snapshotTime >= SNAPSHOT_TTL_MS) {
        void refreshMarketSnapshot(session).catch((err) => {
          console.error(
            "[BACKGROUND] Market refresh failed:",
            err instanceof Error ? err.message : err
          );
        });
      }
    }
  }, SNAPSHOT_TTL_MS);
}
