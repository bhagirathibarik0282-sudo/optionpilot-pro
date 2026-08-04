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
  vega: number; // Black-Scholes estimate — NOT from Kite (Kite doesn't publish Greeks)
  theta: number; // Black-Scholes estimate, per-day decay — NOT from Kite
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

interface FuturesContract {
  label: "Near" | "Next" | "Far";
  tradingsymbol: string;
  expiry: string;
  ltp: number;
  prevClose: number;
  changePercent: number;
  oi: number | null;
  volume: number | null;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  basis: number | null; // futures LTP - spot LTP
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
  futuresContracts: FuturesContract[];
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  first15High: number;
  first15Low: number;
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
  lastServedStrikeValues?: Record<string, { price: number; oi: number; iv: number }>; // key: SYMBOL_expiry_CE/PE_strike
}

// In-memory session store (use Redis in production)
const sessions = new Map<string, KiteSession>();

// ============== FII/DII MANUAL ENTRY (not tied to any Kite session) ==============
// NSE publishes FII/DII cash + derivatives data with a lag, and Kite doesn't
// expose it at all, so this is filled in by hand. Stored in server memory
// only — it will NOT survive a redeploy or restart. Consider a real
// database if this needs to persist long-term.
interface FiiDiiDerivative {
  category: string; // "Index Futures" | "Stock Futures" | "Index Options (Call)" | "Index Options (Put)"
  oiChange: number; // user-entered net OI change (Cr or %, whatever the user is tracking)
  bias: "Long Buildup" | "Short Buildup" | "Long Unwinding" | "Short Covering";
}

interface FiiDiiEntry {
  date: string; // YYYY-MM-DD
  fiiCashCr: number;
  diiCashCr: number;
  derivatives: FiiDiiDerivative[];
  createdAt: string;
}

const fiiDiiEntries: FiiDiiEntry[] = [];
const FII_DII_MAX_ENTRIES = 60;

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

// A candle with high === low (and non-zero) usually means Kite had no real
// previous-day trade for this instrument and returned a degenerate
// placeholder candle — treat as "no data" rather than a misleading
// identical PDH/PDL.
function sanitizePdhPdl(high: number, low: number): { pdh: number; pdl: number } {
  if (high > 0 && high === low) return { pdh: 0, pdl: 0 };
  return { pdh: high, pdl: low };
}

// ============== PER-STRIKE PDH/PDL (previous day high/low of each option) ==============
// Previous-day levels for a given option contract don't change during the
// trading day, so results are cached in-memory (shared across all sessions)
// to avoid re-hitting Kite's historical endpoint on every 3-minute refresh.
// First 15-minute (9:15-9:30 IST) high/low — sampled from whatever refresh
// cadence is running (typically every 3 minutes via the background job, or
// whatever interval the user picked), NOT true tick-by-tick data. Honest
// approximation, not exact.
const first15MinRanges: Record<string, { date: string; high: number; low: number }> = {};

function updateFirst15MinRange(symbol: string, current: number) {
  if (current <= 0) return;
  const today = indiaDate();
  const indiaNow = new Date(Date.now() + INDIA_OFFSET_MS);
  const minutesSinceMidnight = indiaNow.getUTCHours() * 60 + indiaNow.getUTCMinutes();
  const marketOpen = 9 * 60 + 15;
  const windowEnd = 9 * 60 + 30;

  let entry = first15MinRanges[symbol];
  if (!entry || entry.date !== today) {
    entry = { date: today, high: 0, low: 0 };
    first15MinRanges[symbol] = entry;
  }
  if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight <= windowEnd) {
    if (entry.high === 0 || current > entry.high) entry.high = current;
    if (entry.low === 0 || current < entry.low) entry.low = current;
  }
}

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
    // Kite's historical-candle endpoint has a low rate limit (~3 req/sec).
    // Fetching every strike's PDH/PDL concurrently on the first refresh of
    // the day could trip 429 errors, so we throttle to small chunks with a
    // short pause between them. Subsequent refreshes are cheap (cache hit).
    const CHUNK_SIZE = 1;
    const CHUNK_DELAY_MS = 350;
    const fetched: (DailyCandle | null)[] = [];
    for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
      const chunk = toFetch.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map((token) => fetchPreviousTradingCandle(accessToken, token))
      );
      fetched.push(...chunkResults);
      if (i + CHUNK_SIZE < toFetch.length) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      }
    }
    toFetch.forEach((token, i) => {
      const candle = fetched[i];
      const levels = sanitizePdhPdl(candle?.high || 0, candle?.low || 0);
      optionPrevDayCache.set(token, { ...levels, cachedAt: Date.now() });
      result.set(token, levels);
    });
  }

  return result;
}

