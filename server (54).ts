import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

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
  tradingSymbol: string | null; // Kite's actual instrument tradingsymbol, e.g. NIFTY26AUG24600CE
  bid: number;
  ask: number;
  lastPrice: number;
  change: number;
  iv: number;
  oi: number;
  volume: number | null; // Kite's traded quantity for the day — needed for liquidity checks (rule 7)
  vwap: number | null; // Kite's average_price for this option, if provided
  vwapSource: "UNVERIFIED AVERAGE PRICE — NOT VWAP" | "VWAP UNAVAILABLE"; // Kite's average_price meaning has not been verified against provider docs to match a true session VWAP — never silently claim it is VWAP
  quoteTimestamp: string | null; // exchange/provider-side timestamp for THIS quote, distinct from backend receipt time
  atDayHigh: boolean;
  atDayLow: boolean;
  dayHigh: number; // today's intraday high (Kite's ohlc.high)
  dayLow: number; // today's intraday low (Kite's ohlc.low)
  pdc: number; // previous day close (Kite's ohlc.close)
  pdh: number; // previous trading day's high, for this specific strike's premium
  pdl: number; // previous trading day's low, for this specific strike's premium
  vega: number; // Black-Scholes estimate — NOT from Kite (Kite doesn't publish Greeks)
  theta: number; // Black-Scholes estimate, per-day decay — NOT from Kite
  delta: number; // Black-Scholes estimate — NOT from Kite
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
  quoteTimestamp: string | null; // exchange-side timestamp for THIS futures quote specifically, distinct from spot's exchangeTimestamp
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
  snapshotId: string; // backend-generated — identifies this index's spot+futures+options as one synchronized collection cycle. NOT supplied by Kite.
  exchangeTimestamp: string | null; // last_trade_time from Kite's spot quote, distinct from `timestamp` (backend receipt time)
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
    NIFTY?: { spot: number; pcr: number | null; vix: number };
    BANKNIFTY?: { spot: number; pcr: number | null; vix: number };
    SENSEX?: { spot: number; pcr: number | null; vix: number };
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

// ============== SESSION RECORDER (Phase 1: in-memory, no database or ==============
// ============== Google Drive yet — those are deferred, see chat) ==============
//
// Captures RAW backend market data only (spot, futures, ATM CE/PE,
// FII/DII). It does NOT capture computed signal states (Orchestrator
// stage, interpretation labels, etc.) — that logic lives entirely in the
// frontend HTML/JS template and is not accessible from this backend
// process. That would need duplicating client logic server-side, which
// is a larger follow-up, not part of this phase.
//
// Data lives only in this process's memory: it resets on every Railway
// restart/redeploy, and does not survive past that. This is a real
// limitation, disclosed on the dashboard itself, not hidden.

interface RecorderIndexSnapshot {
  spot: number | null;
  change: number | null;
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  futuresLtp: number | null;
  futuresOi: number | null;
  atmStrike: number | null;
  ceLtp: number | null;
  peLtp: number | null;
  ceOi: number | null;
  peOi: number | null;
  exchangeTimestamp: string | null;
  snapshotId: string | null;
}

interface RecorderSnapshot {
  snapshotId: string;
  backendTimestamp: string;
  reason: string; // 'SCHEDULED_3MIN' for now — event-based reasons are a later phase
  snapshotStatus: "LIVE" | "PARTIAL" | "STALE" | "INVALID";
  NIFTY: RecorderIndexSnapshot | null;
  BANKNIFTY: RecorderIndexSnapshot | null;
  SENSEX: RecorderIndexSnapshot | null;
  fiiCashCr: number | null;
  diiCashCr: number | null;
}

interface RecorderSession {
  tradingDate: string; // YYYY-MM-DD, Asia/Kolkata
  status: "IDLE" | "RECORDING" | "STOPPED" | "DEGRADED";
  startedAt: string | null;
  lastSnapshotAt: string | null;
  snapshots: RecorderSnapshot[];
  lastErrorRedacted: string | null;
}

const RECORDER_MAX_SNAPSHOTS = 200; // ~ full session at 3-min cadence (6.25hr / 3min ≈ 125) plus headroom

let recorderSession: RecorderSession = {
  tradingDate: "",
  status: "IDLE",
  startedAt: null,
  lastSnapshotAt: null,
  snapshots: [],
  lastErrorRedacted: null,
};

function toRecorderIndexSnapshot(m: IndexMetrics | undefined): RecorderIndexSnapshot | null {
  if (!m || m.error) return null;
  const exp = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  const atmCe = exp ? (exp.ceStrikes || []).find((s) => s.isAtm) : undefined;
  const atmPe = exp ? (exp.peStrikes || []).find((s) => s.isAtm) : undefined;
  const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
  return {
    spot: m.current > 0 ? m.current : null,
    change: m.change,
    pdh: m.pdh > 0 ? m.pdh : null,
    pdl: m.pdl > 0 ? m.pdl : null,
    vwap: m.vwap > 0 ? m.vwap : null,
    futuresLtp: contract && contract.ltp > 0 ? contract.ltp : null,
    futuresOi: contract && contract.oi != null ? contract.oi : null,
    atmStrike: atmCe ? atmCe.strike : atmPe ? atmPe.strike : null,
    ceLtp: atmCe && atmCe.lastPrice > 0 ? atmCe.lastPrice : null,
    peLtp: atmPe && atmPe.lastPrice > 0 ? atmPe.lastPrice : null,
    ceOi: atmCe ? atmCe.oi : null,
    peOi: atmPe ? atmPe.oi : null,
    exchangeTimestamp: m.exchangeTimestamp || null,
    snapshotId: m.snapshotId || null,
  };
}

function isMarketOpenNowServer(): boolean {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  return minutesSinceMidnight >= 9 * 60 + 15 && minutesSinceMidnight <= 15 * 60 + 30;
}

function indiaTradingDate(): string {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  return ist.toISOString().slice(0, 10);
}

function computeSnapshotStatus(indexSnaps: Array<RecorderIndexSnapshot | null>): "LIVE" | "PARTIAL" | "STALE" | "INVALID" {
  const validCount = indexSnaps.filter((s) => s !== null).length;
  if (validCount === 0) return "INVALID";
  if (validCount < indexSnaps.length) return "PARTIAL";
  const now = Date.now();
  const ages = indexSnaps
    .filter((s): s is RecorderIndexSnapshot => s !== null && !!s.exchangeTimestamp)
    .map((s) => now - new Date(s.exchangeTimestamp as string).getTime());
  if (ages.length === 0) return "PARTIAL"; // present but no timestamp to verify freshness
  const maxAgeMs = Math.max(...ages);
  if (maxAgeMs > 6 * 60 * 1000) return "STALE";
  return "LIVE";
}

async function captureRecorderSnapshot(reason: string): Promise<void> {
  try {
    const today = indiaTradingDate();
    if (recorderSession.tradingDate !== today) {
      // New trading day — start a fresh in-memory session. The previous
      // day's data is not carried over (no database yet to move it to).
      recorderSession = {
        tradingDate: today,
        status: "RECORDING",
        startedAt: new Date().toISOString(),
        lastSnapshotAt: null,
        snapshots: [],
        lastErrorRedacted: null,
      };
    }

    let activeSession: KiteSession | undefined;
    for (const s of sessions.values()) {
      if (s.expiresAt > Date.now()) { activeSession = s; break; }
    }
    if (!activeSession) {
      recorderSession.status = "DEGRADED";
      recorderSession.lastErrorRedacted = "No active Kite session available";
      return;
    }

    const snapshot = await refreshMarketSnapshot(activeSession);
    const niftySnap = toRecorderIndexSnapshot(snapshot.NIFTY);
    const bankSnap = toRecorderIndexSnapshot(snapshot.BANKNIFTY);
    const sensexSnap = toRecorderIndexSnapshot(snapshot.SENSEX);
    const entry: RecorderSnapshot = {
      snapshotId: `rec-${Date.now()}-${randomBytes(3).toString("hex")}`,
      backendTimestamp: new Date().toISOString(),
      reason,
      snapshotStatus: computeSnapshotStatus([niftySnap, bankSnap, sensexSnap]),
      NIFTY: niftySnap,
      BANKNIFTY: bankSnap,
      SENSEX: sensexSnap,
      fiiCashCr: fiiDiiEntries.length > 0 ? fiiDiiEntries[fiiDiiEntries.length - 1].fiiCashCr : null,
      diiCashCr: fiiDiiEntries.length > 0 ? fiiDiiEntries[fiiDiiEntries.length - 1].diiCashCr : null,
    };

    recorderSession.snapshots.push(entry);
    if (recorderSession.snapshots.length > RECORDER_MAX_SNAPSHOTS) recorderSession.snapshots.shift();
    recorderSession.lastSnapshotAt = entry.backendTimestamp;
    recorderSession.status = "RECORDING";
    recorderSession.lastErrorRedacted = null;

    appendJournalEntry();
  } catch (err) {
    recorderSession.status = "DEGRADED";
    recorderSession.lastErrorRedacted = err instanceof Error ? err.message : "Unknown recorder error";
    console.error("[Recorder] snapshot capture failed:", recorderSession.lastErrorRedacted);
  }
}

// ============== DAILY JOURNAL (rolling 3M/15M/30M interpretation) ==============
// Derives verdicts from the recorder's own stored snapshots — no live
// re-fetch. Rolling windows use the latest 5/10 valid snapshots
// (continuous, not reset at clock boundaries), per spec.

type JournalVerdict =
  | "STRONG CE BIAS" | "MILD CE BIAS" | "SIDEWAYS / RANGE" | "DATA MIXED \u2014 WAIT"
  | "MILD PE BIAS" | "STRONG PE BIAS" | "DATA INVALID \u2014 SIGNAL LOCKED";

interface JournalEntry {
  timestamp: string;
  nifty3m: JournalVerdict;
  nifty15m: JournalVerdict;
  nifty30m: JournalVerdict;
  sensex3m: JournalVerdict;
  sensex15m: JournalVerdict;
  sensex30m: JournalVerdict;
  combinedVerdict: JournalVerdict;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  dataHealth: string;
  leadingIndex: "NIFTY" | "SENSEX" | null;
  conflictingIndex: "NIFTY" | "SENSEX" | null;
  reason: string;
  notes: string[];
  verdictChanged: boolean;
  previousVerdict: JournalVerdict | null;
  currentVerdict: JournalVerdict;
}

const journalEntries: JournalEntry[] = [];
const JOURNAL_MAX_ENTRIES = 200;

function deriveSnapshotVerdict(current: RecorderIndexSnapshot | null, previous: RecorderIndexSnapshot | null): JournalVerdict {
  if (!current || (current.spot == null && current.futuresLtp == null)) return "DATA INVALID \u2014 SIGNAL LOCKED";
  if (!previous) return "DATA MIXED \u2014 WAIT";
  if (current.futuresLtp == null || previous.futuresLtp == null || current.futuresOi == null || previous.futuresOi == null) {
    return "DATA MIXED \u2014 WAIT";
  }
  const priceDir = current.futuresLtp > previous.futuresLtp ? "up" : current.futuresLtp < previous.futuresLtp ? "down" : "flat";
  const oiDir = current.futuresOi > previous.futuresOi ? "up" : current.futuresOi < previous.futuresOi ? "down" : "flat";
  if (priceDir === "flat" || oiDir === "flat") return "SIDEWAYS / RANGE";
  if (priceDir === "up" && oiDir === "up") return "STRONG CE BIAS";
  if (priceDir === "down" && oiDir === "up") return "STRONG PE BIAS";
  if (priceDir === "up" && oiDir === "down") return "MILD CE BIAS"; // short-covering-like
  return "MILD PE BIAS"; // down + OI down = long-unwinding-like
}

function deriveRollingVerdict(snapshots: RecorderSnapshot[], symbol: "NIFTY" | "SENSEX", windowCount: number): JournalVerdict {
  const window = snapshots.slice(-windowCount);
  if (window.length < 2) return "DATA MIXED \u2014 WAIT";
  const verdicts = window.map((_, i) => (i === 0 ? null : deriveSnapshotVerdict(window[i][symbol], window[i - 1][symbol])));
  const valid = verdicts.filter((v): v is JournalVerdict => v !== null);
  if (valid.length === 0) return "DATA MIXED \u2014 WAIT";
  if (valid.some((v) => v === "DATA INVALID \u2014 SIGNAL LOCKED")) return "DATA INVALID \u2014 SIGNAL LOCKED";
  const counts: Record<string, number> = {};
  valid.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  let best: JournalVerdict = "DATA MIXED \u2014 WAIT";
  let bestCount = 0;
  (Object.keys(counts) as JournalVerdict[]).forEach((k) => {
    if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
  });
  // Majority (>50%) required, else the window is genuinely mixed.
  if (bestCount / valid.length <= 0.5) return "DATA MIXED \u2014 WAIT";
  return best;
}

function verdictDirection(v: JournalVerdict): "CE" | "PE" | null {
  if (v.indexOf("CE") !== -1) return "CE";
  if (v.indexOf("PE") !== -1) return "PE";
  return null;
}

function combineVerdicts(niftyV: JournalVerdict, sensexV: JournalVerdict): { combined: JournalVerdict; leading: "NIFTY" | "SENSEX" | null; conflicting: "NIFTY" | "SENSEX" | null; reason: string } {
  const niftyDir = verdictDirection(niftyV);
  const sensexDir = verdictDirection(sensexV);
  if (niftyV === "DATA INVALID \u2014 SIGNAL LOCKED" || sensexV === "DATA INVALID \u2014 SIGNAL LOCKED") {
    return { combined: "DATA INVALID \u2014 SIGNAL LOCKED", leading: null, conflicting: null, reason: "One or both indices have invalid data" };
  }
  if (niftyDir && sensexDir && niftyDir !== sensexDir) {
    return { combined: "DATA MIXED \u2014 WAIT", leading: null, conflicting: niftyDir ? "SENSEX" : "NIFTY", reason: "NIFTY and SENSEX disagree" };
  }
  if (niftyV.indexOf("STRONG") === 0 && sensexV.indexOf("STRONG") === 0 && niftyDir === sensexDir) {
    return { combined: niftyV, leading: "NIFTY", conflicting: null, reason: "Both NIFTY and SENSEX show strong " + niftyDir + " bias" };
  }
  if (niftyDir && (niftyV.indexOf("STRONG") === 0 || niftyV.indexOf("MILD") === 0)) {
    return { combined: niftyV.indexOf("STRONG") === 0 ? ("MILD " + niftyDir + " BIAS" as JournalVerdict) : niftyV, leading: "NIFTY", conflicting: null, reason: "NIFTY leads, SENSEX neutral/unconfirmed" };
  }
  if (sensexDir && (sensexV.indexOf("STRONG") === 0 || sensexV.indexOf("MILD") === 0)) {
    return { combined: sensexV.indexOf("STRONG") === 0 ? ("MILD " + sensexDir + " BIAS" as JournalVerdict) : sensexV, leading: "SENSEX", conflicting: null, reason: "SENSEX leads, NIFTY neutral/unconfirmed" };
  }
  if (niftyV === "SIDEWAYS / RANGE" && sensexV === "SIDEWAYS / RANGE") {
    return { combined: "SIDEWAYS / RANGE", leading: null, conflicting: null, reason: "Both indices range-bound" };
  }
  return { combined: "DATA MIXED \u2014 WAIT", leading: null, conflicting: null, reason: "Insufficient confirmation" };
}

function generateImportantNotes(curr: JournalEntry, prev: JournalEntry | null): string[] {
  const notes: string[] = [];
  if (!prev) return notes;
  if (curr.currentVerdict !== prev.currentVerdict) {
    notes.push("Verdict changed: " + prev.currentVerdict + " \u2192 " + curr.currentVerdict);
    const prevStrength = prev.currentVerdict.indexOf("MILD") === 0;
    const currStrength = curr.currentVerdict.indexOf("STRONG") === 0;
    if (prevStrength && currStrength) notes.push("Mild became Strong");
    const prevDir = verdictDirection(prev.currentVerdict);
    const currDir = verdictDirection(curr.currentVerdict);
    if (prevDir === "CE" && currDir === "PE") notes.push("CE changed to PE");
    if (prevDir === "PE" && currDir === "CE") notes.push("PE changed to CE");
  }
  if (curr.leadingIndex !== prev.leadingIndex && curr.conflictingIndex) notes.push("NIFTY and SENSEX disagree");
  if (curr.dataHealth !== prev.dataHealth && curr.dataHealth.indexOf("STALE") !== -1) notes.push("Data became stale");
  if (curr.dataHealth.indexOf("INVALID") !== -1 && prev.dataHealth.indexOf("INVALID") === -1) notes.push("Feed disconnected or option data rejected");
  return notes;
}

function appendJournalEntry() {
  const snapshots = recorderSession.snapshots;
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return;
  const prevSnap = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

  const nifty3m = deriveSnapshotVerdict(latest.NIFTY, prevSnap ? prevSnap.NIFTY : null);
  const nifty15m = deriveRollingVerdict(snapshots, "NIFTY", 5);
  const nifty30m = deriveRollingVerdict(snapshots, "NIFTY", 10);
  const sensex3m = deriveSnapshotVerdict(latest.SENSEX, prevSnap ? prevSnap.SENSEX : null);
  const sensex15m = deriveRollingVerdict(snapshots, "SENSEX", 5);
  const sensex30m = deriveRollingVerdict(snapshots, "SENSEX", 10);

  const combo = combineVerdicts(nifty15m, sensex15m);
  const dataHealth = latest.snapshotStatus === "LIVE" ? "HEALTHY" : latest.snapshotStatus === "PARTIAL" ? "PARTIAL — SOME FIELDS MISSING" : latest.snapshotStatus === "STALE" ? "STALE" : "INVALID";
  const confidence: "LOW" | "MEDIUM" | "HIGH" =
    combo.combined.indexOf("STRONG") === 0 && dataHealth === "HEALTHY" ? "HIGH" :
    (combo.combined.indexOf("MILD") === 0 && dataHealth === "HEALTHY") ? "MEDIUM" : "LOW";

  const previousEntry = journalEntries.length > 0 ? journalEntries[journalEntries.length - 1] : null;

  const entry: JournalEntry = {
    timestamp: latest.backendTimestamp,
    nifty3m, nifty15m, nifty30m,
    sensex3m, sensex15m, sensex30m,
    combinedVerdict: combo.combined,
    confidence,
    dataHealth,
    leadingIndex: combo.leading,
    conflictingIndex: combo.conflicting,
    reason: combo.reason,
    notes: [],
    verdictChanged: previousEntry ? previousEntry.combinedVerdict !== combo.combined : false,
    previousVerdict: previousEntry ? previousEntry.combinedVerdict : null,
    currentVerdict: combo.combined,
  };
  entry.notes = generateImportantNotes(entry, previousEntry);

  journalEntries.push(entry);
  if (journalEntries.length > JOURNAL_MAX_ENTRIES) journalEntries.shift();
}

let lastRecorderSlot = -1;
setInterval(() => {
  if (!isMarketOpenNowServer()) return;
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  const slot = Math.floor(minutesSinceMidnight / 3); // one slot per 3-minute window
  if (slot === lastRecorderSlot) return; // already captured this slot
  lastRecorderSlot = slot;
  void captureRecorderSnapshot("SCHEDULED_3MIN");
}, 30 * 1000); // check every 30s so we don't miss the 3-min boundary


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

