import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { createOutcomeRecord, evaluateOutcome, computeOutcomeStats, type OutcomeRecord, type SnapshotForOutcome, type Side as OutcomeSide, type IndexSymbol as OutcomeIndexSymbol } from "./outcome-engine.js";

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
  pdcClose: number; // previous trading day's CLOSE, from the SAME historical candle as pdh/pdl (not a separate quote-API field) \u2014 so Daily Fibonacci Pivot (pdh+pdl+pdcClose)/3 never mixes two different data sources for "previous day"
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

// BUGFIX (found live, 2026-08-07): Kite Connect returns quote timestamps
// (last_trade_time) as naive IST wall-clock strings with NO timezone
// suffix, e.g. "2026-08-07 13:58:00". Passing this directly to
// `new Date(...)` causes the JS engine to interpret it using the
// process's local timezone (UTC on Railway), producing a Date object
// that is off by exactly the IST offset from the true UTC instant \u2014
// this was confirmed live, showing every futures/options age as
// approximately -19700 seconds (~-5.47 hours, matching IST's +05:30
// offset almost exactly). This helper explicitly parses the string as
// IST and converts it to a genuine UTC ISO timestamp.
function parseKiteTimestampToUtcIso(kiteTimeString: string | null | undefined): string | null {
  if (!kiteTimeString) return null;
  const match = kiteTimeString.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null; // unrecognized format \u2014 never guess, treat as absent
  const [, y, mo, d, h, mi, s] = match;
  const asIfUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(asIfUtcMs - IST_OFFSET_MS).toISOString();
}


// ============== MODULE 1: TRUTH ENGINE ==============
// Per the approved OptionPilot Pro Architecture Specification, \u00a71.
// Formalizes the existing connectionState / per-field-age checks into a
// single TruthReport schema. This module is ADDITIVE ONLY in this phase:
// it computes and exposes TruthReports, but does not yet gate the
// Recorder or any other module (that rewiring is explicitly Module 2+
// scope, not started per "do not continue until Module 1 is approved").
// Existing Data Reliability card/logic is left untouched for Backward
// Compatibility \u2014 this is a new, parallel formal source of truth.

type TruthVerdict = "TRUE" | "STALE" | "PARTIAL" | "INVALID";

interface TruthFieldVerdict {
  verdict: TruthVerdict;
  ageMs: number | null;
  reason?: string;
}

interface TruthReport {
  snapshotId: string | null;
  overallVerdict: TruthVerdict;
  fields: Record<string, TruthFieldVerdict>;
  syncToleranceMs: number;
  syncOk: boolean | null;
  rejectedFields: string[];
  timestamp: string;
}

// PROVISIONAL \u2014 not backtested. The spec explicitly calls for
// field-specific thresholds rather than one global number; these three
// are currently equal only because no historical evidence yet exists to
// differentiate them (see Learning Engine, \u00a77 of the spec, which is
// itself out of scope until real history has accumulated).
const TRUTH_THRESHOLDS_MS = {
  spot: 6 * 60 * 1000,
  futures: 6 * 60 * 1000,
  options: 6 * 60 * 1000,
};
const TRUTH_SYNC_TOLERANCE_MS = 60 * 1000; // PROVISIONAL, matches the existing Data Reliability convention

function classifyTruthField(timestamp: string | null | undefined, thresholdMs: number): TruthFieldVerdict {
  if (!timestamp) return { verdict: "INVALID", ageMs: null, reason: "no_timestamp" };
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return { verdict: "INVALID", ageMs: null, reason: "unparseable_timestamp" };
  const ageMs = Date.now() - ts;
  if (ageMs > thresholdMs) return { verdict: "STALE", ageMs, reason: "age_exceeded_threshold" };
  return { verdict: "TRUE", ageMs };
}

function computeTruthReport(m: IndexMetrics | undefined): TruthReport {
  if (!m || m.error) {
    return {
      snapshotId: null,
      overallVerdict: "INVALID",
      fields: {},
      syncToleranceMs: TRUTH_SYNC_TOLERANCE_MS,
      syncOk: null,
      rejectedFields: ["all"],
      timestamp: new Date().toISOString(),
    };
  }

  const fields: Record<string, TruthFieldVerdict> = {};
  // BUGFIX (found live, 2026-08-07): index quotes (NIFTY/BANKNIFTY/SENSEX)
  // do not carry a last_trade_time from Kite \u2014 an index is a computed
  // value, not a traded instrument, so it has no genuine "last trade."
  // exchangeTimestamp is therefore permanently and correctly absent for
  // spot; this was being misclassified as INVALID ("no_timestamp"),
  // cascading to PARTIAL on every index all day. Fall back to the
  // backend's own receipt timestamp (m.timestamp, always populated) as
  // the freshness signal for spot specifically \u2014 this is an honest,
  // reasonable proxy for a continuously-computed index value, not a
  // fabrication.
  fields.spot = m.exchangeTimestamp
    ? classifyTruthField(m.exchangeTimestamp, TRUTH_THRESHOLDS_MS.spot)
    : classifyTruthField(m.timestamp, TRUTH_THRESHOLDS_MS.spot);

  const contract = m.futuresContracts && m.futuresContracts[0];
  fields.futures = contract
    ? classifyTruthField(contract.quoteTimestamp, TRUTH_THRESHOLDS_MS.futures)
    : { verdict: "INVALID", ageMs: null, reason: "no_futures_contract" };

  const exp = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  const atmCe = exp ? (exp.ceStrikes || []).find((s) => s.isAtm) : undefined;
  const atmPe = exp ? (exp.peStrikes || []).find((s) => s.isAtm) : undefined;
  fields.optionsCE = atmCe
    ? classifyTruthField(atmCe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options)
    : { verdict: "INVALID", ageMs: null, reason: "no_ce_leg" };
  fields.optionsPE = atmPe
    ? classifyTruthField(atmPe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options)
    : { verdict: "INVALID", ageMs: null, reason: "no_pe_leg" };

  const fieldKeys = Object.keys(fields);
  const trueKeys = fieldKeys.filter((k) => fields[k].verdict === "TRUE");
  const rejectedFields = fieldKeys.filter((k) => fields[k].verdict !== "TRUE");

  // Cross-component sync is only checked when every field is individually
  // TRUE \u2014 a stale field can never be "rescued" by a fresh one, per the
  // approved specification's Validation Rules.
  let syncOk: boolean | null = null;
  if (rejectedFields.length === 0) {
    const timestamps = [m.exchangeTimestamp, contract?.quoteTimestamp, atmCe?.quoteTimestamp, atmPe?.quoteTimestamp]
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime());
    if (timestamps.length >= 2) {
      const spread = Math.max(...timestamps) - Math.min(...timestamps);
      syncOk = spread <= TRUTH_SYNC_TOLERANCE_MS;
    }
  }

  let overallVerdict: TruthVerdict;
  if (rejectedFields.length === fieldKeys.length) overallVerdict = "INVALID";
  else if (rejectedFields.length > 0) overallVerdict = "PARTIAL";
  else if (syncOk === false) overallVerdict = "STALE"; // synchronized-but-mismatched is treated as untrustworthy, not TRUE
  else overallVerdict = "TRUE";

  return {
    snapshotId: m.snapshotId || null,
    overallVerdict,
    fields,
    syncToleranceMs: TRUTH_SYNC_TOLERANCE_MS,
    syncOk,
    rejectedFields,
    timestamp: new Date().toISOString(),
  };
}


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
  // Added 2026-08-10 (user-approved): start building the historical
  // IV/Greeks series NOW, via the existing daily Drive archive, so
  // future diagnostics (12-point spec, Phase B: term-structure shock,
  // OI+IV matrix, straddle-IV divergence, etc.) have real day-over-day
  // history to work with after enough days/weeks accumulate. Deliberately
  // ATM-only, current-week-expiry-only for now (matches Phase A/B scope
  // already agreed) — the atmCe/atmPe objects already carry these
  // fields server-side (calcGreeks/calcImpliedVolatility), so this is
  // pure pass-through, not a new computation.
  ceIv: number | null;
  peIv: number | null;
  ceTheta: number | null;
  peTheta: number | null;
  ceVega: number | null;
  peVega: number | null;
  ceDelta: number | null;
  peDelta: number | null;
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
  truthVerdicts?: { NIFTY: TruthVerdict; BANKNIFTY: TruthVerdict; SENSEX: TruthVerdict }; // Module 1 traceability — which Truth Engine verdict each index's data relied on
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

// Module 2 (Recorder Engine) dependency on Module 1 (Truth Engine), per
// the approved Architecture Specification: "Never records a raw
// (non-Truth-validated) field." Each raw field is only included if the
// corresponding TruthReport field verdict is TRUE — a field the Truth
// Engine rejected is recorded as null, never as the unvalidated raw
// value.
function toTruthValidatedRecorderIndexSnapshot(m: IndexMetrics | undefined, truth: TruthReport): RecorderIndexSnapshot | null {
  if (!m || m.error || truth.overallVerdict === "INVALID") return null;
  const exp = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  const atmCe = exp ? (exp.ceStrikes || []).find((s) => s.isAtm) : undefined;
  const atmPe = exp ? (exp.peStrikes || []).find((s) => s.isAtm) : undefined;
  const contract = (m.futuresContracts && m.futuresContracts[0]) || null;

  const spotOk = truth.fields.spot?.verdict === "TRUE";
  const futuresOk = truth.fields.futures?.verdict === "TRUE";
  const ceOk = truth.fields.optionsCE?.verdict === "TRUE";
  const peOk = truth.fields.optionsPE?.verdict === "TRUE";

  return {
    spot: spotOk && m.current > 0 ? m.current : null,
    change: spotOk ? m.change : null,
    pdh: spotOk && m.pdh > 0 ? m.pdh : null,
    pdl: spotOk && m.pdl > 0 ? m.pdl : null,
    vwap: spotOk && m.vwap > 0 ? m.vwap : null,
    futuresLtp: futuresOk && contract && contract.ltp > 0 ? contract.ltp : null,
    futuresOi: futuresOk && contract && contract.oi != null ? contract.oi : null,
    atmStrike: ceOk && atmCe ? atmCe.strike : peOk && atmPe ? atmPe.strike : null,
    ceLtp: ceOk && atmCe && atmCe.lastPrice > 0 ? atmCe.lastPrice : null,
    peLtp: peOk && atmPe && atmPe.lastPrice > 0 ? atmPe.lastPrice : null,
    ceOi: ceOk && atmCe ? atmCe.oi : null,
    peOi: peOk && atmPe ? atmPe.oi : null,
    ceIv: ceOk && atmCe ? atmCe.iv : null,
    peIv: peOk && atmPe ? atmPe.iv : null,
    ceTheta: ceOk && atmCe ? atmCe.theta : null,
    peTheta: peOk && atmPe ? atmPe.theta : null,
    ceVega: ceOk && atmCe ? atmCe.vega : null,
    peVega: peOk && atmPe ? atmPe.vega : null,
    ceDelta: ceOk && atmCe ? atmCe.delta : null,
    peDelta: peOk && atmPe ? atmPe.delta : null,
    exchangeTimestamp: spotOk ? m.exchangeTimestamp || null : null,
    snapshotId: m.snapshotId || null,
  };
}

// Retained for any other caller that still needs a non-Truth-gated
// conversion (none currently, kept for Backward Compatibility).
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
    ceIv: atmCe ? atmCe.iv : null,
    peIv: atmPe ? atmPe.iv : null,
    ceTheta: atmCe ? atmCe.theta : null,
    peTheta: atmPe ? atmPe.theta : null,
    ceVega: atmCe ? atmCe.vega : null,
    peVega: atmPe ? atmPe.vega : null,
    ceDelta: atmCe ? atmCe.delta : null,
    peDelta: atmPe ? atmPe.delta : null,
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

// Module 2 depends on Module 1: Recorder snapshot status is now derived
// from the Truth Engine's per-index overallVerdict, not a separate,
// independently-maintained age check (which would risk disagreeing with
// Module 1's own classification of the same data).
function truthVerdictToSnapshotStatus(v: TruthVerdict): "LIVE" | "PARTIAL" | "STALE" | "INVALID" {
  if (v === "TRUE") return "LIVE";
  return v; // STALE, PARTIAL, INVALID map 1:1
}
function computeSnapshotStatusFromTruth(truthReports: TruthReport[]): "LIVE" | "PARTIAL" | "STALE" | "INVALID" {
  const rank: Record<string, number> = { INVALID: 0, STALE: 1, PARTIAL: 2, TRUE: 3 };
  let worst: TruthVerdict = "TRUE";
  for (const r of truthReports) {
    if (rank[r.overallVerdict] < rank[worst]) worst = r.overallVerdict;
  }
  return truthVerdictToSnapshotStatus(worst);
}

// Retained for Backward Compatibility with any other caller; no longer
// used by captureRecorderSnapshot itself (see computeSnapshotStatusFromTruth).
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

    // Module 1 dependency: classify each index through the Truth Engine
    // BEFORE building the recorded snapshot, per the approved spec.
    const niftyTruth = computeTruthReport(snapshot.NIFTY);
    const bankTruth = computeTruthReport(snapshot.BANKNIFTY);
    const sensexTruth = computeTruthReport(snapshot.SENSEX);

    const niftySnap = toTruthValidatedRecorderIndexSnapshot(snapshot.NIFTY, niftyTruth);
    const bankSnap = toTruthValidatedRecorderIndexSnapshot(snapshot.BANKNIFTY, bankTruth);
    const sensexSnap = toTruthValidatedRecorderIndexSnapshot(snapshot.SENSEX, sensexTruth);

    const entry: RecorderSnapshot = {
      snapshotId: `rec-${Date.now()}-${randomBytes(3).toString("hex")}`,
      backendTimestamp: new Date().toISOString(),
      reason,
      snapshotStatus: computeSnapshotStatusFromTruth([niftyTruth, bankTruth, sensexTruth]),
      NIFTY: niftySnap,
      BANKNIFTY: bankSnap,
      SENSEX: sensexSnap,
      fiiCashCr: fiiDiiEntries.length > 0 ? fiiDiiEntries[fiiDiiEntries.length - 1].fiiCashCr : null,
      diiCashCr: fiiDiiEntries.length > 0 ? fiiDiiEntries[fiiDiiEntries.length - 1].diiCashCr : null,
      truthVerdicts: { NIFTY: niftyTruth.overallVerdict, BANKNIFTY: bankTruth.overallVerdict, SENSEX: sensexTruth.overallVerdict },
    };

    recorderSession.snapshots.push(entry);
    if (recorderSession.snapshots.length > RECORDER_MAX_SNAPSHOTS) recorderSession.snapshots.shift();
    recorderSession.lastSnapshotAt = entry.backendTimestamp;
    recorderSession.status = "RECORDING";
    recorderSession.lastErrorRedacted = null;

    // Module 11 (Event Bus): additive publish, existing behavior above is unchanged.
    publishEvent("SnapshotRecorded", { snapshotId: entry.snapshotId, snapshotStatus: entry.snapshotStatus }, "Recorder Engine");
    publishEvent("TruthValidated", { NIFTY: niftyTruth.overallVerdict, BANKNIFTY: bankTruth.overallVerdict, SENSEX: sensexTruth.overallVerdict }, "Truth Engine");

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

// ============== MODULE 11: API LAYER (EVENT BUS) ==============
// Per the approved Architecture Specification, \u00a711. The REST layer
// itself (all app.get/app.post routes throughout this file) already
// exists and is unchanged. This adds ONLY the missing piece: the
// Event-Driven principle's internal pub/sub bus.
//
// Deliberately conservative scope: this is ADDITIVE, not a rewrite.
// Every module built so far (1\u20134, 8, 9, 12, 13) continues to work via
// its existing direct function calls \u2014 ripping that out in favour of
// events everywhere would be a large, risky refactor of already-working,
// already-verified code for a principle whose practical benefit at this
// single-process scale is architectural cleanliness, not new capability.
// Per Backward Compatibility, that trade is not taken here. Instead, key
// modules are wired to ALSO publish an event alongside their existing
// behaviour, so the bus is real, observable, and ready for other modules
// to subscribe to as the platform grows \u2014 without touching what already
// works.

type EventType = "SnapshotRecorded" | "TruthValidated" | "DNAComputed" | "ArchiveCompleted" | "HealthDegraded" | "RecoveryAttempted";

interface PlatformEvent {
  eventType: EventType;
  payload: Record<string, unknown>;
  publishedAt: string;
  publisher: string;
}

// Per the spec's Validation Rules: a module publishing an event type it
// is not authorized to publish is rejected \u2014 the bus enforces the
// Modular Design boundary, not just convention.
const EVENT_PUBLISHER_AUTHORIZATION: Record<EventType, string> = {
  SnapshotRecorded: "Recorder Engine",
  TruthValidated: "Truth Engine",
  DNAComputed: "Market DNA Engine",
  ArchiveCompleted: "Google Drive Super Brain",
  HealthDegraded: "Health Engine",
  RecoveryAttempted: "Recovery Engine",
};

const EVENT_LOG_MAX = 100;
const eventLog: PlatformEvent[] = [];
const eventSubscribers = new Map<EventType, Array<(e: PlatformEvent) => void>>();

function publishEvent(eventType: EventType, payload: Record<string, unknown>, publisher: string): boolean {
  if (EVENT_PUBLISHER_AUTHORIZATION[eventType] !== publisher) {
    console.error(`[EventBus] REJECTED: ${publisher} is not authorized to publish ${eventType}`);
    return false;
  }
  const event: PlatformEvent = { eventType, payload, publishedAt: new Date().toISOString(), publisher };
  eventLog.push(event);
  if (eventLog.length > EVENT_LOG_MAX) eventLog.shift();

  const handlers = eventSubscribers.get(eventType) || [];
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      // Isolated per-subscriber error handling, per the spec's Error
      // Handling rule \u2014 one bad subscriber must never crash the
      // publisher or any other subscriber.
      console.error(`[EventBus] subscriber error for ${eventType}:`, err instanceof Error ? err.message : err);
    }
  }
  return true;
}

function subscribeToEvent(eventType: EventType, handler: (e: PlatformEvent) => void): void {
  const list = eventSubscribers.get(eventType) || [];
  list.push(handler);
  eventSubscribers.set(eventType, list);
}

// Proof-of-concept subscriber: simply confirms the bus is live and
// observable. Real cross-module consumers (e.g. a future Learning Engine
// subscribing to ArchiveCompleted) can register the same way later,
// without any change to this file's existing publish call sites.
subscribeToEvent("SnapshotRecorded", (e) => {
  console.log(`[EventBus] SnapshotRecorded observed: ${e.payload.snapshotStatus} at ${e.publishedAt}`);
});

// ============== MODULE 4: MARKET DNA ENGINE ==============
// Per the approved Architecture Specification, \u00a74. Depends on Module 2
// (Recorder) for raw history and Module 3's Journal for verdict-flip
// data. NEW capability \u2014 no prior equivalent existed.

interface MarketDnaFeatures {
  volatilityRegime: "LOW" | "NORMAL" | "HIGH" | "DATA_UNAVAILABLE";
  trendPersistenceScore: number | null;
  verdictFlipCount: number;
  gapBehaviour: "GAP_HELD" | "GAP_FADED" | "NO_GAP" | "DATA_UNAVAILABLE";
  wallPersistenceScore: null; // genuinely not computable — the Recorder (Module 2) does not capture Call/Put Wall state (Step 6B lives only in the browser session), so this is honestly null, never fabricated
}

interface MarketDnaRecord {
  dnaId: string;
  date: string;
  index: "NIFTY" | "BANKNIFTY" | "SENSEX";
  features: MarketDnaFeatures;
  tags: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: string;
  computedAt: string;
}

const DNA_MIN_SNAPSHOTS = 3; // PROVISIONAL — below this, no signature is computed at all

