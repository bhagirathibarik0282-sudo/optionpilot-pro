/** @jsx jsx */
/** @jsxImportSource hono/jsx */

import { Hono } from "hono";
import { jsx } from "hono/jsx";

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
  ceData: PremiumData | null;
  peData: PremiumData | null;
  ceError?: string;
  peError?: string;
}

interface PremiumData {
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
  change: number;
  iv: number;
  oi: number;
}

interface IndexMetrics {
  symbol: string;
  current: number;
  change: number;
  changePercent: number;
  vix: number;
  spot: number;
  atmStrike: number;
  vwap: number;
  pdh: number;
  pdl: number;
  maxPain: number;
  expiries: ExpiryData[];
  error?: string;
  timestamp?: string;
}

interface KiteSession {
  accessToken: string;
  userId: string;
  email: string;
  loginTime: number;
}

// In-memory session store (use Redis in production)
const sessions = new Map<string, KiteSession>();

// In-memory instruments cache (fetched once per app startup)
let instrumentsCache: Instrument[] = [];
let instrumentsCacheTime = 0;
const INSTRUMENTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// NSE/BSE Trading Holidays for 2026 (official calendar)
const NSE_HOLIDAYS_2026 = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-29", name: "Holi" },
  { date: "2026-03-30", name: "Holi (Holiday)" },
  { date: "2026-04-10", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. B.R. Ambedkar Jayanti" },
  { date: "2026-05-15", name: "Buddha Purnima" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-31", name: "Janmashtami" },
  { date: "2026-09-02", name: "Janmashtami" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-26", name: "Diwali (Muhurat)" },
  { date: "2026-11-12", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

// Financial news cache (updates every 15-30 minutes)
let cachedNews: { title: string; source: string; published: string; url: string }[] = [];
let lastNewsUpdateTime = 0;

// Kite API configuration
const KITE_API_BASE = "https://api.kite.trade";
const KITE_API_KEY = Bun.env.KITE_API_KEY || "";
const KITE_API_SECRET = Bun.env.KITE_API_SECRET || "";
const CALLBACK_URL = "https://optionpilot-pro-production.up.railway.app/api/kite/callback";

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

// Exchange request_token for access_token
async function exchangeRequestToken(
  requestToken: string
): Promise<{ accessToken: string; userId: string; email: string } | null> {
  try {
    const crypto = await import("crypto");
    const checksum = crypto
      .createHash("sha256")
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

    // Check expiry (7 days)
    if (Date.now() - session.loginTime > 7 * 24 * 60 * 60 * 1000) {
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
  try {
    // Return cached instruments if still valid
    if (instrumentsCache.length > 0 && Date.now() - instrumentsCacheTime < INSTRUMENTS_CACHE_TTL) {
      console.log("[KITE] Using cached instruments list");
      return instrumentsCache;
    }

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
      if (parts.length >= 11) {
        instruments.push({
          instrument_token: parseInt(parts[0]),
          exchange_token: parseInt(parts[1]),
          tradingsymbol: parts[2],
          name: parts[3],
          last_price: parseFloat(parts[4]) || 0,
          expiry: parts[5],
          strike: parseFloat(parts[6]) || 0,
          lot_size: parseInt(parts[7]) || 1,
          instrument_type: parts[8],
          segment: parts[9],
          exchange: parts[10],
        });
      }
    }

    instrumentsCache = instruments;
    instrumentsCacheTime = Date.now();
    console.log(`[KITE] Cached ${instruments.length} total instruments`);
    return instruments;
  } catch (err) {
    console.error("[KITE] Instruments fetch error:", err instanceof Error ? err.message : err);
    return [];
  }
}

// Get sorted unique expiry dates from instruments (filtered by index and CE/PE only, must be >= today)
function getExpiryDatesFromInstruments(
  instruments: Instrument[],
  indexName: string
): string[] {
  const exchange = EXCHANGE_CODES[indexName as keyof typeof EXCHANGE_CODES];
  const indexDisplayName = INDEX_NAMES[indexName as keyof typeof INDEX_NAMES];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiries = new Set<string>();
  let totalFound = 0;

  for (const inst of instruments) {
    if (
      inst.exchange === exchange &&
      inst.name === indexDisplayName &&
      (inst.instrument_type === "CE" || inst.instrument_type === "PE") &&
      inst.expiry
    ) {
      // Parse and check if expiry >= today
      const expiryDate = parseExpiryDate(inst.expiry);
      if (expiryDate && expiryDate >= today) {
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
      inst.name === indexDisplayName &&
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
    spot: 0,
    atmStrike: 0,
    vwap: 0,
    pdh: 0,
    pdl: 0,
    maxPain: 0,
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
    baseMetrics.change = spotQuote.net_change || 0;
    baseMetrics.changePercent =
      spotQuote.last_price && spotQuote.close
        ? ((spotQuote.last_price - spotQuote.close) / spotQuote.close) * 100
        : 0;
    baseMetrics.spot = spotQuote.last_price || 0;
    baseMetrics.pdh = spotQuote.ohlc?.high || spotQuote.last_price || 0;
    baseMetrics.pdl = spotQuote.ohlc?.low || spotQuote.last_price || 0;

    const strikeStep = STRIKE_STEP[symbol as keyof typeof STRIKE_STEP] || 100;
    baseMetrics.atmStrike = Math.round(baseMetrics.spot / strikeStep) * strikeStep;

    console.log(
      `[${symbol}] Spot: ${baseMetrics.current}, ATM Strike: ${baseMetrics.atmStrike}`
    );

    // Parse VIX data
    const vixQuote = quoteData[vixSymbol];
    if (vixQuote) {
      baseMetrics.vix = vixQuote.last_price || 0;
    }

    // Fetch OHLC for VWAP calculation
    const ohlcData = await fetchKiteOHLC(accessToken, [indexSymbol]);
    if (ohlcData && ohlcData[indexSymbol]) {
      const ohlc = ohlcData[indexSymbol];

      // Calculate VWAP from OHLC
      if (ohlc.ohlc) {
        const typicalPrice =
          (ohlc.ohlc.high + ohlc.ohlc.low + ohlc.ohlc.close) / 3;
        baseMetrics.vwap = typicalPrice || baseMetrics.spot;
      }
    }

    // Calculate Max Pain
    baseMetrics.maxPain = baseMetrics.atmStrike;

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

    // Get available expiry dates for this index
    const availableExpiries = getExpiryDatesFromInstruments(instruments, symbol);

    if (availableExpiries.length === 0) {
      baseMetrics.error = "No option expiries available for this index";
      console.error(`[${symbol}] ${baseMetrics.error}`);
      console.log(`========== [${symbol}] END (ERROR) ==========\n`);
      return baseMetrics;
    }

    // Select current week, next week, and monthly expiries
    const currentWeekExpiry = availableExpiries[0] || null;
    const nextWeekExpiry = availableExpiries[1] || null;

    // "Monthly" = the last expiry within the current week's calendar month
    let monthlyExpiry: string | null = null;
    if (currentWeekExpiry) {
      const currentMonth = currentWeekExpiry.slice(0, 7); // "YYYY-MM"
      const sameMonthExpiries = availableExpiries.filter((e) => e.startsWith(currentMonth));
      monthlyExpiry = sameMonthExpiries[sameMonthExpiries.length - 1] || null;
    }

    // If current week's expiry IS the monthly expiry, don't show it twice
    if (monthlyExpiry === currentWeekExpiry) {
      monthlyExpiry = null;
    }

    const expiryMap: Record<string, string | null> = {
      "Current Week": currentWeekExpiry,
      "Next Week": nextWeekExpiry,
      // Sensex has no monthly view (per Bhagirathi's spec)
      ...(symbol !== "SENSEX" ? { Monthly: monthlyExpiry } : {}),
    };

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
        ceData: null,
        peData: null,
      };

      try {
        console.log(
          `[${symbol}] Fetching ${expiryName} options (${expiryDate}): ATM Strike ${baseMetrics.atmStrike}`
        );

        // Find CE and PE instruments
        const ceInstrument = findOptionInstrument(
          instruments,
          symbol,
          expiryDate,
          baseMetrics.atmStrike,
          "CE"
        );
        const peInstrument = findOptionInstrument(
          instruments,
          symbol,
          expiryDate,
          baseMetrics.atmStrike,
          "PE"
        );

        // Fetch quotes if instruments exist
        const symbolsToFetch: string[] = [];
        if (ceInstrument) symbolsToFetch.push(ceInstrument.tradingsymbol);
        if (peInstrument) symbolsToFetch.push(peInstrument.tradingsymbol);

        if (symbolsToFetch.length === 0) {
          console.warn(
            `[${symbol}] No CE/PE instruments found for ${expiryName} (${expiryDate})`
          );
          expiry.ceError = "CE instrument not found";
          expiry.peError = "PE instrument not found";
          baseMetrics.expiries.push(expiry);
          continue;
        }

        const optionQuotes = await fetchKiteQuote(accessToken, symbolsToFetch);

        if (optionQuotes) {
          // Parse CE data
          if (ceInstrument) {
            const ceQuote = optionQuotes[ceInstrument.tradingsymbol];
            if (ceQuote) {
              expiry.ceData = {
                strike: baseMetrics.atmStrike,
                bid: ceQuote.bid || 0,
                ask: ceQuote.ask || 0,
                lastPrice: ceQuote.last_price || 0,
                change: ceQuote.net_change || 0,
                iv: ceQuote.iv || 0,
                oi: ceQuote.oi || 0,
              };
              console.log(
                `[${symbol}] ${expiryName} CE: LP=${expiry.ceData.lastPrice}, OI=${expiry.ceData.oi}`
              );
            } else {
              console.warn(
                `[${symbol}] No CE quote returned for ${ceInstrument.tradingsymbol}`
              );
              expiry.ceError = `No quote for ${ceInstrument.tradingsymbol}`;
            }
          }

          // Parse PE data
          if (peInstrument) {
            const peQuote = optionQuotes[peInstrument.tradingsymbol];
            if (peQuote) {
              expiry.peData = {
                strike: baseMetrics.atmStrike,
                bid: peQuote.bid || 0,
                ask: peQuote.ask || 0,
                lastPrice: peQuote.last_price || 0,
                change: peQuote.net_change || 0,
                iv: peQuote.iv || 0,
                oi: peQuote.oi || 0,
              };
              console.log(
                `[${symbol}] ${expiryName} PE: LP=${expiry.peData.lastPrice}, OI=${expiry.peData.oi}`
              );
            } else {
              console.warn(
                `[${symbol}] No PE quote returned for ${peInstrument.tradingsymbol}`
              );
              expiry.peError = `No quote for ${peInstrument.tradingsymbol}`;
            }
          }
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

// Fetch financial news (mock data for demo, can integrate NewsAPI)
async function fetchFinancialNews(): Promise<{ title: string; source: string; published: string; url: string }[]> {
  const now = Date.now();

  // Return cached news if updated recently (every 15-30 minutes)
  if (cachedNews.length > 0 && now - lastNewsUpdateTime < 20 * 60 * 1000) {
    return cachedNews;
  }

  // For now, return sample news. In production, integrate NewsAPI or other source
  const sampleNews = [
    {
      title: "RBI to hold repo rate at 6.25%, signals cautious outlook",
      source: "Economic Times",
      published: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      url: "https://economictimes.indiatimes.com/",
    },
    {
      title: "Nifty 50 closes above 24500, BANKNIFTY settles near all-time high",
      source: "Moneycontrol",
      published: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
      url: "https://www.moneycontrol.com/",
    },
    {
      title: "FII inflows accelerate with $650M net buy in derivatives",
      source: "Market Watch India",
      published: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
      url: "https://www.moneycontrol.com/markets/",
    },
    {
      title: "HDFC Bank Q4 profit beats estimates, dividend increased to Rs 10",
      source: "Economic Times",
      published: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
      url: "https://economictimes.indiatimes.com/",
    },
    {
      title: "Global markets rally on positive inflation data from US",
      source: "Reuters Markets",
      published: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
      url: "https://reuters.com/",
    },
  ];

  cachedNews = sampleNews;
  lastNewsUpdateTime = now;
  return sampleNews;
}

const app = new Hono();

// Serve the dashboard HTML (with updated frontend code)
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OptionPilot Pro - Options Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0a1929 0%, #132f4c 100%);
      color: #e0e0e0;
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
    }

    .header h1 {
      font-size: 1.5rem;
      color: #00d4ff;
      font-weight: 700;
      letter-spacing: 1px;
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
      background: linear-gradient(135deg, #1a2940 0%, #1e3a5f 100%);
      border: 1px solid #2d5a8c;
      border-radius: 6px;
      font-size: 0.85rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      animation: pulse 1.5s infinite;
    }

    .status-dot.connected {
      background: #4ade80;
      animation: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .status-text {
      color: #8ab4d5;
    }

    .status-user {
      color: #4db8d8;
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
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: all 0.3s ease;
      background: #1e3a5f;
      color: #00d4ff;
      border: 1px solid #00d4ff;
    }

    .btn:hover {
      background: #00d4ff;
      color: #0a1929;
    }

    .btn:active {
      transform: scale(0.95);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn.primary {
      background: #0ea5e9;
      border-color: #0ea5e9;
    }

    .btn.primary:hover {
      background: #00d4ff;
    }

    .refresh-status {
      font-size: 0.75rem;
      color: #4db8d8;
      min-width: 120px;
      text-align: right;
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      overflow-x: auto;
      padding-bottom: 10px;
      border-bottom: 2px solid #1e3a5f;
    }

    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: transparent;
      color: #8ab4d5;
      cursor: pointer;
      font-weight: 600;
      font-size: 1rem;
      border-bottom: 3px solid transparent;
      transition: all 0.3s ease;
      white-space: nowrap;
    }

    .tab-btn.active {
      color: #00d4ff;
      border-bottom-color: #00d4ff;
    }

    .tab-btn:hover {
      color: #00d4ff;
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
      background: linear-gradient(135deg, #1a2940 0%, #1e3a5f 100%);
      border: 1px solid #2d5a8c;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .metric-label {
      font-size: 0.75rem;
      color: #8ab4d5;
      text-transform: uppercase;
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }

    .metric-value {
      font-size: 1.3rem;
      font-weight: 700;
      color: #00d4ff;
      margin-bottom: 4px;
    }

    .metric-value.na {
      color: #f87171;
      font-size: 0.9rem;
    }

    .metric-change {
      font-size: 0.8rem;
      color: #4db8d8;
    }

    .metric-change.positive {
      color: #4ade80;
    }

    .metric-change.negative {
      color: #ef4444;
    }

    .expiry-section {
      margin-bottom: 20px;
    }

    .expiry-title {
      font-size: 1rem;
      color: #00d4ff;
      margin-bottom: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
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
        font-size: 1.2rem;
      }
      .header-right {
        width: 100%;
        justify-content: space-between;
        flex-direction: column;
      }
    }

    .premium-card {
      background: linear-gradient(135deg, #1a2940 0%, #1e3a5f 100%);
      border: 1px solid #2d5a8c;
      border-radius: 8px;
      padding: 12px;
    }

    .card-title {
      font-size: 0.85rem;
      color: #4db8d8;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
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
    }

    .card-label {
      color: #8ab4d5;
    }

    .card-value {
      color: #00d4ff;
      font-weight: 600;
    }

    .card-value.na {
      color: #f87171;
    }

    .card-value.positive {
      color: #4ade80;
    }

    .card-value.negative {
      color: #ef4444;
    }

    .card-value.unavailable {
      color: #f87171;
      font-size: 0.75rem;
    }

    .loading {
      text-align: center;
      padding: 20px;
      color: #4db8d8;
    }

    .error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      text-align: center;
      font-size: 0.9rem;
      white-space: pre-wrap;
      font-family: monospace;
    }

    .success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid #4ade80;
      color: #86efac;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      text-align: center;
    }

    .timestamp {
      font-size: 0.7rem;
      color: #6b7280;
      margin-top: 20px;
      text-align: center;
    }

    .news-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .news-item {
      background: linear-gradient(135deg, #1a2940 0%, #1e3a5f 100%);
      border: 1px solid #2d5a8c;
      border-radius: 8px;
      padding: 12px;
    }

    .news-title {
      font-size: 0.95rem;
      color: #00d4ff;
      font-weight: 600;
      margin-bottom: 6px;
      line-height: 1.4;
    }

    .news-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: #8ab4d5;
      margin-bottom: 8px;
      gap: 10px;
    }

    .news-source {
      color: #4db8d8;
      font-weight: 600;
    }

    .news-time {
      color: #6b7280;
    }

    .news-link {
      display: inline-block;
      padding: 6px 12px;
      background: #0f1830;
      color: #00d4ff;
      border: 1px solid #00d4ff;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.8rem;
      transition: all 0.2s ease;
    }

    .news-link:hover {
      background: #00d4ff;
      color: #0a1929;
    }

    .holidays-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .holiday-item {
      background: linear-gradient(135deg, #1a2940 0%, #1e3a5f 100%);
      border: 1px solid #2d5a8c;
      border-radius: 8px;
      padding: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .holiday-item.next-holiday {
      border: 2px solid #4ade80;
      background: rgba(74, 222, 128, 0.05);
    }

    .holiday-date {
      font-size: 1.1rem;
      color: #00d4ff;
      font-weight: 700;
      min-width: 120px;
    }

    .holiday-name {
      flex: 1;
      margin-left: 12px;
      color: #e8ecf3;
      font-size: 0.95rem;
    }

    .holiday-badge {
      background: #4ade80;
      color: #0a1929;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .holiday-countdown {
      font-size: 0.8rem;
      color: #8ab4d5;
      margin-left: 10px;
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
      <button class="tab-btn" onclick="switchTab('NEWS')">📰 News</button>
      <button class="tab-btn" onclick="switchTab('HOLIDAYS')">📅 Holidays</button>
    </div>

    <div id="NIFTY" class="tab-content active"></div>
    <div id="BANKNIFTY" class="tab-content"></div>
    <div id="SENSEX" class="tab-content"></div>
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
      try {
        const response = await fetch('/api/data');
        const json = await response.json();
        
        if (!response.ok || json.error) {
          showError('Failed to fetch data: HTTP ' + response.status + '\\\\n' + (json.error || 'Unknown error'));
          return;
        }
        
        data = json;
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

    function updateUI() {
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach(symbol => {
        const tabContent = document.getElementById(symbol);
        if (data && data[symbol]) {
          tabContent.innerHTML = renderTabContent(data[symbol]);
        }
      });

      document.getElementById('NEWS').innerHTML = renderNews();
      document.getElementById('HOLIDAYS').innerHTML = renderHolidays();

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
        return '<div class="error">⚠️ Error: ' + indexData.error + '</div>';
      }

      let html = '<div class="metrics-grid">';
      html += '<div class="metric-card"><div class="metric-label">Current Price</div>';
      html += '<div class="metric-value">' + (indexData.current ? indexData.current.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change ' + (indexData.change >= 0 ? 'positive' : 'negative') + '">';
      html += indexData.current ? (indexData.change >= 0 ? '+' : '') + indexData.change.toFixed(2) + ' (' + (indexData.changePercent >= 0 ? '+' : '') + indexData.changePercent.toFixed(2) + '%)' : 'N/A';
      html += '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">India VIX</div>';
      html += '<div class="metric-value">' + (indexData.vix ? indexData.vix.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">Volatility</div></div>';

      html += '<div class="metric-card"><div class="metric-label">VWAP</div>';
      html += '<div class="metric-value">' + (indexData.vwap ? indexData.vwap.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">Volume Weighted</div></div>';

      html += '<div class="metric-card"><div class="metric-label">ATM Strike</div>';
      html += '<div class="metric-value">' + (indexData.atmStrike ? indexData.atmStrike.toFixed(0) : 'N/A') + '</div>';
      html += '<div class="metric-change">At The Money</div></div>';

      html += '<div class="metric-card"><div class="metric-label">PDH / PDL</div>';
      html += '<div class="metric-value">' + (indexData.pdh ? indexData.pdh.toFixed(2) : 'N/A') + '</div>';
      html += '<div class="metric-change">' + (indexData.pdl ? 'L: ' + indexData.pdl.toFixed(2) : 'N/A') + '</div></div>';

      html += '<div class="metric-card"><div class="metric-label">Max Pain</div>';
      html += '<div class="metric-value">' + (indexData.maxPain ? indexData.maxPain.toFixed(0) : 'N/A') + '</div>';
      html += '<div class="metric-change">Strike Level</div></div>';
      html += '</div>';

      if (indexData.expiries && indexData.expiries.length > 0) {
        for (let i = 0; i < indexData.expiries.length; i++) {
          const exp = indexData.expiries[i];
          html += '<div class="expiry-section">';
          html += '<div class="expiry-title">' + exp.expiry + ' Expiry</div>';
          html += '<div class="card-row">';

          // CE Card
          html += '<div class="premium-card">';
          html += '<div class="card-title">📈 Call (CE)</div>';
          if (exp.ceData) {
            html += '<div class="card-grid">';
            html += '<div class="card-item"><span class="card-label">Strike</span><span class="card-value">' + exp.ceData.strike + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Last Price</span><span class="card-value">' + exp.ceData.lastPrice.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Bid / Ask</span><span class="card-value">' + exp.ceData.bid.toFixed(2) + ' / ' + exp.ceData.ask.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Change</span><span class="card-value ' + (exp.ceData.change >= 0 ? 'positive' : 'negative') + '">' + (exp.ceData.change >= 0 ? '+' : '') + exp.ceData.change.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">IV</span><span class="card-value">' + exp.ceData.iv.toFixed(2) + '%</span></div>';
            html += '<div class="card-item"><span class="card-label">OI</span><span class="card-value">' + (exp.ceData.oi / 1000000).toFixed(2) + 'M</span></div>';
            html += '</div>';
          } else {
            html += '<div class="card-grid"><div class="card-item"><span class="card-value unavailable">' + (exp.ceError || 'N/A') + '</span></div></div>';
          }
          html += '</div>';

          // PE Card
          html += '<div class="premium-card">';
          html += '<div class="card-title">📉 Put (PE)</div>';
          if (exp.peData) {
            html += '<div class="card-grid">';
            html += '<div class="card-item"><span class="card-label">Strike</span><span class="card-value">' + exp.peData.strike + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Last Price</span><span class="card-value">' + exp.peData.lastPrice.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Bid / Ask</span><span class="card-value">' + exp.peData.bid.toFixed(2) + ' / ' + exp.peData.ask.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">Change</span><span class="card-value ' + (exp.peData.change >= 0 ? 'positive' : 'negative') + '">' + (exp.peData.change >= 0 ? '+' : '') + exp.peData.change.toFixed(2) + '</span></div>';
            html += '<div class="card-item"><span class="card-label">IV</span><span class="card-value">' + exp.peData.iv.toFixed(2) + '%</span></div>';
            html += '<div class="card-item"><span class="card-label">OI</span><span class="card-value">' + (exp.peData.oi / 1000000).toFixed(2) + 'M</span></div>';
            html += '</div>';
          } else {
            html += '<div class="card-grid"><div class="card-item"><span class="card-value unavailable">' + (exp.peError || 'N/A') + '</span></div></div>';
          }
          html += '</div>';

          html += '</div></div>';
        }
      }

      return html;
    }

    function renderNews() {
      if (newsData.length === 0) {
        return '<div class="loading">Loading market news...</div>';
      }

      let html = '<div class="news-list">';
      for (const item of newsData) {
        const time = new Date(item.published).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += '<div class="news-item">';
        html += '<div class="news-title">' + item.title + '</div>';
        html += '<div class="news-meta">';
        html += '<span class="news-source">' + item.source + '</span>';
        html += '<span class="news-time">' + time + '</span>';
        html += '</div>';
        html += '<a href="' + item.url + '" target="_blank" class="news-link">Read →</a>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderHolidays() {
      if (holidaysData.length === 0) {
        return '<div class="loading">Loading holidays...</div>';
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
        html += '<div class="holiday-name">' + holiday.name + '</div>';
        if (isNext) {
          html += '<div class="holiday-badge">Next Holiday</div>';
          html += '<div class="holiday-countdown">in ' + daysUntil + ' days</div>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
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
    }

    function updateRefreshStatus() {
      lastRefreshTime = new Date();
      const now = lastRefreshTime;
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      document.getElementById('refreshStatus').textContent = 'Last: ' + timeStr;
    }

    async function refreshData() {
      document.getElementById('manualRefresh').disabled = true;
      await fetchData();
      setTimeout(() => {
        document.getElementById('manualRefresh').disabled = false;
      }, 500);
    }

    function toggleAutoRefresh() {
      const toggle = document.getElementById('autoRefreshToggle').checked;
      if (toggle) {
        autoRefreshInterval = setInterval(refreshData, 3 * 60 * 1000);
      } else {
        clearInterval(autoRefreshInterval);
      }
    }

    function showError(message) {
      const container = document.getElementById('errorContainer');
      container.innerHTML = '<div class="error">' + message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
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

    fetchData();
    checkKiteStatus();
    loadNews();
    loadHolidays();
    toggleAutoRefresh();

    setInterval(checkKiteStatus, 30000);
    setInterval(loadNews, 20 * 60 * 1000);

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

    // Fetch live data from Kite for all indices
    const results = await Promise.all([
      fetchIndexData(session.accessToken, "NIFTY"),
      fetchIndexData(session.accessToken, "BANKNIFTY"),
      fetchIndexData(session.accessToken, "SENSEX"),
    ]);

    const data: Record<string, IndexMetrics> = {
      NIFTY: results[0],
      BANKNIFTY: results[1],
      SENSEX: results[2],
    };

    console.log("======================================");
    console.log("    [API] /api/data response ready");
    console.log("======================================\n");
    return c.json(data);
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Filter to future holidays or today
  const upcomingHolidays = NSE_HOLIDAYS_2026.filter(h => {
    const hDate = new Date(h.date + 'T00:00:00');
    return hDate >= today;
  });

  return c.json(upcomingHolidays);
});

// Kite Login - Redirects to Kite login page
app.get("/api/kite/login", (c) => {
  const loginUrl = getKiteLoginUrl();
  console.log("[AUTH] Redirecting to Kite login");
  return c.redirect(loginUrl);
});

// Kite Callback - Exchanges request_token for access_token
app.get("/api/kite/callback", async (c) => {
  try {
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
    const sessionId = Math.random().toString(36).substring(2);
    sessions.set(sessionId, {
      accessToken: tokenData.accessToken,
      userId: tokenData.userId,
      email: tokenData.email,
      loginTime: Date.now(),
    });

    // Store session ID in secure HTTP-only cookie
    c.header(
      "Set-Cookie",
      `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
    );

    console.log("[AUTH] Session stored, redirecting to dashboard");
    return c.redirect("/?login_success=true");
  } catch (err) {
    console.error("[AUTH] Callback error:", err instanceof Error ? err.message : err);
    return c.redirect("/?login_error=true&error=Server+error");
  }
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