function calcGreeks(
  spot: number,
  strike: number,
  ivPercent: number,
  daysToExpiry: number,
  isCall: boolean
): { vega: number; theta: number; delta: number } {
  if (spot <= 0 || strike <= 0 || ivPercent <= 0 || daysToExpiry <= 0) return { vega: 0, theta: 0, delta: 0 };
  const sigma = ivPercent / 100;
  const T = daysToExpiry / 365;
  const r = BS_RISK_FREE_RATE;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const vega = (spot * normPdf(d1) * sqrtT) / 100; // change in premium per 1% IV move
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;

  let thetaAnnual: number;
  if (isCall) {
    thetaAnnual =
      -(spot * normPdf(d1) * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * normCdf(d2);
  } else {
    thetaAnnual =
      -(spot * normPdf(d1) * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * normCdf(-d2);
  }
  const thetaPerDay = thetaAnnual / 365;

  return { vega, theta: thetaPerDay, delta };
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

// USDINR — Kite's currency derivatives (CDS exchange), used for the CONTEXT
// tab's Macro-VIX chip. A risk modifier per spec, not a direct CE/PE trigger.
interface UsdInrData {
  current: number;
  changePercent: number;
  futuresSymbol: string | null;
  error?: string;
}

function findActiveCurrencyFuture(instruments: Instrument[], pair: string): Instrument | null {
  const today = indiaDate();
  const futures = instruments.filter(
    (inst) =>
      inst.exchange === "CDS" &&
      inst.instrument_type === "FUT" &&
      inst.tradingsymbol.startsWith(pair)
  );
  return (
    futures
      .filter((inst) => parseExpiryDate(inst.expiry) && inst.expiry >= today)
      .sort((a, b) => a.expiry.localeCompare(b.expiry))[0] || null
  );
}

async function fetchUsdInrData(accessToken: string, instruments: Instrument[]): Promise<UsdInrData> {
  const inst = findActiveCurrencyFuture(instruments, "USDINR");
  if (!inst) {
    return { current: 0, changePercent: 0, futuresSymbol: null, error: "No active USDINR futures contract found" };
  }
  const kiteSymbol = `${inst.exchange}:${inst.tradingsymbol}`;
  const quotes = await fetchKiteQuote(accessToken, [kiteSymbol]);
  const q = quotes?.[kiteSymbol];
  if (!q) {
    return { current: 0, changePercent: 0, futuresSymbol: inst.tradingsymbol, error: `No live quote for ${inst.tradingsymbol}` };
  }
  const prevClose = q.ohlc?.close || 0;
  const changePercent = prevClose > 0 ? ((q.last_price - prevClose) / prevClose) * 100 : 0;
  return { current: q.last_price || 0, changePercent, futuresSymbol: inst.tradingsymbol };
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
            const greeks = calcGreeks(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, true);
            baseMetrics.ceStrikes.push({
              strike,
              isAtm,
              tradingSymbol: ceInst.tradingsymbol || null,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              volume: oq.volume != null ? oq.volume : null,
              vwap: oq.average_price && oq.average_price > 0 ? oq.average_price : null,
              vwapSource: (oq.average_price && oq.average_price > 0) ? "UNVERIFIED AVERAGE PRICE — NOT VWAP" : "VWAP UNAVAILABLE",
              quoteTimestamp: oq.last_trade_time || oq.timestamp || null,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
              delta: greeks.delta,
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
            const greeks = calcGreeks(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, false);
            baseMetrics.peStrikes.push({
              strike,
              isAtm,
              tradingSymbol: peInst.tradingsymbol || null,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              volume: oq.volume != null ? oq.volume : null,
              vwap: oq.average_price && oq.average_price > 0 ? oq.average_price : null,
              vwapSource: (oq.average_price && oq.average_price > 0) ? "UNVERIFIED AVERAGE PRICE — NOT VWAP" : "VWAP UNAVAILABLE",
              quoteTimestamp: oq.last_trade_time || oq.timestamp || null,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
              delta: greeks.delta,
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
    snapshotId: `${symbol}-${Date.now()}-${randomBytes(4).toString("hex")}`,
    exchangeTimestamp: null,
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
    // Rule 4: only the genuine last-trade time counts as an "exchange
    // market timestamp" — Kite's own response-timestamp field can reflect
    // when the API call was answered (close to "now"), not when a trade
    // actually occurred, which would be misleading during pre-market/closed
    // periods. No fallback to that field here.
    baseMetrics.exchangeTimestamp = spotQuote.last_trade_time || null;

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
          quoteTimestamp: q?.last_trade_time || null,
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
          `[${symbol}] Fetching ${expiryName} options (${expiryDate}): ATM ${baseMetrics.atmStrike} ${symbol === "BANKNIFTY" ? "±6" : "±10"} strikes`
        );

        const optExchange = EXCHANGE_CODES[symbol as keyof typeof EXCHANGE_CODES];
        const optionMap = buildOptionMap(instruments, symbol, expiryDate);

        // ATM-2, ATM-1, ATM, ATM+1, ATM+2
        // BankNifty: ATM±6. NIFTY/SENSEX: ATM±10 (spec's "detailed table" range).
        const offsets =
          symbol === "BANKNIFTY"
            ? [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
            : [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
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
                const greeks = calcGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, true);
                expiry.ceStrikes.push({
                  strike,
                  isAtm,
                  tradingSymbol: ceInst.tradingsymbol || null,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  volume: q.volume != null ? q.volume : null,
                  vwap: q.average_price && q.average_price > 0 ? q.average_price : null,
                  vwapSource: (q.average_price && q.average_price > 0) ? "UNVERIFIED AVERAGE PRICE — NOT VWAP" : "VWAP UNAVAILABLE",
                  quoteTimestamp: q.last_trade_time || q.timestamp || null,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
              delta: greeks.delta,
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
                const greeks = calcGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, false);
                expiry.peStrikes.push({
                  strike,
                  isAtm,
                  tradingSymbol: peInst.tradingsymbol || null,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  volume: q.volume != null ? q.volume : null,
                  vwap: q.average_price && q.average_price > 0 ? q.average_price : null,
                  vwapSource: (q.average_price && q.average_price > 0) ? "UNVERIFIED AVERAGE PRICE — NOT VWAP" : "VWAP UNAVAILABLE",
                  quoteTimestamp: q.last_trade_time || q.timestamp || null,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
              delta: greeks.delta,
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
      NIFTY: { spot: snapshot.NIFTY.current, pcr: snapshot.NIFTY.pcr, vix: snapshot.NIFTY.vix },
      BANKNIFTY: { spot: snapshot.BANKNIFTY.current, pcr: snapshot.BANKNIFTY.pcr, vix: snapshot.BANKNIFTY.vix },
      SENSEX: { spot: snapshot.SENSEX.current, pcr: snapshot.SENSEX.pcr, vix: snapshot.SENSEX.vix },
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

    <div id="connectionStatusBar"></div>

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
      <button class="tab-btn" onclick="switchTab('JOURNAL')">📓 Journal</button>
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
    <div id="JOURNAL" class="tab-content"></div>
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

    // Rule 2: single shared connection state used everywhere, computed
    // from data age (0-210s LIVE, 211-360s DELAYED, >360s DISCONNECTED)
    // and consecutive-failure count (2nd failure forces DELAYED, 3rd
    // forces DISCONNECTED and locks signals).
    let connectionState = 'DISCONNECTED';
    let consecutiveFetchFailures = 0;
    let lastSuccessfulFetchTime = null;

    function computeConnectionState() {
      if (!kiteConnected) return 'DISCONNECTED';
      if (consecutiveFetchFailures >= 3) return 'DISCONNECTED';
      if (consecutiveFetchFailures >= 2) return 'DELAYED';
      if (!lastSuccessfulFetchTime) return 'DISCONNECTED';
      const ageSec = (Date.now() - lastSuccessfulFetchTime) / 1000;
      if (ageSec <= 210) return 'LIVE';
      if (ageSec <= 360) return 'DELAYED';
      return 'DISCONNECTED';
    }

    async function fetchData(isRetry) {
      if (!kiteConnected) return;
      try {
        const response = await fetch('/api/data');
        const json = await response.json();

        if (!response.ok || json.error) {
          throw new Error(json.error || ('HTTP ' + response.status));
        }

        mergeServerHistory(json._history);
        primeStrikeTrackersFromServer(json._prevStrikeValues);
        data = {
          NIFTY: json.NIFTY,
          BANKNIFTY: json.BANKNIFTY,
          SENSEX: json.SENSEX,
        };
        consecutiveFetchFailures = 0;
        lastSuccessfulFetchTime = Date.now();
        connectionState = computeConnectionState();
        updateUI();
        updateRefreshStatus();
        clearError();
      } catch (err) {
        consecutiveFetchFailures++;
        connectionState = computeConnectionState();
        if (consecutiveFetchFailures === 1 && !isRetry) {
          // First failure: retry silently after 10s, no visible error yet.
          setTimeout(() => { fetchData(true); }, 10000);
          return;
        }
        showError('Error: ' + err.message);
        updateUI();
      }
    }

    function renderConnectionStatusBar() {
      const state = connectionState;
      const color = state === 'LIVE' ? 'var(--green)' : state === 'DELAYED' ? 'var(--gold)' : 'var(--red)';
      const lastUpdateText = lastSuccessfulFetchTime ? new Date(lastSuccessfulFetchTime).toLocaleTimeString() : 'DATA UNAVAILABLE';
      const nextRefreshText = (typeof countdownSeconds !== 'undefined' && document.getElementById('autoRefreshToggle') && document.getElementById('autoRefreshToggle').checked)
        ? Math.floor(countdownSeconds / 60) + ':' + String(countdownSeconds % 60).padStart(2, '0')
        : 'PAUSED';
      // Point 1: three distinct concepts, each explicitly labeled so they
      // are never conflated \u2014 Kite Authentication Session is shown
      // separately in the header above (Status: Connected/email); this bar
      // covers only the Live Market Quote Feed and Last Successful Refresh.
      let html = '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:10px; font-size:0.72rem; flex-wrap:wrap; gap:4px;">';
      html += '<span><span style="color:var(--muted);">Live Quote Feed: </span><span style="color:' + color + '; font-weight:700;">' + escapeHtml(state) + '</span></span>';
      html += '<span style="color:var(--muted);">Last Successful Refresh: ' + escapeHtml(lastUpdateText) + '</span>';
      html += '<span style="color:var(--muted);">Next: ' + escapeHtml(nextRefreshText) + '</span>';
      html += '</div>';
      return html;
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

    let recorderStatusData = null;
    async function loadRecorderStatus() {
      try {
        const response = await fetch('/api/recorder/status');
        const json = await response.json();
        recorderStatusData = response.ok ? json : { error: json.error || 'Failed to load recorder status' };
        updateUI();
      } catch (err) {
        console.error('Failed to load recorder status:', err);
        recorderStatusData = { error: err.message };
      }
    }
    setInterval(loadRecorderStatus, 60 * 1000);

    let driveStatusData = null;
    async function loadDriveStatus() {
      try {
        const response = await fetch('/api/drive/status');
        const json = await response.json();
        driveStatusData = response.ok ? json : { error: json.error || 'Failed to load Drive status' };
        updateUI();
      } catch (err) {
        console.error('Failed to load Drive status:', err);
        driveStatusData = { error: err.message };
      }
    }
    setInterval(loadDriveStatus, 60 * 1000);

    async function testDriveUpload() {
      try {
        showSuccess('Testing Drive upload...');
        const response = await fetch('/api/drive/test-upload', { method: 'POST' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Test upload failed');
        showSuccess('\u2713 Test upload succeeded (file ID: ' + json.fileId + ')');
      } catch (err) {
        showError('Drive test upload failed: ' + err.message);
      }
    }

    async function archiveToDrive() {
      try {
        showSuccess('Archiving to Google Drive...');
        const response = await fetch('/api/drive/archive', { method: 'POST' });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Archive failed');
        showSuccess('\u2713 Archive verified and uploaded to Google Drive');
        await loadDriveStatus();
      } catch (err) {
        showError('Archive failed \u2014 data retained locally: ' + err.message);
      }
    }

    let journalData = null;
    async function loadJournalData() {
      try {
        const response = await fetch('/api/journal');
        const json = await response.json();
        journalData = response.ok ? json : { error: json.error || 'Failed to load journal' };
        updateUI();
      } catch (err) {
        console.error('Failed to load journal:', err);
        journalData = { error: err.message };
      }
    }
    setInterval(loadJournalData, 60 * 1000);

    function journalVerdictColorJs(v) {
      if (v.indexOf('CE') !== -1 && v.indexOf('STRONG') === 0) return '#1D9E75';
      if (v.indexOf('CE') !== -1) return '#5DCAA5';
      if (v.indexOf('PE') !== -1 && v.indexOf('STRONG') === 0) return '#D85A30';
      if (v.indexOf('PE') !== -1) return '#F0997B';
      if (v.indexOf('WAIT') !== -1 || v.indexOf('INVALID') !== -1) return '#EF9F27';
      if (v.indexOf('SIDEWAYS') === 0) return '#378ADD';
      return '#888780';
    }

    function renderJournalTab() {
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Daily Journal \u2014 NIFTY + SENSEX</div>';
      if (!journalData) {
        html += '<div class="loading">Loading journal...</div></div>';
        return html;
      }
      if (journalData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(journalData.error) + '</div></div>';
        return html;
      }
      html += rowLine('Trading Date', journalData.tradingDate || 'DATA UNAVAILABLE');
      html += rowLine('Entries Recorded', String(journalData.entryCount));
      html += '<div style="margin-top:8px;">';
      html += '<a href="/api/journal/text" download style="color:var(--gold); font-size:0.75rem; text-decoration:underline; margin-right:14px;">\u2b07 Download as Text</a>';
      html += '<a href="/api/drive/archive" style="color:var(--muted); font-size:0.72rem;">(Archive Now is in Advanced Diagnostics \u2192 Google Drive)</a>';
      html += '</div>';
      html += '</div>';

      const entries = (journalData.entries || []).slice().reverse();
      if (entries.length === 0) {
        html += '<div class="premium-card"><div class="unavailable-text">No journal entries yet \u2014 builds automatically every 3 minutes during market hours.</div></div>';
        return html;
      }

      entries.forEach((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const combinedColor = journalVerdictColorJs(e.combinedVerdict);
        html += '<div class="premium-card" style="margin-bottom:10px; border-left:4px solid ' + combinedColor + ';">';
        html += '<div style="color:var(--gold); font-weight:700; font-size:0.8rem; margin-bottom:6px;">' + time + '</div>';

        function badge(label) {
          const c = journalVerdictColorJs(label);
          return '<span class="badge-pill" style="background:' + c + '; color:#12121e; font-weight:700; font-size:0.62rem; margin-right:4px;">' + escapeHtml(label) + '</span>';
        }

        html += '<div style="font-size:0.72rem; color:var(--muted); margin-bottom:2px;">NIFTY 3m/15m/30m</div>';
        html += '<div style="margin-bottom:6px;">' + badge(e.nifty3m) + badge(e.nifty15m) + badge(e.nifty30m) + '</div>';
        html += '<div style="font-size:0.72rem; color:var(--muted); margin-bottom:2px;">SENSEX 3m/15m/30m</div>';
        html += '<div style="margin-bottom:8px;">' + badge(e.sensex3m) + badge(e.sensex15m) + badge(e.sensex30m) + '</div>';

        html += '<div style="padding-top:6px; border-top:1px solid var(--border);">';
        html += badge(e.combinedVerdict) + '<span style="color:var(--muted); font-size:0.7rem;"> (' + e.confidence + ' confidence)</span>';
        html += '</div>';
        html += '<div style="color:var(--muted); font-size:0.7rem; margin-top:4px;">' + escapeHtml(e.reason) + '</div>';
        if (e.leadingIndex) html += '<div style="color:var(--muted); font-size:0.7rem;">Leading: ' + e.leadingIndex + '</div>';
        if (e.conflictingIndex) html += '<div style="color:var(--muted); font-size:0.7rem;">Conflicting: ' + e.conflictingIndex + '</div>';
        if (e.verdictChanged) html += '<div style="color:var(--gold); font-weight:700; font-size:0.72rem; margin-top:4px;">\u26a1 Changed from: ' + escapeHtml(e.previousVerdict) + '</div>';
        if (e.notes && e.notes.length > 0) {
          html += '<div style="background:rgba(201,162,39,0.1); border-left:3px solid var(--gold); padding:6px 8px; margin-top:6px; font-size:0.7rem; color:var(--gold);">';
          e.notes.forEach((n) => { html += '\u2022 ' + escapeHtml(n) + '<br>'; });
          html += '</div>';
        }
        html += '</div>';
      });

      return html;
    }

    function renderJournalCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Daily Journal \u2014 NIFTY + SENSEX</div>';
      if (!journalData) {
        html += '<div class="loading">Loading journal...</div></div>';
        return html;
      }
      if (journalData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(journalData.error) + '</div></div>';
        return html;
      }
      const entries = journalData.entries || [];
      html += rowLine('Entries Recorded', String(journalData.entryCount));
      if (entries.length === 0) {
        html += '<div class="timestamp">No journal entries yet \u2014 builds automatically every 3 minutes during market hours.</div></div>';
        return html;
      }
      const latest = entries[entries.length - 1];
      const color = latest.combinedVerdict.indexOf('CE') !== -1 ? 'var(--green)' : latest.combinedVerdict.indexOf('PE') !== -1 ? 'var(--red)' : latest.combinedVerdict.indexOf('SIDEWAYS') === 0 ? 'var(--muted)' : 'var(--gold)';
      html += '<div style="margin:8px 0;">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase;">Latest Combined Verdict</div>';
      html += '<div style="color:' + color + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(latest.combinedVerdict) + '</div>';
      html += '<div style="color:var(--muted); font-size:0.72rem; margin-top:2px;">Confidence: ' + latest.confidence + ' \u00b7 ' + escapeHtml(latest.reason) + '</div>';
      html += '</div>';

      if (latest.notes && latest.notes.length > 0) {
        html += '<div style="background:rgba(201,162,39,0.1); border-left:3px solid var(--gold); padding:6px 8px; margin-bottom:8px;">';
        latest.notes.forEach((n) => { html += '<div style="color:var(--gold); font-size:0.72rem;">\u2022 ' + escapeHtml(n) + '</div>'; });
        html += '</div>';
      }

      html += '<a href="/api/journal/text" download style="display:inline-block; color:var(--gold); font-size:0.75rem; text-decoration:underline; margin-bottom:8px;">\u2b07 Download Journal as Text</a> &nbsp; ';
      html += '<a href="/api/journal/html" target="_blank" style="display:inline-block; color:var(--gold); font-size:0.75rem; text-decoration:underline; margin-bottom:8px;">\ud83c\udfa8 View Colorful Journal</a><br>';
      html += '<details><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">View Live Journal (last ' + entries.length + ' entries)</summary>';
      html += '<div style="margin-top:8px; max-height:300px; overflow-y:auto;">';
      entries.slice().reverse().forEach((e) => {
        html += '<div style="border-top:1px solid var(--border); padding:6px 0; font-size:0.68rem;">';
        html += '<div style="color:var(--muted);">' + new Date(e.timestamp).toLocaleTimeString() + '</div>';
        html += '<div style="color:var(--text);">NIFTY 3m/15m/30m: ' + e.nifty3m + ' / ' + e.nifty15m + ' / ' + e.nifty30m + '</div>';
        html += '<div style="color:var(--text);">SENSEX 3m/15m/30m: ' + e.sensex3m + ' / ' + e.sensex15m + ' / ' + e.sensex30m + '</div>';
        html += '<div style="color:var(--muted);">Combined: ' + e.combinedVerdict + ' (' + e.confidence + ')</div>';
        if (e.notes && e.notes.length > 0) html += '<div style="color:var(--gold);">' + e.notes.join(', ') + '</div>';
        html += '</div>';
      });
      html += '</div></details>';
      html += '<div class="timestamp">Derived entirely from this session\u2019s own recorded snapshots (no live re-fetch). Rolling 15m/30m use the latest 5/10 valid snapshots continuously \u2014 not reset at clock boundaries. PDF export not yet available; use Drive Archive for JSON/CSV.</div>';
      html += '</div>';
      return html;
    }

    function renderDriveCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Google Drive Journal Archive</div>';
      if (!driveStatusData) {
        html += '<div class="loading">Loading Drive status...</div></div>';
        return html;
      }
      if (driveStatusData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(driveStatusData.error) + '</div></div>';
        return html;
      }
      const d = driveStatusData;
      if (!d.connected) {
        html += '<div style="color:var(--muted); font-size:0.8rem; margin-bottom:8px;">Not connected</div>';
        html += '<a href="/api/drive/connect" style="display:inline-block; background:var(--gold); color:#1a1a2e; font-weight:700; padding:8px 14px; border-radius:6px; text-decoration:none; font-size:0.8rem;">Connect Google Drive</a>';
        html += '<div class="timestamp">Opens Google\u2019s consent screen in your browser. Only the minimum Drive scope (files this app creates) is requested \u2014 never full Drive access. Refresh token is encrypted at rest.</div>';
        html += '</div>';
        return html;
      }

      html += rowLine('Account', d.connectedEmail || 'DATA UNAVAILABLE');
      html += rowLine('Connected Since', d.connectedAt ? new Date(d.connectedAt).toLocaleString() : 'DATA UNAVAILABLE');
      html += rowLine('Target Folder', d.targetFolder);
      if (d.lastArchive) {
        html += rowLine('Last Archive Date', d.lastArchive.date);
        html += rowLine('Last Archive Status', d.lastArchive.status);
        if (d.lastArchive.lastError) html += rowLine('Last Archive Error', d.lastArchive.lastError);
      }
      if (d.lastError) html += rowLine('Last Error', d.lastError);

      html += '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">';
      html += '<button onclick="testDriveUpload()" style="background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:6px 10px; font-size:0.7rem; cursor:pointer;">Test Drive Upload</button>';
      html += '<button onclick="archiveToDrive()" style="background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:6px 10px; font-size:0.7rem; cursor:pointer;">Archive Now</button>';
      html += '</div>';
      html += '<div class="timestamp">Phase 1: uploads Raw JSON, CSV, Summary JSON and an Archive Verification manifest. PDF generation is deferred (no PDF library available yet). Dashboard session data is never cleared until archive upload is verified \u2014 if archive fails, data stays local and the status shows ARCHIVE_FAILED, never a silent deletion.</div>';
      html += '</div>';
      return html;
    }

    function renderRecorderCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Session Recorder</div>';
      if (!recorderStatusData) {
        html += '<div class="loading">Loading recorder status...</div></div>';
        return html;
      }
      if (recorderStatusData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(recorderStatusData.error) + '</div></div>';
        return html;
      }
      const s = recorderStatusData;
      const statusColor = s.status === 'RECORDING' ? 'var(--green)' : s.status === 'DEGRADED' ? 'var(--gold)' : 'var(--muted)';
      html += '<div style="color:' + statusColor + '; font-weight:700; font-size:0.85rem; margin-bottom:6px;">' + s.status + '</div>';
      html += rowLine('Trading Date', s.tradingDate || 'DATA UNAVAILABLE');
      html += rowLine('Snapshots Saved', String(s.snapshotCount));
      html += rowLine('Last Snapshot', s.lastSnapshotAt ? new Date(s.lastSnapshotAt).toLocaleTimeString() : 'DATA UNAVAILABLE');
      if (s.lastErrorRedacted) html += rowLine('Last Error', s.lastErrorRedacted);
      html += '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">';
      html += '<a href="/api/recorder/session.csv" download style="color:var(--gold); font-size:0.72rem; text-decoration:underline;">Download CSV</a>';
      html += '<a href="/api/recorder/session.json" download style="color:var(--gold); font-size:0.72rem; text-decoration:underline;">Download JSON</a>';
      html += '</div>';
      html += '<div class="timestamp">Phase 1: in-memory only, resets on server restart \u2014 no database or Google Drive archive yet. Captures raw spot/futures/ATM CE-PE/FII-DII data every 3 minutes during market hours; does not yet include computed signal states (Orchestrator, interpretations), which live only in this browser session.</div>';
      html += '</div>';
      return html;
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
        if (!el) return;
        if (fieldId.indexOf('Bias') !== -1) {
          el.value = normalizeBias(value) || value;
        } else {
          el.value = value;
        }
        filled++;
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

    function normalizeBias(raw) {
      if (!raw) return null;
      const v = raw.trim().toLowerCase();
      if (v === 'long' || v === 'long buildup') return 'Long Buildup';
      if (v === 'short' || v === 'short buildup') return 'Short Buildup';
      if (v === 'long unwinding') return 'Long Unwinding';
      if (v === 'short covering') return 'Short Covering';
      return null;
    }

    const BULK_DERIV_LABELS = [
      { oi: 'Index Futures OI', bias: 'Index Futures Bias', category: 'Index Futures' },
      { oi: 'Stock Futures OI', bias: 'Stock Futures Bias', category: 'Stock Futures' },
      { oi: 'Index Options Call OI', bias: 'Index Options Call Bias', category: 'Index Options (Call)' },
      { oi: 'Index Options Put OI', bias: 'Index Options Put Bias', category: 'Index Options (Put)' },
    ];

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
        const rawFields = {};
        block.split('\\n').forEach((line) => {
          const idx = line.indexOf(':');
          if (idx === -1) return;
          const label = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim();
          rawFields[label] = value;
          if (label === 'Date') entry.date = value;
          else if (label === 'FII Cash') entry.fiiCashCr = parseFloat(value) || 0;
          else if (label === 'DII Cash') entry.diiCashCr = parseFloat(value) || 0;
        });
        BULK_DERIV_LABELS.forEach((d) => {
          if (rawFields[d.oi] != null || rawFields[d.bias] != null) {
            entry.derivatives.push({
              category: d.category,
              oiChange: parseFloat(rawFields[d.oi]) || 0,
              bias: normalizeBias(rawFields[d.bias]) || 'Long Buildup',
            });
          }
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
    // Data age should be measured from the exchange/provider timestamp
    // where available, per Step 4B rule 6 — falls back to the backend
    // receipt timestamp only when the exchange one is missing.
    function getEffectiveTimestamp(m) {
      if (!m) return null;
      return m.exchangeTimestamp || m.timestamp || null;
    }

    function isMarketOpenNow() {
      const now = new Date();
      const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const ist = new Date(istString);
      const day = ist.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) return false;
      const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
      return minutesSinceMidnight >= (9 * 60 + 15) && minutesSinceMidnight <= (15 * 60 + 30);
    }

    // Weekday, before 9:15 IST specifically (distinct from "weekend" or
    // "closed after 3:30 PM", which are not "pre-market waiting").
    function isPreMarket() {
      const now = new Date();
      const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const ist = new Date(istString);
      const day = ist.getDay();
      if (day === 0 || day === 6) return false;
      const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
      return minutesSinceMidnight < (9 * 60 + 15);
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
          hist.push({ time, spot: point.spot, pcr: point.pcr, vix: Number.isFinite(point.vix) ? point.vix : null });
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
      connectionState = computeConnectionState();
      const barEl = document.getElementById('connectionStatusBar');
      if (barEl) barEl.innerHTML = renderConnectionStatusBar();

      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((symbol) => {
        const el = document.getElementById(symbol);
        if (el) el.innerHTML = renderIndexPage(symbol);
      });

      document.getElementById('NEWS').innerHTML = renderNews();
      document.getElementById('JOURNAL').innerHTML = renderJournalTab();
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

      html += '<div class="metric-card"><div class="metric-label">Futures-Derived VWAP Proxy</div>';
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

    // Three-Index Alignment classification. Reuses classifyIndexOverallBias
    // (unchanged signal logic) and buckets its output into bullish/bearish/
    // neutral/unclear for alignment counting. This is a new display layer
    // only — no new strategy/detection logic beyond simple field checks.
    function biasToBucket(bias) {
      if (bias === 'STRONG CE BIAS' || bias === 'MILD CE BIAS') return 'bullish';
      if (bias === 'STRONG PE BIAS' || bias === 'MILD PE BIAS') return 'bearish';
      if (bias === 'SIDEWAYS / RANGE') return 'neutral';
      return 'unclear'; // WAIT — CONFLICTING DATA, or DATA UNAVAILABLE
    }

    function computeMissingReasons(m) {
      const reasons = [];
      if (!m || m.error) { reasons.push('Stale data'); return reasons; }
      if (!m.vwap || m.vwap === 0) reasons.push('Futures-Derived VWAP Proxy not confirmed');
      if (m.futuresVwapBias === 'UNKNOWN') reasons.push('Futures conflict');
      const exp = (m.expiries || [])[0];
      const hasAtmCe = exp && (exp.ceStrikes || []).some((s) => s.isAtm);
      const hasAtmPe = exp && (exp.peStrikes || []).some((s) => s.isAtm);
      if (!exp || !hasAtmCe || !hasAtmPe) reasons.push('Premium pair incomplete');
      if (m.signal === 'WAIT') reasons.push('Break-hold-retest pending');
      const effTs1 = getEffectiveTimestamp(m);
      if (effTs1) {
        const ageMs = Date.now() - new Date(effTs1).getTime();
        if (ageMs > 6 * 60 * 1000) reasons.push('Stale data');
      }
      return reasons;
    }

    function computeAlignmentStatus(buckets) {
      const values = [buckets.NIFTY, buckets.BANKNIFTY, buckets.SENSEX];
      if (values.indexOf('unclear') !== -1) {
        return 'DATA INCOMPLETE';
      }
      const bullishCount = values.filter((v) => v === 'bullish').length;
      const bearishCount = values.filter((v) => v === 'bearish').length;
      const neutralCount = values.filter((v) => v === 'neutral').length;

      if (bullishCount === 3) return '3/3 BULLISH ALIGNED';
      if (bearishCount === 3) return '3/3 BEARISH ALIGNED';
      if ((bullishCount === 2 || bearishCount === 2) && neutralCount === 1) return '2 ALIGNED + 1 NEUTRAL';
      if (buckets.NIFTY !== buckets.BANKNIFTY && buckets.NIFTY !== 'neutral' && buckets.BANKNIFTY !== 'neutral') return 'BANKING CONFLICT';
      return 'CROSS-INDEX CONFLICT';
    }

    function collectMissingReasons(status, niftyM, bankM, sensexM) {
      if (status !== 'BANKING CONFLICT' && status !== 'CROSS-INDEX CONFLICT' && status !== 'DATA INCOMPLETE') return [];
      const reasonSet = {};
      [niftyM, bankM, sensexM].forEach((m) => {
        computeMissingReasons(m).forEach((r) => { reasonSet[r] = true; });
      });
      if (status === 'BANKING CONFLICT' || status === 'CROSS-INDEX CONFLICT') reasonSet['Cross-index conflict'] = true;
      return Object.keys(reasonSet);
    }

    // DATA RELIABILITY — spec Step 2. Only checks what the current data
    // model genuinely tracks: one timestamp per index (not separate
    // spot/futures/options-within-index timestamps). Cross-index
    // (NIFTY/BANKNIFTY/SENSEX) timestamp sync is checked as the closest
    // honest proxy for "snapshot" consistency; DATA UNAVAILABLE is shown
    // for anything finer-grained that is not actually tracked.
    const SYNC_TOLERANCE_MS = 60 * 1000; // PROVISIONAL — configurable, not backtested
    const STALE_THRESHOLD_MS = 6 * 60 * 1000; // matches the LIVE/DELAYED/STALE convention used elsewhere

    function computeDataReliability() {
      if (!kiteConnected) {
        return { status: 'BROKER DISCONNECTED', perIndex: null, oldestAgeSec: null, snapshotId: null, lockReason: 'BROKER DISCONNECTED — SIGNAL LOCKED' };
      }
      if (!data) {
        if (isPreMarket()) {
          return { status: 'PRE-MARKET \u2014 WAITING FOR LIVE SESSION', perIndex: null, oldestAgeSec: null, snapshotId: null, lockReason: 'MARKET NOT OPEN \u2014 LIVE SIGNAL DISABLED' };
        }
        return { status: 'DATA UNAVAILABLE', perIndex: null, oldestAgeSec: null, snapshotId: null, lockReason: 'DATA UNAVAILABLE — SIGNAL LOCKED' };
      }

      const indices = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
      const perIndex = {};
      let anyMissing = false;
      let anyStale = false;
      const validTimestamps = [];

      indices.forEach((sym) => {
        const m = data[sym];
        const spotOk = !!(m && !m.error && m.current > 0);
        const futOk = !!(m && !m.error && m.futuresContracts && m.futuresContracts.length > 0 && m.futuresContracts[0].ltp > 0);
        const optOk = !!(m && !m.error && m.expiries && m.expiries.length > 0 && m.expiries[0].ceStrikes && m.expiries[0].ceStrikes.length > 0);
        let ts = null;
        let ageSec = null;
        const effTs2 = getEffectiveTimestamp(m);
        if (m && !m.error && effTs2) {
          ts = new Date(effTs2);
          ageSec = Math.round((Date.now() - ts.getTime()) / 1000);
          validTimestamps.push(ts.getTime());
          if (ageSec * 1000 > STALE_THRESHOLD_MS) anyStale = true;
        } else {
          anyMissing = true;
        }
        if (!m || m.error) anyMissing = true;
        perIndex[sym] = { spotOk, futOk, optOk, ageSec };
      });

      let status;
      let lockReason = null;

      if (anyMissing) {
        status = 'PARTIAL DATA';
        lockReason = 'DATA INCOMPLETE — SIGNAL LOCKED';
      } else if (anyStale) {
        status = 'DELAYED DATA';
        lockReason = 'DELAYED DATA — SIGNAL LOCKED';
      } else {
        const spread = validTimestamps.length > 1 ? Math.max.apply(null, validTimestamps) - Math.min.apply(null, validTimestamps) : 0;
        if (spread > SYNC_TOLERANCE_MS) {
          status = 'MIXED SNAPSHOT DATA';
          lockReason = 'MIXED SNAPSHOT DATA — DO NOT USE SIGNAL';
        } else if (spread > 0) {
          status = 'LIVE BUT TIMESTAMP MISMATCH';
        } else {
          status = 'LIVE AND SYNCHRONIZED';
        }
      }

      const oldestAgeSec = validTimestamps.length > 0 ? Math.round((Date.now() - Math.min.apply(null, validTimestamps)) / 1000) : null;
      const snapshotId = validTimestamps.length > 0 ? new Date(Math.max.apply(null, validTimestamps)).toISOString() : null;

      return { status, lockReason, perIndex, oldestAgeSec, snapshotId };
    }

    function renderDataReliabilityCard() {
      resetRowLineTracking();
      const r = computeDataReliability();
      const statusColor =
        r.status === 'LIVE AND SYNCHRONIZED' ? 'var(--green)' :
        (r.status === 'LIVE BUT TIMESTAMP MISMATCH' || r.status === 'DELAYED DATA') ? 'var(--gold)' :
        r.status.indexOf('PRE-MARKET') === 0 ? 'var(--muted)' :
        'var(--red)';

      let html = '<div class="verdict-overall-card" style="border-color:' + statusColor + '; margin-bottom:10px;">';
      html += '<div style="color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px;">Data Reliability</div>';
      html += '<div style="color:' + statusColor + '; font-size:1.05rem; font-weight:700; margin:4px 0;">' + r.status + '</div>';

      if (r.lockReason) {
        const isPreMarketReason = r.lockReason.indexOf('MARKET NOT OPEN') === 0;
        const boxColor = isPreMarketReason ? 'var(--muted)' : 'var(--red)';
        const boxBg = isPreMarketReason ? 'rgba(124,138,165,0.12)' : 'rgba(229,72,77,0.14)';
        const icon = isPreMarketReason ? '\u23f3' : '\u26a0';
        html += '<div style="background:' + boxBg + '; border:2px solid ' + boxColor + '; border-radius:6px; padding:8px; margin:6px 0; color:' + boxColor + '; font-weight:700; font-size:0.8rem;">' + icon + ' ' + r.lockReason + '</div>';
      }

      html += rowLine('Kite Connection', kiteConnected ? 'Connected' : 'Disconnected');

      if (r.perIndex) {
        const indices = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
        const spotAllOk = indices.every((s) => r.perIndex[s].spotOk);
        const futAllOk = indices.every((s) => r.perIndex[s].futOk);
        const optAllOk = indices.every((s) => r.perIndex[s].optOk);

        html += rowLine('Spot Data', spotAllOk ? 'OK' : 'DATA UNAVAILABLE');
        html += rowLine('Futures Data', futAllOk ? 'OK' : 'DATA UNAVAILABLE');
        html += rowLine('Option-Chain Data', optAllOk ? 'OK' : 'DATA UNAVAILABLE');

        indices.forEach((sym) => {
          const pi = r.perIndex[sym];
          const ageText = pi.ageSec != null ? 'LIVE \u2014 AGE ' + pi.ageSec + 's' : 'DATA UNAVAILABLE';
          html += rowLine(sym + ' Timestamp', ageText);
        });

        html += rowLine('Oldest Data Age', r.oldestAgeSec != null ? r.oldestAgeSec + 's' : 'DATA UNAVAILABLE');
        indices.forEach((sym) => {
          const sid = data[sym] && data[sym].snapshotId ? data[sym].snapshotId.slice(-12) : null;
          html += rowLine(sym + ' Snapshot ID', sid ? '\u2026' + sid : 'DATA UNAVAILABLE');
        });
      } else {
        html += rowLine('Spot Data', 'DATA UNAVAILABLE');
        html += rowLine('Futures Data', 'DATA UNAVAILABLE');
        html += rowLine('Option-Chain Data', 'DATA UNAVAILABLE');
        html += rowLine('Oldest Data Age', 'DATA UNAVAILABLE');
        html += rowLine('Snapshot ID', 'DATA UNAVAILABLE');
      }

      html += rowLine('Last Successful Refresh', lastRefreshTime ? lastRefreshTime.toLocaleTimeString() : 'DATA UNAVAILABLE');

      html += partialDataFooter();
      html += '<div class="timestamp">Sync tolerance: ' + (SYNC_TOLERANCE_MS / 1000) + 's (PROVISIONAL, not backtested). Snapshot IDs are generated internally by this backend per index (spot+futures+options collected together) \u2014 Kite does not supply them. Data age is measured from the exchange/provider timestamp where available, falling back to backend receipt time otherwise. Separate spot-vs-futures-vs-options timestamps within a single index are still not tracked individually, so that finer-grained field remains hidden rather than guessed. No CE/PE decision or order-review button exists in this dashboard yet (by design \u2014 no automated order placement), so there is nothing to disable for that rule right now.</div>';
      html += '</div>';
      return html;
    }

    // SPOT + FUTURES CORE STATUS — spec Step 3. Reuses futuresDirection
    // (already built for the FUTURES tab) for buildup classification.
    function computeStructure(symbol, minutesWindow) {
      const hist = pcrHistory[symbol];
      if (!hist || hist.length === 0) return 'UNCONFIRMED';
      const now = new Date();
      const windowStart = new Date(now.getTime() - minutesWindow * 60000);
      const points = hist.filter((p) => p.time >= windowStart);
      if (points.length < 3) return 'UNCONFIRMED';
      let increasing = true;
      let decreasing = true;
      for (let i = 1; i < points.length; i++) {
        if (points[i].spot <= points[i - 1].spot) increasing = false;
        if (points[i].spot >= points[i - 1].spot) decreasing = false;
      }
      if (increasing) return 'HH-HL';
      if (decreasing) return 'LH-LL';
      return 'RANGE';
    }

    // Rule 1 fix: there is no genuine spot-only VWAP source in this app —
    // the only VWAP available is futures-derived. Comparing Spot LTP
    // against it was mislabeled "Spot VWAP" and has been removed. Basis
    // is shown instead, informational only (not a bullish/bearish signal).
    function computeSpotFuturesBasis(m) {
      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      if (!contract || !(contract.ltp > 0) || !(m.current > 0)) return null;
      return contract.ltp - m.current;
    }

    function renderSpotFuturesStatusRow(symbol, m) {
      const cardStatus = computeCardStatus(m);
      if (!m || m.error) {
        return '<div class="premium-card" style="margin-bottom:10px;"><div class="card-title">' + symbol + ' \u2014 Spot + Futures Status</div>' + renderCardStatusBadge(cardStatus) + '</div>';
      }

      resetRowLineTracking();
      const marketOpen = isMarketOpenNow();
      const struct5m = computeStructure(symbol, 5);
      const struct15m = computeStructure(symbol, 15);

      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      let futPriceDir = 'DATA UNAVAILABLE';
      let futVwapState = 'DATA UNAVAILABLE';
      let futOiChangeText = 'DATA UNAVAILABLE';
      let futClassification = 'DATA UNAVAILABLE';
      let futuresBias = null;

      if (contract && contract.ltp > 0) {
        const key = symbol + '_step3futures';
        const priceDir = futuresDirection(key + '_price', contract.ltp);
        const oiDir = contract.oi != null ? futuresDirection(key + '_oi', contract.oi) : 'flat';

        futPriceDir = priceDir === 'up' ? 'UP' : priceDir === 'down' ? 'DOWN' : 'FLAT';
        futVwapState = m.vwap > 0 ? (contract.ltp > m.vwap ? 'ABOVE' : contract.ltp < m.vwap ? 'BELOW' : 'AT VWAP') : 'DATA UNAVAILABLE';
        futOiChangeText = contract.oi != null ? contract.oi.toLocaleString('en-IN') + ' (' + (oiDir === 'up' ? '\u25b2' : oiDir === 'down' ? '\u25bc' : '\u2014') + ')' : 'DATA UNAVAILABLE';

        if (contract.oi == null) {
          futClassification = 'DATA UNAVAILABLE';
        } else if (priceDir === 'flat' && oiDir === 'flat') {
          futClassification = 'NEUTRAL';
        } else if (priceDir === 'up' && oiDir === 'up') {
          futClassification = 'LONG BUILDUP';
          futuresBias = 'bullish';
        } else if (priceDir === 'down' && oiDir === 'up') {
          futClassification = 'SHORT BUILDUP';
          futuresBias = 'bearish';
        } else if (priceDir === 'up' && oiDir === 'down') {
          futClassification = 'SHORT COVERING';
          futuresBias = 'bullish';
        } else if (priceDir === 'down' && oiDir === 'down') {
          futClassification = 'LONG UNWINDING';
          futuresBias = 'bearish';
        } else {
          futClassification = 'NEUTRAL';
        }
      }

      // Rule 1: no genuine Spot VWAP exists, so spot bias here comes from
      // the structure pattern (HH-HL/LH-LL), never from comparing Spot
      // LTP against the futures-derived VWAP.
      const spotBias = struct5m === 'HH-HL' ? 'bullish' : struct5m === 'LH-LL' ? 'bearish' : null;

      let alignmentText = 'DATA UNAVAILABLE';
      let alignmentColor = 'var(--muted)';
      if (spotBias && futuresBias) {
        if (spotBias === futuresBias) {
          alignmentText = spotBias === 'bullish' ? 'SPOT\u2013FUTURES BULLISH ALIGNMENT' : 'SPOT\u2013FUTURES BEARISH ALIGNMENT';
          alignmentColor = spotBias === 'bullish' ? 'var(--green)' : 'var(--red)';
        } else {
          alignmentText = 'SPOT\u2013FUTURES CONFLICT';
          alignmentColor = 'var(--gold)';
        }
      }

      const effTs = getEffectiveTimestamp(m);
      const ageSec = effTs ? Math.round((Date.now() - new Date(effTs).getTime()) / 1000) : null;
      const ageLabel = marketOpen ? (ageSec != null ? 'LIVE \u2014 AGE ' + ageSec + 's' : 'DATA UNAVAILABLE') : null;

      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">';
      html += '<span class="card-title" style="margin-bottom:0;">' + symbol + ' \u2014 Spot + Futures Status</span>';
      html += '<span class="badge-pill" style="background:rgba(0,0,0,0.2); color:' + alignmentColor + '; font-size:0.6rem;">' + alignmentText + '</span>';
      html += '</div>';
      html += renderCardStatusBadge(cardStatus);

      html += rowLine('Spot Price', m.current > 0 ? m.current.toFixed(2) : 'DATA UNAVAILABLE');
      const basis = computeSpotFuturesBasis(m);
      html += rowLine('Spot\u2013Futures Basis', basis != null ? (basis >= 0 ? '+' : '') + basis.toFixed(2) + ' (informational only)' : 'DATA UNAVAILABLE');
      html += rowLine('5m Structure', struct5m);
      html += rowLine('15m Structure', struct15m);
      html += rowLine('Futures Price Direction', futPriceDir);
      html += rowLine('Futures LTP vs Futures-Derived VWAP Proxy', futVwapState);
      html += rowLine('Futures OI Change', futOiChangeText);
      html += rowLine('Futures Classification', futClassification);
      if (ageLabel) html += rowLine('Data Age', ageLabel);
      html += partialDataFooter();
      html += '</div>';
      return html;
    }

    function renderSpotFuturesCoreStatus() {
      if (!data) return '<div class="loading">Loading...</div>';
      let html = '';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += renderSpotFuturesStatusRow(sym, data[sym]);
      });
      html += '<div class="timestamp">There is no genuine spot-only VWAP source in this app \u2014 "Spot VWAP" has been removed rather than shown as a proxy. The only VWAP is a Futures-Derived VWAP Proxy, compared only against Futures LTP, never against Spot LTP, and excluded from spot confirmation. Spot\u2013Futures Basis is shown for information only \u2014 a positive or negative basis does not by itself mean bullish or bearish. 5m/15m structure is a simplified monotonic-trend read on the spot samples collected this session so far (not true OHLC swing-high/swing-low structure) \u2014 shows UNCONFIRMED until at least 3 samples exist in that window.</div>';
      return html;
    }

    function renderVerdict() {
      let html = renderFinalVerdictCard();

      if (!data) {
        if (isPreMarket()) {
          html += '<div class="premium-card" style="text-align:center; padding:20px;">';
          html += '<div style="color:var(--gold); font-weight:700; font-size:1rem;">VERDICT LOCKED</div>';
          html += '<div style="color:var(--muted); font-size:0.85rem; margin-top:4px;">WAITING FOR LIVE MARKET DATA</div>';
          html += '</div>';
          return html;
        }
        return html + '<div class="loading">Loading verdict...</div>';
      }

      // Rule 12 hierarchy: 3. mandatory alignment, 4. SENSEX confirmation,
      // 5. compact index cards, 6. trade readiness, 7. recorder mini-bar.
      html += renderMandatoryAlignmentBar();
      html += renderSensexConfirmationBar();
      html += renderCompactIndexCard('NIFTY', data.NIFTY, false);
      html += renderCompactIndexCard('BANKNIFTY', data.BANKNIFTY, false);
      html += renderCompactIndexCard('SENSEX', data.SENSEX, true);
      html += renderConsolidatedReadinessCard();
      html += renderRecorderMiniBar();

      const niftyBias = classifyIndexOverallBias(data.NIFTY);
      const bankBias = classifyIndexOverallBias(data.BANKNIFTY);
      const sensexBias = classifyIndexOverallBias(data.SENSEX);
      const buckets = { NIFTY: biasToBucket(niftyBias), BANKNIFTY: biasToBucket(bankBias), SENSEX: biasToBucket(sensexBias) };
      const values = [buckets.NIFTY, buckets.BANKNIFTY, buckets.SENSEX];

      const status = computeAlignmentStatus(buckets);

      const bullishCount = values.filter((v) => v === 'bullish').length;
      const bearishCount = values.filter((v) => v === 'bearish').length;
      const dominant = bullishCount >= bearishCount ? 'bullish' : 'bearish';
      const alignedCount = values.filter((v) => v === dominant && (dominant === 'bullish' || dominant === 'bearish') && (bullishCount > 0 || bearishCount > 0)).length;
      const conflictingCount = values.filter((v) => (v === 'bullish' || v === 'bearish') && v !== dominant).length;

      const statusColor =
        status.indexOf('BULLISH') !== -1 ? 'var(--green)' :
        status.indexOf('BEARISH') !== -1 ? 'var(--red)' :
        (status.indexOf('CONFLICT') !== -1 || status === 'DATA INCOMPLETE') ? 'var(--gold)' : 'var(--muted)';

      // Advanced Diagnostics — everything detailed/technical, collapsed
      // by default per rule 2/3 ("move technical diagnostics elsewhere").
      html += '<details style="margin-top:6px;"><summary style="color:var(--gold); font-size:0.78rem; cursor:pointer; font-weight:700; padding:8px 0;">Advanced Diagnostics</summary>';
      html += '<div style="margin-top:8px;">';

      html += renderDataReliabilityCard();
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => { html += renderSignalLockCard(sym, data[sym]); });

      html += '<div class="verdict-overall-card">';
      html += '<div style="color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px;">Three-Index Alignment</div>';
      html += '<div style="color:' + statusColor + '; font-size:1.15rem; font-weight:700; margin:4px 0;">' + status + '</div>';

      html += '<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px;">';
      [['NIFTY', niftyBias], ['BANKNIFTY', bankBias], ['SENSEX', sensexBias]].forEach((pair) => {
        const sym = pair[0];
        const bias = pair[1];
        const c = biasColorFor(bias);
        html += '<div style="text-align:center;"><div style="color:var(--muted); font-size:0.65rem;">' + sym + '</div><div style="color:' + c + '; font-size:0.7rem; font-weight:700;">' + bias + '</div></div>';
      });
      html += '</div>';

      html += '<div style="color:var(--muted); font-size:0.75rem; margin-top:10px;">Aligned: ' + alignedCount + ' · Conflicting: ' + conflictingCount + '</div>';

      const reasons = collectMissingReasons(status, data.NIFTY, data.BANKNIFTY, data.SENSEX);
      if (reasons.length > 0) {
        html += '<div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">';
        html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Missing / Conflict Reasons</div>';
        reasons.forEach((r) => {
          html += '<div style="color:var(--gold); font-size:0.72rem; margin-top:3px;">\u2022 ' + escapeHtml(r) + '</div>';
        });
        html += '</div>';
      }

      html += '<div style="color:var(--muted-dim); font-size:0.62rem; margin-top:8px; font-family:var(--font-mono);">as of ' + new Date().toLocaleTimeString() + '</div>';
      html += '</div>';

      html += renderSpotFuturesCoreStatus();
      html += renderRecorderCard();
      html += renderJournalCard();
      html += renderDriveCard();

      html += '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Cross-Expiry ITM Alignment (Summary)</div>';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += '<div style="color:var(--muted); font-size:0.75rem; padding:4px 0; border-top:1px solid var(--border);">' + escapeHtml(renderStep5BSummaryLine(sym)) + '</div>';
      });
      html += '<div class="timestamp">Informational only \u2014 does not modify the Three-Index Alignment verdict above. Full detail is in each index\u2019s ALIGNMENT tab.</div>';
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">ATM Straddle Alignment (Summary)</div>';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += '<div style="color:var(--muted); font-size:0.75rem; padding:4px 0; border-top:1px solid var(--border);">' + escapeHtml(renderStep6ASummaryLine(sym)) + '</div>';
      });
      html += '<div class="timestamp">Informational only \u2014 does not modify the Three-Index Alignment verdict above. Full detail is in each index\u2019s OPTIONS tab.</div>';
      html += '</div>';

      html += '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">PCR + Wall Alignment (Summary)</div>';
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        html += '<div style="color:var(--muted); font-size:0.75rem; padding:4px 0; border-top:1px solid var(--border);">' + escapeHtml(renderStep6BSummaryLine(sym)) + '</div>';
      });
      html += '<div class="timestamp">Informational only \u2014 does not modify the Three-Index Alignment verdict above. Full detail is in each index\u2019s OPTIONS tab.</div>';
      html += '</div>';

      html += '</div></details>';

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

    function renderTrackerReadiness(symbol, m) {
      if (!m || m.error || !m.expiries || m.expiries.length === 0) {
        return '<div class="premium-card" style="margin-bottom:12px;"><div class="card-title">Tracker Readiness (Step 5A)</div><div class="unavailable-text">DATA UNAVAILABLE</div></div>';
      }
      resetRowLineTracking();
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      const atmStrikeVal = atmCe ? atmCe.strike : (atmPe ? atmPe.strike : null);

      updateAtmShiftTracker(symbol, atmStrikeVal, m.current);
      const shiftInfo = atmShiftTracker[symbol];

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Tracker Readiness (Step 5A \u2014 infrastructure only, no alignment conclusion yet)</div>';

      let detailHtml = '';
      detailHtml += '<div class="fii-section-label">Delta</div>';
      if (atmCe) detailHtml += rowLine('CE Delta Source', classifyDeltaSource(atmCe));
      if (atmPe) detailHtml += rowLine('PE Delta Source', classifyDeltaSource(atmPe));
      detailHtml += rowLine('Selection Method', DELTA_SELECTION_METHOD);

      detailHtml += '<div class="fii-section-label">ATM Shift Tracker</div>';
      detailHtml += rowLine('Current ATM', shiftInfo.current != null ? String(shiftInfo.current) : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Previous ATM', shiftInfo.previous != null ? String(shiftInfo.previous) : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Shift Timestamp', shiftInfo.lastShiftTime ? shiftInfo.lastShiftTime.toLocaleTimeString() : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Last Shift Direction', shiftInfo.shiftCount > 0 ? shiftInfo.lastShiftDirection : 'UNCHANGED');
      detailHtml += rowLine('Shifts This Session', String(shiftInfo.shiftCount));
      detailHtml += rowLine('Spot at Last Shift', shiftInfo.spotAtShift != null ? shiftInfo.spotAtShift.toFixed(2) : 'DATA UNAVAILABLE');

      const legTrackerReady = { CE: false, PE: false };

      function legReadiness(label, leg) {
        if (!leg) return '';
        // Same key format the Premium Pair card uses, so both share one
        // OI history instead of fragmenting into separate stores.
        const key = symbol + '_' + exp.expiry + '_' + label + '_' + leg.strike;
        recordPremiumSample(key, leg.lastPrice, leg.volume, leg.oi);
        recordStrikeOi(key, leg.oi);

        let block = '<div class="fii-section-label">' + label + ' Premium Candle Tracker</div>';
        [3, 5, 15, 30].forEach((interval) => {
          const completed = getCompletedPremiumCandles(key, interval);
          const total = getPremiumCandles(key, interval);
          block += rowLine(label + ' ' + interval + 'm Candles', total.length > 0 ? completed.length + ' completed / ' + total.length + ' total' : (interval + 'm PREMIUM LEVEL FORMING'));
        });

        const levelState = classifyPremiumLevelState(key, leg.lastPrice, leg.pdh, leg.pdl);
        block += rowLine(label + ' Premium PDH', leg.pdh > 0 ? leg.pdh.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Premium PDL', leg.pdl > 0 ? leg.pdl.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Level State', levelState);

        block += '<div class="fii-section-label">' + label + ' OI History</div>';
        const oiHist = strikeOiHistory[key];
        const oi3Ready = computeOiChangeFromSnapshot(key, 3) != null;
        const oi15Ready = computeOiChangeFromSnapshot(key, 15) != null;
        block += rowLine(label + ' OI History Points', oiHist ? String(oiHist.length) : '0 (not started)');
        block += rowLine(label + ' 3-min History', oi3Ready ? 'READY' : 'INSUFFICIENT');
        block += rowLine(label + ' 15-min History', oi15Ready ? 'READY' : 'INSUFFICIENT');

        block += '<div class="fii-section-label">' + label + ' Liquidity Tracker</div>';
        block += rowLine(label + ' Bid', leg.bid > 0 ? leg.bid.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Ask', leg.ask > 0 ? leg.ask.toFixed(2) : 'DATA UNAVAILABLE');
        const spreadPct = computeSpreadPct(leg.bid, leg.ask);
        block += rowLine(label + ' Spread %', spreadPct != null ? spreadPct.toFixed(2) + '%' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Volume', leg.volume != null ? leg.volume.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        const quoteAgeSec = leg.quoteTimestamp ? Math.round((Date.now() - new Date(leg.quoteTimestamp).getTime()) / 1000) : null;
        block += rowLine(label + ' Quote Age', quoteAgeSec != null ? quoteAgeSec + 's' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Liquidity', classifyLiquidity(leg));

        // Rule 6 (this verification round): never show the unverified
        // average_price under any label — only VWAP UNAVAILABLE, since we
        // cannot compute a genuine CALCULATED SESSION VWAP (no granular
        // intraday price+volume ticks available to this app).
        block += rowLine(label + ' VWAP Source', 'VWAP UNAVAILABLE');

        legTrackerReady[label] = !!(leg.pdh > 0 || leg.pdl > 0) && !!m.snapshotId;
        return block;
      }

      detailHtml += legReadiness('CE', atmCe);
      detailHtml += legReadiness('PE', atmPe);

      detailHtml += '<div class="fii-section-label">Synchronization Tracker</div>';
      detailHtml += rowLine('Exchange Timestamp', m.exchangeTimestamp ? new Date(m.exchangeTimestamp).toLocaleTimeString() : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Backend Received Timestamp', m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Snapshot ID', m.snapshotId ? '\u2026' + m.snapshotId.slice(-12) : 'DATA UNAVAILABLE');
      detailHtml += rowLine('Snapshot', m.snapshotId ? 'SYNCED' : 'MISMATCH');

      const readinessCheck = computeStep5Readiness(symbol, m);
      const missing = readinessCheck.missing;
      const ready = readinessCheck.ready;

      html += '<div style="margin-bottom:8px;">';
      html += '<div class="fii-section-label" style="margin-top:0;">Readiness Result</div>';
      html += '<div style="color:' + (ready ? 'var(--green)' : 'var(--gold)') + '; font-weight:700; font-size:0.9rem;">' + (ready ? 'TRACKERS READY FOR STEP 5B' : 'STEP 5B BLOCKED \u2014 MISSING: ' + missing.join(', ')) + '</div>';
      html += '</div>';

      html += '<details><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show full tracker breakdown</summary>';
      html += '<div style="margin-top:8px;">' + detailHtml + '</div></details>';

      html += partialDataFooter();
      html += '<div class="timestamp">Tracker infrastructure status only \u2014 no Cross-Expiry ITM Alignment conclusion is generated in this sub-step. Level states use a simplified PROVISIONAL heuristic on session-sampled candles (not true tick-by-tick confirmation). PDH/PDL here are the option premium\u2019s own previous-session levels, never the spot index\u2019s PDH/PDL. Candle/OI-history readiness (BUILDING/INSUFFICIENT) reflects how long this session has been running, not a data error \u2014 it fills in over the first 15\u201330 minutes.</div>';
      html += '</div>';
      return html;
    }

    function renderAlignmentTab(symbol, m) {
      let html = renderOrchestratorCard(symbol, m);
      html += renderTrackerReadiness(symbol, m);
      html += renderStep5BCard(symbol, m);
      if (!indexStocksData[symbol]) {
        loadIndexStocks(symbol);
        return html + '<div class="loading">Loading constituent data...</div>';
      }
      if (indexStocksData[symbol].error) {
        return html + '<div class="error">⚠️ ' + escapeHtml(indexStocksData[symbol].error) + '</div>';
      }
      html += '<div class="premium-card" style="margin-bottom:12px;">';
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

    // UI CLEANUP — rows whose value is unavailable are hidden entirely
    // (not shown as a "DATA UNAVAILABLE" label) rather than cluttering the
    // card. Tracking counters let each card show a "PARTIAL DATA — SOME
    // FIELDS HIDDEN" footer when only some of its fields were hidden.
    let __rowLineTotal = 0;
    let __rowLineHidden = 0;
    function resetRowLineTracking() {
      __rowLineTotal = 0;
      __rowLineHidden = 0;
    }
    function partialDataFooter() {
      if (!isMarketOpenNow()) return '';
      if (__rowLineHidden > 0 && __rowLineHidden < __rowLineTotal) {
        return '<div class="timestamp" style="color:var(--gold); font-weight:700;">PARTIAL DATA \u2014 SOME FIELDS HIDDEN</div>';
      }
      return '';
    }
    function rowLine(label, value) {
      __rowLineTotal++;
      const text = String(value);
      if (text.indexOf('DATA UNAVAILABLE') === 0) {
        __rowLineHidden++;
        return '';
      }
      return '<div class="card-item"><span class="card-label">' + escapeHtml(label) + '</span><span class="card-value">' + escapeHtml(text) + '</span></div>';
    }

    // Compact card-level status — UI cleanup rules 3+4. One status per card
    // instead of repeated per-field DATA UNAVAILABLE labels.
    function computeCardStatus(m) {
      if (!kiteConnected) return 'BROKER DISCONNECTED';
      if (!data) return isPreMarket() ? 'PRE-MARKET \u2014 WAITING FOR LIVE SESSION' : 'WAITING FOR LIVE SESSION';
      if (!m || m.error) return 'PARTIAL DATA';
      if (!isMarketOpenNow()) return 'PREVIOUS SESSION CONTEXT';
      const effTs = getEffectiveTimestamp(m);
      const ageSec = effTs ? Math.round((Date.now() - new Date(effTs).getTime()) / 1000) : null;
      if (ageSec == null) return 'PARTIAL DATA';
      if (ageSec > 360) return 'STALE DATA \u2014 SIGNAL LOCKED';
      return 'LIVE';
    }

    function cardStatusColor(status) {
      if (status === 'LIVE') return 'var(--green)';
      if (status === 'PARTIAL DATA') return 'var(--gold)';
      if (status.indexOf('PREVIOUS SESSION CONTEXT') === 0 || status === 'WAITING FOR LIVE SESSION' || status.indexOf('PRE-MARKET') === 0) return 'var(--muted)';
      return 'var(--red)'; // STALE DATA — SIGNAL LOCKED, BROKER DISCONNECTED
    }

    function renderCardStatusBadge(status) {
      return '<div style="margin-bottom:8px;"><span class="badge-pill" style="background:rgba(0,0,0,0.2); color:' + cardStatusColor(status) + '; font-weight:700; font-size:0.68rem;">' + status + '</span></div>';
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

    // PRICE LOCATION & LEVEL BEHAVIOUR — new Overview card. 15m/30m
    // High/Low use this session's accumulated pcrHistory samples (not
    // tick-level). Break/Hold/Rejection/Retest is a simplified PROVISIONAL
    // heuristic (tolerance band + last-two-sample direction), not a full
    // historical state machine.
    function computeWindowHighLow(symbol, minutesWindow) {
      const hist = pcrHistory[symbol];
      if (!hist || hist.length === 0) return null;
      const now = new Date();
      const windowStart = new Date(now.getTime() - minutesWindow * 60000);
      const points = hist.filter((p) => p.time >= windowStart);
      if (points.length < 2) return null;
      let high = points[0].spot;
      let low = points[0].spot;
      points.forEach((p) => {
        if (p.spot > high) high = p.spot;
        if (p.spot < low) low = p.spot;
      });
      return { high, low };
    }

    function recentDirection(symbol) {
      const hist = pcrHistory[symbol];
      if (!hist || hist.length < 2) return null;
      const last = hist[hist.length - 1];
      const prev = hist[hist.length - 2];
      if (last.spot > prev.spot) return 'up';
      if (last.spot < prev.spot) return 'down';
      return 'flat';
    }

    function classifyLevelBehaviour(current, level, dir, isUpperLevel) {
      if (!level || level <= 0) return 'DATA UNAVAILABLE';
      const tolerance = level * 0.001; // PROVISIONAL — 0.1% "at level" band, not backtested
      if (isUpperLevel) {
        if (current > level + tolerance) return dir === 'up' ? 'BREAK' : 'HOLD';
        if (Math.abs(current - level) <= tolerance) return 'RETEST';
        if (current < level && dir === 'down') return 'REJECTION';
        return 'BELOW';
      }
      if (current < level - tolerance) return dir === 'down' ? 'BREAK' : 'HOLD';
      if (Math.abs(current - level) <= tolerance) return 'RETEST';
      if (current > level && dir === 'up') return 'REJECTION';
      return 'ABOVE';
    }

    function computeNearestLevel(m) {
      const levels = [];
      if (m.pdh > 0) levels.push({ name: 'PDH', value: m.pdh });
      if (m.pdl > 0) levels.push({ name: 'PDL', value: m.pdl });
      if (m.vwap > 0) levels.push({ name: 'VWAP', value: m.vwap });
      if (levels.length === 0) return null;
      let nearest = levels[0];
      let minDist = Math.abs(m.current - nearest.value);
      levels.forEach((l) => {
        const d = Math.abs(m.current - l.value);
        if (d < minDist) { minDist = d; nearest = l; }
      });
      return { name: nearest.name, distance: m.current - nearest.value };
    }

    function renderPriceLocationCard(symbol, m) {
      const cardStatus = computeCardStatus(m);
      if (!m || m.error) {
        return '<div class="premium-card" style="margin-bottom:12px;"><div class="card-title">Price Location & Level Behaviour</div>' + renderCardStatusBadge(cardStatus) + '</div>';
      }
      resetRowLineTracking();

      const win15 = computeWindowHighLow(symbol, 15);
      const win30 = computeWindowHighLow(symbol, 30);
      const dir = recentDirection(symbol);
      const nearest = computeNearestLevel(m);
      const pdhBehaviour = classifyLevelBehaviour(m.current, m.pdh, dir, true);
      const pdlBehaviour = classifyLevelBehaviour(m.current, m.pdl, dir, false);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Price Location & Level Behaviour</div>';
      html += renderCardStatusBadge(cardStatus);

      html += rowLine('PDH', m.pdh > 0 ? m.pdh.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('PDL', m.pdl > 0 ? m.pdl.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('15m High / Low', win15 ? win15.high.toFixed(2) + ' / ' + win15.low.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('30m High / Low', win30 ? win30.high.toFixed(2) + ' / ' + win30.low.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Move From PDL', m.pdl > 0 ? (m.current - m.pdl >= 0 ? '+' : '') + (m.current - m.pdl).toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Move From PDH', m.pdh > 0 ? (m.current - m.pdh >= 0 ? '+' : '') + (m.current - m.pdh).toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('PDH Behaviour', pdhBehaviour);
      html += rowLine('PDL Behaviour', pdlBehaviour);
      html += rowLine('Nearest Level', nearest ? nearest.name + ' (' + (nearest.distance >= 0 ? '+' : '') + nearest.distance.toFixed(2) + ')' : 'DATA UNAVAILABLE');

      html += partialDataFooter();
      html += '<div class="timestamp">15m/30m High/Low use this session\u2019s accumulated spot samples (not tick-level) \u2014 hidden until enough samples exist. Break/Hold/Rejection/Retest uses a simplified PROVISIONAL tolerance band (0.1% of level) and last-two-sample direction, not a full historical state machine.</div>';
      html += '</div>';
      return html;
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
      html += rowLine('Futures-Derived VWAP Proxy', m.vwap ? m.vwap.toFixed(2) + ' (' + m.vwapSource + ')' : 'DATA UNAVAILABLE');
      html += rowLine('Spot\u2013Futures Basis', distVwap != null ? (distVwap >= 0 ? '+' : '') + distVwap.toFixed(2) + ' (informational only)' : 'DATA UNAVAILABLE');
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

      html += renderPriceLocationCard(symbol, m);

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
      const cardStatus = computeCardStatus(m);
      if (!m.expiries || m.expiries.length === 0) {
        return '<div class="premium-card" style="margin-bottom:12px;"><div class="card-title">ATM Premium</div>' + renderCardStatusBadge(cardStatus) + '</div>';
      }
      resetRowLineTracking();
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">' + escapeHtml(exp.expiry) + ' — ATM Premium</div>';
      html += renderCardStatusBadge(cardStatus);
      if (atmCe) {
        html += '<div class="fii-section-label">CE ' + atmCe.strike + '</div>';
        html += rowLine('LTP', atmCe.lastPrice.toFixed(2));
        html += rowLine('OI', atmCe.oi != null ? atmCe.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
        html += rowLine('IV', atmCe.iv ? atmCe.iv.toFixed(1) : 'DATA UNAVAILABLE');
        html += rowLine('Bid / Ask', atmCe.bid.toFixed(2) + ' / ' + atmCe.ask.toFixed(2));
        html += rowLine('Vega / Theta', atmCe.vega && atmCe.theta ? atmCe.vega.toFixed(2) + ' / ' + atmCe.theta.toFixed(2) : 'DATA UNAVAILABLE');
        html += rowLine('Delta', atmCe.delta ? atmCe.delta.toFixed(3) : 'DATA UNAVAILABLE');
      }
      if (atmPe) {
        html += '<div class="fii-section-label">PE ' + atmPe.strike + '</div>';
        html += rowLine('LTP', atmPe.lastPrice.toFixed(2));
        html += rowLine('OI', atmPe.oi != null ? atmPe.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
        html += rowLine('IV', atmPe.iv ? atmPe.iv.toFixed(1) : 'DATA UNAVAILABLE');
        html += rowLine('Bid / Ask', atmPe.bid.toFixed(2) + ' / ' + atmPe.ask.toFixed(2));
        html += rowLine('Vega / Theta', atmPe.vega && atmPe.theta ? atmPe.vega.toFixed(2) + ' / ' + atmPe.theta.toFixed(2) : 'DATA UNAVAILABLE');
        html += rowLine('Delta', atmPe.delta ? atmPe.delta.toFixed(3) : 'DATA UNAVAILABLE');
      }
      html += partialDataFooter();
      html += '</div>';
      html += '<div class="timestamp">Delta/Vega/Theta are Black-Scholes estimates (spot, strike, IV, days-to-expiry) — Kite does not publish Greeks directly. 5m/15m/30m/1h premium momentum and liquidity status are not yet tracked, so those fields are hidden rather than guessed.</div>';
      return html;
    }

    // ATM Straddle historical tracking — spec section 13. Builds up during
    // this session (client-side, resets on page reload) since there's no
    // persistent straddle history store.
    const straddleHistoryData = {};
    function recordStraddleHistory(key, straddle) {
      if (!straddleHistoryData[key]) straddleHistoryData[key] = [];
      const hist = straddleHistoryData[key];
      const last = hist[hist.length - 1];
      if (last && last.straddle === straddle) return;
      hist.push({ time: new Date(), straddle });
      if (hist.length > 200) hist.shift();
    }

    function computeStraddleTimeframeChange(key, minutesAgo) {
      const hist = straddleHistoryData[key];
      if (!hist || hist.length < 2) return null;
      const now = new Date();
      const targetTime = new Date(now.getTime() - minutesAgo * 60000);
      let closest = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].time <= targetTime) { closest = hist[i]; break; }
      }
      if (!closest || closest.straddle === 0) return null;
      const current = hist[hist.length - 1];
      return ((current.straddle - closest.straddle) / closest.straddle) * 100;
    }

    function fmtStraddleChange(pct) {
      return pct == null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    }

    function renderOptionsExpiry(symbol, m) {
      if (!m.expiries || m.expiries.length === 0) return '<div class="loading">DATA UNAVAILABLE</div>';
      let html = '';
      m.expiries.forEach((exp) => {
        const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
        const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
        const straddle = (atmCe && atmPe) ? (atmCe.lastPrice + atmPe.lastPrice) : null;
        const prevStraddle = (atmCe && atmPe && atmCe.pdc && atmPe.pdc) ? (atmCe.pdc + atmPe.pdc) : null;
        const straddleChangePct = (straddle != null && prevStraddle) ? ((straddle - prevStraddle) / prevStraddle) * 100 : null;

        const histKey = symbol + '_' + exp.expiry;
        if (straddle != null) recordStraddleHistory(histKey, straddle);
        const change15 = computeStraddleTimeframeChange(histKey, 15);
        const change30 = computeStraddleTimeframeChange(histKey, 30);
        const change60 = computeStraddleTimeframeChange(histKey, 60);

        let volState = 'DATA UNAVAILABLE';
        if (change30 != null) {
          if (change30 > 2) volState = 'Expanding';
          else if (change30 < -2) volState = 'Contracting';
          else volState = 'Stable';
        }

        html += '<div class="premium-card" style="margin-bottom:12px;">';
        html += '<div class="card-title">' + escapeHtml(exp.expiry) + '</div>';
        html += rowLine('ATM Strike', atmCe ? atmCe.strike : (atmPe ? atmPe.strike : 'DATA UNAVAILABLE'));
        html += rowLine('ATM CE State', atmCe ? atmCe.lastPrice.toFixed(2) + ' (OI ' + (atmCe.oi != null ? atmCe.oi.toLocaleString('en-IN') : '—') + ')' : 'DATA UNAVAILABLE');
        html += rowLine('ATM PE State', atmPe ? atmPe.lastPrice.toFixed(2) + ' (OI ' + (atmPe.oi != null ? atmPe.oi.toLocaleString('en-IN') : '—') + ')' : 'DATA UNAVAILABLE');
        html += rowLine('ATM Straddle', straddle != null ? straddle.toFixed(2) : 'DATA UNAVAILABLE');
        html += rowLine('Previous Close Straddle', prevStraddle != null ? prevStraddle.toFixed(2) : 'DATA UNAVAILABLE');
        html += rowLine('Straddle Change %', straddleChangePct != null ? (straddleChangePct >= 0 ? '+' : '') + straddleChangePct.toFixed(2) + '%' : 'DATA UNAVAILABLE');
        html += rowLine('15m / 30m / 1h Change', (change15 != null || change30 != null || change60 != null) ? fmtStraddleChange(change15) + ' / ' + fmtStraddleChange(change30) + ' / ' + fmtStraddleChange(change60) : 'DATA UNAVAILABLE');
        html += rowLine('Volatility State', volState);
        html += rowLine('OI PCR / Max Pain', exp.expiry === 'Current Expiry' ? (m.pcr != null ? m.pcr.toFixed(3) : 'DATA UNAVAILABLE') + ' / ' + (m.maxPain ? m.maxPain.toFixed(0) : 'DATA UNAVAILABLE') : 'DATA UNAVAILABLE (only tracked for current-week expiry)');
        html += '</div>';
      });
      html += '<div class="timestamp">Change-in-OI PCR and Volume PCR, plus Call/Put Wall per expiry, are not yet tracked independently for each expiry — DATA UNAVAILABLE where not shown. 15m/30m/1h straddle change builds up during this session and shows \u2014 until enough history exists. Not a guaranteed target — spec section 13.</div>';
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
      html += '<div class="card-title">' + escapeHtml(exp.expiry) + ' — Option Chain (' + (symbol === 'BANKNIFTY' ? 'ATM ±6' : 'ATM ±10') + ')</div>';
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

      // Buildup highlights — reuses the same OI+Price direction classifier
      // used elsewhere, with its own key scope so it doesn't corrupt other
      // tabs' "previous value" comparisons.
      const ceBuildups = ceStrikes.map((s) => {
        const key = symbol + '_chain_CE_' + s.strike;
        const oiInfo = oiArrowInfo(key, s.oi);
        const priceDir = priceDirection(key + '_price', s.lastPrice);
        return { strike: s.strike, buildup: classifyBuildup(priceDir, oiInfo.cls, null), oiDelta: oiInfo.delta };
      });
      const peBuildups = peStrikes.map((s) => {
        const key = symbol + '_chain_PE_' + s.strike;
        const oiInfo = oiArrowInfo(key, s.oi);
        const priceDir = priceDirection(key + '_price', s.lastPrice);
        return { strike: s.strike, buildup: classifyBuildup(priceDir, oiInfo.cls, null), oiDelta: oiInfo.delta };
      });

      function strongestOf(list, labelMatch) {
        const matches = list.filter((x) => x.buildup.label.indexOf(labelMatch) !== -1 && x.oiDelta);
        if (matches.length === 0) return null;
        return matches.reduce((a, b) => (Math.abs(b.oiDelta) > Math.abs(a.oiDelta) ? b : a));
      }

      const strongestCallWriting = strongestOf(ceBuildups, 'Short Buildup');
      const strongestCallBuying = strongestOf(ceBuildups, 'Long Buildup');
      const strongestPutWriting = strongestOf(peBuildups, 'Short Buildup');
      const strongestPutBuying = strongestOf(peBuildups, 'Long Buildup');
      const writerCoveringStrikes = [...ceBuildups, ...peBuildups].filter((x) => x.buildup.label === 'Short Covering').map((x) => x.strike);
      const buyerUnwindingStrikes = [...ceBuildups, ...peBuildups].filter((x) => x.buildup.label === 'Long Unwinding').map((x) => x.strike);

      function fmtHighlight(item) {
        return item ? item.strike + ' (OI ' + (item.oiDelta >= 0 ? '+' : '') + item.oiDelta.toLocaleString('en-IN') + ')' : 'DATA UNAVAILABLE (needs a second refresh to compare)';
      }

      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Buildup Highlights</div>';
      html += rowLine('Strongest Call Writing', fmtHighlight(strongestCallWriting));
      html += rowLine('Strongest Call Buying', fmtHighlight(strongestCallBuying));
      html += rowLine('Strongest Put Writing', fmtHighlight(strongestPutWriting));
      html += rowLine('Strongest Put Buying', fmtHighlight(strongestPutBuying));
      html += rowLine('Writer-Covering Strikes', writerCoveringStrikes.length ? writerCoveringStrikes.join(', ') : 'None detected this refresh');
      html += rowLine('Buyer-Unwinding Strikes', buyerUnwindingStrikes.length ? buyerUnwindingStrikes.join(', ') : 'None detected this refresh');
      html += '</div>';

      html += '<div class="timestamp">Showing ' + (symbol === 'BANKNIFTY' ? 'ATM \u00b16 (13 strikes)' : 'ATM \u00b110 (21 strikes)') + ' — matches the spec\u2019s detailed-table range. ATM \u00b120 background range is not fetched.</div>';
      return html;
    }

    function classifyWallStatus(oiDir) {
      if (oiDir === 'up') return 'Building';
      if (oiDir === 'down') return 'Weakening';
      return 'Stable';
    }

    function renderOptionsWallsPcr(symbol, m) {
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">PCR & Max Pain</div>';
      html += rowLine('OI PCR (ATM ±7)', m.pcr != null ? m.pcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Volume PCR', m.volumePcr != null ? m.volumePcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Full-Chain PCR', m.gapScore && m.gapScore.fullChainPcr != null ? m.gapScore.fullChainPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Max Pain', m.maxPain ? m.maxPain.toFixed(0) : 'DATA UNAVAILABLE');
      html += '</div>';

      const exp = (m.expiries || []).find((e) => e.expiry === 'Current Expiry') || (m.expiries || [])[0];
      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Call Wall / Put Wall Candidates (ATM ±2 only)</div>';
      if (exp) {
        const ceStrikes = exp.ceStrikes || [];
        const peStrikes = exp.peStrikes || [];
        let maxCallOiStrike = null;
        let maxCallOi = -1;
        ceStrikes.forEach((s) => { if (s.oi != null && s.oi > maxCallOi) { maxCallOi = s.oi; maxCallOiStrike = s; } });
        let maxPutOiStrike = null;
        let maxPutOi = -1;
        peStrikes.forEach((s) => { if (s.oi != null && s.oi > maxPutOi) { maxPutOi = s.oi; maxPutOiStrike = s; } });

        if (maxCallOiStrike) {
          const key = symbol + '_wallcandidate_CE_' + maxCallOiStrike.strike;
          const oiInfo = oiArrowInfo(key, maxCallOiStrike.oi);
          html += rowLine('Call Wall Candidate', maxCallOiStrike.strike + ' (OI ' + maxCallOiStrike.oi.toLocaleString('en-IN') + ')');
          html += rowLine('Call Wall Status', classifyWallStatus(oiInfo.cls));
        } else {
          html += rowLine('Call Wall Candidate', 'DATA UNAVAILABLE');
        }

        if (maxPutOiStrike) {
          const key = symbol + '_wallcandidate_PE_' + maxPutOiStrike.strike;
          const oiInfo = oiArrowInfo(key, maxPutOiStrike.oi);
          html += rowLine('Put Wall Candidate', maxPutOiStrike.strike + ' (OI ' + maxPutOiStrike.oi.toLocaleString('en-IN') + ')');
          html += rowLine('Put Wall Status', classifyWallStatus(oiInfo.cls));
        } else {
          html += rowLine('Put Wall Candidate', 'DATA UNAVAILABLE');
        }
      } else {
        html += rowLine('Status', 'DATA UNAVAILABLE');
      }
      html += '</div>';

      html += '<div class="timestamp">Wall candidates use the max-OI strike within ' + (symbol === 'BANKNIFTY' ? 'ATM \u00b16' : 'ATM \u00b110') + ' — closer to the spec\u2019s wider scan than before, but still narrower than the full ATM \u00b120 background range. Status (Building/Weakening/Stable) reflects OI direction only, not the full multi-factor confirmation the spec describes. Broken/Shifted states and previous-day wall comparison are not yet tracked.</div>';
      return html;
    }

    // PREMIUM PAIR + OPTION OI ALIGNMENT — the actual visible card, wired
    // into the OPTIONS chip above the sub-tab nav (so it appears above the
    // detailed Option Chain regardless of which OPTIONS sub-tab is open).
    // Display-and-logging only — does not feed into classifyIndexOverallBias,
    // computeAlignmentStatus, or any other verdict/strategy logic.
    // Formats a Date as "11 AUG 2026" — used so the Premium Pair card shows
    // the actual expiry date, not the generic "Current Expiry" label.
    function formatExpiryDate(d) {
      if (!d) return null;
      const date = new Date(d);
      if (isNaN(date.getTime())) return null;
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
    }

    // Caches the OI-tracker computation (Change in OI, 3m/15m change,
    // interpretation) per data-object-reference. Without this, switching
    // between OPTIONS sub-tabs (which re-renders via updateUI() without a
    // new fetch) would call oiArrowInfo() again on the SAME oi value and
    // produce a spurious "+0 qty" (prev getting overwritten to equal
    // current on every render, not just every real fetch).
    const premiumPairComputedCache = {};
    function getPremiumPairComputation(key, leg, marketOpen) {
      const cached = premiumPairComputedCache[key];
      if (cached && cached.forData === data) return cached;

      recordStrikeOi(key, leg.oi);
      let changeInOi = null;
      let change3m = null;
      let change15m = null;
      let interp = 'UNCONFIRMED';
      if (marketOpen) {
        const priceDir = priceDirection(key + '_price', leg.lastPrice);
        const oiInfo = oiArrowInfo(key + '_oi', leg.oi);
        changeInOi = oiInfo.delta;
        change3m = computeOiChangeFromSnapshot(key, 3);
        change15m = computeOiChangeFromSnapshot(key, 15);
        interp = classifyInterpretation(priceDir, oiInfo.cls);
      }
      const result = { changeInOi, change3m, change15m, interp, forData: data };
      premiumPairComputedCache[key] = result;
      return result;
    }

    function renderPremiumPairCard(symbol, m) {
      let cardStatus = computeCardStatus(m);
      if (!m || m.error || !m.expiries || m.expiries.length === 0) {
        return '<div class="premium-card" style="margin-bottom:12px;"><div class="card-title">Premium Pair + Option OI Alignment</div>' + renderCardStatusBadge(cardStatus) + '</div>';
      }
      resetRowLineTracking();

      const marketOpen = isMarketOpenNow();
      if (!marketOpen && cardStatus === 'PREVIOUS SESSION CONTEXT') {
        cardStatus = 'PREVIOUS SESSION CONTEXT \u2014 LIVE INTERPRETATION DISABLED';
      }

      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      const atmStrikeVal = atmCe ? atmCe.strike : (atmPe ? atmPe.strike : null);
      const continuity = getAtmContinuity(symbol, atmStrikeVal);
      const expiryDateText = formatExpiryDate(exp.expiryDate);

      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Premium Pair + Option OI Alignment</div>';
      html += renderCardStatusBadge(cardStatus);

      html += rowLine('Current Expiry', expiryDateText || 'DATA UNAVAILABLE');
      html += rowLine('Current ATM Strike', atmStrikeVal != null ? String(atmStrikeVal) : 'DATA UNAVAILABLE');
      html += rowLine('Previous ATM Strike', continuity.previousAtm != null ? continuity.previousAtm + (continuity.switched ? ' (changed this refresh — continuity check only, not a signal)' : ' (unchanged)') : 'DATA UNAVAILABLE');
      html += rowLine('CE Strike', atmCe ? String(atmCe.strike) : 'DATA UNAVAILABLE');
      html += rowLine('PE Strike', atmPe ? String(atmPe.strike) : 'DATA UNAVAILABLE');

      function renderLeg(label, leg, key) {
        const computed = getPremiumPairComputation(key, leg, marketOpen);
        const spread = computeSpreadPct(leg.bid, leg.ask);
        const accentColor = label === 'CE' ? 'var(--green)' : 'var(--red)';

        let block = '<div style="border-left:3px solid ' + accentColor + '; padding-left:10px; margin:10px 0;">';
        block += '<div class="fii-section-label" style="color:' + accentColor + ';">' + label + ' ' + leg.strike + '</div>';
        block += rowLine(label + ' LTP', leg.lastPrice > 0 ? leg.lastPrice.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Total OI', leg.oi != null ? leg.oi.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Change in OI', (marketOpen && computed.changeInOi != null) ? (computed.changeInOi >= 0 ? '+' : '') + computed.changeInOi.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' 3-min OI Change', (marketOpen && computed.change3m != null) ? (computed.change3m >= 0 ? '+' : '') + computed.change3m.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' 15-min OI Change', (marketOpen && computed.change15m != null) ? (computed.change15m >= 0 ? '+' : '') + computed.change15m.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        // Rule 1: Volume/Bid/Ask/Spread/Liquidity reflect live market-maker
        // activity — only shown while the market is actually open, never a
        // possibly-stale/zero value from a closed-market snapshot.
        block += rowLine(label + ' Volume', (marketOpen && leg.volume != null) ? leg.volume.toLocaleString('en-IN') + ' qty' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Bid', (marketOpen && leg.bid > 0) ? leg.bid.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Ask', (marketOpen && leg.ask > 0) ? leg.ask.toFixed(2) : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Spread %', (marketOpen && spread != null) ? spread.toFixed(2) + '%' : 'DATA UNAVAILABLE');
        block += rowLine(label + ' Liquidity', (marketOpen && leg.bid > 0) ? (isLiquid(leg) ? 'Liquid' : 'Not Liquid') : 'DATA UNAVAILABLE');
        block += rowLine(label + ' VWAP', leg.vwapSource === 'UNVERIFIED AVERAGE PRICE — NOT VWAP' ? 'UNVERIFIED AVERAGE PRICE — NOT VWAP (' + leg.vwap.toFixed(2) + ')' : 'VWAP UNAVAILABLE');
        block += rowLine(label + ' Interpretation', marketOpen ? computed.interp : 'DATA UNAVAILABLE');
        block += '</div>';
        return block;
      }

      if (atmCe) html += renderLeg('CE', atmCe, symbol + '_' + exp.expiry + '_CE_' + atmCe.strike);
      if (atmPe) html += renderLeg('PE', atmPe, symbol + '_' + exp.expiry + '_PE_' + atmPe.strike);

      html += '<div class="fii-section-label">Synchronization</div>';
      // Rule 2: compact summary on the main card; full technical ID moved
      // to an expandable debug section. By construction, one snapshotId
      // covers this index's spot+futures+CE+PE together (assigned once per
      // fetch cycle), so SYNCED simply means that ID exists.
      html += rowLine('Snapshot', m.snapshotId ? 'SYNCED' : 'MISMATCH');
      html += rowLine('Exchange Market Timestamp', m.exchangeTimestamp ? new Date(m.exchangeTimestamp).toLocaleTimeString() : 'DATA UNAVAILABLE');
      html += rowLine('Backend Received Timestamp', m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : 'DATA UNAVAILABLE');
      html += rowLine('Dashboard Render Timestamp', new Date().toLocaleTimeString());
      const effTsPP = getEffectiveTimestamp(m);
      const ageSecPP = effTsPP ? Math.round((Date.now() - new Date(effTsPP).getTime()) / 1000) : null;
      html += rowLine('Data Age', (marketOpen && ageSecPP != null) ? ageSecPP + 's' : 'DATA UNAVAILABLE');
      html += rowLine('Same-Snapshot Sync', (m.futuresContracts && m.futuresContracts.length > 0) ? 'CE, PE, and Futures all came from this index\u2019s single fetch cycle' : 'DATA UNAVAILABLE');

      if (m.snapshotId) {
        html += '<details style="margin-top:8px;"><summary style="color:var(--muted-dim); font-size:0.68rem; cursor:pointer;">Debug: full Snapshot ID</summary>';
        html += '<div style="color:var(--muted-dim); font-size:0.65rem; font-family:var(--font-mono); margin-top:4px; word-break:break-all;">' + escapeHtml(m.snapshotId) + '</div>';
        html += '</details>';
      }

      html += partialDataFooter();
      html += '<div class="timestamp">Interpretation labels describe price+OI behaviour patterns only \u2014 not proof of who initiated any trade. OI-change fields (Change in OI, 3-min, 15-min) are only computed once per real data fetch (not re-triggered by switching tabs) and only while the market is live \u2014 hidden entirely outside market hours or before a real earlier snapshot exists, rather than showing a stale or zero value. Volume/Bid/Ask/Spread are hidden outside live market hours for the same reason. Exchange Market Timestamp uses only Kite\u2019s genuine last-trade time \u2014 never the current refresh time \u2014 and is hidden if unavailable rather than guessed. CE/PE VWAP shown here is Kite\u2019s raw average_price, explicitly UNVERIFIED against provider documentation as a true session VWAP \u2014 treat as an unconfirmed reference number only. Total OI and Change in OI are two separate fields, never merged. Display-and-logging only \u2014 does not affect the Verdict or Alignment cards, and there is no order-placement feature to enable.</div>';
      html += '</div>';
      return html;
    }

    function renderOptionsTab(symbol, m) {
      let html = renderPremiumPairCard(symbol, m);
      html += renderStep6ACard(symbol, m);
      html += renderStep6BCard(symbol, m);

      const subs = [
        { key: 'PREMIUM', label: 'PREMIUM' },
        { key: 'CHAIN', label: 'CHAIN' },
        { key: 'EXPIRY', label: 'EXPIRY' },
        { key: 'WALLSPCR', label: 'WALLS & PCR' },
      ];
      html += '<div class="chip-nav">';
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

    // VIX is identical across NIFTY/BANKNIFTY/SENSEX (same NSE:INDIA VIX
    // instrument), so we reuse whichever index's tracked history has it —
    // NIFTY's, since it's always fetched.
    // ===== STEP 4B infrastructure (helpers only — no visible card yet) =====

    // Rule 1: interpretation labels, not claims about who traded.
    function classifyInterpretation(priceDir, oiDir) {
      if (oiDir == null || priceDir == null) return 'UNCONFIRMED';
      if (priceDir === 'up' && oiDir === 'up') return 'BUYING-DOMINANT INTERPRETATION';
      if (priceDir === 'down' && oiDir === 'up') return 'WRITING-DOMINANT INTERPRETATION';
      if (priceDir === 'up' && oiDir === 'down') return 'WRITER-COVERING INTERPRETATION';
      if (priceDir === 'down' && oiDir === 'down') return 'BUYER-UNWINDING INTERPRETATION';
      return 'UNCONFIRMED';
    }

    // Rule 2: track previous ATM per index (continuity check only — does
    // not by itself trigger any reversal classification).
    const lastAtmStrike = {};
    function getAtmContinuity(symbol, currentAtm) {
      const prev = lastAtmStrike[symbol];
      lastAtmStrike[symbol] = currentAtm;
      return { previousAtm: prev != null ? prev : null, switched: prev != null && prev !== currentAtm };
    }

    // Rule 3: 3-minute / 15-minute OI change from stored timestamped
    // snapshots — same closest-match-in-time pattern already used for VIX
    // and straddle timeframe tracking. Returns null (-> hidden field) when
    // no snapshot exists far back enough yet.
    const strikeOiHistory = {};
    function recordStrikeOi(key, oi) {
      if (oi == null) return;
      if (!strikeOiHistory[key]) strikeOiHistory[key] = [];
      const hist = strikeOiHistory[key];
      const last = hist[hist.length - 1];
      if (last && last.oi === oi) return;
      hist.push({ time: new Date(), oi });
      if (hist.length > 300) hist.shift();
    }
    function computeOiChangeFromSnapshot(key, minutesAgo) {
      const hist = strikeOiHistory[key];
      if (!hist || hist.length < 2) return null;
      const now = new Date();
      const targetTime = new Date(now.getTime() - minutesAgo * 60000);
      let closest = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].time <= targetTime) { closest = hist[i]; break; }
      }
      if (!closest) return null;
      const current = hist[hist.length - 1];
      return current.oi - closest.oi;
    }

    // Rule 7: spread% + multi-factor liquidity check (not "high OI = liquid").
    function computeSpreadPct(bid, ask) {
      if (!bid || !ask || bid <= 0 || ask <= 0) return null;
      const mid = (bid + ask) / 2;
      if (mid <= 0) return null;
      return ((ask - bid) / mid) * 100;
    }
    function isLiquid(strikeData) {
      if (!strikeData || !strikeData.bid || !strikeData.ask || strikeData.bid <= 0 || strikeData.ask <= 0) return false;
      if (strikeData.volume == null || strikeData.volume <= 0) return false;
      if (!strikeData.quoteTimestamp) return false;
      const ageSec = (Date.now() - new Date(strikeData.quoteTimestamp).getTime()) / 1000;
      if (ageSec > 360) return false; // non-stale quote — PROVISIONAL threshold, matches STALE_THRESHOLD_MS elsewhere
      return true;
    }

    // 4-state liquidity classification for Step 5A's Liquidity Tracker.
    // Thresholds are PROVISIONAL, not backtested.
    function classifyLiquidity(leg) {
      if (!leg || !leg.bid || !leg.ask || leg.bid <= 0 || leg.ask <= 0) return 'ILLIQUID';
      if (!leg.quoteTimestamp) return 'STALE';
      const ageSec = (Date.now() - new Date(leg.quoteTimestamp).getTime()) / 1000;
      if (ageSec > 360) return 'STALE';
      if (leg.volume == null || leg.volume <= 0) return 'THIN';
      const spreadPct = computeSpreadPct(leg.bid, leg.ask);
      if (spreadPct != null && spreadPct > 5) return 'THIN';
      return 'LIQUID';
    }

    // ===== end Step 4B infrastructure =====

    // ===== STEP 5A infrastructure (data trackers only — no alignment conclusion yet) =====

    // 1. Delta selection rule. Kite never provides a provider-confirmed
    // delta, so PROVIDER DELTA is defined here but will never actually be
    // returned by this app — kept honest rather than silently unreachable.
    function classifyDeltaSource(leg) {
      if (leg && leg.delta) return 'MODEL-ESTIMATED DELTA';
      return 'DELTA UNAVAILABLE';
    }
    // Always MONEYNESS-BASED SELECTION in this app, since provider delta
    // is never available — model-estimated delta is research-only and must
    // never gate the moneyness fallback choice.
    const DELTA_SELECTION_METHOD = 'MONEYNESS-BASED SELECTION';

    // 2. ATM shift tracker — separate from the Premium Pair card's simpler
    // getAtmContinuity() so that card's existing behaviour is untouched.
    const atmShiftTracker = {};
    function updateAtmShiftTracker(symbol, currentAtm, currentSpot) {
      let t = atmShiftTracker[symbol];
      if (!t) {
        t = { current: currentAtm, previous: null, lastShiftTime: null, lastShiftDirection: 'UNCHANGED', shiftCount: 0, spotAtShift: null };
        atmShiftTracker[symbol] = t;
        return t;
      }
      if (currentAtm != null && t.current !== currentAtm) {
        t.previous = t.current;
        t.lastShiftDirection = currentAtm > t.current ? 'UP' : 'DOWN';
        t.lastShiftTime = new Date();
        t.shiftCount++;
        t.spotAtShift = currentSpot;
        t.current = currentAtm;
      }
      return t;
    }

    // 3. Premium candle tracker (3m/5m/15m/30m) — built from whatever
    // sample points this session actually observes (refresh cadence), NOT
    // true tick data. Distinct from spot's window-high-low tracker.
    const premiumCandleTracker = {};
    function getBucketStart(date, intervalMin) {
      const ms = intervalMin * 60000;
      return new Date(Math.floor(date.getTime() / ms) * ms);
    }
    function recordPremiumSample(key, price, volume, oi) {
      if (price == null || price <= 0) return;
      const now = new Date();
      if (!premiumCandleTracker[key]) premiumCandleTracker[key] = { 3: [], 5: [], 15: [], 30: [] };
      [3, 5, 15, 30].forEach((interval) => {
        const candles = premiumCandleTracker[key][interval];
        const bucketStart = getBucketStart(now, interval);
        let candle = candles[candles.length - 1];
        if (!candle || candle.bucketStart.getTime() !== bucketStart.getTime()) {
          if (candle) candle.complete = true;
          candle = { bucketStart, open: price, high: price, low: price, close: price, volume: volume != null ? volume : null, oi: oi != null ? oi : null, complete: false };
          candles.push(candle);
          if (candles.length > 60) candles.shift();
        } else {
          candle.high = Math.max(candle.high, price);
          candle.low = Math.min(candle.low, price);
          candle.close = price;
          if (volume != null) candle.volume = volume;
          if (oi != null) candle.oi = oi;
        }
      });
    }
    function getPremiumCandles(key, interval) {
      return (premiumCandleTracker[key] && premiumCandleTracker[key][interval]) || [];
    }
    function getCompletedPremiumCandles(key, interval) {
      return getPremiumCandles(key, interval).filter((c) => c.complete);
    }

    // 5. Premium Break/Hold/Retest — simplified, PROVISIONAL state machine
    // using completed candles + PDH/PDL. A wick (incomplete candle high/low
    // alone) never confirms a break — only a completed candle's CLOSE
    // beyond the level, optionally followed by a hold or retest.
    function classifyPremiumLevelState(key, currentPrice, pdh, pdl) {
      if (!pdh && !pdl) return 'UNCONFIRMED';
      const completed15 = getCompletedPremiumCandles(key, 15);
      const lastCompleted = completed15[completed15.length - 1];
      const prevCompleted = completed15[completed15.length - 2];

      // FALSE BREAK: a completed candle's wick crossed the level but its
      // close did not confirm the break.
      if (lastCompleted) {
        if (pdh > 0 && lastCompleted.high > pdh && lastCompleted.close <= pdh) return 'FALSE BREAK';
        if (pdl > 0 && lastCompleted.low < pdl && lastCompleted.close >= pdl) return 'FALSE BREAK';
      }

      // PDL RECLAIMED: previous completed candle closed below PDL, current
      // price has recovered back above it.
      if (pdl > 0 && prevCompleted && prevCompleted.close < pdl && currentPrice > pdl) return 'PDL RECLAIMED';
      // PDH REJECTED (symmetric "reclaim" for the upper level): previous
      // completed candle closed above PDH, current price has fallen back
      // below it.
      if (pdh > 0 && prevCompleted && prevCompleted.close > pdh && currentPrice < pdh) return 'PDH REJECTED';

      // RETEST PASSED: broke out above PDH in recent completed candles,
      // price has come back near PDH from above and held above PDL.
      if (pdh > 0 && completed15.length >= 2) {
        const brokeOut = completed15.slice(-3).some((c) => c.close > pdh);
        const nearLevel = Math.abs(currentPrice - pdh) / pdh < 0.003;
        if (brokeOut && nearLevel && currentPrice > pdh) return 'RETEST PASSED';
      }
      if (pdl > 0 && completed15.length >= 2) {
        const brokeDown = completed15.slice(-3).some((c) => c.close < pdl);
        const nearLevel = Math.abs(currentPrice - pdl) / pdl < 0.003;
        if (brokeDown && nearLevel && currentPrice < pdl) return 'RETEST PASSED';
      }

      if (pdh > 0) {
        if (currentPrice > pdh * 1.001) {
          if (lastCompleted && lastCompleted.close > pdh) {
            const holdCandles = completed15.slice(-2);
            const held = holdCandles.every((c) => c.close > pdh);
            return held && holdCandles.length >= 2 ? 'PDH BREAKOUT' : 'PDH TESTING';
          }
          return 'PDH TESTING';
        }
        if (Math.abs(currentPrice - pdh) / pdh < 0.003) return 'APPROACHING PDH';
      }
      if (pdl > 0) {
        if (currentPrice < pdl * 0.999) {
          if (lastCompleted && lastCompleted.close < pdl) {
            const holdCandles = completed15.slice(-2);
            const held = holdCandles.every((c) => c.close < pdl);
            return held && holdCandles.length >= 2 ? 'PDL BREAKDOWN' : 'PDL TESTING';
          }
          return 'PDL TESTING';
        }
        if (Math.abs(currentPrice - pdl) / pdl < 0.003) return 'APPROACHING PDL';
      }
      return 'HOLD PENDING';
    }

    // 6. Option VWAP labels already implemented in Step 4B (vwapSource on
    // PremiumData) — CALCULATED SESSION VWAP remains unreachable since we
    // do not have the granular intraday price+volume ticks to compute a
    // genuine session VWAP ourselves; kept as a defined label for honesty.

    // ===== end Step 5A infrastructure =====

    // ===== STEP 5B: Cross-Expiry ITM Alignment Conclusion (display+logging/shadow mode only) =====

    // B. Readiness hard gate — shared by Tracker Readiness (5A) and this
    // conclusion (5B), so both always agree on what's missing.
    function computeStep5Readiness(symbol, m) {
      const missing = [];
      if (!m || m.error) { missing.push('Index Data'); return { ready: false, missing: missing }; }
      if (!m.expiries || m.expiries.length === 0) { missing.push('Expiries'); return { ready: false, missing: missing }; }
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe && !atmPe) missing.push('ATM CE/PE');
      if (!m.snapshotId) missing.push('Snapshot ID');
      if (atmCe && !(atmCe.pdh > 0 || atmCe.pdl > 0)) missing.push('CE Premium PDH/PDL');
      if (atmPe && !(atmPe.pdh > 0 || atmPe.pdl > 0)) missing.push('PE Premium PDH/PDL');
      return { ready: missing.length === 0, missing: missing };
    }

    // D. Unique expiries only — tags a later expiry as MONTHLY onto the
    // earlier entry with the same date instead of duplicating/double-voting.
    function getUniqueExpiriesWithTags(m) {
      if (!m || !m.expiries) return [];
      const order = ['Current Expiry', 'Next Expiry', 'Next of Next Expiry', 'Monthly'];
      const ordered = order.map((label) => m.expiries.find((e) => e.expiry === label)).filter(Boolean);
      const seenDates = {};
      const result = [];
      ordered.forEach((exp) => {
        const dateKey = exp.expiryDate ? new Date(exp.expiryDate).toDateString() : null;
        if (dateKey && seenDates[dateKey] != null) {
          const existing = result[seenDates[dateKey]];
          if (exp.expiry === 'Monthly' && existing.tags.indexOf('MONTHLY') === -1) existing.tags.push('MONTHLY');
          return;
        }
        const entry = { expiry: exp.expiry, expiryDate: exp.expiryDate, ceStrikes: exp.ceStrikes, peStrikes: exp.peStrikes, tags: exp.expiry === 'Monthly' ? ['MONTHLY'] : [] };
        if (dateKey) seenDates[dateKey] = result.length;
        result.push(entry);
      });
      return result;
    }

    // E. Comparable ITM selection — always MONEYNESS-BASED SELECTION since
    // provider delta never exists in this app (see Step 5A rule 1).
    function inferStrikeStep(strikes) {
      if (!strikes || strikes.length < 2) return null;
      const sorted = strikes.map((s) => s.strike).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[0]) return sorted[i] - sorted[0];
      }
      return null;
    }
    function findItmLeg(strikes, atmStrike, stepCount, isCall) {
      if (!strikes || atmStrike == null) return null;
      const step = inferStrikeStep(strikes);
      if (!step) return null;
      const target = isCall ? atmStrike - stepCount * step : atmStrike + stepCount * step;
      return strikes.find((s) => s.strike === target) || null;
    }

    // F. Responsiveness — never from LTP movement alone; requires
    // liquidity + a real price direction reading from this session\u2019s
    // own tracked history.
    function classifyResponsiveness(key, leg, vixChangePercent) {
      const liquidity = classifyLiquidity(leg);
      if (liquidity === 'ILLIQUID') return 'ILLIQUID';
      if (liquidity === 'STALE') return 'STALE';
      const priceDir = priceDirection(key + '_price', leg.lastPrice);
      if (priceDir == null) return 'UNCONFIRMED';
      if (priceDir === 'flat') return 'NO RESPONSE';
      if (liquidity === 'THIN') return 'WEAK RESPONSE';
      if (vixChangePercent != null && Math.abs(vixChangePercent) >= 3) return 'IV/VOLATILITY-DRIVEN POSSIBLE';
      return 'RESPONSIVE';
    }

    // G. Normalized premium location — PROVISIONAL thresholds.
    function computeRangePosition(current, pdl, pdh) {
      if (!(pdh > 0) || !(pdl > 0) || pdh <= pdl) return { pct: null, state: 'UNCONFIRMED' };
      const pct = ((current - pdl) / (pdh - pdl)) * 100;
      let state;
      if (pct < 0) state = 'BELOW PDL';
      else if (pct <= 20) state = 'NEAR PDL';
      else if (pct <= 40) state = 'LOWER RANGE';
      else if (pct <= 60) state = 'MID-RANGE';
      else if (pct <= 80) state = 'UPPER RANGE / MOVING TOWARD PDH';
      else if (pct <= 100) state = 'NEAR PDH';
      else state = 'PDH BREAKOUT';
      return { pct: pct, state: state };
    }

    // H/I. Per-expiry CE or PE state — PROVISIONAL scored heuristic (not
    // backtested). "Most of" the listed conditions is approximated as a
    // point score with disclosed weights.
    function classifyExpiryLegState(symbol, expiryLabel, leg, oppositeLeg, isCall, marketOpen) {
      const sideLabel = isCall ? 'CE' : 'PE';
      if (!leg) return sideLabel + ' DATA INSUFFICIENT';
      if (!marketOpen) return sideLabel + ' DATA INSUFFICIENT';
      const liquidity = classifyLiquidity(leg);
      if (liquidity === 'ILLIQUID' || liquidity === 'STALE') return sideLabel + ' DATA INSUFFICIENT';
      if (!(leg.pdh > 0 && leg.pdl > 0)) return sideLabel + ' DATA INSUFFICIENT';

      const key = symbol + '_step5b_' + expiryLabel + '_' + sideLabel + '_' + leg.strike;
      const priceDir = priceDirection(key + '_price', leg.lastPrice);
      const oiInfo = oiArrowInfo(key + '_oi', leg.oi);
      const interp = classifyInterpretation(priceDir, oiInfo.cls);
      const levelState = classifyPremiumLevelState(key, leg.lastPrice, leg.pdh, leg.pdl);
      const movingUpFromPdl = levelState === 'PDL RECLAIMED' || (leg.lastPrice > leg.pdl && priceDir === 'up');
      const brokeHigh = levelState === 'PDH BREAKOUT' || levelState === 'RETEST PASSED';

      let oppositeWeakening = false;
      if (oppositeLeg) {
        const oppKey = symbol + '_step5b_' + expiryLabel + '_' + (isCall ? 'PE' : 'CE') + '_' + oppositeLeg.strike;
        const oppDir = priceDirection(oppKey + '_price', oppositeLeg.lastPrice);
        oppositeWeakening = oppDir === 'down';
      }

      let score = 0;
      if (interp === 'BUYING-DOMINANT INTERPRETATION') score += 2;
      else if (interp === 'WRITER-COVERING INTERPRETATION') score += 1;
      else if (interp === 'WRITING-DOMINANT INTERPRETATION' || interp === 'BUYER-UNWINDING INTERPRETATION') score -= 2;
      if (movingUpFromPdl) score += 1;
      if (brokeHigh) score += 2;
      if (oppositeWeakening) score += 1;
      if (liquidity === 'LIQUID') score += 1;

      if (score >= 5) return sideLabel + ' STRONG';
      if (score >= 3) return sideLabel + ' SUPPORTIVE';
      if (score <= -2) return sideLabel + ' CONFLICTING';
      if (score <= 0) return sideLabel + ' WEAK';
      return sideLabel + ' NEUTRAL';
    }

    // P. Futures cross-check — reuses the existing futures classification
    // (classifyFuturesBuildup, built for the FUTURES tab) without
    // recalculating it.
    function classifyFuturesCrossCheck(itmDirection, futuresLabel) {
      if (!futuresLabel || futuresLabel === 'NO CLEAR SIGNAL') return 'FUTURES DATA INSUFFICIENT';
      if (itmDirection === 'CE') {
        if (futuresLabel === 'LONG BUILD-UP') return 'ITM ALIGNMENT + FUTURES BULLISH';
        if (futuresLabel === 'SHORT COVERING') return 'ITM ALIGNMENT + SHORT COVERING ONLY';
        if (futuresLabel === 'SHORT BUILD-UP' || futuresLabel === 'LONG UNWINDING') return 'ITM\u2013FUTURES CONFLICT';
      }
      if (itmDirection === 'PE') {
        if (futuresLabel === 'SHORT BUILD-UP') return 'ITM ALIGNMENT + FUTURES BEARISH';
        if (futuresLabel === 'LONG UNWINDING') return 'ITM ALIGNMENT + LONG UNWINDING ONLY';
        if (futuresLabel === 'LONG BUILD-UP' || futuresLabel === 'SHORT COVERING') return 'ITM\u2013FUTURES CONFLICT';
      }
      return 'PARTIAL ALIGNMENT';
    }

    // Q. Three-index context — reuses the existing classifyIndexOverallBias
    // (VERDICT tab), does not recompute it.
    function classifyThreeIndexContext(symbol, itmDirection) {
      if (!data) return 'THREE-INDEX DATA INCOMPLETE';
      const others = ['NIFTY', 'BANKNIFTY', 'SENSEX'].filter((s) => s !== symbol);
      const biases = others.map((s) => classifyIndexOverallBias(data[s]));
      if (biases.some((b) => b === 'DATA UNAVAILABLE')) return 'THREE-INDEX DATA INCOMPLETE';
      const bucket = (b) => biasToBucket(b);
      const buckets = biases.map(bucket);
      const wantBullish = itmDirection === 'CE';
      const supportive = buckets.filter((b) => (wantBullish && b === 'bullish') || (!wantBullish && b === 'bearish')).length;
      const opposite = buckets.filter((b) => (wantBullish && b === 'bearish') || (!wantBullish && b === 'bullish')).length;
      if (opposite >= 1) return 'THREE-INDEX CONFLICT';
      if (supportive >= 1) return 'THREE-INDEX SUPPORTIVE';
      return 'THREE-INDEX NEUTRAL';
    }

    // Main Step 5B orchestrator — assembles everything above into the
    // final display conclusion. Shadow mode: return value is never fed
    // into classifyIndexOverallBias/computeAlignmentStatus.
    function computeStep5BConclusion(symbol, m) {
      const readiness = computeStep5Readiness(symbol, m);
      if (!readiness.ready) {
        return { blocked: true, reason: 'STEP 5B BLOCKED \u2014 MISSING PREREQUISITES: ' + readiness.missing.join(', ') };
      }

      const marketOpen = isMarketOpenNow();
      const uniqueExpiries = getUniqueExpiriesWithTags(m);
      const current = uniqueExpiries[0];
      if (!current) return { blocked: true, reason: 'STEP 5B BLOCKED \u2014 MISSING PREREQUISITES: Current Expiry' };

      const atmCe = (current.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (current.peStrikes || []).find((s) => s.isAtm);
      const oneItmCe = findItmLeg(current.ceStrikes, atmCe ? atmCe.strike : (atmPe ? atmPe.strike : null), 1, true);
      const oneItmPe = findItmLeg(current.peStrikes, atmPe ? atmPe.strike : (atmCe ? atmCe.strike : null), 1, false);

      // Hard gates (R) — snapshot mismatch or stale quotes disable
      // interpretation entirely rather than showing a partial conclusion.
      const blockReasons = [];
      if (atmCe && classifyLiquidity(atmCe) === 'STALE') blockReasons.push('CE stale quote');
      if (atmPe && classifyLiquidity(atmPe) === 'STALE') blockReasons.push('PE stale quote');
      if (!m.snapshotId) blockReasons.push('snapshot mismatch');
      if (blockReasons.length > 0) {
        return { blocked: true, reason: 'STEP 5B BLOCKED \u2014 ' + blockReasons.join(', ').toUpperCase() };
      }

      const ceKeyAtm = symbol + '_step5b_' + current.expiry + '_CE_' + (atmCe ? atmCe.strike : 'na');
      const peKeyAtm = symbol + '_step5b_' + current.expiry + '_PE_' + (atmPe ? atmPe.strike : 'na');
      const ceResp = atmCe ? classifyResponsiveness(ceKeyAtm, atmCe, m.vixChangePercent) : 'UNCONFIRMED';
      const peResp = atmPe ? classifyResponsiveness(peKeyAtm, atmPe, m.vixChangePercent) : 'UNCONFIRMED';
      const ceItmResp = oneItmCe ? classifyResponsiveness(ceKeyAtm + '_itm', oneItmCe, m.vixChangePercent) : 'UNCONFIRMED';
      const peItmResp = oneItmPe ? classifyResponsiveness(peKeyAtm + '_itm', oneItmPe, m.vixChangePercent) : 'UNCONFIRMED';

      const ceRange = atmCe ? computeRangePosition(atmCe.lastPrice, atmCe.pdl, atmCe.pdh) : { pct: null, state: 'UNCONFIRMED' };
      const peRange = atmPe ? computeRangePosition(atmPe.lastPrice, atmPe.pdl, atmPe.pdh) : { pct: null, state: 'UNCONFIRMED' };

      // Price + OI interpretation and liquidity for the ATM legs — shown
      // explicitly on this card, not just used internally.
      const ceInterp = atmCe ? classifyInterpretation(priceDirection(ceKeyAtm + '_price', atmCe.lastPrice), oiArrowInfo(ceKeyAtm + '_oi', atmCe.oi).cls) : 'UNCONFIRMED';
      const peInterp = atmPe ? classifyInterpretation(priceDirection(peKeyAtm + '_price', atmPe.lastPrice), oiArrowInfo(peKeyAtm + '_oi', atmPe.oi).cls) : 'UNCONFIRMED';
      const ceLiquidity = atmCe ? classifyLiquidity(atmCe) : 'DATA UNAVAILABLE';
      const peLiquidity = atmPe ? classifyLiquidity(atmPe) : 'DATA UNAVAILABLE';

      // Per-expiry CE/PE states across all unique expiries
      const perExpiryCe = uniqueExpiries.map((exp) => {
        const ce = (exp.ceStrikes || []).find((s) => s.isAtm) || findItmLeg(exp.ceStrikes, atmCe ? atmCe.strike : null, 1, true);
        const pe = (exp.peStrikes || []).find((s) => s.isAtm);
        return { expiry: exp.expiry, tags: exp.tags, state: classifyExpiryLegState(symbol, exp.expiry, ce, pe, true, marketOpen) };
      });
      const perExpiryPe = uniqueExpiries.map((exp) => {
        const pe = (exp.peStrikes || []).find((s) => s.isAtm) || findItmLeg(exp.peStrikes, atmPe ? atmPe.strike : null, 1, false);
        const ce = (exp.ceStrikes || []).find((s) => s.isAtm);
        return { expiry: exp.expiry, tags: exp.tags, state: classifyExpiryLegState(symbol, exp.expiry, pe, ce, false, marketOpen) };
      });

      const laterCe = perExpiryCe.slice(1);
      const laterPe = perExpiryPe.slice(1);
      const laterCeSupport = laterCe.some((e) => e.state.indexOf('STRONG') !== -1 || e.state.indexOf('SUPPORTIVE') !== -1);
      const laterCeConflict = laterCe.some((e) => e.state.indexOf('CONFLICTING') !== -1);
      const laterPeSupport = laterPe.some((e) => e.state.indexOf('STRONG') !== -1 || e.state.indexOf('SUPPORTIVE') !== -1);
      const laterPeConflict = laterPe.some((e) => e.state.indexOf('CONFLICTING') !== -1);

      const currentCeState = perExpiryCe[0] ? perExpiryCe[0].state : 'CE DATA INSUFFICIENT';
      const currentPeState = perExpiryPe[0] ? perExpiryPe[0].state : 'PE DATA INSUFFICIENT';
      // "Weak" for the opposite-premium-weakness gate: anything not
      // STRONG/SUPPORTIVE counts as weak enough to not block the other side.
      const peWeakEnough = currentPeState.indexOf('STRONG') === -1 && currentPeState.indexOf('SUPPORTIVE') === -1;
      const ceWeakEnough = currentCeState.indexOf('STRONG') === -1 && currentCeState.indexOf('SUPPORTIVE') === -1;

      const bestCe = (ceResp === 'RESPONSIVE') ? 'ATM' : (ceItmResp === 'RESPONSIVE' ? '1-ITM' : null);
      const bestPe = (peResp === 'RESPONSIVE') ? 'ATM' : (peItmResp === 'RESPONSIVE' ? '1-ITM' : null);

      // Single unified final status — merges the earlier separate
      // cross-expiry/current-expiry concepts into the exact 14-value
      // enum this instruction specifies, in priority order.
      let finalStatus;
      let itmDirection = null;

      if (bestCe && !peWeakEnough && !bestPe) {
        finalStatus = 'OPPOSITE PREMIUM NOT WEAK';
      } else if (bestPe && !ceWeakEnough && !bestCe) {
        finalStatus = 'OPPOSITE PREMIUM NOT WEAK';
      } else if (bestCe && peWeakEnough) {
        itmDirection = 'CE';
        if (laterCeConflict) {
          finalStatus = 'LONGER-EXPIRY CONFLICT';
        } else if (laterCeSupport) {
          finalStatus = (currentCeState.indexOf('STRONG') !== -1 && laterCe[0] && laterCe[0].state.indexOf('STRONG') !== -1)
            ? 'STRONG CROSS-EXPIRY ITM CE ALIGNMENT' : 'CROSS-EXPIRY ITM CE ALIGNMENT';
        } else if (currentCeState.indexOf('NEUTRAL') !== -1 || currentCeState.indexOf('DATA INSUFFICIENT') !== -1) {
          finalStatus = 'CURRENT-EXPIRY-ONLY MOVE \u2014 POSSIBLE EXPIRY NOISE';
        } else {
          finalStatus = bestCe === 'ATM' ? 'CURRENT ATM CE SUPPORTIVE' : 'CURRENT 1-ITM CE PREFERRED';
        }
      } else if (bestPe && ceWeakEnough) {
        itmDirection = 'PE';
        if (laterPeConflict) {
          finalStatus = 'LONGER-EXPIRY CONFLICT';
        } else if (laterPeSupport) {
          finalStatus = (currentPeState.indexOf('STRONG') !== -1 && laterPe[0] && laterPe[0].state.indexOf('STRONG') !== -1)
            ? 'STRONG CROSS-EXPIRY ITM PE ALIGNMENT' : 'CROSS-EXPIRY ITM PE ALIGNMENT';
        } else if (currentPeState.indexOf('NEUTRAL') !== -1 || currentPeState.indexOf('DATA INSUFFICIENT') !== -1) {
          finalStatus = 'CURRENT-EXPIRY-ONLY MOVE \u2014 POSSIBLE EXPIRY NOISE';
        } else {
          finalStatus = bestPe === 'ATM' ? 'CURRENT ATM PE SUPPORTIVE' : 'CURRENT 1-ITM PE PREFERRED';
        }
      } else {
        // Point 6: use the exact backend cause where determinable, rather
        // than a generic label — checks the real backend error first.
        if (m.error) {
          const errText = String(m.error).toLowerCase();
          if (errText.indexOf('token') !== -1) finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 TOKEN MISSING OR EXPIRED';
          else if (errText.indexOf('timeout') !== -1) finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 API TIMEOUT';
          else if (errText.indexOf('instrument') !== -1) finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 INVALID INSTRUMENT';
          else finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 BROKER FEED UNAVAILABLE';
        } else if (!atmCe && !atmPe) {
          finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 INVALID INSTRUMENT (no ATM contract found)';
        } else if ((atmCe && classifyLiquidity(atmCe) === 'STALE') || (atmPe && classifyLiquidity(atmPe) === 'STALE')) {
          finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 STALE QUOTE';
        } else {
          finalStatus = 'CURRENT EXPIRY NOT RESPONDING \u2014 EXPIRY MISMATCH OR BROKER FEED UNAVAILABLE';
        }
      }

      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      let futuresLabel = 'NO CLEAR SIGNAL';
      if (contract && contract.oi != null) {
        const fKey = symbol + '_step5b_futures';
        const priceDir = futuresDirection(fKey + '_price', contract.ltp);
        const oiDir = futuresDirection(fKey + '_oi', contract.oi);
        const b = classifyFuturesBuildup(priceDir, oiDir);
        futuresLabel = b.label;
      }
      const futuresCrossCheck = itmDirection ? classifyFuturesCrossCheck(itmDirection, futuresLabel) : 'FUTURES DATA INSUFFICIENT';
      const threeIndexContext = itmDirection ? classifyThreeIndexContext(symbol, itmDirection) : 'THREE-INDEX DATA INCOMPLETE';

      // Futures directly conflicting with the claimed ITM direction
      // overrides the alignment/supportive claim.
      if (itmDirection && futuresCrossCheck === 'ITM\u2013FUTURES CONFLICT' &&
          (finalStatus.indexOf('ALIGNMENT') !== -1 || finalStatus.indexOf('SUPPORTIVE') !== -1 || finalStatus.indexOf('PREFERRED') !== -1)) {
        finalStatus = 'ITM\u2013FUTURES CONFLICT';
      }

      return {
        blocked: false,
        current: current, uniqueExpiries: uniqueExpiries,
        atmCe: atmCe, atmPe: atmPe, oneItmCe: oneItmCe, oneItmPe: oneItmPe,
        ceResp: ceResp, peResp: peResp, ceItmResp: ceItmResp, peItmResp: peItmResp,
        ceRange: ceRange, peRange: peRange,
        ceInterp: ceInterp, peInterp: peInterp, ceLiquidity: ceLiquidity, peLiquidity: peLiquidity,
        oppositePeWeak: peWeakEnough, oppositeCeWeak: ceWeakEnough,
        perExpiryCe: perExpiryCe, perExpiryPe: perExpiryPe,
        futuresLabel: futuresLabel, futuresCrossCheck: futuresCrossCheck,
        threeIndexContext: threeIndexContext, finalStatus: finalStatus,
      };
    }

    function renderStep5BCard(symbol, m) {
      const result = computeStep5BConclusion(symbol, m);
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Current-Expiry Trade + Cross-Expiry ITM Alignment</div>';

      if (result.blocked) {
        html += '<div style="background:rgba(229,72,77,0.14); border:2px solid var(--red); border-radius:6px; padding:8px; color:var(--red); font-weight:700; font-size:0.8rem;">' + escapeHtml(result.reason) + '</div>';
        html += '</div>';
        return html;
      }

      resetRowLineTracking();

      const statusColor = result.finalStatus.indexOf('CE') !== -1 && (result.finalStatus.indexOf('ALIGNMENT') !== -1 || result.finalStatus.indexOf('SUPPORTIVE') !== -1 || result.finalStatus.indexOf('PREFERRED') !== -1) ? 'var(--green)' :
        result.finalStatus.indexOf('PE') !== -1 && (result.finalStatus.indexOf('ALIGNMENT') !== -1 || result.finalStatus.indexOf('SUPPORTIVE') !== -1 || result.finalStatus.indexOf('PREFERRED') !== -1) ? 'var(--red)' :
        (result.finalStatus.indexOf('CONFLICT') !== -1 || result.finalStatus.indexOf('NOT WEAK') !== -1 || result.finalStatus.indexOf('NOT RESPONDING') !== -1) ? 'var(--gold)' : 'var(--muted)';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase;">Final</div>';
      html += '<div style="color:' + statusColor + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(result.finalStatus) + '</div>';
      html += '</div>';

      html += '<details><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show full breakdown</summary>';
      html += '<div style="margin-top:8px;">';

      const c = result.current;
      const expiryDateText = formatExpiryDate(c.expiryDate);
      const isMonthly = c.tags.indexOf('MONTHLY') !== -1;
      html += rowLine('Trade Expiry', (expiryDateText || 'DATA UNAVAILABLE') + (isMonthly ? ' \u2014 MONTHLY' : ' \u2014 ' + c.expiry.toUpperCase()));

      html += '<div class="fii-section-label">Current Trade Pair</div>';
      html += rowLine('ATM CE State', result.ceResp);
      html += rowLine('1-ITM CE State', result.ceItmResp);
      html += rowLine('CE Range Position', result.ceRange.pct != null ? result.ceRange.pct.toFixed(0) + '% \u2014 ' + result.ceRange.state : 'DATA UNAVAILABLE');
      html += rowLine('CE Price + OI Interpretation', result.ceInterp);
      html += rowLine('CE Liquidity', result.ceLiquidity);
      html += rowLine('ATM PE State', result.peResp);
      html += rowLine('1-ITM PE State', result.peItmResp);
      html += rowLine('PE Range Position', result.peRange.pct != null ? result.peRange.pct.toFixed(0) + '% \u2014 ' + result.peRange.state : 'DATA UNAVAILABLE');
      html += rowLine('PE Price + OI Interpretation', result.peInterp);
      html += rowLine('PE Liquidity', result.peLiquidity);
      html += rowLine('Opposite-Premium Weakness', result.oppositePeWeak && result.oppositeCeWeak ? 'BOTH WEAK ENOUGH' : (result.oppositePeWeak ? 'PE WEAK (supports CE)' : (result.oppositeCeWeak ? 'CE WEAK (supports PE)' : 'NEITHER WEAK')));

      html += '<div class="fii-section-label">Cross-Expiry ITM</div>';
      result.perExpiryCe.forEach((e, i) => {
        const tag = e.tags.length ? ' (' + e.tags.join(',') + ')' : '';
        html += rowLine(e.expiry + tag, e.state);
      });

      html += '<div class="fii-section-label">Futures & Context</div>';
      html += rowLine('Futures', result.futuresLabel);
      html += rowLine('Futures Cross-Check', result.futuresCrossCheck);
      html += rowLine('Three-Index Context', result.threeIndexContext);
      html += rowLine('Snapshot', m.snapshotId ? 'SYNCED' : 'MISMATCH');

      html += '</div></details>';

      html += partialDataFooter();
      html += '<div class="timestamp">Shadow mode \u2014 display and logging only. Does not modify the existing Verdict/Alignment logic and does not enable any order. Per-expiry CE/PE strength uses a PROVISIONAL scored heuristic (not backtested). ITM selection is always moneyness-based (1-strike ITM) \u2014 this app never has a provider-verified delta.</div>';
      html += '</div>';
      return html;
    }

    function renderStep5BSummaryLine(symbol) {
      const m = data ? data[symbol] : null;
      const result = computeStep5BConclusion(symbol, m);
      if (result.blocked) return symbol + ' \u2014 STEP 5B BLOCKED';
      return symbol + ' \u2014 ' + result.finalStatus;
    }

    // ===== end STEP 5B =====

    // ===== STEP 6A: ATM Straddle Alignment (display+logging/shadow mode only) =====

    function computeStraddleShare(ce, pe) {
      const straddle = ce + pe;
      if (!(straddle > 0)) return { ceShare: null, peShare: null, classification: 'UNCONFIRMED' };
      const ceShare = (ce / straddle) * 100;
      const peShare = (pe / straddle) * 100;
      let classification;
      if (ceShare >= 60) classification = 'CE DOMINANT';
      else if (peShare >= 60) classification = 'PE DOMINANT';
      else classification = 'BALANCED';
      return { ceShare: ceShare, peShare: peShare, classification: classification };
    }

    function computeStep6AConclusion(symbol, m) {
      const readiness = computeStep5Readiness(symbol, m);
      if (!readiness.ready) {
        return { blocked: true, reason: 'STRADDLE DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };
      }
      const exp = (m.expiries || []).find((e) => e.expiry === 'Current Expiry') || (m.expiries || [])[0];
      if (!exp) return { blocked: true, reason: 'STRADDLE DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe || !atmPe) return { blocked: true, reason: 'STRADDLE DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };

      const ceLiquidity = classifyLiquidity(atmCe);
      const peLiquidity = classifyLiquidity(atmPe);
      if (ceLiquidity === 'STALE' || peLiquidity === 'STALE') {
        return { blocked: true, reason: 'STRADDLE DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };
      }

      const marketOpen = isMarketOpenNow();
      updateAtmShiftTracker(symbol, atmCe.strike, m.current);
      const shiftInfo = atmShiftTracker[symbol];

      const straddleKey = symbol + '_' + exp.expiry + '_straddle_' + atmCe.strike;
      const straddleValue = atmCe.lastPrice + atmPe.lastPrice;
      recordStraddleHistory(straddleKey, straddleValue);
      const straddle3m = computeStraddleTimeframeChange(straddleKey, 3);
      const straddle15m = computeStraddleTimeframeChange(straddleKey, 15);

      const prevStraddle = (atmCe.pdc && atmPe.pdc) ? (atmCe.pdc + atmPe.pdc) : null;
      const straddleChange = prevStraddle ? straddleValue - prevStraddle : null;
      const straddleChangePct = (prevStraddle && prevStraddle > 0) ? (straddleChange / prevStraddle) * 100 : null;

      const hist = straddleHistoryData[straddleKey] || [];
      const sessionHigh = hist.length ? Math.max.apply(null, hist.map((h) => h.straddle)) : null;
      const sessionLow = hist.length ? Math.min.apply(null, hist.map((h) => h.straddle)) : null;

      const share = computeStraddleShare(atmCe.lastPrice, atmPe.lastPrice);

      const ceKey = symbol + '_step6a_' + exp.expiry + '_CE_' + atmCe.strike;
      const peKey = symbol + '_step6a_' + exp.expiry + '_PE_' + atmPe.strike;
      const cePriceDir = priceDirection(ceKey + '_price', atmCe.lastPrice);
      const pePriceDir = priceDirection(peKey + '_price', atmPe.lastPrice);
      const ceOiInfo = oiArrowInfo(ceKey + '_oi', atmCe.oi);
      const peOiInfo = oiArrowInfo(peKey + '_oi', atmPe.oi);
      const ceInterp = classifyInterpretation(cePriceDir, ceOiInfo.cls);
      const peInterp = classifyInterpretation(pePriceDir, peOiInfo.cls);

      const ceStrengthening = cePriceDir === 'up';
      const peStrengthening = pePriceDir === 'up';
      const ceWeakening = cePriceDir === 'down';
      const peWeakening = pePriceDir === 'down';

      const isExpiryDay = exp.expiryDate && new Date(exp.expiryDate).toDateString() === new Date().toDateString();
      const nearFloor = atmCe.lastPrice < 1 || atmPe.lastPrice < 1;

      const recentShift = shiftInfo.lastShiftTime && (Date.now() - shiftInfo.lastShiftTime.getTime()) < 3 * 60000;

      let straddleState;
      if (!marketOpen) straddleState = 'DATA INSUFFICIENT';
      else if (isExpiryDay && nearFloor) straddleState = 'EXPIRY-DAY DISTORTION';
      else if (recentShift) straddleState = 'ATM SHIFT DISTORTION';
      else if (straddle3m == null) straddleState = 'DATA INSUFFICIENT';
      else if (ceStrengthening && peStrengthening) straddleState = 'BOTH SIDES EXPANDING';
      else if (ceWeakening && peWeakening) straddleState = 'BOTH SIDES WEAKENING';
      else if (straddle3m > 2) straddleState = ceStrengthening && !peStrengthening ? 'DIRECTIONAL CE EXPANSION' : (peStrengthening && !ceStrengthening ? 'DIRECTIONAL PE EXPANSION' : 'STRADDLE EXPANDING');
      else if (straddle3m < -2) straddleState = 'STRADDLE CONTRACTING';
      else straddleState = 'STRADDLE STABLE';

      // Full directional gate (sections 5/6) — reuses spot-vs-VWAP as the
      // spot-bias proxy (same convention as the Spot+Futures Core Status
      // card), existing futures classification, and Step 5B's Premium
      // Pair conclusion, rather than recomputing any of that logic.
      const spotBias = (m.vwap > 0) ? (m.current > m.vwap ? 'bullish' : (m.current < m.vwap ? 'bearish' : null)) : null;
      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      let futuresLabel = 'NO CLEAR SIGNAL';
      if (contract && contract.oi != null) {
        const fKey = symbol + '_step6a_futures';
        const priceDir = futuresDirection(fKey + '_price', contract.ltp);
        const oiDir = futuresDirection(fKey + '_oi', contract.oi);
        futuresLabel = classifyFuturesBuildup(priceDir, oiDir).label;
      }
      const futuresBullish = futuresLabel === 'LONG BUILD-UP' || futuresLabel === 'SHORT COVERING';
      const futuresBearish = futuresLabel === 'SHORT BUILD-UP' || futuresLabel === 'LONG UNWINDING';

      const premiumPairResult = computeStep5BConclusion(symbol, m);
      const ppFinal = premiumPairResult.blocked ? '' : premiumPairResult.finalStatus;
      const isAlignedLabel = (s) => s.indexOf('ALIGNMENT') !== -1 || s.indexOf('SUPPORTIVE') !== -1 || s.indexOf('PREFERRED') !== -1;
      const premiumPairCeAligned = ppFinal.indexOf('CE') !== -1 && isAlignedLabel(ppFinal);
      const premiumPairPeAligned = ppFinal.indexOf('PE') !== -1 && isAlignedLabel(ppFinal);

      if (straddleState === 'DIRECTIONAL CE EXPANSION' && !(peWeakening && share.classification !== 'PE DOMINANT' && spotBias === 'bullish' && futuresBullish && premiumPairCeAligned && ceLiquidity === 'LIQUID')) {
        straddleState = 'STRADDLE EXPANDING'; // gate failed — fall back to the non-directional read
      }
      if (straddleState === 'DIRECTIONAL PE EXPANSION' && !(ceWeakening && share.classification !== 'CE DOMINANT' && spotBias === 'bearish' && futuresBearish && premiumPairPeAligned && peLiquidity === 'LIQUID')) {
        straddleState = 'STRADDLE EXPANDING';
      }

      let crossCheck = 'UNCONFIRMED';
      if (straddleState === 'DIRECTIONAL CE EXPANSION') {
        crossCheck = (premiumPairCeAligned && futuresBullish) ? 'STRADDLE + PREMIUM + FUTURES BULLISH' :
          (!premiumPairCeAligned ? 'STRADDLE\u2013PREMIUM CONFLICT' : (!futuresBullish ? 'STRADDLE\u2013FUTURES CONFLICT' : 'PARTIAL ALIGNMENT'));
      } else if (straddleState === 'DIRECTIONAL PE EXPANSION') {
        crossCheck = (premiumPairPeAligned && futuresBearish) ? 'STRADDLE + PREMIUM + FUTURES BEARISH' :
          (!premiumPairPeAligned ? 'STRADDLE\u2013PREMIUM CONFLICT' : (!futuresBearish ? 'STRADDLE\u2013FUTURES CONFLICT' : 'PARTIAL ALIGNMENT'));
      }

      return {
        blocked: false, exp: exp, atmCe: atmCe, atmPe: atmPe,
        straddleValue: straddleValue, prevStraddle: prevStraddle, straddleChange: straddleChange, straddleChangePct: straddleChangePct,
        straddle3m: straddle3m, straddle15m: straddle15m, sessionHigh: sessionHigh, sessionLow: sessionLow,
        share: share, ceInterp: ceInterp, peInterp: peInterp, ceLiquidity: ceLiquidity, peLiquidity: peLiquidity,
        straddleState: straddleState, crossCheck: crossCheck, futuresLabel: futuresLabel,
        isExpiryDay: isExpiryDay,
      };
    }

    function renderStep6ACard(symbol, m) {
      const result = computeStep6AConclusion(symbol, m);
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">ATM Straddle Alignment</div>';

      if (result.blocked) {
        html += '<div style="background:rgba(229,72,77,0.14); border:2px solid var(--red); border-radius:6px; padding:8px; color:var(--red); font-weight:700; font-size:0.8rem;">' + escapeHtml(result.reason) + '</div>';
        html += '</div>';
        return html;
      }

      resetRowLineTracking();
      if (result.isExpiryDay) {
        html += '<div style="background:rgba(201,162,39,0.14); border:2px solid var(--gold); border-radius:6px; padding:6px 8px; margin-bottom:8px; color:var(--gold); font-weight:700; font-size:0.75rem;">\u26a0 EXPIRY RISK HIGH</div>';
      }

      const stColor = result.straddleState.indexOf('CE') !== -1 ? 'var(--green)' : result.straddleState.indexOf('PE') !== -1 ? 'var(--red)' : result.straddleState.indexOf('DISTORTION') !== -1 ? 'var(--gold)' : 'var(--muted)';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase;">Final</div>';
      html += '<div style="color:' + stColor + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(result.straddleState) + '</div>';
      html += '</div>';

      html += '<details><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show full breakdown</summary>';
      html += '<div style="margin-top:8px;">';

      html += rowLine('Expiry', formatExpiryDate(result.exp.expiryDate) || 'DATA UNAVAILABLE');
      html += rowLine('ATM Strike', String(result.atmCe.strike));

      html += '<div class="fii-section-label" style="color:var(--green);">ATM CE</div>';
      html += rowLine('CE LTP', result.atmCe.lastPrice > 0 ? '\u20b9' + result.atmCe.lastPrice.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('CE Change', result.atmCe.change ? (result.atmCe.change >= 0 ? '+' : '') + result.atmCe.change.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('CE Interpretation', result.ceInterp);
      html += rowLine('CE Liquidity', result.ceLiquidity);

      html += '<div class="fii-section-label" style="color:var(--red);">ATM PE</div>';
      html += rowLine('PE LTP', result.atmPe.lastPrice > 0 ? '\u20b9' + result.atmPe.lastPrice.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('PE Change', result.atmPe.change ? (result.atmPe.change >= 0 ? '+' : '') + result.atmPe.change.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('PE Interpretation', result.peInterp);
      html += rowLine('PE Liquidity', result.peLiquidity);

      html += '<div class="fii-section-label">Combined Straddle</div>';
      html += rowLine('Straddle', '\u20b9' + result.straddleValue.toFixed(2));
      html += rowLine('Previous Straddle', result.prevStraddle != null ? '\u20b9' + result.prevStraddle.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Straddle Change', result.straddleChangePct != null ? (result.straddleChangePct >= 0 ? '+' : '') + result.straddleChangePct.toFixed(2) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('3-min Change', result.straddle3m != null ? (result.straddle3m >= 0 ? '+' : '') + result.straddle3m.toFixed(1) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('15-min Change', result.straddle15m != null ? (result.straddle15m >= 0 ? '+' : '') + result.straddle15m.toFixed(1) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('Session High', result.sessionHigh != null ? '\u20b9' + result.sessionHigh.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Session Low', result.sessionLow != null ? '\u20b9' + result.sessionLow.toFixed(2) : 'DATA UNAVAILABLE');
      html += rowLine('Previous-Session High/Low', 'DATA UNAVAILABLE');
      html += rowLine('CE Share', result.share.ceShare != null ? result.share.ceShare.toFixed(0) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('PE Share', result.share.peShare != null ? result.share.peShare.toFixed(0) + '%' : 'DATA UNAVAILABLE');
      html += rowLine('Share Balance', result.share.classification);

      html += '<div class="fii-section-label">Cross-Check</div>';
      html += rowLine('Futures', result.futuresLabel);
      html += rowLine('Straddle + Premium + Futures', result.crossCheck);

      html += '</div></details>';

      html += partialDataFooter();
      html += '<div class="timestamp">Shadow mode \u2014 display and logging only, does not modify the Verdict/Alignment/Premium Pair logic and does not enable any order. Previous-session straddle High/Low is not tracked (would need a prior day\u2019s option candle history this app does not fetch). "3-min/15-min Change" uses this session\u2019s tracked straddle history, hidden until a real earlier snapshot exists.</div>';
      html += '</div>';
      return html;
    }

    function renderStep6ASummaryLine(symbol) {
      const m = data ? data[symbol] : null;
      const result = computeStep6AConclusion(symbol, m);
      if (result.blocked) return symbol + ' \u2014 STRADDLE DATA MISMATCH';
      return symbol + ' \u2014 ' + result.straddleState;
    }

    // ===== end STEP 6A =====

    // ===== STEP 6B: PCR + Call Wall / Put Wall Alignment (display+logging/shadow mode only) =====

    // C. PCR types — computed over three strike ranges. "Full-chain" here
    // means this app's full FETCHED range (ATM \u00b110 for NIFTY/SENSEX,
    // ATM \u00b16 for BankNifty), not the exchange\u2019s complete option chain,
    // which this app does not fetch.
    function filterStrikesInRange(strikes, atmStrike, offsetCount, strikeStep) {
      if (!strikes || atmStrike == null || !strikeStep) return [];
      return strikes.filter((s) => Math.abs(Math.round((s.strike - atmStrike) / strikeStep)) <= offsetCount);
    }

    function computeOiPcr(ceStrikes, peStrikes) {
      const ceTotal = ceStrikes.reduce((sum, s) => sum + (s.oi || 0), 0);
      const peTotal = peStrikes.reduce((sum, s) => sum + (s.oi || 0), 0);
      if (ceTotal <= 0) return null;
      return peTotal / ceTotal;
    }

    function computeVolumePcr(ceStrikes, peStrikes) {
      const validCe = ceStrikes.filter((s) => s.volume != null);
      const validPe = peStrikes.filter((s) => s.volume != null);
      if (validCe.length === 0 || validPe.length === 0) return null;
      const ceTotal = validCe.reduce((sum, s) => sum + s.volume, 0);
      const peTotal = validPe.reduce((sum, s) => sum + s.volume, 0);
      if (ceTotal <= 0) return null;
      return peTotal / ceTotal;
    }

    // Change-in-OI PCR needs a per-strike OI delta, tracked with its own
    // key namespace so it never collides with other modules' OI trackers.
    function computeChangeOiPcr(symbol, expiryLabel, ceStrikes, peStrikes) {
      let ceTotal = 0;
      let peTotal = 0;
      let anyValid = false;
      ceStrikes.forEach((s) => {
        const key = symbol + '_step6b_wallpcr_' + expiryLabel + '_CE_' + s.strike + '_oi';
        const info = oiArrowInfo(key, s.oi);
        if (info.delta != null && info.delta > 0) { ceTotal += info.delta; anyValid = true; }
      });
      peStrikes.forEach((s) => {
        const key = symbol + '_step6b_wallpcr_' + expiryLabel + '_PE_' + s.strike + '_oi';
        const info = oiArrowInfo(key, s.oi);
        if (info.delta != null && info.delta > 0) { peTotal += info.delta; anyValid = true; }
      });
      if (!anyValid || ceTotal <= 0) return null;
      return peTotal / ceTotal;
    }

    // D. PCR interpretation — reuses this app's existing PCR-bias
    // convention (>1.1 bullish-tilt, <0.85 bearish-tilt), PROVISIONAL.
    function classifyPcrState(pcr) {
      if (pcr == null) return 'PCR DATA INSUFFICIENT';
      if (pcr > 1.3) return 'PCR EXTREME \u2014 REVERSAL RISK';
      if (pcr > 1.1) return 'BULLISH-SUPPORTIVE';
      if (pcr < 0.7) return 'PCR EXTREME \u2014 REVERSAL RISK';
      if (pcr < 0.85) return 'BEARISH-SUPPORTIVE';
      return 'PCR NEUTRAL';
    }

    // E/F. Wall detection with persistence tracking across snapshots \u2014
    // a wall is not identified from Total OI alone in a single observation.
    const wallHistoryTracker = {};
    function updateWallHistory(key, strike, oi) {
      if (!wallHistoryTracker[key]) wallHistoryTracker[key] = [];
      const hist = wallHistoryTracker[key];
      const last = hist[hist.length - 1];
      if (last && last.strike === strike) {
        last.persistCount = (last.persistCount || 1) + 1;
        last.prevOi = last.oi;
        last.oi = oi;
        last.time = new Date();
      } else {
        hist.push({ strike: strike, oi: oi, prevOi: last ? last.oi : null, prevStrike: last ? last.strike : null, time: new Date(), persistCount: 1 });
        if (hist.length > 30) hist.shift();
      }
      return hist[hist.length - 1];
    }

    function findWallCandidate(strikes) {
      if (!strikes || strikes.length === 0) return null;
      let best = null;
      let bestOi = -1;
      strikes.forEach((s) => {
        if (s.oi != null && s.oi > bestOi) { bestOi = s.oi; best = s; }
      });
      return best;
    }

    function classifyWallState(wallRecord, marketOpen) {
      if (!wallRecord) return 'DATA INSUFFICIENT';
      if (!marketOpen) return 'DATA INSUFFICIENT';
      if (wallRecord.persistCount < 2) return 'DATA INSUFFICIENT'; // not yet confirmed across snapshots
      if (wallRecord.prevStrike != null && wallRecord.prevStrike !== wallRecord.strike) {
        return wallRecord.strike > wallRecord.prevStrike ? 'SHIFTING HIGHER' : 'SHIFTING LOWER';
      }
      if (wallRecord.prevOi != null) {
        const change = wallRecord.oi - wallRecord.prevOi;
        const changePct = wallRecord.prevOi > 0 ? (change / wallRecord.prevOi) * 100 : 0;
        if (changePct > 5) return 'BUILDING';
        if (changePct < -5) return 'WEAKENING';
      }
      return 'STABLE';
    }

    function computeStep6BConclusion(symbol, m) {
      const readiness = computeStep5Readiness(symbol, m);
      if (!readiness.ready) {
        return { blocked: true, reason: 'PCR / WALL DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };
      }
      const uniqueExpiries = getUniqueExpiriesWithTags(m);
      const current = uniqueExpiries[0];
      if (!current) return { blocked: true, reason: 'PCR / WALL DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };

      const atmCe = (current.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (current.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe && !atmPe) return { blocked: true, reason: 'PCR / WALL DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };
      if (!m.snapshotId) return { blocked: true, reason: 'PCR / WALL DATA MISMATCH \u2014 LIVE INTERPRETATION DISABLED' };

      const atmStrike = atmCe ? atmCe.strike : atmPe.strike;
      const strikeStep = inferStrikeStep(current.ceStrikes && current.ceStrikes.length ? current.ceStrikes : current.peStrikes);
      const marketOpen = isMarketOpenNow();

      const ce2 = filterStrikesInRange(current.ceStrikes, atmStrike, 2, strikeStep);
      const pe2 = filterStrikesInRange(current.peStrikes, atmStrike, 2, strikeStep);
      const ce5 = filterStrikesInRange(current.ceStrikes, atmStrike, 5, strikeStep);
      const pe5 = filterStrikesInRange(current.peStrikes, atmStrike, 5, strikeStep);
      const ceFull = current.ceStrikes || [];
      const peFull = current.peStrikes || [];

      const immediateOiPcr = computeOiPcr(ce2, pe2);
      const localOiPcr = computeOiPcr(ce5, pe5);
      const fullOiPcr = computeOiPcr(ceFull, peFull);
      const immediateVolPcr = computeVolumePcr(ce2, pe2);
      const localVolPcr = computeVolumePcr(ce5, pe5);
      const fullVolPcr = computeVolumePcr(ceFull, peFull);
      const immediateChgPcr = computeChangeOiPcr(symbol, current.expiry + '_imm', ce2, pe2);
      const localChgPcr = computeChangeOiPcr(symbol, current.expiry + '_loc', ce5, pe5);
      const fullChgPcr = computeChangeOiPcr(symbol, current.expiry + '_full', ceFull, peFull);

      const callWallCandidate = findWallCandidate(ceFull);
      const putWallCandidate = findWallCandidate(peFull);
      const callWallKey = symbol + '_step6b_callwall_' + current.expiry;
      const putWallKey = symbol + '_step6b_putwall_' + current.expiry;
      const callWallRecord = callWallCandidate ? updateWallHistory(callWallKey, callWallCandidate.strike, callWallCandidate.oi) : null;
      const putWallRecord = putWallCandidate ? updateWallHistory(putWallKey, putWallCandidate.strike, putWallCandidate.oi) : null;
      const callWallState = classifyWallState(callWallRecord, marketOpen);
      const putWallState = classifyWallState(putWallRecord, marketOpen);

      const callWallDistance = (callWallRecord && m.current) ? callWallRecord.strike - m.current : null;
      const putWallDistance = (putWallRecord && m.current) ? m.current - putWallRecord.strike : null;

      let atmContext = 'UNCONFIRMED';
      if (callWallRecord && putWallRecord && m.current) {
        if (m.current > putWallRecord.strike && m.current < callWallRecord.strike) atmContext = 'SPOT BETWEEN WALLS \u2014 RANGE';
        else if (m.current >= callWallRecord.strike) atmContext = 'SPOT NEAR CALL WALL';
        else if (m.current <= putWallRecord.strike) atmContext = 'SPOT NEAR PUT WALL';
      }

      const isExpiryDay = current.expiryDate && new Date(current.expiryDate).toDateString() === new Date().toDateString();

      // Cross-check with existing modules — reused, not recalculated.
      const spotBias = (m.vwap > 0) ? (m.current > m.vwap ? 'bullish' : (m.current < m.vwap ? 'bearish' : null)) : null;
      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      let futuresLabel = 'NO CLEAR SIGNAL';
      if (contract && contract.oi != null) {
        const fKey = symbol + '_step6b_futures';
        const priceDir = futuresDirection(fKey + '_price', contract.ltp);
        const oiDir = futuresDirection(fKey + '_oi', contract.oi);
        futuresLabel = classifyFuturesBuildup(priceDir, oiDir).label;
      }
      const futuresBullish = futuresLabel === 'LONG BUILD-UP' || futuresLabel === 'SHORT COVERING';
      const futuresBearish = futuresLabel === 'SHORT BUILD-UP' || futuresLabel === 'LONG UNWINDING';

      const premiumPairResult = computeStep5BConclusion(symbol, m);
      const ppFinal = premiumPairResult.blocked ? '' : premiumPairResult.finalStatus;
      const isAlignedLabel = (s) => s.indexOf('ALIGNMENT') !== -1 || s.indexOf('SUPPORTIVE') !== -1 || s.indexOf('PREFERRED') !== -1;
      const premiumPairCeAligned = ppFinal.indexOf('CE') !== -1 && isAlignedLabel(ppFinal);
      const premiumPairPeAligned = ppFinal.indexOf('PE') !== -1 && isAlignedLabel(ppFinal);

      const straddleResult = computeStep6AConclusion(symbol, m);
      const straddleState = straddleResult.blocked ? 'DATA INSUFFICIENT' : straddleResult.straddleState;

      // I/J. Bullish/Bearish alignment — scored multi-factor gate.
      let bullScore = 0, bearScore = 0;
      if (immediateOiPcr != null && immediateOiPcr > 1.1) bullScore++;
      if (immediateOiPcr != null && immediateOiPcr < 0.85) bearScore++;
      if (localOiPcr == null || (localOiPcr != null && localOiPcr >= 0.85)) bullScore += (localOiPcr != null && localOiPcr > 1.1) ? 1 : 0;
      if (putWallState === 'STABLE' || putWallState === 'SHIFTING HIGHER') bullScore++;
      if (callWallState === 'WEAKENING' || callWallState === 'SHIFTING HIGHER') bullScore++;
      if (callWallState === 'STABLE' || callWallState === 'SHIFTING LOWER') bearScore++;
      if (putWallState === 'WEAKENING' || putWallState === 'SHIFTING LOWER') bearScore++;
      if (spotBias === 'bullish') bullScore++;
      if (spotBias === 'bearish') bearScore++;
      if (premiumPairCeAligned) bullScore++;
      if (premiumPairPeAligned) bearScore++;
      if (futuresBullish) bullScore++;
      if (futuresBearish) bearScore++;

      let finalStatus;
      if (isExpiryDay) {
        finalStatus = 'EXPIRY-DAY OI DISTORTION \u2014 INTERPRETATION LIMITED';
      } else if (!marketOpen) {
        finalStatus = 'PARTIAL DATA';
      } else if (callWallState === 'DATA INSUFFICIENT' || putWallState === 'DATA INSUFFICIENT') {
        finalStatus = 'PARTIAL DATA';
      } else if (atmContext === 'SPOT BETWEEN WALLS \u2014 RANGE' && callWallState === 'BUILDING' && putWallState === 'BUILDING') {
        finalStatus = 'BOTH WALLS BUILDING \u2014 RANGE RISK';
      } else if (callWallState === 'WEAKENING' && putWallState === 'WEAKENING') {
        finalStatus = 'BOTH WALLS WEAKENING \u2014 VOLATILITY EXPANSION POSSIBLE';
      } else if (bullScore >= 6 && bullScore > bearScore) {
        finalStatus = 'PCR + WALLS BULLISH SUPPORTIVE';
      } else if (bearScore >= 6 && bearScore > bullScore) {
        finalStatus = 'PCR + WALLS BEARISH SUPPORTIVE';
      } else if (immediateOiPcr != null && fullOiPcr != null && ((immediateOiPcr > 1.1 && fullOiPcr < 0.85) || (immediateOiPcr < 0.85 && fullOiPcr > 1.1))) {
        finalStatus = 'IMMEDIATE PCR vs FULL-CHAIN PCR CONFLICT';
      } else if (atmContext === 'SPOT BETWEEN WALLS \u2014 RANGE') {
        finalStatus = 'SPOT TRAPPED BETWEEN WALLS';
      } else {
        finalStatus = 'UNCONFIRMED';
      }

      let crossCheck = 'UNCONFIRMED';
      const bullish5 = finalStatus === 'PCR + WALLS BULLISH SUPPORTIVE';
      const bearish5 = finalStatus === 'PCR + WALLS BEARISH SUPPORTIVE';
      if (bullish5) {
        if (premiumPairCeAligned) crossCheck = 'PCR + WALLS + PREMIUM BULLISH';
        else if (futuresBullish) crossCheck = 'PCR + WALLS + FUTURES BULLISH';
        else if (!premiumPairCeAligned && ppFinal) crossCheck = 'PCR\u2013ITM ALIGNMENT CONFLICT';
        else crossCheck = 'PARTIAL ALIGNMENT';
      } else if (bearish5) {
        if (premiumPairPeAligned) crossCheck = 'PCR + WALLS + PREMIUM BEARISH';
        else if (futuresBearish) crossCheck = 'PCR + WALLS + FUTURES BEARISH';
        else if (!premiumPairPeAligned && ppFinal) crossCheck = 'PCR\u2013ITM ALIGNMENT CONFLICT';
        else crossCheck = 'PARTIAL ALIGNMENT';
      }

      return {
        blocked: false, current: current, atmStrike: atmStrike,
        immediateOiPcr: immediateOiPcr, localOiPcr: localOiPcr, fullOiPcr: fullOiPcr,
        immediateVolPcr: immediateVolPcr, localVolPcr: localVolPcr, fullVolPcr: fullVolPcr,
        immediateChgPcr: immediateChgPcr, localChgPcr: localChgPcr, fullChgPcr: fullChgPcr,
        callWallRecord: callWallRecord, putWallRecord: putWallRecord, callWallState: callWallState, putWallState: putWallState,
        callWallDistance: callWallDistance, putWallDistance: putWallDistance, atmContext: atmContext,
        futuresLabel: futuresLabel, premiumPairFinal: ppFinal, straddleState: straddleState,
        finalStatus: finalStatus, crossCheck: crossCheck, isExpiryDay: isExpiryDay,
      };
    }

    function renderStep6BCard(symbol, m) {
      const result = computeStep6BConclusion(symbol, m);
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">PCR + Call Wall / Put Wall Alignment</div>';

      if (result.blocked) {
        html += '<div style="background:rgba(229,72,77,0.14); border:2px solid var(--red); border-radius:6px; padding:8px; color:var(--red); font-weight:700; font-size:0.8rem;">' + escapeHtml(result.reason) + '</div>';
        html += '</div>';
        return html;
      }

      resetRowLineTracking();
      if (result.isExpiryDay) {
        html += '<div style="background:rgba(201,162,39,0.14); border:2px solid var(--gold); border-radius:6px; padding:6px 8px; margin-bottom:8px; color:var(--gold); font-weight:700; font-size:0.75rem;">\u26a0 EXPIRY RISK HIGH</div>';
      }

      const statusColor = result.finalStatus.indexOf('BULLISH') !== -1 ? 'var(--green)' : result.finalStatus.indexOf('BEARISH') !== -1 ? 'var(--red)' : (result.finalStatus.indexOf('CONFLICT') !== -1 || result.finalStatus.indexOf('RISK') !== -1 || result.finalStatus.indexOf('TRAPPED') !== -1) ? 'var(--gold)' : 'var(--muted)';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase;">Final</div>';
      html += '<div style="color:' + statusColor + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(result.finalStatus) + '</div>';
      html += '<div style="color:var(--text); font-size:0.75rem; margin-top:2px;">' + escapeHtml(result.crossCheck) + '</div>';
      html += '</div>';

      html += '<details><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show full breakdown</summary>';
      html += '<div style="margin-top:8px;">';

      html += rowLine('Expiry', formatExpiryDate(result.current.expiryDate) || 'DATA UNAVAILABLE');
      html += rowLine('ATM', String(result.atmStrike));

      html += '<div class="fii-section-label">PCR (OI)</div>';
      html += rowLine('Immediate (ATM \u00b12)', result.immediateOiPcr != null ? result.immediateOiPcr.toFixed(3) + ' \u2014 ' + classifyPcrState(result.immediateOiPcr) : 'DATA UNAVAILABLE');
      html += rowLine('Local (ATM \u00b15)', result.localOiPcr != null ? result.localOiPcr.toFixed(3) + ' \u2014 ' + classifyPcrState(result.localOiPcr) : 'DATA UNAVAILABLE');
      html += rowLine('Full Range', result.fullOiPcr != null ? result.fullOiPcr.toFixed(3) + ' \u2014 ' + classifyPcrState(result.fullOiPcr) : 'DATA UNAVAILABLE');

      html += '<div class="fii-section-label">PCR (Change in OI)</div>';
      html += rowLine('Immediate', result.immediateChgPcr != null ? result.immediateChgPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Local', result.localChgPcr != null ? result.localChgPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Full Range', result.fullChgPcr != null ? result.fullChgPcr.toFixed(3) : 'DATA UNAVAILABLE');

      html += '<div class="fii-section-label">PCR (Volume)</div>';
      html += rowLine('Immediate', result.immediateVolPcr != null ? result.immediateVolPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Local', result.localVolPcr != null ? result.localVolPcr.toFixed(3) : 'DATA UNAVAILABLE');
      html += rowLine('Full Range', result.fullVolPcr != null ? result.fullVolPcr.toFixed(3) : 'DATA UNAVAILABLE');

      html += '<div class="fii-section-label">Call Wall</div>';
      html += rowLine('Strike', result.callWallRecord ? String(result.callWallRecord.strike) : 'DATA UNAVAILABLE');
      html += rowLine('Previous Strike', (result.callWallRecord && result.callWallRecord.prevStrike != null) ? String(result.callWallRecord.prevStrike) : 'DATA UNAVAILABLE');
      html += rowLine('OI', (result.callWallRecord && result.callWallRecord.oi != null) ? result.callWallRecord.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
      html += rowLine('Distance from Spot', result.callWallDistance != null ? (result.callWallDistance >= 0 ? '+' : '') + result.callWallDistance.toFixed(0) + ' pts' : 'DATA UNAVAILABLE');
      html += rowLine('State', result.callWallState);

      html += '<div class="fii-section-label">Put Wall</div>';
      html += rowLine('Strike', result.putWallRecord ? String(result.putWallRecord.strike) : 'DATA UNAVAILABLE');
      html += rowLine('Previous Strike', (result.putWallRecord && result.putWallRecord.prevStrike != null) ? String(result.putWallRecord.prevStrike) : 'DATA UNAVAILABLE');
      html += rowLine('OI', (result.putWallRecord && result.putWallRecord.oi != null) ? result.putWallRecord.oi.toLocaleString('en-IN') : 'DATA UNAVAILABLE');
      html += rowLine('Distance from Spot', result.putWallDistance != null ? (result.putWallDistance >= 0 ? '+' : '') + result.putWallDistance.toFixed(0) + ' pts' : 'DATA UNAVAILABLE');
      html += rowLine('State', result.putWallState);

      html += '<div class="fii-section-label">Context & Cross-Check</div>';
      html += rowLine('Spot State', result.atmContext);
      html += rowLine('Premium Pair', result.premiumPairFinal || 'DATA UNAVAILABLE');
      html += rowLine('Futures', result.futuresLabel);
      html += rowLine('Straddle', result.straddleState);
      html += rowLine('Snapshot', m.snapshotId ? 'SYNCED' : 'MISMATCH');

      html += '</div></details>';

      html += partialDataFooter();
      html += '<div class="timestamp">Shadow mode \u2014 display and logging only, does not modify the Verdict/Alignment/Premium Pair/Straddle logic and does not enable any order. "Full Range" PCR uses this app\u2019s fetched strike range (ATM \u00b110 for NIFTY/SENSEX, ATM \u00b16 for BankNifty), not the exchange\u2019s complete option chain. Wall detection and states use a PROVISIONAL scored heuristic requiring persistence across at least 2 synchronized snapshots \u2014 not backtested.</div>';
      html += '</div>';
      return html;
    }

    function renderStep6BSummaryLine(symbol) {
      const m = data ? data[symbol] : null;
      const result = computeStep6BConclusion(symbol, m);
      if (result.blocked) return symbol + ' \u2014 PCR/WALL DATA MISMATCH';
      return symbol + ' \u2014 ' + result.finalStatus;
    }

    // ===== end STEP 6B =====

    // ===== CENTRAL SIGNAL ORCHESTRATOR (display+logging only \u2014 never enables order review) =====

    function mkStatus(readiness, direction, usableFor, blocking, dataAge, quoteAge, lastTradeAge, snapshotId, reasonCodes) {
      return {
        readiness: readiness, direction: direction, usable_for: usableFor, blocking: blocking,
        data_age_seconds: dataAge, quote_age_seconds: quoteAge, last_trade_age_seconds: lastTradeAge,
        snapshot_id: snapshotId, reason_codes: reasonCodes,
      };
    }

    const QUOTE_STALE_LIMIT_SEC = 360; // PROVISIONAL — matches STALE_THRESHOLD_MS used elsewhere

    // ---- Hard-gate modules (6) ----

    function statusDataReliability(symbol, m) {
      if (!kiteConnected) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, null, null, null, null, ['BROKER_DISCONNECTED']);
      if (!m || m.error) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, null, null, null, null, ['NO_DATA']);
      const effTs = getEffectiveTimestamp(m);
      const dataAge = effTs ? Math.round((Date.now() - new Date(effTs).getTime()) / 1000) : null;
      const quoteAge = m.exchangeTimestamp ? Math.round((Date.now() - new Date(m.exchangeTimestamp).getTime()) / 1000) : null;
      if (dataAge == null) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, null, quoteAge, null, m.snapshotId || null, ['NO_TIMESTAMP']);
      if (!isMarketOpenNow()) return mkStatus('STALE', 'NONE', 'DISPLAY_ONLY', true, dataAge, quoteAge, null, m.snapshotId || null, ['MARKET_CLOSED']);
      if (dataAge > QUOTE_STALE_LIMIT_SEC) return mkStatus('STALE', 'NONE', 'DISPLAY_ONLY', true, dataAge, quoteAge, null, m.snapshotId || null, ['DATA_AGE_EXCEEDED']);
      if (!m.snapshotId) return mkStatus('MISMATCH', 'NONE', 'DISPLAY_ONLY', true, dataAge, quoteAge, null, null, ['NO_SNAPSHOT_ID']);
      return mkStatus('READY', 'NEUTRAL', 'REVIEW', false, dataAge, quoteAge, null, m.snapshotId, []);
    }

    function statusSpotStructure(symbol, m) {
      const base = statusDataReliability(symbol, m);
      if (base.readiness !== 'READY') return mkStatus(base.readiness, 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, base.snapshot_id, base.reason_codes);
      const struct5 = computeStructure(symbol, 5);
      if (struct5 === 'UNCONFIRMED') return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['STRUCTURE_WARMING_UP']);
      // Rule 1: no genuine Spot VWAP exists, so direction here comes only
      // from the structure pattern (HH-HL/LH-LL), never from comparing
      // Spot LTP against the futures-derived VWAP.
      const direction = struct5 === 'HH-HL' ? 'BULLISH' : (struct5 === 'LH-LL' ? 'BEARISH' : 'NEUTRAL');
      return mkStatus('READY', direction, 'REVIEW', false, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, []);
    }

    function statusFuturesConfirmation(symbol, m) {
      const base = statusDataReliability(symbol, m);
      if (base.readiness !== 'READY') return mkStatus(base.readiness, 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, base.snapshot_id, base.reason_codes);
      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      if (!contract || contract.oi == null) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['FUTURES_OI_UNAVAILABLE']);
      const fKey = symbol + '_orch_futures';
      const priceDir = futuresDirection(fKey + '_price', contract.ltp);
      const oiDir = futuresDirection(fKey + '_oi', contract.oi);
      if (priceDir == null || oiDir == null) return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['FUTURES_HISTORY_WARMING_UP']);
      const label = classifyFuturesBuildup(priceDir, oiDir).label;
      const direction = (label === 'LONG BUILD-UP' || label === 'SHORT COVERING') ? 'BULLISH' : (label === 'SHORT BUILD-UP' || label === 'LONG UNWINDING') ? 'BEARISH' : 'NEUTRAL';
      return mkStatus('READY', direction, 'REVIEW', false, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, []);
    }

    function statusPremiumPairConfirmation(symbol, m) {
      const base = statusDataReliability(symbol, m);
      if (base.readiness !== 'READY') return mkStatus(base.readiness, 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, base.snapshot_id, base.reason_codes);
      const result = computeStep5BConclusion(symbol, m);
      if (result.blocked) return mkStatus('MISMATCH', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['PREMIUM_PAIR_BLOCKED']);
      if (result.ceResp === 'UNCONFIRMED' && result.peResp === 'UNCONFIRMED') return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['PREMIUM_HISTORY_WARMING_UP']);
      const direction = result.finalStatus.indexOf('CE') !== -1 ? 'BULLISH' : result.finalStatus.indexOf('PE') !== -1 ? 'BEARISH' : (result.finalStatus.indexOf('CONFLICT') !== -1 ? 'CONFLICT' : 'NEUTRAL');
      return mkStatus('READY', direction, 'REVIEW', false, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, []);
    }

    function statusThreeIndexAlignment() {
      if (!data) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, null, null, null, null, ['NO_DATA']);
      const niftyBias = classifyIndexOverallBias(data.NIFTY);
      const bankBias = classifyIndexOverallBias(data.BANKNIFTY);
      const sensexBias = classifyIndexOverallBias(data.SENSEX);
      const buckets = { NIFTY: biasToBucket(niftyBias), BANKNIFTY: biasToBucket(bankBias), SENSEX: biasToBucket(sensexBias) };
      const status = computeAlignmentStatus(buckets);
      if (status === 'DATA INCOMPLETE') return mkStatus('PARTIAL', 'NONE', 'DISPLAY_ONLY', true, null, null, null, null, ['THREE_INDEX_INCOMPLETE']);
      const direction = status.indexOf('BULLISH') !== -1 ? 'BULLISH' : status.indexOf('BEARISH') !== -1 ? 'BEARISH' : (status.indexOf('CONFLICT') !== -1 ? 'CONFLICT' : 'NEUTRAL');
      return mkStatus('READY', direction, 'REVIEW', false, null, null, null, null, []);
    }

    function statusLiquiditySafety(symbol, m) {
      const base = statusDataReliability(symbol, m);
      if (base.readiness !== 'READY') return mkStatus(base.readiness, 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, base.snapshot_id, base.reason_codes);
      const exp = (m.expiries || []).find((e) => e.expiry === 'Current Expiry') || (m.expiries || [])[0];
      if (!exp) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['NO_EXPIRY']);
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe && !atmPe) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, null, m.snapshotId, ['NO_ATM_LEG']);
      const ceLiq = atmCe ? classifyLiquidity(atmCe) : 'ILLIQUID';
      const peLiq = atmPe ? classifyLiquidity(atmPe) : 'ILLIQUID';
      const lastTradeAgeCe = (atmCe && atmCe.quoteTimestamp) ? Math.round((Date.now() - new Date(atmCe.quoteTimestamp).getTime()) / 1000) : null;
      if (ceLiq === 'STALE' || peLiq === 'STALE') return mkStatus('STALE', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, lastTradeAgeCe, m.snapshotId, ['QUOTE_STALE']);
      if (ceLiq === 'ILLIQUID' && peLiq === 'ILLIQUID') return mkStatus('PARTIAL', 'NONE', 'DISPLAY_ONLY', true, base.data_age_seconds, base.quote_age_seconds, lastTradeAgeCe, m.snapshotId, ['BOTH_LEGS_ILLIQUID']);
      return mkStatus('READY', 'NEUTRAL', 'REVIEW', false, base.data_age_seconds, base.quote_age_seconds, lastTradeAgeCe, m.snapshotId, []);
    }

    // ---- Supporting modules (6) ----

    function statusCrossExpiryItm(symbol, m) {
      const result = computeStep5BConclusion(symbol, m);
      if (result.blocked) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['CROSS_EXPIRY_BLOCKED']);
      const direction = result.finalStatus.indexOf('CE') !== -1 && result.finalStatus.indexOf('ALIGNMENT') !== -1 ? 'BULLISH' :
        result.finalStatus.indexOf('PE') !== -1 && result.finalStatus.indexOf('ALIGNMENT') !== -1 ? 'BEARISH' :
        result.finalStatus.indexOf('CONFLICT') !== -1 ? 'CONFLICT' : 'NEUTRAL';
      return mkStatus('READY', direction, 'EARLY_CLUE', false, null, null, null, m.snapshotId, []);
    }

    function statusAtmStraddle(symbol, m) {
      const result = computeStep6AConclusion(symbol, m);
      if (result.blocked) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['STRADDLE_BLOCKED']);
      if (result.straddleState === 'DATA INSUFFICIENT') return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', false, null, null, null, m.snapshotId, ['STRADDLE_WARMING_UP']);
      const direction = result.straddleState.indexOf('CE') !== -1 ? 'BULLISH' : result.straddleState.indexOf('PE') !== -1 ? 'BEARISH' : 'NEUTRAL';
      return mkStatus('READY', direction, 'EARLY_CLUE', false, null, null, null, m.snapshotId, []);
    }

    function statusPcr(symbol, m) {
      const result = computeStep6BConclusion(symbol, m);
      if (result.blocked) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['PCR_BLOCKED']);
      if (result.immediateOiPcr == null) return mkStatus('PARTIAL', 'NONE', 'DISPLAY_ONLY', false, null, null, null, m.snapshotId, ['IMMEDIATE_PCR_UNAVAILABLE']);
      const state = classifyPcrState(result.immediateOiPcr);
      const direction = state === 'BULLISH-SUPPORTIVE' ? 'BULLISH' : state === 'BEARISH-SUPPORTIVE' ? 'BEARISH' : 'NEUTRAL';
      return mkStatus('READY', direction, 'EARLY_CLUE', false, null, null, null, m.snapshotId, []);
    }

    function statusWalls(symbol, m) {
      const result = computeStep6BConclusion(symbol, m);
      if (result.blocked) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['WALLS_BLOCKED']);
      if (result.callWallState === 'DATA INSUFFICIENT' || result.putWallState === 'DATA INSUFFICIENT') {
        return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', false, null, null, null, m.snapshotId, ['WALL_PERSISTENCE_WARMING_UP']);
      }
      const direction = result.finalStatus.indexOf('BULLISH') !== -1 ? 'BULLISH' : result.finalStatus.indexOf('BEARISH') !== -1 ? 'BEARISH' : 'NEUTRAL';
      return mkStatus('READY', direction, 'EARLY_CLUE', false, null, null, null, m.snapshotId, []);
    }

    // Not built in this dashboard yet — always honestly UNAVAILABLE, never
    // fabricated, and always excluded from the valid denominator.
    function statusReversalObservation() {
      return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['MODULE_NOT_BUILT']);
    }

    function statusPreviousSessionContext(symbol, m) {
      if (isMarketOpenNow()) return mkStatus('READY', 'NEUTRAL', 'DISPLAY_ONLY', false, null, null, null, (m && m.snapshotId) || null, ['LIVE_SESSION_NOT_PREVIOUS']);
      if (!m || m.error) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['NO_DATA']);
      return mkStatus('READY', 'NEUTRAL', 'DISPLAY_ONLY', false, null, null, null, m.snapshotId || null, []);
    }

    // FII/DII is shared across all three indices (not per-symbol data), so
    // its status reads from the same fiiDiiData used by the FII/DII tab.
    function statusFiiDiiBias() {
      if (!fiiDiiData || fiiDiiData.error) return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['FII_DII_NOT_LOADED']);
      const entries = fiiDiiData.entries || [];
      const result = computeFiveDayFiiDiiBias(entries);
      if (!result.ready) return mkStatus('WARMING_UP', 'NONE', 'DISPLAY_ONLY', false, null, null, null, null, ['NEED_3_PLUS_DAYS']);
      const direction = result.verdict === '5-DAY BULLISH BIAS' ? 'BULLISH' : result.verdict === '5-DAY BEARISH BIAS' ? 'BEARISH' : (result.verdict === 'CASH-DERIVATIVE CONFLICT' ? 'CONFLICT' : 'NEUTRAL');
      return mkStatus('READY', direction, 'EARLY_CLUE', false, null, null, null, null, []);
    }

    // ---- Aggregation ----

    const HARD_GATE_MODULES = ['Data Reliability', 'Spot Structure', 'Futures Confirmation', 'Premium Pair Confirmation', 'Three-Index Alignment', 'Liquidity / Execution Safety'];
    const SUPPORTING_MODULES = ['Cross-Expiry ITM', 'ATM Straddle', 'PCR', 'Call Wall / Put Wall', 'Reversal Observation', 'Previous-Session Context', 'FII/DII 5-Day Bias'];

    function getModuleStatus(moduleName, symbol, m) {
      switch (moduleName) {
        case 'Data Reliability': return statusDataReliability(symbol, m);
        case 'Spot Structure': return statusSpotStructure(symbol, m);
        case 'Futures Confirmation': return statusFuturesConfirmation(symbol, m);
        case 'Premium Pair Confirmation': return statusPremiumPairConfirmation(symbol, m);
        case 'Three-Index Alignment': return statusThreeIndexAlignment();
        case 'Liquidity / Execution Safety': return statusLiquiditySafety(symbol, m);
        case 'Cross-Expiry ITM': return statusCrossExpiryItm(symbol, m);
        case 'ATM Straddle': return statusAtmStraddle(symbol, m);
        case 'PCR': return statusPcr(symbol, m);
        case 'Call Wall / Put Wall': return statusWalls(symbol, m);
        case 'Reversal Observation': return statusReversalObservation();
        case 'Previous-Session Context': return statusPreviousSessionContext(symbol, m);
        case 'FII/DII 5-Day Bias': return statusFiiDiiBias();
        default: return mkStatus('UNAVAILABLE', 'NONE', 'DISPLAY_ONLY', true, null, null, null, null, ['UNKNOWN_MODULE']);
      }
    }

    function computeSignalOrchestration(symbol, m) {
      const hardStatuses = HARD_GATE_MODULES.map((name) => ({ name: name, status: getModuleStatus(name, symbol, m) }));
      const supportStatuses = SUPPORTING_MODULES.map((name) => ({ name: name, status: getModuleStatus(name, symbol, m) }));

      const hardReadyCount = hardStatuses.filter((x) => x.status.readiness === 'READY').length;
      const hardBlocking = hardStatuses.filter((x) => x.status.readiness !== 'READY');
      const allHardReady = hardBlocking.length === 0;

      const supportReady = supportStatuses.filter((x) => x.status.readiness === 'READY');
      const supportExcluded = supportStatuses.filter((x) => x.status.readiness !== 'READY');

      // Never count an excluded supporting module as neutral — it is
      // removed from the valid denominator entirely.
      const supportDirectional = supportReady.filter((x) => x.status.direction === 'BULLISH' || x.status.direction === 'BEARISH');
      const bullishSupport = supportDirectional.filter((x) => x.status.direction === 'BULLISH').length;
      const bearishSupport = supportDirectional.filter((x) => x.status.direction === 'BEARISH').length;

      // EARLY CLUE: >=3 valid independent clues, one premium/price clue,
      // one spot/futures clue, hard-gate Data Reliability must not fail.
      const dataReliabilityOk = hardStatuses[0].status.readiness === 'READY';
      const hasPremiumClue = supportReady.some((x) => x.name === 'Cross-Expiry ITM' || x.name === 'ATM Straddle') || hardStatuses[3].status.readiness === 'READY';
      const hasSpotFuturesClue = hardStatuses[1].status.readiness === 'READY' || hardStatuses[2].status.readiness === 'READY';
      const validClueCount = supportReady.length + hardStatuses.filter((x) => x.status.readiness === 'READY').length;

      let stage = 'NONE';
      let blockingReason = null;

      if (allHardReady) {
        // Full hard-gate pass is the prerequisite for REVIEW ELIGIBLE, plus
        // synchronization + liquidity + break/hold/retest confirmation.
        const snapshotSynced = !!m.snapshotId;
        const premiumResult = computeStep5BConclusion(symbol, m);
        const breakHoldRetestConfirmed = !premiumResult.blocked &&
          premiumResult.perExpiryCe && premiumResult.perExpiryCe[0] &&
          (premiumResult.perExpiryCe[0].state.indexOf('STRONG') !== -1 || premiumResult.perExpiryCe[0].state.indexOf('SUPPORTIVE') !== -1 ||
           (premiumResult.perExpiryPe[0] && (premiumResult.perExpiryPe[0].state.indexOf('STRONG') !== -1 || premiumResult.perExpiryPe[0].state.indexOf('SUPPORTIVE') !== -1)));
        if (snapshotSynced && breakHoldRetestConfirmed) {
          stage = 'REVIEW ELIGIBLE';
        } else if (dataReliabilityOk && hasPremiumClue && hasSpotFuturesClue && validClueCount >= 4) {
          stage = 'WATCH';
        } else if (dataReliabilityOk && hasPremiumClue && hasSpotFuturesClue && validClueCount >= 3) {
          stage = 'EARLY CLUE';
        }
      } else if (dataReliabilityOk && hasPremiumClue && hasSpotFuturesClue && validClueCount >= 4) {
        stage = 'WATCH';
      } else if (dataReliabilityOk && hasPremiumClue && hasSpotFuturesClue && validClueCount >= 3) {
        stage = 'EARLY CLUE';
      }

      if (!allHardReady) {
        blockingReason = hardBlocking.map((x) => x.name.toUpperCase().replace(/[^A-Z]/g, '_') + '_' + x.status.readiness).join(', ');
      }

      // Graceful degradation mode
      let mode;
      if (hardReadyCount === 6 && stage === 'REVIEW ELIGIBLE') mode = 'FULL MODE';
      else if (hardReadyCount >= 4) mode = 'REDUCED CONFIRMATION MODE';
      else if (hardReadyCount >= 2) mode = 'WATCH-ONLY MODE';
      else if (hardReadyCount >= 1) mode = 'DISPLAY-ONLY MODE';
      else mode = 'SIGNAL LOCKED';

      return {
        hardStatuses: hardStatuses, supportStatuses: supportStatuses,
        hardReadyCount: hardReadyCount, supportReadyCount: supportReady.length,
        supportExcluded: supportExcluded, bullishSupport: bullishSupport, bearishSupport: bearishSupport,
        stage: stage, mode: mode, blockingReason: blockingReason,
      };
    }

    // Descriptive ATM±2 strike data — deliberately never uses BUY/SELL or
    // any directive wording. Shows LTP, interpretation, and liquidity per
    // strike only, so the person makes their own decision.
    function renderAtmPm2StrikeData(symbol, m) {
      if (!m || m.error || !m.expiries || m.expiries.length === 0) return '<div class="unavailable-text">DATA UNAVAILABLE</div>';
      const exp = m.expiries.find((e) => e.expiry === 'Current Expiry') || m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      const atmStrike = atmCe ? atmCe.strike : (atmPe ? atmPe.strike : null);
      if (atmStrike == null) return '<div class="unavailable-text">DATA UNAVAILABLE</div>';
      const strikeStep = inferStrikeStep(exp.ceStrikes && exp.ceStrikes.length ? exp.ceStrikes : exp.peStrikes);
      const range2Ce = filterStrikesInRange(exp.ceStrikes, atmStrike, 2, strikeStep).sort((a, b) => a.strike - b.strike);
      const range2Pe = filterStrikesInRange(exp.peStrikes, atmStrike, 2, strikeStep).sort((a, b) => a.strike - b.strike);

      function renderLegRow(label, s) {
        const key = symbol + '_orch_atmpm2_' + label + '_' + s.strike;
        const priceDir = priceDirection(key + '_price', s.lastPrice);
        const oiInfo = oiArrowInfo(key + '_oi', s.oi);
        const interp = classifyInterpretation(priceDir, oiInfo.cls);
        const liq = classifyLiquidity(s);
        const tag = s.strike === atmStrike ? ' (ATM)' : '';
        const priceText = s.lastPrice > 0 ? '\u20b9' + s.lastPrice.toFixed(2) : 'DATA UNAVAILABLE';
        return '<div class="card-item"><span class="card-label">' + label + ' ' + s.strike + tag + '</span><span class="card-value">' + escapeHtml(priceText + ' \u00b7 ' + interp + ' \u00b7 ' + liq) + '</span></div>';
      }

      let html = '<div class="fii-section-label">CE (ATM \u00b12, Current Week)</div>';
      range2Ce.forEach((s) => { html += renderLegRow('CE', s); });
      html += '<div class="fii-section-label">PE (ATM \u00b12, Current Week)</div>';
      range2Pe.forEach((s) => { html += renderLegRow('PE', s); });
      html += '<div class="timestamp">Descriptive data only \u2014 not a trade instruction. LTP, price+OI interpretation, and liquidity status for each strike, for you to review yourself.</div>';
      return html;
    }

    // Rule 10: Central Signal Lock — reuses connectionState (rule 2) as
    // the first gate, then the existing Orchestrator hard-gate machinery.
    // Note: full NIFTY+BANKNIFTY mandatory-alignment gating (a separate
    // rule) is not built yet — the closest existing proxy used here is
    // the Orchestrator's Three-Index Alignment hard gate, which checks
    // all three indices together, not NIFTY+BANKNIFTY specifically. This
    // is disclosed rather than silently assumed equivalent.
    function computeSignalLockState(symbol, m) {
      if (connectionState === 'DISCONNECTED') {
        return { state: 'SIGNAL LOCKED \u2014 DATA ISSUE', reason: 'CONNECTION_DISCONNECTED' };
      }
      if (connectionState === 'DELAYED') {
        return { state: 'WAIT \u2014 CONFIRMATION INCOMPLETE', reason: 'CONNECTION_DELAYED' };
      }
      const orch = computeSignalOrchestration(symbol, m);
      if (orch.hardReadyCount < 6) {
        return { state: 'WAIT \u2014 CONFIRMATION INCOMPLETE', reason: orch.blockingReason || 'HARD_GATES_INCOMPLETE' };
      }
      if (orch.stage === 'REVIEW ELIGIBLE') {
        return { state: 'TRADE READY', reason: null };
      }
      return { state: 'WAIT \u2014 CONFIRMATION INCOMPLETE', reason: 'STAGE_NOT_REVIEW_ELIGIBLE' };
    }

    function renderSignalLockCard(symbol, m) {
      const lock = computeSignalLockState(symbol, m);
      const color = lock.state === 'TRADE READY' ? 'var(--green)' : lock.state.indexOf('SIGNAL LOCKED') === 0 ? 'var(--red)' : 'var(--gold)';
      let html = '<div class="premium-card" style="margin-bottom:10px; border-color:' + color + ';">';
      html += '<div class="card-title">Trade Readiness \u2014 ' + escapeHtml(symbol) + '</div>';
      html += '<div style="color:' + color + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(lock.state) + '</div>';
      if (lock.reason) html += '<div style="color:var(--muted); font-size:0.7rem; margin-top:2px;">' + escapeHtml(lock.reason) + '</div>';
      html += '<div class="timestamp">Uses the shared connection state plus the existing Central Signal Orchestrator\u2019s 6 hard gates. NIFTY+BANKNIFTY-specific mandatory alignment is a separate rule not yet built \u2014 Three-Index Alignment (all 3 indices) is used here as the closest existing check.</div>';
      html += '</div>';
      return html;
    }

    function renderOrchestratorCard(symbol, m) {
      const orch = computeSignalOrchestration(symbol, m);
      let html = '<div class="premium-card" style="margin-bottom:12px; border-color:var(--gold);">';
      html += '<div class="card-title">Central Signal Orchestrator</div>';

      const stageColor = orch.stage === 'REVIEW ELIGIBLE' ? 'var(--green)' : orch.stage === 'WATCH' ? 'var(--gold)' : orch.stage === 'EARLY CLUE' ? 'var(--muted)' : 'var(--red)';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase;">Signal Stage</div>';
      html += '<div style="color:' + stageColor + '; font-weight:700; font-size:0.95rem;">' + escapeHtml(orch.stage) + '</div>';
      html += '<div style="color:var(--text); font-size:0.75rem; margin-top:2px;">Mode: ' + escapeHtml(orch.mode) + '</div>';
      html += '</div>';

      html += '<div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--muted);">';
      html += 'Core Coverage: ' + orch.hardReadyCount + '/6<br>';
      html += 'Support Coverage: ' + orch.supportReadyCount + '/7';
      html += '</div>';

      if (orch.blockingReason) {
        html += '<div style="background:rgba(229,72,77,0.14); border:2px solid var(--red); border-radius:6px; padding:6px 8px; margin-top:8px; color:var(--red); font-weight:700; font-size:0.72rem;">Blocking: ' + escapeHtml(orch.blockingReason) + '</div>';
      }

      if (orch.stage === 'REVIEW ELIGIBLE' || orch.stage === 'WATCH') {
        html += '<details style="margin-top:8px;"><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show ATM \u00b12 strike data</summary>';
        html += '<div style="margin-top:8px;">' + renderAtmPm2StrikeData(symbol, m) + '</div></details>';
      }

      html += '<details style="margin-top:8px;"><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700;">Show module breakdown</summary>';
      html += '<div style="margin-top:8px;">';
      html += '<div class="fii-section-label">Hard-Gate Modules</div>';
      orch.hardStatuses.forEach((x) => {
        const c = x.status.readiness === 'READY' ? 'var(--green)' : 'var(--red)';
        html += '<div class="card-item"><span class="card-label">' + escapeHtml(x.name) + '</span><span class="card-value" style="color:' + c + ';">' + x.status.readiness + (x.status.direction !== 'NONE' && x.status.direction !== 'NEUTRAL' ? ' \u2014 ' + x.status.direction : '') + '</span></div>';
      });
      html += '<div class="fii-section-label">Supporting Modules</div>';
      orch.supportStatuses.forEach((x) => {
        const excluded = x.status.readiness !== 'READY';
        const c = excluded ? 'var(--muted-dim)' : (x.status.direction === 'BULLISH' ? 'var(--green)' : x.status.direction === 'BEARISH' ? 'var(--red)' : 'var(--muted)');
        html += '<div class="card-item"><span class="card-label">' + escapeHtml(x.name) + '</span><span class="card-value" style="color:' + c + ';">' + (excluded ? 'EXCLUDED (' + x.status.readiness + ')' : x.status.direction) + '</span></div>';
      });
      html += '</div></details>';

      html += '<div class="timestamp">Display and logging only \u2014 does not enable order review. REVIEW ELIGIBLE requires all 6 hard-gate modules READY, a synchronized snapshot, and break/hold/retest confirmation; even then, order review requires separate backend revalidation which this dashboard does not implement. Excluded supporting modules are removed from the valid denominator, never counted as neutral evidence.</div>';
      html += '</div>';
      return html;
    }

    // ===== end CENTRAL SIGNAL ORCHESTRATOR =====

    // ===== REFACTOR B: SIMPLIFIED FINAL VERDICT ENGINE (rules 3,4,5,6,7,8,9,14) =====
    //
    // All trackers here update ONCE PER REAL FETCH (gated on the 'data'
    // object reference, same pattern used to fix the Step 4B "+0 qty"
    // bug) \u2014 never on a plain re-render like a tab switch, so consecutive-
    // snapshot counts are never inflated by browser interaction alone.

    let simpleVerdictLastData = null;
    const simpleFuturesHistory = {}; // symbol -> [{priceDir, oiDir, time}]
    const simplePdhPdlTracker = {}; // symbol -> {aboveCount, belowCount, wasAbovePdh, wasBelowPdl}
    const simplePremiumTracker = {}; // symbol -> {contractKey, ceDir[], peDir[], snapshotsSinceReset}
    const simplePcrTracker = {}; // symbol -> [{oiPcr, volPcr, time}]

    function advanceSimpleVerdictTrackers() {
      if (simpleVerdictLastData === data) return; // already processed this fetch
      simpleVerdictLastData = data;
      if (!data) return;

      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((symbol) => {
        const m = data[symbol];
        if (!m || m.error) return;

        // Futures price+OI history (rule 7 needs 3 consecutive snapshots)
        const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
        if (contract && contract.oi != null) {
          const key = symbol + '_simplefut';
          const priceDir = futuresDirection(key + '_price', contract.ltp);
          const oiDir = futuresDirection(key + '_oi', contract.oi);
          const hist = simpleFuturesHistory[symbol] || [];
          hist.push({ priceDir: priceDir, oiDir: oiDir, ltp: contract.ltp, vwap: m.vwap, time: new Date() });
          if (hist.length > 10) hist.shift();
          simpleFuturesHistory[symbol] = hist;
        }

        // PDH/PDL consecutive-snapshot tracker (rule 8 needs 2 consecutive)
        const t = simplePdhPdlTracker[symbol] || { aboveCount: 0, belowCount: 0 };
        const nowAbovePdh = m.pdh > 0 && m.current > m.pdh;
        const nowBelowPdl = m.pdl > 0 && m.current < m.pdl;
        t.aboveCount = nowAbovePdh ? t.aboveCount + 1 : 0;
        t.belowCount = nowBelowPdl ? t.belowCount + 1 : 0;
        t.wasAbovePdh = nowAbovePdh;
        t.wasBelowPdl = nowBelowPdl;
        simplePdhPdlTracker[symbol] = t;

        // Premium alignment — same strike+expiry contract only (rule 5).
        // ATM shift resets the trend and requires 2 fresh snapshots.
        const exp = (m.expiries || []).find((e) => e.expiry === 'Current Expiry') || (m.expiries || [])[0];
        const atmCe = exp ? (exp.ceStrikes || []).find((s) => s.isAtm) : null;
        const atmPe = exp ? (exp.peStrikes || []).find((s) => s.isAtm) : null;
        const contractKey = atmCe ? (exp.expiry + '_' + atmCe.strike) : null;
        let pt = simplePremiumTracker[symbol];
        if (!pt || pt.contractKey !== contractKey) {
          pt = { contractKey: contractKey, snapshotsSinceReset: 0 };
          simplePremiumTracker[symbol] = pt;
        }
        pt.snapshotsSinceReset++;
        if (atmCe) {
          const k = symbol + '_simpleprem_CE_' + contractKey;
          pt.cePriceDir = priceDirection(k + '_price', atmCe.lastPrice);
          pt.ceLtp = atmCe.lastPrice; pt.cePdh = atmCe.pdh; pt.cePdl = atmCe.pdl;
        }
        if (atmPe) {
          const k = symbol + '_simpleprem_PE_' + contractKey;
          pt.pePriceDir = priceDirection(k + '_price', atmPe.lastPrice);
          pt.peLtp = atmPe.lastPrice; pt.pePdh = atmPe.pdh; pt.pePdl = atmPe.pdl;
        }

        // PCR trend (rule 6 needs 3 consecutive snapshots) — reuses Step
        // 6B's Immediate OI/Volume PCR computation, not recalculated.
        const step6b = computeStep6BConclusion(symbol, m);
        if (!step6b.blocked) {
          const hist = simplePcrTracker[symbol] || [];
          hist.push({ oiPcr: step6b.immediateOiPcr, volPcr: step6b.immediateVolPcr, time: new Date() });
          if (hist.length > 10) hist.shift();
          simplePcrTracker[symbol] = hist;
        }
      });
    }

    // Rule 7: simplified 6-state futures classification with index-
    // specific % thresholds and a 3-consecutive-snapshot requirement.
    function classifySimpleFutures(symbol) {
      const hist = simpleFuturesHistory[symbol] || [];
      if (hist.length < 3) return 'DATA UNAVAILABLE';
      const recent = hist.slice(-3);
      if (recent.some((h) => h.priceDir == null || h.oiDir == null)) return 'DATA UNAVAILABLE';
      const allSamePrice = recent.every((h) => h.priceDir === recent[0].priceDir);
      const allSameOi = recent.every((h) => h.oiDir === recent[0].oiDir);
      if (!allSamePrice || !allSameOi) return 'RANGE / NO CLEAR BUILD-UP';
      const priceDir = recent[0].priceDir;
      const oiDir = recent[0].oiDir;
      const last = recent[recent.length - 1];
      const aboveVwap = last.vwap > 0 ? last.ltp > last.vwap : null;
      if (priceDir === 'flat' || oiDir === 'flat') return 'RANGE / NO CLEAR BUILD-UP';
      if (priceDir === 'up' && oiDir === 'up') return aboveVwap === false ? 'RANGE / NO CLEAR BUILD-UP' : 'FRESH LONG BUILD-UP';
      if (priceDir === 'down' && oiDir === 'up') return aboveVwap === true ? 'RANGE / NO CLEAR BUILD-UP' : 'FRESH SHORT BUILD-UP';
      if (priceDir === 'up' && oiDir === 'down') return 'SHORT COVERING';
      if (priceDir === 'down' && oiDir === 'down') return 'LONG UNWINDING';
      return 'RANGE / NO CLEAR BUILD-UP';
    }

    // Rule 8: simplified 7-state PDH/PDL with 2-consecutive-snapshot
    // breakout/breakdown confirmation, 0.10% proximity threshold —
    // PROVISIONAL, not backtested.
    function classifySimplePdhPdl(symbol, m) {
      if (!m || m.error || !(m.pdh > 0) || !(m.pdl > 0) || !(m.current > 0)) return 'DATA UNAVAILABLE';
      const t = simplePdhPdlTracker[symbol] || { aboveCount: 0, belowCount: 0 };
      const futClass = classifySimpleFutures(symbol);
      const bullishFutures = futClass === 'FRESH LONG BUILD-UP';
      const bearishFutures = futClass === 'FRESH SHORT BUILD-UP';
      const contract = (m.futuresContracts && m.futuresContracts[0]) || null;
      const aboveFutVwap = (contract && m.vwap > 0) ? contract.ltp > m.vwap : null;

      if (t.aboveCount >= 2 && bullishFutures && aboveFutVwap === true) return 'PDH BREAKOUT';
      if (t.belowCount >= 2 && bearishFutures && aboveFutVwap === false) return 'PDL BREAKDOWN';

      const nearPdh = Math.abs(m.current - m.pdh) / m.pdh < 0.001;
      const nearPdl = Math.abs(m.current - m.pdl) / m.pdl < 0.001;
      if (t.aboveCount === 0 && t.wasAbovePdh === false && nearPdh) return 'NEAR PDH';
      if (t.belowCount === 0 && t.wasBelowPdl === false && nearPdl) return 'NEAR PDL';
      // Rejection: was tested (aboveCount/belowCount was previously >0,
      // now back at 0 and not reclaiming for 2 checks) — approximated
      // using the current 0-count alongside recent proximity.
      if (t.aboveCount === 0 && nearPdh) return 'PDH REJECTION';
      if (t.belowCount === 0 && nearPdl) return 'PDL REJECTION';
      if (t.aboveCount > 0 || t.belowCount > 0) return t.aboveCount > 0 ? 'NEAR PDH' : 'NEAR PDL';
      return 'INSIDE RANGE';
    }

    // Rule 5: simplified 5-state premium alignment, same contract only,
    // with expiry weighting (Monthly highest, Current lowest — used only
    // as a confirmation weight in the final verdict, not shown here).
    function classifySimplePremium(symbol) {
      const pt = simplePremiumTracker[symbol];
      if (!pt || pt.snapshotsSinceReset < 2) return 'DATA UNAVAILABLE';
      if (pt.cePriceDir == null || pt.pePriceDir == null) return 'DATA UNAVAILABLE';
      const ceStrengthening = pt.cePriceDir === 'up';
      const peWeakening = pt.pePriceDir === 'down';
      const peStrengthening = pt.pePriceDir === 'up';
      const ceWeakening = pt.cePriceDir === 'down';
      const ceTowardPdh = pt.cePdh > 0 && pt.ceLtp != null ? pt.ceLtp >= pt.cePdh * 0.98 : false;
      const peTowardPdh = pt.pePdh > 0 && pt.peLtp != null ? pt.peLtp >= pt.pePdh * 0.98 : false;
      const peNotReclaiming = !peTowardPdh;
      const ceNotReclaiming = !ceTowardPdh;

      const ceConfirmed = ceStrengthening && ceTowardPdh && peWeakening && peNotReclaiming;
      const peConfirmed = peStrengthening && peTowardPdh && ceWeakening && ceNotReclaiming;

      if (ceConfirmed && peConfirmed) return 'MIXED';
      if (ceConfirmed) return 'CE CONFIRMED';
      if (peConfirmed) return 'PE CONFIRMED';
      if (ceStrengthening && peStrengthening) return 'MIXED';
      return 'NO CONFIRMATION';
    }

    // Rule 6: simplified 5-state PCR, OI PCR primary + Volume PCR
    // supporting, trend over 3 consecutive snapshots.
    function classifySimplePcr(symbol) {
      const hist = simplePcrTracker[symbol] || [];
      if (hist.length < 3) return 'PCR DATA UNAVAILABLE';
      const recent = hist.slice(-3);
      if (recent.some((h) => h.oiPcr == null)) return 'PCR DATA UNAVAILABLE';
      const oiTrendUp = recent[2].oiPcr > recent[0].oiPcr;
      const oiTrendDown = recent[2].oiPcr < recent[0].oiPcr;
      const oiState = recent[2].oiPcr > 1.1 ? 'bullish' : recent[2].oiPcr < 0.85 ? 'bearish' : 'neutral';
      const volState = (recent[2].volPcr != null) ? (recent[2].volPcr > 1.1 ? 'bullish' : recent[2].volPcr < 0.85 ? 'bearish' : 'neutral') : null;

      if (volState && oiState !== 'neutral' && volState !== 'neutral' && oiState !== volState) return 'PCR UNSTABLE';
      if (oiState === 'bullish' && (oiTrendUp || oiTrendDown === false)) return 'PCR BULLISH';
      if (oiState === 'bearish' && (oiTrendDown || oiTrendUp === false)) return 'PCR BEARISH';
      if (oiState === 'neutral') return 'PCR NEUTRAL';
      return 'PCR UNSTABLE';
    }

    // Rule 4: mandatory NIFTY+BANKNIFTY alignment gate — SENSEX never
    // overrides a NIFTY-BANKNIFTY conflict, only confirms/strengthens.
    function computeMandatoryAlignment() {
      if (!data) return { eligible: null, reason: 'DATA_UNAVAILABLE' };
      const niftyFut = classifySimpleFutures('NIFTY');
      const bankFut = classifySimpleFutures('BANKNIFTY');
      const niftyDir = niftyFut === 'FRESH LONG BUILD-UP' ? 'CE' : niftyFut === 'FRESH SHORT BUILD-UP' ? 'PE' : null;
      const bankDir = bankFut === 'FRESH LONG BUILD-UP' ? 'CE' : bankFut === 'FRESH SHORT BUILD-UP' ? 'PE' : null;

      if (niftyDir == null || bankDir == null) return { eligible: null, reason: 'UNCONFIRMED' };
      if (niftyDir !== bankDir) return { eligible: 'CONFLICT', reason: 'NIFTY_BANKNIFTY_OPPOSITE' };
      return { eligible: niftyDir, reason: null };
    }

    // Rule 14: exact 13-step processing order producing ONE final verdict.
    function computeFinalVerdict() {
      advanceSimpleVerdictTrackers();

      // Steps 1-3: connection, freshness, minimum snapshots
      if (connectionState === 'DISCONNECTED') {
        return { verdict: 'DATA UNAVAILABLE', confidence: null, reasons: ['Connection disconnected'] };
      }
      if (!data) {
        return { verdict: 'DATA UNAVAILABLE', confidence: null, reasons: ['No market data yet'] };
      }

      // Step 4: mandatory NIFTY+BANKNIFTY alignment — nothing below can override this
      const mandatory = computeMandatoryAlignment();
      if (mandatory.eligible === 'CONFLICT') {
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY and BANKNIFTY futures disagree'] };
      }
      if (mandatory.eligible == null) {
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY or BANKNIFTY not yet confirmed (needs 3 snapshots, ~9 min)'] };
      }
      const primaryDir = mandatory.eligible; // 'CE' or 'PE'

      // Steps 5-6: futures price+OI (already computed for the gate above)
      const niftyFut = classifySimpleFutures('NIFTY');
      const bankFut = classifySimpleFutures('BANKNIFTY');
      const sensexFut = classifySimpleFutures('SENSEX');

      // Step 7: premium alignment (confirms/weakens only)
      const niftyPremium = classifySimplePremium('NIFTY');
      const bankPremium = classifySimplePremium('BANKNIFTY');
      const premiumSupports = (primaryDir === 'CE' && (niftyPremium === 'CE CONFIRMED' || bankPremium === 'CE CONFIRMED')) ||
        (primaryDir === 'PE' && (niftyPremium === 'PE CONFIRMED' || bankPremium === 'PE CONFIRMED'));
      const premiumConflicts = (primaryDir === 'CE' && (niftyPremium === 'PE CONFIRMED' || bankPremium === 'PE CONFIRMED')) ||
        (primaryDir === 'PE' && (niftyPremium === 'CE CONFIRMED' || bankPremium === 'CE CONFIRMED'));

      // Step 8: PCR (confirms/weakens only)
      const niftyPcr = classifySimplePcr('NIFTY');
      const bankPcr = classifySimplePcr('BANKNIFTY');
      const pcrSupports = (primaryDir === 'CE' && (niftyPcr === 'PCR BULLISH' || bankPcr === 'PCR BULLISH')) ||
        (primaryDir === 'PE' && (niftyPcr === 'PCR BEARISH' || bankPcr === 'PCR BEARISH'));

      // Step 9: PDH/PDL context
      const niftyLevel = classifySimplePdhPdl('NIFTY', data.NIFTY);
      const bankLevel = classifySimplePdhPdl('BANKNIFTY', data.BANKNIFTY);
      const oneBreakoutOneRejection =
        ((niftyLevel === 'PDH BREAKOUT' || niftyLevel === 'PDL BREAKDOWN') && (bankLevel === 'PDH REJECTION' || bankLevel === 'PDL REJECTION')) ||
        ((bankLevel === 'PDH BREAKOUT' || bankLevel === 'PDL BREAKDOWN') && (niftyLevel === 'PDH REJECTION' || niftyLevel === 'PDL REJECTION'));
      if (oneBreakoutOneRejection) {
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY/BANKNIFTY level context disagree'] };
      }
      const levelSupports = (primaryDir === 'CE' && (niftyLevel === 'PDH BREAKOUT' || bankLevel === 'PDH BREAKOUT')) ||
        (primaryDir === 'PE' && (niftyLevel === 'PDL BREAKDOWN' || bankLevel === 'PDL BREAKDOWN'));

      // Step 10: SENSEX confirmation/weakening only — never overrides
      const sensexDir = sensexFut === 'FRESH LONG BUILD-UP' ? 'CE' : sensexFut === 'FRESH SHORT BUILD-UP' ? 'PE' : null;
      const sensexOpposes = sensexDir != null && sensexDir !== primaryDir;
      const sensexSupports = sensexDir === primaryDir;

      // Strength (STRONG requires both NIFTY+BANKNIFTY Fresh in the
      // primary direction, plus SENSEX not opposing).
      const bothFresh = (primaryDir === 'CE' && niftyFut === 'FRESH LONG BUILD-UP' && bankFut === 'FRESH LONG BUILD-UP') ||
        (primaryDir === 'PE' && niftyFut === 'FRESH SHORT BUILD-UP' && bankFut === 'FRESH SHORT BUILD-UP');

      let verdict;
      if (premiumConflicts) {
        verdict = 'WAIT \u2014 CONFLICTING DATA';
      } else if (bothFresh && !sensexOpposes) {
        verdict = primaryDir === 'CE' ? 'STRONG CE BIAS' : 'STRONG PE BIAS';
      } else if (bothFresh && sensexOpposes) {
        verdict = primaryDir === 'CE' ? 'MILD CE BIAS' : 'MILD PE BIAS';
      } else if (niftyFut === 'SHORT COVERING' || bankFut === 'SHORT COVERING' || niftyFut === 'LONG UNWINDING' || bankFut === 'LONG UNWINDING') {
        verdict = primaryDir === 'CE' ? 'MILD CE BIAS' : 'MILD PE BIAS';
      } else if (niftyFut === 'RANGE / NO CLEAR BUILD-UP' && bankFut === 'RANGE / NO CLEAR BUILD-UP') {
        verdict = 'SIDEWAYS / RANGE';
      } else {
        verdict = primaryDir === 'CE' ? 'MILD CE BIAS' : 'MILD PE BIAS';
      }

      // Step 11: confidence
      let confidence;
      const coreFresh = connectionState === 'LIVE';
      if (verdict.indexOf('STRONG') === 0 && coreFresh && premiumSupports && pcrSupports && levelSupports && !sensexOpposes) {
        confidence = 'HIGH';
      } else if (verdict.indexOf('WAIT') === 0 || verdict === 'DATA UNAVAILABLE') {
        confidence = 'LOW';
      } else if (coreFresh && (premiumSupports || pcrSupports)) {
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
      }

      // Max 2 short reasons
      const reasons = [];
      if (bothFresh) reasons.push('NIFTY + BANKNIFTY both fresh ' + (primaryDir === 'CE' ? 'long' : 'short') + ' build-up');
      if (premiumSupports) reasons.push('Premium confirms ' + primaryDir);
      else if (sensexOpposes) reasons.push('SENSEX opposing \u2014 strength reduced');
      if (reasons.length === 0) reasons.push('Partial confirmation only');
      reasons.length = Math.min(reasons.length, 2);

      return {
        verdict: verdict, confidence: confidence, reasons: reasons,
        details: { niftyFut, bankFut, sensexFut, niftyPremium, bankPremium, niftyPcr, bankPcr, niftyLevel, bankLevel, mandatory },
      };
    }

    function renderFinalVerdictCard() {
      const result = computeFinalVerdict();
      const color = result.verdict.indexOf('STRONG CE') === 0 ? 'var(--green)' :
        result.verdict.indexOf('MILD CE') === 0 ? 'var(--green)' :
        result.verdict.indexOf('STRONG PE') === 0 ? 'var(--red)' :
        result.verdict.indexOf('MILD PE') === 0 ? 'var(--red)' :
        result.verdict.indexOf('SIDEWAYS') === 0 ? 'var(--muted)' :
        result.verdict.indexOf('WAIT') === 0 ? 'var(--gold)' : 'var(--muted)';

      let html = '<div class="premium-card" style="margin-bottom:12px; border-color:' + color + '; text-align:center; padding:16px;">';
      html += '<div style="color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px;">Final Verdict</div>';
      html += '<div style="color:' + color + '; font-weight:800; font-size:1.3rem; margin:6px 0;">' + escapeHtml(result.verdict) + '</div>';
      if (result.confidence) {
        html += '<div style="color:var(--muted); font-size:0.8rem;">Confidence: <strong style="color:var(--text);">' + result.confidence + '</strong></div>';
      }
      if (result.reasons && result.reasons.length) {
        html += '<div style="color:var(--muted); font-size:0.75rem; margin-top:8px;">' + result.reasons.map(escapeHtml).join(' \u00b7 ') + '</div>';
      }
      if (result.details) {
        html += '<details style="margin-top:10px; text-align:left;"><summary style="color:var(--gold); font-size:0.72rem; cursor:pointer; font-weight:700; text-align:center;">Why this verdict?</summary>';
        html += '<div style="margin-top:8px; font-size:0.72rem;">';
        html += rowLine('NIFTY Futures', result.details.niftyFut);
        html += rowLine('BANKNIFTY Futures', result.details.bankFut);
        html += rowLine('SENSEX Futures', result.details.sensexFut);
        html += rowLine('NIFTY Premium', result.details.niftyPremium);
        html += rowLine('BANKNIFTY Premium', result.details.bankPremium);
        html += rowLine('NIFTY PCR', result.details.niftyPcr);
        html += rowLine('BANKNIFTY PCR', result.details.bankPcr);
        html += rowLine('NIFTY Level', result.details.niftyLevel);
        html += rowLine('BANKNIFTY Level', result.details.bankLevel);
        html += '</div></details>';
      }
      html += '<div class="timestamp">Rule 14 processing order: connection \u2192 freshness \u2192 snapshot minimum \u2192 mandatory NIFTY+BANKNIFTY alignment \u2192 futures VWAP \u2192 futures price+OI \u2192 premium \u2192 PCR \u2192 PDH/PDL \u2192 SENSEX (confirm/weaken only) \u2192 confidence \u2192 verdict. Thresholds (0.10% PDH/PDL proximity, 1.1/0.85 PCR bands) are PROVISIONAL, not backtested. This is a confirmation dashboard, not an automatic order-placement system.</div>';
      html += '</div>';
      return html;
    }

    // ===== end REFACTOR B =====

    // ===== REFACTOR C: UI / COLOR / SCREEN HIERARCHY (rules 11,12,13) =====
    // Display-only — reuses Refactor B's classifications, adds no new logic.

    // Rule 13: semantic color mapping, single source of truth so colors
    // stay consistent everywhere they're used.
    function semanticColor(value) {
      if (value == null) return 'var(--muted)';
      const v = String(value);
      if (v.indexOf('STRONG CE') === 0 || v === 'FRESH LONG BUILD-UP' || v === 'CE CONFIRMED' || v === 'PCR BULLISH' || v === 'PDH BREAKOUT' || v === 'PDL REJECTION' || v === 'CE') return 'var(--green)';
      if (v.indexOf('MILD CE') === 0 || v === 'SHORT COVERING') return '#7FE0A8';
      if (v.indexOf('STRONG PE') === 0 || v === 'FRESH SHORT BUILD-UP' || v === 'PE CONFIRMED' || v === 'PCR BEARISH' || v === 'PDL BREAKDOWN' || v === 'PDH REJECTION' || v === 'PE') return 'var(--red)';
      if (v.indexOf('MILD PE') === 0 || v === 'LONG UNWINDING') return '#E88A8A';
      if (v.indexOf('WAIT') === 0 || v === 'PCR UNSTABLE' || v === 'NEAR PDH' || v === 'NEAR PDL' || v === 'MIXED') return 'var(--gold)';
      if (v.indexOf('SIDEWAYS') === 0 || v === 'PCR NEUTRAL' || v === 'INSIDE RANGE' || v === 'RANGE / NO CLEAR BUILD-UP' || v === 'NEUTRAL') return '#5B9BD5';
      if (v === 'DATA UNAVAILABLE' || v === 'PCR DATA UNAVAILABLE' || v === 'NO CONFIRMATION') return 'var(--muted)';
      return 'var(--muted)';
    }

    function renderBadge(label) {
      const color = semanticColor(label);
      return '<span class="badge-pill" style="background:rgba(0,0,0,0.25); color:' + color + '; border:1px solid ' + color + '; font-weight:700; font-size:0.65rem;">' + escapeHtml(String(label)) + '</span>';
    }

    // Rule 11: compact index cards — direction/behaviour only, no raw
    // OI/snapshot IDs/timestamps/strike data (that stays in each index's
    // own OVERVIEW/FUTURES/OPTIONS/ALIGNMENT tabs).
    function renderCompactIndexCard(symbol, m, isSensex) {
      let html = '<div class="premium-card" style="margin-bottom:8px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
      html += '<span class="card-title" style="margin-bottom:0;">' + symbol + '</span>';

      if (!m || m.error) {
        html += '</div><div class="unavailable-text">DATA UNAVAILABLE</div></div>';
        return html;
      }

      const effTs = getEffectiveTimestamp(m);
      const ageSec = effTs ? Math.round((Date.now() - new Date(effTs).getTime()) / 1000) : null;
      const isStale = ageSec == null || ageSec > 360;

      if (!isSensex && !isStale) {
        const futClass = classifySimpleFutures(symbol);
        const dir = futClass === 'FRESH LONG BUILD-UP' ? 'CE' : futClass === 'FRESH SHORT BUILD-UP' ? 'PE' : 'NEUTRAL';
        html += renderBadge(dir);
      }
      html += '</div>';

      html += '<div style="display:flex; align-items:baseline; gap:8px; margin:6px 0;">';
      html += '<span style="color:var(--text); font-size:1.4rem; font-weight:700;">' + (m.current > 0 ? m.current.toFixed(2) : '\u2014') + '</span>';
      if (m.change != null) {
        const chColor = m.change > 0 ? 'var(--green)' : m.change < 0 ? 'var(--red)' : '#5B9BD5';
        const arrow = m.change > 0 ? '\u25b2' : m.change < 0 ? '\u25bc' : '\u25cf';
        html += '<span style="color:' + chColor + '; font-size:0.85rem; font-weight:600;">' + arrow + ' ' + (m.change >= 0 ? '+' : '') + m.change.toFixed(2) + '</span>';
      }
      html += '</div>';

      if (isStale) {
        // Point 4: never show a stale directional badge as current.
        html += '<div style="color:var(--gold); font-size:0.72rem; font-weight:700;">Last valid reading' + (effTs ? ' \u2014 ' + new Date(effTs).toLocaleTimeString() : ' \u2014 DATA UNAVAILABLE') + '</div>';
        html += '<div style="display:flex; flex-wrap:wrap; gap:6px; opacity:0.5;">';
      } else {
        html += '<div style="display:flex; flex-wrap:wrap; gap:6px;">';
      }
      html += renderBadge(classifySimpleFutures(symbol));
      html += renderBadge(classifySimplePremium(symbol));
      html += renderBadge(classifySimplePcr(symbol));
      html += renderBadge(classifySimplePdhPdl(symbol, m));
      html += '</div>';

      html += '<details style="margin-top:6px;"><summary style="color:var(--gold); font-size:0.68rem; cursor:pointer;">Details</summary>';
      html += '<div style="margin-top:6px;">';
      resetRowLineTracking();
      html += rowLine('Futures Behaviour', classifySimpleFutures(symbol));
      html += rowLine('Premium Alignment', classifySimplePremium(symbol));
      html += rowLine('PCR Status', classifySimplePcr(symbol));
      html += rowLine('PDH/PDL Context', classifySimplePdhPdl(symbol, m));
      html += rowLine('Data Age', ageSec != null ? ageSec + 's' : 'DATA UNAVAILABLE');
      html += '</div></details>';
      html += '</div>';
      return html;
    }

    // Rule 12, item 3: mandatory NIFTY+BANKNIFTY alignment mini-status.
    function renderMandatoryAlignmentBar() {
      const mandatory = computeMandatoryAlignment();
      let text, color;
      if (mandatory.eligible === 'CONFLICT') { text = 'NIFTY \u2260 BANKNIFTY \u2014 CONFLICT'; color = 'var(--red)'; }
      else if (mandatory.eligible == null) { text = 'NIFTY / BANKNIFTY UNCONFIRMED'; color = 'var(--muted)'; }
      else { text = 'NIFTY + BANKNIFTY ALIGNED \u2014 ' + mandatory.eligible; color = 'var(--green)'; }
      return '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:8px;"><span style="color:var(--muted); font-size:0.7rem;">NIFTY+BANKNIFTY Alignment</span><span style="color:' + color + '; font-weight:700; font-size:0.75rem;">' + escapeHtml(text) + '</span></div>';
    }

    // Rule 12, item 4: SENSEX confirmation mini-status.
    function renderSensexConfirmationBar() {
      const sensexFut = data ? classifySimpleFutures('SENSEX') : 'DATA UNAVAILABLE';
      const mandatory = computeMandatoryAlignment();
      const sensexDir = sensexFut === 'FRESH LONG BUILD-UP' ? 'CE' : sensexFut === 'FRESH SHORT BUILD-UP' ? 'PE' : null;
      let text, color;
      if (mandatory.eligible == null || mandatory.eligible === 'CONFLICT') { text = 'N/A \u2014 NO PRIMARY DIRECTION YET'; color = 'var(--muted)'; }
      else if (sensexDir == null) { text = 'SENSEX NEUTRAL'; color = '#5B9BD5'; }
      else if (sensexDir === mandatory.eligible) { text = 'SENSEX CONFIRMS'; color = 'var(--green)'; }
      else { text = 'SENSEX OPPOSING \u2014 STRENGTH REDUCED'; color = 'var(--gold)'; }
      return '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:8px;"><span style="color:var(--muted); font-size:0.7rem;">SENSEX Confirmation</span><span style="color:' + color + '; font-weight:700; font-size:0.75rem;">' + escapeHtml(text) + '</span></div>';
    }

    // Rule 12, item 6: ONE consolidated trade-readiness card (was 3
    // per-index cards in Refactor A) — most restrictive state wins.
    function renderConsolidatedReadinessCard() {
      if (!data) return renderSignalLockCard('NIFTY', null);
      const locks = ['NIFTY', 'BANKNIFTY', 'SENSEX'].map((sym) => computeSignalLockState(sym, data[sym]));
      const anyLocked = locks.find((l) => l.state.indexOf('SIGNAL LOCKED') === 0);
      const anyWait = locks.find((l) => l.state.indexOf('WAIT') === 0);
      const combined = anyLocked || anyWait || locks[0];
      const color = combined.state === 'TRADE READY' ? 'var(--green)' : combined.state.indexOf('SIGNAL LOCKED') === 0 ? 'var(--red)' : 'var(--gold)';
      let html = '<div class="premium-card" style="margin-bottom:10px; border-color:' + color + ';">';
      html += '<div class="card-title">Trade Readiness</div>';
      html += '<div style="color:' + color + '; font-weight:700; font-size:0.9rem;">' + escapeHtml(combined.state) + '</div>';
      if (combined.reason) html += '<div style="color:var(--muted); font-size:0.7rem; margin-top:2px;">' + escapeHtml(combined.reason) + '</div>';
      html += '</div>';
      return html;
    }

    // Rule 12, item 7: recorder mini-bar (full card moved to Session Records).
    function renderRecorderMiniBar() {
      if (!recorderStatusData || recorderStatusData.error) {
        return '<div style="display:flex; justify-content:space-between; padding:6px 12px; background:rgba(0,0,0,0.15); border-radius:8px; margin-bottom:8px; font-size:0.68rem; color:var(--muted);"><span>Recorder OFF</span><span>0 snapshots</span></div>';
      }
      const s = recorderStatusData;
      const color = s.status === 'RECORDING' ? 'var(--green)' : s.status === 'DEGRADED' ? 'var(--gold)' : 'var(--muted)';
      const snapColor = s.lastSnapshotStatus === 'LIVE' ? 'var(--green)' : s.lastSnapshotStatus === 'PARTIAL' ? 'var(--gold)' : s.lastSnapshotStatus ? 'var(--red)' : 'var(--muted)';
      return '<div style="display:flex; justify-content:space-between; padding:6px 12px; background:rgba(0,0,0,0.15); border-radius:8px; margin-bottom:8px; font-size:0.68rem;"><span style="color:' + color + '; font-weight:700;">Recorder ' + (s.status === 'RECORDING' ? 'ON' : s.status) + '</span><span style="color:' + snapColor + ';">' + (s.lastSnapshotStatus || '\u2014') + '</span><span style="color:var(--muted);">' + s.snapshotCount + ' snapshots</span></div>';
    }

    // ===== end REFACTOR C =====

    function computeVixTimeframeChange(minutesAgo) {
      const hist = pcrHistory['NIFTY'];
      if (!hist || hist.length < 2) return null;
      const now = new Date();
      const targetTime = new Date(now.getTime() - minutesAgo * 60000);
      let closest = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].time <= targetTime && hist[i].vix != null) { closest = hist[i]; break; }
      }
      if (!closest) return null;
      let current = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].vix != null) { current = hist[i]; break; }
      }
      if (!current || !closest.vix) return null;
      return ((current.vix - closest.vix) / closest.vix) * 100;
    }

    function renderContextMacroVix() {
      if (!data || !data.NIFTY) return '<div class="loading">Loading...</div>';
      const m = data.NIFTY;
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">India VIX</div>';
      if (!m.error) {
        html += rowLine('Current', m.vix.toFixed(2));
        html += rowLine('Daily Change %', (m.vixChangePercent >= 0 ? '+' : '') + m.vixChangePercent.toFixed(2) + '%');
        const v15 = computeVixTimeframeChange(15);
        const v30 = computeVixTimeframeChange(30);
        const v60 = computeVixTimeframeChange(60);
        html += rowLine('15m / 30m / 1h Change', (v15 != null || v30 != null || v60 != null) ? fmtStraddleChange(v15) + ' / ' + fmtStraddleChange(v30) + ' / ' + fmtStraddleChange(v60) : 'DATA UNAVAILABLE');
      } else {
        html += rowLine('Current', 'DATA UNAVAILABLE');
      }
      html += rowLine('5-Day Trend', 'DATA UNAVAILABLE');
      html += '</div>';
      html += '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Crude Oil / USDINR</div>';
      if (commoditiesData && commoditiesData.CRUDEOIL && !commoditiesData.CRUDEOIL.error) {
        const co = commoditiesData.CRUDEOIL;
        html += rowLine('Crude Oil (MCX ' + escapeHtml(co.futuresSymbol || '') + ')', co.current.toFixed(2) + ' (' + (co.changePercent >= 0 ? '+' : '') + co.changePercent.toFixed(2) + '%)');
        html += rowLine('5-Day Trend', 'DATA UNAVAILABLE');
      } else {
        html += rowLine('Crude Oil', 'DATA UNAVAILABLE');
      }
      if (commoditiesData && commoditiesData.USDINR && !commoditiesData.USDINR.error) {
        const fx = commoditiesData.USDINR;
        html += rowLine('USDINR (' + escapeHtml(fx.futuresSymbol || '') + ')', fx.current.toFixed(4) + ' (' + (fx.changePercent >= 0 ? '+' : '') + fx.changePercent.toFixed(2) + '%)');
      } else {
        html += rowLine('USDINR', 'DATA UNAVAILABLE');
      }
      html += '</div>';
      html += '<div class="timestamp">Crude Oil is MCX futures (roughly WTI-linked), not the ICE Brent contract the spec names — Kite does not offer Brent directly. USDINR is Kite\u2019s CDS currency futures (near-month), a genuine Kite data point. Both are risk-modifiers, not direct CE/PE triggers, per spec. DXY and 10-year yields are not available via Kite at all.</div>';
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
      html += '<div style="color: var(--muted); font-size:0.75rem; margin-bottom:8px;">Paste several days, each block separated by a blank line. Each block needs at least "Date:" and "FII Cash:". Index Futures / Stock Futures / Index Options OI + Bias (Long or Short works, or the full "Long Buildup" etc.) are also supported per block.</div>';
      html += '<textarea id="fdBulkPasteBox" placeholder="Date: 2026-07-31&#10;FII Cash: 277.48&#10;DII Cash: 2260.37&#10;Index Futures OI: 13499&#10;Index Futures Bias: Short&#10;Stock Futures OI: -4200&#10;Stock Futures Bias: Long&#10;&#10;Date: 2026-07-30&#10;FII Cash: 3623.51&#10;DII Cash: -1864.03" style="width:100%; min-height:160px; background: var(--panel-alt); border:1px solid var(--border); color: var(--text); border-radius:6px; padding:8px; font-size:0.75rem; font-family: var(--font-mono);"></textarea>';
      html += '<button class="btn primary" style="margin-top:8px;" onclick="bulkSaveFiiDii()">📦 Save All Days</button>';
      html += '</div>';
      return html;
    }

    // FII rolling percentile classification — spec section 17. Ranks
    // today's FII cash net against the full history of entered days rather
    // than one fixed rupee threshold. PROVISIONAL — REQUIRES BACKTEST per
    // spec (thresholds are illustrative, not validated).
    function computePercentileRank(values, target) {
      if (values.length === 0) return null;
      const below = values.filter((v) => v < target).length;
      return (below / values.length) * 100;
    }

    function classifyFiiPercentile(entries) {
      if (entries.length < 3) return null; // not enough history for a meaningful percentile
      const today = entries[entries.length - 1];
      const allFii = entries.map((e) => e.fiiCashCr);
      const pct = computePercentileRank(allFii, today.fiiCashCr);
      let label;
      if (pct >= 80) label = 'Strong FII Buying';
      else if (pct >= 60) label = 'Moderate FII Buying';
      else if (pct >= 40) label = 'Neutral';
      else if (pct >= 20) label = 'Moderate FII Selling';
      else label = 'Strong FII Selling';

      let instNote;
      if (today.fiiCashCr < 0 && today.diiCashCr > 0) instNote = 'DII absorbing FII selling';
      else if (today.fiiCashCr > 0 && today.diiCashCr > 0) instNote = 'Institutions aligned (both buying)';
      else if (today.fiiCashCr < 0 && today.diiCashCr < 0) instNote = 'Institutions aligned (both selling)';
      else instNote = 'Institutions conflicting';

      return { pct, label, instNote, date: today.date };
    }

    function renderFiiDiiPercentileCard(entries) {
      const result = classifyFiiPercentile(entries);
      if (!result) {
        return '<div class="premium-card" style="margin-bottom:16px;"><div class="card-title">FII Percentile Classification</div><div class="unavailable-text">DATA UNAVAILABLE — needs at least 3 entered days to compute a percentile rank.</div></div>';
      }
      const color = result.label.indexOf('Buying') !== -1 ? 'var(--green)' : result.label.indexOf('Selling') !== -1 ? 'var(--red)' : 'var(--muted)';
      let html = '<div class="premium-card" style="margin-bottom:16px; border: 2px solid ' + color + ';">';
      html += '<div class="card-title">FII Percentile Classification (' + result.date + ') — PROVISIONAL, REQUIRES BACKTEST</div>';
      html += rowLine('Percentile Rank', result.pct.toFixed(0) + 'th percentile of all entered days');
      html += rowLine('Classification', result.label);
      html += rowLine('Institutional Read', result.instNote);
      html += '</div>';
      return html;
    }

    // 5-day FII/DII bias verdict — combines cash (FII+DII net) with
    // derivatives bias where available. Derivatives are only present on
    // days someone entered them (NSE's cash FII/DII feed does not include
    // index/stock futures positioning), so this never fabricates a
    // derivatives read for days without one.
    function computeFiveDayFiiDiiBias(entries) {
      if (!entries || entries.length < 3) return { ready: false };
      const last5 = entries.slice(-5);
      const fiiSum = last5.reduce((s, e) => s + (e.fiiCashCr || 0), 0);
      const diiSum = last5.reduce((s, e) => s + (e.diiCashCr || 0), 0);
      const fiiPositiveDays = last5.filter((e) => e.fiiCashCr > 0).length;
      const diiPositiveDays = last5.filter((e) => e.diiCashCr > 0).length;

      let derivBullish = 0, derivBearish = 0, derivTotal = 0;
      last5.forEach((e) => {
        (e.derivatives || []).forEach((d) => {
          derivTotal++;
          if (d.bias === 'Long Buildup' || d.bias === 'Short Covering') derivBullish++;
          else if (d.bias === 'Short Buildup' || d.bias === 'Long Unwinding') derivBearish++;
        });
      });

      let cashBias;
      if (fiiSum > 0 && diiSum > 0) cashBias = 'BOTH BUYING';
      else if (fiiSum < 0 && diiSum < 0) cashBias = 'BOTH SELLING';
      else if (fiiSum > 0 && diiSum < 0) cashBias = 'FII BUYING, DII SELLING';
      else if (fiiSum < 0 && diiSum > 0) cashBias = 'FII SELLING, DII BUYING';
      else cashBias = 'MIXED';

      let derivBias = 'NO DERIVATIVE DATA';
      if (derivTotal > 0) {
        if (derivBullish > derivBearish) derivBias = 'DERIVATIVES BULLISH-TILTED';
        else if (derivBearish > derivBullish) derivBias = 'DERIVATIVES BEARISH-TILTED';
        else derivBias = 'DERIVATIVES MIXED';
      }

      let verdict;
      if (cashBias === 'BOTH BUYING' && (derivBias === 'DERIVATIVES BULLISH-TILTED' || derivBias === 'NO DERIVATIVE DATA')) verdict = '5-DAY BULLISH BIAS';
      else if (cashBias === 'BOTH SELLING' && (derivBias === 'DERIVATIVES BEARISH-TILTED' || derivBias === 'NO DERIVATIVE DATA')) verdict = '5-DAY BEARISH BIAS';
      else if ((cashBias === 'BOTH BUYING' && derivBias === 'DERIVATIVES BEARISH-TILTED') || (cashBias === 'BOTH SELLING' && derivBias === 'DERIVATIVES BULLISH-TILTED')) verdict = 'CASH-DERIVATIVE CONFLICT';
      else verdict = '5-DAY MIXED / NEUTRAL';

      return {
        ready: true, daysUsed: last5.length, fiiSum: fiiSum, diiSum: diiSum,
        fiiPositiveDays: fiiPositiveDays, diiPositiveDays: diiPositiveDays,
        cashBias: cashBias, derivBias: derivBias, derivTotal: derivTotal, verdict: verdict,
      };
    }

    function renderFiiDiiVerdictCard(entries) {
      const result = computeFiveDayFiiDiiBias(entries);
      let html = '<div class="premium-card" style="margin-bottom:16px;">';
      html += '<div class="card-title">5-Day FII/DII Verdict</div>';
      if (!result.ready) {
        html += '<div class="unavailable-text">DATA UNAVAILABLE \u2014 needs at least 3 entered days to compute a 5-day bias.</div></div>';
        return html;
      }
      const color = result.verdict === '5-DAY BULLISH BIAS' ? 'var(--green)' : result.verdict === '5-DAY BEARISH BIAS' ? 'var(--red)' : result.verdict === 'CASH-DERIVATIVE CONFLICT' ? 'var(--gold)' : 'var(--muted)';
      html += '<div style="color:' + color + '; font-weight:700; font-size:0.9rem; margin-bottom:8px;">' + result.verdict + '</div>';
      html += rowLine('Days Used', result.daysUsed + ' of last 5 entered');
      html += rowLine('FII Net (5d Sum)', '\u20b9' + result.fiiSum.toFixed(0) + ' Cr (' + result.fiiPositiveDays + '/' + result.daysUsed + ' buying days)');
      html += rowLine('DII Net (5d Sum)', '\u20b9' + result.diiSum.toFixed(0) + ' Cr (' + result.diiPositiveDays + '/' + result.daysUsed + ' buying days)');
      html += rowLine('Cash Bias', result.cashBias);
      html += rowLine('Derivatives Bias', result.derivBias + (result.derivTotal > 0 ? ' (' + result.derivTotal + ' entries)' : ''));
      html += '<div class="timestamp">PROVISIONAL \u2014 REQUIRES BACKTEST. Verdict is bullish/bearish only when Cash AND Derivatives (where entered) agree \u2014 disagreement is flagged as CASH-DERIVATIVE CONFLICT rather than forced into a direction. Derivatives bias only reflects days where derivative data was manually entered.</div>';
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
      html += renderFiiDiiPercentileCard(entries);
      html += renderFiiDiiVerdictCard(entries);

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
      await Promise.all([loadNews(), loadHolidays(), loadFiiDii(), loadRecorderStatus(), loadDriveStatus(), loadJournalData()]);
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

// ============== SESSION RECORDER API (Phase 1) ==============

app.get("/api/journal", (c) => {
  return c.json({
    tradingDate: recorderSession.tradingDate,
    entryCount: journalEntries.length,
    entries: journalEntries.slice(-50), // most recent 50 for display; full set used for archive
  });
});

function buildJournalText(): string {
  const date = recorderSession.tradingDate || indiaTradingDate();
  const lines: string[] = [];
  lines.push("OptionPilot Pro \u2014 Daily Journal");
  lines.push("Trading Date: " + date);
  lines.push("Total Entries: " + journalEntries.length);
  lines.push("");
  lines.push("=".repeat(50));
  lines.push("");

  if (journalEntries.length === 0) {
    lines.push("No entries yet for today.");
  }

  journalEntries.forEach((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    lines.push(time);
    lines.push("NIFTY:  3m " + e.nifty3m + "  |  15m " + e.nifty15m + "  |  30m " + e.nifty30m);
    lines.push("SENSEX: 3m " + e.sensex3m + "  |  15m " + e.sensex15m + "  |  30m " + e.sensex30m);
    lines.push("Combined Verdict: " + e.combinedVerdict + "  (Confidence: " + e.confidence + ")");
    lines.push("Data Health: " + e.dataHealth);
    if (e.leadingIndex) lines.push("Leading Index: " + e.leadingIndex);
    if (e.conflictingIndex) lines.push("Conflicting Index: " + e.conflictingIndex);
    lines.push("Reason: " + e.reason);
    if (e.verdictChanged) lines.push("*** VERDICT CHANGED from: " + e.previousVerdict + " ***");
    if (e.notes.length > 0) {
      lines.push("Important Notes:");
      e.notes.forEach((n) => lines.push("  - " + n));
    }
    lines.push("");
    lines.push("-".repeat(50));
    lines.push("");
  });

  return lines.join("\n");
}

function journalVerdictColor(v: string): string {
  if (v.indexOf("CE") !== -1 && v.indexOf("STRONG") === 0) return "#1D9E75"; // deep green
  if (v.indexOf("CE") !== -1) return "#5DCAA5"; // light green
  if (v.indexOf("PE") !== -1 && v.indexOf("STRONG") === 0) return "#D85A30"; // deep red/coral
  if (v.indexOf("PE") !== -1) return "#F0997B"; // light red/coral
  if (v.indexOf("WAIT") !== -1 || v.indexOf("INVALID") !== -1) return "#EF9F27"; // amber
  if (v.indexOf("SIDEWAYS") === 0) return "#378ADD"; // blue
  return "#888780"; // gray
}

function buildJournalHtml(): string {
  const date = recorderSession.tradingDate || indiaTradingDate();
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OptionPilot Pro Journal - ${date}</title>
<style>
body { background:#12121e; color:#e8e8f0; font-family: -apple-system, sans-serif; margin:0; padding:16px; }
h1 { font-size:1.1rem; color:#f0c674; margin-bottom:4px; }
.sub { color:#888; font-size:0.8rem; margin-bottom:16px; }
.entry { background:#1a1a2e; border-radius:10px; padding:12px 14px; margin-bottom:10px; border-left:4px solid #444; }
.time { color:#f0c674; font-weight:700; font-size:0.85rem; margin-bottom:6px; }
.row { font-size:0.8rem; margin:3px 0; }
.label { color:#999; }
.badge { display:inline-block; padding:2px 8px; border-radius:10px; font-weight:700; font-size:0.75rem; color:#12121e; }
.notes { background:rgba(240,198,116,0.12); border-left:3px solid #f0c674; padding:6px 8px; margin-top:6px; font-size:0.75rem; color:#f0c674; }
.changed { color:#f0c674; font-weight:700; font-size:0.75rem; margin-top:4px; }
</style></head><body>
<h1>OptionPilot Pro \u2014 Daily Journal</h1>
<div class="sub">Trading Date: ${date} &middot; ${journalEntries.length} entries</div>`;

  if (journalEntries.length === 0) {
    html += `<div class="entry">No entries yet for today.</div>`;
  }

  journalEntries.slice().reverse().forEach((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const combinedColor = journalVerdictColor(e.combinedVerdict);
    html += `<div class="entry" style="border-left-color:${combinedColor};">`;
    html += `<div class="time">${time}</div>`;
    html += `<div class="row"><span class="label">NIFTY 3m/15m/30m:</span> <span class="badge" style="background:${journalVerdictColor(e.nifty3m)};">${e.nifty3m}</span> <span class="badge" style="background:${journalVerdictColor(e.nifty15m)};">${e.nifty15m}</span> <span class="badge" style="background:${journalVerdictColor(e.nifty30m)};">${e.nifty30m}</span></div>`;
    html += `<div class="row"><span class="label">SENSEX 3m/15m/30m:</span> <span class="badge" style="background:${journalVerdictColor(e.sensex3m)};">${e.sensex3m}</span> <span class="badge" style="background:${journalVerdictColor(e.sensex15m)};">${e.sensex15m}</span> <span class="badge" style="background:${journalVerdictColor(e.sensex30m)};">${e.sensex30m}</span></div>`;
    html += `<div class="row" style="margin-top:6px;"><span class="badge" style="background:${combinedColor}; font-size:0.85rem;">${e.combinedVerdict}</span> <span class="label">(${e.confidence} confidence)</span></div>`;
    html += `<div class="row"><span class="label">Data Health:</span> ${e.dataHealth}</div>`;
    if (e.leadingIndex) html += `<div class="row"><span class="label">Leading:</span> ${e.leadingIndex}</div>`;
    if (e.conflictingIndex) html += `<div class="row"><span class="label">Conflicting:</span> ${e.conflictingIndex}</div>`;
    html += `<div class="row"><span class="label">Reason:</span> ${e.reason}</div>`;
    if (e.verdictChanged) html += `<div class="changed">\u26a1 Verdict changed from: ${e.previousVerdict}</div>`;
    if (e.notes.length > 0) {
      html += `<div class="notes">${e.notes.map((n) => "\u2022 " + n).join("<br>")}</div>`;
    }
    html += `</div>`;
  });

  html += `</body></html>`;
  return html;
}

app.get("/api/journal/text", (c) => {
  const date = recorderSession.tradingDate || indiaTradingDate();
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="OptionPilot_${date}_Journal.txt"`);
  return c.body(buildJournalText());
});

app.get("/api/journal/html", (c) => {
  return c.html(buildJournalHtml());
});

app.get("/api/recorder/status", (c) => {
  const lastSnap = recorderSession.snapshots[recorderSession.snapshots.length - 1] || null;
  return c.json({
    tradingDate: recorderSession.tradingDate,
    status: recorderSession.status,
    startedAt: recorderSession.startedAt,
    lastSnapshotAt: recorderSession.lastSnapshotAt,
    lastSnapshotStatus: lastSnap ? lastSnap.snapshotStatus : null,
    snapshotCount: recorderSession.snapshots.length,
    lastErrorRedacted: recorderSession.lastErrorRedacted,
  });
});

app.get("/api/recorder/session.json", (c) => {
  return c.json(recorderSession);
});

app.get("/api/recorder/session.csv", (c) => {
  const rows = [
    "snapshot_id,backend_timestamp,reason,snapshot_status,symbol,spot,change,pdh,pdl,vwap,futures_ltp,futures_oi,atm_strike,ce_ltp,pe_ltp,ce_oi,pe_oi,exchange_timestamp,snapshot_sync_id,fii_cash_cr,dii_cash_cr",
  ];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  for (const snap of recorderSession.snapshots) {
    (["NIFTY", "BANKNIFTY", "SENSEX"] as const).forEach((sym) => {
      const idx = snap[sym];
      rows.push(
        [
          snap.snapshotId, snap.backendTimestamp, snap.reason, snap.snapshotStatus, sym,
          idx?.spot, idx?.change, idx?.pdh, idx?.pdl, idx?.vwap,
          idx?.futuresLtp, idx?.futuresOi, idx?.atmStrike,
          idx?.ceLtp, idx?.peLtp, idx?.ceOi, idx?.peOi,
          idx?.exchangeTimestamp, idx?.snapshotId,
          snap.fiiCashCr, snap.diiCashCr,
        ].map(esc).join(",")
      );
    });
  }
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="session-${recorderSession.tradingDate || "unknown"}.csv"`);
  return c.body(rows.join("\n"));
});

// ============== GOOGLE DRIVE ARCHIVE (Phase 1: JSON+CSV only) ==============
//
// Uses raw HTTPS calls to Google's OAuth2 and Drive REST API v3 directly
// (via fetch) rather than the googleapis npm package, since no
// package.json is available to this session to add a new dependency.
// PDF generation is deferred for the same reason — no PDF library is
// available yet.
//
// Refresh token is encrypted at rest (AES-256-GCM) using a key derived
// from GOOGLE_CLIENT_SECRET (the only long-lived secret this process has
// without a proper secrets manager) and kept in memory only — it does
// NOT survive a Railway restart, same disclosed limitation as the
// recorder/Kite session. This is Phase 1, not a permanent solution.
//
// Scope: drive.file only (files created by this app), never full Drive
// access.

const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";

interface DriveSession {
  accessToken: string | null;
  accessTokenExpiresAt: number; // ms epoch
  refreshTokenEncrypted: string | null; // "iv:authTag:ciphertext" hex
  connectedEmail: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

let driveSession: DriveSession = {
  accessToken: null,
  accessTokenExpiresAt: 0,
  refreshTokenEncrypted: null,
  connectedEmail: null,
  connectedAt: null,
  lastError: null,
};

interface DriveArchiveRecord {
  date: string;
  status: "VERIFIED" | "ARCHIVE_FAILED" | "PENDING";
  fileIds: Record<string, string>;
  verifiedAt: string | null;
  attempts: number;
  lastError: string | null;
}
const driveArchives: DriveArchiveRecord[] = [];

function getEncryptionKey() {
  const secret = process.env.GOOGLE_CLIENT_SECRET || "fallback-key-not-secure";
  return createHash("sha256").update(secret).digest(); // 32 bytes for AES-256
}

function encryptToken(plain: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertextHex = cipher.update(plain, "utf8", "hex") + cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + ciphertextHex;
}

function decryptToken(encrypted: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = encrypted.split(":");
    const key = getEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = decipher.update(dataHex, "hex", "utf8") + decipher.final("utf8");
    return plain;
  } catch {
    return null;
  }
}

function getRedirectUri(): string {
  return (process.env.GOOGLE_REDIRECT_URI as string) || "https://optionpilot-pro-v2-production.up.railway.app/api/drive/callback";
}

app.get("/api/drive/connect", (c) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: "GOOGLE_CLIENT_ID not configured" }, 500);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/drive/callback", async (c) => {
  const code = c.req.query("code");
  const errorParam = c.req.query("error");
  if (errorParam) {
    driveSession.lastError = `Google denied access: ${errorParam}`;
    return c.redirect("/?drive=denied");
  }
  if (!code) return c.json({ error: "Missing authorization code" }, 400);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: "Google credentials not configured on server" }, 500);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      driveSession.lastError = "Token exchange failed";
      return c.redirect("/?drive=error");
    }

    driveSession.accessToken = tokenJson.access_token;
    driveSession.accessTokenExpiresAt = Date.now() + (tokenJson.expires_in || 3600) * 1000;
    if (tokenJson.refresh_token) {
      driveSession.refreshTokenEncrypted = encryptToken(tokenJson.refresh_token);
    }
    driveSession.connectedAt = new Date().toISOString();
    driveSession.lastError = null;

    // Fetch connected account email (minimal profile read, not stored beyond display)
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        driveSession.connectedEmail = profile.email || null;
      }
    } catch {
      // non-fatal — email display is informational only
    }

    return c.redirect("/?drive=connected");
  } catch (err) {
    driveSession.lastError = err instanceof Error ? err.message : "Unknown OAuth error";
    return c.redirect("/?drive=error");
  }
});

async function getValidDriveAccessToken(): Promise<string | null> {
  if (driveSession.accessToken && Date.now() < driveSession.accessTokenExpiresAt - 60000) {
    return driveSession.accessToken;
  }
  if (!driveSession.refreshTokenEncrypted) return null;
  const refreshToken = decryptToken(driveSession.refreshTokenEncrypted);
  if (!refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) {
      driveSession.lastError = "Token refresh failed";
      return null;
    }
    driveSession.accessToken = json.access_token;
    driveSession.accessTokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
    return json.access_token;
  } catch (err) {
    driveSession.lastError = err instanceof Error ? err.message : "Token refresh error";
    return null;
  }
}

async function findOrCreateDriveFolder(name: string, parentId: string | null, token: string): Promise<string | null> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listJson = await listRes.json();
  if (listRes.ok && listJson.files && listJson.files.length > 0) return listJson.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok) return null;
  return createJson.id;
}

async function uploadFileToDrive(name: string, mimeType: string, content: string, parentId: string, token: string): Promise<{ id: string; size: number } | null> {
  const metadata = { name, parents: [parentId] };
  const boundary = "optionpilot_boundary_" + randomBytes(8).toString("hex");
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size,name,mimeType", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.id) return null;
  return { id: json.id, size: parseInt(json.size || "0", 10) };
}

app.get("/api/drive/status", (c) => {
  return c.json({
    connected: !!driveSession.refreshTokenEncrypted,
    connectedEmail: driveSession.connectedEmail,
    connectedAt: driveSession.connectedAt,
    lastError: driveSession.lastError,
    targetFolder: "OptionPilot Pro Journal/Year/Month/Trading Date",
    lastArchive: driveArchives.length > 0 ? driveArchives[driveArchives.length - 1] : null,
  });
});

app.post("/api/drive/test-upload", async (c) => {
  const token = await getValidDriveAccessToken();
  if (!token) return c.json({ error: "Google Drive not connected or token refresh failed" }, 400);

  const rootId = await findOrCreateDriveFolder("OptionPilot Pro Journal", null, token);
  if (!rootId) return c.json({ error: "Could not create/find root folder" }, 500);

  const testContent = JSON.stringify({ test: true, timestamp: new Date().toISOString() });
  const result = await uploadFileToDrive("OptionPilot_TestUpload.json", "application/json", testContent, rootId, token);
  if (!result) return c.json({ error: "Test upload failed" }, 500);

  return c.json({ success: true, fileId: result.id, sizeBytes: result.size });
});

app.post("/api/drive/archive", async (c) => {
  const token = await getValidDriveAccessToken();
  if (!token) return c.json({ error: "Google Drive not connected or token refresh failed" }, 400);

  const tradingDate = recorderSession.tradingDate || indiaTradingDate();
  const record: DriveArchiveRecord = { date: tradingDate, status: "PENDING", fileIds: {}, verifiedAt: null, attempts: 1, lastError: null };

  try {
    const [year, month] = tradingDate.split("-");
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthFolderName = `${month}-${monthNames[parseInt(month, 10) - 1]}`;

    const rootId = await findOrCreateDriveFolder("OptionPilot Pro Journal", null, token);
    if (!rootId) throw new Error("Could not create root folder");
    const yearId = await findOrCreateDriveFolder(year, rootId, token);
    if (!yearId) throw new Error("Could not create year folder");
    const monthId = await findOrCreateDriveFolder(monthFolderName, yearId, token);
    if (!monthId) throw new Error("Could not create month folder");
    const dateId = await findOrCreateDriveFolder(tradingDate, monthId, token);
    if (!dateId) throw new Error("Could not create date folder");

    const rawJson = JSON.stringify({ recorderSession, journalEntries }, null, 2);
    const rawResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_Raw.json`, "application/json", rawJson, dateId, token);
    if (!rawResult) throw new Error("Raw JSON upload failed");
    if (rawResult.size === 0) throw new Error("Raw JSON uploaded but file size is zero");
    record.fileIds.raw = rawResult.id;

    const journalTextResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_Journal.txt`, "text/plain", buildJournalText(), dateId, token);
    if (journalTextResult && journalTextResult.size > 0) record.fileIds.journalText = journalTextResult.id;

    const journalHtmlResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_Journal.html`, "text/html", buildJournalHtml(), dateId, token);
    if (journalHtmlResult && journalHtmlResult.size > 0) record.fileIds.journalHtml = journalHtmlResult.id;

    const csvRows = [
      "snapshot_id,backend_timestamp,reason,snapshot_status,symbol,spot,change,pdh,pdl,vwap,futures_ltp,futures_oi,atm_strike,ce_ltp,pe_ltp,ce_oi,pe_oi,exchange_timestamp,snapshot_sync_id,fii_cash_cr,dii_cash_cr",
    ];
    const esc = (v: unknown) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    for (const snap of recorderSession.snapshots) {
      (["NIFTY", "BANKNIFTY", "SENSEX"] as const).forEach((sym) => {
        const idx = snap[sym];
        csvRows.push(
          [
            snap.snapshotId, snap.backendTimestamp, snap.reason, snap.snapshotStatus, sym,
            idx?.spot, idx?.change, idx?.pdh, idx?.pdl, idx?.vwap,
            idx?.futuresLtp, idx?.futuresOi, idx?.atmStrike,
            idx?.ceLtp, idx?.peLtp, idx?.ceOi, idx?.peOi,
            idx?.exchangeTimestamp, idx?.snapshotId,
            snap.fiiCashCr, snap.diiCashCr,
          ].map(esc).join(",")
        );
      });
    }
    const csvResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_Data.csv`, "text/csv", csvRows.join("\n"), dateId, token);
    if (!csvResult) throw new Error("CSV upload failed");
    if (csvResult.size === 0) throw new Error("CSV uploaded but file size is zero");
    record.fileIds.csv = csvResult.id;

    const summary = {
      date: tradingDate,
      snapshotCount: recorderSession.snapshots.length,
      recorderStatus: recorderSession.status,
      archivedAt: new Date().toISOString(),
    };
    const summaryResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_Summary.json`, "application/json", JSON.stringify(summary, null, 2), dateId, token);
    if (!summaryResult) throw new Error("Summary JSON upload failed");
    record.fileIds.summary = summaryResult.id;

    // Verify: re-fetch metadata for each uploaded file and confirm non-zero size
    for (const [key, fileId] of Object.entries(record.fileIds)) {
      const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta = await metaRes.json();
      if (!metaRes.ok || !meta.id || parseInt(meta.size || "0", 10) === 0) {
        throw new Error(`Verification failed for ${key} (fileId ${fileId})`);
      }
    }

    const manifest = { date: tradingDate, fileIds: record.fileIds, verifiedAt: new Date().toISOString() };
    const manifestResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_ArchiveVerification.json`, "application/json", JSON.stringify(manifest, null, 2), dateId, token);
    if (manifestResult) record.fileIds.manifest = manifestResult.id;

    record.status = "VERIFIED";
    record.verifiedAt = new Date().toISOString();
    driveArchives.push(record);
    return c.json({ success: true, record });
  } catch (err) {
    record.status = "ARCHIVE_FAILED";
    record.lastError = err instanceof Error ? err.message : "Unknown archive error";
    driveArchives.push(record);
    return c.json({ success: false, error: record.lastError }, 500);
  }
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

    const [crudeoil, naturalgas, usdinr] = await Promise.all([
      fetchCommodityData(session.accessToken, instruments, "CRUDEOIL"),
      fetchCommodityData(session.accessToken, instruments, "NATURALGAS"),
      fetchUsdInrData(session.accessToken, instruments),
    ]);

    return c.json({ CRUDEOIL: crudeoil, NATURALGAS: naturalgas, USDINR: usdinr, timestamp: new Date().toISOString() });
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