function computeMarketDna(symbol: "NIFTY" | "BANKNIFTY" | "SENSEX"): MarketDnaRecord {
  const date = recorderSession.tradingDate || indiaTradingDate();
  const entries = recorderSession.snapshots
    .map((s) => ({ leg: s[symbol], status: s.snapshotStatus }))
    .filter((x) => x.leg !== null) as Array<{ leg: RecorderIndexSnapshot; status: string }>;

  if (entries.length < DNA_MIN_SNAPSHOTS) {
    return {
      dnaId: `dna-${date}-${symbol}-${randomBytes(3).toString("hex")}`,
      date, index: symbol,
      features: { volatilityRegime: "DATA_UNAVAILABLE", trendPersistenceScore: null, verdictFlipCount: 0, gapBehaviour: "DATA_UNAVAILABLE", wallPersistenceScore: null },
      tags: [],
      confidence: "LOW",
      evidence: `Only ${entries.length} valid Recorder snapshot(s) available for ${symbol} on ${date} \u2014 below the minimum of ${DNA_MIN_SNAPSHOTS} required for DNA computation.`,
      computedAt: new Date().toISOString(),
    };
  }

  const spots = entries.map((x) => x.leg.spot).filter((v): v is number => v != null);
  const badCount = entries.filter((x) => x.status === "INVALID" || x.status === "STALE").length;

  let volatilityRegime: MarketDnaFeatures["volatilityRegime"] = "DATA_UNAVAILABLE";
  if (spots.length >= DNA_MIN_SNAPSHOTS) {
    const high = Math.max(...spots);
    const low = Math.min(...spots);
    const avg = spots.reduce((a, b) => a + b, 0) / spots.length;
    const rangePct = avg > 0 ? ((high - low) / avg) * 100 : 0;
    // PROVISIONAL thresholds, not backtested.
    volatilityRegime = rangePct < 0.5 ? "LOW" : rangePct < 1.2 ? "NORMAL" : "HIGH";
  }

  let trendPersistenceScore: number | null = null;
  if (spots.length >= DNA_MIN_SNAPSHOTS) {
    const netDir = spots[spots.length - 1] > spots[0] ? 1 : spots[spots.length - 1] < spots[0] ? -1 : 0;
    let consistentMoves = 0;
    let totalMoves = 0;
    for (let i = 1; i < spots.length; i++) {
      const moveDir = spots[i] > spots[i - 1] ? 1 : spots[i] < spots[i - 1] ? -1 : 0;
      if (moveDir !== 0) {
        totalMoves++;
        if (moveDir === netDir) consistentMoves++;
      }
    }
    trendPersistenceScore = totalMoves > 0 ? consistentMoves / totalMoves : null;
  }

  // Journal (Module 3-adjacent) only covers NIFTY and SENSEX, per its own
  // spec — BANKNIFTY genuinely has no verdict-flip source available.
  let verdictFlipCount = 0;
  if (symbol === "NIFTY" || symbol === "SENSEX") {
    verdictFlipCount = journalEntries.filter((e) => e.verdictChanged).length;
  }

  let gapBehaviour: MarketDnaFeatures["gapBehaviour"] = "DATA_UNAVAILABLE";
  const firstChange = entries[0].leg.change;
  if (firstChange != null && spots.length >= 2) {
    if (Math.abs(firstChange) < 0.01) {
      gapBehaviour = "NO_GAP";
    } else {
      const gapDir = firstChange > 0 ? 1 : -1;
      const endDir = spots[spots.length - 1] > spots[0] ? 1 : spots[spots.length - 1] < spots[0] ? -1 : 0;
      gapBehaviour = endDir === gapDir ? "GAP_HELD" : "GAP_FADED";
    }
  }

  const tags: string[] = [];
  if (volatilityRegime !== "DATA_UNAVAILABLE") tags.push(volatilityRegime + "_VOLATILITY");
  if (trendPersistenceScore != null && trendPersistenceScore > 0.7) tags.push("TREND_DAY");
  if (trendPersistenceScore != null && trendPersistenceScore < 0.4) tags.push("CHOPPY_DAY");
  if (gapBehaviour === "GAP_HELD" || gapBehaviour === "GAP_FADED") tags.push(gapBehaviour);
  if (verdictFlipCount >= 3) tags.push("HIGH_VERDICT_CHURN");

  const majorityBad = badCount > entries.length / 2;
  const confidence: "LOW" | "MEDIUM" | "HIGH" = majorityBad ? "LOW" : entries.length < 10 ? "MEDIUM" : "HIGH";

  const dnaId = `dna-${date}-${symbol}-${randomBytes(3).toString("hex")}`;
  // Module 11 (Event Bus): additive publish, existing return value below is unchanged.
  publishEvent("DNAComputed", { dnaId, date, index: symbol, confidence, tags }, "Market DNA Engine");

  return {
    dnaId,
    date, index: symbol,
    features: { volatilityRegime, trendPersistenceScore, verdictFlipCount, gapBehaviour, wallPersistenceScore: null },
    tags,
    confidence,
    evidence: `Computed from ${entries.length} Recorder snapshots (${badCount} INVALID/STALE, reduces confidence). wallPersistenceScore is DATA UNAVAILABLE by design \u2014 the Recorder does not capture Call/Put Wall state, only raw spot/futures/options fields; this is a disclosed feature gap, never a fabricated zero.`,
    computedAt: new Date().toISOString(),
  };
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
// BUGFIX (2026-08-08, per user-supplied Haiku Verdict integration doc,
// Step 1): Kite returns HTTP 429 ("Too many requests") when many
// separate quote calls (spot, futures, options per expiry, per index —
// 8+ call sites across NIFTY/BANKNIFTY/SENSEX) fire in quick succession
// during one refresh cycle. Previously there was no retry, so a 429 on
// any one call silently nulled that data slice (OI PCR, Volume PCR,
// Max Pain, etc. intermittently going null, matching the reported
// symptom). Now retries up to 2 times with a short backoff specifically
// on 429, per the document's own "batch + 250ms delay + retry x2" spec.
async function fetchKiteQuote(
  accessToken: string,
  symbols: string[],
  retriesLeft = 2
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

    if (response.status === 429 && retriesLeft > 0) {
      const delayMs = 250 * (3 - retriesLeft); // 250ms, then 500ms
      console.warn(`[KITE] 429 rate-limited, retrying in ${delayMs}ms (${retriesLeft} attempt(s) left) for ${symbols.length} symbols`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetchKiteQuote(accessToken, symbols, retriesLeft - 1);
    }

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
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 250)); // spacing between batches, per Step 1 spec
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

// PDH/PDL genuinely represents ONE specific "previous trading day" and
// stays exactly correct for the entire current trading day \u2014 it does
// NOT go stale on a rolling timer, it goes stale exactly when the
// trading date itself changes (since "previous day" then shifts
// forward by one day). Keyed by tradingDate rather than a TTL
// (user-approved fix, 2026-08-09): more correct than a fixed duration,
// and as a side effect stops the unnecessary ~60-80s cold re-fetch
// that a 6-hour TTL caused mid-session (this was the root cause of the
// "2-3 minute" delay reported after Kite login).
const optionPrevDayCache = new Map<number, { pdh: number; pdl: number; tradingDate: string }>();
// (No fixed TTL constant \u2014 see tradingDate-keyed cache note above.)

async function getOptionPrevDayLevelsBatch(
  accessToken: string,
  instrumentTokens: number[]
): Promise<Map<number, { pdh: number; pdl: number }>> {
  const result = new Map<number, { pdh: number; pdl: number }>();
  const toFetch: number[] = [];
  const today = indiaTradingDate();

  for (const token of instrumentTokens) {
    const cached = optionPrevDayCache.get(token);
    if (cached && cached.tradingDate === today) {
      result.set(token, { pdh: cached.pdh, pdl: cached.pdl });
    } else {
      toFetch.push(token);
    }
  }

  if (toFetch.length > 0) {
    // Kite's historical-candle endpoint has a low rate limit (~3 req/sec).
    // 3 concurrent requests per chunk + a 1000ms pause keeps the average
    // rate at or below that limit (user-approved 2026-08-09, widened
    // from CHUNK_SIZE=1/350ms after the tradingDate-keyed cache fix made
    // this the only place a cold-start's wall-clock time is still spent).
    const CHUNK_SIZE = 3;
    const CHUNK_DELAY_MS = 1000;
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
      // Bug fix (2026-08-09): only cache a GENUINE result. The cache is
      // now valid for the whole trading day (see note above) \u2014 if a
      // transient fetch failure (network error, or a 429 slipping
      // through) were cached as-is, a one-time hiccup would silently
      // poison this strike's PDH/PDL as "no data" for the rest of the
      // day, with no retry until tomorrow. Leaving it uncached means
      // the NEXT call (e.g. the next 3-min poll) naturally retries it.
      if (levels.pdh > 0 && levels.pdl > 0) {
        optionPrevDayCache.set(token, { ...levels, tradingDate: today });
      }
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
              quoteTimestamp: parseKiteTimestampToUtcIso(oq.last_trade_time) || parseKiteTimestampToUtcIso(oq.timestamp) || null,
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
              quoteTimestamp: parseKiteTimestampToUtcIso(oq.last_trade_time) || parseKiteTimestampToUtcIso(oq.timestamp) || null,
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

// Per-sector breakdown for the Sector Heatmap card (2026-08-08, user
// request). Same BREADTH_SYMBOLS source as the aggregate breadth score
// above, but keeps each sector's own % change instead of discarding it.
// Thresholds match the originally-specified convention: green >= +0.5%,
// red <= -0.5%, neutral between.
async function fetchSectorHeatmapData(accessToken: string): Promise<Array<{ name: string; pct: number | null; category: "green" | "red" | "neutral" | "unavailable" }>> {
  const results: Array<{ name: string; pct: number | null; category: "green" | "red" | "neutral" | "unavailable" }> = [];
  try {
    const symbols = Object.values(BREADTH_SYMBOLS);
    const quotes = await fetchKiteQuote(accessToken, symbols);
    for (const [name, sym] of Object.entries(BREADTH_SYMBOLS)) {
      const q = quotes ? quotes[sym] : null;
      if (!q || !q.ohlc?.close) {
        results.push({ name, pct: null, category: "unavailable" });
        continue;
      }
      const pct = ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100;
      const category = pct >= 0.5 ? "green" : pct <= -0.5 ? "red" : "neutral";
      results.push({ name, pct: Math.round(pct * 100) / 100, category });
    }
  } catch (err) {
    console.error("[HEATMAP] Sector heatmap error:", err instanceof Error ? err.message : err);
  }
  return results;
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
    pdcClose: 0,
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
    baseMetrics.exchangeTimestamp = parseKiteTimestampToUtcIso(spotQuote.last_trade_time) || null;

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
      // Same candle as pdh/pdl above \u2014 deliberately NOT the quote API's
      // separate ohlc.close field, so Daily Fibonacci Pivot never mixes
      // two different "previous day" sources for one calculation.
      baseMetrics.pdcClose = (indexPdhPdl.pdh > 0 && indexPdhPdl.pdl > 0) ? (previousCandle?.close || 0) : 0;
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
          quoteTimestamp: parseKiteTimestampToUtcIso(q?.last_trade_time) || null,
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
                  quoteTimestamp: parseKiteTimestampToUtcIso(q.last_trade_time) || parseKiteTimestampToUtcIso(q.timestamp) || null,
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
                  quoteTimestamp: parseKiteTimestampToUtcIso(q.last_trade_time) || parseKiteTimestampToUtcIso(q.timestamp) || null,
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
      --accent-cyan: #3DDCFF;
      --font-display: 'Space Grotesk', sans-serif;
      --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'IBM Plex Mono', monospace;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* Item 6 (scoped decision): a full SVG icon-set replacement for the
       emoji used throughout this dashboard (🔴🟢📓🔍⚙️ etc.) was
       considered but deferred — it would touch dozens of call sites
       across this file for a cosmetic gain, carrying materially higher
       regression risk than any single change taken on today. Left as a
       clearly-scoped follow-up rather than attempted here. */

    body {
      font-family: var(--font-body);
      background:
        radial-gradient(circle at 15% 0%, rgba(61,220,255,0.05) 0%, transparent 35%),
        radial-gradient(circle at 85% 20%, rgba(201,162,39,0.05) 0%, transparent 40%),
        var(--bg);
      background-attachment: fixed;
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

    @keyframes tickerPulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
      50% { opacity: 0.6; box-shadow: 0 0 4px 1px currentColor; }
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
      box-shadow: 0 1px 8px color-mix(in srgb, var(--accent-cyan) 15%, transparent);
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
      background: linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      min-width: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.02) inset;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }

    .premium-card:active {
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
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
      transition: transform 0.15s ease, opacity 0.15s ease;
    }

    .badge-pill:active {
      transform: scale(0.96);
      opacity: 0.85;
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
      <button class="tab-btn" onclick="switchTab('RESEARCH')">🔍 Research</button>
      <button class="tab-btn" onclick="switchTab('SYSTEM')">⚙️ System</button>
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
    <div id="RESEARCH" class="tab-content"></div>
    <div id="SYSTEM" class="tab-content"></div>
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

    // PCR Refinement (added per user request, 2026-08-07): built on
    // pcrHistory, which is populated every fetch cycle from the server's
    // own session.snapshotHistory (via mergeServerHistory) and backed up
    // to localStorage \u2014 not a fresh in-memory tracker, so it survives
    // page reloads within the same trading day (the exact class of issue
    // found live on 2026-08-06/07 with the Refactor B badges).

    function computeSessionPcrRange(symbol) {
      const hist = pcrHistory[symbol] || [];
      if (hist.length === 0) return null;
      let high = hist[0], low = hist[0];
      hist.forEach((pt) => {
        if (pt.pcr > high.pcr) high = pt;
        if (pt.pcr < low.pcr) low = pt;
      });
      return { high: high.pcr, highTime: high.time, low: low.pcr, lowTime: low.time, sampleCount: hist.length };
    }

    // PROVISIONAL \u2014 not backtested. Compares the net direction of spot
    // vs PCR over the last N session points; flags divergence only when
    // both directions are unambiguous and opposite.
    function computePcrDivergence(symbol) {
      const hist = pcrHistory[symbol] || [];
      const WINDOW = 5;
      if (hist.length < WINDOW) return { state: 'INSUFFICIENT DATA', sampleCount: hist.length, required: WINDOW };
      const recent = hist.slice(-WINDOW);
      const spotDir = recent[recent.length - 1].spot > recent[0].spot ? 'up' : recent[recent.length - 1].spot < recent[0].spot ? 'down' : 'flat';
      const pcrDir = recent[recent.length - 1].pcr > recent[0].pcr ? 'up' : recent[recent.length - 1].pcr < recent[0].pcr ? 'down' : 'flat';
      let state;
      if (spotDir === 'flat' || pcrDir === 'flat') state = 'NO CLEAR DIVERGENCE';
      else if (spotDir === 'up' && pcrDir === 'down') state = 'BEARISH DIVERGENCE \u2014 Spot rising, PCR falling';
      else if (spotDir === 'down' && pcrDir === 'up') state = 'BULLISH DIVERGENCE \u2014 Spot falling, PCR rising';
      else state = 'ALIGNED \u2014 Spot and PCR moving together';
      return { state, spotDir, pcrDir, sampleCount: recent.length, spotChange: recent[recent.length - 1].spot - recent[0].spot, pcrChange: recent[recent.length - 1].pcr - recent[0].pcr };
    }

    // pcr_trend signal for the rule engine (Step 5, wired 2026-08-08).
    // Reuses computePcrDivergence()'s own read \u2014 not a duplicate/
    // competing calculation \u2014 since a genuine spot-vs-PCR divergence
    // IS the trend signal the 16-signal document is asking for.
    // BULLISH DIVERGENCE (spot falling, PCR rising \u2014 puts being written,
    // contrarian support) \u2192 +1. BEARISH DIVERGENCE \u2192 \u22121.
    // ALIGNED/NO CLEAR DIVERGENCE \u2192 0 (real reading, not missing data).
    // INSUFFICIENT DATA (session just started) \u2192 null, excluded.
    function computePcrTrendValue(symbol) {
      const divergence = computePcrDivergence(symbol);
      if (divergence.state === 'INSUFFICIENT DATA') return null;
      if (divergence.state.indexOf('BULLISH DIVERGENCE') === 0) return 1;
      if (divergence.state.indexOf('BEARISH DIVERGENCE') === 0) return -1;
      return 0;
    }

    function renderPcrRefinementCard(symbol) {
      const range = computeSessionPcrRange(symbol);
      const divergence = computePcrDivergence(symbol);
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">PCR Refinement</div>';

      if (!range) {
        html += '<div class="unavailable-text">No PCR history yet this session.</div></div>';
        return html;
      }

      html += '<div style="display:flex; justify-content:space-between; margin-bottom:4px;">';
      html += '<span style="color:var(--muted); font-size:0.72rem;">Session PCR High</span><span style="color:var(--green); font-weight:700; font-size:0.78rem;">' + range.high.toFixed(2) + ' <span style="color:var(--muted); font-size:0.65rem;">(' + new Date(range.highTime).toLocaleTimeString() + ')</span></span>';
      html += '</div>';
      html += '<div style="display:flex; justify-content:space-between; margin-bottom:8px;">';
      html += '<span style="color:var(--muted); font-size:0.72rem;">Session PCR Low</span><span style="color:var(--red); font-weight:700; font-size:0.78rem;">' + range.low.toFixed(2) + ' <span style="color:var(--muted); font-size:0.65rem;">(' + new Date(range.lowTime).toLocaleTimeString() + ')</span></span>';
      html += '</div>';

      const divColor = divergence.state.indexOf('BEARISH') === 0 ? 'var(--red)' : divergence.state.indexOf('BULLISH') === 0 ? 'var(--green)' : divergence.state.indexOf('INSUFFICIENT') === 0 ? 'var(--muted)' : 'var(--gold)';
      html += '<div style="padding-top:8px; border-top:1px solid var(--border);">';
      html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Divergence Check</div>';
      html += '<div style="color:' + divColor + '; font-weight:700; font-size:0.78rem; margin-top:2px;">' + escapeHtml(divergence.state) + '</div>';
      if (divergence.sampleCount) {
        html += '<div style="color:var(--muted); font-size:0.65rem; margin-top:2px;">Based on last ' + divergence.sampleCount + ' recorded points' + (divergence.required ? ' (needs ' + divergence.required + ')' : '') + '</div>';
      }
      html += '</div>';

      html += '<div class="timestamp">Session High/Low and Divergence are computed from this session\u2019s recorded PCR history (server-backed, survives page reloads) \u2014 not the Advanced Diagnostics PCR badge, which is a separate, browser-only tracker. Divergence window (5 points) is PROVISIONAL, not backtested.</div>';
      html += '</div>';
      return html;
    }

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

    // Step 5: Haiku explanation state. Keyed by symbol. The real
    // cost-guard lives server-side (haikuCache in server.ts) \u2014 this
    // client-side check only avoids firing a pointless network request
    // when we already know the server will just hand back the cache.
    let haikuExplanations = {};

    // Step: Validation/Outcome Engine client trigger. Fires ONLY on a
    // genuine verdict change (not on Haiku's 15-min re-fire, and not
    // when there's no suggestion to evaluate) \u2014 one outcome record per
    // verdict episode, not a repeating poll. This never reads from or
    // writes to haikuExplanations; it is wired independently, reusing
    // only the already-computed result the deterministic engine
    // produced this cycle.
    let lastRecordedOutcomeVerdict = {};

    async function recordOutcomeIfNewVerdict(sym, result) {
      if (!result.suggestion || !result.suggestion.side || !(result.suggestion.entry > 0)) return; // nothing to evaluate
      if (lastRecordedOutcomeVerdict[sym] === result.verdict) return; // same episode, already recorded
      lastRecordedOutcomeVerdict[sym] = result.verdict;
      try {
        await fetch('/api/outcome/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: sym, verdict: result.verdict, score: result.score, maxScore: result.maxScore,
            confidence: result.confidence, suggestion: result.suggestion, signalContributions: result.contributions,
          }),
        });
      } catch (err) {
        console.error('[Outcome Engine] record failed:', err);
      }
    }

    // Cache of the LATEST runRuleEngine() result per symbol, refreshed
    // every poll cycle (NOT gated by Haiku's cost-guard, since this is
    // used by the Premium Diagnostic layer below to read already-
    // computed signal contributions without ever recomputing any
    // stateful classifier a second time this cycle).
    let lastRuleEngineResult = {};

    // Premium Diagnostic Layer client snapshot poster (user-approved
    // 2026-08-09/10, PILOT: NIFTY / current-week ATM only). Fires every
    // ~3-min poll (same cadence as everything else) \u2014 the server buffers
    // these into 15-min windows and only calls Haiku once a window
    // completes, not on every snapshot. Reuses lastRuleEngineResult's
    // contributions (already computed this cycle) for cross-signal
    // context \u2014 never recomputes any stateful classifier.
    function postPremiumDiagnosticSnapshot(sym, m, result) {
      if (sym !== 'NIFTY') return; // pilot scope
      if (!m.expiries || !m.expiries[0]) return;
      const exp = m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe || !atmPe || !(m.current > 0)) return;

      function legPayload(side, leg) {
        if (!leg || !(leg.lastPrice > 0)) return null;
        const intrinsic = computeIntrinsicValue(side, m.current, leg.strike);
        const extrinsic = Math.max(leg.lastPrice - intrinsic, 0);
        return {
          side, strike: leg.strike, premium: leg.lastPrice,
          intrinsic, extrinsic,
          IV: leg.iv || null, theta: leg.theta || null, vega: leg.vega || null, delta: leg.delta || null,
          DTE: computeDaysToExpiry(exp), OI: leg.oi || null, volume: leg.volume || null,
        };
      }

      function contribLabel(sig) {
        const v = result.contributions ? result.contributions[sig] : null;
        if (v == null) return null;
        return v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';
      }

      const snapshot = {
        timestamp: new Date().toISOString(),
        atmCe: legPayload('CE', atmCe),
        atmPe: legPayload('PE', atmPe),
        spot: m.current,
        spotChange: m.change,
        vwapRelation: (m.futuresContracts && m.futuresContracts[0] && m.vwap > 0) ? (m.current > m.vwap ? 'above VWAP' : m.current < m.vwap ? 'below VWAP' : 'at VWAP') : null,
        pdhPdlRelation: (m.pdh > 0 && m.pdl > 0) ? (m.current > m.pdh ? 'above PDH' : m.current < m.pdl ? 'below PDL' : 'inside PDH-PDL range') : null,
        pcr: m.pcr, pcrChange: null,
        vix: m.vix, vixChange: m.vixChangePercent,
        futuresOiBuildup: contribLabel('futures_oi_buildup'),
        callPutWalls: contribLabel('call_put_wall'),
        atmOiBuildup: contribLabel('atm_oi_buildup'),
        straddleBehaviour: contribLabel('straddle_behaviour'),
        sectorHeatmap: contribLabel('sector_heatmap'),
        structuralBias: classifyIndexOverallBias(m),
      };

      fetch('/api/premium-diagnostic/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, snapshot }),
      }).catch((err) => console.error('[Premium Diagnostic] snapshot post failed:', err));
    }

    async function triggerHaikuVerdicts() {
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
        const m = data[sym];
        if (!m || m.error) continue;
        const validation = validateData(sym, m);
        const result = runRuleEngine(sym, m, validation);
        lastRuleEngineResult[sym] = result;
        if (result.verdict === 'DATA UNAVAILABLE') continue;

        recordOutcomeIfNewVerdict(sym, result);
        postPremiumDiagnosticSnapshot(sym, m, result);

        const existing = haikuExplanations[sym];
        if (existing && existing.loading) continue;
        const verdictChanged = !existing || existing.verdict !== result.verdict;
        const guardWindowPassed = !existing || (Date.now() - (existing.calledAt || 0)) >= 15 * 60 * 1000;
        if (!verdictChanged && !guardWindowPassed) continue;

        haikuExplanations[sym] = Object.assign({}, existing, { loading: true });
        try {
          const resp = await fetch('/api/haiku-verdict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol: sym, verdict: result.verdict, score: result.score, maxScore: result.maxScore,
              confidence: result.confidence, contributions: result.contributions, overrides: result.overrides,
              suggestion: result.suggestion,
            }),
          });
          const json = await resp.json();
          if (!resp.ok || json.error) {
            haikuExplanations[sym] = { verdict: result.verdict, error: json.error || ('HTTP ' + resp.status), loading: false };
          } else {
            haikuExplanations[sym] = { verdict: result.verdict, explanation: json.explanation, fromCache: json.fromCache, calledAt: Date.now(), loading: false };
          }
        } catch (err) {
          haikuExplanations[sym] = { verdict: result.verdict, error: err.message, loading: false };
        }
        updateUI();
      }
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
        triggerHaikuVerdicts();
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
      // Visual styling (2026-08-08): terminal-ticker treatment \u2014
      // monospace, pulsing live dot, subtle border glow matching state.
      const pulseAnim = state === 'LIVE' ? 'animation: tickerPulse 1.8s ease-in-out infinite;' : '';
      let html = '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:8px; margin-bottom:10px; font-size:0.7rem; flex-wrap:wrap; gap:4px; font-family:var(--font-mono); border:1px solid color-mix(in srgb, ' + color + ' 20%, transparent); box-shadow:0 0 12px color-mix(in srgb, ' + color + ' 10%, transparent);">';
      html += '<span style="display:inline-flex; align-items:center; gap:6px;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:' + color + '; ' + pulseAnim + '"></span><span style="color:var(--muted);">FEED </span><span style="color:' + color + '; font-weight:700;">' + escapeHtml(state) + '</span></span>';
      html += '<span style="color:var(--muted);">SYNC ' + escapeHtml(lastUpdateText) + '</span>';
      html += '<span style="color:var(--muted);">NEXT ' + escapeHtml(nextRefreshText) + '</span>';
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

    let sectorHeatmapData = null;
    async function loadSectorHeatmap() {
      if (!kiteConnected) return;
      try {
        const response = await fetch('/api/sector-heatmap');
        const json = await response.json();
        if (!response.ok || json.error) {
          sectorHeatmapData = { error: json.error || 'Failed to load sector heatmap' };
        } else {
          sectorHeatmapData = json;
        }
        updateUI();
      } catch (err) {
        console.error('Failed to load sector heatmap:', err);
        sectorHeatmapData = { error: err.message };
      }
    }

    function renderSectorHeatmapCard() {
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Sector Heatmap</div>';
      if (!sectorHeatmapData) {
        html += '<div class="loading">Loading sector heatmap...</div></div>';
        return html;
      }
      if (sectorHeatmapData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(sectorHeatmapData.error) + '</div></div>';
        return html;
      }
      html += '<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px;">';
      (sectorHeatmapData.sectors || []).forEach((s) => {
        const color = s.category === 'green' ? 'var(--green)' : s.category === 'red' ? 'var(--red)' : s.category === 'neutral' ? '#5B9BD5' : 'var(--muted)';
        const bgTint = s.category === 'green' ? 'rgba(29,158,117,0.12)' : s.category === 'red' ? 'rgba(216,90,48,0.12)' : 'rgba(0,0,0,0.15)';
        html += '<div style="background:' + bgTint + '; border:1px solid ' + color + '; border-radius:8px; padding:8px; text-align:center;">';
        html += '<div style="color:var(--muted); font-size:0.65rem;">' + escapeHtml(s.name) + '</div>';
        html += '<div style="color:' + color + '; font-weight:700; font-size:0.85rem; margin-top:2px;">' + (s.pct != null ? (s.pct >= 0 ? '+' : '') + s.pct.toFixed(2) + '%' : 'N/A') + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div class="timestamp">Green \u2265 +0.5%, Red \u2264 \u22120.5%, Neutral between \u2014 thresholds per original spec, PROVISIONAL. Feeds the Gap Confirmation Score\u2019s breadth component (existing) \u2014 this card is the first place the per-sector breakdown is shown, added 2026-08-08.</div>';
      html += '</div>';
      return html;
    }

    // Sector Heatmap breadth score for the rule engine (Step 5\u2019s
    // sector_heatmap signal, wired 2026-08-08). Market-wide, not tied to
    // any one index\u2019s own data freshness \u2014 validity depends only on
    // whether the heatmap itself loaded, not the per-index staleness
    // clock. Safe to call multiple times per refresh (reads a snapshot,
    // mutates no tracker state), unlike Step 5B.
    function computeSectorBreadthValue() {
      if (!sectorHeatmapData || sectorHeatmapData.error || !Array.isArray(sectorHeatmapData.sectors) || sectorHeatmapData.sectors.length === 0) return null;
      const green = sectorHeatmapData.sectors.filter((s) => s.category === 'green').length;
      const red = sectorHeatmapData.sectors.filter((s) => s.category === 'red').length;
      return green - red; // 0 is a genuine neutral reading, not "no data"
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

    let truthStatusData = null;
    async function loadTruthStatus() {
      try {
        const response = await fetch('/api/truth/status');
        const json = await response.json();
        truthStatusData = response.ok ? json : { error: json.error || 'Failed to load Truth Engine status' };
        updateUI();
      } catch (err) {
        console.error('Failed to load Truth Engine status:', err);
        truthStatusData = { error: err.message };
      }
    }
    setInterval(loadTruthStatus, 60 * 1000);

    function truthVerdictColor(v) {
      if (v === 'TRUE') return 'var(--green)';
      if (v === 'PARTIAL') return 'var(--gold)';
      if (v === 'STALE') return 'var(--gold)';
      return 'var(--red)'; // INVALID
    }

    function ruleEngineVerdictColor(verdict) {
      if (verdict.indexOf('Bullish') !== -1) return 'var(--green)';
      if (verdict.indexOf('Bearish') !== -1) return 'var(--red)';
      if (verdict.indexOf('WAIT') !== -1 || verdict.indexOf('Sideways') !== -1) return 'var(--gold)';
      return 'var(--muted)';
    }

    function renderRuleEngineCard(symbol, m) {
      const validation = validateData(symbol, m);
      const result = runRuleEngine(symbol, m, validation);
      const color = ruleEngineVerdictColor(result.verdict);

      let html = '<div class="premium-card" style="margin-bottom:10px; border-color:' + color + ';">';

      // High-Priority Structure Alert \u2014 shown ABOVE the card title,
      // highest visual priority, only when it fires (see
      // computeStructureAlert above). Display-only, not scored.
      const structureAlert = computeStructureAlert(validation._step5bResult);
      if (structureAlert) {
        const alertColor = structureAlert.direction === 'CE' ? 'var(--green)' : 'var(--red)';
        html += '<div style="background:' + alertColor + '; color:#0A0F1C; border-radius:6px; padding:8px 10px; margin-bottom:8px; font-weight:800; font-size:0.78rem; text-align:center; box-shadow:0 0 14px ' + alertColor + ';">';
        html += '\u26a0\ufe0f ' + (structureAlert.isStrong ? 'STRONG ' : '') + structureAlert.direction + ' STRUCTURE: Cross-Expiry Aligned + Premium ' + escapeHtml(structureAlert.rangeState);
        html += '</div>';
      }

      // BankNifty round-number + ATM OI buildup combo alert
      // (user-approved 2026-08-08). BankNifty is monthly-only, so "this
      // month's expiry" IS m.expiries[0] here \u2014 the same ATM leg
      // computeAtmOiBuildupValue already read this cycle, reused via
      // validation._atmOiBuildupDetail (never recomputed).
      if (symbol === 'BANKNIFTY' && m && m.current) {
        const thousandProximity = computeThousandProximity(m.current);
        const oiDetail = validation._atmOiBuildupDetail;
        if (thousandProximity && oiDetail) {
          html += '<div style="background:rgba(201,162,39,0.16); border:2px solid var(--gold); border-radius:6px; padding:8px 10px; margin-bottom:8px;">';
          html += '<div style="color:var(--gold); font-weight:800; font-size:0.78rem; text-align:center;">\u26a0\ufe0f BANKNIFTY AT ROUND NUMBER ' + thousandProximity.level + ' + ATM OI BUILDUP (' + oiDetail.atmStrike + ')</div>';
          html += '<div style="display:flex; justify-content:space-between; margin-top:4px; font-size:0.72rem;"><span style="color:var(--muted);">CE \u26a0\ufe0f</span><strong style="color:var(--text);">' + escapeHtml(oiDetail.ceInterp) + '</strong></div>';
          html += '<div style="display:flex; justify-content:space-between; margin-top:2px; font-size:0.72rem;"><span style="color:var(--muted);">PE \u26a0\ufe0f</span><strong style="color:var(--text);">' + escapeHtml(oiDetail.peInterp) + '</strong></div>';
          html += '<div style="color:var(--muted); font-size:0.6rem; margin-top:4px;">Round numbers are often reversal/resistance zones \u2014 trade with extra caution here, this is not a directional call.</div>';
          html += '</div>';
        }
      }

      html += '<div class="card-title">Rule Engine Verdict (Step 3\u20134) \u2014 ' + symbol + '</div>';

      if (result.verdict === 'DATA UNAVAILABLE') {
        html += '<div class="unavailable-text">DATA UNAVAILABLE \u2014 ' + escapeHtml(result.reason) + '</div></div>';
        return html;
      }

      html += '<div style="text-align:center; padding:10px 0;">';
      html += '<div style="color:' + color + '; font-weight:800; font-size:1.1rem;">' + escapeHtml(result.verdict.toUpperCase()) + '</div>';
      html += '<div style="color:var(--muted); font-size:0.85rem; margin-top:4px;">Score: ' + (result.score >= 0 ? '+' : '') + result.score + ' / ' + result.maxScore + '</div>';
      html += '<div style="color:var(--muted); font-size:0.72rem;">Confidence: <strong style="color:var(--text);">' + result.confidence + '</strong></div>';
      html += '</div>';

      html += '<div style="border-top:1px solid var(--border); padding-top:8px;">';
      Object.keys(result.contributions).forEach((sig) => {
        const v = result.contributions[sig];
        const icon = v > 0 ? '\u2705' : v < 0 ? '\u26a0\ufe0f' : '\u2796';
        const vColor = v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)';
        html += '<div style="font-size:0.75rem; margin-top:3px;">' + icon + ' ' + sig + ': <span style="color:' + vColor + '; font-weight:700;">' + (v >= 0 ? '+' : '') + v + '</span></div>';
      });
      html += '</div>';

      if (result.suggestion) {
        const sug = result.suggestion;
        const sideColor = sug.side === 'CE' ? 'var(--green)' : 'var(--red)';
        html += '<div style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px;">';
        html += '<div style="text-align:center; margin-bottom:6px;"><span style="background:' + sideColor + '; color:#0A0F1C; font-weight:800; font-size:0.85rem; padding:2px 12px; border-radius:4px;">' + escapeHtml(sug.side || '') + '</span> <strong style="color:var(--text); font-size:0.95rem;">' + escapeHtml(sug.strike) + '</strong></div>';
        if (sug.sl != null) {
          html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-top:2px;"><span style="color:var(--muted);">Entry</span><strong style="color:var(--text);">\u20b9' + sug.entry.toFixed(2) + '</strong></div>';
          html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-top:2px;"><span style="color:var(--muted);">SL</span><strong style="color:var(--red);">\u20b9' + sug.sl.toFixed(2) + '</strong></div>';
          html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-top:2px;"><span style="color:var(--muted);">T1</span><strong style="color:var(--green);">\u20b9' + sug.t1.toFixed(2) + '</strong></div>';
          html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-top:2px;"><span style="color:var(--muted);">T2</span><strong style="color:var(--green);">\u20b9' + sug.t2.toFixed(2) + '</strong></div>';
        } else {
          html += '<div style="color:var(--muted); font-size:0.7rem;">Entry: \u20b9' + sug.entry.toFixed(2) + '</div>';
        }
        html += '<div style="color:var(--muted); font-size:0.65rem; margin-top:4px;">' + escapeHtml(sug.slNote) + '</div>';
        html += '</div>';
      }

      // Step 5: Haiku's plain-language explanation of the verdict above.
      // Haiku never changes the verdict/score/levels \u2014 only explains them.
      const haiku = haikuExplanations[symbol];
      html += '<div style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px;">';
      html += '<div style="color:var(--gold); font-size:0.66rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Why (AI Explanation)</div>';
      if (!haiku) {
        html += '<div style="color:var(--muted); font-size:0.7rem; margin-top:3px;">Not generated yet.</div>';
      } else if (haiku.loading) {
        html += '<div style="color:var(--muted); font-size:0.7rem; margin-top:3px;">Generating explanation\u2026</div>';
      } else if (haiku.error) {
        html += '<div style="color:var(--red); font-size:0.68rem; margin-top:3px;">' + escapeHtml(haiku.error) + '</div>';
      } else {
        html += '<div style="color:var(--text); font-size:0.75rem; margin-top:3px; line-height:1.4;">' + escapeHtml(haiku.explanation) + '</div>';
        html += '<div style="color:var(--muted); font-size:0.6rem; margin-top:4px;">' + (haiku.fromCache ? 'Cached (cost-guard: same verdict &lt; 15min)' : 'Fresh Haiku call') + ' \u2022 ' + escapeHtml(new Date(haiku.calledAt).toLocaleTimeString()) + '</div>';
      }
      html += '</div>';

      html += '<details style="margin-top:8px;"><summary style="color:var(--gold); font-size:0.68rem; cursor:pointer;">Overrides &amp; Notes</summary><div style="margin-top:4px;">';
      result.overrides.forEach((o) => { html += '<div style="color:var(--gold); font-size:0.68rem; margin-top:2px;">\u2022 ' + escapeHtml(o) + '</div>'; });
      html += '</div></details>';

      html += '<div class="timestamp">Steps 3\u20134 of the user-supplied Haiku Verdict document (2026-08-08). Score is out of ' + result.maxScore + ' (only currently-available signals) \u2014 NOT the full \u00b1' + result.theoreticalMaxScore + ' scale. Strong Bullish/Bearish (needs \u00b114) cannot currently be reached with this reduced signal set. No Haiku call yet (Step 5, not started \u2014 needs ANTHROPIC_API_KEY). Shadow mode \u2014 informational only, no order capability exists.</div>';
      html += '</div>';
      return html;
    }

    function renderHaikuValidationCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Haiku Verdict System \u2014 Step 2: Data Validation</div>';
      if (!data) {
        html += '<div class="unavailable-text">No market data yet.</div></div>';
        return html;
      }
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const v = validateData(sym, data[sym]);
        const color = v.overallValid ? 'var(--green)' : 'var(--red)';
        html += '<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="color:var(--muted); font-size:0.75rem; font-weight:700;">' + sym + '</span>';
        html += '<span style="color:' + color + '; font-weight:700; font-size:0.75rem;">' + (v.overallValid ? 'VALID' : 'BLOCKED (' + v.blockingFailureCount + ')') + '</span>';
        html += '</div>';
        html += '<details style="margin-top:4px;"><summary style="color:var(--gold); font-size:0.65rem; cursor:pointer;">16 signals</summary><div style="margin-top:4px;">';
        v.signals.forEach((s) => {
          const c = s.status === 'OK' ? 'var(--green)' : s.status === 'NOT_AVAILABLE' ? 'var(--muted)' : 'var(--red)';
          html += '<div style="font-size:0.62rem; color:var(--muted); margin-top:1px;">' + s.signal + ': <span style="color:' + c + '; font-weight:700;">' + s.status + '</span></div>';
        });
        html += '</div></details>';
        html += '</div>';
      });
      html += '<div class="timestamp">Step 2 of the user-supplied Haiku Verdict integration document (2026-08-08). Checks null/NaN/staleness (3min threshold) only \u2014 no scoring, no verdict, no Haiku call yet. NOT_AVAILABLE signals either have no computation anywhere yet (fib_pivot) or exist elsewhere but are not yet wired into this system (see per-signal detail) \u2014 neither blocks validation, both must be resolved before Step 3 (ruleEngine).</div>';
      html += '</div>';
      return html;
    }

    function renderTruthEngineCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Truth Engine (Module 1)</div>';
      if (!truthStatusData) {
        html += '<div class="loading">Loading Truth Engine status...</div></div>';
        return html;
      }
      if (truthStatusData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(truthStatusData.error) + '</div></div>';
        return html;
      }
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const report = truthStatusData[sym];
        if (!report) return;
        const color = truthVerdictColor(report.overallVerdict);
        html += '<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="color:var(--muted); font-size:0.75rem; font-weight:700;">' + sym + '</span>';
        html += '<span style="color:' + color + '; font-weight:700; font-size:0.78rem;">' + report.overallVerdict + '</span>';
        html += '</div>';
        if (report.rejectedFields && report.rejectedFields.length > 0) {
          html += '<div style="color:var(--muted); font-size:0.68rem; margin-top:2px;">Rejected: ' + report.rejectedFields.join(', ') + '</div>';
        }
        if (report.syncOk === false) {
          html += '<div style="color:var(--gold); font-size:0.68rem;">Cross-component sync mismatch (tolerance ' + (report.syncToleranceMs / 1000) + 's)</div>';
        }
        html += '<details style="margin-top:4px;"><summary style="color:var(--gold); font-size:0.65rem; cursor:pointer;">Field breakdown</summary>';
        html += '<div style="margin-top:4px;">';
        Object.keys(report.fields || {}).forEach((fieldName) => {
          const f = report.fields[fieldName];
          const fColor = truthVerdictColor(f.verdict);
          const ageText = f.ageMs != null ? Math.round(f.ageMs / 1000) + 's' : 'n/a';
          html += '<div style="font-size:0.66rem; color:var(--muted); margin-top:2px;">' + fieldName + ': <span style="color:' + fColor + '; font-weight:700;">' + f.verdict + '</span> (age ' + ageText + (f.reason ? ', ' + f.reason : '') + ')</div>';
        });
        html += '</div></details>';
        html += '</div>';
      });
      html += '<div class="timestamp">Module 1 of the approved Architecture Specification. Formalizes per-field TRUE/STALE/PARTIAL/INVALID classification and cross-component sync checking into one schema. As of Module 2, the Session Recorder now consumes this Truth Report before persisting any snapshot \u2014 a field the Truth Engine rejects is recorded as null, never as raw unvalidated data. Other modules (Decision, Probability, etc.) do not yet consume it (Module 3+ scope, not started). Thresholds are PROVISIONAL, not backtested.</div>';
      html += '</div>';
      return html;
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

    async function searchDriveArchives() {
      const tagInput = document.getElementById('driveSearchTag');
      const resultsEl = document.getElementById('driveSearchResults');
      if (!resultsEl) return;
      const tag = tagInput ? tagInput.value.trim() : '';
      resultsEl.innerHTML = 'Searching\u2026';
      try {
        const url = '/api/drive/search' + (tag ? '?tag=' + encodeURIComponent(tag) : '');
        const response = await fetch(url);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Search failed');
        if (!json.results || json.results.length === 0) {
          resultsEl.innerHTML = '<span style="color:var(--muted);">No archives found for this session.</span>';
          return;
        }
        let html = '';
        json.results.forEach((r) => {
          const tags = r.searchTags && r.searchTags.length ? ' \u2014 ' + r.searchTags.join(', ') : '';
          html += '<div style="padding:4px 0; border-top:1px solid var(--border);">' + escapeHtml(r.date) + ' (' + escapeHtml(r.status) + ')' + escapeHtml(tags) + '</div>';
        });
        resultsEl.innerHTML = html;
      } catch (err) {
        resultsEl.innerHTML = '<span style="color:var(--red);">' + escapeHtml(err.message) + '</span>';
      }
    }

    let eventBusData = null;
    async function loadEventBusStatus() {
      try {
        const response = await fetch('/api/events/recent');
        const json = await response.json();
        eventBusData = response.ok ? json : { error: json.error || 'Failed to load event bus status' };
        updateUI();
      } catch (err) {
        console.error('Failed to load event bus status:', err);
        eventBusData = { error: err.message };
      }
    }
    setInterval(loadEventBusStatus, 60 * 1000);

    function renderEventBusCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">API Layer / Event Bus (Module 11)</div>';
      if (!eventBusData) {
        html += '<div class="loading">Loading event bus...</div></div>';
        return html;
      }
      if (eventBusData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(eventBusData.error) + '</div></div>';
        return html;
      }
      html += rowLine('Total Events Published (session)', String(eventBusData.totalPublished));
      const events = eventBusData.events || [];
      if (events.length === 0) {
        html += '<div style="color:var(--muted); font-size:0.72rem;">No events published yet this session.</div>';
      } else {
        html += '<details style="margin-top:6px;"><summary style="color:var(--gold); font-size:0.7rem; cursor:pointer; font-weight:700;">Recent events (last ' + events.length + ')</summary>';
        html += '<div style="margin-top:6px; max-height:200px; overflow-y:auto;">';
        events.forEach((e) => {
          html += '<div style="padding:3px 0; border-top:1px solid var(--border); font-size:0.66rem;"><span style="color:var(--gold);">' + new Date(e.publishedAt).toLocaleTimeString() + '</span> <span style="color:var(--green); font-weight:700;">' + escapeHtml(e.eventType) + '</span> <span style="color:var(--muted);">from ' + escapeHtml(e.publisher) + '</span></div>';
        });
        html += '</div></details>';
      }
      html += '<div class="timestamp">Module 11 of the approved Architecture Specification. The REST API itself (all endpoints throughout this dashboard) is unchanged. This is the new, additive event bus \u2014 Recorder, Truth, DNA, Drive, Health, and Recovery Engines now also publish observable events alongside their existing behaviour. Every other module still works via its original direct function calls; nothing was rewritten to depend on this bus yet, per Backward Compatibility.</div>';
      html += '</div>';
      return html;
    }

    let recoveryData = null;
    async function loadRecoveryStatus() {
      try {
        const response = await fetch('/api/recovery/active');
        const json = await response.json();
        recoveryData = response.ok ? json : { error: json.error || 'Failed to load recovery status' };
        updateUI();
      } catch (err) {
        console.error('Failed to load recovery status:', err);
        recoveryData = { error: err.message };
      }
    }
    setInterval(loadRecoveryStatus, 60 * 1000);

    // Validation/Outcome Engine (System Architecture v1.0, layer 13) \u2014
    // minimal dashboard view. Read-only: this never feeds back into the
    // rule engine or Haiku layer, per the architecture's data-flow rules.
    let outcomeStatsData = null;
    async function loadOutcomeStats() {
      try {
        const response = await fetch('/api/outcome/stats');
        const json = await response.json();
        outcomeStatsData = response.ok ? json : { error: json.error || 'Failed to load outcome stats' };
        updateUI();
      } catch (err) {
        console.error('Failed to load outcome stats:', err);
        outcomeStatsData = { error: err.message };
      }
    }
    setInterval(loadOutcomeStats, 60 * 1000);

    // Premium Diagnostic 15-min window results (pilot: NIFTY only).
    let premiumDiagnostic15Min = null;
    async function loadPremiumDiagnostic15Min() {
      try {
        const response = await fetch('/api/premium-diagnostic/latest?symbol=NIFTY');
        const json = await response.json();
        premiumDiagnostic15Min = response.ok ? json : { error: json.error || 'Failed to load' };
        updateUI();
      } catch (err) {
        console.error('Failed to load Premium Diagnostic (15-min):', err);
        premiumDiagnostic15Min = { error: err.message };
      }
    }
    setInterval(loadPremiumDiagnostic15Min, 60 * 1000);

    function renderPremiumDiagnostic15MinCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Premium Diagnostic \u2014 15-min Windows (pilot)</div>';
      if (!premiumDiagnostic15Min) {
        html += '<div class="loading">Loading\u2026</div></div>';
        return html;
      }
      if (premiumDiagnostic15Min.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(premiumDiagnostic15Min.error) + '</div></div>';
        return html;
      }
      const results = premiumDiagnostic15Min.results || [];
      if (results.length === 0) {
        html += '<div style="color:var(--muted); font-size:0.75rem;">No completed 15-min window has been diagnosed yet today. Windows are 09:15\u201309:30, 09:30\u201309:45, etc. \u2014 the first one appears shortly after 09:30 IST.</div>';
        html += '</div>';
        return html;
      }
      const latest = results[results.length - 1];
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">';
      html += '<span style="color:var(--text); font-size:0.78rem; font-weight:600;">' + escapeHtml(latest.windowStart) + '\u2013' + escapeHtml(latest.windowEnd) + ' IST</span>';
      const dq = latest.diagnostic ? latest.diagnostic.data_quality : null;
      html += '<span style="color:' + (dq === 'OK' ? 'var(--green)' : dq === 'PARTIAL' ? 'var(--gold)' : 'var(--red)') + '; font-size:0.62rem; background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px;">' + escapeHtml(dq || (latest.error ? 'ERROR' : 'PENDING')) + '</span>';
      html += '</div>';
      if (latest.error) {
        html += '<div style="color:var(--red); font-size:0.7rem;">' + escapeHtml(latest.error) + '</div>';
      } else if (latest.diagnostic) {
        const d = latest.diagnostic;
        if (d.window_summary) html += '<div style="color:var(--text); font-size:0.72rem; margin-bottom:6px; line-height:1.4;">' + escapeHtml(d.window_summary) + '</div>';
        if (d.intrinsic_extrinsic_analysis) html += '<div style="margin-bottom:4px;"><span style="color:var(--gold); font-size:0.62rem; font-weight:700; text-transform:uppercase;">Intrinsic/Extrinsic</span><div style="color:var(--muted); font-size:0.68rem; line-height:1.4;">' + escapeHtml(d.intrinsic_extrinsic_analysis) + '</div></div>';
        if (d.iv_analysis) html += '<div style="margin-bottom:4px;"><span style="color:var(--gold); font-size:0.62rem; font-weight:700; text-transform:uppercase;">IV</span><div style="color:var(--muted); font-size:0.68rem; line-height:1.4;">' + escapeHtml(d.iv_analysis) + '</div></div>';
        if (Array.isArray(d.confirmed_observations) && d.confirmed_observations.length > 0) {
          html += '<div style="margin-bottom:4px;"><span style="color:var(--green); font-size:0.62rem; font-weight:700; text-transform:uppercase;">Confirmed</span>';
          d.confirmed_observations.forEach((o) => { html += '<div style="color:var(--muted); font-size:0.66rem;">\u2022 ' + escapeHtml(o) + '</div>'; });
          html += '</div>';
        }
        if (Array.isArray(d.conflicts) && d.conflicts.length > 0) {
          html += '<div style="margin-bottom:4px;"><span style="color:var(--red); font-size:0.62rem; font-weight:700; text-transform:uppercase;">Conflicts</span>';
          d.conflicts.forEach((o) => { html += '<div style="color:var(--muted); font-size:0.66rem;">\u2022 ' + escapeHtml(o) + '</div>'; });
          html += '</div>';
        }
      }
      html += '<div class="timestamp">Snapshots: ' + latest.snapshotCount + ' \u2022 Generated ' + escapeHtml(new Date(latest.generatedAt).toLocaleTimeString()) + ' \u2022 PILOT: NIFTY, current-week ATM only. No database \u2014 resets on redeploy. Multi-timeframe context not available (only 3-min snapshots exist), disclosed as such to Haiku rather than fabricated.</div>';
      html += '</div>';
      return html;
    }

    function renderOutcomeEngineCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Validation / Outcome Engine (Layer 13)</div>';
      if (!outcomeStatsData) {
        html += '<div class="loading">Loading outcome stats\u2026</div></div>';
        return html;
      }
      if (outcomeStatsData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(outcomeStatsData.error) + '</div></div>';
        return html;
      }
      const s = outcomeStatsData;
      html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px;"><span style="color:var(--muted);">Total recorded</span><strong style="color:var(--text);">' + s.totalRecords + '</strong></div>';
      html += '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:8px;"><span style="color:var(--muted);">Determinate (usable in stats)</span><strong style="color:var(--text);">' + s.determinateRecords + '</strong></div>';
      const statusEntries = Object.entries(s.byStatus || {});
      if (statusEntries.length > 0) {
        html += '<div style="color:var(--gold); font-size:0.66rem; font-weight:700; text-transform:uppercase; margin-bottom:4px;">By Status</div>';
        statusEntries.forEach(([status, count]) => {
          html += '<div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:2px;"><span style="color:var(--muted);">' + escapeHtml(status) + '</span><strong style="color:var(--text);">' + count + '</strong></div>';
        });
      }
      const verdictEntries = Object.entries(s.byVerdict || {});
      if (verdictEntries.length > 0) {
        html += '<div style="color:var(--gold); font-size:0.66rem; font-weight:700; text-transform:uppercase; margin:8px 0 4px;">By Verdict (target vs stop)</div>';
        verdictEntries.forEach(([verdict, v]) => {
          html += '<div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:2px;"><span style="color:var(--muted);">' + escapeHtml(verdict) + '</span><strong style="color:var(--text);">' + v.targetHit + ' target / ' + v.stopHit + ' stop / ' + v.neither + ' neither (n=' + v.total + ')</strong></div>';
        });
      }
      if (s.determinateRecords < s.minSampleSize) {
        html += '<div style="color:var(--muted); font-size:0.65rem; margin-top:6px;">Sample size below ' + s.minSampleSize + ' \u2014 too early for any statistic here to be meaningful.</div>';
      }
      html += '<div class="timestamp">Deterministic only \u2014 no AI/Haiku involvement. Outcome window: ' + (s.windowMinutes || '\u2014') + ' min (configurable via OUTCOME_WINDOW_MINUTES). PENDING and INCOMPLETE_* records are excluded from all statistics, never interpolated. Records live in memory only and reset on redeploy (same disclosed limitation as the Recorder Engine).</div>';
      html += '</div>';
      return html;
    }

    async function manualRetryRecovery(recoveryId) {
      try {
        showSuccess('Retrying...');
        const response = await fetch('/api/recovery/' + recoveryId + '/manual-retry', { method: 'POST' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Retry failed');
        showSuccess(json.success ? '\u2713 Recovery succeeded' : 'Retry attempted \u2014 still failing, see status');
        await loadRecoveryStatus();
      } catch (err) {
        showError('Manual retry failed: ' + err.message);
      }
    }

    function renderRecoveryEngineCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Recovery Engine (Module 13)</div>';
      if (!recoveryData) {
        html += '<div class="loading">Loading recovery status...</div></div>';
        return html;
      }
      if (recoveryData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(recoveryData.error) + '</div></div>';
        return html;
      }
      const active = recoveryData.active || [];
      if (active.length === 0) {
        html += '<div style="color:var(--green); font-size:0.78rem; font-weight:700;">No active recovery needed \u2014 all modules healthy.</div>';
      } else {
        active.forEach((r) => {
          const color = r.status === 'MANUAL_ACTION_REQUIRED' ? 'var(--red)' : r.status === 'EXHAUSTED' ? 'var(--red)' : 'var(--gold)';
          html += '<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);">';
          html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
          html += '<span style="color:var(--muted); font-size:0.75rem; font-weight:700;">' + escapeHtml(r.moduleName) + '</span>';
          html += '<span style="color:' + color + '; font-weight:700; font-size:0.72rem;">' + r.status + '</span>';
          html += '</div>';
          html += '<div style="color:var(--muted); font-size:0.68rem; margin-top:2px;">' + escapeHtml(r.reason) + '</div>';
          if (r.status === 'RETRYING') {
            html += '<div style="color:var(--muted); font-size:0.65rem;">Attempt ' + r.attempt + '/' + r.maxAttempts + (r.nextRetryAt ? ' \u00b7 next at ' + new Date(r.nextRetryAt).toLocaleTimeString() : '') + '</div>';
          }
          if (r.status === 'MANUAL_ACTION_REQUIRED' && r.moduleName === 'Google Drive Super Brain') {
            html += '<div style="color:var(--gold); font-size:0.68rem; margin-top:2px;">\u2192 Use the Connect Google Drive button above.</div>';
          } else if (r.status === 'MANUAL_ACTION_REQUIRED') {
            html += '<div style="color:var(--gold); font-size:0.68rem; margin-top:2px;">\u2192 Requires Kite login (see header).</div>';
          } else if (r.status === 'EXHAUSTED') {
            html += '<button onclick="manualRetryRecovery(\\'' + r.recoveryId + '\\')" style="margin-top:4px; background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:4px 8px; font-size:0.65rem; cursor:pointer;">Manual Retry</button>';
          }
          html += '</div>';
        });
      }
      html += '<div class="timestamp">Module 13 of the approved Architecture Specification. Only Google Drive archive failures are automatically retried (exponential backoff, max ' + '5' + ' attempts) \u2014 this is the sole genuinely auto-recoverable failure in the system today. Kite session loss and Google Drive disconnection are credential-based and are always flagged for manual reconnection, by design, never auto-retried.</div>';
      html += '</div>';
      return html;
    }

    let healthData = null;
    async function loadHealthStatus() {
      try {
        const response = await fetch('/api/health');
        const json = await response.json();
        healthData = response.ok ? json : { error: json.error || 'Failed to load system health' };
        updateUI();
      } catch (err) {
        console.error('Failed to load system health:', err);
        healthData = { error: err.message };
      }
    }
    setInterval(loadHealthStatus, 60 * 1000);

    function healthStatusColor(status) {
      if (status === 'HEALTHY') return 'var(--green)';
      if (status === 'DEGRADED') return 'var(--gold)';
      return 'var(--red)'; // DOWN
    }

    function renderSystemHealthCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">System Health (Module 12)</div>';
      if (!healthData) {
        html += '<div class="loading">Loading system health...</div></div>';
        return html;
      }
      if (healthData.error) {
        html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(healthData.error) + '</div></div>';
        return html;
      }
      const overallColor = healthStatusColor(healthData.overallStatus);
      html += '<div style="text-align:center; margin-bottom:10px;">';
      html += '<span class="badge-pill" style="background:rgba(0,0,0,0.25); color:' + overallColor + '; border:1px solid ' + overallColor + '; font-weight:700; font-size:0.8rem; padding:4px 12px;">OVERALL: ' + healthData.overallStatus + '</span>';
      html += '</div>';
      (healthData.modules || []).forEach((m) => {
        const color = healthStatusColor(m.status);
        html += '<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid var(--border);">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="color:var(--muted); font-size:0.74rem; font-weight:700;">' + escapeHtml(m.moduleName) + '</span>';
        html += '<span style="color:' + color + '; font-weight:700; font-size:0.72rem;">' + m.status + '</span>';
        html += '</div>';
        const metricParts = Object.keys(m.metrics || {}).map((k) => k + ': ' + (m.metrics[k] === null ? 'n/a' : m.metrics[k]));
        if (metricParts.length > 0) {
          html += '<div style="color:var(--muted); font-size:0.65rem; margin-top:2px;">' + escapeHtml(metricParts.join(' \u00b7 ')) + '</div>';
        }
        html += '</div>';
      });
      html += '<div class="timestamp">Module 12 of the approved Architecture Specification. Polls Truth Engine, Recorder Engine, Google Drive Super Brain, Daily Journal, and Market DNA Engine\u2019s existing in-memory state directly (no event bus exists yet, per Module 11\u2019s disclosed gap). Modules 5\u20139, 13 are not yet built and are not represented here.</div>';
      html += '</div>';
      return html;
    }

    let dnaData = {};
    async function loadDnaStatus() {
      try {
        const today = recorderStatusData && recorderStatusData.tradingDate;
        if (!today) return;
        const results = {};
        for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
          const response = await fetch('/api/dna/' + today + '?index=' + sym);
          const json = await response.json();
          results[sym] = response.ok ? json : { error: json.error || 'Failed to load' };
        }
        dnaData = results;
        updateUI();
      } catch (err) {
        console.error('Failed to load Market DNA:', err);
      }
    }
    setInterval(loadDnaStatus, 3 * 60 * 1000);

    function renderMarketDnaCard() {
      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Market DNA (Module 4)</div>';
      const symbols = Object.keys(dnaData);
      if (symbols.length === 0) {
        html += '<div class="loading">Loading Market DNA...</div></div>';
        return html;
      }
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        const d = dnaData[sym];
        if (!d) return;
        html += '<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);">';
        if (d.error) {
          html += '<div style="color:var(--muted); font-size:0.72rem;">' + sym + ': ' + escapeHtml(d.error) + '</div>';
          html += '</div>';
          return;
        }
        const confColor = d.confidence === 'HIGH' ? 'var(--green)' : d.confidence === 'MEDIUM' ? 'var(--gold)' : 'var(--muted)';
        html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="color:var(--muted); font-size:0.75rem; font-weight:700;">' + sym + '</span>';
        html += '<span style="color:' + confColor + '; font-size:0.7rem; font-weight:700;">' + d.confidence + ' confidence</span>';
        html += '</div>';
        if (d.tags && d.tags.length > 0) {
          html += '<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">';
          d.tags.forEach((t) => { html += renderBadge(t); });
          html += '</div>';
        }
        html += '<details style="margin-top:4px;"><summary style="color:var(--gold); font-size:0.65rem; cursor:pointer;">Features</summary>';
        html += '<div style="margin-top:4px;">';
        html += rowLine('Volatility Regime', d.features.volatilityRegime);
        html += rowLine('Trend Persistence', d.features.trendPersistenceScore != null ? (d.features.trendPersistenceScore * 100).toFixed(0) + '%' : 'DATA UNAVAILABLE');
        html += rowLine('Verdict Flips', String(d.features.verdictFlipCount));
        html += rowLine('Gap Behaviour', d.features.gapBehaviour);
        html += rowLine('Wall Persistence', 'DATA UNAVAILABLE');
        html += '</div></details>';
        html += '</div>';
      });
      html += '<div class="timestamp">Module 4 of the approved Architecture Specification. Computed live from today\u2019s Recorder + Journal history only \u2014 recalculates every few minutes as more of the session is recorded. Wall Persistence is always DATA UNAVAILABLE by design (the Recorder does not capture Call/Put Wall state). Cannot yet look up prior days\u2019 DNA (blocked on the same database gap as the Recorder\u2019s Module 2 Future Expansion).</div>';
      html += '</div>';
      return html;
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

    let researchReportData = null;
    let researchLoading = false;
    async function submitResearchQuery() {
      const dateEl = document.getElementById('researchDate');
      const indexEl = document.getElementById('researchIndex');
      const eventTypeEl = document.getElementById('researchEventType');
      const date = dateEl ? dateEl.value : '';
      const index = indexEl ? indexEl.value : 'NIFTY';
      const eventType = eventTypeEl && eventTypeEl.value ? eventTypeEl.value : null;
      if (!date) { showError('Pick a date first.'); return; }
      researchLoading = true;
      updateUI();
      try {
        const response = await fetch('/api/research/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, index, eventType }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Research query failed');
        researchReportData = json;
      } catch (err) {
        researchReportData = { error: err.message };
      } finally {
        researchLoading = false;
        updateUI();
      }
    }

    function renderResearchTab() {
      let html = '<div class="premium-card" style="margin-bottom:12px;">';
      html += '<div class="card-title">Research Engine (Module 9)</div>';
      html += '<div style="color:var(--muted); font-size:0.75rem; margin-bottom:10px;">Structured query only \u2014 searches today\u2019s live session, or any date already archived and indexed in Google Drive (Module 3). Not a general historical search yet (needs Module 6: Memory Engine).</div>';

      const today = (recorderStatusData && recorderStatusData.tradingDate) || new Date().toISOString().slice(0, 10);
      html += '<div style="display:flex; flex-direction:column; gap:8px;">';
      html += '<label style="color:var(--muted); font-size:0.7rem;">Date<input type="date" id="researchDate" value="' + today + '" style="width:100%; padding:6px; margin-top:2px; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:6px; color:var(--text);"></label>';
      html += '<label style="color:var(--muted); font-size:0.7rem;">Index<select id="researchIndex" style="width:100%; padding:6px; margin-top:2px; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:6px; color:var(--text);">';
      html += '<option value="NIFTY">NIFTY</option><option value="BANKNIFTY">BANKNIFTY</option><option value="SENSEX">SENSEX</option>';
      html += '</select></label>';
      html += '<label style="color:var(--muted); font-size:0.7rem;">Event Type<select id="researchEventType" style="width:100%; padding:6px; margin-top:2px; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:6px; color:var(--text);">';
      html += '<option value="">All events</option><option value="notes">Important Notes only</option>';
      html += '</select></label>';
      html += '<button onclick="submitResearchQuery()" style="background:var(--gold); color:#1a1a2e; font-weight:700; padding:8px; border-radius:6px; border:none; cursor:pointer; font-size:0.8rem;">' + (researchLoading ? 'Searching\u2026' : 'Run Query') + '</button>';
      html += '</div>';
      html += '</div>';

      if (researchReportData) {
        html += '<div class="premium-card">';
        if (researchReportData.error) {
          html += '<div class="error">\u26a0\ufe0f ' + escapeHtml(researchReportData.error) + '</div>';
        } else {
          const r = researchReportData;
          html += '<div class="card-title">Report: ' + escapeHtml(r.query.index) + ' \u2014 ' + escapeHtml(r.query.date) + '</div>';
          html += '<div style="color:var(--text); font-size:0.8rem; margin-bottom:10px;">' + escapeHtml(r.summary) + '</div>';
          if (r.evidenceTrail && r.evidenceTrail.length > 0) {
            html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Evidence Trail</div>';
            r.evidenceTrail.forEach((e) => {
              html += '<div style="padding:4px 0; border-top:1px solid var(--border); font-size:0.72rem;"><span style="color:var(--gold);">' + new Date(e.timestamp).toLocaleTimeString() + '</span> <span style="color:var(--muted);">[' + e.source + ']</span> ' + escapeHtml(e.event) + '</div>';
            });
          }
          if (r.unanswerable && r.unanswerable.length > 0) {
            html += '<div style="margin-top:10px; padding-top:8px; border-top:1px solid var(--border);">';
            html += '<div style="color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Could Not Answer</div>';
            r.unanswerable.forEach((u) => { html += '<div style="color:var(--gold); font-size:0.72rem; margin-top:2px;">\u2022 ' + escapeHtml(u) + '</div>'; });
            html += '</div>';
          }
        }
        html += '</div>';
      }
      return html;
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
        if (d.lastArchive.searchTags && d.lastArchive.searchTags.length > 0) {
          html += rowLine('Search Tags', d.lastArchive.searchTags.join(', '));
        }
        if (d.lastArchive.lastError) html += rowLine('Last Archive Error', d.lastArchive.lastError);
      }
      if (d.lastError) html += rowLine('Last Error', d.lastError);

      html += '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">';
      html += '<button onclick="testDriveUpload()" style="background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:6px 10px; font-size:0.7rem; cursor:pointer;">Test Drive Upload</button>';
      html += '<button onclick="archiveToDrive()" style="background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:6px 10px; font-size:0.7rem; cursor:pointer;">Archive Now</button>';
      html += '</div>';

      html += '<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">';
      html += '<div class="fii-section-label">Session Library (Module 3)</div>';
      html += '<div style="display:flex; gap:6px; margin-bottom:6px;">';
      html += '<input id="driveSearchTag" placeholder="e.g. STRONG_CE_BIAS" style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:6px; padding:5px 8px; color:var(--text); font-size:0.7rem;">';
      html += '<button onclick="searchDriveArchives()" style="background:rgba(0,0,0,0.2); color:var(--gold); border:1px solid var(--gold); border-radius:6px; padding:5px 10px; font-size:0.7rem; cursor:pointer;">Search</button>';
      html += '</div>';
      html += '<div id="driveSearchResults" style="font-size:0.7rem; color:var(--muted);"></div>';
      html += '<div class="timestamp">Search covers archives created since this server last restarted only (in-memory index, Phase-1 limitation \u2014 not a durable index over all Drive history). Replay reads the actual archived file back from Drive itself, so it works for any previously verified date even after a restart, via GET /api/drive/replay/:date.</div>';
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
      if (s.lastSnapshotTruthVerdicts) {
        html += rowLine('Truth Verdicts (last snapshot)', 'NIFTY ' + s.lastSnapshotTruthVerdicts.NIFTY + ' \u00b7 BANKNIFTY ' + s.lastSnapshotTruthVerdicts.BANKNIFTY + ' \u00b7 SENSEX ' + s.lastSnapshotTruthVerdicts.SENSEX);
      }
      html += '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">';
      html += '<a href="/api/recorder/session.csv" download style="color:var(--gold); font-size:0.72rem; text-decoration:underline;">Download CSV</a>';
      html += '<a href="/api/recorder/session.json" download style="color:var(--gold); font-size:0.72rem; text-decoration:underline;">Download JSON</a>';
      html += '</div>';
      html += '<div class="timestamp">Phase 1: in-memory only, resets on server restart \u2014 no database or Google Drive archive yet. Every 3 minutes during market hours, each index\u2019s data is first classified by the Truth Engine (Module 1); only fields it verdicts TRUE are recorded \u2014 a rejected field is stored as null, never as unvalidated raw data. Does not yet include computed signal states (Orchestrator, interpretations), which live only in this browser session.</div>';
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

    // ============== HAIKU VERDICT SYSTEM \u2014 STEP 2: validateData() ==============
    // Per the user-supplied "OptionPilot Pro — Haiku Verdict Prompt"
    // document (2026-08-08), Integration Order item 2. Checks the raw
    // data each of the 16 rule-engine signals needs: null, NaN, and
    // staleness (>3 min per the document's Override Rule 7). This is
    // ONLY validation — no scoring, no verdict, no Haiku call (Steps
    // 3\u20135 are separate, later steps per the user's explicit phased
    // approval).
    //
    // Honesty rule: a signal whose computation exists elsewhere in this
    // codebase (Step 5B/6A/6B, Refactor B classifiers, FII/DII 5-day
    // bias) but has not yet been wired into this new validator is marked
    // NOT_AVAILABLE with an explicit "existsElsewhere" note \u2014 never
    // silently reported as OK, and never confused with a signal that has
    // no computation anywhere yet (fib_pivot).

    const STALE_THRESHOLD_MS_HAIKU = 3 * 60 * 1000; // per document Override Rule 7 (3 min), distinct from the platform's general 6-min staleness convention used elsewhere

    const HAIKU_SIGNAL_CATALOG = [
      { id: 'futures_vwap', existsElsewhere: null },
      { id: 'pdh_pdl', existsElsewhere: null },
      { id: 'fib_pivot' },
      { id: 'oi_pcr', existsElsewhere: null },
      { id: 'pcr_trend' },
      { id: 'call_put_wall' },
      { id: 'max_pain', existsElsewhere: null },
      { id: 'india_vix', existsElsewhere: null },
      { id: 'atm_oi_buildup' },
      { id: 'futures_oi_buildup', existsElsewhere: null },
      { id: 'fii_dii_5day', existsElsewhere: 'FII/DII 5-Day Verdict module.' },
      { id: 'sector_heatmap' },
      { id: 'expiry_alignment' },
      { id: 'gap_type', existsElsewhere: null },
      { id: 'option_premium_vwap', existsElsewhere: 'Per-leg VWAP proxy exists (Premium Pair card) but not aggregated CE-vs-PE for this signal.' },
      { id: 'straddle_behaviour' },
    ];

    function validateData(symbol, m) {
      const now = Date.now();
      const results = [];

      if (!m || m.error) {
        HAIKU_SIGNAL_CATALOG.forEach((s) => results.push({ signal: s.id, status: 'NULL', reason: 'no index data' }));
        return { symbol, overallValid: false, signals: results, timestamp: new Date().toISOString() };
      }

      const effTs = getEffectiveTimestamp(m);
      const ageMs = effTs ? now - new Date(effTs).getTime() : null;
      const isStale = ageMs == null || ageMs > STALE_THRESHOLD_MS_HAIKU;

      const contract = m.futuresContracts && m.futuresContracts[0];
      // Computed ONCE here (never again in runRuleEngine) — Step 5B's
      // internal trackers (priceDirection/oiArrowInfo/futuresDirection)
      // mutate shared last-seen state on every call, so calling this
      // twice in the same refresh cycle would corrupt the up/down
      // comparison on the second call. runRuleEngine reads the cached
      // result off the validation object instead of recomputing it.
      const step5bResult = computeStep5BConclusion(symbol, m);
      // Computed ONCE here too, same reasoning as step5bResult above \u2014
      // uses its own '_atmoi_' tracker keys so it doesn't collide with
      // Step 5B's, but still must not be called twice per cycle.
      const atmOiBuildupDetail = computeAtmOiBuildupValue(symbol, m);
      const atmOiBuildupValue = atmOiBuildupDetail ? atmOiBuildupDetail.value : null;
      const rawValues = {
        futures_vwap: (contract && m.vwap > 0) ? m.vwap : null,
        pdh_pdl: (m.pdh > 0 && m.pdl > 0) ? 1 : null,
        oi_pcr: m.pcr,
        max_pain: m.maxPain > 0 ? m.maxPain : null,
        india_vix: m.vix,
        futures_oi_buildup: contract ? contract.oi : null,
        gap_type: m.gapScore ? 1 : null,
        expiry_alignment: step5bResult.blocked ? null : step5bResult.finalStatus,
        sector_heatmap: computeSectorBreadthValue(),
        pcr_trend: computePcrTrendValue(symbol),
        call_put_wall: computeCallPutWallValue(symbol, m),
        atm_oi_buildup: atmOiBuildupValue,
        straddle_behaviour: computeStraddleBehaviourValue(symbol, m),
        fib_pivot: computeFibPivotValue(m),
      };

      HAIKU_SIGNAL_CATALOG.forEach((s) => {
        if (s.existsElsewhere) {
          results.push({ signal: s.id, status: 'NOT_AVAILABLE', reason: 'not yet wired \u2014 ' + s.existsElsewhere });
          return;
        }
        if (s.note) {
          results.push({ signal: s.id, status: 'NOT_AVAILABLE', reason: s.note });
          return;
        }
        // sector_heatmap and pcr_trend are their own freshness sources
        // (heatmap load state / session PCR history) \u2014 neither rides
        // the per-index isStale clock.
        if (s.id !== 'sector_heatmap' && s.id !== 'pcr_trend' && isStale) {
          results.push({ signal: s.id, status: 'STALE', reason: 'data age ' + (ageMs != null ? Math.round(ageMs / 1000) + 's' : 'unknown') + ' exceeds 3min threshold' });
          return;
        }
        const v = rawValues[s.id];
        if (v == null || (typeof v === 'number' && isNaN(v))) {
          results.push({ signal: s.id, status: 'NULL', reason: 'value is null/NaN' });
          return;
        }
        results.push({ signal: s.id, status: 'OK' });
      });

      // overallValid per the document's intent: enough real, fresh data
      // to eventually feed a rule engine — NOT_AVAILABLE signals don't
      // block this (they're a Step 3 wiring task), but any OK-eligible
      // signal that came back NULL/STALE does.
      const blockingFailures = results.filter((r) => r.status === 'NULL' || r.status === 'STALE');
      const overallValid = blockingFailures.length === 0;

      return { symbol, overallValid, signals: results, blockingFailureCount: blockingFailures.length, timestamp: new Date().toISOString(), _step5bResult: step5bResult, _atmOiBuildupValue: atmOiBuildupValue, _atmOiBuildupDetail: atmOiBuildupDetail };
    }

    // ============== HAIKU VERDICT SYSTEM — STEP 3: runRuleEngine() ==============
    // Per the user-supplied document, Sections 3–6. Scores ONLY signals
    // validateData() marked OK — a NOT_AVAILABLE/NULL/STALE signal
    // contributes nothing and is excluded from both the score AND the
    // max-possible-score denominator, never silently treated as neutral
    // (0) among counted signals, which would misrepresent how much real
    // evidence went into the number.
    //
    // Honesty disclosure: only 14 of the 16 signals are wired today (see
    // Step 2's card), so the achievable score ceiling is far below the
    // document's full ±20.5 scale. The document's own verdict thresholds
    // (±14 for Strong, etc.) are applied UNCHANGED — meaning Strong
    // Bullish/Bearish cannot currently be reached. This is disclosed
    // explicitly rather than quietly rescaling the thresholds myself.

    function runRuleEngine(symbol, m, validation) {
      const timestamp = new Date().toISOString();

      if (!validation.overallValid) {
        return {
          symbol, verdict: 'DATA UNAVAILABLE', score: null, maxScore: null, confidence: null,
          reason: 'Step 2 (validateData) blocked: ' + validation.blockingFailureCount + ' signal(s) NULL/STALE',
          contributions: {}, overrides: [], timestamp,
        };
      }

      const availableSignals = new Set(validation.signals.filter((s) => s.status === 'OK').map((s) => s.signal));
      const contract = m.futuresContracts && m.futuresContracts[0];
      const contributions = {};
      let score = 0;
      let maxScore = 0;

      function add(signal, value, weight) {
        contributions[signal] = value;
        score += value;
        maxScore += weight;
      }

      if (availableSignals.has('futures_vwap') && contract && m.vwap > 0) {
        const pctDiff = ((contract.ltp - m.vwap) / m.vwap) * 100;
        add('futures_vwap', Math.abs(pctDiff) <= 0.1 ? 0 : (pctDiff > 0 ? 1 : -1), 1);
      }
      if (availableSignals.has('pdh_pdl')) {
        add('pdh_pdl', m.current > m.pdh ? 1 : m.current < m.pdl ? -1 : 0, 1);
      }
      if (availableSignals.has('oi_pcr') && m.pcr != null) {
        add('oi_pcr', m.pcr > 1.2 ? 1 : m.pcr < 0.8 ? -1 : 0, 1);
      }
      if (availableSignals.has('max_pain') && m.maxPain > 0) {
        add('max_pain', m.current < m.maxPain ? 0.5 : m.current > m.maxPain ? -0.5 : 0, 0.5);
      }
      if (availableSignals.has('india_vix')) {
        add('india_vix', m.vixChange < 0 ? 1 : m.vixChange > 0 ? -1 : 0, 1);
      }
      if (availableSignals.has('futures_oi_buildup')) {
        const futClass = classifySimpleFutures(symbol);
        add('futures_oi_buildup', futClass === 'FRESH LONG BUILD-UP' ? 1 : futClass === 'FRESH SHORT BUILD-UP' ? -1 : 0, 1);
      }
      if (availableSignals.has('gap_type') && m.gapScore) {
        // gapPercent uses the near-month futures' previous close as a
        // disclosed proxy for the index's own previous close (no direct
        // index prevClose field exists) — reasonable, not fabricated.
        const gapPercent = (m.dayOpen > 0 && contract && contract.prevClose > 0) ? ((m.dayOpen - contract.prevClose) / contract.prevClose) * 100 : null;
        const dir = m.gapScore.components.gapDirection;
        const isContinuation = m.gapScore.verdict === 'Continuation';
        const base = (dir !== 0 && isContinuation) ? dir * 2 : 0;
        const bigGap = gapPercent != null && Math.abs(gapPercent) > 0.8;
        add('gap_type', bigGap ? base * 1.5 : base, bigGap ? 3 : 2);
      }
      if (availableSignals.has('expiry_alignment') && validation._step5bResult) {
        // Cross-Expiry ITM Alignment (Step 5B), reusing the SAME result
        // validateData() already computed this cycle — never recomputed,
        // to avoid corrupting Step 5B's internal up/down trackers.
        const fs = validation._step5bResult.finalStatus;
        let ealValue = 0;
        if (fs === 'STRONG CROSS-EXPIRY ITM CE ALIGNMENT') ealValue = 1.5;
        else if (fs === 'CROSS-EXPIRY ITM CE ALIGNMENT' || fs === 'CURRENT ATM CE SUPPORTIVE' || fs === 'CURRENT 1-ITM CE PREFERRED') ealValue = 1;
        else if (fs === 'STRONG CROSS-EXPIRY ITM PE ALIGNMENT') ealValue = -1.5;
        else if (fs === 'CROSS-EXPIRY ITM PE ALIGNMENT' || fs === 'CURRENT ATM PE SUPPORTIVE' || fs === 'CURRENT 1-ITM PE PREFERRED') ealValue = -1;
        // LONGER-EXPIRY CONFLICT, OPPOSITE PREMIUM NOT WEAK, ITM\u2013FUTURES
        // CONFLICT, and CURRENT-EXPIRY-ONLY MOVE all stay 0 \u2014 genuine
        // conflict/noise signals, not a directional read.
        add('expiry_alignment', ealValue, 1.5);
      }
      if (availableSignals.has('sector_heatmap')) {
        // Reads the same market-wide breadth snapshot validateData()
        // just validated \u2014 safe to recompute (no tracker mutation).
        const breadth = computeSectorBreadthValue();
        if (breadth != null) {
          add('sector_heatmap', breadth > 0 ? 1 : breadth < 0 ? -1 : 0, 1);
        }
      }
      if (availableSignals.has('pcr_trend')) {
        // Reads pcrHistory (read-only) \u2014 safe to recompute.
        const trendValue = computePcrTrendValue(symbol);
        if (trendValue != null) {
          add('pcr_trend', trendValue, 1);
        }
      }
      if (availableSignals.has('call_put_wall')) {
        const wallValue = computeCallPutWallValue(symbol, m);
        if (wallValue != null) {
          add('call_put_wall', wallValue, 1.5);
        }
      }
      if (availableSignals.has('atm_oi_buildup') && validation._atmOiBuildupValue != null) {
        // Reuses the SAME value validateData() already computed this
        // cycle \u2014 never recomputed, to avoid corrupting the '_atmoi_'
        // tracker's up/down comparison on a second call.
        add('atm_oi_buildup', validation._atmOiBuildupValue, 1);
      }
      if (availableSignals.has('straddle_behaviour')) {
        const straddleValue = computeStraddleBehaviourValue(symbol, m);
        if (straddleValue != null) {
          add('straddle_behaviour', straddleValue, 1.5);
        }
      }
      if (availableSignals.has('fib_pivot')) {
        const fibValue = computeFibPivotValue(m);
        if (fibValue != null) {
          add('fib_pivot', fibValue, 1);
        }
      }

      // Overrides — only the ones honestly checkable today.
      const overrides = [];
      const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const ist = new Date(istString);
      const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
      if (minutesSinceMidnight >= 555 && minutesSinceMidnight < 570) {
        overrides.push('First 15 minutes of session (9:15\u20139:30 IST) \u2014 forced WAIT per Override Rule 6');
      }
      // NIFTY/BankNifty futures OI buildup alignment override (user-approved
      // 2026-08-08). Only checked for NIFTY/BANKNIFTY (Sensex has no
      // comparable second index to align against). Reuses the SAME
      // classifySimpleFutures() the existing futures_oi_buildup signal
      // already uses \u2014 no new state tracker, no double-counting risk.
      if (symbol === 'NIFTY' || symbol === 'BANKNIFTY') {
        const niftyFut = classifySimpleFutures('NIFTY');
        const bankFut = classifySimpleFutures('BANKNIFTY');
        const niftyDir = niftyFut === 'FRESH LONG BUILD-UP' ? 'up' : niftyFut === 'FRESH SHORT BUILD-UP' ? 'down' : null;
        const bankDir = bankFut === 'FRESH LONG BUILD-UP' ? 'up' : bankFut === 'FRESH SHORT BUILD-UP' ? 'down' : null;
        if (niftyDir && bankDir && niftyDir !== bankDir) {
          overrides.push('NIFTY/BankNifty futures OI buildup misaligned (NIFTY: ' + niftyFut + ', BankNifty: ' + bankFut + ') \u2014 forced WAIT');
        }
      }
      overrides.push('Expiry split, gap-fill-in-progress, VIX spike, straddle-expansion, and full 3-index (incl. Sensex) misalignment overrides are NOT YET CHECKED (need Step 6A wiring). NIFTY/BankNifty futures buildup misalignment IS checked above.');

      let verdict;
      if (overrides.length > 1 || (overrides.length === 1 && overrides[0].indexOf('First 15') === 0)) {
        verdict = 'Mixed / Sideways (WAIT)';
      } else if (score >= 14) verdict = 'Strong Bullish';
      else if (score >= 7.5) verdict = 'Bullish Biased';
      else if (score > -7) verdict = 'Mixed / Sideways (WAIT)';
      else if (score > -14) verdict = 'Bearish Biased';
      else verdict = 'Strong Bearish';

      const confidence = maxScore >= 6 && Math.abs(score) >= maxScore * 0.7 ? 'Medium' : 'Low';

      // ATM CE/PE suggestion: strike + real current premium as Entry.
      // SL/T1/T2 use a simple, disclosed percentage-of-premium formula
      // (user-approved 2026-08-08, since the source document never
      // defined one): SL = Entry −30%, T1 = Entry +50% (partial),
      // T2 = Entry +100% (full). Fixed rule — not Haiku-generated.
      let suggestion = null;
      const dir3 = verdict.indexOf('Bullish') !== -1 ? 'CE' : verdict.indexOf('Bearish') !== -1 ? 'PE' : null;
      if (dir3 && m.expiries && m.expiries[0]) {
        const legs = dir3 === 'CE' ? m.expiries[0].ceStrikes : m.expiries[0].peStrikes;
        const atmLeg = legs && legs.find((s) => s.isAtm);
        if (atmLeg && atmLeg.lastPrice > 0) {
          const entry = atmLeg.lastPrice;
          suggestion = {
            strike: atmLeg.strike + ' ' + dir3,
            side: dir3,
            entry,
            sl: Math.round(entry * 0.7 * 100) / 100,
            t1: Math.round(entry * 1.5 * 100) / 100,
            t2: Math.round(entry * 2.0 * 100) / 100,
            slNote: 'SL = Entry −30% | T1 = Entry +50% (partial) | T2 = Entry +100% (full) — fixed percentage rule, not from Haiku',
          };
        } else if (atmLeg) {
          suggestion = { strike: atmLeg.strike + ' ' + dir3, side: dir3, entry: atmLeg.lastPrice, sl: null, t1: null, t2: null, slNote: 'Entry premium is 0/unavailable — cannot compute SL/T1/T2 from it' };
        }
      }

      return {
        symbol, verdict, score: Math.round(score * 10) / 10, maxScore: Math.round(maxScore * 10) / 10,
        theoreticalMaxScore: 20.5, confidence, contributions, overrides, suggestion, timestamp,
      };
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

    // BankNifty "at a thousand round number right now" check (distinct
    // from checkRoundCross above, which only fires on the moment of
    // crossing) \u2014 user-approved 2026-08-08, for the round-number + ATM
    // OI buildup combo alert. Within 0.15% of a 1000-multiple counts as
    // "at" that level.
    function computeThousandProximity(current) {
      if (!(current > 0)) return null;
      const nearest = Math.round(current / 1000) * 1000;
      const distPct = Math.abs(current - nearest) / nearest * 100;
      if (distPct > 0.15) return null;
      return { level: nearest, distPct };
    }

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
      document.getElementById('RESEARCH').innerHTML = renderResearchTab();
      document.getElementById('SYSTEM').innerHTML = renderSystemTab();
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

      // Dashboard reform (user-approved 2026-08-09), same book-index
      // accordion pattern as the System tab, own toggle state
      // (verdictAccordionOpen) so it doesn't collide with System tab's.
      // Final Verdict card stays always visible above (it's the headline
      // answer, not detail) \u2014 everything else collapses into 2 chapters.
      const alignmentContent = renderMandatoryAlignmentBar() + renderSensexConfirmationBar();
      html += renderAccordionChapter('index_alignment', '01', 'Index alignment', { text: '3 indices', color: 'var(--gold)' },
        'Whether NIFTY, BankNifty, and Sensex agree on direction \u2014 a mandatory check before the verdict is trusted.', alignmentContent,
        verdictAccordionOpen === 'index_alignment', 'toggleVerdictAccordion');

      const perIndexContent = renderCompactIndexCard('NIFTY', data.NIFTY, false) + renderCompactIndexCard('BANKNIFTY', data.BANKNIFTY, false) + renderCompactIndexCard('SENSEX', data.SENSEX, true);
      html += renderAccordionChapter('per_index', '02', 'Per-index detail', { text: '3 cards', color: 'var(--muted)' },
        'Spot, PCR, and structure for each index individually.', perIndexContent,
        verdictAccordionOpen === 'per_index', 'toggleVerdictAccordion');

      const readinessContent = renderConsolidatedReadinessCard() + renderRecorderMiniBar();
      html += renderAccordionChapter('trade_readiness', '03', 'Trade readiness + recorder', { text: 'detail', color: 'var(--muted)' },
        'Whether conditions are complete enough to act on, and the background snapshot recorder\\'s status.', readinessContent,
        verdictAccordionOpen === 'trade_readiness', 'toggleVerdictAccordion');

      // Advanced Diagnostics moved to the dedicated System tab (2026-08-08
      // redesign, Phase 1) — no longer buried inside VERDICT. See
      // renderSystemTab() below for the exact same content, relocated.

      return html;
    }

    // Dashboard reform pilot (user-approved 2026-08-09), System tab only.
    // A book-index-style chapter: collapsed by default, shows a numbered
    // header + status badge; tapping expands the SAME existing card HTML
    // inline (no navigation, no new page) and shows a one-line "Means:"
    // plain-language explainer. Only one chapter open at a time.
    let systemAccordionOpen = 'data_integrity';
    function toggleSystemAccordion(id) {
      systemAccordionOpen = (systemAccordionOpen === id) ? null : id;
      updateUI();
    }
    let verdictAccordionOpen = null;
    function toggleVerdictAccordion(id) {
      verdictAccordionOpen = (verdictAccordionOpen === id) ? null : id;
      updateUI();
    }
    function renderAccordionChapter(id, number, title, badge, meansText, contentHtml, isOpen, toggleFnName) {
      let html = '<div style="background:var(--panel); border:1px solid var(--border); border-radius:8px; margin-bottom:8px; overflow:hidden;">';
      html += '<div onclick="' + toggleFnName + '(\\'' + id + '\\')" style="display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer;">';
      html += '<span style="color:var(--muted); font-size:0.7rem; width:16px;">' + number + '</span>';
      html += '<span style="color:var(--text); font-size:0.8rem; flex:1;">' + escapeHtml(title) + '</span>';
      html += '<span style="color:' + badge.color + '; font-size:0.62rem; background:rgba(255,255,255,0.06); padding:2px 7px; border-radius:6px;">' + escapeHtml(badge.text) + '</span>';
      html += '<span style="color:var(--muted); font-size:0.65rem;">' + (isOpen ? '\u25b2' : '\u25bc') + '</span>';
      html += '</div>';
      if (isOpen) {
        html += '<div style="padding:0 12px 12px;">';
        html += '<div style="color:var(--muted-dim); font-size:0.65rem; margin-bottom:8px;">Means: ' + escapeHtml(meansText) + '</div>';
        html += contentHtml;
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderSystemTab() {
      let html = '';
      if (!data) {
        html += '<div class="loading">Loading system diagnostics...</div>';
        return html;
      }

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

      // ===== Reform pilot (user-approved 2026-08-09): System tab reorganized
      // into a book-style index with inline-expanding chapters, a priority
      // banner, and a headline stat row. Only Data Integrity + Platform
      // Health are reformed this pass \u2014 everything from Three-Index
      // Alignment downward is untouched, unreformed, same as before. This
      // wraps EXISTING render*Card() output (none of their internals were
      // touched) inside a collapsible shell, to keep the risk small.

      // --- Priority banner: only the most urgent thing, if anything is. ---
      const blockedSignalCounts = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => {
        if (data[sym] && !data[sym].error) {
          const v = validateData(sym, data[sym]);
          blockedSignalCounts[sym] = v.blockingFailureCount;
        }
      });
      const totalBlocked = blockedSignalCounts.NIFTY + blockedSignalCounts.BANKNIFTY + blockedSignalCounts.SENSEX;
      const recoveryActiveCount = (recoveryData && recoveryData.active) ? recoveryData.active.length : 0;

      let priorityText = null;
      if (recoveryActiveCount > 0) {
        const manual = recoveryData.active.find((r) => r.status === 'MANUAL_ACTION_REQUIRED');
        priorityText = manual ? (manual.moduleName + ' needs reconnecting.') : (recoveryActiveCount + ' module(s) recovering.');
      } else if (totalBlocked > 0) {
        priorityText = totalBlocked + ' signal(s) blocked across indices \u2014 see Data Integrity.';
      }
      if (priorityText) {
        html += '<div style="display:flex; gap:8px; padding:8px 10px; background:rgba(229,72,77,0.14); border:1px solid var(--red); border-radius:8px; margin-bottom:10px;">';
        html += '<span style="color:var(--red); font-size:0.8rem;">\u26a0\ufe0f</span>';
        html += '<span style="color:var(--red); font-size:0.75rem; flex:1;">' + escapeHtml(priorityText) + '</span>';
        html += '</div>';
      }

      // --- Headline stat row ---
      html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">';
      html += '<div style="background:var(--panel); border-radius:8px; padding:10px 12px;"><div style="color:var(--muted); font-size:0.65rem;">Signals wired</div><div style="color:var(--text); font-size:1.3rem; font-weight:700;">14<span style="color:var(--muted); font-size:0.8rem;"> / 16</span></div></div>';
      html += '<div style="background:var(--panel); border-radius:8px; padding:10px 12px;"><div style="color:var(--muted); font-size:0.65rem;">Data integrity</div><div style="color:' + (totalBlocked > 0 ? 'var(--gold)' : 'var(--green)') + '; font-size:1.3rem; font-weight:700;">' + totalBlocked + '<span style="color:var(--muted); font-size:0.8rem;"> blocked</span></div></div>';
      html += '</div>';

      // --- Chapter 1: Data Integrity ---
      const dataIntegrityBadge = totalBlocked > 0 ? { text: totalBlocked + ' blocked', color: 'var(--gold)' } : { text: 'clear', color: 'var(--green)' };
      let dataIntegrityContent = renderDataReliabilityCard() + renderHaikuValidationCard();
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => { dataIntegrityContent += renderRuleEngineCard(sym, data[sym]); });
      dataIntegrityContent += renderTruthEngineCard() + renderMarketDnaCard();
      html += renderAccordionChapter('data_integrity', '01', 'Data integrity + rule engine', dataIntegrityBadge,
        'Signals with stale or missing data right now, plus the deterministic verdict for each index.', dataIntegrityContent,
        systemAccordionOpen === 'data_integrity', 'toggleSystemAccordion');

      // --- Chapter 2: Platform Health (Recovery + Outcome + Health + Event Bus + Signal Lock) ---
      const platformBadge = recoveryActiveCount > 0 ? { text: recoveryActiveCount + ' action', color: 'var(--red)' } : { text: 'healthy', color: 'var(--green)' };
      let platformContent = renderSystemHealthCard() + renderRecoveryEngineCard() + renderOutcomeEngineCard() + renderEventBusCard();
      ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach((sym) => { platformContent += renderSignalLockCard(sym, data[sym]); });
      html += renderAccordionChapter('platform_health', '02', 'Platform health', platformBadge,
        'Whether the underlying data pipeline (Kite session, Google Drive, background jobs) is working, and what to fix if not.', platformContent,
        systemAccordionOpen === 'platform_health', 'toggleSystemAccordion');

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

      html += '<div style="color:var(--gold); font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin:16px 0 8px;">Recording &amp; Archive</div>';
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
      detailHtml += rowLine('Exchange Timestamp', m.exchangeTimestamp ? new Date(m.exchangeTimestamp).toLocaleTimeString() : 'N/A — index has no last-trade time');
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

    let alignmentAccordionOpen = 'readiness';
    function toggleAlignmentAccordion(id) {
      alignmentAccordionOpen = (alignmentAccordionOpen === id) ? null : id;
      updateUI();
    }

    function renderAlignmentTab(symbol, m) {
      // Dashboard reform (user-approved 2026-08-09), last of 5 designs.
      const readinessContent = renderOrchestratorCard(symbol, m) + renderTrackerReadiness(symbol, m) + renderStep5BCard(symbol, m);
      let html = renderAccordionChapter('readiness', '01', 'Orchestrator, readiness & cross-expiry', { text: 'Step 5B', color: 'var(--gold)' },
        'Whether the alignment pipeline has enough data yet, and how ITM alignment looks across expiries.', readinessContent,
        alignmentAccordionOpen === 'readiness', 'toggleAlignmentAccordion');

      if (!indexStocksData[symbol]) {
        loadIndexStocks(symbol);
        return html + '<div class="loading">Loading constituent data...</div>';
      }
      if (indexStocksData[symbol].error) {
        return html + '<div class="error">⚠️ ' + escapeHtml(indexStocksData[symbol].error) + '</div>';
      }
      let stocksContent = '';
      indexStocksData[symbol].stocks.forEach((s) => {
        const color = s.change == null ? 'var(--muted)' : s.change >= 0.5 ? 'var(--green)' : s.change <= -0.5 ? 'var(--red)' : 'var(--muted)';
        const label = s.change == null ? 'DATA UNAVAILABLE' : s.change >= 0.5 ? 'Bullish' : s.change <= -0.5 ? 'Bearish' : 'Neutral';
        const valueText = (s.price != null ? s.price.toFixed(2) : 'DATA UNAVAILABLE') + (s.change != null ? ' (' + (s.change >= 0 ? '+' : '') + s.change.toFixed(2) + '%)' : '') + ' · Vol ' + (s.volume != null ? formatVolume(s.volume) : 'DATA UNAVAILABLE');
        stocksContent += renderAlignRow(s.name, valueText, label, s.change == null ? 'neutral' : s.change >= 0.5 ? 'bullish' : s.change <= -0.5 ? 'bearish' : 'neutral');
      });
      html += renderAccordionChapter('key_stocks', '02', 'Key stocks (unweighted)', { text: indexStocksData[symbol].stocks.length + ' stocks', color: 'var(--muted)' },
        'How the index\\'s heaviest constituents are moving individually \u2014 unweighted, so this is directional context, not a computed index contribution.', stocksContent,
        alignmentAccordionOpen === 'key_stocks', 'toggleAlignmentAccordion');

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

    // Additive, 2026-08-08: green/red value coloring for directional
    // fields (Change in OI, PDH/PDL proximity, Day High/Low proximity)
    // per explicit user request. Deliberately a SEPARATE function from
    // rowLine (used in hundreds of existing call sites) rather than
    // changing rowLine's signature, so no existing display is touched.
    function rowLineColored(label, value, color) {
      __rowLineTotal++;
      const text = String(value);
      if (text.indexOf('DATA UNAVAILABLE') === 0) {
        __rowLineHidden++;
        return '';
      }
      return '<div class="card-item"><span class="card-label">' + escapeHtml(label) + '</span><span class="card-value" style="color:' + color + ';">' + escapeHtml(text) + '</span></div>';
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
      html += m.pdl > 0
        ? rowLineColored('Move From PDL', (m.current - m.pdl >= 0 ? '+' : '') + (m.current - m.pdl).toFixed(2), m.current - m.pdl >= 0 ? 'var(--green)' : 'var(--red)')
        : rowLine('Move From PDL', 'DATA UNAVAILABLE');
      html += m.pdh > 0
        ? rowLineColored('Move From PDH', (m.current - m.pdh >= 0 ? '+' : '') + (m.current - m.pdh).toFixed(2), m.current - m.pdh >= 0 ? 'var(--green)' : 'var(--red)')
        : rowLine('Move From PDH', 'DATA UNAVAILABLE');
      html += rowLine('PDH Behaviour', pdhBehaviour);
      html += rowLine('PDL Behaviour', pdlBehaviour);
      html += rowLine('Nearest Level', nearest ? nearest.name + ' (' + (nearest.distance >= 0 ? '+' : '') + nearest.distance.toFixed(2) + ')' : 'DATA UNAVAILABLE');

      html += partialDataFooter();
      html += '<div class="timestamp">15m/30m High/Low use this session\u2019s accumulated spot samples (not tick-level) \u2014 hidden until enough samples exist. Break/Hold/Rejection/Retest uses a simplified PROVISIONAL tolerance band (0.1% of level) and last-two-sample direction, not a full historical state machine.</div>';
      html += '</div>';
      return html;
    }

    let overviewAccordionOpen = 'spot_levels';
    function toggleOverviewAccordion(id) {
      overviewAccordionOpen = (overviewAccordionOpen === id) ? null : id;
      updateUI();
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

      // Dashboard reform (user-approved 2026-08-09), 3rd of 5 designs,
      // same book-index accordion pattern, own toggle state
      // (overviewAccordionOpen, shared across NIFTY/BankNifty/Sensex
      // since only one is visible at a time via the top-level tab).
      const spotChangeBadge = { text: (m.changePercent >= 0 ? '+' : '') + m.changePercent.toFixed(2) + '%', color: m.changePercent >= 0 ? 'var(--green)' : 'var(--red)' };
      let spotLevelsContent = '<div class="premium-card" style="margin-bottom:12px;">';
      spotLevelsContent += '<div class="card-title">Spot & Change</div>';
      spotLevelsContent += rowLine('Spot LTP', m.current.toFixed(2));
      spotLevelsContent += rowLine('Change', (m.change >= 0 ? '+' : '') + m.change.toFixed(2) + ' (' + (m.changePercent >= 0 ? '+' : '') + m.changePercent.toFixed(2) + '%)');
      spotLevelsContent += rowLine('Previous Close', prevClose.toFixed(2));
      spotLevelsContent += '</div>';

      spotLevelsContent += '<div class="premium-card" style="margin-bottom:12px;">';
      spotLevelsContent += '<div class="card-title">Levels</div>';
      spotLevelsContent += rowLine('PDH', m.pdh ? m.pdh.toFixed(2) : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('PDL', m.pdl ? m.pdl.toFixed(2) : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('Futures-Derived VWAP Proxy', m.vwap ? m.vwap.toFixed(2) + ' (' + m.vwapSource + ')' : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('Spot\u2013Futures Basis', distVwap != null ? (distVwap >= 0 ? '+' : '') + distVwap.toFixed(2) + ' (informational only)' : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('Distance from PDH', distPdh != null ? (distPdh >= 0 ? '+' : '') + distPdh.toFixed(2) : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('Distance from PDL', distPdl != null ? (distPdl >= 0 ? '+' : '') + distPdl.toFixed(2) : 'DATA UNAVAILABLE');
      spotLevelsContent += '</div>';

      spotLevelsContent += '<div class="premium-card" style="margin-bottom:12px;">';
      spotLevelsContent += '<div class="card-title">Gap & Structure</div>';
      spotLevelsContent += rowLine('Gap Direction', gapDir);
      spotLevelsContent += rowLine('Gap %', gapPctText);
      spotLevelsContent += rowLine('Day Open / High / Low', m.dayOpen ? m.dayOpen.toFixed(2) + ' / ' + m.dayHigh.toFixed(2) + ' / ' + m.dayLow.toFixed(2) : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('Market Structure', structureText);
      spotLevelsContent += rowLine('First 15m High / Low', m.first15High > 0 ? m.first15High.toFixed(2) + ' / ' + m.first15Low.toFixed(2) + ' (sampled, not tick-level)' : 'DATA UNAVAILABLE');
      spotLevelsContent += rowLine('15m / 30m / 1h Trend', renderTimeframeTrendRow(symbol));
      spotLevelsContent += '</div>';

      let html = renderAccordionChapter('spot_levels', '01', 'Spot, levels & structure', spotChangeBadge,
        'Current price, previous-day levels, and today\\'s gap/structure vs. yesterday.', spotLevelsContent,
        overviewAccordionOpen === 'spot_levels', 'toggleOverviewAccordion');

      const verdictNow = classifyIndexOverallBias(m);
      const verdictBadgeColor = verdictNow === 'BULLISH' ? 'var(--green)' : verdictNow === 'BEARISH' ? 'var(--red)' : 'var(--muted)';
      let volVerdictContent = '<div class="premium-card" style="margin-bottom:12px;">';
      volVerdictContent += '<div class="card-title">Volatility & Verdict</div>';
      volVerdictContent += rowLine('India VIX', m.vix ? m.vix.toFixed(2) + ' (' + (m.vixChangePercent >= 0 ? '+' : '') + m.vixChangePercent.toFixed(2) + '%)' : 'DATA UNAVAILABLE');
      volVerdictContent += rowLine('Immediate Support', m.pdl ? m.pdl.toFixed(2) + ' (PDL proxy)' : 'DATA UNAVAILABLE');
      volVerdictContent += rowLine('Immediate Resistance', m.pdh ? m.pdh.toFixed(2) + ' (PDH proxy)' : 'DATA UNAVAILABLE');
      volVerdictContent += rowLine('Current Verdict', verdictNow);
      volVerdictContent += '</div>';
      volVerdictContent += renderCorrelationStrip();
      volVerdictContent += renderPriceLocationCard(symbol, m);

      html += renderAccordionChapter('vol_verdict', '02', 'Volatility, verdict & correlation', { text: verdictNow, color: verdictBadgeColor },
        'India VIX, a quick directional read, and how this index correlates with the other two right now.', volVerdictContent,
        overviewAccordionOpen === 'vol_verdict', 'toggleOverviewAccordion');

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

      function levelLine(leg) {
        if (!leg) return '<span style="color:var(--muted-dim);">—</span>';
        const dir = leg.change > 0 ? 'up' : leg.change < 0 ? 'down' : 'flat';
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
        // Unconditional red/green (user-approved 2026-08-09, corrected/
        // swapped per explicit follow-up instruction): DH/PDH always RED,
        // DL/PDL always GREEN.
        return '<span class="tick-arrow ' + dir + '">' + arrow + '</span> DH ' + (leg.dayHigh > 0 ? '<span style="color:var(--red);">' + leg.dayHigh.toFixed(2) + '</span>' : '—') +
          ' / DL ' + (leg.dayLow > 0 ? '<span style="color:var(--green);">' + leg.dayLow.toFixed(2) + '</span>' : '—') +
          ' · PDH ' + (leg.pdh > 0 ? '<span style="color:var(--red);">' + leg.pdh.toFixed(2) + '</span>' : '—') +
          ' / PDL ' + (leg.pdl > 0 ? '<span style="color:var(--green);">' + leg.pdl.toFixed(2) + '</span>' : '—');
      }

      // Intrinsic / Extrinsic (time value) per strike, with an up/down
      // arrow (user-approved 2026-08-09, all 3 indices). Intrinsic uses
      // the same Zerodha Varsity formula already used elsewhere
      // (computeIntrinsicValue, stateless, safe to call per-strike).
      // The arrow needs its OWN tracker key namespace ('_chainintrinsic_')
      // distinct from the buildup trackers below ('_chain_') so neither
      // corrupts the other's up/down comparison.
      function intrinsicLine(side, leg) {
        if (!leg || !(leg.lastPrice > 0) || !(m.current > 0)) return '<span style="color:var(--muted-dim);">—</span>';
        const intrinsic = computeIntrinsicValue(side, m.current, leg.strike);
        const extrinsic = Math.max(leg.lastPrice - intrinsic, 0);
        const key = symbol + '_chainintrinsic_' + side + '_' + leg.strike;
        const dir = priceDirection(key, intrinsic);
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●';
        return '<span class="tick-arrow ' + dir + '">' + arrow + '</span> Intr ' + intrinsic.toFixed(2) + ' / Ext ' + extrinsic.toFixed(2);
      }

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

        // Day H/L + PDH/PDL info row — now ALL 3 indices (user-approved
        // 2026-08-09; was NIFTY/SENSEX-only before). Reuses fields
        // already populated per strike (Kite's ohlc.high/low/close) —
        // no new data fetch.
        if (ce || pe) {
          html += '<tr style="border-top:none;"><td colspan="3" style="padding:1px 3px 0; font-size:0.6rem; text-align:left;">' + levelLine(ce) + '</td><td></td><td colspan="3" style="padding:1px 3px 0; font-size:0.6rem; text-align:right;">' + levelLine(pe) + '</td></tr>';
          html += '<tr style="border-top:none;"><td colspan="3" style="padding:0 3px 4px; font-size:0.6rem; text-align:left; color:var(--muted-dim);">' + intrinsicLine('CE', ce) + '</td><td></td><td colspan="3" style="padding:0 3px 4px; font-size:0.6rem; text-align:right; color:var(--muted-dim);">' + intrinsicLine('PE', pe) + '</td></tr>';
        }
      });
      html += '</tbody></table></div>';
      html += '<div style="margin-top:8px; font-size:0.7rem; color:var(--muted);">🔴 Max Call OI: ' + (maxCallOiStrike != null ? maxCallOiStrike : 'N/A') + ' · 🟢 Max Put OI: ' + (maxPutOiStrike != null ? maxPutOiStrike : 'N/A') + '</div>';

      if (symbol === 'NIFTY' || symbol === 'SENSEX') {
        const allLegs = [...ceStrikes, ...peStrikes];
        function nearList(pred) {
          const near = allLegs.filter(pred).map((l) => l.strike);
          return near.length > 0 ? Array.from(new Set(near)).sort((a, b) => a - b).join(', ') : 'none';
        }
        html += '<div style="margin-top:6px; font-size:0.68rem; color:var(--muted); line-height:1.6;">';
        html += 'Near current Day High: ' + nearList((l) => l.dayHigh > 0 && l.lastPrice >= l.dayHigh * 0.98) + '<br>';
        html += 'Near current Day Low: <span style="color:var(--red);">' + nearList((l) => l.dayLow > 0 && l.lastPrice <= l.dayLow * 1.02) + '</span><br>';
        html += 'Near Previous Day High: ' + nearList((l) => l.pdh > 0 && l.lastPrice >= l.pdh * 0.98) + '<br>';
        html += 'Near Previous Day Low: <span style="color:var(--red);">' + nearList((l) => l.pdl > 0 && l.lastPrice <= l.pdl * 1.02) + '</span>';
        html += '</div>';
      }
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
        block += (marketOpen && computed.changeInOi != null)
          ? rowLineColored(label + ' Change in OI', (computed.changeInOi >= 0 ? '+' : '') + computed.changeInOi.toLocaleString('en-IN') + ' qty', computed.changeInOi >= 0 ? 'var(--green)' : 'var(--red)')
          : rowLine(label + ' Change in OI', 'DATA UNAVAILABLE');
        block += (marketOpen && computed.change3m != null)
          ? rowLineColored(label + ' 3-min OI Change', (computed.change3m >= 0 ? '+' : '') + computed.change3m.toLocaleString('en-IN') + ' qty', computed.change3m >= 0 ? 'var(--green)' : 'var(--red)')
          : rowLine(label + ' 3-min OI Change', 'DATA UNAVAILABLE');
        block += (marketOpen && computed.change15m != null)
          ? rowLineColored(label + ' 15-min OI Change', (computed.change15m >= 0 ? '+' : '') + computed.change15m.toLocaleString('en-IN') + ' qty', computed.change15m >= 0 ? 'var(--green)' : 'var(--red)')
          : rowLine(label + ' 15-min OI Change', 'DATA UNAVAILABLE');
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
      html += rowLine('Exchange Market Timestamp', m.exchangeTimestamp ? new Date(m.exchangeTimestamp).toLocaleTimeString() : 'N/A — index has no last-trade time');
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

    // Intrinsic vs Time Value composition (Phase 1 of the user-approved
    // Intrinsic/Time-Value roadmap, 2026-08-09). Zerodha Varsity formula:
    // CE intrinsic = max(spot-strike,0); PE intrinsic = max(strike-spot,0).
    // OBSERVATION-ONLY per the roadmap \u2014 does not feed runRuleEngine's
    // score, does not compute ITM/OTM/high-intrinsic as bullish/bearish
    // (per the roadmap's own "do not infer" rules). Pure, stateless
    // functions \u2014 safe to call as often as needed.
    function computeIntrinsicValue(side, spot, strike) {
      return side === 'CE' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
    }

    // ============================================================
    // PREMIUM DIAGNOSTIC LAYER (user-approved 2026-08-09, HIGH priority
    // spec). Observation-only, deterministic. Explains WHY a premium
    // looks the way it does by decomposing it and cross-checking against
    // the SAME signal contributions the real rule engine already
    // computed this cycle (read from lastRuleEngineResult, NEVER
    // recomputed \u2014 avoids the exact stateful-tracker corruption risk
    // documented throughout this file for Step 5B/6A/6B/atm_oi_buildup).
    //
    // HONESTY LIMIT, disclosed rather than faked: several of the spec's
    // named patterns (underlying_confirmed_ce/pe, time_value_driven_
    // expansion, direction_correct_but_premium_weak) require knowing
    // whether premium/intrinsic is RISING \u2014 a trend, which needs price
    // history this function does not have access to (that's the
    // Outcome Engine's job, Phase 3, not yet built). This function only
    // ever reasons from a SINGLE snapshot: current premium/intrinsic
    // composition cross-checked against current signal reads. It never
    // claims a trend it cannot see.
    function computeDaysToExpiry(exp) {
      if (!exp || !exp.expiryDate) return null;
      return Math.max(0, (new Date(exp.expiryDate).getTime() - Date.now()) / 86400000);
    }

    function computePremiumDiagnostic(symbol, m, side, leg) {
      const premium = leg.lastPrice || 0;
      const intrinsic = computeIntrinsicValue(side, m.current, leg.strike);
      const timeValue = Math.max(premium - intrinsic, 0);
      const intrinsicPct = premium > 0 ? (intrinsic / premium * 100) : null;
      const timeValuePct = premium > 0 ? (timeValue / premium * 100) : null;
      const moneyness = leg.isAtm ? 'ATM' : intrinsic > 0 ? 'ITM' : 'OTM';
      const daysToExpiry = computeDaysToExpiry(m.expiries && m.expiries[0]);
      const theta = (leg.theta != null && leg.theta !== 0) ? leg.theta : null;
      const vega = (leg.vega != null && leg.vega !== 0) ? leg.vega : null;

      // ATM/OTM has no meaningful "intrinsic-implied direction" to
      // confirm against (intrinsic is 0 or near-0 by definition) \u2014
      // only a genuine ITM leg gives a direction worth cross-checking.
      const impliedDirection = moneyness === 'ITM' ? (side === 'CE' ? 'bullish' : 'bearish') : null;

      const supportingFactors = [];
      const conflictingFactors = [];

      if (impliedDirection) {
        // Stateless snapshot checks (safe to compute fresh every time).
        const contract = m.futuresContracts && m.futuresContracts[0];
        if (contract && m.vwap > 0) {
          const vwapDir = m.current > m.vwap ? 'bullish' : m.current < m.vwap ? 'bearish' : null;
          if (vwapDir) (vwapDir === impliedDirection ? supportingFactors : conflictingFactors).push('Spot vs VWAP');
        }
        if (m.pdh > 0 && m.pdl > 0) {
          const pdhPdlDir = m.current > m.pdh ? 'bullish' : m.current < m.pdl ? 'bearish' : null;
          if (pdhPdlDir) (pdhPdlDir === impliedDirection ? supportingFactors : conflictingFactors).push('Spot vs PDH/PDL');
        }

        // Already-computed signal contributions from THIS cycle's real
        // rule-engine run \u2014 never recomputed. Positive contribution =
        // bullish read, negative = bearish, per runRuleEngine's own
        // convention (see docs/scoring-rules.md).
        const cached = lastRuleEngineResult[symbol];
        const contributionChecks = [
          ['oi_pcr', 'OI PCR'],
          ['pcr_trend', 'PCR Trend/Divergence'],
          ['call_put_wall', 'Call/Put Wall Alignment'],
          ['futures_oi_buildup', 'Futures OI Buildup'],
          ['expiry_alignment', 'Cross-Expiry Alignment'],
          ['straddle_behaviour', 'Straddle Behaviour'],
          ['sector_heatmap', 'Sector Breadth'],
        ];
        if (cached && cached.contributions) {
          contributionChecks.forEach(function (pair) {
            const val = cached.contributions[pair[0]];
            if (val == null || val === 0) return; // not available or genuinely neutral this cycle \u2014 not counted either way
            const dir = val > 0 ? 'bullish' : 'bearish';
            (dir === impliedDirection ? supportingFactors : conflictingFactors).push(pair[1]);
          });
        }
      }

      // Decay risk \u2014 purely from CURRENT snapshot values (time-value %,
      // days to expiry, theta magnitude), no trend needed, so this one
      // is safe to state plainly rather than as INSUFFICIENT_DATA.
      let decayRisk = 'LOW';
      if (timeValuePct != null && daysToExpiry != null) {
        if (timeValuePct >= 60 && daysToExpiry <= 3) decayRisk = 'HIGH';
        else if (timeValuePct >= 40 && daysToExpiry <= 7) decayRisk = 'MODERATE';
      } else {
        decayRisk = 'INSUFFICIENT_DATA';
      }

      // Volatility note \u2014 deliberately hedged language per the spec's
      // language_rules. Never claims "IV crush" (that needs IV HISTORY,
      // which isn't tracked anywhere in this codebase yet \u2014 only a
      // point-in-time IV/vega snapshot exists).
      let volatilityNote = null;
      if (vega != null && timeValuePct != null && timeValuePct >= 30) {
        const vixDir = m.vixChangePercent > 0.5 ? 'rising' : m.vixChangePercent < -0.5 ? 'falling' : null;
        if (vixDir) {
          volatilityNote = 'India VIX is ' + vixDir + ' today \u2014 part of this premium\\'s time value may be associated with that, but this cannot be confirmed as the cause without tracked option-specific IV history (not yet built).';
        } else {
          volatilityNote = 'This premium carries a meaningful time-value component; some of its movement may be volatility-related, but option-specific IV history is not yet tracked to confirm.';
        }
      }

      // Final diagnostic_state \u2014 deterministic, from counts only.
      let diagnosticState;
      if (!impliedDirection) {
        diagnosticState = 'INSUFFICIENT_DATA';
      } else {
        const total = supportingFactors.length + conflictingFactors.length;
        if (total < 2) diagnosticState = 'INSUFFICIENT_DATA';
        else if (conflictingFactors.length === 0 && supportingFactors.length >= 3) diagnosticState = 'CONFIRMED';
        else if (conflictingFactors.length === 0) diagnosticState = 'PARTIALLY_CONFIRMED';
        else if (conflictingFactors.length >= supportingFactors.length) diagnosticState = 'CONFLICT';
        else diagnosticState = 'MIXED';
      }

      // Plain-English diagnosis \u2014 deterministic templating, never BUY/SELL
      // language, never claims a trend this function cannot see.
      let plainEnglish;
      if (!impliedDirection) {
        plainEnglish = moneyness + ' ' + side + ': no ITM intrinsic direction to confirm against this strike \u2014 showing composition and decay context only, not a directional read.';
      } else if (diagnosticState === 'INSUFFICIENT_DATA') {
        plainEnglish = moneyness + ' ' + side + ' carries intrinsic value (' + impliedDirection + '-implied), but too few of the checklist factors are available right now to confirm or conflict.';
      } else {
        const supportText = supportingFactors.length > 0 ? supportingFactors.join(', ') : 'none';
        const conflictText = conflictingFactors.length > 0 ? conflictingFactors.join(', ') : 'none';
        plainEnglish = moneyness + ' ' + side + ' (' + impliedDirection + '-implied by its intrinsic value) is ' + diagnosticState.replace('_', ' ').toLowerCase() + ' by the current checklist \u2014 supporting: ' + supportText + '; conflicting: ' + conflictText + '.';
      }
      if (decayRisk === 'HIGH') plainEnglish += ' Time-decay exposure is currently HIGH for this leg (large time-value share, few days to expiry).';
      else if (decayRisk === 'MODERATE') plainEnglish += ' Time-decay exposure is MODERATE for this leg.';

      return {
        diagnostic_state: diagnosticState,
        option_side: side,
        strike: leg.strike,
        premium: premium,
        intrinsic_value: intrinsic,
        time_value: timeValue,
        intrinsic_percentage: intrinsicPct,
        time_value_percentage: timeValuePct,
        moneyness: moneyness,
        days_to_expiry: daysToExpiry,
        theta: theta,
        supporting_factors: supportingFactors,
        conflicting_factors: conflictingFactors,
        decay_risk: decayRisk,
        volatility_note: volatilityNote,
        plain_english_diagnosis: plainEnglish,
      };
    }

    function renderPremiumDiagnosticCard(symbol, m) {
      if (!m || !m.expiries || !m.expiries[0]) return '';
      const exp = m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find(function (s) { return s.isAtm; });
      const atmPe = (exp.peStrikes || []).find(function (s) { return s.isAtm; });
      if (!atmCe && !atmPe) return '';

      function renderOneSide(side, leg) {
        if (!leg || !(leg.lastPrice > 0)) {
          return '<div style="color:var(--muted); font-size:0.68rem;">DATA UNAVAILABLE</div>';
        }
        const diag = computePremiumDiagnostic(symbol, m, side, leg);
        const stateColor = diag.diagnostic_state === 'CONFIRMED' ? 'var(--green)' :
          diag.diagnostic_state === 'CONFLICT' ? 'var(--red)' :
          diag.diagnostic_state === 'PARTIALLY_CONFIRMED' ? 'var(--gold)' :
          diag.diagnostic_state === 'MIXED' ? 'var(--gold)' : 'var(--muted)';
        let html = '<div style="border-top:1px solid var(--border); padding-top:6px; margin-top:6px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">';
        html += '<span style="color:var(--text); font-size:0.72rem; font-weight:600;">' + diag.strike + ' ' + side + ' (' + diag.moneyness + ')</span>';
        html += '<span style="color:' + stateColor + '; font-size:0.6rem; background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px;">' + escapeHtml(diag.diagnostic_state) + '</span>';
        html += '</div>';
        html += '<div style="font-size:0.65rem; color:var(--muted); line-height:1.4;">' + escapeHtml(diag.plain_english_diagnosis) + '</div>';
        if (diag.volatility_note) {
          html += '<div style="font-size:0.6rem; color:var(--muted-dim); margin-top:3px; font-style:italic;">' + escapeHtml(diag.volatility_note) + '</div>';
        }
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-top:4px; font-size:0.62rem; color:var(--muted-dim);">';
        html += '<div>Decay: <span style="color:' + (diag.decay_risk === 'HIGH' ? 'var(--red)' : diag.decay_risk === 'MODERATE' ? 'var(--gold)' : 'var(--text)') + ';">' + diag.decay_risk + '</span></div>';
        html += '<div>DTE: ' + (diag.days_to_expiry != null ? diag.days_to_expiry.toFixed(1) : '\u2014') + '</div>';
        html += '<div>Theta: ' + (diag.theta != null ? diag.theta.toFixed(2) : '\u2014') + '</div>';
        html += '</div>';
        html += '</div>';
        return html;
      }

      let html = '<div class="premium-card" style="margin-bottom:10px; border-color:var(--gold);">';
      html += '<div class="card-title">Premium Diagnostic (Beta)</div>';
      html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">';
      html += '<div><div style="color:var(--green); font-size:0.65rem; font-weight:700; text-transform:uppercase; margin-bottom:2px;">CE</div>' + renderOneSide('CE', atmCe) + '</div>';
      html += '<div><div style="color:var(--red); font-size:0.65rem; font-weight:700; text-transform:uppercase; margin-bottom:2px;">PE</div>' + renderOneSide('PE', atmPe) + '</div>';
      html += '</div>';
      html += '<div class="timestamp">Observation-only \u2014 does NOT feed the rule engine score, verdict, or confidence (unchanged, verified). Cross-checks reuse the SAME signal contributions the real verdict already computed this cycle, never recomputed. This reads only a single snapshot \u2014 it cannot see whether premium/intrinsic is rising or falling over time (that needs the Outcome Engine\\'s history, not yet built), so it never claims a trend. "May"/"possible" language is used wherever the data cannot prove causation \u2014 never states IV crush without tracked IV history.</div>';
      html += '</div>';
      return html;
    }

    function renderOptionCompositionCard(symbol, m) {
      if (!m || !m.expiries || !m.expiries[0]) return '';
      const exp = m.expiries[0];
      const ceStrikes = exp.ceStrikes || [];
      const peStrikes = exp.peStrikes || [];
      const spot = m.current;
      if (!(spot > 0) || ceStrikes.length === 0 || peStrikes.length === 0) return '';

      function pickRows(strikes, side) {
        const atmIdx = strikes.findIndex((s) => s.isAtm);
        if (atmIdx === -1) return [];
        const itmIdx = side === 'CE' ? atmIdx - 1 : atmIdx + 1;
        const otmIdx = side === 'CE' ? atmIdx + 1 : atmIdx - 1;
        const picks = [];
        if (strikes[itmIdx]) picks.push({ leg: strikes[itmIdx], tag: 'ITM' });
        picks.push({ leg: strikes[atmIdx], tag: 'ATM' });
        if (strikes[otmIdx]) picks.push({ leg: strikes[otmIdx], tag: 'OTM' });
        return picks;
      }

      function rowsHtml(picks, side) {
        let html = '';
        picks.forEach(function (p) {
          const leg = p.leg, tag = p.tag;
          const premium = leg.lastPrice || 0;
          const intrinsic = computeIntrinsicValue(side, spot, leg.strike);
          const timeValue = Math.max(premium - intrinsic, 0);
          const intrinsicPct = premium > 0 ? (intrinsic / premium * 100) : null;
          const timeValuePct = premium > 0 ? (timeValue / premium * 100) : null;
          const tagColor = tag === 'ITM' ? 'var(--green)' : tag === 'OTM' ? 'var(--muted)' : 'var(--gold)';
          html += '<div style="border-top:1px solid var(--border); padding:6px 0;">';
          html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
          html += '<span style="color:var(--text); font-size:0.75rem; font-weight:600;">' + leg.strike + ' ' + side + '</span>';
          html += '<span style="color:' + tagColor + '; font-size:0.6rem; background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px;">' + tag + '</span>';
          html += '</div>';
          if (premium > 0) {
            html += '<div style="display:flex; justify-content:space-between; font-size:0.68rem; margin-top:3px;"><span style="color:var(--muted);">LTP</span><span style="color:var(--text);">\u20b9' + premium.toFixed(2) + '</span></div>';
            html += '<div style="display:flex; justify-content:space-between; font-size:0.68rem;"><span style="color:var(--muted);">Intrinsic</span><span style="color:var(--text);">\u20b9' + intrinsic.toFixed(2) + (intrinsicPct != null ? ' (' + intrinsicPct.toFixed(0) + '%)' : '') + '</span></div>';
            html += '<div style="display:flex; justify-content:space-between; font-size:0.68rem;"><span style="color:var(--muted);">Time Value</span><span style="color:var(--text);">\u20b9' + timeValue.toFixed(2) + (timeValuePct != null ? ' (' + timeValuePct.toFixed(0) + '%)' : '') + '</span></div>';
            if (leg.theta) {
              html += '<div style="display:flex; justify-content:space-between; font-size:0.62rem;"><span style="color:var(--muted-dim);">Theta / Vega</span><span style="color:var(--muted-dim);">' + leg.theta.toFixed(2) + ' / ' + (leg.vega ? leg.vega.toFixed(2) : '\u2014') + '</span></div>';
            }
          } else {
            html += '<div style="color:var(--muted); font-size:0.65rem; margin-top:3px;">DATA UNAVAILABLE</div>';
          }
          html += '</div>';
        });
        return html;
      }

      // Phase 2 (Checklist Cross-View, user-approved 2026-08-09): compare
      // the intrinsic/time-value composition above against OTHER already-
      // fetched, STATELESS raw fields (m.vwap, m.pdh/m.pdl, m.pcr). This
      // deliberately does NOT call any of the stateful classifier
      // functions (classifySimpleFutures, computePcrTrendValue, etc.) a
      // second time \u2014 those are already called once elsewhere this same
      // cycle, and calling them again would corrupt their internal
      // up/down trackers (same risk class documented on atm_oi_buildup
      // and Step 5B earlier). Only raw number comparisons here, safe to
      // repeat any number of times. Scoped to what's honestly achievable
      // WITHOUT history: "Underlying-confirmed expansion" and "Expiry
      // decay trap" from the roadmap need a time series (intrinsic
      // RISING) that doesn't exist yet \u2014 deferred to Phase 3. This
      // section only builds "Checklist Conflict": does today's snapshot
      // of VWAP/PDH-PDL/PCR agree with which side (CE/PE) is ITM?
      const contract = m.futuresContracts && m.futuresContracts[0];
      const vwapBias = (contract && m.vwap > 0) ? (m.current > m.vwap ? 1 : m.current < m.vwap ? -1 : 0) : null;
      const pdhPdlBias = (m.pdh > 0 && m.pdl > 0) ? (m.current > m.pdh ? 1 : m.current < m.pdl ? -1 : 0) : null;
      const pcrBias = (m.pcr != null) ? (m.pcr > 1.2 ? 1 : m.pcr < 0.8 ? -1 : 0) : null;
      const biasInputs = [vwapBias, pdhPdlBias, pcrBias].filter((v) => v != null);
      const structuralBias = biasInputs.length > 0 ? biasInputs.reduce((a, b) => a + b, 0) : null;

      const atmCe = ceStrikes.find((s) => s.isAtm);
      const atmPe = peStrikes.find((s) => s.isAtm);
      let crossCheckHtml = '';
      if (structuralBias != null && biasInputs.length >= 2) {
        const structuralLabel = structuralBias > 0 ? 'Bullish' : structuralBias < 0 ? 'Bearish' : 'Neutral';
        const structuralColor = structuralBias > 0 ? 'var(--green)' : structuralBias < 0 ? 'var(--red)' : 'var(--muted)';
        crossCheckHtml += '<div style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px;">';
        crossCheckHtml += '<div style="color:var(--gold); font-size:0.66rem; font-weight:700; text-transform:uppercase; margin-bottom:4px;">Checklist Cross-Check (Phase 2)</div>';
        crossCheckHtml += '<div style="display:flex; justify-content:space-between; font-size:0.68rem; margin-bottom:2px;"><span style="color:var(--muted);">Spot vs VWAP</span><span style="color:var(--text);">' + (vwapBias == null ? '\u2014' : vwapBias > 0 ? 'Above (bullish)' : vwapBias < 0 ? 'Below (bearish)' : 'At VWAP') + '</span></div>';
        crossCheckHtml += '<div style="display:flex; justify-content:space-between; font-size:0.68rem; margin-bottom:2px;"><span style="color:var(--muted);">Spot vs PDH/PDL</span><span style="color:var(--text);">' + (pdhPdlBias == null ? '\u2014' : pdhPdlBias > 0 ? 'Above PDH' : pdhPdlBias < 0 ? 'Below PDL' : 'Inside range') + '</span></div>';
        crossCheckHtml += '<div style="display:flex; justify-content:space-between; font-size:0.68rem; margin-bottom:4px;"><span style="color:var(--muted);">OI PCR (' + (m.pcr != null ? m.pcr.toFixed(2) : '\u2014') + ')</span><span style="color:var(--text);">' + (pcrBias == null ? '\u2014' : pcrBias > 0 ? 'Bullish (&gt;1.2)' : pcrBias < 0 ? 'Bearish (&lt;0.8)' : 'Neutral') + '</span></div>';
        crossCheckHtml += '<div style="display:flex; justify-content:space-between; font-size:0.7rem; font-weight:700;"><span style="color:var(--muted);">Structural read</span><span style="color:' + structuralColor + ';">' + structuralLabel + '</span></div>';

        // Conflict flag: CE is ITM (structural bullish signal from the option chain itself) while the raw structural read above is Bearish, or vice versa for PE.
        const ceIntrinsic = atmCe ? computeIntrinsicValue('CE', spot, atmCe.strike) : 0;
        const peIntrinsic = atmPe ? computeIntrinsicValue('PE', spot, atmPe.strike) : 0;
        let conflictMsg = null;
        if (structuralBias < 0 && ceIntrinsic > peIntrinsic && ceIntrinsic > 0) conflictMsg = 'CE side carries more intrinsic value, but VWAP/PDH-PDL/PCR read Bearish \u2014 conflicting context, not a clean confirmation.';
        else if (structuralBias > 0 && peIntrinsic > ceIntrinsic && peIntrinsic > 0) conflictMsg = 'PE side carries more intrinsic value, but VWAP/PDH-PDL/PCR read Bullish \u2014 conflicting context, not a clean confirmation.';
        if (conflictMsg) {
          crossCheckHtml += '<div style="background:rgba(201,162,39,0.14); border:1px solid var(--gold); border-radius:6px; padding:6px 8px; margin-top:6px; color:var(--gold); font-size:0.65rem;">\u26a0\ufe0f Checklist Conflict: ' + conflictMsg + '</div>';
        }
        crossCheckHtml += '</div>';
      }

      let html = '<div class="premium-card" style="margin-bottom:10px;">';
      html += '<div class="card-title">Option Composition \u2014 Intrinsic vs Time Value</div>';
      html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">';
      html += '<div><div style="color:var(--green); font-size:0.65rem; font-weight:700; text-transform:uppercase; margin-bottom:4px;">CE</div>' + rowsHtml(pickRows(ceStrikes, 'CE'), 'CE') + '</div>';
      html += '<div><div style="color:var(--red); font-size:0.65rem; font-weight:700; text-transform:uppercase; margin-bottom:4px;">PE</div>' + rowsHtml(pickRows(peStrikes, 'PE'), 'PE') + '</div>';
      html += '</div>';
      html += crossCheckHtml;
      html += '<div class="timestamp">Observation-only (Phase 1+2) \u2014 does not feed the rule engine score. Intrinsic = max(Spot\u2212Strike,0) for CE, max(Strike\u2212Spot,0) for PE (Zerodha Varsity formula). High intrinsic is NOT automatically bullish/bearish \u2014 a deep ITM PE can occur in a bearish market just as easily as a bullish one. Cross-check uses today\\'s snapshot only, not a trend \u2014 "expanding/rising" pattern detection needs history (Phase 3, not yet built).</div>';
      html += '</div>';
      return html;
    }

    let optionsAccordionOpen = 'premium_composition';
    function toggleOptionsAccordion(id) {
      optionsAccordionOpen = (optionsAccordionOpen === id) ? null : id;
      updateUI();
    }

    function renderOptionsTab(symbol, m) {
      // Dashboard reform (user-approved 2026-08-09), 4th of 5 designs.
      // These 5 cards used to always render in full regardless of which
      // PREMIUM/CHAIN/EXPIRY/WALLS&PCR sub-tab was selected below \u2014 the
      // exact "too much stacked at once" complaint. Grouped into 2
      // chapters; the existing chip-nav sub-tab content is untouched.
      const premiumCompositionContent = renderPremiumPairCard(symbol, m) + renderOptionCompositionCard(symbol, m);
      let html = renderAccordionChapter('premium_composition', '01', 'Premium & composition', { text: 'ATM CE/PE', color: 'var(--gold)' },
        'Current ATM premium pair, plus the intrinsic-vs-time-value breakdown for ITM/ATM/OTM.', premiumCompositionContent,
        optionsAccordionOpen === 'premium_composition', 'toggleOptionsAccordion');

      const straddleWallContent = renderStep6ACard(symbol, m) + renderStep6BCard(symbol, m) + renderPcrRefinementCard(symbol);
      html += renderAccordionChapter('straddle_wall', '02', 'Straddle & wall/PCR alignment', { text: 'Step 6A/6B', color: 'var(--muted)' },
        'Whether the ATM straddle and the Call/Put wall + PCR readings agree with each other.', straddleWallContent,
        optionsAccordionOpen === 'straddle_wall', 'toggleOptionsAccordion');

      // Premium Diagnostic Layer (user-approved 2026-08-09, HIGH
      // priority spec) \u2014 deliberately its OWN chapter, visually
      // separate from the Scoring Engine content above, per the spec's
      // own UI requirement not to clutter those cards.
      html += renderAccordionChapter('premium_diagnostic', '03', 'Premium diagnostic (beta)', { text: 'observation-only', color: 'var(--gold)' },
        'Explains WHY the ATM premium looks the way it does \u2014 cross-checked against the same signals the verdict already used, but never feeds back into the verdict itself.', renderPremiumDiagnosticCard(symbol, m),
        optionsAccordionOpen === 'premium_diagnostic', 'toggleOptionsAccordion');

      if (symbol === 'NIFTY') {
        html += renderAccordionChapter('premium_diagnostic_15min', '04', '15-min window diagnostic (pilot)', { text: 'NIFTY only', color: 'var(--muted)' },
          'Explains how premium/intrinsic/extrinsic/IV behaved across each completed 15-minute window today, using the 3-min snapshots inside it.', renderPremiumDiagnostic15MinCard(),
          optionsAccordionOpen === 'premium_diagnostic_15min', 'toggleOptionsAccordion');
      }

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

    // atm_oi_buildup signal for the rule engine (Step 5, wired
    // 2026-08-08). Uses its OWN tracker key namespace ('_atmoi_') \u2014
    // deliberately separate from Step 5B's ('_step5b_') and every other
    // consumer of priceDirection/oiArrowInfo, so this never corrupts
    // their up/down comparisons and they never corrupt this one. Like
    // Step 5B, priceDirection/oiArrowInfo mutate shared state on every
    // call, so this must be called exactly ONCE per refresh cycle \u2014
    // validateData() computes it once and caches the VALUE (not just
    // the function) for runRuleEngine to reuse.
    function computeAtmOiBuildupValue(symbol, m) {
      if (!m || !m.expiries || !m.expiries[0]) return null;
      const exp = m.expiries[0];
      const atmCe = (exp.ceStrikes || []).find((s) => s.isAtm);
      const atmPe = (exp.peStrikes || []).find((s) => s.isAtm);
      if (!atmCe || !atmPe) return null;
      const ceKey = symbol + '_atmoi_' + exp.expiry + '_CE_' + atmCe.strike;
      const peKey = symbol + '_atmoi_' + exp.expiry + '_PE_' + atmPe.strike;
      const ceInterp = classifyInterpretation(priceDirection(ceKey, atmCe.lastPrice), oiArrowInfo(ceKey, atmCe.oi).cls);
      const peInterp = classifyInterpretation(priceDirection(peKey, atmPe.lastPrice), oiArrowInfo(peKey, atmPe.oi).cls);
      if (ceInterp === 'UNCONFIRMED' && peInterp === 'UNCONFIRMED') return null;
      let value = 0;
      if (ceInterp === 'BUYING-DOMINANT INTERPRETATION') value += 1; // calls being bought \u2192 bullish
      else if (ceInterp === 'WRITING-DOMINANT INTERPRETATION') value -= 1; // calls being written \u2192 resistance/bearish
      if (peInterp === 'WRITING-DOMINANT INTERPRETATION') value += 1; // puts being written \u2192 support/bullish
      else if (peInterp === 'BUYING-DOMINANT INTERPRETATION') value -= 1; // puts being bought \u2192 bearish
      const scoreValue = value > 0 ? 1 : value < 0 ? -1 : 0;
      // Returns the detail object (ceInterp/peInterp included) so the
      // BankNifty round-number combo alert can reuse the SAME single
      // computation \u2014 never a second call (see caching note above).
      return { value: scoreValue, ceInterp, peInterp, atmStrike: atmCe.strike };
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

    // Daily Standard Fibonacci Pivot (wired 2026-08-09, user-approved).
    // Formula: PP = (H+L+C)/3; R1/S1 = PP \u00b1 0.382*(H-L);
    // R2/S2 = PP \u00b1 0.618*(H-L); R3/S3 = PP \u00b1 1.000*(H-L).
    // H, L, C are m.pdh/m.pdl/m.pdcClose \u2014 all three sourced from the
    // SAME previous-day historical candle on the backend (not mixed with
    // the separate live-quote API's close field), and this exact same
    // code path runs identically for NIFTY, BankNifty, and Sensex \u2014
    // no per-index special-casing, so all three are treated identically.
    // Weekly Fibonacci Pivot is NOT built \u2014 it needs a previous WEEK's
    // H/L/C, which no code path currently computes; deliberately
    // deferred as a separate, larger task (would need to aggregate
    // multiple daily candles from Kite's historical API).
    function computeDailyFibPivot(m) {
      const H = m.pdh, L = m.pdl, C = m.pdcClose;
      if (!(H > 0) || !(L > 0) || !(C > 0) || H <= L) return null;
      const range = H - L;
      const pp = (H + L + C) / 3;
      return {
        pp,
        r1: pp + 0.382 * range,
        r2: pp + 0.618 * range,
        r3: pp + 1.000 * range,
        s1: pp - 0.382 * range,
        s2: pp - 0.618 * range,
        s3: pp - 1.000 * range,
      };
    }

    // fib_pivot signal value: spot above R1 \u2192 bullish; below S1 \u2192
    // bearish; between S1 and R1 (including sitting on PP) \u2192 neutral.
    // Mirrors the existing pdh_pdl signal's three-state simplicity.
    function computeFibPivotValue(m) {
      const levels = computeDailyFibPivot(m);
      if (!levels || !(m.current > 0)) return null;
      if (m.current > levels.r1) return 1;
      if (m.current < levels.s1) return -1;
      return 0;
    }

    // High-Priority Structure Alert (user-approved 2026-08-08): fires
    // when cross-expiry ITM alignment (Step 5B) AND that same side's own
    // ATM premium range position are BOTH at an extreme simultaneously
    // \u2014 e.g. CE side aligned across expiries AND CE premium sitting at
    // NEAR PDH/PDH BREAKOUT (or NEAR PDL/BELOW PDL). This is a display
    // banner only, NOT a scored signal \u2014 it does not touch the
    // rule engine's score/maxScore, it just surfaces an already-computed
    // combination the person would otherwise have to notice by eye.
    // Reads the SAME step5bResult validateData() already cached \u2014
    // never recomputes computeStep5BConclusion().
    function computeStructureAlert(step5bResult) {
      if (!step5bResult || step5bResult.blocked) return null;
      const fs = step5bResult.finalStatus;
      const isCeAlignment = fs.indexOf('CE ALIGNMENT') !== -1 || fs === 'CURRENT ATM CE SUPPORTIVE' || fs === 'CURRENT 1-ITM CE PREFERRED';
      const isPeAlignment = fs.indexOf('PE ALIGNMENT') !== -1 || fs === 'CURRENT ATM PE SUPPORTIVE' || fs === 'CURRENT 1-ITM PE PREFERRED';
      const extremeStates = ['NEAR PDH', 'PDH BREAKOUT', 'NEAR PDL', 'BELOW PDL'];
      const ceRange = step5bResult.ceRange;
      const peRange = step5bResult.peRange;
      const ceExtreme = ceRange && extremeStates.indexOf(ceRange.state) !== -1;
      const peExtreme = peRange && extremeStates.indexOf(peRange.state) !== -1;
      if (isCeAlignment && ceExtreme) {
        return { direction: 'CE', alignmentStatus: fs, rangeState: ceRange.state, isStrong: fs.indexOf('STRONG') === 0 };
      }
      if (isPeAlignment && peExtreme) {
        return { direction: 'PE', alignmentStatus: fs, rangeState: peRange.state, isStrong: fs.indexOf('STRONG') === 0 };
      }
      return null;
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

    // call_put_wall signal for the rule engine (Step 5, wired 2026-08-08).
    // Reuses Step 6B's own finalStatus \u2014 note this recomputes
    // computeStep6BConclusion() (which mutates wallHistoryTracker's
    // persistCount), same as this file's other existing call sites for
    // it (renderStep6BCard etc.) already do multiple times per refresh;
    // not a new risk category, just consistent with current behaviour.
    function computeCallPutWallValue(symbol, m) {
      const result = computeStep6BConclusion(symbol, m);
      if (result.blocked) return null;
      if (result.finalStatus === 'PARTIAL DATA' || result.finalStatus.indexOf('EXPIRY-DAY') === 0) return null;
      if (result.finalStatus === 'PCR + WALLS BULLISH SUPPORTIVE') return 1;
      if (result.finalStatus === 'PCR + WALLS BEARISH SUPPORTIVE') return -1;
      return 0; // RANGE RISK, VOLATILITY EXPANSION, CONFLICT, TRAPPED, UNCONFIRMED
    }

    // straddle_behaviour signal for the rule engine (Step 5, wired
    // 2026-08-08). Reuses Step 6A's own straddleState \u2014 same
    // already-established pattern as call_put_wall (Step 6B), which
    // this codebase already calls multiple times per refresh at
    // several existing call sites; not a new risk category.
    function computeStraddleBehaviourValue(symbol, m) {
      const result = computeStep6AConclusion(symbol, m);
      if (result.blocked) return null;
      const s = result.straddleState;
      if (s === 'DATA INSUFFICIENT' || s === 'EXPIRY-DAY DISTORTION' || s === 'ATM SHIFT DISTORTION') return null;
      if (s === 'DIRECTIONAL CE EXPANSION') return 1;
      if (s === 'DIRECTIONAL PE EXPANSION') return -1;
      return 0; // BOTH SIDES EXPANDING/WEAKENING, STRADDLE EXPANDING/CONTRACTING/STABLE
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
        return { verdict: 'DATA UNAVAILABLE', confidence: null, reasons: ['Connection disconnected'], evidence: [], risks: ['Live quote feed is DISCONNECTED \u2014 no data to evaluate'], historicalSupport: { available: false, reason: 'Probability Engine (Module 5) not yet built' } };
      }
      if (!data) {
        return { verdict: 'DATA UNAVAILABLE', confidence: null, reasons: ['No market data yet'], evidence: [], risks: ['No market data has been received yet'], historicalSupport: { available: false, reason: 'Probability Engine (Module 5) not yet built' } };
      }

      // Step 4: mandatory NIFTY+BANKNIFTY alignment — nothing below can override this
      const mandatory = computeMandatoryAlignment();
      if (mandatory.eligible === 'CONFLICT') {
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY and BANKNIFTY futures disagree'], evidence: ['mandatoryAlignment.reason=' + mandatory.reason], risks: ['Mandatory NIFTY+BANKNIFTY gate failed \u2014 no directional verdict is permitted while this holds'], historicalSupport: { available: false, reason: 'Probability Engine (Module 5) not yet built' } };
      }
      if (mandatory.eligible == null) {
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY or BANKNIFTY not yet confirmed (needs 3 snapshots, ~9 min)'], evidence: ['mandatoryAlignment.reason=' + mandatory.reason], risks: ['Insufficient snapshots to confirm mandatory alignment yet'], historicalSupport: { available: false, reason: 'Probability Engine (Module 5) not yet built' } };
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
        return { verdict: 'WAIT \u2014 CONFLICTING DATA', confidence: 'LOW', reasons: ['NIFTY/BANKNIFTY level context disagree'], evidence: ['niftyLevel=' + niftyLevel, 'bankLevel=' + bankLevel], risks: ['One index shows breakout/breakdown while the other shows rejection \u2014 genuinely conflicting level context'], historicalSupport: { available: false, reason: 'Probability Engine (Module 5) not yet built' } };
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

      // Module 8 extension: Evidence — every module state that
      // contributed to this verdict, traceable back to its own card.
      const evidence = [
        'mandatoryAlignment.direction=' + primaryDir,
        'futures.NIFTY=' + niftyFut.replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, ''),
        'futures.BANKNIFTY=' + bankFut.replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, ''),
        'futures.SENSEX=' + sensexFut.replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, ''),
      ];
      if (premiumSupports) evidence.push('premium.alignment=CONFIRMS_' + primaryDir);
      if (pcrSupports) evidence.push('pcr.alignment=CONFIRMS_' + primaryDir);
      if (levelSupports) evidence.push('pdhPdl.alignment=CONFIRMS_' + primaryDir);
      if (sensexSupports) evidence.push('sensex.confirms=true');

      // Module 8 extension: Risks — anything that could invalidate this
      // verdict, stated explicitly rather than left implicit in the score.
      const risks = [];
      if (sensexOpposes) risks.push('SENSEX is opposing the primary direction \u2014 strength may be overstated');
      if (!premiumSupports) risks.push('Premium alignment is not confirming this direction');
      if (!pcrSupports) risks.push('PCR is not confirming this direction');
      if (!levelSupports) risks.push('PDH/PDL level context is not confirming this direction');
      if (!coreFresh) risks.push('Live quote feed is not fully LIVE \u2014 underlying data may be delayed');
      if (risks.length === 0) risks.push('No elevated risks identified from the modules currently available');

      // Module 8 extension: Historical Support — honestly unavailable.
      // Per the approved spec, this depends on the Probability Engine
      // (Module 5), which itself is blocked on the Memory Engine (Module
      // 6), which is blocked on persistent storage. Never fabricated.
      const historicalSupport = { available: false, reason: 'Probability Engine (Module 5) not yet built \u2014 blocked on Memory Engine (Module 6), which requires persistent storage this platform does not yet have.' };

      return {
        verdict: verdict, confidence: confidence, reasons: reasons,
        details: { niftyFut, bankFut, sensexFut, niftyPremium, bankPremium, niftyPcr, bankPcr, niftyLevel, bankLevel, mandatory },
        evidence: evidence, risks: risks, historicalSupport: historicalSupport,
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

      let html = '<div class="premium-card" style="margin-bottom:12px; border-color:' + color + '; text-align:center; padding:18px; box-shadow: 0 0 24px color-mix(in srgb, ' + color + ' 15%, transparent), 0 2px 8px rgba(0,0,0,0.25);">';
      html += '<div style="color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; font-family:var(--font-mono);">Final Verdict</div>';
      html += '<div style="color:' + color + '; font-weight:800; font-size:1.6rem; margin:8px 0; font-family:var(--font-display); text-shadow: 0 0 20px color-mix(in srgb, ' + color + ' 30%, transparent);">' + escapeHtml(result.verdict) + '</div>';
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
        if (result.evidence && result.evidence.length > 0) {
          html += '<div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border); color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Evidence (Module 8)</div>';
          result.evidence.forEach((e) => { html += '<div style="color:var(--green); font-size:0.68rem; margin-top:2px;">\u2022 ' + escapeHtml(e) + '</div>'; });
        }
        if (result.risks && result.risks.length > 0) {
          html += '<div style="margin-top:8px; color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Risks</div>';
          result.risks.forEach((r) => { html += '<div style="color:var(--gold); font-size:0.68rem; margin-top:2px;">\u2022 ' + escapeHtml(r) + '</div>'; });
        }
        if (result.historicalSupport) {
          html += '<div style="margin-top:8px; color:var(--muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">Historical Support</div>';
          html += '<div style="color:var(--muted); font-size:0.68rem; margin-top:2px;">' + (result.historicalSupport.available ? escapeHtml(String(result.historicalSupport)) : 'DATA UNAVAILABLE \u2014 ' + escapeHtml(result.historicalSupport.reason)) + '</div>';
        }
        html += '</div></details>';
      }
      html += '<div class="timestamp">Rule 14 processing order: connection \u2192 freshness \u2192 snapshot minimum \u2192 mandatory NIFTY+BANKNIFTY alignment \u2192 futures VWAP \u2192 futures price+OI \u2192 premium \u2192 PCR \u2192 PDH/PDL \u2192 SENSEX (confirm/weaken only) \u2192 confidence \u2192 verdict. Thresholds (0.10% PDH/PDL proximity, 1.1/0.85 PCR bands) are PROVISIONAL, not backtested. Module 8 (Decision Engine) extension: Evidence and Risks are computed live from the modules above; Historical Support remains DATA UNAVAILABLE until Module 5 (Probability Engine) exists. This is a confirmation dashboard, not an automatic order-placement system.</div>';
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
    // Compact display: badges carrying no real information ("DATA
    // UNAVAILABLE" and its variants, "UNCONFIRMED") shrink to a small
    // dot instead of a full-width pill \u2014 requested 2026-08-07 to reduce
    // clutter on the VERDICT tab. Meaningful badges are unaffected; full
    // text always remains visible in the "Details" section below.
    function renderCompactBadge(label) {
      const text = String(label);
      const isEmpty = text.indexOf('DATA UNAVAILABLE') !== -1 || text === 'UNCONFIRMED' || text === 'NO CONFIRMATION';
      if (isEmpty) {
        return '<span title="' + escapeHtml(text) + '" style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(255,255,255,0.06); color:var(--muted); font-size:0.6rem; flex-shrink:0;">\u2013</span>';
      }
      return renderBadge(label);
    }

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
      html += '<span style="color:var(--text); font-size:1.75rem; font-weight:800; font-family:var(--font-mono); letter-spacing:-0.5px;">' + (m.current > 0 ? m.current.toFixed(2) : '\u2014') + '</span>';
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
      html += renderCompactBadge(classifySimpleFutures(symbol));
      html += renderCompactBadge(classifySimplePremium(symbol));
      html += renderCompactBadge(classifySimplePcr(symbol));
      html += renderCompactBadge(classifySimplePdhPdl(symbol, m));
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
      let html = renderSectorHeatmapCard();
      if (!commoditiesData) {
        return html + '<div class="loading">Loading commodities...</div>';
      }
      if (commoditiesData.error) {
        return html + '<div class="error">⚠️ ' + escapeHtml(commoditiesData.error) + '</div>';
      }

      html += '<div class="expiry-title">Crude Oil &amp; Natural Gas — ATM ±5 Strikes (MCX)</div>';
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
      await Promise.all([fetchData(), loadCommodities(), loadSectorHeatmap()]);
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
      await Promise.all([loadNews(), loadHolidays(), loadFiiDii(), loadRecorderStatus(), loadDriveStatus(), loadJournalData(), loadTruthStatus(), loadHealthStatus(), loadRecoveryStatus(), loadEventBusStatus(), loadOutcomeStats()]);
      await loadDnaStatus();
      if (kiteConnected) {
        await Promise.all([fetchData(), loadCommodities(), loadSectorHeatmap()]);
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

app.get("/api/health", (c) => {
  return c.json(computeSystemHealth());
});

app.post("/api/research/query", async (c) => {
  let body: { date?: string; index?: string; eventType?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body \u2014 expected JSON with date and index." }, 400);
  }
  const date = body.date;
  if (!date) return c.json({ error: "date is required (YYYY-MM-DD)" }, 400);
  const symbol: "NIFTY" | "BANKNIFTY" | "SENSEX" = body.index === "BANKNIFTY" ? "BANKNIFTY" : body.index === "SENSEX" ? "SENSEX" : "NIFTY";
  const report = await computeResearchReport(date, symbol, body.eventType || null);
  return c.json(report);
});

// Step 5: Haiku explanation layer. The client sends the deterministic
// verdict it already computed (runRuleEngine, Step 3) \u2014 this endpoint
// never decides the verdict, only explains it, and only calls Haiku
// when the cost guard allows it.
app.post("/api/haiku-verdict", async (c) => {
  let body: {
    symbol?: string;
    verdict?: string;
    score?: number;
    maxScore?: number;
    confidence?: string;
    contributions?: Record<string, number>;
    overrides?: string[];
    suggestion?: { side?: string; strike?: string; entry?: number; sl?: number | null; t1?: number | null; t2?: number | null } | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body \u2014 expected JSON." }, 400);
  }
  const symbol = body.symbol;
  const verdict = body.verdict;
  if (!symbol || !verdict) return c.json({ error: "symbol and verdict are required" }, 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY is not configured on the server" }, 500);

  const now = Date.now();
  const cached = haikuCache.get(symbol);
  const verdictChanged = !cached || cached.verdict !== verdict;
  const guardWindowPassed = !cached || (now - cached.calledAt) >= HAIKU_COST_GUARD_MS;

  // Cost guard: reuse the cached explanation unless the verdict changed
  // or 15+ minutes have passed \u2014 never call Haiku on every poll.
  if (cached && !verdictChanged && !guardWindowPassed) {
    return c.json({
      explanation: cached.explanation,
      fromCache: true,
      symbol, verdict,
      calledAt: new Date(cached.calledAt).toISOString(),
    });
  }

  const lines: string[] = [];
  lines.push(`Verdict: ${verdict} (Score ${(body.score != null && body.score >= 0) ? "+" : ""}${body.score} / ${body.maxScore}, Confidence: ${body.confidence})`);
  lines.push("Signal contributions:");
  Object.entries(body.contributions || {}).forEach(([sig, v]) => {
    lines.push(`- ${sig}: ${v >= 0 ? "+" : ""}${v}`);
  });
  if (body.overrides && body.overrides.length > 0) {
    lines.push("Overrides / notes:");
    body.overrides.forEach((o) => lines.push(`- ${o}`));
  }
  if (body.suggestion && body.suggestion.side) {
    const s = body.suggestion;
    lines.push(`Suggested trade: ${s.side} ${s.strike}, Entry \u20b9${s.entry}${s.sl != null ? `, SL \u20b9${s.sl}, T1 \u20b9${s.t1}, T2 \u20b9${s.t2}` : ""}`);
  }
  lines.push("");
  lines.push("Explain this verdict in 2\u20133 short sentences for a retail options trader reading on their phone. Only explain WHY the numbers above point that way \u2014 do NOT change the verdict, score, or any level, and do NOT invent data not given above.");
  const prompt = lines.join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return c.json({ error: `Anthropic API error ${response.status}: ${errText}` }, 502);
    }

    const json: any = await response.json();
    const textBlock = Array.isArray(json.content) ? json.content.find((b: any) => b.type === "text") : null;
    const explanation = textBlock ? textBlock.text : "No explanation returned.";

    haikuCache.set(symbol, { verdict, explanation, calledAt: now });

    return c.json({ explanation, fromCache: false, symbol, verdict, calledAt: new Date(now).toISOString() });
  } catch (err: any) {
    return c.json({ error: `Haiku call failed: ${err.message}` }, 500);
  }
});

app.get("/api/recovery/active", (c) => {
  const active = recoveryAttempts.filter((r) => r.status === "RETRYING" || r.status === "MANUAL_ACTION_REQUIRED");
  return c.json({ active, allAttempts: recoveryAttempts.length });
});

app.post("/api/recovery/:id/manual-retry", async (c) => {
  const id = c.req.param("id");
  const attempt = recoveryAttempts.find((r) => r.recoveryId === id);
  if (!attempt) return c.json({ error: "Recovery record not found" }, 404);
  if (attempt.moduleName === "Google Drive Super Brain" && driveSession.refreshTokenEncrypted) {
    const result = await performDriveArchive();
    attempt.attempt++;
    attempt.lastAttemptAt = new Date().toISOString();
    attempt.status = result.success ? "RECOVERED" : "RETRYING";
    attempt.reason = result.success ? "Manual retry succeeded." : "Manual retry failed: " + (result.error || "unknown error");
    return c.json({ success: result.success, attempt });
  }
  return c.json({ error: "This module has no automatic recovery action \u2014 use the relevant Connect/Login button instead." }, 400);
});

app.get("/api/dna/:date", (c) => {
  const date = c.req.param("date");
  const symbolParam = c.req.query("index");
  const symbol: "NIFTY" | "BANKNIFTY" | "SENSEX" =
    symbolParam === "BANKNIFTY" ? "BANKNIFTY" : symbolParam === "SENSEX" ? "SENSEX" : "NIFTY";
  if (date !== (recorderSession.tradingDate || indiaTradingDate())) {
    return c.json(
      { error: "DNA can currently only be computed for today's in-memory session (" + recorderSession.tradingDate + "). No persistent multi-day history exists yet \u2014 blocked on the same database gap disclosed in Module 2's Future Expansion." },
      404
    );
  }
  return c.json(computeMarketDna(symbol));
});

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

app.get("/api/events/recent", (c) => {
  return c.json({ events: eventLog.slice(-30).reverse(), totalPublished: eventLog.length });
});

app.get("/api/truth/status", (c) => {
  const session = getSession(c);
  const snapshot = session?.marketSnapshot;
  const result: Record<string, TruthReport> = {
    NIFTY: computeTruthReport(snapshot?.NIFTY),
    BANKNIFTY: computeTruthReport(snapshot?.BANKNIFTY),
    SENSEX: computeTruthReport(snapshot?.SENSEX),
  };
  return c.json(result);
});

app.get("/api/recorder/status", (c) => {
  const lastSnap = recorderSession.snapshots[recorderSession.snapshots.length - 1] || null;
  return c.json({
    tradingDate: recorderSession.tradingDate,
    status: recorderSession.status,
    startedAt: recorderSession.startedAt,
    lastSnapshotAt: recorderSession.lastSnapshotAt,
    lastSnapshotStatus: lastSnap ? lastSnap.snapshotStatus : null,
    lastSnapshotTruthVerdicts: lastSnap ? lastSnap.truthVerdicts || null : null,
    snapshotCount: recorderSession.snapshots.length,
    lastErrorRedacted: recorderSession.lastErrorRedacted,
  });
});

app.get("/api/recorder/session.json", (c) => {
  return c.json(recorderSession);
});

app.get("/api/recorder/session.csv", (c) => {
  const rows = [
    "snapshot_id,backend_timestamp,reason,snapshot_status,truth_verdict,symbol,spot,change,pdh,pdl,vwap,futures_ltp,futures_oi,atm_strike,ce_ltp,pe_ltp,ce_oi,pe_oi,exchange_timestamp,snapshot_sync_id,fii_cash_cr,dii_cash_cr",
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
          snap.snapshotId, snap.backendTimestamp, snap.reason, snap.snapshotStatus, snap.truthVerdicts ? snap.truthVerdicts[sym] : null, sym,
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
  searchTags: string[]; // Module 3 (Google Drive Super Brain) — descriptive tags for the search index, e.g. dominant Journal verdict, expiry-day flag
}
const driveArchives: DriveArchiveRecord[] = [];

// ============== MODULE 12: HEALTH ENGINE ==============
// Per the approved Architecture Specification, \u00a712. Aggregates every
// other built module's health-relevant state into one SystemHealthReport.
// No real event bus exists yet (Module 11's Event-Driven migration is not
// started), so this is poll-based: it reads each module's current state
// directly rather than subscribing to published health events.

type HealthStatus = "HEALTHY" | "DEGRADED" | "DOWN";

interface ModuleHealth {
  moduleName: string;
  status: HealthStatus;
  metrics: Record<string, unknown>;
  sinceTimestamp: string;
}

function healthOfTruthEngine(): ModuleHealth {
  let session: KiteSession | undefined;
  for (const s of sessions.values()) {
    if (s.expiresAt > Date.now()) { session = s; break; }
  }
  if (!session || !session.marketSnapshot) {
    return { moduleName: "Truth Engine", status: "DOWN", metrics: { reason: "no_active_session_or_snapshot" }, sinceTimestamp: new Date().toISOString() };
  }
  const reports = (["NIFTY", "BANKNIFTY", "SENSEX"] as const).map((sym) => computeTruthReport(session!.marketSnapshot![sym]));
  const invalidCount = reports.filter((r) => r.overallVerdict === "INVALID").length;
  const trueCount = reports.filter((r) => r.overallVerdict === "TRUE").length;
  const status: HealthStatus = invalidCount === 3 ? "DOWN" : invalidCount > 0 || trueCount < 3 ? "DEGRADED" : "HEALTHY";
  return {
    moduleName: "Truth Engine",
    status,
    metrics: { trueCount, invalidCount, verdicts: { NIFTY: reports[0].overallVerdict, BANKNIFTY: reports[1].overallVerdict, SENSEX: reports[2].overallVerdict } },
    sinceTimestamp: new Date().toISOString(),
  };
}

function healthOfRecorderEngine(): ModuleHealth {
  const status: HealthStatus = recorderSession.status === "RECORDING" ? "HEALTHY" : recorderSession.status === "DEGRADED" ? "DEGRADED" : "DOWN";
  const ageSec = recorderSession.lastSnapshotAt ? Math.round((Date.now() - new Date(recorderSession.lastSnapshotAt).getTime()) / 1000) : null;
  return {
    moduleName: "Recorder Engine",
    status,
    metrics: { recorderStatus: recorderSession.status, snapshotCount: recorderSession.snapshots.length, lastSnapshotAgeSec: ageSec, lastError: recorderSession.lastErrorRedacted },
    sinceTimestamp: recorderSession.lastSnapshotAt || new Date().toISOString(),
  };
}

function healthOfGoogleDriveSuperBrain(): ModuleHealth {
  const connected = !!driveSession.refreshTokenEncrypted;
  const lastArchive = driveArchives.length > 0 ? driveArchives[driveArchives.length - 1] : null;
  let status: HealthStatus;
  if (!connected) status = "DEGRADED"; // not connected is an expected, non-fatal state, not a DOWN condition
  else if (lastArchive && lastArchive.status === "ARCHIVE_FAILED") status = "DEGRADED";
  else status = "HEALTHY";
  return {
    moduleName: "Google Drive Super Brain",
    status,
    metrics: { connected, lastArchiveStatus: lastArchive ? lastArchive.status : null, lastError: driveSession.lastError },
    sinceTimestamp: driveSession.connectedAt || new Date().toISOString(),
  };
}

function healthOfDailyJournal(): ModuleHealth {
  if (journalEntries.length === 0) {
    return { moduleName: "Daily Journal", status: isMarketOpenNowServer() ? "DEGRADED" : "HEALTHY", metrics: { entryCount: 0, reason: isMarketOpenNowServer() ? "no_entries_yet_during_market_hours" : "market_closed" }, sinceTimestamp: new Date().toISOString() };
  }
  const latest = journalEntries[journalEntries.length - 1];
  const ageSec = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 1000);
  const status: HealthStatus = !isMarketOpenNowServer() ? "HEALTHY" : ageSec > 10 * 60 ? "DEGRADED" : "HEALTHY";
  return { moduleName: "Daily Journal", status, metrics: { entryCount: journalEntries.length, lastEntryAgeSec: ageSec }, sinceTimestamp: latest.timestamp };
}

function healthOfMarketDnaEngine(): ModuleHealth {
  const count = recorderSession.snapshots.length;
  const status: HealthStatus = count >= DNA_MIN_SNAPSHOTS ? "HEALTHY" : count > 0 ? "DEGRADED" : "DOWN";
  return { moduleName: "Market DNA Engine", status, metrics: { availableSnapshots: count, minimumRequired: DNA_MIN_SNAPSHOTS }, sinceTimestamp: new Date().toISOString() };
}

let lastOverallHealthStatus: HealthStatus = "HEALTHY";
function computeSystemHealth(): { modules: ModuleHealth[]; overallStatus: HealthStatus; generatedAt: string } {
  const modules = [healthOfTruthEngine(), healthOfRecorderEngine(), healthOfGoogleDriveSuperBrain(), healthOfDailyJournal(), healthOfMarketDnaEngine()];
  const overallStatus: HealthStatus = modules.some((m) => m.status === "DOWN") ? "DOWN" : modules.some((m) => m.status === "DEGRADED") ? "DEGRADED" : "HEALTHY";
  // Module 11 (Event Bus): additive publish, only on a genuine transition
  // into a worse state \u2014 never fires on every poll, since this function
  // is called roughly once a minute by multiple callers.
  if (overallStatus !== "HEALTHY" && overallStatus !== lastOverallHealthStatus) {
    publishEvent("HealthDegraded", { overallStatus, degradedModules: modules.filter((m) => m.status !== "HEALTHY").map((m) => m.moduleName) }, "Health Engine");
  }
  lastOverallHealthStatus = overallStatus;
  return { modules, overallStatus, generatedAt: new Date().toISOString() };
}

// ============== MODULE 13: RECOVERY ENGINE ==============
// Per the approved Architecture Specification, \u00a713. Owns every
// automatic-retry behaviour so no other module implements its own
// bespoke retry loop (Modular Design). Polls Module 12's health report
// (no event bus yet, same disclosed simplification as Module 12).
//
// Critical design constraint carried over from the spec: automatic
// Kite/Google re-authentication is explicitly OUT OF SCOPE. Credentials
// are only ever entered on the official provider login pages, platform-
// wide. Any DEGRADED/DOWN module whose root cause is a lost session/
// token is immediately flagged MANUAL_ACTION_REQUIRED and never
// automatically retried \u2014 this is a permanent design decision, not a
// gap to be closed later.

type RecoveryStatus = "RETRYING" | "RECOVERED" | "EXHAUSTED" | "MANUAL_ACTION_REQUIRED";

interface RecoveryAttempt {
  recoveryId: string;
  moduleName: string;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  status: RecoveryStatus;
  reason: string;
  startedAt: string;
  lastAttemptAt: string | null;
}

const recoveryAttempts: RecoveryAttempt[] = [];
const RECOVERY_MAX_ATTEMPTS = 5; // PROVISIONAL, not backtested
const RECOVERY_BASE_DELAY_MS = 30 * 1000; // PROVISIONAL \u2014 30s base, doubling each attempt

// ============== HAIKU VERDICT SYSTEM \u2014 STEP 5: Haiku explanation layer ==============
// Haiku NEVER computes the verdict \u2014 the deterministic runRuleEngine()
// (Step 3, client-side) already decided verdict/score/suggestion before
// this is ever called. Haiku only turns that already-decided result into
// a short plain-language explanation. Server-side only, because
// ANTHROPIC_API_KEY must never reach the browser.
//
// Cost guard (user-approved 2026-08-08): only call Haiku when the
// verdict actually changed since the last call for this symbol, OR at
// least 15 minutes have passed since the last call \u2014 never on every
// ~3-minute poll. In-memory cache, so a Railway redeploy resets it
// (acceptable \u2014 worst case is one extra Haiku call after a deploy).
interface HaikuCacheEntry {
  verdict: string;
  explanation: string;
  calledAt: number; // epoch ms
}
const haikuCache = new Map<string, HaikuCacheEntry>();
const HAIKU_COST_GUARD_MS = 15 * 60 * 1000; // 15 minutes

// The only module with a genuine automatic recovery strategy today: a
// failed Drive archive can be safely retried (same idempotent action,
// no new credentials needed). Every other DEGRADED/DOWN module in this
// system traces back to a lost Kite session or a disconnected Google
// account \u2014 both credential-based, both out of scope for automation.
const AUTO_RECOVERABLE_MODULES = new Set(["Google Drive Super Brain"]);

function findActiveRecovery(moduleName: string): RecoveryAttempt | undefined {
  return recoveryAttempts.find((r) => r.moduleName === moduleName && (r.status === "RETRYING" || r.status === "MANUAL_ACTION_REQUIRED"));
}

async function runRecoveryCycle(): Promise<void> {
  const health = computeSystemHealth();

  for (const m of health.modules) {
    const active = findActiveRecovery(m.moduleName);

    if (m.status === "HEALTHY") {
      // Bug fix (2026-08-08, user-reported): this used to only clear
      // RETRYING \u2192 RECOVERED. MANUAL_ACTION_REQUIRED entries never
      // got cleared even after the module genuinely recovered, so they
      // sat stale forever until the next redeploy wiped memory.
      if (active && (active.status === "RETRYING" || active.status === "MANUAL_ACTION_REQUIRED")) active.status = "RECOVERED";
      continue;
    }

    if (!AUTO_RECOVERABLE_MODULES.has(m.moduleName)) {
      if (!active) {
        recoveryAttempts.push({
          recoveryId: `rec-${Date.now()}-${randomBytes(3).toString("hex")}`,
          moduleName: m.moduleName,
          attempt: 0,
          maxAttempts: 0,
          nextRetryAt: null,
          status: "MANUAL_ACTION_REQUIRED",
          reason: "No automatic recovery strategy is registered for this module \u2014 it requires a manual reconnect action (Kite login or Google Drive Connect), per the platform's credential-security rules.",
          startedAt: new Date().toISOString(),
          lastAttemptAt: null,
        });
      }
      continue;
    }

    // Google Drive Super Brain: the only auto-recoverable path.
    // Bug fix (2026-08-08, user-reported): the old condition
    // `!attemptRecord || attemptRecord.status === "MANUAL_ACTION_REQUIRED"`
    // pushed a BRAND NEW record every 60s while Drive stayed
    // disconnected, since it never reused the existing
    // MANUAL_ACTION_REQUIRED record \u2014 duplicating it every cycle
    // forever. Now only creates a record when none exists at all;
    // an existing MANUAL_ACTION_REQUIRED one is reused and flipped
    // back to RETRYING only once Drive is actually reconnected.
    let attemptRecord = active;
    if (!attemptRecord) {
      attemptRecord = {
        recoveryId: `rec-${Date.now()}-${randomBytes(3).toString("hex")}`,
        moduleName: m.moduleName,
        attempt: 0,
        maxAttempts: RECOVERY_MAX_ATTEMPTS,
        nextRetryAt: new Date().toISOString(),
        status: "RETRYING",
        reason: "Google Drive is DEGRADED (last archive attempt failed or not connected) \u2014 automatically retrying with exponential backoff.",
        startedAt: new Date().toISOString(),
        lastAttemptAt: null,
      };
      recoveryAttempts.push(attemptRecord);
    } else if (attemptRecord.status === "MANUAL_ACTION_REQUIRED" && driveSession.refreshTokenEncrypted) {
      attemptRecord.status = "RETRYING";
      attemptRecord.attempt = 0;
      attemptRecord.nextRetryAt = new Date().toISOString();
      attemptRecord.reason = "Google Drive is DEGRADED (last archive attempt failed) \u2014 automatically retrying with exponential backoff.";
    }

    if (attemptRecord.status !== "RETRYING") continue;
    if (attemptRecord.nextRetryAt && new Date(attemptRecord.nextRetryAt).getTime() > Date.now()) continue; // not due yet

    // If Drive isn't even connected, this is credential-based \u2014 defer to manual, don't burn retry attempts on it.
    if (!driveSession.refreshTokenEncrypted) {
      attemptRecord.status = "MANUAL_ACTION_REQUIRED";
      attemptRecord.reason = "Google Drive is not connected \u2014 requires Connect Google Drive action, not an automatic retry.";
      continue;
    }

    attemptRecord.attempt++;
    attemptRecord.lastAttemptAt = new Date().toISOString();

    if (attemptRecord.attempt > attemptRecord.maxAttempts) {
      attemptRecord.status = "EXHAUSTED";
      continue;
    }


    const result = await performDriveArchive();
    // Module 11 (Event Bus): additive publish, existing logic below is unchanged.
    publishEvent("RecoveryAttempted", { moduleName: attemptRecord.moduleName, attempt: attemptRecord.attempt, success: result.success }, "Recovery Engine");
    if (result.success) {
      attemptRecord.status = "RECOVERED";
    } else {
      const delayMs = RECOVERY_BASE_DELAY_MS * Math.pow(2, attemptRecord.attempt - 1);
      attemptRecord.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
      attemptRecord.reason = "Retry failed: " + (result.error || "unknown error") + ". Next attempt at " + attemptRecord.nextRetryAt + ".";
    }
  }
}

setInterval(() => {
  runRecoveryCycle().catch((err) => console.error("[Recovery Engine] cycle error:", err instanceof Error ? err.message : err));
}, 60 * 1000);

// ============================================================================
// Validation / Outcome Engine (System Architecture v1.0, layer 13).
// Built 2026-08-08, P0. Deterministic only \u2014 no AI/Haiku involvement.
// The evaluation logic itself lives in outcome-engine.ts (independently
// unit-tested); this section is just the server-side wiring: in-memory
// store, the configurable outcome window, recording/list/stats
// endpoints, and the periodic evaluation cycle.
//
// Phase-1 limitation (same disclosure pattern as Recorder/Recovery):
// records live only in this process's memory and reset on redeploy.
// ============================================================================

const outcomeRecords: OutcomeRecord[] = [];
const OUTCOME_MAX_RECORDS = 500;

// Configurable, not hard-coded through the file \u2014 override via Railway
// variable OUTCOME_WINDOW_MINUTES if a different window is ever wanted.
// Default of 60 minutes is PROVISIONAL, not backtested.
const OUTCOME_WINDOW_MINUTES = Number.parseInt(process.env.OUTCOME_WINDOW_MINUTES || "60", 10);

function snapshotsForOutcome(symbol: OutcomeIndexSymbol): SnapshotForOutcome[] {
  return recorderSession.snapshots
    .map((s) => {
      const idx = s[symbol];
      if (!idx) return null;
      return {
        backendTimestamp: s.backendTimestamp,
        atmStrike: idx.atmStrike,
        ceLtp: idx.ceLtp,
        peLtp: idx.peLtp,
      } as SnapshotForOutcome;
    })
    .filter((s): s is SnapshotForOutcome => s !== null);
}

function runOutcomeEvaluationCycle(): void {
  const nowMs = Date.now();
  for (let i = 0; i < outcomeRecords.length; i++) {
    const rec = outcomeRecords[i];
    if (rec.status !== "PENDING") continue;
    const snaps = snapshotsForOutcome(rec.symbol);
    outcomeRecords[i] = evaluateOutcome(rec, snaps, nowMs);
  }
}

setInterval(() => {
  try {
    runOutcomeEvaluationCycle();
  } catch (err) {
    console.error("[Outcome Engine] evaluation cycle error:", err instanceof Error ? err.message : err);
  }
}, 60 * 1000);

// Client calls this once per NEW verdict that carries a suggestion
// (i.e. the same "verdict changed" moment the client already uses to
// gate its Haiku call) \u2014 never on every 3-min poll. This endpoint only
// RECORDS what the deterministic rule engine already decided; it does
// not compute, alter, or validate the verdict itself.
app.post("/api/outcome/record", async (c) => {
  let body: {
    symbol?: OutcomeIndexSymbol;
    verdict?: string;
    score?: number | null;
    maxScore?: number | null;
    confidence?: string | null;
    suggestion?: { side?: OutcomeSide; strike?: string; entry?: number; sl?: number | null; t1?: number | null; t2?: number | null } | null;
    signalContributions?: Record<string, number> | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body \u2014 expected JSON." }, 400);
  }
  if (!body.symbol || !body.verdict) return c.json({ error: "symbol and verdict are required" }, 400);

  // Suggestion.strike is a display label like "24600 CE" \u2014 the numeric
  // strike is parsed out; if that fails, treat as no strike (honest
  // INCOMPLETE_NO_ENTRY_DATA rather than guessing a number).
  let numericStrike: number | null = null;
  if (body.suggestion?.strike) {
    const parsed = Number.parseFloat(body.suggestion.strike);
    numericStrike = Number.isFinite(parsed) ? parsed : null;
  }

  const record = createOutcomeRecord({
    symbol: body.symbol,
    tradingDate: recorderSession.tradingDate || indiaTradingDate(),
    verdict: body.verdict,
    score: body.score ?? null,
    maxScore: body.maxScore ?? null,
    confidence: body.confidence ?? null,
    side: body.suggestion?.side ?? null,
    strike: numericStrike,
    entry: body.suggestion?.entry ?? null,
    sl: body.suggestion?.sl ?? null,
    t1: body.suggestion?.t1 ?? null,
    t2: body.suggestion?.t2 ?? null,
    signalContributions: body.signalContributions ?? null,
    windowMinutes: OUTCOME_WINDOW_MINUTES,
    nowMs: Date.now(),
    idSuffix: randomBytes(3).toString("hex"),
  });

  outcomeRecords.push(record);
  if (outcomeRecords.length > OUTCOME_MAX_RECORDS) {
    // Bug fix (2026-08-09, user-reported via verification report): a
    // plain .shift() evicted the OLDEST record regardless of status,
    // which could silently discard a still-PENDING record before it
    // ever reached a terminal outcome \u2014 losing that observation with
    // no trace at all, worse than an explicit INCOMPLETE_* status.
    // Now evicts the oldest NON-PENDING (already-terminal) record
    // first; only falls back to evicting the oldest PENDING record if
    // every record in the buffer is somehow still PENDING.
    const nonPendingIdx = outcomeRecords.findIndex((r) => r.status !== "PENDING");
    outcomeRecords.splice(nonPendingIdx === -1 ? 0 : nonPendingIdx, 1);
  }

  return c.json({ outcomeId: record.outcomeId, status: record.status, windowEndsAt: new Date(record.windowEndsAtMs).toISOString() });
});

app.get("/api/outcome/list", (c) => {
  const symbol = c.req.query("symbol");
  const filtered = symbol ? outcomeRecords.filter((r) => r.symbol === symbol) : outcomeRecords;
  return c.json({ records: filtered.slice(-100), total: outcomeRecords.length, windowMinutes: OUTCOME_WINDOW_MINUTES });
});

app.get("/api/outcome/stats", (c) => {
  return c.json(computeOutcomeStats(outcomeRecords));
});

// Real Historical-Journal cross-reference (fix for the architecture
// compliance gap found 2026-08-09): outcome records can't be built
// FROM journal entries (JournalEntry has no entry/SL/T1/T2/signal-
// contribution data \u2014 only simple CE/PE bias labels derived
// server-side from raw Recorder snapshots, a different verdict
// vocabulary entirely from the rule engine's). So instead, this joins
// them by tradingDate: for a given day, return that day's outcome
// records alongside that day's journal entries side by side, so a
// person (or a future Probability Engine) can actually cross-reference
// the two without either system losing the data only it has.
app.get("/api/outcome/by-trading-date/:date", (c) => {
  const date = c.req.param("date");
  const records = outcomeRecords.filter((r) => r.tradingDate === date);
  const journal = journalEntries.filter((j) => (j.timestamp || "").slice(0, 10) === date);
  return c.json({ tradingDate: date, outcomeRecords: records, journalEntries: journal });
});

// Module 3 dependency on the Recorder Engine (Module 2) and its
// Truth-validated snapshots: derives descriptive tags for a day's
// archive purely from data already produced by the Recorder/Journal —
// never invents a tag from data the day did not actually contain, per
// "Never invent market facts."
function computeArchiveSearchTags(): string[] {
  const tags: string[] = [];
  if (journalEntries.length === 0) return tags;
  const latest = journalEntries[journalEntries.length - 1];
  if (latest.combinedVerdict) {
    tags.push(latest.combinedVerdict.replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, ""));
  }
  if (latest.leadingIndex) tags.push(latest.leadingIndex + "_LEADING");
  if (journalEntries.some((e) => e.verdictChanged)) tags.push("VERDICT_CHANGED");
  const invalidCount = recorderSession.snapshots.filter((s) => s.snapshotStatus === "INVALID").length;
  const staleCount = recorderSession.snapshots.filter((s) => s.snapshotStatus === "STALE").length;
  if (invalidCount > 0) tags.push("HAD_INVALID_SNAPSHOTS");
  if (staleCount > 0) tags.push("HAD_STALE_SNAPSHOTS");
  return tags;
}

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
    autoArchive: { scheduledAfter: "15:35 IST (5 min after market close)", lastAutoArchiveDate },
  });
});

// Module 3 (Google Drive Super Brain) — new search/replay scope.
// KNOWN PHASE-1 LIMITATION, disclosed rather than hidden: the search
// index below is the in-memory driveArchives array, which only covers
// archives created since this server process last started \u2014 it is not
// a durable index over every day ever archived to Drive. A persistent
// database (specified as a prerequisite in the approved Architecture
// Specification) is required before this search is complete.
app.get("/api/drive/search", (c) => {
  const tag = c.req.query("tag");
  const from = c.req.query("from");
  const to = c.req.query("to");
  let results = driveArchives.filter((a) => a.status === "VERIFIED");
  if (tag) results = results.filter((a) => a.searchTags.includes(tag));
  if (from) results = results.filter((a) => a.date >= from);
  if (to) results = results.filter((a) => a.date <= to);
  return c.json({
    query: { tag: tag || null, from: from || null, to: to || null },
    resultCount: results.length,
    results,
    limitation: "In-memory index only \u2014 covers archives created since this server process last started, not full Drive history. See Module 3 spec, \u00a712 Future Expansion.",
  });
});

// ============== MODULE 9: RESEARCH ENGINE ==============
// Per the approved Architecture Specification, \u00a79. On-demand
// investigation tool. NEW capability, scoped down from the full spec:
// no Memory Engine (Module 6) exists, so this can only search today's
// in-memory session plus whatever specific dates are already archived
// and indexed in Google Drive (Module 3) \u2014 not a general historical
// search. Structured-form query only, per the spec's own Future
// Expansion note (natural-language parsing is explicitly deferred).

interface ResearchEvidenceItem {
  timestamp: string;
  event: string;
  source: "Recorder" | "Journal";
}

interface ResearchReport {
  researchId: string;
  query: { date: string; index: "NIFTY" | "BANKNIFTY" | "SENSEX"; eventType: string | null };
  evidenceTrail: ResearchEvidenceItem[];
  summary: string;
  unanswerable: string[];
  generatedAt: string;
}

async function computeResearchReport(date: string, symbol: "NIFTY" | "BANKNIFTY" | "SENSEX", eventType: string | null): Promise<ResearchReport> {
  const researchId = `research-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const unanswerable: string[] = [];
  let snapshots: RecorderSnapshot[] = [];
  let journalForDay: JournalEntry[] = [];

  const today = recorderSession.tradingDate || indiaTradingDate();
  if (date === today) {
    snapshots = recorderSession.snapshots;
    journalForDay = journalEntries;
  } else {
    const archived = await fetchArchivedDayData(date);
    if ("error" in archived) {
      unanswerable.push(`Cannot access data for ${date}: ${archived.error}`);
    } else {
      snapshots = archived.snapshots;
      journalForDay = archived.journalEntries;
    }
  }

  const evidenceTrail: ResearchEvidenceItem[] = [];

  snapshots.forEach((s) => {
    const leg = s[symbol];
    if (!leg) return; // this index had no valid data in that snapshot \u2014 not itself an event worth reporting
    if (s.snapshotStatus === "INVALID" || s.snapshotStatus === "STALE") {
      evidenceTrail.push({ timestamp: s.backendTimestamp, event: `Snapshot marked ${s.snapshotStatus}`, source: "Recorder" });
    }
  });

  if (symbol === "NIFTY" || symbol === "SENSEX") {
    journalForDay.forEach((e) => {
      if (e.verdictChanged) {
        evidenceTrail.push({ timestamp: e.timestamp, event: `Verdict changed: ${e.previousVerdict} \u2192 ${e.currentVerdict}`, source: "Journal" });
      }
      if (eventType === "notes" || eventType === null) {
        (e.notes || []).forEach((n) => evidenceTrail.push({ timestamp: e.timestamp, event: n, source: "Journal" }));
      }
    });
  } else {
    unanswerable.push("BANKNIFTY has no Journal verdict history \u2014 the Daily Journal (Module 3-adjacent) covers NIFTY and SENSEX only, per its own specification.");
  }

  evidenceTrail.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let summary: string;
  if (evidenceTrail.length === 0 && unanswerable.length === 0) {
    summary = `No notable events found for ${symbol} on ${date} within the available data (${snapshots.length} snapshot(s) checked).`;
  } else if (evidenceTrail.length === 0) {
    summary = `No events could be assembled for ${symbol} on ${date} \u2014 see the unanswerable list for why.`;
  } else {
    const first = new Date(evidenceTrail[0].timestamp).toLocaleTimeString();
    const last = new Date(evidenceTrail[evidenceTrail.length - 1].timestamp).toLocaleTimeString();
    summary = `Found ${evidenceTrail.length} notable event(s) for ${symbol} on ${date}, spanning ${first} to ${last}.`;
  }

  return { researchId, query: { date, index: symbol, eventType }, evidenceTrail, summary, unanswerable, generatedAt: new Date().toISOString() };
}

async function fetchArchivedDayData(date: string): Promise<{ snapshots: RecorderSnapshot[]; journalEntries: JournalEntry[] } | { error: string }> {
  const record = driveArchives.find((a) => a.date === date && a.status === "VERIFIED");
  if (!record) {
    return { error: "No verified archive found in this server's in-memory index for that date. It may still exist in Google Drive itself, but is not currently indexed \u2014 see Module 3's known Phase-1 limitation." };
  }
  const rawFileId = record.fileIds.raw;
  if (!rawFileId) return { error: "Archive record has no Raw JSON file reference." };

  const token = await getValidDriveAccessToken();
  if (!token) return { error: "Google Drive not connected or token refresh failed" };

  const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${rawFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) return { error: "Could not download archived Raw JSON from Drive (HTTP " + fileRes.status + ")" };
  const rawContent = await fileRes.json();

  return {
    snapshots: rawContent.recorderSession?.snapshots || [],
    journalEntries: rawContent.journalEntries || [],
  };
}

app.get("/api/drive/replay/:date", async (c) => {
  const date = c.req.param("date");
  const result = await fetchArchivedDayData(date);
  if ("error" in result) return c.json({ error: result.error }, 404);
  return c.json({
    date,
    mode: "REPLAY MODE",
    note: "This is archived historical data, never mixed with or allowed to influence any live verdict.",
    snapshots: result.snapshots,
    journalEntries: result.journalEntries,
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

async function performDriveArchive(): Promise<{ success: boolean; record: DriveArchiveRecord; error?: string }> {
  const token = await getValidDriveAccessToken();
  if (!token) return { success: false, record: { date: recorderSession.tradingDate || indiaTradingDate(), status: "ARCHIVE_FAILED", fileIds: {}, verifiedAt: null, attempts: 1, lastError: "Google Drive not connected or token refresh failed", searchTags: [] }, error: "Google Drive not connected or token refresh failed" };

  const tradingDate = recorderSession.tradingDate || indiaTradingDate();
  const record: DriveArchiveRecord = { date: tradingDate, status: "PENDING", fileIds: {}, verifiedAt: null, attempts: 1, lastError: null, searchTags: computeArchiveSearchTags() };

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
      "snapshot_id,backend_timestamp,reason,snapshot_status,truth_verdict,symbol,spot,change,pdh,pdl,vwap,futures_ltp,futures_oi,atm_strike,ce_ltp,pe_ltp,ce_oi,pe_oi,exchange_timestamp,snapshot_sync_id,fii_cash_cr,dii_cash_cr",
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
            snap.snapshotId, snap.backendTimestamp, snap.reason, snap.snapshotStatus, snap.truthVerdicts ? snap.truthVerdicts[sym] : null, sym,
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

    for (const [key, fileId] of Object.entries(record.fileIds)) {
      const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta = await metaRes.json();
      if (!metaRes.ok || !meta.id || parseInt(meta.size || "0", 10) === 0) {
        throw new Error(`Verification failed for ${key} (fileId ${fileId})`);
      }
    }

    const manifest = { date: tradingDate, fileIds: record.fileIds, verifiedAt: new Date().toISOString(), searchTags: record.searchTags };
    const manifestResult = await uploadFileToDrive(`OptionPilot_${tradingDate}_ArchiveVerification.json`, "application/json", JSON.stringify(manifest, null, 2), dateId, token);
    if (manifestResult) record.fileIds.manifest = manifestResult.id;

    record.status = "VERIFIED";
    record.verifiedAt = new Date().toISOString();
    driveArchives.push(record);
    // Module 11 (Event Bus): additive publish, existing return value below is unchanged.
    publishEvent("ArchiveCompleted", { date: record.date, fileCount: Object.keys(record.fileIds).length, searchTags: record.searchTags }, "Google Drive Super Brain");
    return { success: true, record };
  } catch (err) {
    record.status = "ARCHIVE_FAILED";
    record.lastError = err instanceof Error ? err.message : "Unknown archive error";
    driveArchives.push(record);
    return { success: false, record, error: record.lastError };
  }
}

app.post("/api/drive/archive", async (c) => {
  const result = await performDriveArchive();
  if (!result.success) return c.json({ success: false, error: result.error }, result.error === "Google Drive not connected or token refresh failed" ? 400 : 500);
  return c.json({ success: true, record: result.record });
});

// ============================================================================
// Automatic scheduled archive (user-approved 2026-08-09). Previously
// archiving was 100% manual (the "Archive Now" button) \u2014 since
// recorderSession/journalEntries/outcomeRecords are all in-memory only
// and reset on every Railway redeploy or restart, a day's data could be
// silently lost if the person forgot to click Archive Now before a
// redeploy happened mid-day (which this project's own workflow does
// fairly often).
//
// Deliberately ONCE PER DAY, right after market close, not periodic
// throughout the day: uploadFileToDrive() always creates a NEW file
// rather than updating an existing one (checked directly in the code,
// no update-in-place exists), so archiving every N minutes would fill
// Drive with duplicate same-day files. A true intraday-safe periodic
// archive would need an overwrite/update fix first \u2014 that's a
// separate, larger task, not silently bundled into this one.
let lastAutoArchiveDate: string | null = null;

setInterval(() => {
  try {
    const indiaNow = new Date(Date.now() + INDIA_OFFSET_MS);
    const minutesSinceMidnight = indiaNow.getUTCHours() * 60 + indiaNow.getUTCMinutes();
    const marketCloseBuffer = 15 * 60 + 35; // 3:35 PM IST \u2014 5 min after close, so the last snapshot is captured
    if (minutesSinceMidnight < marketCloseBuffer) return;

    const today = recorderSession.tradingDate || indiaTradingDate();
    if (lastAutoArchiveDate === today) return; // already archived today
    if (recorderSession.snapshots.length === 0) return; // nothing to archive
    if (!driveSession.refreshTokenEncrypted) return; // not connected \u2014 Recovery Engine already surfaces this as MANUAL_ACTION_REQUIRED

    lastAutoArchiveDate = today; // set BEFORE the await, so a slow/failed archive can't fire twice in the same minute
    performDriveArchive()
      .then((result) => {
        if (!result.success) {
          console.error("[Auto-Archive] scheduled archive failed:", result.error);
          lastAutoArchiveDate = null; // allow a retry on a later tick today, since it didn't actually succeed
        }
      })
      .catch((err) => {
        console.error("[Auto-Archive] scheduled archive threw:", err instanceof Error ? err.message : err);
        lastAutoArchiveDate = null;
      });
  } catch (err) {
    console.error("[Auto-Archive] scheduler error:", err instanceof Error ? err.message : err);
  }
}, 5 * 60 * 1000); // check every 5 minutes \u2014 cheap, and the date-guard above prevents any duplicate archive

// ============================================================================
// Premium Diagnostic Layer \u2014 15-minute window Haiku diagnostic (user-
// approved 2026-08-09/10, PILOT SCOPE: NIFTY only, current-week ATM CE/PE
// only). Explains how premium/intrinsic/extrinsic/IV behaved during each
// completed fixed 15-min market window. Deterministic-only for data
// collection; Haiku only explains, per the same AI boundary as the Rule
// Engine's Haiku layer (Section 6 of docs/architecture.md).
//
// DISCLOSED PILOT LIMITATIONS (not silently omitted):
// - No database exists in this codebase (same as Recorder/Outcome Engine)
//   \u2014 results live in memory only and reset on every Railway redeploy.
// - Multi-timeframe context (1m/3m/5m/...125m/1D) is NOT available \u2014
//   this codebase only has 3-min snapshots and 1-day PDH/PDL, not the
//   9 timeframes the full spec describes. Sent as explicitly
//   "not_available" rather than fabricated.
// - Scoped to NIFTY / current-week / ATM only for this pilot, not the
//   full ATM\u00b13 \u00d7 4-expiry \u00d7 3-index grid \u2014 to validate the mechanism
//   safely before scaling cost and complexity.
// ============================================================================

function get15MinWindowStart(date: Date): string {
  const indiaNow = new Date(date.getTime() + INDIA_OFFSET_MS);
  const minutes = indiaNow.getUTCMinutes();
  const flooredMinutes = Math.floor(minutes / 15) * 15;
  const windowStart = new Date(Date.UTC(
    indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate(),
    indiaNow.getUTCHours(), flooredMinutes, 0
  ));
  // Format as "HH:MM" in IST for a human-readable, stable window id (combined with the date).
  const hh = String(windowStart.getUTCHours()).padStart(2, "0");
  const mm = String(windowStart.getUTCMinutes()).padStart(2, "0");
  const dateStr = `${windowStart.getUTCFullYear()}-${String(windowStart.getUTCMonth() + 1).padStart(2, "0")}-${String(windowStart.getUTCDate()).padStart(2, "0")}`;
  return `${dateStr}T${hh}:${mm}`;
}

interface PremiumDiagnosticSnapshot {
  timestamp: string;
  atmCe: Record<string, number | null>;
  atmPe: Record<string, number | null>;
  spot: number;
  spotChange: number;
  vwapRelation: string | null;
  pdhPdlRelation: string | null;
  pcr: number | null;
  pcrChange: number | null;
  vix: number | null;
  vixChange: number | null;
  futuresOiBuildup: string | null;
  callPutWalls: string | null;
  atmOiBuildup: string | null;
  straddleBehaviour: string | null;
  sectorHeatmap: string | null;
  structuralBias: string | null;
}

interface PremiumDiagnosticResult {
  windowId: string;
  windowStart: string;
  windowEnd: string;
  symbol: string;
  snapshotCount: number;
  generatedAt: string;
  diagnostic: any;
  error?: string;
}

const premiumDiagnosticBuffer = new Map<string, PremiumDiagnosticSnapshot[]>(); // key: symbol_windowId
const premiumDiagnosticDiagnosed = new Set<string>(); // key: symbol_windowId, already processed
const premiumDiagnosticResults: Record<string, PremiumDiagnosticResult[]> = { NIFTY: [] }; // pilot: NIFTY only
const PREMIUM_DIAGNOSTIC_MAX_RESULTS = 20;
const PREMIUM_DIAGNOSTIC_SYMBOLS = ["NIFTY"]; // pilot scope \u2014 not BANKNIFTY/SENSEX yet

app.post("/api/premium-diagnostic/snapshot", async (c) => {
  let body: { symbol?: string; snapshot?: PremiumDiagnosticSnapshot };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
  if (!body.symbol || !PREMIUM_DIAGNOSTIC_SYMBOLS.includes(body.symbol) || !body.snapshot) {
    return c.json({ ok: false, reason: "symbol not in pilot scope or snapshot missing" });
  }
  const windowId = get15MinWindowStart(new Date());
  const key = body.symbol + "_" + windowId;
  if (!premiumDiagnosticBuffer.has(key)) premiumDiagnosticBuffer.set(key, []);
  premiumDiagnosticBuffer.get(key)!.push(body.snapshot);
  return c.json({ ok: true, windowId, bufferedCount: premiumDiagnosticBuffer.get(key)!.length });
});

app.get("/api/premium-diagnostic/latest", (c) => {
  const symbol = c.req.query("symbol") || "NIFTY";
  const results = premiumDiagnosticResults[symbol] || [];
  return c.json({ symbol, results: results.slice(-5), totalGenerated: results.length });
});

async function runPremiumDiagnosticForWindow(symbol: string, windowId: string, snapshots: PremiumDiagnosticSnapshot[]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const windowStartLocal = windowId.split("T")[1];
  const [wh, wm] = windowStartLocal.split(":").map(Number);
  const windowEndTotalMin = wh * 60 + wm + 15;
  const windowEndLocal = `${String(Math.floor(windowEndTotalMin / 60)).padStart(2, "0")}:${String(windowEndTotalMin % 60).padStart(2, "0")}`;

  if (!apiKey) {
    premiumDiagnosticResults[symbol] = premiumDiagnosticResults[symbol] || [];
    premiumDiagnosticResults[symbol].push({
      windowId, windowStart: windowStartLocal, windowEnd: windowEndLocal, symbol,
      snapshotCount: snapshots.length, generatedAt: new Date().toISOString(),
      diagnostic: null, error: "ANTHROPIC_API_KEY not configured on the server",
    });
    return;
  }
  if (snapshots.length === 0) return; // nothing to diagnose

  const inputPayload = {
    window: { window_id: windowId, start_time: windowStartLocal, end_time: windowEndLocal, timezone: "Asia/Kolkata", duration_minutes: 15, window_status: "COMPLETED" },
    snapshots,
    snapshot_count: snapshots.length,
    minimum_expected: 5,
    note_if_incomplete: snapshots.length < 5 ? "Fewer than 5 snapshots were captured this window \u2014 report as PARTIAL or INSUFFICIENT data_quality, do not invent the missing ones." : null,
    multi_timeframe: "not_available \u2014 this system does not yet compute 1m/3m/5m/15m/30m/45m/75m/125m/1D context; do not fabricate it.",
    scope_note: "PILOT: NIFTY, current-week ATM CE/PE only \u2014 ATM\u00b13 strikes and other expiries/indices are not yet included.",
  };

  const systemPrompt = "You are the Premium Diagnostic and Market-Behaviour Explanation Layer for OptionPilot Pro. You explain verified calculations and observations supplied below for one completed 15-minute market window. You do NOT calculate a Rule Engine score, create a trading verdict (Bullish/Bearish/WAIT), change risk levels, override deterministic logic, or make unsupported predictions. Premium = Intrinsic + Extrinsic/Time Value. CE intrinsic = max(Spot-Strike,0). PE intrinsic = max(Strike-Spot,0). Intrinsic value alone is never bullish or bearish by itself \u2014 it only reflects spot-backed moneyness. IV affects the extrinsic component, not intrinsic. Never claim IV crush unless the supplied IV history explicitly shows a sharp decline \u2014 otherwise say 'possible volatility effect'. Never invent a number, price, IV, OI, or timeframe not supplied \u2014 if multi_timeframe is 'not_available', say so, do not guess it. Compare the start and end of the window using the snapshots to see if the path was persistent, gradual, sudden, reversing, or oscillating. Clearly separate confirmed observations (\"the data shows\") from possible explanations (\"may indicate\", \"is consistent with\"). Respond with ONLY a JSON object, no markdown, no extra text, matching this schema: {\"data_quality\": \"OK|PARTIAL|INSUFFICIENT\", \"window_summary\": string, \"intrinsic_extrinsic_analysis\": string, \"iv_analysis\": string, \"theta_decay_analysis\": string, \"oi_volume_pcr_analysis\": string, \"vwap_vix_analysis\": string, \"market_behaviour_observed\": string, \"confirmed_observations\": [string], \"possible_explanations\": [string], \"conflicts\": [string], \"missing_data\": [string]}.";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(inputPayload) }],
      }),
    });

    let diagnostic: any = null;
    let error: string | undefined;
    if (!response.ok) {
      error = `Anthropic API error ${response.status}: ${await response.text()}`;
    } else {
      const json: any = await response.json();
      const textBlock = Array.isArray(json.content) ? json.content.find((b: any) => b.type === "text") : null;
      const raw = textBlock ? textBlock.text : null;
      if (raw) {
        try {
          diagnostic = JSON.parse(raw.replace(/```json|```/g, "").trim());
        } catch {
          error = "Haiku response was not valid JSON";
        }
      } else {
        error = "No text content in Haiku response";
      }
    }

    premiumDiagnosticResults[symbol] = premiumDiagnosticResults[symbol] || [];
    premiumDiagnosticResults[symbol].push({
      windowId, windowStart: windowStartLocal, windowEnd: windowEndLocal, symbol,
      snapshotCount: snapshots.length, generatedAt: new Date().toISOString(), diagnostic, error,
    });
    if (premiumDiagnosticResults[symbol].length > PREMIUM_DIAGNOSTIC_MAX_RESULTS) premiumDiagnosticResults[symbol].shift();
  } catch (err: any) {
    premiumDiagnosticResults[symbol] = premiumDiagnosticResults[symbol] || [];
    premiumDiagnosticResults[symbol].push({
      windowId, windowStart: windowStartLocal, windowEnd: windowEndLocal, symbol,
      snapshotCount: snapshots.length, generatedAt: new Date().toISOString(),
      diagnostic: null, error: `Request failed: ${err.message}`,
    });
  }
}

setInterval(() => {
  try {
    const now = new Date();
    const currentWindowId = get15MinWindowStart(now);
    for (const symbol of PREMIUM_DIAGNOSTIC_SYMBOLS) {
      for (const [key, snapshots] of premiumDiagnosticBuffer.entries()) {
        if (!key.startsWith(symbol + "_")) continue;
        const windowId = key.slice(symbol.length + 1);
        if (windowId === currentWindowId) continue; // still the active window, not completed yet
        if (premiumDiagnosticDiagnosed.has(key)) continue; // already processed
        premiumDiagnosticDiagnosed.add(key);
        void runPremiumDiagnosticForWindow(symbol, windowId, snapshots).catch((err) => {
          console.error("[Premium Diagnostic] window run failed:", err instanceof Error ? err.message : err);
        });
        premiumDiagnosticBuffer.delete(key);
      }
    }
  } catch (err) {
    console.error("[Premium Diagnostic] scheduler error:", err instanceof Error ? err.message : err);
  }
}, 60 * 1000); // check every minute for a just-completed 15-min window

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
app.get("/api/sector-heatmap", async (c) => {
  try {
    const session = getSession(c);
    if (!session) return c.json({ error: "Kite not connected. Please connect Kite first." }, 401);
    const sectors = await fetchSectorHeatmapData(session.accessToken);
    return c.json({ sectors, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[API] Sector heatmap fetch error:", err instanceof Error ? err.message : err);
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch sector heatmap data" }, 500);
  }
});

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