// ============== BLACK-SCHOLES GREEKS (Vega/Theta) — estimated, NOT from Kite ==============
// Kite's quote API does not publish option Greeks. These are computed
// locally from spot, strike, IV, and days-to-expiry using the standard
// Black-Scholes model with an assumed risk-free rate — a reasonable
// estimate, not an exchange-published figure.
const BS_RISK_FREE_RATE = 0.07; // approx. India short-term rate, for Greeks estimation only

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x: number): number {
  // Abramowitz & Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// Implied Volatility solver (bisection) — Kite's /quote endpoint does not
// return an IV field for options, so we compute it ourselves from the
// option's actual traded price using the standard Black-Scholes model.
function bsPrice(spot: number, strike: number, sigma: number, T: number, r: number, isCall: boolean): number {
  if (sigma <= 0 || T <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-r * T) * normCdf(d2);
  return strike * Math.exp(-r * T) * normCdf(-d2) - spot * normCdf(-d1);
}

function calcImpliedVolatility(
  marketPrice: number,
  spot: number,
  strike: number,
  daysToExpiry: number,
  isCall: boolean
): number {
  if (marketPrice <= 0 || spot <= 0 || strike <= 0 || daysToExpiry <= 0) return 0;
  const T = daysToExpiry / 365;
  const r = BS_RISK_FREE_RATE;
  let lo = 0.001;
  let hi = 5.0; // 0.1% to 500% annualized vol — wide enough bracket for any real option
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice(spot, strike, mid, T, r, isCall);
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 100; // as a percentage, matching Kite's IV display convention
}

function calcVegaTheta(
  spot: number,
  strike: number,
  ivPercent: number,
  daysToExpiry: number,
  isCall: boolean
): { vega: number; theta: number } {
  if (spot <= 0 || strike <= 0 || ivPercent <= 0 || daysToExpiry <= 0) return { vega: 0, theta: 0 };
  const sigma = ivPercent / 100;
  const T = daysToExpiry / 365;
  const r = BS_RISK_FREE_RATE;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const vega = (spot * normPdf(d1) * sqrtT) / 100; // change in premium per 1% IV move

  let thetaAnnual: number;
  if (isCall) {
    thetaAnnual =
      -(spot * normPdf(d1) * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * normCdf(d2);
  } else {
    thetaAnnual =
      -(spot * normPdf(d1) * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * normCdf(-d2);
  }
  const thetaPerDay = thetaAnnual / 365;

  return { vega, theta: thetaPerDay };
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

// All available index futures, nearest expiry first — used for the FUTURES
// tab's Near/Next/Far month cards (spec section 7).
function findAllIndexFutures(
  instruments: Instrument[],
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX"
): Instrument[] {
  const exchange = EXCHANGE_CODES[symbol];
  const underlying = INDEX_NAMES[symbol];
  const today = indiaDate();
  return instruments
    .filter(
      (inst) =>
        inst.exchange === exchange &&
        inst.instrument_type === "FUT" &&
        inst.expiry >= today &&
        matchesUnderlying(inst, underlying)
    )
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
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
    const commodityPdhPdl = sanitizePdhPdl(previousCandle?.high || 0, previousCandle?.low || 0);
    baseMetrics.pdh = commodityPdhPdl.pdh;
    baseMetrics.pdl = commodityPdhPdl.pdl;

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
    const commodityExpiryDate = parseExpiryDate(expiry);
    const commodityDaysToExpiry = commodityExpiryDate
      ? Math.max(0, (commodityExpiryDate.getTime() - Date.now()) / 86_400_000)
      : 0;

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
            const computedIv = calcImpliedVolatility(oq.last_price || 0, baseMetrics.current, strike, commodityDaysToExpiry, true);
            const greeks = calcVegaTheta(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, true);
            baseMetrics.ceStrikes.push({
              strike,
              isAtm,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
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
            const computedIv = calcImpliedVolatility(oq.last_price || 0, baseMetrics.current, strike, commodityDaysToExpiry, false);
            const greeks = calcVegaTheta(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, false);
            baseMetrics.peStrikes.push({
              strike,
              isAtm,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
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
    futuresContracts: [],
    dayOpen: 0,
    dayHigh: 0,
    dayLow: 0,
    first15High: 0,
    first15Low: 0,
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
    baseMetrics.dayOpen = spotQuote.ohlc?.open || 0;
    baseMetrics.dayHigh = spotQuote.ohlc?.high || 0;
    baseMetrics.dayLow = spotQuote.ohlc?.low || 0;

    updateFirst15MinRange(symbol, baseMetrics.current);
    const first15 = first15MinRanges[symbol];
    if (first15 && first15.date === indiaDate() && first15.high > 0) {
      baseMetrics.first15High = first15.high;
      baseMetrics.first15Low = first15.low;
    }

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
      const indexPdhPdl = sanitizePdhPdl(previousCandle?.high || 0, previousCandle?.low || 0);
      baseMetrics.pdh = indexPdhPdl.pdh;
      baseMetrics.pdl = indexPdhPdl.pdl;
    }

    let futuresVwapBias: "UP" | "DOWN" | "UNKNOWN" = "UNKNOWN";
    const allFutures = findAllIndexFutures(instruments, symbol).slice(0, 3);
    if (allFutures.length > 0) {
      const futSymbols = allFutures.map((f) => `${f.exchange}:${f.tradingsymbol}`);
      const futQuotes = await fetchKiteQuote(accessToken, futSymbols);
      const labels: Array<"Near" | "Next" | "Far"> = ["Near", "Next", "Far"];

      baseMetrics.futuresContracts = allFutures.map((f, i) => {
        const sym = `${f.exchange}:${f.tradingsymbol}`;
        const q = futQuotes?.[sym];
        const ltp = q?.last_price || 0;
        const prevClose = q?.ohlc?.close || 0;
        return {
          label: labels[i],
          tradingsymbol: f.tradingsymbol,
          expiry: f.expiry,
          ltp,
          prevClose,
          changePercent: prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0,
          oi: q?.oi ?? null,
          volume: q?.volume ?? null,
          dayOpen: q?.ohlc?.open || 0,
          dayHigh: q?.ohlc?.high || 0,
          dayLow: q?.ohlc?.low || 0,
          basis: q ? ltp - baseMetrics.current : null,
        };
      });

      // Near-month contract still drives the existing VWAP-bias signal logic.
      const nearSymbol = futSymbols[0];
      const nearQuote = futQuotes?.[nearSymbol];
      baseMetrics.vwap = nearQuote?.average_price || 0;
      if (baseMetrics.vwap > 0) {
        baseMetrics.vwapSource = `${allFutures[0].tradingsymbol} traded VWAP`;
        futuresVwapBias =
          nearQuote.last_price > baseMetrics.vwap
            ? "UP"
            : nearQuote.last_price < baseMetrics.vwap
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
        // BankNifty gets a wider ATM±6 band; NIFTY/SENSEX stay at ATM±2.
        const offsets = symbol === "BANKNIFTY" ? [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6] : [-2, -1, 0, 1, 2];
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
                const daysToExpiry = Math.max(0, (expiry.expiryDate.getTime() - Date.now()) / 86_400_000);
                const computedIv = calcImpliedVolatility(q.last_price || 0, baseMetrics.current, strike, daysToExpiry, true);
                const greeks = calcVegaTheta(baseMetrics.current, strike, computedIv, daysToExpiry, true);
                expiry.ceStrikes.push({
                  strike,
                  isAtm,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
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
                const daysToExpiry = Math.max(0, (expiry.expiryDate.getTime() - Date.now()) / 86_400_000);
                const computedIv = calcImpliedVolatility(q.last_price || 0, baseMetrics.current, strike, daysToExpiry, false);
                const greeks = calcVegaTheta(baseMetrics.current, strike, computedIv, daysToExpiry, false);
                expiry.peStrikes.push({
                  strike,
                  isAtm,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
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
      padding-bottom: 60px;
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

    .straddle-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 20px;
    }

    .straddle-strip {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      overflow-x: auto;
      padding-bottom: 4px;
      perspective: 600px;
    }

    .straddle-box {
      flex: 1;
      min-width: 78px;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 6px;
      text-align: center;
    }

    .straddle-box.atm {
      background: rgba(201,162,39,0.10);
      border: 2px solid var(--gold);
    }

    .straddle-strike-label {
      font-size: 0.65rem;
      color: var(--muted-dim);
      font-family: var(--font-mono);
      margin-bottom: 4px;
    }

    .straddle-value {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
      font-family: var(--font-mono);
    }

    .straddle-box.atm .straddle-value {
      color: var(--gold);
      font-size: 1.2rem;
    }

    .straddle-arrow {
      font-size: 0.7rem;
      margin-top: 3px;
      font-weight: 700;
    }

    @keyframes straddleTilt {
      0%, 100% { transform: rotateY(0deg) translateY(0); }
      50% { transform: rotateY(8deg) translateY(-2px); }
    }

    @keyframes straddleTiltAtm {
      0%, 100% { transform: rotateY(0deg) translateY(0) scale(1); }
      50% { transform: rotateY(12deg) translateY(-4px) scale(1.03); }
    }

    .straddle-box {
      transform-style: preserve-3d;
      animation: straddleTilt 3s ease-in-out infinite;
    }

    .straddle-box.atm {
      animation: straddleTiltAtm 3s ease-in-out infinite;
    }

    .align-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 4px;
      border-top: 1px solid var(--border);
      gap: 8px;
      flex-wrap: wrap;
    }

    .align-row:first-child {
      border-top: none;
    }

    .align-name {
      color: var(--text);
      font-weight: 600;
      font-size: 0.85rem;
      min-width: 110px;
    }

    .align-meta {
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }

    .action-plan-footer {
      background: var(--panel-alt);
      border: 1px solid var(--gold-soft);
      border-radius: 10px;
      padding: 14px;
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .fii-form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    .fii-field label {
      display: block;
      font-size: 0.7rem;
      color: var(--muted);
      margin-bottom: 4px;
      font-family: var(--font-mono);
    }

    .fii-field input, .fii-field select {
      width: 100%;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 0.8rem;
      font-family: var(--font-mono);
    }

    .fii-section-label {
      color: var(--gold-soft);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      margin: 14px 0 4px;
      font-family: var(--font-display);
    }

    @keyframes tickBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .checklist-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 4px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
    }

    .checklist-item:first-child {
      border-top: none;
    }

    .checklist-tick {
      font-weight: 700;
      font-size: 0.9rem;
    }

    .checklist-tick.on {
      animation: tickBlink 1.4s ease-in-out infinite;
    }

    .journal-sentence {
      background: var(--panel-alt);
      border-left: 3px solid var(--gold);
      border-radius: 0 8px 8px 0;
      padding: 8px 12px;
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--text);
    }

    .ticker-wrap {
      background: var(--panel);
      border: 1px solid var(--gold-soft);
      border-radius: 8px;
      padding: 8px 0;
      margin-bottom: 16px;
      overflow: hidden;
      white-space: nowrap;
    }

    .ticker-track {
      display: inline-block;
      padding-left: 100%;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--gold);
      font-weight: 600;
      animation: tickerScroll 22s linear infinite;
    }

    @keyframes tickerScroll {
      0% { transform: translateX(0); }
      100% { transform: translateX(-100%); }
    }

    @keyframes trafficBlink {
      0%, 100% { opacity: 1; box-shadow: 0 0 8px currentColor; }
      50% { opacity: 0.35; box-shadow: none; }
    }

    .traffic-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      display: inline-block;
      animation: trafficBlink 1.2s ease-in-out infinite;
    }

    .sentiment-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 4px;
      border-top: 1px solid var(--border);
      gap: 10px;
    }

    .sentiment-row:first-child {
      border-top: none;
    }

    .toggle-btn-group {
      display: inline-flex;
      border: 1px solid var(--gold-soft);
      border-radius: 8px;
      overflow: hidden;
    }

    .toggle-btn-group button {
      background: var(--panel-alt);
      color: var(--muted);
      border: none;
      padding: 6px 16px;
      font-weight: 700;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      cursor: pointer;
    }

    .toggle-btn-group button.active {
      background: var(--gold);
      color: var(--bg);
    }

    .greek-chip-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      gap: 6px;
      margin-top: 6px;
    }

    .greek-chip {
      background: var(--panel-alt);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 6px;
      text-align: center;
      font-family: var(--font-mono);
      font-size: 0.68rem;
    }

    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      background: var(--panel);
      border-top: 1px solid var(--gold-soft);
      z-index: 20;
    }

    .bottom-nav button {
      flex: 1;
      background: none;
      border: none;
      color: var(--muted);
      padding: 8px 0 6px;
      font-size: 0.62rem;
      font-weight: 700;
      font-family: var(--font-display);
      cursor: pointer;
    }

    .bottom-nav button.active {
      color: var(--gold);
    }

    .chip-nav {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .chip-nav button {
      background: var(--panel-alt);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 0.72rem;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
    }

    .chip-nav button.active {
      background: var(--gold);
      color: var(--bg);
      border-color: var(--gold);
    }

    .verdict-index-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 10px;
    }

    .verdict-overall-card {
      background: var(--panel-alt);
      border: 2px solid var(--gold);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 10px;
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
            <span>Auto</span>
          </label>
          <select id="refreshIntervalSelect" onchange="changeRefreshInterval()" style="background: var(--panel-alt); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:4px 6px; font-size:0.8rem; font-family: var(--font-mono);">
            <option value="3">3m</option>
            <option value="5">5m</option>
            <option value="10">10m</option>
            <option value="15">15m</option>
            <option value="30">30m</option>
          </select>
          <div class="refresh-status" id="refreshStatus">Last: Just now</div>
          <div class="refresh-status" id="refreshCountdown" style="color: var(--gold);">Next: 3:00</div>
        </div>
      </div>
    </div>

    <div id="errorContainer"></div>
    <div id="successContainer"></div>

    <div class="tabs">
      <button class="tab-btn" onclick="switchTab('NIFTY')">NIFTY</button>
      <button class="tab-btn" onclick="switchTab('BANKNIFTY')">BANKNIFTY</button>
      <button class="tab-btn" onclick="switchTab('SENSEX')">SENSEX</button>
      <button class="tab-btn" onclick="switchTab('COMMODITIES')">🛢️ Commodities</button>
      <button class="tab-btn" onclick="switchTab('FIIDII')">🏦 FII/DII</button>
      <button class="tab-btn" onclick="switchTab('VIXCORR')">📉 VIX Correlation</button>
      <button class="tab-btn" onclick="switchTab('NEWS')">📰 News</button>
      <button class="tab-btn" onclick="switchTab('HOLIDAYS')">📅 Holidays</button>
    </div>

    <div id="NIFTY" class="tab-content"></div>
    <div id="BANKNIFTY" class="tab-content"></div>
    <div id="SENSEX" class="tab-content"></div>
    <div id="COMMODITIES" class="tab-content"></div>
    <div id="FIIDII" class="tab-content"></div>
    <div id="VERDICT" class="tab-content active"></div>
    <div id="CONTEXT" class="tab-content"></div>
    <div id="VIXCORR" class="tab-content"></div>
    <div id="NEWS" class="tab-content"></div>
    <div id="HOLIDAYS" class="tab-content"></div>

    <div class="timestamp" id="dataTimestamp"></div>
  </div>

  <div class="bottom-nav">
    <button class="active" id="bnav-VERDICT" onclick="switchTab('VERDICT')">VERDICT</button>
    <button id="bnav-NIFTY" onclick="switchTab('NIFTY')">NIFTY</button>
    <button id="bnav-BANKNIFTY" onclick="switchTab('BANKNIFTY')">BANKNIFTY</button>
    <button id="bnav-SENSEX" onclick="switchTab('SENSEX')">SENSEX</button>
    <button id="bnav-CONTEXT" onclick="switchTab('CONTEXT')">CONTEXT</button>
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
        primeStrikeTrackersFromServer(json._prevStrikeValues);
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

    let sentimentSide = 'CE';
    function toggleSentimentSide(side) {
      sentimentSide = side;
      updateUI();
    }

    let fiiDiiData = null;
    async function loadFiiDii() {
      try {
        const response = await fetch('/api/fii-dii');
        const json = await response.json();
        fiiDiiData = response.ok ? json : { error: json.error || 'Failed to load FII/DII data' };
        updateUI();
      } catch (err) {
        console.error('Failed to load FII/DII data:', err);
        fiiDiiData = { error: err.message };
      }
    }

    const FII_DII_DERIVATIVE_CATEGORIES = ['Index Futures', 'Stock Futures', 'Index Options (Call)', 'Index Options (Put)'];

    const FII_DII_PASTE_LABEL_MAP = {
      'Date': 'fdDate',
      'FII Cash': 'fdFiiCash',
      'DII Cash': 'fdDiiCash',
      'Index Futures OI': 'fdDeriv0Val',
      'Index Futures Bias': 'fdDeriv0Bias',
      'Stock Futures OI': 'fdDeriv1Val',
      'Stock Futures Bias': 'fdDeriv1Bias',
      'Index Options Call OI': 'fdDeriv2Val',
      'Index Options Call Bias': 'fdDeriv2Bias',
      'Index Options Put OI': 'fdDeriv3Val',
      'Index Options Put Bias': 'fdDeriv3Bias',
    };

    function parseFiiDiiPaste() {
      const box = document.getElementById('fdPasteBox');
      const lines = (box.value || '').split('\\n');
      let filled = 0;
      lines.forEach((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        const fieldId = FII_DII_PASTE_LABEL_MAP[label];
        if (!fieldId) return;
        const el = document.getElementById(fieldId);
        if (el) { el.value = value; filled++; }
      });
      if (filled > 0) {
        showSuccess('✓ Filled ' + filled + ' fields from pasted text — check and hit Save Entry');
      } else {
        showError('Could not recognize the pasted format. Use lines like "FII Cash: 277.48"');
      }
    }

    async function saveFiiDii() {
      const getVal = (id) => document.getElementById(id).value;
      const date = getVal('fdDate') || new Date().toISOString().slice(0, 10);
      const fiiCashCr = parseFloat(getVal('fdFiiCash')) || 0;
      const diiCashCr = parseFloat(getVal('fdDiiCash')) || 0;

      const derivatives = FII_DII_DERIVATIVE_CATEGORIES.map((cat, i) => ({
        category: cat,
        oiChange: parseFloat(getVal('fdDeriv' + i + 'Val')) || 0,
        bias: getVal('fdDeriv' + i + 'Bias'),
      }));

      try {
        const response = await fetch('/api/fii-dii', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, fiiCashCr, diiCashCr, derivatives }),
        });
        if (!response.ok) throw new Error('Save failed');
        showSuccess('✓ FII/DII entry saved for ' + date);
        await loadFiiDii();
      } catch (err) {
        showError('Could not save FII/DII entry: ' + err.message);
      }
    }

    async function bulkSaveFiiDii() {
      const box = document.getElementById('fdBulkPasteBox');
      const text = box.value || '';
      const blocks = text.split(/\\n\\s*\\n/).map((b) => b.trim()).filter(Boolean);
      if (blocks.length === 0) {
        showError('Paste at least one day block first.');
        return;
      }

      let saved = 0;
      let failed = 0;
      for (const block of blocks) {
        const entry = { date: null, fiiCashCr: 0, diiCashCr: 0, derivatives: [] };
        block.split('\\n').forEach((line) => {
          const idx = line.indexOf(':');
          if (idx === -1) return;
          const label = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim();
          if (label === 'Date') entry.date = value;
          else if (label === 'FII Cash') entry.fiiCashCr = parseFloat(value) || 0;
          else if (label === 'DII Cash') entry.diiCashCr = parseFloat(value) || 0;
        });
        if (!entry.date) { failed++; continue; }
        try {
          const response = await fetch('/api/fii-dii', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          });
          if (response.ok) saved++;
          else failed++;
        } catch (err) {
          failed++;
        }
      }

      if (saved > 0) {
        showSuccess('✓ Saved ' + saved + ' day' + (saved === 1 ? '' : 's') + (failed > 0 ? ' (' + failed + ' failed — check Date lines)' : ''));
        box.value = '';
        await loadFiiDii();
      } else {
        showError('Could not save any days — check each block has a "Date:" line.');
      }
    }

    let vixCorrData = null;
    let vixCorrChart = null;
    let vixCorrChartBank = null;
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

    // NSE trading hours: 9:15 AM - 3:30 PM IST, Monday-Friday. Used to stop
    // the Spot vs PCR chart from growing once the market has closed for the day.
    function isMarketOpenNow() {
      const now = new Date();
      const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const ist = new Date(istString);
      const day = ist.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) return false;
      const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
      return minutesSinceMidnight >= (9 * 60 + 15) && minutesSinceMidnight <= (15 * 60 + 30);
    }

    function recordPcrPoint(symbol, indexData) {
      if (!indexData || indexData.error) return;
      if (indexData.current == null || indexData.pcr == null) return;
      if (!isMarketOpenNow()) return; // market closed — stop growing the chart
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

    function isDuringMarketHours(date) {
      const istString = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const ist = new Date(istString);
      const day = ist.getDay();
      if (day === 0 || day === 6) return false;
      const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
      return minutesSinceMidnight >= (9 * 60 + 15) && minutesSinceMidnight <= (15 * 60 + 30);
    }

    function mergeServerHistory(serverHistory) {
      if (!Array.isArray(serverHistory)) return;
      const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
      for (const snapshot of serverHistory) {
        const time = new Date(snapshot.timestamp);
        if (Number.isNaN(time.getTime())) continue;
        if (!isDuringMarketHours(time)) continue; // skip after-hours/weekend points
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
    // Tracks the last-seen straddle (CE+PE) value per strike, so the small
    // arrow can show direction without needing every underlying number.
    const lastStraddle = {};

    // BankNifty round-number alert — fires when spot crosses a 100-level
    // (minor) or 500-level (major, more psychologically significant),
    // tagged with OI sentiment and PDH/PDL proximity.
    const lastBankNiftyRoundLevel = { value: null };

    function checkRoundCross(prev, current, step) {
      const prevLevel = Math.floor(prev / step) * step;
      const currentLevel = Math.floor(current / step) * step;
      if (prevLevel === currentLevel) return null;
      const direction = current > prev ? 'up' : 'down';
      const crossedLevel = direction === 'up' ? currentLevel : prevLevel;
      return { crossedLevel, direction };
    }

    function renderRoundNumberAlert(indexData) {
      if (!indexData || indexData.symbol !== 'BANKNIFTY' || indexData.error) return '';
      const current = indexData.current;
      if (!current) return '';

      const prev = lastBankNiftyRoundLevel.value;
      lastBankNiftyRoundLevel.value = current;
      if (prev == null) return '';

      const cross500 = checkRoundCross(prev, current, 500);
      const cross100 = checkRoundCross(prev, current, 100);
      if (!cross500 && !cross100) return '';

      const major = cross500 != null;
      const crossInfo = major ? cross500 : cross100;
      const color = crossInfo.direction === 'up' ? 'var(--green)' : 'var(--red)';
      const arrow = crossInfo.direction === 'up' ? '▲' : '▼';

      const gs = indexData.gapScore;
      let oiSentiment = 'Neutral';
      if (gs && gs.fullChainPcr != null) {
        if (gs.fullChainPcr > 1.1) oiSentiment = 'Bullish (Put writing)';
        else if (gs.fullChainPcr < 0.85) oiSentiment = 'Bearish (Call writing)';
      }

      let pdhPdlNote = '';
      if (indexData.pdh > 0 && current >= indexData.pdh * 0.998) pdhPdlNote = ' · also near PDH (' + indexData.pdh.toFixed(0) + ')';
      else if (indexData.pdl > 0 && current <= indexData.pdl * 1.002) pdhPdlNote = ' · also near PDL (' + indexData.pdl.toFixed(0) + ')';

      let html = '<div class="premium-card" style="margin-bottom:16px; border: 2px solid ' + color + ';">';
      html += '<div style="color:' + color + '; font-size:1rem; font-weight:700;">' + arrow + ' ' + (major ? '🔔 MAJOR Round Number Alert' : 'Round Number Alert') + '</div>';
      html += '<div style="color:' + color + '; font-weight:700; margin-top:4px;">BankNifty crossed ' + crossInfo.crossedLevel + ' (' + (crossInfo.direction === 'up' ? 'upward' : 'downward') + ')</div>';
      html += '<div style="color:var(--muted); font-size:0.8rem; margin-top:4px;">OI Sentiment: ' + oiSentiment + pdhPdlNote + '</div>';
      html += '</div>';
      return html;
    }

    function straddleArrow(key, currentValue) {
      const prev = lastStraddle[key];
      lastStraddle[key] = currentValue;
      if (prev == null || currentValue === prev) return { arrow: '●', color: 'var(--muted)' };
      return currentValue > prev
        ? { arrow: '▲', color: 'var(--green)' }
        : { arrow: '▼', color: 'var(--red)' };
    }

    // A deliberately low-clutter card: one big number per strike (CE+PE
    // straddle) instead of a dense grid of bid/ask/IV/OI/day-high/day-low.
    // Only shown for NIFTY and SENSEX (BankNifty is excluded from CE/PE
    // premium tracking per the dashboard spec), using the current week expiry.
    function renderStraddlePcrCard(indexData) {
      if (!indexData || (indexData.symbol !== 'NIFTY' && indexData.symbol !== 'SENSEX')) return '';
      if (indexData.error || !indexData.expiries) return '';

      const exp = indexData.expiries.find((e) => e.expiry === 'Current Expiry');
      if (!exp || !exp.ceStrikes || !exp.peStrikes) return '';

      const strikeMap = new Map();
      exp.ceStrikes.forEach((s) => {
        strikeMap.set(s.strike, { strike: s.strike, isAtm: s.isAtm, ce: s.lastPrice, pe: null });
      });
      exp.peStrikes.forEach((s) => {
        const existing = strikeMap.get(s.strike);
        if (existing) existing.pe = s.lastPrice;
        else strikeMap.set(s.strike, { strike: s.strike, isAtm: s.isAtm, ce: null, pe: s.lastPrice });
      });

      const rows = Array.from(strikeMap.values())
        .filter((r) => r.ce != null && r.pe != null)
        .sort((a, b) => a.strike - b.strike);
      if (rows.length === 0) return '';

      const pcrTilt = indexData.pcr != null
        ? (indexData.pcr > 1.1 ? { label: 'Bullish Tilt', color: 'var(--green)' } : indexData.pcr < 0.85 ? { label: 'Bearish Tilt', color: 'var(--red)' } : { label: 'Neutral', color: 'var(--muted)' })
        : { label: 'N/A', color: 'var(--muted)' };

      let html = '<div class="straddle-card">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">';
      html += '<div class="card-title" style="margin-bottom:0;">Straddle (CE+PE) — Current Week, ATM ±2</div>';
      html += '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + pcrTilt.color + ';">PCR ' + (indexData.pcr != null ? indexData.pcr.toFixed(2) : 'N/A') + ' — ' + pcrTilt.label + '</span>';
      html += '</div>';

      html += '<div class="straddle-strip">';
      rows.forEach((r, idx) => {
        const straddleValue = r.ce + r.pe;
        const key = indexData.symbol + '_straddle_' + r.strike;
        const arrowInfo = straddleArrow(key, straddleValue);
        html += '<div class="straddle-box' + (r.isAtm ? ' atm' : '') + '" style="animation-delay:' + (idx * 0.15) + 's;">';
        html += '<div class="straddle-strike-label">' + r.strike + (r.isAtm ? ' ATM' : '') + '</div>';
        html += '<div class="straddle-value flash">' + straddleValue.toFixed(0) + '</div>';
        html += '<div class="straddle-arrow" style="color:' + arrowInfo.color + ';">' + arrowInfo.arrow + '</div>';
        html += '</div>';
      });
      html += '</div>';

      html += '<div class="timestamp" style="margin-top:8px;">Straddle = CE LTP + PE LTP at each strike. Rising straddle = market pricing in bigger moves either way; PCR tilt hints at which side options writers favor.</div>';
      html += '</div>';
      return html;
    }

    // NIFTY/SENSEX Weekly Expiry Sentiment Board — traffic lights (red/yellow/green,
    // continuously blinking) per weekly expiry, reusing the same OI+Price+IV
    // buildup classification already used elsewhere.
    function buildupImpactNote(label) {
      if (label.indexOf('Long Buildup') !== -1) return 'fresh buying';
      if (label.indexOf('Short Buildup') !== -1) return 'fresh selling';
      if (label.indexOf('Short Covering') !== -1) return 'shorts exiting';
      if (label.indexOf('Long Unwinding') !== -1) return 'longs exiting';
      return 'no clear buildup';
    }

    function renderSentimentBoard(indexData) {
      if (!indexData || (indexData.symbol !== 'NIFTY' && indexData.symbol !== 'SENSEX') || indexData.error || !indexData.expiries) return '';

      const expiryOrder = ['Current Expiry', 'Next Expiry', 'Next of Next Expiry', 'Monthly'];
      const boardRows = [];

      expiryOrder.forEach((expiryName) => {
        const exp = indexData.expiries.find((e) => e.expiry === expiryName);
        if (!exp) return;
        const strikes = sentimentSide === 'CE' ? exp.ceStrikes : exp.peStrikes;
        const atm = (strikes || []).find((s) => s.isAtm);
        if (!atm || !atm.lastPrice) return;

        const key = indexData.symbol + '_' + expiryName + '_' + sentimentSide + '_sentimentboard';
        const oiInfo = oiArrowInfo(key, atm.oi);
        const priceDir = priceDirection(key + '_price', atm.lastPrice);
        const ivDir = ivDirection(key + '_iv', atm.iv);
        const buildup = classifyBuildup(priceDir, oiInfo.cls, ivDir);

        let dotColor, signalArrow;
        if (buildup.verdict === 'BUY') { dotColor = 'var(--green)'; signalArrow = '▲'; }
        else if (buildup.verdict === 'SELL') { dotColor = 'var(--red)'; signalArrow = '▼'; }
        else { dotColor = 'var(--gold)'; signalArrow = '●'; } // halting / WAIT

        boardRows.push({ expiryName, atm, buildup, dotColor, signalArrow, oiInfo });
      });

      if (boardRows.length === 0) return '';

      const greenCount = boardRows.filter((r) => r.buildup.verdict === 'BUY').length;
      const redCount = boardRows.filter((r) => r.buildup.verdict === 'SELL').length;
      const total = boardRows.length;
      let scoreLabel, scoreColor, scorePct;
      if (greenCount > redCount) { scoreLabel = 'Bullish (' + greenCount + '/' + total + ' green)'; scoreColor = 'var(--green)'; scorePct = (greenCount / total) * 100; }
      else if (redCount > greenCount) { scoreLabel = 'Bearish (' + redCount + '/' + total + ' red)'; scoreColor = 'var(--red)'; scorePct = (redCount / total) * 100; }
      else { scoreLabel = 'Halting / Mixed'; scoreColor = 'var(--gold)'; scorePct = 50; }

      let html = '<div class="premium-card" style="margin-bottom:16px; border: 2px solid var(--gold-soft);">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">';
      html += '<div class="card-title" style="margin-bottom:0;">🚦 ' + indexData.symbol + ' Weekly Expiry Sentiment Board</div>';
      html += '<div class="toggle-btn-group">';
      html += '<button class="' + (sentimentSide === 'CE' ? 'active' : '') + '" onclick="toggleSentimentSide(\\'CE\\')">CE</button>';
      html += '<button class="' + (sentimentSide === 'PE' ? 'active' : '') + '" onclick="toggleSentimentSide(\\'PE\\')">PE</button>';
      html += '</div>';
      html += '</div>';

      boardRows.forEach((r) => {
        const impactNote = buildupImpactNote(r.buildup.label);
        html += '<div class="sentiment-row" style="flex-direction:column; align-items:stretch;">';
        html += '<div style="display:flex; align-items:center; gap:8px;">';
        html += '<span class="traffic-dot" style="background:' + r.dotColor + '; color:' + r.dotColor + ';"></span>';
        html += '<span style="color: var(--text); flex:1; font-size:0.82rem;">' + r.expiryName + ' (' + r.atm.strike + ')</span>';
        html += '<span style="color:' + r.dotColor + '; font-weight:700; font-size:0.85rem;">' + r.signalArrow + '</span>';
        html += '<span style="color:' + r.dotColor + '; font-weight:700; font-size:0.78rem;">' + r.buildup.label + '</span>';
        html += '</div>';
        html += '<div style="color: var(--muted-dim); font-size:0.68rem; padding-left:22px;">' + impactNote + ' · OI ' + (r.atm.oi != null ? r.atm.oi.toLocaleString('en-IN') : '—') + ' ' + r.oiInfo.arrow + '</div>';
        html += '</div>';
      });

      html += '<div class="gap-score-bar-track" style="margin-top:10px;"><div class="gap-score-bar-fill" style="width:' + scorePct + '%; background:' + scoreColor + ';"></div></div>';
      html += '<div style="text-align:center; color:' + scoreColor + '; font-weight:700; font-size:0.85rem; margin-top:4px;">Sentiment Score: ' + scoreLabel + '</div>';

      html += '<div class="timestamp">Signal derived from OI + price + IV buildup, per ATM strike of each expiry. Not investment advice.</div>';
      html += '</div>';
      return html;
    }

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

    function updateUI() {
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((symbol) => {
        const el = document.getElementById(symbol);
        if (el) el.innerHTML = renderIndexPage(symbol);
      });

      document.getElementById('NEWS').innerHTML = renderNews();
      document.getElementById('HOLIDAYS').innerHTML = renderHolidays();
      document.getElementById('COMMODITIES').innerHTML = renderCommodities();
      document.getElementById('FIIDII').innerHTML = renderFiiDii();
      document.getElementById('VERDICT').innerHTML = renderVerdict();
      document.getElementById('CONTEXT').innerHTML = renderContext();
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

      html += renderRoundNumberAlert(indexData);

      html += renderGapScoreCard(indexData);

      html += renderBiasCheckWidget(indexData);

      html += renderStraddlePcrCard(indexData);

      html += renderSentimentBoard(indexData);

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
          html += '<div class="expiry-title">' + exp.expiry + ' Expiry — ATM ±' + (indexData.symbol === 'BANKNIFTY' ? '6' : '2') + ' Strikes</div>';
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
      if (prev == null) return { arrow: '●', cls: 'flat', delta: null };
      const delta = currentOi - prev;
      if (delta === 0) return { arrow: '●', cls: 'flat', delta: 0 };
      return delta > 0
        ? { arrow: '▲', cls: 'up', delta }
        : { arrow: '▼', cls: 'down', delta };
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

    // Tracks the last-seen IV per strike (same key scheme as OI/price) so
    // buildup signals can be weighted by whether IV is confirming the move.
    const lastIv = {};

    function ivDirection(key, currentIv) {
      const prev = lastIv[key];
      lastIv[key] = currentIv;
      if (prev == null || currentIv === prev) return 'flat';
      return currentIv > prev ? 'up' : 'down';
    }

    // Primes the OI/price/IV trackers from the server's remembered previous
    // values, once per page load — so a browser refresh doesn't show
    // "No Data Yet" on every strike just because the in-memory JS trackers
    // reset. Only fills in keys not already tracked, so it never overwrites
    // a live in-session reading with a stale server-remembered one.
    let strikeTrackersPrimed = false;
    function primeStrikeTrackersFromServer(prevValues) {
      if (strikeTrackersPrimed || !prevValues) return;
      strikeTrackersPrimed = true;
      Object.keys(prevValues).forEach((key) => {
        const v = prevValues[key];
        if (!(key in lastOi)) lastOi[key] = v.oi;
        if (!((key + '_price') in lastStrikePrice)) lastStrikePrice[key + '_price'] = v.price;
        if (!((key + '_iv') in lastIv)) lastIv[key + '_iv'] = v.iv;
      });
    }

    // Classic OI-buildup classification, used to generate a per-strike
    // BUY/SELL/WAIT verdict: Long Buildup (price up + OI up) = fresh buying,
    // Short Buildup (price down + OI up) = fresh selling, OI down in either
    // direction = covering/unwinding = weak/no-buildup signal.
    // VERDICT tab — combines data already computed elsewhere (signal,
    // futuresVwapBias, Gap Score) into per-index bias + one overall combined
    // verdict. Weighting is NIFTY 40% / BANKNIFTY 30% / SENSEX 30% —
    // deliberately not an equal 33/33/33 split (spec rule), documented here
    // rather than hidden.
    function classifyIndexOverallBias(m) {
      if (!m || m.error) return 'DATA UNAVAILABLE';
      const gs = m.gapScore;
      const score = gs ? gs.score : 0;
      if (m.signal === 'BUY' && score > 50) return 'STRONG CE BIAS';
      if (m.signal === 'BUY') return 'MILD CE BIAS';
      if (m.signal === 'SELL' && score < -50) return 'STRONG PE BIAS';
      if (m.signal === 'SELL') return 'MILD PE BIAS';
      if (gs && Math.abs(score) < 10) return 'SIDEWAYS / RANGE';
      return 'WAIT — CONFLICTING DATA';
    }

    function biasToScore(bias) {
      if (bias === 'STRONG CE BIAS') return 2;
      if (bias === 'MILD CE BIAS') return 1;
      if (bias === 'STRONG PE BIAS') return -2;
      if (bias === 'MILD PE BIAS') return -1;
      return 0;
    }

    function scoreToOverallBias(score) {
      if (score >= 1.5) return 'STRONG CE BIAS';
      if (score >= 0.5) return 'MILD CE BIAS';
      if (score <= -1.5) return 'STRONG PE BIAS';
      if (score <= -0.5) return 'MILD PE BIAS';
      return 'SIDEWAYS / RANGE';
    }

    function biasColorFor(bias) {
      if (bias === 'STRONG CE BIAS' || bias === 'MILD CE BIAS') return 'var(--green)';
      if (bias === 'STRONG PE BIAS' || bias === 'MILD PE BIAS') return 'var(--red)';
      if (bias === 'DATA UNAVAILABLE' || bias === 'WAIT — CONFLICTING DATA') return 'var(--muted)';
      return 'var(--gold)';
    }

    function renderVerdictIndexCard(symbol, m) {
      const bias = classifyIndexOverallBias(m);
      const color = biasColorFor(bias);
      let html = '<div class="verdict-index-card">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
      html += '<span style="color:var(--text); font-weight:700;">' + symbol + '</span>';
      html += '<span class="badge-pill" style="background:rgba(0,0,0,0.2); color:' + color + '; font-size:0.7rem;">' + bias + '</span>';
      html += '</div>';
      if (m && !m.error) {
        html += '<div style="color:var(--muted); font-size:0.72rem; margin-top:6px;">Futures: ' + (m.futuresVwapBias === 'UP' ? 'Long Buildup' : m.futuresVwapBias === 'DOWN' ? 'Short Buildup' : 'DATA UNAVAILABLE') + '</div>';
        html += '<div style="color:var(--muted); font-size:0.72rem;">Options: ' + (m.pcr != null ? (m.pcr > 1.1 ? 'Put Writing (Bullish)' : m.pcr < 0.85 ? 'Call Writing (Bearish)' : 'Balanced') : 'DATA UNAVAILABLE') + '</div>';
      } else {
        html += '<div style="color:var(--muted); font-size:0.72rem; margin-top:6px;">DATA UNAVAILABLE</div>';
      }
      html += '</div>';
      return html;
    }

    function renderVerdict() {
      if (!data) return '<div class="loading">Loading verdict...</div>';

      let html = '';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += renderVerdictIndexCard(sym, data[sym]);
      });

      const anyError = ['NIFTY', 'BANKNIFTY', 'SENSEX'].some((sym) => !data[sym] || data[sym].error);
      let combinedBias, finalAction, alignedCount = 0, conflictingCount = 0;

      if (anyError) {
        combinedBias = 'DATA UNAVAILABLE';
        finalAction = 'DATA UNAVAILABLE';
      } else {
        const niftyBias = classifyIndexOverallBias(data.NIFTY);
        const bankBias = classifyIndexOverallBias(data.BANKNIFTY);
        const sensexBias = classifyIndexOverallBias(data.SENSEX);
        const weighted = biasToScore(niftyBias) * 0.4 + biasToScore(bankBias) * 0.3 + biasToScore(sensexBias) * 0.3;
        combinedBias = scoreToOverallBias(weighted);

        const scores = [biasToScore(niftyBias), biasToScore(bankBias), biasToScore(sensexBias)];
        const positive = scores.filter((s) => s > 0).length;
        const negative = scores.filter((s) => s < 0).length;
        alignedCount = Math.max(positive, negative);
        conflictingCount = 3 - alignedCount - scores.filter((s) => s === 0).length;

        if (combinedBias === 'STRONG CE BIAS' || combinedBias === 'MILD CE BIAS') finalAction = 'CE CONFIRMED';
        else if (combinedBias === 'STRONG PE BIAS' || combinedBias === 'MILD PE BIAS') finalAction = 'PE CONFIRMED';
        else if (conflictingCount >= 2) finalAction = 'CONFLICTING DATA — WAIT';
        else finalAction = 'SIDEWAYS — NO TRADE';
      }

      const color = biasColorFor(combinedBias);
      html += '<div class="verdict-overall-card">';
      html += '<div style="color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px;">Overall Market Verdict</div>';
      html += '<div style="color:' + color + '; font-size:1.2rem; font-weight:700; margin:4px 0;">' + combinedBias + '</div>';
      if (!anyError) {
        html += '<div style="color:var(--muted); font-size:0.72rem;">Aligned: ' + alignedCount + ' · Conflicting: ' + conflictingCount + '</div>';
        html += '<div style="color:' + color + '; font-weight:700; font-size:0.85rem; margin-top:8px;">Final: ' + finalAction + '</div>';
      } else {
        html += '<div style="color:var(--muted); font-size:0.75rem;">One or more indices failed to load — verdict withheld per data-safety rules.</div>';
      }
      html += '<div style="color:var(--muted-dim); font-size:0.62rem; margin-top:6px; font-family:var(--font-mono);">Weighting: NIFTY 40% / BANKNIFTY 30% / SENSEX 30% (not equal-thirds) · as of ' + new Date().toLocaleTimeString() + '</div>';
      html += '</div>';

      return html;
    }

    // Per-index page — spec section 5: NIFTY/BANKNIFTY/SENSEX all share the
    // same 4 internal tabs (OVERVIEW/FUTURES/OPTIONS/ALIGNMENT) and layout.
    let indexInternalTab = { NIFTY: 'OVERVIEW', BANKNIFTY: 'OVERVIEW', SENSEX: 'OVERVIEW' };

    // ALIGNMENT tab — lazy-loaded per index (only fetched once its chip is opened).
    let indexStocksData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };
    let indexStocksLoading = { NIFTY: false, BANKNIFTY: false, SENSEX: false };
    async function loadIndexStocks(symbol) {
      if (indexStocksLoading[symbol] || indexStocksData[symbol] || !kiteConnected) return;
      indexStocksLoading[symbol] = true;
      try {
        const response = await fetch('/api/index-stocks?symbol=' + symbol);
        const json = await response.json();
        indexStocksData[symbol] = response.ok ? json : { error: json.error || 'Failed to load constituent data' };
        updateUI();
      } catch (err) {
        console.error('Failed to load index stocks:', err);
        indexStocksData[symbol] = { error: err.message };
      } finally {
        indexStocksLoading[symbol] = false;
      }
    }

    function renderAlignmentTab(symbol, m) {
      if (!indexStocksData[symbol]) {
        loadIndexStocks(symbol);
        return '<div class="loading">Loading constituent data...</div>';
      }
      if (indexStocksData[symbol].error) {
        return '<div class="error">⚠️ ' + escapeHtml(indexStocksData[symbol].error) + '</div>';
      }
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Key Stocks (unweighted)</div>';
      indexStocksData[symbol].stocks.forEach((s) => {
        const color = s.change == null ? 'var(--muted)' : s.change >= 0.5 ? 'var(--green)' : s.change <= -0.5 ? 'var(--red)' : 'var(--muted)';
        const label = s.change == null ? 'DATA UNAVAILABLE' : s.change >= 0.5 ? 'Bullish' : s.change <= -0.5 ? 'Bearish' : 'Neutral';
        const valueText = (s.price != null ? s.price.toFixed(2) : 'DATA UNAVAILABLE') + (s.change != null ? ' (' + (s.change >= 0 ? '+' : '') + s.change.toFixed(2) + '%)' : '') + ' · Vol ' + (s.volume != null ? formatVolume(s.volume) : 'DATA UNAVAILABLE');
        html += renderAlignRow(s.name, valueText, label, s.change == null ? 'neutral' : s.change >= 0.5 ? 'bullish' : s.change <= -0.5 ? 'bearish' : 'neutral');
      });
      html += '</div>';
      html += '<div class="timestamp">Contribution Impact (Stock Return \u00d7 Index Weight) is not shown — Kite does not publish live constituent weights, and this dashboard does not hardcode them per the spec\u2019s own rule. Advance/decline and volume participation across the full constituent list are not yet tracked — DATA UNAVAILABLE for those.</div>';
      return html;
    }

    function switchIndexInternalTab(symbol, tab) {
      indexInternalTab[symbol] = tab;
      updateUI();
    }

    function rowLine(label, value) {
      const isUnavailable = value === 'DATA UNAVAILABLE';
      return '<div class="card-item"><span class="card-label">' + escapeHtml(label) + '</span><span class="card-value' + (isUnavailable ? ' unavailable' : '') + '">' + escapeHtml(String(value)) + '</span></div>';
    }

    function renderCorrelationStrip() {
      if (!data) return '';
      let html = '<div class="premium-card"><div class="card-title">Correlation Strip</div><div style="display:flex; gap:8px; flex-wrap:wrap;">';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const m = data[sym];
        const bias = classifyIndexOverallBias(m);
        const color = biasColorFor(bias);
        html += '<span class="badge-pill" style="background:rgba(0,0,0,0.2); color:' + color + '; font-size:0.7rem;">' + sym + ': ' + bias + '</span>';
      });
      html += '</div></div>';
      return html;
    }

    // FUTURES tab — spec section 7. Classification: price up + OI up = LONG
    // BUILD-UP, price down + OI up = SHORT BUILD-UP, price up + OI down =
    // SHORT COVERING, price down + OI down = LONG UNWINDING. Uses a fresh
    // per-contract price/OI tracker (separate key space from other tabs).
    const lastFuturesValue = {};
    function futuresDirection(key, current) {
      const prev = lastFuturesValue[key];
      lastFuturesValue[key] = current;
      if (prev == null || current === prev) return 'flat';
      return current > prev ? 'up' : 'down';
    }

    function classifyFuturesBuildup(priceDir, oiDir) {
      if (priceDir === 'up' && oiDir === 'up') return { label: 'LONG BUILD-UP', note: 'Fresh bullish participation — CE supportive', color: 'var(--green)' };
      if (priceDir === 'down' && oiDir === 'up') return { label: 'SHORT BUILD-UP', note: 'Fresh bearish participation — PE supportive', color: 'var(--red)' };
      if (priceDir === 'up' && oiDir === 'down') return { label: 'SHORT COVERING', note: 'Bullish move but may be temporary — not strong CE without more confirmation', color: 'var(--gold)' };
      if (priceDir === 'down' && oiDir === 'down') return { label: 'LONG UNWINDING', note: 'Bearish weakness but may be temporary — not strong PE without more confirmation', color: 'var(--gold)' };
      return { label: 'NO CLEAR SIGNAL', note: 'Not enough data yet this session', color: 'var(--muted)' };
    }

    function renderFuturesContractCard(symbol, contract) {
      const key = symbol + '_' + contract.tradingsymbol;
      const priceDir = futuresDirection(key + '_price', contract.ltp);
      const oiDir = contract.oi != null ? futuresDirection(key + '_oi', contract.oi) : 'flat';
      const buildup = classifyFuturesBuildup(priceDir, oiDir);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
      html += '<span style="color:var(--gold); font-weight:700; font-size:0.8rem;">' + contract.label + ' Month — ' + escapeHtml(contract.tradingsymbol) + '</span>';
      html += '<span class="badge-pill" style="background:rgba(0,0,0,0.2); color:' + buildup.color + '; font-size:0.68rem;">' + buildup.label + '</span>';
      html += '</div>';
      html += rowLine('LTP', contract.ltp ? contract.ltp.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Change %', contract.ltp ? (contract.changePercent >= 0 ? '+' : '') + contract.changePercent.toFixed(2) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('Open / High / Low', (contract.dayOpen ? contract.dayOpen.toFixed(2) : '—') + ' / ' + (contract.dayHigh ? contract.dayHigh.toFixed(2) : '—') + ' / ' + (contract.dayLow ? contract.dayLow.toFixed(2) : '—'));
      html += rowLine('OI', contract.oi != null ? contract.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
      html += rowLine('Volume', contract.volume != null ? contract.volume.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
      html += rowLine('Basis (Fut − Spot)', contract.basis != null ? (contract.basis >= 0 ? '+' : '') + contract.basis.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('15m / 30m / 1h State', 'DATA UNAVAILABLE');
      html += '<div style="color:var(--muted-dim); font-size:0.68rem; margin-top:6px;">' + buildup.note + '</div>';
      html += '</div>';
      return html;
    }

    function renderFuturesTab(symbol, m) {
      if (!m.futuresContracts || m.futuresContracts.length === 0) {
        return '<div class="loading">DATA UNAVAILABLE — no active futures contracts found.</div>';
      }
      let html = '';
      m.futuresContracts.forEach((c) => {
        html += renderFuturesContractCard(symbol, c);
      });
      html += '<div class="timestamp">PROVISIONAL — REQUIRES BACKTEST: buildup classification uses simple price/OI direction since last refresh, with no noise-filter thresholds yet. Rollover-period OI-transfer tracking is not yet implemented.</div>';
      return html;
    }

    // 15m/30m/1h trend — uses the spot-price history already accumulated in
    // pcrHistory (populated from server snapshotHistory + live refreshes).
    // Returns null (→ DATA UNAVAILABLE) until enough history exists.
    function computeTimeframeTrend(symbol, minutesAgo) {
      const hist = pcrHistory[symbol];
      if (!hist || hist.length < 2) return null;
      const now = new Date();
      const targetTime = new Date(now.getTime() - minutesAgo * 60000);
      let closest = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].time <= targetTime) { closest = hist[i]; break; }
      }
      if (!closest) return null; // history doesn't go back far enough yet
      const current = hist[hist.length - 1];
      if (current.spot > closest.spot) return 'up';
      if (current.spot < closest.spot) return 'down';
      return 'flat';
    }

    function renderTimeframeTrendRow(symbol) {
      const fmt = (t) => t == null ? 'DATA UNAVAILABLE' : (t === 'up' ? '▲ Up' : t === 'down' ? '▼ Down' : '● Flat');
      const t15 = fmt(computeTimeframeTrend(symbol, 15));
      const t30 = fmt(computeTimeframeTrend(symbol, 30));
      const t60 = fmt(computeTimeframeTrend(symbol, 60));
      if (t15 === 'DATA UNAVAILABLE' && t30 === 'DATA UNAVAILABLE' && t60 === 'DATA UNAVAILABLE') return 'DATA UNAVAILABLE';
      return '15m: ' + t15 + '  ·  30m: ' + t30 + '  ·  1h: ' + t60;
    }

    function renderOverviewTab(symbol, m) {
      const prevClose = m.current - m.change;
      const distVwap = m.vwap > 0 ? m.current - m.vwap : null;
      const distPdh = m.pdh > 0 ? m.current - m.pdh : null;
      const distPdl = m.pdl > 0 ? m.current - m.pdl : null;
      const gapDir = m.gapScore ? (m.gapScore.components.gapDirection > 0 ? 'Gap Up' : m.gapScore.components.gapDirection < 0 ? 'Gap Down' : 'Flat') : 'DATA UNAVAILABLE';

      // Gap % = (Today Open - Previous Close) / Previous Close × 100 — spec section 18.
      // Thresholds are provisional (not yet backtested).
      let gapPctText = 'DATA UNAVAILABLE';
      if (m.dayOpen > 0 && prevClose > 0) {
        const gapPct = ((m.dayOpen - prevClose) / prevClose) * 100;
        const absGap = Math.abs(gapPct);
        let gapLabel;
        if (absGap < 0.1) gapLabel = 'Flat';
        else if (absGap < 0.3) gapLabel = 'Small Gap';
        else if (absGap < 0.75) gapLabel = 'Medium Gap';
        else if (absGap < 1.5) gapLabel = 'Large Gap';
        else gapLabel = 'Extreme Gap';
        gapPctText = (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) + '% (' + gapLabel + ', PROVISIONAL)';
      }

      // Market structure — compares today's high/low against PDH/PDL.
      let structureText = 'DATA UNAVAILABLE';
      if (m.dayHigh > 0 && m.dayLow > 0 && m.pdh > 0 && m.pdl > 0) {
        if (m.dayHigh > m.pdh && m.dayLow > m.pdl) structureText = 'Higher-High / Higher-Low';
        else if (m.dayHigh < m.pdh && m.dayLow < m.pdl) structureText = 'Lower-High / Lower-Low';
        else if (m.dayHigh <= m.pdh && m.dayLow >= m.pdl) structureText = 'Inside Previous Range';
        else structureText = 'Outside Previous Range (volatile)';
        if (m.current > m.pdh) structureText += ' · Breakout';
        else if (m.current < m.pdl) structureText += ' · Breakdown';
      }

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Spot & Change</div>';
      html += rowLine('Spot LTP', m.current.toFixed(2));
      html += rowLine('Change', (m.change >= 0 ? '+' : '') + m.change.toFixed(2) + ' (' + (m.changePercent >= 0 ? '+' : '') + m.changePercent.toFixed(2) + '%)');
      html += rowLine('Previous Close', prevClose.toFixed(2));
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Levels</div>';
      html += rowLine('PDH', m.pdh ? m.pdh.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('PDL', m.pdl ? m.pdl.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Futures VWAP', m.vwap ? m.vwap.toFixed(2) + ' (' + m.vwapSource + ')' : 'DATA UNAVAILABLE');
      html += rowLine('Distance from VWAP', distVwap != null ? (distVwap >= 0 ? '+' : '') + distVwap.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Distance from PDH', distPdh != null ? (distPdh >= 0 ? '+' : '') + distPdh.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Distance from PDL', distPdl != null ? (distPdl >= 0 ? '+' : '') + distPdl.toFixed(2) : 'DATA UNAVAILABLE');
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Gap & Structure</div>';
      html += rowLine('Gap Direction', gapDir);
      html += rowLine('Gap %', gapPctText);
      html += rowLine('Day Open / High / Low', m.dayOpen ? m.dayOpen.toFixed(2) + ' / ' + m.dayHigh.toFixed(2) + ' / ' + m.dayLow.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Market Structure', structureText);
      html += rowLine('First 15m High / Low', m.first15High > 0 ? m.first15High.toFixed(2) + ' / ' + m.first15Low.toFixed(2) + ' (sampled, not tick-level)' : 'DATA UNAVAILABLE');
      html += rowLine('15m / 30m / 1h Trend', renderTimeframeTrendRow(symbol));
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Volatility & Verdict</div>';
      html += rowLine('India VIX', m.vix ? m.vix.toFixed(2) + ' (' + (m.vixChangePercent >= 0 ? '+' : '') + m.vixChangePercent.toFixed(2) + '%)' : 'DATA UNAVAILABLE');
      html += rowLine('Immediate Support', m.pdl ? m.pdl.toFixed(2) + ' (PDL proxy)' : 'DATA UNAVAILABLE');
      html += rowLine('Immediate Resistance', m.pdh ? m.pdh.toFixed(2) + ' (PDH proxy)' : 'DATA UNAVAILABLE');
      html += rowLine('Current Verdict', classifyIndexOverallBias(m));
      html += '</div>';

      html += renderCorrelationStrip();

      html += '<div class="timestamp">First-15m High/Low is sampled at whatever refresh cadence is running (typically every few minutes), not true tick-by-tick data — treat as approximate. Gap % thresholds are PROVISIONAL — REQUIRES BACKTEST. 15m/30m/1h trend uses this session\u2019s accumulated spot history — shows DATA UNAVAILABLE until enough history builds up (up to 1 hour after the dashboard is first opened each day).</div>';
      return html;
    }

    // OPTIONS tab — spec section 8-13. PREMIUM and WALLS & PCR are built
    // from data already fetched elsewhere; CHAIN and EXPIRY need wider
    // strike-range fetching not yet implemented, so they're stubbed.
    let indexOptionsSubTab = { NIFTY: 'PREMIUM', BANKNIFTY: 'PREMIUM', SENSEX: 'PREMIUM' };
    function switchOptionsSubTab(symbol, sub) {
      indexOptionsSubTab[symbol] = sub;
      updateUI();
    }

    function renderOptionsPremium(symbol, m) {
      if (!m.expiries || m.expiries.length === 0) return '<div class="loading">DATA UNAVAILABLE</div>';
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">' + escapeHtml(exp.expiry) + ' — ATM Premium</div>';
      if (atmCe) {
        html += '<div class="fii-section-label">CE ' + atmCe.strike + '</div>';
        html += rowLine('LTP', atmCe.lastPrice.toFixed(2));
        html += rowLine('OI', atmCe.oi != null ? atmCe.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
        html += rowLine('IV', atmCe.iv ? atmCe.iv.toFixed(1) : 'DATA UNAVAILABLE');
        html += rowLine('Bid / Ask', atmCe.bid.toFixed(2) + ' / ' + atmCe.ask.toFixed(2));
        html += rowLine('Vega / Theta', (atmCe.vega ? atmCe.vega.toFixed(2) : '—') + ' / ' + (atmCe.theta ? atmCe.theta.toFixed(2) : '—'));
        html += rowLine('Delta', 'DATA UNAVAILABLE');
      }
      if (atmPe) {
        html += '<div class="fii-section-label">PE ' + atmPe.strike + '</div>';
        html += rowLine('LTP', atmPe.lastPrice.toFixed(2));
        html += rowLine('OI', atmPe.oi != null ? atmPe.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
        html += rowLine('IV', atmPe.iv ? atmPe.iv.toFixed(1) : 'DATA UNAVAILABLE');
        html += rowLine('Bid / Ask', atmPe.bid.toFixed(2) + ' / ' + atmPe.ask.toFixed(2));
        html += rowLine('Vega / Theta', (atmPe.vega ? atmPe.vega.toFixed(2) : '—') + ' / ' + (atmPe.theta ? atmPe.theta.toFixed(2) : '—'));
        html += rowLine('Delta', 'DATA UNAVAILABLE');
      }
      html += '</div>';
      html += '<div class="timestamp">5m/15m/30m/1h premium momentum and liquidity status are not yet tracked — DATA UNAVAILABLE rather than guessed.</div>';
      return html;
    }

    function renderOptionsExpiry(symbol, m) {
      if (!m.expiries || m.expiries.length === 0) return '<div class="loading">DATA UNAVAILABLE</div>';
      let html = '';
      m.expiries.forEach((exp) => {
        const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
        const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
        const straddle = (atmCe && atmPe) ? (atmCe.lastPrice + atmPe.lastPrice) : null;
        html += '<div class="premium-card" style="margin-bottom:12px;">';
        html += '<div class="card-title">' + escapeHtml(exp.expiry) + '</div>';
        html += rowLine('ATM Strike', atmCe ? atmCe.strike : (atmPe ? atmPe.strike : 'DATA UNAVAILABLE'));
        html += rowLine('ATM CE State', atmCe ? atmCe.lastPrice.toFixed(2) + ' (OI ' + (atmCe.oi != null ? atmCe.oi.toLocaleString('en-IN') : '—') + ')' : 'DATA UNAVAILABLE');
        html += rowLine('ATM PE State', atmPe ? atmPe.lastPrice.toFixed(2) + ' (OI ' + (atmPe.oi != null ? atmPe.oi.toLocaleString('en-IN') : '—') + ')' : 'DATA UNAVAILABLE');
        html += rowLine('ATM Straddle', straddle != null ? straddle.toFixed(2) : 'DATA UNAVAILABLE');
        html += rowLine('OI PCR / Max Pain', exp.expiry === 'Current Expiry' ? (m.pcr != null ? m.pcr.toFixed(3) : 'DATA UNAVAILABLE') + ' / ' + (m.maxPain ? m.maxPain.toFixed(0) : 'DATA UNAVAILABLE') : 'DATA UNAVAILABLE (only tracked for current-week expiry)');
        html += '</div>';
      });
      html += '<div class="timestamp">Change-in-OI PCR and Volume PCR, plus Call/Put Wall per expiry, are not yet tracked independently for each expiry — DATA UNAVAILABLE where not shown.</div>';
      return html;
    }

    function renderOptionsChain(symbol, m) {
      if (!m.expiries || m.expiries.length === 0) return '<div class="loading">DATA UNAVAILABLE</div>';
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const ceStrikes = exp.ceStrikes || [];
      const peStrikes = exp.peStrikes || [];

      let maxCallOiStrike = null, maxCallOi = -1;
      ceStrikes.forEach((s) => { if (s.oi != null && s.oi > maxCallOi) { maxCallOi = s.oi; maxCallOiStrike = s.strike; } });
      let maxPutOiStrike = null, maxPutOi = -1;
      peStrikes.forEach((s) => { if (s.oi != null && s.oi > maxPutOi) { maxPutOi = s.oi; maxPutOiStrike = s.strike; } });

      const strikesSet = new Set([...ceStrikes.map((s) => s.strike), ...peStrikes.map((s) => s.strike)]);
      const strikes = Array.from(strikesSet).sort((a, b) => a - b);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">' + escapeHtml(exp.expiry) + ' — Option Chain (ATM ±2)</div>';
      html += '<div class="table-scroll"><table style="width:100%; min-width:520px; font-family: var(--font-mono); font-size:0.7rem; border-collapse:collapse;">';
      html += '<thead><tr style="color:var(--muted-dim);"><th colspan="3" style="text-align:center; padding:3px;">CALL (CE)</th><th style="text-align:center; padding:3px;">Strike</th><th colspan="3" style="text-align:center; padding:3px;">PUT (PE)</th></tr>';
      html += '<tr style="color:var(--muted-dim);"><th style="text-align:right;">LTP</th><th style="text-align:right;">OI</th><th style="text-align:right;">IV</th><th></th><th style="text-align:right;">IV</th><th style="text-align:right;">OI</th><th style="text-align:right;">LTP</th></tr></thead><tbody>';

      strikes.forEach((strike) => {
        const ce = ceStrikes.find((s) => s.strike === strike);
        const pe = peStrikes.find((s) => s.strike === strike);
        const isAtm = (ce && ce.isAtm) || (pe && pe.isAtm);
        const rowStyle = (isAtm ? 'background: rgba(201,162,39,0.08); ' : '') + 'border-top:1px solid var(--border);';
        html += '<tr style="' + rowStyle + '">';
        html += '<td style="text-align:right; padding:3px; color:' + (strike === maxCallOiStrike ? 'var(--red)' : 'var(--text)') + ';">' + (ce ? ce.lastPrice.toFixed(2) : '—') + '</td>';
        html += '<td style="text-align:right; padding:3px; color:' + (strike === maxCallOiStrike ? 'var(--red)' : 'var(--muted)') + ';">' + (ce && ce.oi != null ? ce.oi.toLocaleString('en-IN') : '—') + (strike === maxCallOiStrike ? ' 🔴' : '') + '</td>';
        html += '<td style="text-align:right; padding:3px; color:var(--muted);">' + (ce && ce.iv ? ce.iv.toFixed(1) : '—') + '</td>';
        html += '<td style="text-align:center; padding:3px; color:' + (isAtm ? 'var(--gold)' : 'var(--text)') + '; font-weight:' + (isAtm ? '700' : '400') + ';">' + strike + '</td>';
        html += '<td style="text-align:right; padding:3px; color:var(--muted);">' + (pe && pe.iv ? pe.iv.toFixed(1) : '—') + '</td>';
        html += '<td style="text-align:right; padding:3px; color:' + (strike === maxPutOiStrike ? 'var(--green)' : 'var(--muted)') + ';">' + (pe && pe.oi != null ? pe.oi.toLocaleString('en-IN') : '—') + (strike === maxPutOiStrike ? ' 🟢' : '') + '</td>';
        html += '<td style="text-align:right; padding:3px; color:' + (strike === maxPutOiStrike ? 'var(--green)' : 'var(--text)') + ';">' + (pe ? pe.lastPrice.toFixed(2) : '—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div style="margin-top:8px; font-size:0.7rem; color:var(--muted);">🔴 Max Call OI: ' + (maxCallOiStrike != null ? maxCallOiStrike : 'N/A') + ' · 🟢 Max Put OI: ' + (maxPutOiStrike != null ? maxPutOiStrike : 'N/A') + '</div>';
      html += '</div>';
      html += '<div class="timestamp">Showing ATM ±2 (5 strikes) only — the spec\u2019s wider ATM ±10 detailed table and ATM ±20 background range need additional strike data not yet fetched. Max OI Addition and strongest writing/buying/covering/unwinding strikes are not yet tracked — DATA UNAVAILABLE for those.</div>';
      return html;
    }

    function renderOptionsWallsPcr(symbol, m) {
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">PCR & Max Pain</div>';
      html += rowLine('OI PCR (ATM ±7)', m.pcr != null ? m.pcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Volume PCR', m.volumePcr != null ? m.volumePcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Full-Chain PCR', m.gapScore && m.gapScore.fullChainPcr != null ? m.gapScore.fullChainPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Max Pain', m.maxPain ? m.maxPain.toFixed(0) : 'DATA UNAVAILABLE');
      html += '</div>';
      html += '<div class="timestamp">Call Wall / Put Wall (OI-based resistance/support strikes) and wall-movement history are not yet computed — DATA UNAVAILABLE.</div>';
      return html;
    }

    function renderOptionsTab(symbol, m) {
      const subs = [
        { key: 'PREMIUM', label: 'PREMIUM' },
        { key: 'CHAIN', label: 'CHAIN' },
        { key: 'EXPIRY', label: 'EXPIRY' },
        { key: 'WALLSPCR', label: 'WALLS & PCR' },
      ];
      let html = '<div class="chip-nav">';
      subs.forEach((s) => {
        html += '<button class="' + (indexOptionsSubTab[symbol] === s.key ? 'active' : '') + '" onclick="switchOptionsSubTab(' + "'" + symbol + "'" + ',' + "'" + s.key + "'" + ')">' + s.label + '</button>';
      });
      html += '</div>';

      const sub = indexOptionsSubTab[symbol];
      if (sub === 'PREMIUM') html += renderOptionsPremium(symbol, m);
      else if (sub === 'CHAIN') html += renderOptionsChain(symbol, m);
      else if (sub === 'EXPIRY') html += renderOptionsExpiry(symbol, m);
      else if (sub === 'WALLSPCR') html += renderOptionsWallsPcr(symbol, m);
      else html += '<div class="loading">' + escapeHtml(sub) + ' — coming in a future step.</div>';
      return html;
    }

    // CONTEXT tab — spec section 15-19. PREVIOUS/GAP CHECK/MACRO-VIX/SIGNAL
    // REVIEW reuse data + cards already computed elsewhere; FII-DII reuses
    // the existing manual-entry tab wholesale.
    let contextInternalTab = 'PREVIOUS';
    function switchContextTab(tab) {
      contextInternalTab = tab;
      updateUI();
    }

    function renderContextPrevious() {
      if (!data) return '<div class="loading">Loading...</div>';
      let html = '';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const m = data[sym];
        html += '<div class="premium-card" style="margin-bottom:12px;">';
        html += '<div class="card-title">' + sym + ' — Previous Day</div>';
        if (m && !m.error) {
          html += rowLine('Previous Close', (m.current - m.change).toFixed(2));
          html += rowLine('Previous High (PDH)', m.pdh ? m.pdh.toFixed(2) : 'DATA UNAVAILABLE');
          html += rowLine('Previous Low (PDL)', m.pdl ? m.pdl.toFixed(2) : 'DATA UNAVAILABLE');
          html += rowLine('Previous VIX Close', 'DATA UNAVAILABLE');
          html += rowLine('Previous Verdict', 'DATA UNAVAILABLE');
        } else {
          html += rowLine('Status', 'DATA UNAVAILABLE');
        }
        html += '</div>';
      });
      html += '<div class="timestamp">Previous Call Wall / Put Wall / Max Pain and day-over-day verdict history are not yet stored — DATA UNAVAILABLE rather than guessed.</div>';
      return html;
    }

    function renderContextGapCheck() {
      if (!data) return '<div class="loading">Loading...</div>';
      let html = '';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const m = data[sym];
        if (m && !m.error) html += renderGapScoreCard(m);
      });
      return html || '<div class="loading">DATA UNAVAILABLE</div>';
    }

    function renderContextMacroVix() {
      if (!data || !data.NIFTY) return '<div class="loading">Loading...</div>';
      const m = data.NIFTY;
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">India VIX</div>';
      if (!m.error) {
        html += rowLine('Current', m.vix.toFixed(2));
        html += rowLine('Daily Change %', (m.vixChangePercent >= 0 ? '+' : '') + m.vixChangePercent.toFixed(2) + '%');
      } else {
        html += rowLine('Current', 'DATA UNAVAILABLE');
      }
      html += rowLine('5-Day Trend', 'DATA UNAVAILABLE');
      html += '</div>';
      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Brent Crude / USDINR</div>';
      html += rowLine('Brent Crude', 'DATA UNAVAILABLE (Crude Oil is on the Commodities tab via MCX, not yet wired here)');
      html += rowLine('USDINR', 'DATA UNAVAILABLE (technically available via Kite currency derivatives, not yet wired)');
      html += '</div>';
      return html;
    }

    function renderContextSignalReview() {
      if (!data) return '<div class="loading">Loading...</div>';
      let html = '';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += renderVerdictIndexCard(sym, data[sym]);
      });
      return html;
    }

    function renderContext() {
      const tabs = [
        { key: 'PREVIOUS', label: 'PREVIOUS' },
        { key: 'FIIDII', label: 'FII-DII' },
        { key: 'GAPCHECK', label: 'GAP CHECK' },
        { key: 'MACROVIX', label: 'MACRO-VIX' },
        { key: 'SIGNALREVIEW', label: 'SIGNAL REVIEW' },
      ];
      let html = '<div class="chip-nav">';
      tabs.forEach((t) => {
        html += '<button class="' + (contextInternalTab === t.key ? 'active' : '') + '" onclick="switchContextTab(' + "'" + t.key + "'" + ')">' + t.label + '</button>';
      });
      html += '</div>';

      if (contextInternalTab === 'PREVIOUS') html += renderContextPrevious();
      else if (contextInternalTab === 'FIIDII') html += renderFiiDii();
      else if (contextInternalTab === 'GAPCHECK') html += renderContextGapCheck();
      else if (contextInternalTab === 'MACROVIX') html += renderContextMacroVix();
      else html += renderContextSignalReview();

      return html;
    }

    function renderIndexPage(symbol) {
      const m = data ? data[symbol] : null;
      if (!m) return '<div class="loading">Loading...</div>';
      if (m.error) return '<div class="error">DATA UNAVAILABLE — ' + escapeHtml(m.error) + '</div>';

      let html = '<div class="chip-nav">';
      ['OVERVIEW', 'FUTURES', 'OPTIONS', 'ALIGNMENT'].forEach((t) => {
        html += '<button class="' + (indexInternalTab[symbol] === t ? 'active' : '') + '" onclick="switchIndexInternalTab(\\'' + symbol + '\\', \\'' + t + '\\')">' + t + '</button>';
      });
      html += '</div>';

      const tab = indexInternalTab[symbol];
      if (tab === 'OVERVIEW') html += renderOverviewTab(symbol, m);
      else if (tab === 'FUTURES') html += renderFuturesTab(symbol, m);
      else if (tab === 'OPTIONS') html += renderOptionsTab(symbol, m);
      else html += renderAlignmentTab(symbol, m);

      return html;
    }

    function classifyBuildup(priceDir, oiDir, ivDir) {
      let base;
      if (priceDir === 'up' && oiDir === 'up') {
        base = { label: 'Long Buildup', verdict: 'BUY', color: 'var(--green)' };
      } else if (priceDir === 'down' && oiDir === 'up') {
        base = { label: 'Short Buildup', verdict: 'SELL', color: 'var(--red)' };
      } else if (oiDir === 'down' && priceDir === 'up') {
        base = { label: 'Short Covering', verdict: 'WAIT', color: 'var(--muted)' };
      } else if (oiDir === 'down' && priceDir === 'down') {
        base = { label: 'Long Unwinding', verdict: 'WAIT', color: 'var(--muted)' };
      } else {
        base = { label: 'No Data Yet', verdict: 'WAIT', color: 'var(--muted-dim)' };
      }

      // IV confirmation: rising IV alongside a fresh buildup (Long/Short)
      // means real conviction (bigger move being priced in) — "Strong".
      // Falling IV during a buildup suggests it may fizzle — "Low Conviction".
      if (ivDir && ivDir !== 'flat' && (base.label === 'Long Buildup' || base.label === 'Short Buildup')) {
        if (ivDir === 'up') {
          base = { ...base, label: 'Strong ' + base.label };
        } else {
          base = { ...base, label: base.label + ' (Low Conviction)', verdict: 'WAIT' };
        }
      }
      return base;
    }

    function renderStrikeBand(title, strikes, errorMsg, keyPrefix) {
      let html = '<div class="premium-card">';
      html += '<div class="card-title">' + title + '</div>';

      if (!strikes || strikes.length === 0) {
        html += '<div class="card-grid"><div class="card-item"><span class="card-value unavailable">' + escapeHtml(errorMsg || 'N/A') + '</span></div></div>';
        html += '</div>';
        return html;
      }

      html += '<div class="table-scroll"><table style="width:100%; min-width:790px; font-family: var(--font-mono); font-size: 0.7rem; border-collapse: collapse;">';
      html += '<thead><tr style="color: var(--muted-dim);">' +
        '<th style="text-align:left; padding: 3px 2px;">Strike</th>' +
        '<th style="text-align:right; padding: 3px 2px;">LTP</th>' +
        '<th style="text-align:right; padding: 3px 2px;">OI</th>' +
        '<th style="text-align:right; padding: 3px 2px;">IV</th>' +
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
        const ivDir = ivDirection(strikeKey + '_iv', s.iv);
        const ivColor = ivDir === 'up' ? 'var(--green)' : ivDir === 'down' ? 'var(--red)' : 'var(--muted)';
        const buildup = classifyBuildup(priceDir, oiInfo.cls, ivDir);
        const atPdh = s.pdh ? s.lastPrice >= s.pdh * 0.98 : false;
        const atPdl = s.pdl ? s.lastPrice <= s.pdl * 1.02 : false;
        html += '<tr style="' + rowStyle + '">';
        html += '<td style="padding: 4px 2px; color: ' + (s.isAtm ? 'var(--gold)' : 'var(--text)') + '; font-weight: ' + (s.isAtm ? '700' : '500') + ';">' + s.strike + (s.isAtm ? ' (ATM)' : '') + '</td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: var(--text);"><span class="flash">' + s.lastPrice.toFixed(2) + '</span></td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + oiColor + ';"><div class="flash">' + (s.oi != null ? s.oi.toLocaleString('en-IN') : '—') + ' <span style="font-weight:700;">' + oiInfo.arrow + '</span></div>' + (oiInfo.delta ? '<div style="font-size:0.62rem; color:' + oiColor + ';">' + (oiInfo.delta > 0 ? '+' : '') + oiInfo.delta.toLocaleString('en-IN') + '</div>' : '') + '</td>';
        html += '<td style="padding: 4px 2px; text-align:right; color: ' + ivColor + ';">' + (s.iv ? s.iv.toFixed(1) : '—') + (s.iv && ivDir === 'up' ? ' ▲' : s.iv && ivDir === 'down' ? ' ▼' : '') + '</td>';
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

    function biasColor(color) {
      return color === 'bullish' ? 'var(--green)' : color === 'bearish' ? 'var(--red)' : 'var(--muted)';
    }

    function formatVolume(v) {
      if (v == null) return '—';
      if (v >= 10000000) return (v / 10000000).toFixed(2) + ' Cr';
      if (v >= 100000) return (v / 100000).toFixed(2) + ' L';
      return v.toLocaleString('en-IN');
    }

    function renderAlignRow(name, valueText, label, color) {
      return '<div class="align-row">' +
        '<span class="align-name">' + escapeHtml(name) + '</span>' +
        '<span class="align-meta">' + escapeHtml(valueText) + '</span>' +
        '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + biasColor(color) + '; font-size:0.75rem; padding:4px 10px;">' + escapeHtml(label) + '</span>' +
        '</div>';
    }

    function fiiDiiBiasColor(bias) {
      if (bias === 'Long Buildup' || bias === 'Long') return 'var(--green)';
      if (bias === 'Short Buildup' || bias === 'Short') return 'var(--red)';
      return 'var(--muted)';
    }

    function renderFiiDiiTrendMeter(entries) {
      const last5 = entries.slice(-5);
      if (last5.length === 0) {
        return '<div class="loading">No entries yet — add today\u2019s data below to start the 5-day trend meter.</div>';
      }
      const positiveDays = last5.filter((e) => e.fiiCashCr > 0).length;
      const n = last5.length;
      let label, color;
      if (positiveDays >= n - (n > 2 ? 1 : 0) && positiveDays > n / 2) { label = 'Strong Bullish Trend'; color = 'var(--green)'; }
      else if (positiveDays > n / 2) { label = 'Bullish Trend'; color = 'var(--green)'; }
      else if (positiveDays < n / 2) { label = 'Bearish Trend'; color = 'var(--red)'; }
      else { label = 'Mixed Trend'; color = 'var(--muted)'; }
      const barPct = Math.round((positiveDays / n) * 100);

      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">';
      html += '<div class="card-title" style="margin-bottom:0;">5-Day FII Trend Meter</div>';
      html += '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + color + ';">' + label + '</span>';
      html += '</div>';
      html += '<div class="gap-score-bar-track"><div class="gap-score-bar-fill" style="width:' + barPct + '%; background:' + color + ';"></div></div>';
      html += '<div style="color: var(--muted); font-family: var(--font-mono); font-size:0.75rem;">FII was a net buyer on ' + positiveDays + ' of last ' + n + ' entered days</div>';
      html += '</div>';
      return html;
    }

    function renderFiiDiiForm() {
      const today = new Date().toISOString().slice(0, 10);
      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div class="card-title">Add / Update Today\u2019s Entry</div>';

      html += '<div class="fii-section-label">Paste &amp; Fill (optional)</div>';
      html += '<textarea id="fdPasteBox" placeholder="Paste lines like:&#10;Date: 2026-07-31&#10;FII Cash: 277.48&#10;DII Cash: 2260.37&#10;Index Futures OI: 13499&#10;Index Futures Bias: Short Covering" style="width:100%; min-height:80px; background: var(--panel-alt); border:1px solid var(--border); color: var(--text); border-radius:6px; padding:8px; font-size:0.75rem; font-family: var(--font-mono);"></textarea>';
      html += '<button class="btn" style="margin-top:6px; margin-bottom:10px;" onclick="parseFiiDiiPaste()">📋 Parse &amp; Fill</button>';

      html += '<div class="fii-form-grid">';
      html += '<div class="fii-field"><label>Date</label><input type="date" id="fdDate" value="' + today + '"></div>';
      html += '<div class="fii-field"><label>FII Cash Net (Cr)</label><input type="number" id="fdFiiCash" step="0.01" placeholder="e.g. 1250 or -800"></div>';
      html += '<div class="fii-field"><label>DII Cash Net (Cr)</label><input type="number" id="fdDiiCash" step="0.01" placeholder="e.g. 900"></div>';
      html += '</div>';

      html += '<div class="fii-section-label">FII Derivatives — OI Change + Long/Short Bias</div>';
      html += '<div class="fii-form-grid">';
      FII_DII_DERIVATIVE_CATEGORIES.forEach((cat, i) => {
        html += '<div class="fii-field"><label>' + cat + '</label>';
        html += '<input type="number" id="fdDeriv' + i + 'Val" step="0.01" placeholder="OI chg" style="margin-bottom:4px;">';
        html += '<select id="fdDeriv' + i + 'Bias"><option>Long Buildup</option><option>Short Buildup</option><option>Long Unwinding</option><option>Short Covering</option></select>';
        html += '</div>';
      });
      html += '</div>';

      html += '<button class="btn primary" style="margin-top:14px;" onclick="saveFiiDii()">💾 Save Entry</button>';
      html += '</div>';
      return html;
    }

    function renderBulkFiiDiiForm() {
      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div class="card-title">📦 Bulk Add — Multiple Days at Once</div>';
      html += '<div style="color: var(--muted); font-size:0.75rem; margin-bottom:8px;">Paste several days, each block separated by a blank line. Each block needs at least "Date:" and "FII Cash:".</div>';
      html += '<textarea id="fdBulkPasteBox" placeholder="Date: 2026-07-31&#10;FII Cash: 277.48&#10;DII Cash: 2260.37&#10;&#10;Date: 2026-07-30&#10;FII Cash: 3623.51&#10;DII Cash: -1864.03&#10;&#10;Date: 2026-07-29&#10;FII Cash: 2981.87&#10;DII Cash: 998.02" style="width:100%; min-height:160px; background: var(--panel-alt); border:1px solid var(--border); color: var(--text); border-radius:6px; padding:8px; font-size:0.75rem; font-family: var(--font-mono);"></textarea>';
      html += '<button class="btn primary" style="margin-top:8px;" onclick="bulkSaveFiiDii()">📦 Save All Days</button>';
      html += '</div>';
      return html;
    }

    function renderFiiDii() {
      let html = renderFiiDiiForm();
      html += renderBulkFiiDiiForm();

      if (!fiiDiiData) {
        html += '<div class="loading">Loading FII/DII history...</div>';
        return html;
      }
      if (fiiDiiData.error) {
        html += '<div class="error">⚠️ ' + escapeHtml(fiiDiiData.error) + '</div>';
        return html;
      }

      const entries = fiiDiiData.entries || [];
      html += renderFiiDiiTrendMeter(entries);

      if (entries.length > 0) {
        html += '<div class="premium-card" style="margin-bottom:16px;">';
        html += '<div class="card-title">Recent Entries (Cash)</div>';
        entries.slice(-7).reverse().forEach((e) => {
          const fiiColor = e.fiiCashCr > 0 ? 'var(--green)' : e.fiiCashCr < 0 ? 'var(--red)' : 'var(--muted)';
          const diiColor = e.diiCashCr > 0 ? 'var(--green)' : e.diiCashCr < 0 ? 'var(--red)' : 'var(--muted)';
          html += '<div class="align-row">';
          html += '<span class="align-name">' + e.date + '</span>';
          html += '<span class="align-meta" style="color:' + fiiColor + ';">FII ' + (e.fiiCashCr >= 0 ? '+' : '') + e.fiiCashCr.toFixed(0) + ' Cr</span>';
          html += '<span class="align-meta" style="color:' + diiColor + ';">DII ' + (e.diiCashCr >= 0 ? '+' : '') + e.diiCashCr.toFixed(0) + ' Cr</span>';
          html += '</div>';
        });
        html += '</div>';

        const latest = entries[entries.length - 1];
        if (latest.derivatives && latest.derivatives.length > 0) {
          html += '<div class="premium-card" style="margin-bottom:16px;">';
          html += '<div class="card-title">Latest Derivatives (' + latest.date + ')</div>';
          latest.derivatives.forEach((d) => {
            html += renderAlignRow(d.category, (d.oiChange >= 0 ? '+' : '') + d.oiChange, d.bias, fiiDiiBiasColor(d.bias) === 'var(--green)' ? 'bullish' : fiiDiiBiasColor(d.bias) === 'var(--red)' ? 'bearish' : 'neutral');
          });
          html += '</div>';
        }
      }

      html += '<div class="timestamp">Manually entered from NSE\u2019s published FII/DII reports. Stored in server memory only — lost on redeploy, not a database.</div>';
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

    function corrLabel(r) {
      if (r == null) return 'N/A';
      const abs = Math.abs(r);
      if (abs >= 0.7) return (r < 0 ? 'Strong inverse' : 'Strong direct');
      if (abs >= 0.4) return (r < 0 ? 'Moderate inverse' : 'Moderate direct');
      return (r < 0 ? 'Weak inverse' : 'Weak direct');
    }

    function corrSentence(r, indexName) {
      if (r == null) return 'Not enough data yet.';
      if (r <= -0.4) return 'When VIX rises, ' + indexName + ' tends to fall — a fairly reliable inverse link.';
      if (r >= 0.4) return indexName + ' and VIX have been moving in the same direction lately — less typical.';
      return indexName + ' and VIX show a weak link right now — VIX alone is not a strong signal here.';
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

      function sentenceCard(label, r) {
        const strength = r == null ? 'N/A' : Math.abs(r) >= 0.7 ? 'Strong' : Math.abs(r) >= 0.4 ? 'Moderate' : 'Weak';
        const color = r == null ? 'var(--muted)' : r <= -0.4 ? 'var(--green)' : r >= 0.4 ? 'var(--red)' : 'var(--muted)';
        let html = '<div class="premium-card" style="margin-bottom:12px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">';
        html += '<span class="card-title" style="margin-bottom:0;">' + label + ' vs India VIX</span>';
        html += '<span class="badge-pill" style="background: rgba(0,0,0,0.2); color:' + color + '; font-size:0.75rem;">' + strength + (r != null ? ' (' + r.toFixed(2) + ')' : '') + '</span>';
        html += '</div>';
        html += '<div style="color: var(--text); font-size:0.85rem;">' + escapeHtml(corrSentence(r, label)) + '</div>';
        html += '</div>';
        return html;
      }

      let html = sentenceCard('NIFTY', vixCorrData.niftyVixCorrelation);
      html += sentenceCard('BANKNIFTY', vixCorrData.bankNiftyVixCorrelation);

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">NIFTY vs India VIX — last 90 trading days</div>';
      html += '<canvas id="chart-vixcorr" height="150"></canvas>';
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">BANKNIFTY vs India VIX — last 90 trading days</div>';
      html += '<canvas id="chart-vixcorr-bank" height="150"></canvas>';
      html += '</div>';

      html += '<div class="timestamp">Correlation number (r) is calculated over 1 year of daily returns, from -1 to +1. Charts below show only the most recent 90 days so the shape is easier to read.</div>';
      return html;
    }

    function drawVixCorrChart() {
      if (typeof Chart === 'undefined' || !vixCorrData || vixCorrData.error) return;

      const fullSeries = vixCorrData.series || [];
      if (fullSeries.length === 0) return;
      const series = fullSeries.slice(-90);
      const labels = series.map((p) => p.date.slice(5));

      function buildChart(existingChart, canvasId, pctKey, pctLabel, pctColor) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return existingChart;
        if (existingChart) existingChart.destroy();
        return new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: pctLabel,
                data: series.map((p) => p[pctKey]),
                borderColor: pctColor,
                backgroundColor: 'transparent',
                yAxisID: 'yPct',
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 1.5,
              },
              {
                label: 'India VIX',
                data: series.map((p) => p.vix),
                borderColor: '#E5484D',
                backgroundColor: 'rgba(229,72,77,0.06)',
                yAxisID: 'yVix',
                tension: 0.2,
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
                ticks: { color: '#4E5B78', font: { size: 8 }, maxTicksLimit: 6 },
                grid: { display: false },
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

      vixCorrChart = buildChart(vixCorrChart, 'chart-vixcorr', 'niftyPct', 'NIFTY % change', '#C9A227');
      vixCorrChartBank = buildChart(vixCorrChartBank, 'chart-vixcorr-bank', 'bankNiftyPct', 'BANKNIFTY % change', '#5B8DEF');
    }

    function switchTab(symbol) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn, .bottom-nav button').forEach(el => el.classList.remove('active'));
      document.getElementById(symbol).classList.add('active');
      const btns = document.querySelectorAll('.tab-btn, .bottom-nav button');
      for (let i = 0; i < btns.length; i++) {
        const onclickAttr = btns[i].getAttribute('onclick') || '';
        if (onclickAttr.indexOf("'" + symbol + "'") !== -1) {
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
      await Promise.all([fetchData(), loadCommodities()]);
      if (document.getElementById('autoRefreshToggle').checked) resetCountdown();
      setTimeout(() => {
        document.getElementById('manualRefresh').disabled = false;
      }, 500);
    }

    let refreshIntervalMinutes = 3;
    let countdownSeconds = refreshIntervalMinutes * 60;
    let countdownTimerId = null;

    function updateCountdownDisplay() {
      const el = document.getElementById('refreshCountdown');
      if (!el) return;
      if (!document.getElementById('autoRefreshToggle').checked) {
        el.textContent = 'Auto off';
        return;
      }
      const m = Math.floor(countdownSeconds / 60);
      const s = countdownSeconds % 60;
      el.textContent = 'Next: ' + m + ':' + String(s).padStart(2, '0');
    }

    function resetCountdown() {
      countdownSeconds = refreshIntervalMinutes * 60;
      updateCountdownDisplay();
    }

    function changeRefreshInterval() {
      refreshIntervalMinutes = parseInt(document.getElementById('refreshIntervalSelect').value, 10) || 3;
      resetCountdown();
      toggleAutoRefresh();
    }

    function toggleAutoRefresh() {
      const toggle = document.getElementById('autoRefreshToggle').checked;
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
      }
      if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
      if (toggle) {
        resetCountdown();
        autoRefreshInterval = setInterval(() => {
          refreshData();
          resetCountdown();
        }, refreshIntervalMinutes * 60 * 1000);
        countdownTimerId = setInterval(() => {
          countdownSeconds = Math.max(0, countdownSeconds - 1);
          updateCountdownDisplay();
        }, 1000);
      } else {
        updateCountdownDisplay();
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
      await Promise.all([loadNews(), loadHolidays(), loadFiiDii()]);
      if (kiteConnected) {
        await Promise.all([fetchData(), loadCommodities()]);
      } else {
        ['NIFTY', 'BANKNIFTY', 'SENSEX', 'COMMODITIES', 'VIXCORR', 'VERDICT', 'CONTEXT']
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

    // Build a flat key -> {price, oi, iv} map matching the frontend's strike
    // key scheme (SYMBOL_expiryLabel_CE/PE_strike), so a browser refresh can
    // still show correct up/down direction on the very first render by
    // priming against what the server last served, instead of starting blank.
    const currentStrikeValues: Record<string, { price: number; oi: number; iv: number }> = {};
    for (const sym of Object.keys(data)) {
      const m = data[sym];
      if (!m || m.error || !m.expiries) continue;
      for (const exp of m.expiries) {
        for (const s of exp.ceStrikes || []) {
          currentStrikeValues[`${sym}_${exp.expiry}_CE_${s.strike}`] = { price: s.lastPrice, oi: s.oi, iv: s.iv };
        }
        for (const s of exp.peStrikes || []) {
          currentStrikeValues[`${sym}_${exp.expiry}_PE_${s.strike}`] = { price: s.lastPrice, oi: s.oi, iv: s.iv };
        }
      }
    }
    const prevStrikeValues = session.lastServedStrikeValues || {};
    session.lastServedStrikeValues = currentStrikeValues;

    console.log("======================================");
    console.log("    [API] /api/data response ready");
    console.log("======================================\n");
    return c.json({ ...data, _history: session.snapshotHistory || [], _prevStrikeValues: prevStrikeValues });
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

// FII/DII manual entry — save one day's data (upserts by date)
app.post("/api/fii-dii", async (c) => {
  try {
    const body = await c.req.json();
    const date = typeof body.date === "string" && body.date ? body.date : indiaDate();

    const entry: FiiDiiEntry = {
      date,
      fiiCashCr: Number(body.fiiCashCr) || 0,
      diiCashCr: Number(body.diiCashCr) || 0,
      derivatives: Array.isArray(body.derivatives)
        ? body.derivatives.map((d: any) => ({
            category: String(d.category || ""),
            oiChange: Number(d.oiChange) || 0,
            bias: d.bias === "Short Buildup" || d.bias === "Long Unwinding" || d.bias === "Short Covering" ? d.bias : "Long Buildup",
          }))
        : [],
      createdAt: new Date().toISOString(),
    };

    const existingIdx = fiiDiiEntries.findIndex((e) => e.date === date);
    if (existingIdx >= 0) fiiDiiEntries[existingIdx] = entry;
    else fiiDiiEntries.push(entry);
    fiiDiiEntries.sort((a, b) => a.date.localeCompare(b.date));
    if (fiiDiiEntries.length > FII_DII_MAX_ENTRIES) fiiDiiEntries.shift();

    return c.json({ success: true, entry });
  } catch (err) {
    console.error("[API] FII/DII save error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to save FII/DII entry" }, 500);
  }
});

// FII/DII manual entry — list recent entries (most recent last)
app.get("/api/fii-dii", (c) => {
  return c.json({ entries: fiiDiiEntries.slice(-30) });
});

// Key stocks per index for the ALIGNMENT tab. Kite does not publish live
// index constituent weights, so this dashboard does not hardcode a weight
// table (per spec rule) — only price/volume are shown, unweighted.
const INDEX_KEY_STOCKS: Record<string, Record<string, string>> = {
  NIFTY: {
    "HDFC Bank": "NSE:HDFCBANK",
    "Reliance": "NSE:RELIANCE",
    "ICICI Bank": "NSE:ICICIBANK",
    "Infosys": "NSE:INFY",
    "SBI": "NSE:SBIN",
  },
  BANKNIFTY: {
    "HDFC Bank": "NSE:HDFCBANK",
    "ICICI Bank": "NSE:ICICIBANK",
    "SBI": "NSE:SBIN",
    "Axis Bank": "NSE:AXISBANK",
    "Kotak Mahindra Bank": "NSE:KOTAKBANK",
  },
  SENSEX: {
    "Reliance": "NSE:RELIANCE",
    "HDFC Bank": "NSE:HDFCBANK",
    "ICICI Bank": "NSE:ICICIBANK",
    "TCS": "NSE:TCS",
    "Infosys": "NSE:INFY",
  },
};

app.get("/api/index-stocks", async (c) => {
  try {
    const session = getSession(c);
    if (!session) {
      return c.json({ error: "Kite not connected. Please connect Kite first." }, 401);
    }
    const symbol = c.req.query("symbol") || "";
    const stockMap = INDEX_KEY_STOCKS[symbol];
    if (!stockMap) {
      return c.json({ error: "Unknown or unsupported index for constituent data" }, 400);
    }

    const kiteSymbols = Object.values(stockMap);
    const quotes = await fetchKiteQuote(session.accessToken, kiteSymbols);
    if (!quotes) {
      return c.json({ error: "Failed to fetch stock quotes from Kite" }, 500);
    }

    const stocks = Object.entries(stockMap).map(([name, kiteSymbol]) => {
      const q = quotes[kiteSymbol];
      const change = q && q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : null;
      return {
        name,
        price: q?.last_price ?? null,
        change,
        volume: q?.volume ?? null,
      };
    });

    return c.json({ stocks, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[API] Index stocks fetch error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch constituent data" }, 500);
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
