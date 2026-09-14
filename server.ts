import { Hono } from "hono";
import { mountResearchRoutes } from "./research-server-hook.js";
import { serve } from "@hono/node-server";
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { setImmediate as nodeSetImmediate } from "node:timers";
import { createOutcomeRecord, evaluateOutcome, computeOutcomeStats, type OutcomeRecord, type SnapshotForOutcome, type Side as OutcomeSide, type IndexSymbol as OutcomeIndexSymbol, type ObservationHorizon as OutcomeHorizon, type ClampApplied as OutcomeClampApplied, type DeltaSource as OutcomeDeltaSource } from "./outcome-engine.js";
import { parseFiiDiiPasteServerSide, type ParsedFiiDiiEntry } from "./fii-dii-import.js";
import { buildF5IvScience } from "./iv-science.js";
import { buildObe3VolatilityPurchaseCondition } from "./obe-volatility.js";
// Telegram Trade Card Composer V1 (2026-08-21) -- pure formatter, review-only
// until wired in below. See telegram-trade-card.ts's own header for its
// hard rules (never decides, only formats already-computed fields).
import { buildTelegramTradeCard, TradeCardInput, TradeCardTmPlan, TradeCardAdvancedGreeks } from "./telegram-trade-card.js";
import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";
import { ensureH1DerivedSchema } from "./h1-derived-db.js";
import { recordH1FromRuntimeSnapshot } from "./h1-runtime-bridge.js";
import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";
import { persistKiteAuthoritySession, resolveKiteAuthoritySession, getKiteAuthorityPublicStatus, kiteSessionIdMatchesFingerprint, type KiteAuthorityResolvedSession } from "./kite-session-authority.js";
import { revokeKiteAuthoritySession } from "./kite-session-authority-revoke.js";
import { KeyedSingleFlight, marketAuthorityKey } from "./market-refresh-singleflight.js";
import { evaluateFuturesVwapAcceptance } from "./futures-vwap-acceptance.js";

interface Instrument {
  instrument_token: number;
  exchange_token: number;
  tradingsymbol: string;
  name: string;
  last_price: number;
  expiry: string;
  strike: number;
  tick_size: number;
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
  // H1 Contract Metadata Layer ‚Äî copied from the exact Kite instrument-master
  // record that produced this quote. These fields are identity metadata, not
  // trading signals and do not alter scoring/verdicts.
  instrumentToken: number | null;
  exchangeToken: number | null;
  expiryDate: string | null;
  expiryBucket: string | null;
  optionType: "CE" | "PE" | null;
  lotSize: number | null;
  tickSize: number | null;
  exchange: string | null;
  segment: string | null;
  contractRegime: "LIVE_CONTRACT_MASTER";
  tradingSymbol: string | null; // Kite's actual instrument tradingsymbol, e.g. NIFTY26AUG24600CE
  bid: number;
  ask: number;
  lastPrice: number;
  change: number;
  iv: number;
  oi: number;
  volume: number | null; // Kite's traded quantity for the day ‚Äî needed for liquidity checks (rule 7)
  vwap: number | null; // Kite's average_price for this option, if provided
  vwapSource: "UNVERIFIED AVERAGE PRICE ‚Äî NOT VWAP" | "VWAP UNAVAILABLE"; // Kite's average_price meaning has not been verified against provider docs to match a true session VWAP ‚Äî never silently claim it is VWAP
  quoteTimestamp: string | null; // exchange/provider-side timestamp for THIS quote, distinct from backend receipt time
  atDayHigh: boolean;
  atDayLow: boolean;
  dayOpen: number; // 2026-08-19: today's intraday open (Kite's ohlc.open) -- added specifically to support the "O‚âàH" (open approx equal to high) rejection-candle detection in the Telegram PDL-Broken caution logic; was not previously captured anywhere on this interface even though Kite's quote response always includes it.
  dayHigh: number; // today's intraday high (Kite's ohlc.high)
  dayLow: number; // today's intraday low (Kite's ohlc.low)
  pdc: number; // previous day close (Kite's ohlc.close)
  pdh: number; // previous trading day's high, for this specific strike's premium
  pdl: number; // previous trading day's low, for this specific strike's premium
  vega: number; // Black-Scholes estimate ‚Äî NOT from Kite (Kite doesn't publish Greeks)
  theta: number; // Black-Scholes estimate, per-day decay ‚Äî NOT from Kite
  delta: number; // Black-Scholes estimate ‚Äî NOT from Kite
  gamma: number; // Black-Scholes estimate (2026-08-17, advanced chain) ‚Äî NOT from Kite
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
  snapshotId: string; // backend-generated ‚Äî identifies this index's spot+futures+options as one synchronized collection cycle. NOT supplied by Kite.
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

// PHASE62_KITE_RUNTIME_WIRING_V1 ‚Äî restart-safe authority cache only.
// It never changes score/verdict/Telegram/execution and never exposes credentials.
let phase62RestoredKiteAuthority: KiteAuthorityResolvedSession | null = null;

async function refreshPhase62KiteAuthorityCache(): Promise<void> {
  try {
    const resolved = await resolveKiteAuthoritySession();
    phase62RestoredKiteAuthority = resolved.session;
    console.log(`[PHASE62][KITE_AUTHORITY] status=${resolved.status.code}`);
  } catch (err) {
    phase62RestoredKiteAuthority = null;
    console.warn("[PHASE62][KITE_AUTHORITY] restore failed closed:", err instanceof Error ? err.message : String(err));
  }
}

void refreshPhase62KiteAuthorityCache();

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
// only ‚Äî it will NOT survive a redeploy or restart. Consider a real
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

// ---- FII/DII Drive auto-import (2026-08-21) --------------------------
// Design: user drops a plain-text file (same "Label: value" paste format
// the dashboard's manual paste box already accepts) into a dedicated
// Drive folder once a day. A background cycle (see
// checkFiiDiiInboxAndImport below) finds unprocessed files there, parses
// them with the SAME label map the client-side parseFiiDiiPaste() uses,
// and saves them through the SAME upsert path the manual /api/fii-dii
// POST endpoint uses (saveFiiDiiEntryInternal) -- no duplicated logic,
// no drift between the manual and automatic paths.
//
// DISCLOSED LIMITATION: fiiDiiImportedFileIds is in-memory only (not
// DB-persisted). A restart can cause the next cycle to re-read an
// already-imported file, but that is harmless -- saveFiiDiiEntryInternal
// upserts by date, so re-importing the same file just re-saves the same
// date's data (idempotent), never creates a duplicate entry.
const FII_DII_INBOX_FOLDER_NAME = "OptionPilot_FiiDii_Inbox";
const fiiDiiImportedFileIds = new Set<string>();
let fiiDiiLastAutoImportAt: string | null = null;
let fiiDiiLastAutoImportError: string | null = null;

// Converts the standalone parser module's ParsedFiiDiiEntry (pure, no
// wall-clock, `date` may be null) into a full FiiDiiEntry ready to save --
// this is the one place that supplies "now" (indiaDate() fallback for a
// missing Date: line, and createdAt), keeping fii-dii-import.ts itself
// free of wall-clock dependencies for testability.
function parsedFiiDiiToEntry(parsed: ParsedFiiDiiEntry): FiiDiiEntry {
  return {
    date: parsed.date || indiaDate(),
    fiiCashCr: parsed.fiiCashCr,
    diiCashCr: parsed.diiCashCr,
    derivatives: parsed.derivatives,
    createdAt: new Date().toISOString(),
  };
}

// Shared upsert-by-date save path -- used by BOTH the manual
// POST /api/fii-dii endpoint and the automatic Drive importer, so the two
// entry mechanisms can never silently drift apart.
function saveFiiDiiEntryInternal(entry: FiiDiiEntry): void {
  const existingIdx = fiiDiiEntries.findIndex((e) => e.date === entry.date);
  if (existingIdx >= 0) fiiDiiEntries[existingIdx] = entry;
  else fiiDiiEntries.push(entry);
  fiiDiiEntries.sort((a, b) => a.date.localeCompare(b.date));
  if (fiiDiiEntries.length > FII_DII_MAX_ENTRIES) fiiDiiEntries.shift();
  void dbInsert("fii_dii_entry", entry).catch(() => {});
}

// ============== SESSION RECORDER (Phase 1: in-memory, no database or ==============
// ============== Google Drive yet ‚Äî those are deferred, see chat) ==============
//
// Captures RAW backend market data only (spot, futures, ATM CE/PE,
// FII/DII). It does NOT capture computed signal states (Orchestrator
// stage, interpretation labels, etc.) ‚Äî that logic lives entirely in the
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
  vwapSource?: string | null;
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
  // already agreed) ‚Äî the atmCe/atmPe objects already carry these
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
  // Added 2026-08-10 (user-approved, second pass): ATM\u00b13 strike data,
  // current-week expiry only for now (multi-expiry deferred, disclosed
  // in the capture function below). Mirrors the same Truth-gated
  // pattern as the ATM fields above.
  ceStrikesNear: { strike: number; ltp: number | null; iv: number | null; theta: number | null; vega: number | null; delta: number | null; oi: number | null }[] | null;
  peStrikesNear: { strike: number; ltp: number | null; iv: number | null; theta: number | null; vega: number | null; delta: number | null; oi: number | null }[] | null;
  exchangeTimestamp: string | null;
  snapshotId: string | null;
}

interface RecorderSnapshot {
  snapshotId: string;
  backendTimestamp: string;
  reason: string; // 'SCHEDULED_3MIN' for now ‚Äî event-based reasons are a later phase
  snapshotStatus: "LIVE" | "PARTIAL" | "STALE" | "INVALID";
  NIFTY: RecorderIndexSnapshot | null;
  BANKNIFTY: RecorderIndexSnapshot | null;
  SENSEX: RecorderIndexSnapshot | null;
  fiiCashCr: number | null;
  diiCashCr: number | null;
  truthVerdicts?: { NIFTY: TruthVerdict; BANKNIFTY: TruthVerdict; SENSEX: TruthVerdict }; // Module 1 traceability ‚Äî which Truth Engine verdict each index's data relied on
}

interface RecorderSession {
  tradingDate: string; // YYYY-MM-DD, Asia/Kolkata
  status: "IDLE" | "RECORDING" | "STOPPED" | "DEGRADED";
  startedAt: string | null;
  lastSnapshotAt: string | null;
  snapshots: RecorderSnapshot[];
  lastErrorRedacted: string | null;
}

const RECORDER_MAX_SNAPSHOTS = 200; // ~ full session at 3-min cadence (6.25hr / 3min ‚âà 125) plus headroom

let recorderSession: RecorderSession = {
  tradingDate: "",
  status: "IDLE",
  startedAt: null,
  lastSnapshotAt: null,
  snapshots: [],
  lastErrorRedacted: null,
};


// ============================================================================
// V2 MODULE 1 ‚Äî PREMIUM COMPOSITION HISTORY ENGINE
// Added as an observation-only, additive layer. It derives composition/history
// exclusively from already-recorded 3-minute Recorder snapshots; it does NOT
// fetch Kite, mutate raw Recorder data, call AI, or change runRuleEngine().
//
// Important design boundary:
// - Current expiry / ATM¬±3 only, because that is what Recorder currently stores.
// - Compare the SAME side + SAME strike across snapshots. Never compare by array
//   position when ATM rolls.
// - LIVE and PARTIAL snapshots may contribute when the specific required fields
//   exist. STALE/INVALID snapshots are excluded.
// ============================================================================

type V2PremiumSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
type V2PremiumSide = "CE" | "PE";
type V2CompositionState =
  | "INTRINSIC_EXPANSION"
  | "INTRINSIC_CONTRACTION"
  | "EXTRINSIC_EXPANSION"
  | "EXTRINSIC_CONTRACTION"
  | "BOTH_EXPANDING"
  | "BOTH_CONTRACTING"
  | "INTRINSIC_UP_EXTRINSIC_DOWN"
  | "INTRINSIC_DOWN_EXTRINSIC_UP"
  | "NO_MEANINGFUL_CHANGE"
  | "INSUFFICIENT_HISTORY";

type V2DataQuality = "OK" | "PARTIAL" | "INSUFFICIENT";

interface V2PremiumLegPoint {
  timestamp: string;
  snapshotId: string;
  snapshotStatus: RecorderSnapshot["snapshotStatus"];
  symbol: V2PremiumSymbol;
  side: V2PremiumSide;
  strike: number;
  atmStrike: number | null;
  spot: number;
  moneyness: "ITM" | "ATM" | "OTM";
  premium: number;
  intrinsic: number;
  extrinsic: number;
  intrinsicPct: number | null;
  extrinsicPct: number | null;
  iv: number | null;
  theta: number | null;
  vega: number | null;
  delta: number | null;
  oi: number | null;
}

interface V2NumericChange {
  amount: number | null;
  pct: number | null;
}

interface V2PremiumCompositionComparison {
  symbol: V2PremiumSymbol;
  side: V2PremiumSide;
  strike: number;
  timestamp: string;
  previousTimestamp: string | null;
  moneyness: "ITM" | "ATM" | "OTM";
  current: V2PremiumLegPoint;
  previous: V2PremiumLegPoint | null;
  change: {
    premium: V2NumericChange;
    intrinsic: V2NumericChange;
    extrinsic: V2NumericChange;
    iv: V2NumericChange;
    theta: V2NumericChange;
    vega: V2NumericChange;
    delta: V2NumericChange;
    oi: V2NumericChange;
  };
  compositionState: V2CompositionState;
  dataQuality: V2DataQuality;
}

function v2ComputeIntrinsicValue(side: V2PremiumSide, spot: number, strike: number): number {
  return side === "CE" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

function v2PctPart(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

function v2Change(current: number | null, previous: number | null): V2NumericChange {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { amount: null, pct: null };
  }
  const amount = current - previous;
  return { amount, pct: previous !== 0 ? (amount / Math.abs(previous)) * 100 : null };
}

function v2CompositionState(current: V2PremiumLegPoint, previous: V2PremiumLegPoint | null): V2CompositionState {
  if (!previous) return "INSUFFICIENT_HISTORY";
  // Numerical epsilon only; this is not a market/scoring threshold.
  const EPS = 1e-9;
  const i = current.intrinsic - previous.intrinsic;
  const e = current.extrinsic - previous.extrinsic;
  const iUp = i > EPS, iDown = i < -EPS;
  const eUp = e > EPS, eDown = e < -EPS;
  if (iUp && eUp) return "BOTH_EXPANDING";
  if (iDown && eDown) return "BOTH_CONTRACTING";
  if (iUp && eDown) return "INTRINSIC_UP_EXTRINSIC_DOWN";
  if (iDown && eUp) return "INTRINSIC_DOWN_EXTRINSIC_UP";
  if (iUp) return "INTRINSIC_EXPANSION";
  if (iDown) return "INTRINSIC_CONTRACTION";
  if (eUp) return "EXTRINSIC_EXPANSION";
  if (eDown) return "EXTRINSIC_CONTRACTION";
  return "NO_MEANINGFUL_CHANGE";
}

function v2RecorderLegPoint(
  snap: RecorderSnapshot,
  symbol: V2PremiumSymbol,
  side: V2PremiumSide,
  strike: number
): V2PremiumLegPoint | null {
  if (snap.snapshotStatus === "STALE" || snap.snapshotStatus === "INVALID") return null;
  const idx = snap[symbol];
  if (!idx || !(idx.spot != null && idx.spot > 0)) return null;
  const legs = side === "CE" ? idx.ceStrikesNear : idx.peStrikesNear;
  const leg = legs?.find((x) => x.strike === strike);
  if (!leg || !(leg.ltp != null && leg.ltp > 0)) return null;

  const intrinsic = v2ComputeIntrinsicValue(side, idx.spot, strike);
  const extrinsic = Math.max(leg.ltp - intrinsic, 0);
  const moneyness: "ITM" | "ATM" | "OTM" =
    idx.atmStrike === strike ? "ATM" : intrinsic > 0 ? "ITM" : "OTM";

  return {
    timestamp: snap.backendTimestamp,
    snapshotId: snap.snapshotId,
    snapshotStatus: snap.snapshotStatus,
    symbol,
    side,
    strike,
    atmStrike: idx.atmStrike,
    spot: idx.spot,
    moneyness,
    premium: leg.ltp,
    intrinsic,
    extrinsic,
    intrinsicPct: v2PctPart(intrinsic, leg.ltp),
    extrinsicPct: v2PctPart(extrinsic, leg.ltp),
    iv: leg.iv,
    theta: leg.theta,
    vega: leg.vega,
    delta: leg.delta,
    oi: leg.oi,
  };
}

function v2BuildComparison(current: V2PremiumLegPoint, previous: V2PremiumLegPoint | null): V2PremiumCompositionComparison {
  const requiredCurrentOk = Number.isFinite(current.premium) && Number.isFinite(current.intrinsic) && Number.isFinite(current.extrinsic);
  const optionalMissing = [current.iv, current.theta, current.vega, current.delta, current.oi].some((v) => v == null);
  const dataQuality: V2DataQuality = !requiredCurrentOk ? "INSUFFICIENT" : !previous ? "INSUFFICIENT" : optionalMissing ? "PARTIAL" : "OK";

  return {
    symbol: current.symbol,
    side: current.side,
    strike: current.strike,
    timestamp: current.timestamp,
    previousTimestamp: previous?.timestamp || null,
    moneyness: current.moneyness,
    current,
    previous,
    change: {
      premium: v2Change(current.premium, previous?.premium ?? null),
      intrinsic: v2Change(current.intrinsic, previous?.intrinsic ?? null),
      extrinsic: v2Change(current.extrinsic, previous?.extrinsic ?? null),
      iv: v2Change(current.iv, previous?.iv ?? null),
      theta: v2Change(current.theta, previous?.theta ?? null),
      vega: v2Change(current.vega, previous?.vega ?? null),
      delta: v2Change(current.delta, previous?.delta ?? null),
      oi: v2Change(current.oi, previous?.oi ?? null),
    },
    compositionState: v2CompositionState(current, previous),
    dataQuality,
  };
}

function buildV2PremiumCompositionHistoryKite(symbol: V2PremiumSymbol, maxSnapshots = 20) {
  const eligible = recorderSession.snapshots
    .filter((s) => s.snapshotStatus !== "STALE" && s.snapshotStatus !== "INVALID" && s[symbol] != null)
    .slice(-Math.max(2, Math.min(maxSnapshots, RECORDER_MAX_SNAPSHOTS)));

  if (eligible.length === 0) {
    return { symbol, generatedAt: new Date().toISOString(), snapshotCount: 0, comparisons: [], dataQuality: "INSUFFICIENT" as V2DataQuality };
  }

  const currentSnap = eligible[eligible.length - 1];
  const currentIdx = currentSnap[symbol]!;
  const targets: { side: V2PremiumSide; strike: number }[] = [];
  for (const leg of currentIdx.ceStrikesNear || []) targets.push({ side: "CE", strike: leg.strike });
  for (const leg of currentIdx.peStrikesNear || []) targets.push({ side: "PE", strike: leg.strike });

  const comparisons: V2PremiumCompositionComparison[] = [];
  for (const target of targets) {
    const current = v2RecorderLegPoint(currentSnap, symbol, target.side, target.strike);
    if (!current) continue;
    let previous: V2PremiumLegPoint | null = null;
    for (let i = eligible.length - 2; i >= 0; i--) {
      previous = v2RecorderLegPoint(eligible[i], symbol, target.side, target.strike);
      if (previous) break;
    }
    comparisons.push(v2BuildComparison(current, previous));
  }

  const overallQuality: V2DataQuality = comparisons.length === 0
    ? "INSUFFICIENT"
    : comparisons.every((x) => x.dataQuality === "OK")
      ? "OK"
      : comparisons.some((x) => x.dataQuality === "OK" || x.dataQuality === "PARTIAL")
        ? "PARTIAL"
        : "INSUFFICIENT";

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    latestSnapshotAt: currentSnap.backendTimestamp,
    source: "Recorder 3-minute Truth-gated snapshots; current expiry ATM¬±3 only",
    scoringImpact: "NONE",
    snapshotCount: eligible.length,
    dataQuality: overallQuality,
    comparisons,
  };
}


// ============================================================================
// V2 MODULE 6 ‚Äî PREMIUM ATTRIBUTION ENGINE
// Observation-only diagnostic. Uses already-recorded same-strike snapshots and
// previously computed Greeks. No new Kite request, no AI call, no Rule Engine
// or scoring impact.
//
// Two views are intentionally kept separate:
// 1) EXACT ACCOUNTING: premium change = intrinsic change + extrinsic change.
// 2) FIRST-ORDER GREEK APPROXIMATION: Delta*dS + Vega*dIV + Theta*dt + residual.
//    This is a local approximation, not a causal decomposition. The residual
//    absorbs gamma, vanna/volga, discrete jumps, model error and interactions.
// ============================================================================

type V2PremiumAttributionState =
  | "SPOT_DELTA_DOMINANT"
  | "IV_VEGA_DOMINANT"
  | "TIME_DECAY_DOMINANT"
  | "MIXED_DRIVERS"
  | "RESIDUAL_LARGE"
  | "NO_MEANINGFUL_MOVE"
  | "INSUFFICIENT_HISTORY";

interface V2PremiumAttributionLeg {
  symbol: V2PremiumSymbol;
  side: V2PremiumSide;
  strike: number;
  timestamp: string;
  previousTimestamp: string | null;
  premiumChange: number | null;
  exactAccounting: {
    intrinsicChange: number | null;
    extrinsicChange: number | null;
    reconciliationError: number | null;
  };
  greekApproximation: {
    spotChange: number | null;
    ivChangePoints: number | null;
    elapsedDays: number | null;
    deltaContribution: number | null;
    vegaContribution: number | null;
    thetaContribution: number | null;
    explainedFirstOrder: number | null;
    residual: number | null;
    residualPctOfMove: number | null;
  };
  dominantDriver: V2PremiumAttributionState;
  dataQuality: V2DataQuality;
  guard: string;
}

function v2ElapsedDays(a: string, b: string): number | null {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta <= tb) return null;
  return (ta - tb) / 86_400_000;
}

function v2AttributionState(
  premiumChange: number,
  deltaC: number,
  vegaC: number,
  thetaC: number,
  residual: number
): V2PremiumAttributionState {
  const absMove = Math.abs(premiumChange);
  if (absMove < 1e-9) return "NO_MEANINGFUL_MOVE";
  if (Math.abs(residual) / absMove > 0.5) return "RESIDUAL_LARGE";
  const parts = [
    ["SPOT_DELTA_DOMINANT", Math.abs(deltaC)],
    ["IV_VEGA_DOMINANT", Math.abs(vegaC)],
    ["TIME_DECAY_DOMINANT", Math.abs(thetaC)],
  ] as const;
  const sorted = [...parts].sort((a,b)=>b[1]-a[1]);
  if (sorted[0][1] >= absMove * 0.5 && sorted[0][1] >= sorted[1][1] * 1.5) return sorted[0][0];
  return "MIXED_DRIVERS";
}

function v2BuildPremiumAttribution(comp: V2PremiumCompositionComparison): V2PremiumAttributionLeg {
  const cur = comp.current;
  const prev = comp.previous;
  if (!prev) {
    return {
      symbol: cur.symbol, side: cur.side, strike: cur.strike, timestamp: cur.timestamp, previousTimestamp: null,
      premiumChange: null,
      exactAccounting: { intrinsicChange: null, extrinsicChange: null, reconciliationError: null },
      greekApproximation: { spotChange: null, ivChangePoints: null, elapsedDays: null, deltaContribution: null, vegaContribution: null, thetaContribution: null, explainedFirstOrder: null, residual: null, residualPctOfMove: null },
      dominantDriver: "INSUFFICIENT_HISTORY", dataQuality: "INSUFFICIENT",
      guard: "Greek attribution is a first-order local approximation, not proof of causality."
    };
  }
  const premiumChange = cur.premium - prev.premium;
  const intrinsicChange = cur.intrinsic - prev.intrinsic;
  const extrinsicChange = cur.extrinsic - prev.extrinsic;
  const reconciliationError = premiumChange - intrinsicChange - extrinsicChange;
  const dtDays = v2ElapsedDays(cur.timestamp, prev.timestamp);
  const spotChange = cur.spot - prev.spot;
  const ivChange = cur.iv != null && prev.iv != null ? cur.iv - prev.iv : null;
  const deltaC = prev.delta != null ? prev.delta * spotChange : null;
  const vegaC = prev.vega != null && ivChange != null ? prev.vega * ivChange : null;
  const thetaC = prev.theta != null && dtDays != null ? prev.theta * dtDays : null;
  const complete = deltaC != null && vegaC != null && thetaC != null;
  const explained = complete ? deltaC! + vegaC! + thetaC! : null;
  const residual = explained != null ? premiumChange - explained : null;
  const residualPct = residual != null && Math.abs(premiumChange) > 1e-9 ? Math.abs(residual) / Math.abs(premiumChange) * 100 : null;
  const dominant = complete && residual != null
    ? v2AttributionState(premiumChange, deltaC!, vegaC!, thetaC!, residual)
    : "INSUFFICIENT_HISTORY";
  const dq: V2DataQuality = complete ? (comp.dataQuality === "OK" ? "OK" : "PARTIAL") : "PARTIAL";
  return {
    symbol: cur.symbol, side: cur.side, strike: cur.strike, timestamp: cur.timestamp, previousTimestamp: prev.timestamp,
    premiumChange,
    exactAccounting: { intrinsicChange, extrinsicChange, reconciliationError },
    greekApproximation: {
      spotChange, ivChangePoints: ivChange, elapsedDays: dtDays,
      deltaContribution: deltaC, vegaContribution: vegaC, thetaContribution: thetaC,
      explainedFirstOrder: explained, residual, residualPctOfMove: residualPct,
    },
    dominantDriver: dominant, dataQuality: dq,
    guard: "Delta/Vega/Theta attribution uses previous-snapshot Greeks and is first-order only; residual includes gamma and cross-effects."
  };
}

function buildV2PremiumAttribution(symbol: V2PremiumSymbol, maxSnapshots = 20) {
  const history = buildV2PremiumCompositionHistory(symbol, maxSnapshots);
  const attributions = (history.comparisons || []).map(v2BuildPremiumAttribution);
  const dataQuality: V2DataQuality = attributions.length === 0 ? "INSUFFICIENT" : attributions.every(x=>x.dataQuality === "OK") ? "OK" : "PARTIAL";
  return {
    symbol,
    generatedAt: new Date().toISOString(),
    snapshotCount: history.snapshotCount,
    attributions,
    dataQuality,
    scoringImpact: "NONE",
    source: "Existing Recorder same-strike 3-minute snapshots only; no new market-data request",
    interpretationGuard: "Use exact intrinsic/extrinsic accounting for accounting truth. Greek attribution is approximate diagnostic evidence only."
  };
}

// ============================================================================
// V2 MODULE 7 ‚Äî OI POSITIONING EVIDENCE ENGINE
// Observation-only diagnostic built from the Recorder's already-stored
// current-expiry ATM¬±3 same-strike OI + premium history.
//
// IMPORTANT LIMITATION:
// - Recorder snapshots currently DO NOT persist per-strike volume, so this
//   first safe version does NOT fabricate volume-change history and does NOT
//   claim buyer-vs-writer identity from OI alone.
// - Existing chain-level OI PCR / Volume PCR remain available elsewhere in
//   the dashboard, but are not historically synchronized inside Recorder yet.
// - No new Kite/API request, no Rule Engine/scoring change, no AI call.
// ============================================================================

type V2OiMotion = "BUILDING" | "UNWINDING" | "FLAT" | "INSUFFICIENT_HISTORY";
type V2OiPriceState =
  | "PRICE_UP_OI_UP"
  | "PRICE_DOWN_OI_UP"
  | "PRICE_UP_OI_DOWN"
  | "PRICE_DOWN_OI_DOWN"
  | "PRICE_FLAT_OI_UP"
  | "PRICE_FLAT_OI_DOWN"
  | "OI_FLAT"
  | "INSUFFICIENT_HISTORY";
type V2OiAggregateState =
  | "CE_OI_BUILDING"
  | "PE_OI_BUILDING"
  | "BOTH_OI_BUILDING"
  | "BOTH_OI_UNWINDING"
  | "CE_OI_UNWINDING"
  | "PE_OI_UNWINDING"
  | "MIXED"
  | "INSUFFICIENT_HISTORY";

interface V2OiLegEvidence {
  side: V2PremiumSide;
  strike: number;
  timestamp: string;
  previousTimestamp: string | null;
  premium: number;
  previousPremium: number | null;
  premiumChange: number | null;
  premiumChangePct: number | null;
  oi: number | null;
  previousOi: number | null;
  oiChange: number | null;
  oiChangePct: number | null;
  oiMotion: V2OiMotion;
  priceOiState: V2OiPriceState;
  dataQuality: V2DataQuality;
  interpretationGuard: string;
}

function v2SignedMotion(value: number | null, epsilon = 1e-9): "UP" | "DOWN" | "FLAT" | "UNKNOWN" {
  if (value == null || !Number.isFinite(value)) return "UNKNOWN";
  if (value > epsilon) return "UP";
  if (value < -epsilon) return "DOWN";
  return "FLAT";
}

function v2OiLegEvidence(comp: V2PremiumCompositionComparison): V2OiLegEvidence {
  const cur = comp.current;
  const prev = comp.previous;
  if (!prev || cur.oi == null || prev.oi == null) {
    return {
      side: cur.side, strike: cur.strike, timestamp: cur.timestamp, previousTimestamp: prev?.timestamp || null,
      premium: cur.premium, previousPremium: prev?.premium ?? null,
      premiumChange: prev ? cur.premium - prev.premium : null,
      premiumChangePct: prev && prev.premium !== 0 ? ((cur.premium - prev.premium) / prev.premium) * 100 : null,
      oi: cur.oi, previousOi: prev?.oi ?? null, oiChange: null, oiChangePct: null,
      oiMotion: "INSUFFICIENT_HISTORY", priceOiState: "INSUFFICIENT_HISTORY",
      dataQuality: "INSUFFICIENT",
      interpretationGuard: "OI measures outstanding positions; it does not identify whether buyers or writers initiated the change."
    };
  }

  const pDelta = cur.premium - prev.premium;
  const pPct = prev.premium !== 0 ? (pDelta / prev.premium) * 100 : null;
  const oiDelta = cur.oi - prev.oi;
  const oiPct = prev.oi !== 0 ? (oiDelta / prev.oi) * 100 : null;
  const pMotion = v2SignedMotion(pDelta, 1e-6);
  const oMotion = v2SignedMotion(oiDelta, 0.5);
  const oiMotion: V2OiMotion = oMotion === "UP" ? "BUILDING" : oMotion === "DOWN" ? "UNWINDING" : "FLAT";

  let priceOiState: V2OiPriceState = "OI_FLAT";
  if (oMotion === "UP" && pMotion === "UP") priceOiState = "PRICE_UP_OI_UP";
  else if (oMotion === "UP" && pMotion === "DOWN") priceOiState = "PRICE_DOWN_OI_UP";
  else if (oMotion === "DOWN" && pMotion === "UP") priceOiState = "PRICE_UP_OI_DOWN";
  else if (oMotion === "DOWN" && pMotion === "DOWN") priceOiState = "PRICE_DOWN_OI_DOWN";
  else if (oMotion === "UP" && pMotion === "FLAT") priceOiState = "PRICE_FLAT_OI_UP";
  else if (oMotion === "DOWN" && pMotion === "FLAT") priceOiState = "PRICE_FLAT_OI_DOWN";

  return {
    side: cur.side, strike: cur.strike, timestamp: cur.timestamp, previousTimestamp: prev.timestamp,
    premium: cur.premium, previousPremium: prev.premium,
    premiumChange: pDelta, premiumChangePct: pPct,
    oi: cur.oi, previousOi: prev.oi, oiChange: oiDelta, oiChangePct: oiPct,
    oiMotion, priceOiState,
    dataQuality: comp.dataQuality === "OK" ? "OK" : "PARTIAL",
    interpretationGuard: "Price+OI state is descriptive evidence only. Do not infer long/short ownership or buyer/writer identity from OI alone."
  };
}

function v2AggregateOiState(legs: V2OiLegEvidence[]): V2OiAggregateState {
  const valid = legs.filter(x => x.oiMotion !== "INSUFFICIENT_HISTORY");
  if (valid.length === 0) return "INSUFFICIENT_HISTORY";
  const ce = valid.filter(x => x.side === "CE");
  const pe = valid.filter(x => x.side === "PE");
  const score = (xs: V2OiLegEvidence[]) => xs.reduce((s,x)=>s + (x.oiMotion === "BUILDING" ? 1 : x.oiMotion === "UNWINDING" ? -1 : 0), 0);
  const ceS = score(ce), peS = score(pe);
  if (ceS > 0 && peS > 0) return "BOTH_OI_BUILDING";
  if (ceS < 0 && peS < 0) return "BOTH_OI_UNWINDING";
  if (ceS > 0 && peS <= 0) return "CE_OI_BUILDING";
  if (peS > 0 && ceS <= 0) return "PE_OI_BUILDING";
  if (ceS < 0 && peS >= 0) return "CE_OI_UNWINDING";
  if (peS < 0 && ceS >= 0) return "PE_OI_UNWINDING";
  return "MIXED";
}

function buildV2OiPositioningEvidence(symbol: V2PremiumSymbol, maxSnapshots = 20) {
  const history = buildV2PremiumCompositionHistory(symbol, maxSnapshots);
  const legs: V2OiLegEvidence[] = (history.comparisons || []).map(v2OiLegEvidence);
  const valid = legs.filter(x => x.dataQuality === "OK" || x.dataQuality === "PARTIAL");
  const dataQuality: V2DataQuality = legs.length === 0 ? "INSUFFICIENT" : valid.length === legs.length ? (legs.every(x=>x.dataQuality === "OK") ? "OK" : "PARTIAL") : valid.length > 0 ? "PARTIAL" : "INSUFFICIENT";
  return {
    symbol,
    generatedAt: new Date().toISOString(),
    snapshotCount: history.snapshotCount,
    aggregateState: v2AggregateOiState(legs),
    legs,
    volumeHistoryAvailable: false,
    chainContextNote: "Current OI PCR and Volume PCR exist in the live market snapshot, but Recorder does not yet persist synchronized per-strike volume history; this module does not invent it.",
    buyerWriterInference: "NOT_INFERRED",
    dataQuality,
    scoringImpact: "NONE",
    source: "Existing Recorder current-expiry ATM¬±3 same-strike premium/OI snapshots only; no new market-data request",
    interpretationGuard: "OI expansion/contraction is positioning evidence, not proof of long/short ownership."
  };
}

// ============================================================================
// V2 MODULE 8 ‚Äî ROLLOVER / EXPIRY MIGRATION EVIDENCE ENGINE
// Observation-only. Uses the multi-expiry option data already present in each
// 3-minute refresh and stores a tiny in-memory SUMMARY history (not full chains).
// This is required because true rollover is a CHANGE across time: current-expiry
// OI falling while next-expiry OI builds. A single cross-sectional chain cannot
// prove migration.
//
// Hard boundaries:
// - No new Kite/API requests.
// - No Rule Engine / score / verdict changes.
// - No AI/Haiku/GPT calls.
// - Does not change RecorderSnapshot schema or Drive archive format.
// - Stores only ATM¬±3 aggregate CE/PE OI + mean premium/IV for first two distinct
//   calendar expiries, capped to RECORDER_MAX_SNAPSHOTS.
// - OI is kept as the broker-reported raw value. Lot-size normalization is NOT
//   claimed here because PremiumData does not carry lot_size; historical/cross-era
//   normalization belongs to the Contract Metadata layer.
// - Rollover evidence is NOT directional market bias and does NOT identify buyers
//   versus writers.
// ============================================================================

type V2RolloverState =
  | "BOTH_SIDES_MIGRATING_TO_NEXT"
  | "CE_MIGRATION_TO_NEXT"
  | "PE_MIGRATION_TO_NEXT"
  | "CURRENT_UNWIND_WITHOUT_NEXT_BUILD"
  | "NEXT_BUILD_WITHOUT_CURRENT_UNWIND"
  | "STABLE"
  | "MIXED"
  | "INSUFFICIENT_HISTORY"
  | "INSUFFICIENT_DATA";

interface V2RolloverExpirySummary {
  expiryLabel: string;
  expiryDate: string;
  dte: number | null;
  atmStrike: number | null;
  ceOi: number | null;
  peOi: number | null;
  ceMeanPremium: number | null;
  peMeanPremium: number | null;
  ceMeanIv: number | null;
  peMeanIv: number | null;
  ceLotSize: number | null;
  peLotSize: number | null;
  lotSizeCompatibility: "MATCH" | "MISMATCH" | "UNKNOWN";
  expirySeriesType: "MONTH_END_SERIES" | "NON_MONTH_END_SERIES" | "UNKNOWN";
  strikeCountCe: number;
  strikeCountPe: number;
}

interface V2RolloverSnapshot {
  timestamp: string;
  symbol: V2PremiumSymbol;
  current: V2RolloverExpirySummary;
  next: V2RolloverExpirySummary;
}

const v2RolloverHistory: Record<V2PremiumSymbol, V2RolloverSnapshot[]> = {
  NIFTY: [], BANKNIFTY: [], SENSEX: [],
};

function v2ExpiryDte(expiryDate: Date): number | null {
  const t = expiryDate.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (t - Date.now()) / 86_400_000);
}

function v2NearAtmLegs(legs: PremiumData[] | undefined, range = 3): PremiumData[] {
  const xs = (legs || []).filter((x) => Number.isFinite(x.strike));
  const atm = xs.find((x) => x.isAtm);
  if (!atm) return [];
  const unique = Array.from(new Set(xs.map((x) => x.strike))).sort((a,b)=>a-b);
  const atmIndex = unique.indexOf(atm.strike);
  if (atmIndex < 0) return [];
  const allowed = new Set(unique.slice(Math.max(0, atmIndex-range), atmIndex+range+1));
  return xs.filter((x) => allowed.has(x.strike));
}

function v2SingleLotSize(xs: PremiumData[]): number | null {
  const vals = Array.from(new Set(xs.map((x) => x.lotSize).filter((v): v is number => Number.isFinite(v) && (v as number) > 0)));
  return vals.length === 1 ? vals[0] : null;
}

function v2ExpirySeriesType(exp: ExpiryData, allExpiries?: ExpiryData[]): "MONTH_END_SERIES" | "NON_MONTH_END_SERIES" | "UNKNOWN" {
  const d = v2IsoDateOnly(exp.expiryDate);
  if (!d) return "UNKNOWN";
  if (!allExpiries || allExpiries.length === 0) return exp.expiry === "Monthly" ? "MONTH_END_SERIES" : "UNKNOWN";
  const ym = d.slice(0, 7);
  const sameMonth = allExpiries
    .map((x) => v2IsoDateOnly(x.expiryDate))
    .filter((x) => x && x.slice(0, 7) === ym)
    .sort();
  if (sameMonth.length === 0) return "UNKNOWN";
  return d === sameMonth[sameMonth.length - 1] ? "MONTH_END_SERIES" : "NON_MONTH_END_SERIES";
}

function v2RolloverExpirySummary(exp: ExpiryData, allExpiries?: ExpiryData[]): V2RolloverExpirySummary {
  const ce = v2NearAtmLegs(exp.ceStrikes, 3);
  const pe = v2NearAtmLegs(exp.peStrikes, 3);
  const atm = ce.find((x)=>x.isAtm) || pe.find((x)=>x.isAtm);
  const sumOi = (xs: PremiumData[]) => {
    const vals = xs.map((x)=>x.oi).filter((v): v is number => Number.isFinite(v) && v >= 0);
    return vals.length ? vals.reduce((a,b)=>a+b,0) : null;
  };
  const meanField = (xs: PremiumData[], key: "lastPrice"|"iv") => {
    const vals = xs.map((x)=>x[key]).filter((v): v is number => Number.isFinite(v) && v >= 0);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };
  return {
    expiryLabel: exp.expiry,
    expiryDate: v2IsoDateOnly(exp.expiryDate),
    dte: v2ExpiryDte(exp.expiryDate),
    atmStrike: atm?.strike ?? null,
    ceOi: sumOi(ce), peOi: sumOi(pe),
    ceMeanPremium: meanField(ce,"lastPrice"), peMeanPremium: meanField(pe,"lastPrice"),
    ceMeanIv: meanField(ce,"iv"), peMeanIv: meanField(pe,"iv"),
    ceLotSize: v2SingleLotSize(ce),
    peLotSize: v2SingleLotSize(pe),
    lotSizeCompatibility: (() => {
      const a = v2SingleLotSize(ce), b = v2SingleLotSize(pe);
      return a == null || b == null ? "UNKNOWN" : a === b ? "MATCH" : "MISMATCH";
    })(),
    expirySeriesType: v2ExpirySeriesType(exp, allExpiries),
    strikeCountCe: ce.length, strikeCountPe: pe.length,
  };
}

function v2TwoDistinctExpiries(m: IndexMetrics | undefined): ExpiryData[] {
  if (!m || m.error) return [];
  const seen = new Set<string>();
  const out: ExpiryData[] = [];
  const sorted = [...(m.expiries || [])].sort((a,b)=>a.expiryDate.getTime()-b.expiryDate.getTime());
  for (const exp of sorted) {
    const d = v2IsoDateOnly(exp.expiryDate);
    if (!d || seen.has(d)) continue;
    seen.add(d); out.push(exp);
    if (out.length === 2) break;
  }
  return out;
}

function captureV2RolloverSummary(symbol: V2PremiumSymbol, m: IndexMetrics | undefined, timestamp: string): void {
  const exps = v2TwoDistinctExpiries(m);
  if (exps.length < 2) return;
  const snap: V2RolloverSnapshot = {
    timestamp, symbol,
    current: v2RolloverExpirySummary(exps[0], m?.expiries),
    next: v2RolloverExpirySummary(exps[1], m?.expiries),
  };
  if (!snap.current.expiryDate || !snap.next.expiryDate) return;
  const hist = v2RolloverHistory[symbol];
  hist.push(snap);
  if (hist.length > RECORDER_MAX_SNAPSHOTS) hist.shift();
  // 2026-08-20 (Week 1, PostgreSQL persistence): same fire-and-forget
  // contract as the other 3 write sites. `symbol` is embedded in the
  // payload itself (V2RolloverSnapshot.symbol) so restore-on-boot can
  // split this one shared "rollover_snapshot" kind back out per symbol.
  void dbInsert("rollover_snapshot", snap).catch(() => {});
}

function v2Delta(cur: number | null, prev: number | null): number | null {
  return cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) ? null : cur-prev;
}
function v2PctDelta(cur: number | null, prev: number | null): number | null {
  const d=v2Delta(cur,prev); return d==null || prev==null || prev===0 ? null : (d/prev)*100;
}
function v2RolloverSign(v: number | null): -1|0|1|null {
  if (v==null || !Number.isFinite(v)) return null;
  return v>0 ? 1 : v<0 ? -1 : 0;
}

function v2ClassifyRollover(curCe:number|null, prevCe:number|null, nextCe:number|null, prevNextCe:number|null,
                           curPe:number|null, prevPe:number|null, nextPe:number|null, prevNextPe:number|null): V2RolloverState {
  const cCe=v2RolloverSign(v2Delta(curCe,prevCe)), nCe=v2RolloverSign(v2Delta(nextCe,prevNextCe));
  const cPe=v2RolloverSign(v2Delta(curPe,prevPe)), nPe=v2RolloverSign(v2Delta(nextPe,prevNextPe));
  if ([cCe,nCe,cPe,nPe].some((x)=>x===null)) return "INSUFFICIENT_DATA";
  const ceMig=cCe===-1 && nCe===1, peMig=cPe===-1 && nPe===1;
  if (ceMig && peMig) return "BOTH_SIDES_MIGRATING_TO_NEXT";
  if (ceMig) return "CE_MIGRATION_TO_NEXT";
  if (peMig) return "PE_MIGRATION_TO_NEXT";
  if ((cCe===-1 || cPe===-1) && !(nCe===1 || nPe===1)) return "CURRENT_UNWIND_WITHOUT_NEXT_BUILD";
  if ((nCe===1 || nPe===1) && !(cCe===-1 || cPe===-1)) return "NEXT_BUILD_WITHOUT_CURRENT_UNWIND";
  if (cCe===0 && nCe===0 && cPe===0 && nPe===0) return "STABLE";
  return "MIXED";
}

function buildV2RolloverMigration(symbol: V2PremiumSymbol) {
  const hist = v2RolloverHistory[symbol];
  const latest = hist[hist.length-1];
  if (!latest) return {
    symbol, generatedAt:new Date().toISOString(), state:"INSUFFICIENT_DATA" as V2RolloverState,
    snapshotCount:0, dataQuality:"INSUFFICIENT" as V2DataQuality, scoringImpact:"NONE",
    source:"Existing 3-minute multi-expiry market refresh summaries only; no new market-data request",
    interpretationGuard:"Rollover requires time-series evidence. No summary history is available yet."
  };
  let previous: V2RolloverSnapshot|undefined;
  for (let i=hist.length-2;i>=0;i--) {
    const p=hist[i];
    if (p.current.expiryDate===latest.current.expiryDate && p.next.expiryDate===latest.next.expiryDate) { previous=p; break; }
  }
  if (!previous) return {
    symbol, generatedAt:new Date().toISOString(), state:"INSUFFICIENT_HISTORY" as V2RolloverState,
    snapshotCount:hist.length, current:latest.current, next:latest.next,
    dataQuality:"INSUFFICIENT" as V2DataQuality, scoringImpact:"NONE",
    lotSizeNormalization:"AVAILABLE_FROM_H1_CONTRACT_METADATA",
    crossExpiryLotComparable:false,
    buyerWriterInference:"NOT_INFERRED",
    interpretationGuard:"Need at least two 3-minute summaries with the same current/next calendar expiries before migration can be assessed."
  };
  const crossExpiryLotComparable =
    latest.current.ceLotSize != null && latest.current.peLotSize != null &&
    latest.next.ceLotSize != null && latest.next.peLotSize != null &&
    latest.current.ceLotSize === latest.next.ceLotSize &&
    latest.current.peLotSize === latest.next.peLotSize;

  const deltas = {
    currentCeOi: v2Delta(latest.current.ceOi, previous.current.ceOi),
    nextCeOi: v2Delta(latest.next.ceOi, previous.next.ceOi),
    currentPeOi: v2Delta(latest.current.peOi, previous.current.peOi),
    nextPeOi: v2Delta(latest.next.peOi, previous.next.peOi),
    currentCeOiPct: v2PctDelta(latest.current.ceOi, previous.current.ceOi),
    nextCeOiPct: v2PctDelta(latest.next.ceOi, previous.next.ceOi),
    currentPeOiPct: v2PctDelta(latest.current.peOi, previous.current.peOi),
    nextPeOiPct: v2PctDelta(latest.next.peOi, previous.next.peOi),
  };
  const state = crossExpiryLotComparable
    ? v2ClassifyRollover(latest.current.ceOi,previous.current.ceOi,latest.next.ceOi,previous.next.ceOi,
                        latest.current.peOi,previous.current.peOi,latest.next.peOi,previous.next.peOi)
    : "INSUFFICIENT_DATA" as V2RolloverState;
  const complete=Object.values(deltas).slice(0,4).every((v)=>v!=null);
  return {
    symbol, generatedAt:new Date().toISOString(), state, snapshotCount:hist.length,
    current:latest.current, next:latest.next, previousTimestamp:previous.timestamp, currentTimestamp:latest.timestamp,
    deltas,
    dataQuality:(complete?"OK":"PARTIAL") as V2DataQuality,
    scoringImpact:"NONE",
    source:"Existing 3-minute multi-expiry market refresh summaries only; no new Kite/API request",
    lotSizeNormalization:"AVAILABLE_FROM_H1_CONTRACT_METADATA",
    crossExpiryLotComparable,
    buyerWriterInference:"NOT_INFERRED",
    directionalBias:"NONE",
    interpretationGuard: crossExpiryLotComparable ? "Migration means raw OI decreased in current expiry while raw OI increased in next expiry on the same CE/PE side. It is evidence of expiry migration only, not proof of bullish/bearish direction or buyer/writer identity." : "Current and next expiries do not expose matching valid lot sizes, so raw cross-expiry OI migration is not classified. H3 blocks this comparison rather than inventing a normalization."
  };
}

// ============================================================================
// V2 MODULE 2 ‚Äî COMPUTED IV CHANGE + STRIKE SKEW ENGINE
// Observation-only, additive diagnostic built from the Recorder's already-stored
// current-expiry ATM¬±3 strike IV values. IV here is MODEL-COMPUTED from option
// LTP via calcImpliedVolatility(); it is NOT a Kite-published IV field.
//
// Hard boundaries:
// - No new Kite/API requests.
// - No runRuleEngine()/score/verdict changes.
// - No AI/Haiku/GPT calls.
// - No mutation of Recorder snapshots.
// - Current skew can be reported from one valid snapshot; 3-minute skew-change
//   requires a prior valid snapshot with the SAME ATM strike to avoid mixing
//   different skew anchors after an ATM roll.
// ============================================================================

type V2IvRelativeState = "CE_ATM_IV_PREMIUM" | "PE_ATM_IV_PREMIUM" | "ATM_IV_BALANCED" | "INSUFFICIENT_DATA";
type V2WingSkewState = "CE_WING_STEEPER" | "PE_WING_STEEPER" | "WINGS_BALANCED" | "INSUFFICIENT_DATA";
type V2IvMotionState =
  | "BOTH_IV_RISING"
  | "BOTH_IV_FALLING"
  | "CE_IV_RISING_PE_NOT_RISING"
  | "PE_IV_RISING_CE_NOT_RISING"
  | "CE_IV_FALLING_PE_NOT_FALLING"
  | "PE_IV_FALLING_CE_NOT_FALLING"
  | "ATM_IV_FLAT"
  | "MIXED"
  | "INSUFFICIENT_HISTORY";
type V2SkewChangeState =
  | "CE_SKEW_STEEPENING"
  | "PE_SKEW_STEEPENING"
  | "BOTH_SKEWS_STEEPENING"
  | "BOTH_SKEWS_FLATTENING"
  | "CE_STEEPENING_PE_FLATTENING"
  | "PE_STEEPENING_CE_FLATTENING"
  | "SKEW_STABLE"
  | "MIXED"
  | "INSUFFICIENT_HISTORY";

interface V2IvSkewSnapshot {
  timestamp: string;
  snapshotId: string;
  snapshotStatus: RecorderSnapshot["snapshotStatus"];
  symbol: V2PremiumSymbol;
  atmStrike: number;
  atmCeIv: number | null;
  atmPeIv: number | null;
  ceOtmWingIvs: Array<{ strike: number; iv: number }>;
  peOtmWingIvs: Array<{ strike: number; iv: number }>;
  ceWingAverageIv: number | null;
  peWingAverageIv: number | null;
  ceWingVsAtmSpread: number | null;
  peWingVsAtmSpread: number | null;
  atmPeMinusCeSpread: number | null;
  wingSkewDifference: number | null; // PE wing spread - CE wing spread
  relativeAtmState: V2IvRelativeState;
  wingSkewState: V2WingSkewState;
  dataQuality: V2DataQuality;
}

function v2FiniteIv(iv: number | null | undefined): number | null {
  return iv != null && Number.isFinite(iv) && iv > 0 ? iv : null;
}

function v2Average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function v2Sign(value: number | null, eps = 1e-9): -1 | 0 | 1 | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > eps) return 1;
  if (value < -eps) return -1;
  return 0;
}

function buildV2IvSkewSnapshot(snap: RecorderSnapshot, symbol: V2PremiumSymbol): V2IvSkewSnapshot | null {
  if (snap.snapshotStatus === "STALE" || snap.snapshotStatus === "INVALID") return null;
  const idx = snap[symbol];
  if (!idx || idx.atmStrike == null) return null;

  const atmStrike = idx.atmStrike;
  const ceLegs = idx.ceStrikesNear || [];
  const peLegs = idx.peStrikesNear || [];
  const atmCe = ceLegs.find((x) => x.strike === atmStrike);
  const atmPe = peLegs.find((x) => x.strike === atmStrike);
  const atmCeIv = v2FiniteIv(atmCe?.iv);
  const atmPeIv = v2FiniteIv(atmPe?.iv);

  // OTM wings only: calls above ATM, puts below ATM. This avoids mixing ITM
  // and OTM contracts into a single "wing" measure.
  const ceOtmWingIvs = ceLegs
    .filter((x) => x.strike > atmStrike)
    .map((x) => ({ strike: x.strike, iv: v2FiniteIv(x.iv) }))
    .filter((x): x is { strike: number; iv: number } => x.iv != null);
  const peOtmWingIvs = peLegs
    .filter((x) => x.strike < atmStrike)
    .map((x) => ({ strike: x.strike, iv: v2FiniteIv(x.iv) }))
    .filter((x): x is { strike: number; iv: number } => x.iv != null);

  const ceWingAverageIv = v2Average(ceOtmWingIvs.map((x) => x.iv));
  const peWingAverageIv = v2Average(peOtmWingIvs.map((x) => x.iv));
  const ceWingVsAtmSpread = ceWingAverageIv != null && atmCeIv != null ? ceWingAverageIv - atmCeIv : null;
  const peWingVsAtmSpread = peWingAverageIv != null && atmPeIv != null ? peWingAverageIv - atmPeIv : null;
  const atmPeMinusCeSpread = atmPeIv != null && atmCeIv != null ? atmPeIv - atmCeIv : null;
  const wingSkewDifference = peWingVsAtmSpread != null && ceWingVsAtmSpread != null ? peWingVsAtmSpread - ceWingVsAtmSpread : null;

  const atmSpreadSign = v2Sign(atmPeMinusCeSpread);
  const relativeAtmState: V2IvRelativeState = atmSpreadSign == null
    ? "INSUFFICIENT_DATA"
    : atmSpreadSign > 0
      ? "PE_ATM_IV_PREMIUM"
      : atmSpreadSign < 0
        ? "CE_ATM_IV_PREMIUM"
        : "ATM_IV_BALANCED";

  const wingDiffSign = v2Sign(wingSkewDifference);
  const wingSkewState: V2WingSkewState = wingDiffSign == null
    ? "INSUFFICIENT_DATA"
    : wingDiffSign > 0
      ? "PE_WING_STEEPER"
      : wingDiffSign < 0
        ? "CE_WING_STEEPER"
        : "WINGS_BALANCED";

  const requiredReady = atmCeIv != null && atmPeIv != null;
  const wingsReady = ceWingVsAtmSpread != null && peWingVsAtmSpread != null;
  const dataQuality: V2DataQuality = !requiredReady ? "INSUFFICIENT" : !wingsReady ? "PARTIAL" : "OK";

  return {
    timestamp: snap.backendTimestamp,
    snapshotId: snap.snapshotId,
    snapshotStatus: snap.snapshotStatus,
    symbol,
    atmStrike,
    atmCeIv,
    atmPeIv,
    ceOtmWingIvs,
    peOtmWingIvs,
    ceWingAverageIv,
    peWingAverageIv,
    ceWingVsAtmSpread,
    peWingVsAtmSpread,
    atmPeMinusCeSpread,
    wingSkewDifference,
    relativeAtmState,
    wingSkewState,
    dataQuality,
  };
}

function v2IvMotionState(current: V2IvSkewSnapshot, previous: V2IvSkewSnapshot | null): V2IvMotionState {
  if (!previous || previous.atmStrike !== current.atmStrike) return "INSUFFICIENT_HISTORY";
  if (current.atmCeIv == null || current.atmPeIv == null || previous.atmCeIv == null || previous.atmPeIv == null) return "INSUFFICIENT_HISTORY";
  const ce = v2Sign(current.atmCeIv - previous.atmCeIv);
  const pe = v2Sign(current.atmPeIv - previous.atmPeIv);
  if (ce === 1 && pe === 1) return "BOTH_IV_RISING";
  if (ce === -1 && pe === -1) return "BOTH_IV_FALLING";
  if (ce === 1 && pe !== 1) return "CE_IV_RISING_PE_NOT_RISING";
  if (pe === 1 && ce !== 1) return "PE_IV_RISING_CE_NOT_RISING";
  if (ce === -1 && pe !== -1) return "CE_IV_FALLING_PE_NOT_FALLING";
  if (pe === -1 && ce !== -1) return "PE_IV_FALLING_CE_NOT_FALLING";
  if (ce === 0 && pe === 0) return "ATM_IV_FLAT";
  return "MIXED";
}

function v2SkewChangeState(current: V2IvSkewSnapshot, previous: V2IvSkewSnapshot | null): V2SkewChangeState {
  if (!previous || previous.atmStrike !== current.atmStrike) return "INSUFFICIENT_HISTORY";
  if (current.ceWingVsAtmSpread == null || current.peWingVsAtmSpread == null || previous.ceWingVsAtmSpread == null || previous.peWingVsAtmSpread == null) {
    return "INSUFFICIENT_HISTORY";
  }
  const ce = v2Sign(current.ceWingVsAtmSpread - previous.ceWingVsAtmSpread);
  const pe = v2Sign(current.peWingVsAtmSpread - previous.peWingVsAtmSpread);
  if (ce === 1 && pe === 1) return "BOTH_SKEWS_STEEPENING";
  if (ce === -1 && pe === -1) return "BOTH_SKEWS_FLATTENING";
  if (ce === 1 && pe === -1) return "CE_STEEPENING_PE_FLATTENING";
  if (pe === 1 && ce === -1) return "PE_STEEPENING_CE_FLATTENING";
  if (ce === 1 && pe === 0) return "CE_SKEW_STEEPENING";
  if (pe === 1 && ce === 0) return "PE_SKEW_STEEPENING";
  if (ce === 0 && pe === 0) return "SKEW_STABLE";
  return "MIXED";
}

function buildV2IvSkewHistory(symbol: V2PremiumSymbol, maxSnapshots = 20) {
  const eligible = recorderSession.snapshots
    .filter((s) => s.snapshotStatus !== "STALE" && s.snapshotStatus !== "INVALID" && s[symbol] != null)
    .slice(-Math.max(2, Math.min(maxSnapshots, RECORDER_MAX_SNAPSHOTS)));

  if (eligible.length === 0) {
    return {
      symbol,
      generatedAt: new Date().toISOString(),
      snapshotCount: 0,
      current: null,
      previousComparable: null,
      change: null,
      dataQuality: "INSUFFICIENT" as V2DataQuality,
      scoringImpact: "NONE",
    };
  }

  const current = buildV2IvSkewSnapshot(eligible[eligible.length - 1], symbol);
  if (!current) {
    return {
      symbol,
      generatedAt: new Date().toISOString(),
      snapshotCount: eligible.length,
      current: null,
      previousComparable: null,
      change: null,
      dataQuality: "INSUFFICIENT" as V2DataQuality,
      scoringImpact: "NONE",
    };
  }

  let previousComparable: V2IvSkewSnapshot | null = null;
  for (let i = eligible.length - 2; i >= 0; i--) {
    const candidate = buildV2IvSkewSnapshot(eligible[i], symbol);
    if (candidate && candidate.atmStrike === current.atmStrike) {
      previousComparable = candidate;
      break;
    }
  }

  const change = {
    previousTimestamp: previousComparable?.timestamp || null,
    atmContinuity: previousComparable != null,
    atmCeIv: v2Change(current.atmCeIv, previousComparable?.atmCeIv ?? null),
    atmPeIv: v2Change(current.atmPeIv, previousComparable?.atmPeIv ?? null),
    ceWingVsAtmSpread: v2Change(current.ceWingVsAtmSpread, previousComparable?.ceWingVsAtmSpread ?? null),
    peWingVsAtmSpread: v2Change(current.peWingVsAtmSpread, previousComparable?.peWingVsAtmSpread ?? null),
    atmPeMinusCeSpread: v2Change(current.atmPeMinusCeSpread, previousComparable?.atmPeMinusCeSpread ?? null),
    wingSkewDifference: v2Change(current.wingSkewDifference, previousComparable?.wingSkewDifference ?? null),
    ivMotionState: v2IvMotionState(current, previousComparable),
    skewChangeState: v2SkewChangeState(current, previousComparable),
  };

  const dataQuality: V2DataQuality = current.dataQuality === "INSUFFICIENT"
    ? "INSUFFICIENT"
    : previousComparable == null
      ? "PARTIAL"
      : current.dataQuality;

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    latestSnapshotAt: current.timestamp,
    source: "Recorder 3-minute Truth-gated snapshots; current expiry ATM¬±3; IV is model-computed from option LTP, not supplied by Kite",
    methodology: {
      atmRelativeSpread: "ATM PE IV - ATM CE IV",
      ceWingSpread: "average OTM CE IV above ATM - ATM CE IV",
      peWingSpread: "average OTM PE IV below ATM - ATM PE IV",
      wingSkewDifference: "PE wing spread - CE wing spread",
      historyRule: "3-minute change requires same ATM strike across snapshots",
    },
    scoringImpact: "NONE",
    snapshotCount: eligible.length,
    dataQuality,
    current,
    previousComparable,
    change,
    interpretationGuard: "IV/skew describes volatility pricing/asymmetry only. It does not independently mean bullish, bearish, BUY, or SELL.",
  };
}


// ============================================================================
// V2 MODULE 3 ‚Äî MULTI-EXPIRY IV TERM STRUCTURE ENGINE
// Observation-only, additive diagnostic built from the multi-expiry option data
// ALREADY fetched into IndexMetrics.expiries. IV is MODEL-COMPUTED from option
// LTP via calcImpliedVolatility(); it is NOT a Kite-published IV field.
//
// Hard boundaries:
// - No new Kite/API requests.
// - No runRuleEngine()/score/verdict changes.
// - No AI/Haiku/GPT calls.
// - No Recorder mutation or storage expansion.
// - Uses each expiry's ATM CE/PE only and deduplicates identical calendar expiries.
// - Every expiry row must pass its own option-quote freshness check.
// ============================================================================

type V2TermStructureState = "FRONT_LOADED_IV" | "BACK_LOADED_IV" | "MIXED_TERM_STRUCTURE" | "FLAT_EXACT" | "INSUFFICIENT_DATA";

interface V2TermStructureRow {
  expiryLabel: string;
  expiryDate: string;
  atmStrike: number | null;
  atmCeIv: number | null;
  atmPeIv: number | null;
  atmMeanIv: number | null;
  ceQuoteTimestamp: string | null;
  peQuoteTimestamp: string | null;
  ceFreshness: TruthVerdict;
  peFreshness: TruthVerdict;
  dataQuality: V2DataQuality;
}

function v2IsoDateOnly(d: Date): string {
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

function v2TermRow(expiry: ExpiryData): V2TermStructureRow {
  const atmCe = (expiry.ceStrikes || []).find((s) => s.isAtm);
  const atmPe = (expiry.peStrikes || []).find((s) => s.isAtm);
  const ceIv = v2FiniteIv(atmCe?.iv);
  const peIv = v2FiniteIv(atmPe?.iv);
  const ceFresh = atmCe ? classifyTruthField(atmCe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options) : { verdict: "INVALID" as TruthVerdict, ageMs: null, reason: "no_ce_leg" };
  const peFresh = atmPe ? classifyTruthField(atmPe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options) : { verdict: "INVALID" as TruthVerdict, ageMs: null, reason: "no_pe_leg" };
  const validCe = ceFresh.verdict === "TRUE" ? ceIv : null;
  const validPe = peFresh.verdict === "TRUE" ? peIv : null;
  const ivs = [validCe, validPe].filter((x): x is number => x != null);
  const atmMeanIv = ivs.length ? v2Average(ivs) : null;
  const dataQuality: V2DataQuality = validCe != null && validPe != null ? "OK" : atmMeanIv != null ? "PARTIAL" : "INSUFFICIENT";
  return { expiryLabel: expiry.expiry, expiryDate: v2IsoDateOnly(expiry.expiryDate), atmStrike: atmCe?.strike ?? atmPe?.strike ?? null, atmCeIv: validCe, atmPeIv: validPe, atmMeanIv, ceQuoteTimestamp: atmCe?.quoteTimestamp || null, peQuoteTimestamp: atmPe?.quoteTimestamp || null, ceFreshness: ceFresh.verdict, peFreshness: peFresh.verdict, dataQuality };
}

function v2ClassifyTermStructure(rows: V2TermStructureRow[]): V2TermStructureState {
  const valid = rows.filter((r) => r.atmMeanIv != null);
  if (valid.length < 2) return "INSUFFICIENT_DATA";
  const vals = valid.map((r) => r.atmMeanIv as number);
  let nonIncreasing = true, nonDecreasing = true, anyDown = false, anyUp = false;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i - 1]) { nonIncreasing = false; anyUp = true; }
    if (vals[i] < vals[i - 1]) { nonDecreasing = false; anyDown = true; }
  }
  if (nonIncreasing && anyDown) return "FRONT_LOADED_IV";
  if (nonDecreasing && anyUp) return "BACK_LOADED_IV";
  if (!anyUp && !anyDown) return "FLAT_EXACT";
  return "MIXED_TERM_STRUCTURE";
}

function buildV2IvTermStructure(symbol: V2PremiumSymbol, m: IndexMetrics | undefined) {
  if (!m || m.error) return { symbol, generatedAt: new Date().toISOString(), source: "Existing multi-expiry IndexMetrics only; no additional Kite request", ivSource: "MODEL_COMPUTED_FROM_OPTION_LTP_NOT_KITE_PUBLISHED_IV", scoringImpact: "NONE", state: "INSUFFICIENT_DATA" as V2TermStructureState, dataQuality: "INSUFFICIENT" as V2DataQuality, rows: [] as V2TermStructureRow[] };
  const seenDates = new Set<string>();
  const rows: V2TermStructureRow[] = [];
  for (const exp of m.expiries || []) {
    const row = v2TermRow(exp);
    if (!row.expiryDate || seenDates.has(row.expiryDate)) continue;
    seenDates.add(row.expiryDate);
    rows.push(row);
  }
  rows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const usable = rows.filter((r) => r.atmMeanIv != null);
  const state = v2ClassifyTermStructure(rows);
  const dataQuality: V2DataQuality = usable.length < 2 ? "INSUFFICIENT" : rows.every((r) => r.dataQuality === "OK") ? "OK" : "PARTIAL";
  return { symbol, generatedAt: new Date().toISOString(), source: "Existing multi-expiry IndexMetrics only; no additional Kite request", ivSource: "MODEL_COMPUTED_FROM_OPTION_LTP_NOT_KITE_PUBLISHED_IV", scoringImpact: "NONE", state, dataQuality, usableExpiryCount: usable.length, rows };
}



// ============================================================================
// V2 MODULE 9 ‚Äî MULTI-EXPIRY ALIGNMENT EVIDENCE ENGINE
// Observation-only, additive diagnostic. Reuses the already-fetched Current /
// Next / Next-of-Next / Monthly option data plus Module 8 rollover context.
// It performs NO new Kite/API request and does NOT alter scoring/verdicts.
//
// Scientific guardrails:
// - CE-vs-PE OI is participation/positioning context, NOT buyer-vs-writer proof.
// - CE-vs-PE IV asymmetry is volatility-pricing context, NOT direction by itself.
// - Premium levels are reported as context only; different expiries have
//   different DTE/theta/vega and must not be compared as equivalent contracts.
// - At least two distinct calendar expiries are required for an alignment state.
// ============================================================================

type V2MultiExpiryOiAlignment =
  | "CE_OI_TILT_CONSISTENT"
  | "PE_OI_TILT_CONSISTENT"
  | "OI_BALANCED"
  | "OI_MIXED"
  | "INSUFFICIENT_DATA";

type V2MultiExpiryIvAlignment =
  | "CE_IV_PREMIUM_CONSISTENT"
  | "PE_IV_PREMIUM_CONSISTENT"
  | "IV_BALANCED"
  | "IV_MIXED"
  | "INSUFFICIENT_DATA";

type V2MultiExpiryAlignmentState =
  | "CE_SIDE_STRUCTURE_ALIGNED"
  | "PE_SIDE_STRUCTURE_ALIGNED"
  | "OI_ONLY_ALIGNMENT"
  | "IV_ONLY_ALIGNMENT"
  | "CROSS_EXPIRY_CONFLICT"
  | "BALANCED_OR_MIXED"
  | "INSUFFICIENT_DATA";

interface V2MultiExpiryAlignmentRow {
  expiryLabel: string;
  expiryDate: string;
  dte: number | null;
  atmStrike: number | null;
  ceOi: number | null;
  peOi: number | null;
  ceOiSharePct: number | null;
  peOiSharePct: number | null;
  ceMeanIv: number | null;
  peMeanIv: number | null;
  ivSpreadCeMinusPe: number | null;
  ceMeanPremium: number | null;
  peMeanPremium: number | null;
  ceLotSize: number | null;
  peLotSize: number | null;
  lotSizeCompatibility: "MATCH" | "MISMATCH" | "UNKNOWN";
  expirySeriesType: "MONTH_END_SERIES" | "NON_MONTH_END_SERIES" | "UNKNOWN";
  strikeCountCe: number;
  strikeCountPe: number;
  dataQuality: V2DataQuality;
}

function v2MultiExpiryRow(exp: ExpiryData): V2MultiExpiryAlignmentRow {
  const s = v2RolloverExpirySummary(exp);
  const totalOi = s.ceOi != null && s.peOi != null ? s.ceOi + s.peOi : null;
  const ceShare = totalOi != null && totalOi > 0 && s.ceOi != null ? (s.ceOi / totalOi) * 100 : null;
  const peShare = totalOi != null && totalOi > 0 && s.peOi != null ? (s.peOi / totalOi) * 100 : null;
  const ivSpread = s.ceMeanIv != null && s.peMeanIv != null ? s.ceMeanIv - s.peMeanIv : null;
  const required = [s.ceOi, s.peOi, s.ceMeanIv, s.peMeanIv];
  const present = required.filter((v) => v != null && Number.isFinite(v as number)).length;
  const dataQuality: V2DataQuality = present === 4 ? "OK" : present >= 2 ? "PARTIAL" : "INSUFFICIENT";
  return {
    expiryLabel: s.expiryLabel,
    expiryDate: s.expiryDate,
    dte: s.dte,
    atmStrike: s.atmStrike,
    ceOi: s.ceOi,
    peOi: s.peOi,
    ceOiSharePct: ceShare,
    peOiSharePct: peShare,
    ceMeanIv: s.ceMeanIv,
    peMeanIv: s.peMeanIv,
    ivSpreadCeMinusPe: ivSpread,
    ceMeanPremium: s.ceMeanPremium,
    peMeanPremium: s.peMeanPremium,
    ceLotSize: s.ceLotSize,
    peLotSize: s.peLotSize,
    lotSizeCompatibility: s.lotSizeCompatibility,
    expirySeriesType: s.expirySeriesType,
    strikeCountCe: s.strikeCountCe,
    strikeCountPe: s.strikeCountPe,
    dataQuality,
  };
}

function v2ClassifyMultiExpiryOi(rows: V2MultiExpiryAlignmentRow[]): V2MultiExpiryOiAlignment {
  const usable = rows.filter((r) => r.ceOiSharePct != null && r.peOiSharePct != null);
  if (usable.length < 2) return "INSUFFICIENT_DATA";
  // Descriptive guard-band only; NOT a scoring threshold. 55/45 avoids calling
  // tiny numerical differences an "alignment" while preserving a neutral zone.
  const ceTilt = usable.filter((r) => (r.ceOiSharePct as number) >= 55).length;
  const peTilt = usable.filter((r) => (r.peOiSharePct as number) >= 55).length;
  const balanced = usable.filter((r) => {
    const ce = r.ceOiSharePct as number;
    return ce > 45 && ce < 55;
  }).length;
  if (ceTilt === usable.length) return "CE_OI_TILT_CONSISTENT";
  if (peTilt === usable.length) return "PE_OI_TILT_CONSISTENT";
  if (balanced === usable.length) return "OI_BALANCED";
  return "OI_MIXED";
}

function v2ClassifyMultiExpiryIv(rows: V2MultiExpiryAlignmentRow[]): V2MultiExpiryIvAlignment {
  const usable = rows.filter((r) => r.ivSpreadCeMinusPe != null);
  if (usable.length < 2) return "INSUFFICIENT_DATA";
  // IV is in percentage points. A small 0.25 vol-point dead-band prevents
  // floating-point/model noise from being called a structural asymmetry.
  const cePremium = usable.filter((r) => (r.ivSpreadCeMinusPe as number) >= 0.25).length;
  const pePremium = usable.filter((r) => (r.ivSpreadCeMinusPe as number) <= -0.25).length;
  const balanced = usable.filter((r) => Math.abs(r.ivSpreadCeMinusPe as number) < 0.25).length;
  if (cePremium === usable.length) return "CE_IV_PREMIUM_CONSISTENT";
  if (pePremium === usable.length) return "PE_IV_PREMIUM_CONSISTENT";
  if (balanced === usable.length) return "IV_BALANCED";
  return "IV_MIXED";
}

function v2ClassifyMultiExpiryOverall(
  oi: V2MultiExpiryOiAlignment,
  iv: V2MultiExpiryIvAlignment
): V2MultiExpiryAlignmentState {
  if (oi === "INSUFFICIENT_DATA" && iv === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  if (oi === "CE_OI_TILT_CONSISTENT" && iv === "CE_IV_PREMIUM_CONSISTENT") return "CE_SIDE_STRUCTURE_ALIGNED";
  if (oi === "PE_OI_TILT_CONSISTENT" && iv === "PE_IV_PREMIUM_CONSISTENT") return "PE_SIDE_STRUCTURE_ALIGNED";
  if ((oi === "CE_OI_TILT_CONSISTENT" && iv === "PE_IV_PREMIUM_CONSISTENT") ||
      (oi === "PE_OI_TILT_CONSISTENT" && iv === "CE_IV_PREMIUM_CONSISTENT")) return "CROSS_EXPIRY_CONFLICT";
  if (oi === "CE_OI_TILT_CONSISTENT" || oi === "PE_OI_TILT_CONSISTENT") return "OI_ONLY_ALIGNMENT";
  if (iv === "CE_IV_PREMIUM_CONSISTENT" || iv === "PE_IV_PREMIUM_CONSISTENT") return "IV_ONLY_ALIGNMENT";
  return "BALANCED_OR_MIXED";
}

function buildV2MultiExpiryAlignment(symbol: V2PremiumSymbol, m: IndexMetrics | undefined) {
  if (!m || m.error) return {
    symbol,
    generatedAt: new Date().toISOString(),
    state: "INSUFFICIENT_DATA" as V2MultiExpiryAlignmentState,
    oiAlignment: "INSUFFICIENT_DATA" as V2MultiExpiryOiAlignment,
    ivAlignment: "INSUFFICIENT_DATA" as V2MultiExpiryIvAlignment,
    dataQuality: "INSUFFICIENT" as V2DataQuality,
    rows: [] as V2MultiExpiryAlignmentRow[],
    scoringImpact: "NONE",
    directionalBias: "NONE",
    source: "Existing multi-expiry IndexMetrics only; no additional Kite request",
    interpretationGuard: "Multi-expiry alignment needs at least two distinct calendar expiries with usable near-ATM OI/IV data."
  };

  const seen = new Set<string>();
  const rows: V2MultiExpiryAlignmentRow[] = [];
  for (const exp of [...(m.expiries || [])].sort((a,b)=>a.expiryDate.getTime()-b.expiryDate.getTime())) {
    const row = v2MultiExpiryRow(exp);
    if (!row.expiryDate || seen.has(row.expiryDate)) continue;
    seen.add(row.expiryDate);
    rows.push(row);
  }
  const oiAlignment = v2ClassifyMultiExpiryOi(rows);
  const ivAlignment = v2ClassifyMultiExpiryIv(rows);
  const state = v2ClassifyMultiExpiryOverall(oiAlignment, ivAlignment);
  const usableRows = rows.filter((r) => r.dataQuality !== "INSUFFICIENT");
  const dataQuality: V2DataQuality = usableRows.length < 2 ? "INSUFFICIENT" : rows.every((r)=>r.dataQuality==="OK") ? "OK" : "PARTIAL";
  const rollover = buildV2RolloverMigration(symbol);
  return {
    symbol,
    generatedAt: new Date().toISOString(),
    state,
    oiAlignment,
    ivAlignment,
    dataQuality,
    usableExpiryCount: usableRows.length,
    rows,
    rolloverContext: {
      state: rollover.state,
      snapshotCount: rollover.snapshotCount ?? 0,
      dataQuality: rollover.dataQuality,
    },
    scoringImpact: "NONE",
    directionalBias: "NONE",
    buyerWriterInference: "NOT_INFERRED",
    lotSizeNormalization: "AVAILABLE_FROM_H1_CONTRACT_METADATA; NOT_USED_AS_DIRECTIONAL_SIGNAL",
    source: "Already-fetched multi-expiry near-ATM option data + Module 8 rollover summary; no additional Kite/API request",
    interpretationGuard: "CE/PE OI tilt and IV asymmetry are participation/volatility-pricing evidence only. They do not independently imply bullish/bearish direction or buyer/writer identity.",
    comparisonGuard: "Premium levels across expiries are context only because DTE/theta/vega differ; raw premium equality is not assumed."
  };
}

// ============================================================================
// V2 MODULE 4 ‚Äî INDIA VIX REGIME ENGINE
// Observation-only, additive diagnostic. Reuses the SAME one-year VIX history
// already fetched by /api/vix-correlation plus the current in-memory market
// snapshot/session history. It creates NO additional Kite/API request.
//
// Hard boundaries:
// - No runRuleEngine()/score/verdict changes.
// - No AI/Haiku/GPT calls.
// - No Recorder mutation.
// - VIX regime is volatility/risk context only; it is NEVER mapped directly to
//   bullish/bearish/BUY/SELL.
// - Percentile bands are descriptive/provisional, not scoring thresholds.
// ============================================================================

type V2VixRegime = "LOW" | "BELOW_NORMAL" | "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME" | "INSUFFICIENT_DATA";
type V2VixDirection = "RISING" | "FALLING" | "STABLE" | "INSUFFICIENT_DATA";

interface V2VixRegimeResult {
  generatedAt: string;
  currentVix: number | null;
  currentVixSource: "LIVE_SNAPSHOT" | "HISTORICAL_LAST_CLOSE" | "UNAVAILABLE";
  percentile90d: number | null;
  regime: V2VixRegime;
  dailyDirection: V2VixDirection;
  intradayDirection: V2VixDirection;
  dailyChangePercent: number | null;
  historyPointsUsed: number;
  median90d: number | null;
  min90d: number | null;
  max90d: number | null;
  dataQuality: V2DataQuality;
  directionalBias: "NONE";
  scoringImpact: "NONE";
  source: string;
  interpretationGuard: string;
  regimeBands: string;
}

function v2VixDirectionFromChange(change: number | null, eps = 1e-9): V2VixDirection {
  if (change == null || !Number.isFinite(change)) return "INSUFFICIENT_DATA";
  if (change > eps) return "RISING";
  if (change < -eps) return "FALLING";
  return "STABLE";
}

function v2PercentileRank(values: number[], current: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0 || !Number.isFinite(current) || current <= 0) return null;
  const lessOrEqual = clean.filter((v) => v <= current).length;
  return (lessOrEqual / clean.length) * 100;
}

function v2Median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

function v2ClassifyVixRegime(percentile: number | null): V2VixRegime {
  if (percentile == null || !Number.isFinite(percentile)) return "INSUFFICIENT_DATA";
  if (percentile < 20) return "LOW";
  if (percentile < 40) return "BELOW_NORMAL";
  if (percentile < 60) return "NORMAL";
  if (percentile < 80) return "ELEVATED";
  if (percentile < 95) return "HIGH";
  return "EXTREME";
}

function buildV2VixRegime(
  chartSeries: Array<{ date: string; niftyPct: number; bankNiftyPct: number; vix: number }>,
  session: KiteSession
): V2VixRegimeResult {
  const last90 = chartSeries.slice(-90).map((x) => x.vix).filter((v) => Number.isFinite(v) && v > 0);
  const liveNifty = session.marketSnapshot?.NIFTY;
  const historicalLast = last90.length > 0 ? last90[last90.length - 1] : null;
  const currentVix = liveNifty && Number.isFinite(liveNifty.vix) && liveNifty.vix > 0 ? liveNifty.vix : historicalLast;
  const currentVixSource: V2VixRegimeResult["currentVixSource"] =
    liveNifty && Number.isFinite(liveNifty.vix) && liveNifty.vix > 0 ? "LIVE_SNAPSHOT" : historicalLast != null ? "HISTORICAL_LAST_CLOSE" : "UNAVAILABLE";

  const percentile90d = currentVix != null ? v2PercentileRank(last90, currentVix) : null;
  const regime = v2ClassifyVixRegime(percentile90d);
  const dailyChangePercent = liveNifty && Number.isFinite(liveNifty.vixChangePercent) ? liveNifty.vixChangePercent : null;
  const dailyDirection = v2VixDirectionFromChange(dailyChangePercent);

  // Intraday direction comes only from already-collected in-memory refresh history.
  // Compare the latest two valid NIFTY VIX observations; do not fabricate a move
  // when fewer than two valid observations exist.
  const intradayVix = (session.snapshotHistory || [])
    .map((h) => h.NIFTY?.vix ?? null)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const intradayChange = intradayVix.length >= 2 ? intradayVix[intradayVix.length - 1] - intradayVix[intradayVix.length - 2] : null;
  const intradayDirection = v2VixDirectionFromChange(intradayChange);

  const min90d = last90.length > 0 ? Math.min(...last90) : null;
  const max90d = last90.length > 0 ? Math.max(...last90) : null;
  const median90d = v2Median(last90);
  const dataQuality: V2DataQuality = currentVix == null || last90.length < 20 ? "INSUFFICIENT" : currentVixSource === "LIVE_SNAPSHOT" && last90.length >= 60 ? "OK" : "PARTIAL";

  return {
    generatedAt: new Date().toISOString(),
    currentVix,
    currentVixSource,
    percentile90d,
    regime,
    dailyDirection,
    intradayDirection,
    dailyChangePercent,
    historyPointsUsed: last90.length,
    median90d,
    min90d,
    max90d,
    dataQuality,
    directionalBias: "NONE",
    scoringImpact: "NONE",
    source: "Existing /api/vix-correlation one-year Kite history + existing in-memory live snapshot/history; no additional Kite request",
    interpretationGuard: "VIX measures expected volatility/risk pricing context. Rising/falling VIX is not independently bullish, bearish, BUY, or SELL.",
    regimeBands: "PROVISIONAL descriptive percentile bands: <20 LOW, 20-<40 BELOW_NORMAL, 40-<60 NORMAL, 60-<80 ELEVATED, 80-<95 HIGH, >=95 EXTREME. Not a scoring rule.",
  };
}

// Extracts ATM\u00b1range strikes' LTP/IV/Theta/Vega/Delta/OI from an
// already-sorted ceStrikes/peStrikes array (stateless, safe to call any
// number of times \u2014 pure read, no tracker mutation).
function extractNearStrikes(strikes: PremiumData[] | undefined, range: number): { strike: number; ltp: number | null; iv: number | null; theta: number | null; vega: number | null; delta: number | null; oi: number | null }[] | null {
  if (!strikes || strikes.length === 0) return null;
  const atmIdx = strikes.findIndex((s) => s.isAtm);
  if (atmIdx === -1) return null;
  const start = Math.max(0, atmIdx - range);
  const end = Math.min(strikes.length, atmIdx + range + 1);
  return strikes.slice(start, end).map((s) => ({
    strike: s.strike, ltp: s.lastPrice > 0 ? s.lastPrice : null, iv: s.iv, theta: s.theta, vega: s.vega, delta: s.delta, oi: s.oi,
  }));
}

// Module 2 (Recorder Engine) dependency on Module 1 (Truth Engine), per
// the approved Architecture Specification: "Never records a raw
// (non-Truth-validated) field." Each raw field is only included if the
// corresponding TruthReport field verdict is TRUE ‚Äî a field the Truth
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
    vwap: futuresOk && m.vwap > 0 ? m.vwap : null,
    vwapSource: futuresOk && m.vwap > 0 ? m.vwapSource || null : null,
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
    ceStrikesNear: ceOk ? extractNearStrikes(exp?.ceStrikes, 3) : null,
    peStrikesNear: peOk ? extractNearStrikes(exp?.peStrikes, 3) : null,
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
    vwapSource: m.vwap > 0 ? m.vwapSource || null : null,
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
    ceStrikesNear: extractNearStrikes(exp?.ceStrikes, 3),
    peStrikesNear: extractNearStrikes(exp?.peStrikes, 3),
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

type V2MarketPhase = "WEEKEND" | "PREMARKET" | "OPENING_GRACE" | "LIVE_SESSION" | "POSTMARKET";

function v2MarketPhaseNow(): V2MarketPhase {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const day = ist.getDay();
  if (day === 0 || day === 6) return "WEEKEND";
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  if (minutes < 9 * 60 + 15) return "PREMARKET";
  // Give the 3-minute recorder/quote pipeline two cycles to initialize after 09:15.
  // This avoids false CRITICAL alerts during normal startup without weakening any
  // live-session freshness or candidate data-quality gate.
  if (minutes < 9 * 60 + 21) return "OPENING_GRACE";
  if (minutes <= 15 * 60 + 30) return "LIVE_SESSION";
  return "POSTMARKET";
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
      // New trading day ‚Äî start a fresh in-memory session. The previous
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

    // H1_CONTINUOUS_RECORDER_AUTHORITY_FALLBACK_V1:
    // the scheduled recorder must not depend on an open dashboard/browser session.
    // Reuse the encrypted shared Kite authority already maintained by Phase 62.
    // This creates an ephemeral read-only market-data session object only; it is NOT
    // inserted into the browser session map and grants no order/execution authority.
    if (!activeSession) {
      const authority = phase62RestoredKiteAuthority ?? (await resolveKiteAuthoritySession()).session;
      if (authority && authority.expiresAt > Date.now()) {
        phase62RestoredKiteAuthority = authority;
        activeSession = {
          accessToken: authority.accessToken,
          userId: authority.userId,
          email: authority.email ?? "",
          loginTime: authority.loginTime,
          expiresAt: authority.expiresAt,
        };
      }
    }

    if (!activeSession) {
      recorderSession.status = "DEGRADED";
      recorderSession.lastErrorRedacted = "No active or persisted Kite authority session available";
      void dbInsert("H1_RECORDER_AUTHORITY_BLOCKED", {
        tradingDate: today,
        observedAt: new Date().toISOString(),
        reason: "KITE_AUTHORITY_UNAVAILABLE",
      }).catch(() => {});
      return;
    }

    const snapshot = await refreshMarketSnapshot(activeSession);

    // V2 Module 8: capture tiny cross-expiry OI summaries from this already-fetched
    // 3-minute market snapshot. No extra broker request and no Recorder schema change.
    const rolloverTimestamp = new Date().toISOString();
    captureV2RolloverSummary("NIFTY", snapshot.NIFTY, rolloverTimestamp);
    captureV2RolloverSummary("BANKNIFTY", snapshot.BANKNIFTY, rolloverTimestamp);
    captureV2RolloverSummary("SENSEX", snapshot.SENSEX, rolloverTimestamp);

    // K2 (2026-08-21, FULL_MIGRATION_TO_KITE_ONLY) ‚Äî Recorder Truth-check and
    // storage for NIFTY/BANKNIFTY switched BACK to Kite, matching SENSEX
    // (which was never migrated off Kite in the first place -- see the K1
    // audit). No new fetch: `snapshot.*` below is the SAME Kite
    // refreshMarketSnapshot() result already pulled a few lines above for
    // this exact cycle -- previously fetched and then discarded for
    // NIFTY/BANKNIFTY in favor of dhanRecorderSourceMetrics(); now used
    // directly, symmetric with the SENSEX line right below it. This also
    // fixes M2 (IV skew) for NIFTY/BANKNIFTY as a side effect, since M2
    // reads recorderSession.snapshots -- see the K1 audit's note on that.
    // dhanRecorderSourceMetrics() itself is left in place, untouched, per
    // the standing "do not remove Dhan code until proven independent" rule
    // -- it is simply no longer called from this cycle.
    const niftyMetricsForTruth = snapshot.NIFTY;
    const bankMetricsForTruth = snapshot.BANKNIFTY;

    // Module 1 dependency: classify each index through the Truth Engine
    // BEFORE building the recorded snapshot, per the approved spec.
    const niftyTruth = computeTruthReport(niftyMetricsForTruth);
    const bankTruth = computeTruthReport(bankMetricsForTruth);
    const sensexTruth = computeTruthReport(snapshot.SENSEX);

    // H1_TRUTH_BY_SYMBOL_V1 / H1_RUNTIME_PATCH_V2: research-only, fail-open side-channel.
    // Reuse the exact TruthReport objects already computed by the existing recorder cycle.
    const h1TruthBySymbol = { NIFTY: niftyTruth, BANKNIFTY: bankTruth, SENSEX: sensexTruth };
    void (() => {
      // H1_SELECTOR_REGISTRY_WIRING_V1: consume only fresh LIVE_RUNTIME_EXACT selector evidence.
      const h1Selector = collectH1LiveSelectorDecisions(new Date().toISOString());
      const h1CandidateDecisions = h1Selector.eligibleForLiveH1Marking ? h1Selector.decisions : undefined;
      return recordH1FromRuntimeSnapshot(snapshot, h1TruthBySymbol, undefined, h1CandidateDecisions);
    })().catch((err) =>
      console.error("[H1] recorder bridge failed (live path unaffected):", err instanceof Error ? err.message : err),
    );

    const niftySnap = toTruthValidatedRecorderIndexSnapshot(niftyMetricsForTruth, niftyTruth);
    const bankSnap = toTruthValidatedRecorderIndexSnapshot(bankMetricsForTruth, bankTruth);
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
    // 2026-08-20 (Week 1, PostgreSQL persistence): fire-and-forget DB write.
    // Deliberately NOT awaited -- this snapshot is already live in memory
    // and every downstream consumer this cycle (Journal, Telegram alerts)
    // must not wait on a DB round-trip. dbInsert() itself never throws (see
    // db.ts), so a rejected promise here is impossible, but .catch() is
    // kept anyway as defense-in-depth against a future change to that
    // contract.
    void dbInsert("recorder_snapshot", entry).catch(() => {});

    // Module 11 (Event Bus): additive publish, existing behavior above is unchanged.
    publishEvent("SnapshotRecorded", { snapshotId: entry.snapshotId, snapshotStatus: entry.snapshotStatus }, "Recorder Engine");
    publishEvent("TruthValidated", { NIFTY: niftyTruth.overallVerdict, BANKNIFTY: bankTruth.overallVerdict, SENSEX: sensexTruth.overallVerdict }, "Truth Engine");

    appendJournalEntry();

    // H7/H8 shadow research pipeline: runs from the already-refreshed snapshot only.
    // Fire-and-forget so a research/outcome bookkeeping fault can never block the
    // primary Recorder cycle. No order execution, no AI call, no Rule Engine feed.
    void captureV2ShadowCycle(activeSession, entry).catch((err) =>
      console.error("[V2 Shadow] capture cycle error:", err instanceof Error ? err.message : err)
    );

    // Telegram alerts (Phase 1, 2026-08-16): fire-and-forget, reuses the
    // SAME activeSession.marketSnapshot just refreshed above ‚Äî no extra
    // Kite/Dhan API call. A failure here can never block the Recorder cycle.
    void runTelegramAlertCycle(activeSession).catch((err) =>
      console.error("[Telegram] alert cycle error:", err instanceof Error ? err.message : err)
    );
  } catch (err) {
    recorderSession.status = "DEGRADED";
    recorderSession.lastErrorRedacted = err instanceof Error ? err.message : "Unknown recorder error";
    console.error("[Recorder] snapshot capture failed:", recorderSession.lastErrorRedacted);
  }
}

// ============== DAILY JOURNAL (rolling 3M/15M/30M interpretation) ==============
// Derives verdicts from the recorder's own stored snapshots ‚Äî no live
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
  const dataHealth = latest.snapshotStatus === "LIVE" ? "HEALTHY" : latest.snapshotStatus === "PARTIAL" ? "PARTIAL ‚Äî SOME FIELDS MISSING" : latest.snapshotStatus === "STALE" ? "STALE" : "INVALID";
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
  // 2026-08-20 (Week 1, PostgreSQL persistence): see the matching comment
  // on the Recorder snapshot write above -- same fire-and-forget contract.
  void dbInsert("journal_entry", entry).catch(() => {});
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
  wallPersistenceScore: null; // genuinely not computable ‚Äî the Recorder (Module 2) does not capture Call/Put Wall state (Step 6B lives only in the browser session), so this is honestly null, never fabricated
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

const DNA_MIN_SNAPSHOTS = 3; // PROVISIONAL ‚Äî below this, no signature is computed at all

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
  // spec ‚Äî BANKNIFTY genuinely has no verdict-flip source available.
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

// ============== TELEGRAM ALERTS (Phase 1, 2026-08-16) ==============
// Fire-and-forget notifications piggybacked on the existing 3-min Recorder
// cycle (captureRecorderSnapshot) ‚Äî reads the SAME already-refreshed
// activeSession.marketSnapshot, so this adds ZERO extra Kite/Dhan API
// calls. Sends only on state CHANGE (fingerprint-based dedup), never on
// every 3-min tick, to avoid notification spam. M12 (BEST_CE/BEST_PE) is
// an explicitly UNVALIDATED research construct (see H5 isolation guard on
// buildV2CandidateSelection) ‚Äî its alert is labeled accordingly and is
// never phrased as a trade instruction.
const TELEGRAM_LAST_REGIME: Map<string, string> = new Map();
const TELEGRAM_LAST_M11_FINGERPRINT: Map<string, string> = new Map();
const TELEGRAM_LAST_M12_FINGERPRINT: Map<string, string> = new Map();

const TELEGRAM_LAST_BUY_FINGERPRINT: Map<string, string> = new Map();
const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();

// Previous cycle's futures LTP + OI per symbol, used ONLY to classify
// Long Buildup / Short Buildup / Short Covering / Long Unwinding for the
// M12b buy-signal enrichment below. Uses the SAME futuresContracts[0]
// (Near-month future) already present in every IndexMetrics snapshot --
// no new Kite request. Cleared daily so day 1's "previous" never leaks
// into day 2's first classification.
const TELEGRAM_PREV_FUTURES_OI: Map<string, { ltp: number; oi: number }> = new Map();

// ============== TELEGRAM MARKET SNAPSHOT (2026-08-18, user-requested) ==============
// A dual-cadence market digest, separate from the M10-M12b state-change
// alerts above. Two speeds, matching what actually changes at each speed:
//   - FAST (every 1 min, market hours only): full-chain PCR, ATM CE/PE
//     premium price, ATM CE/PE OI -- these genuinely move minute to minute.
//     Needs a real extra Kite fetch (fetchOptionChainStats on the current
//     week's expiry only) -- this is real added API load, not free.
//   - SLOW (every 3 min, piggybacked on the existing Recorder cycle like
//     M10-M12b -- zero extra API cost): Call/Put wall (OI leadership
//     doesn't flip meaningfully faster than 3 min), the all-weekly-expiry
//     PDH/PDL + intrinsic/extrinsic table (PDH/PDL are previous-day values,
//     they never move intraday; extrinsic only needs the LTP already in
//     the 3-min snapshot), the 5-stock/sector watchlist, and spot alignment.
// The fast message re-renders every minute using the LATEST fast numbers
// merged with whatever the slow cache last held -- so wall/expiry-table/
// stocks visibly stay identical across 3 consecutive fast messages, exactly
// matching the requested "wall changes every 3 min" behavior.

interface TelegramSlowCache {
  m: IndexMetrics;
  stocks: Array<{ name: string; changePct: number | null }>;
  updatedAt: number;
}
const TELEGRAM_SLOW_CACHE: Map<string, TelegramSlowCache> = new Map();
// 2026-08-18: latest fast-cycle (1-min) OptionChainStats per symbol, kept
// around so the 15/30/60-min periodic summary can read fullChainPcr/oiPcr
// without a second fetch -- zero extra Kite cost.
const TELEGRAM_LATEST_FAST: Map<string, OptionChainStats> = new Map();

// NIFTY/SENSEX use the exact 5 names requested. BANKNIFTY reuses the
// existing bank-focused constituent set from INDEX_KEY_STOCKS (Reliance
// and Nifty IT aren't relevant to a bank index) -- defined locally here
// (not by referencing INDEX_KEY_STOCKS, which is declared much later in
// this file) to avoid a temporal-dead-zone issue at module load time.
const TELEGRAM_STOCK_WATCHLIST: Record<string, Record<string, string>> = {
  NIFTY: { "Reliance": "NSE:RELIANCE", "HDFC Bank": "NSE:HDFCBANK", "ICICI Bank": "NSE:ICICIBANK", "Nifty PSU Bank": "NSE:NIFTY PSU BANK", "Nifty IT": "NSE:NIFTY IT" },
  SENSEX: { "Reliance": "NSE:RELIANCE", "HDFC Bank": "NSE:HDFCBANK", "ICICI Bank": "NSE:ICICIBANK", "Nifty PSU Bank": "NSE:NIFTY PSU BANK", "Nifty IT": "NSE:NIFTY IT" },
  BANKNIFTY: { "HDFC Bank": "NSE:HDFCBANK", "ICICI Bank": "NSE:ICICIBANK", "SBI": "NSE:SBIN", "Axis Bank": "NSE:AXISBANK", "Kotak Mahindra Bank": "NSE:KOTAKBANK" },
};

async function fetchTelegramStockWatchlist(accessToken: string, symbol: string): Promise<Array<{ name: string; changePct: number | null }>> {
  const map = TELEGRAM_STOCK_WATCHLIST[symbol];
  if (!map) return [];
  try {
    const kiteSymbols = Object.values(map);
    const quotes = await fetchKiteQuote(accessToken, kiteSymbols);
    if (!quotes) return Object.keys(map).map((name) => ({ name, changePct: null }));
    return Object.entries(map).map(([name, kiteSymbol]) => {
      const q = quotes[kiteSymbol];
      const changePct = q && q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100 : null;
      return { name, changePct };
    });
  } catch (err) {
    console.error(`[Telegram] Stock watchlist fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return Object.keys(map).map((name) => ({ name, changePct: null }));
  }
}

// Formats a Date/ISO-string/Date-like as "04 SEP" -- used to show each
// weekly expiry's real date in the chronological all-expiry table
// (server-side counterpart to the dashboard's formatExpiryDate, since that
// one is client-side JS embedded in the HTML template).
function telegramFormatExpiryDate(d: unknown): string {
  if (!d) return "-";
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return "-";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return String(date.getDate()).padStart(2, "0") + " " + months[date.getMonth()];
}

function telegramArrow(dir: "up" | "down" | "flat"): string {
  return dir === "up" ? "‚ñ≤" : dir === "down" ? "‚ñº" : "‚óè";
}

// Compact "7.45L" style OI formatting for the monospace comparison table
// (2026-08-18) -- keeps every OI cell the same rough width regardless of
// magnitude, unlike toLocaleString("en-IN") ("7,45,200" vs "13,89,000" are
// very different lengths and would misalign a fixed-width table).
function telegramFormatLakhs(n: number): string {
  return (n / 100000).toFixed(2) + "L";
}

// Right-pads a string to a fixed width for <pre> table alignment. Telegram
// renders <pre> in a monospace font, so plain space-padding lines up
// correctly as long as every cell in a column uses ASCII (no emoji -- see
// telegramDotTable above for why arrows, not emoji, are used inside tables).
function telegramPad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function telegramPctColor(pct: number | null): string {
  if (pct == null) return "‚ö™"; // white circle = unavailable
  return pct >= 0 ? "üü¢" : "üî¥"; // green/red circle -- Telegram HTML has no text-color support
}

// Generic per-value increase/decrease dot (2026-08-18, CE/PE side rebuild):
// EVERY field in the CE-side/PE-side blocks below (PDH, PDL, Day High, Day
// Low, Intrinsic, Extrinsic, OI) gets its own independent tracker under this
// ONE shared map, keyed by a fully-qualified string so no two fields ever
// collide (e.g. "NIFTY_CE_04SEP_pdh"). First-ever reading has no prior
// value to compare against, so it shows white (unavailable), not green --
// showing green on the very first tick would be a false "increase" signal.
const TELEGRAM_DOT_LAST_VALUE: Map<string, number> = new Map();
function telegramDotDir(key: string, current: number): "up" | "down" | "flat" {
  const prev = TELEGRAM_DOT_LAST_VALUE.get(key);
  TELEGRAM_DOT_LAST_VALUE.set(key, current);
  if (prev == null) return "flat"; // first reading -- no false "increase" signal
  if (current > prev) return "up";
  if (current < prev) return "down";
  return "flat";
}

function telegramDot(key: string, current: number): string {
  const dir = telegramDotDir(key, current);
  return dir === "up" ? "üü¢" : dir === "down" ? "üî¥" : "‚ö™";
}

// Table-cell variant (2026-08-18, table rebuild): emoji are double-width in
// some Telegram clients and break monospace <pre> column alignment -- the
// arrow glyphs (‚ñ≤‚ñº‚óè, already used for Full-Chain PCR/premium elsewhere in
// this message) render single-width and stay aligned in a fixed-width block.
function telegramDotTable(key: string, current: number): string {
  return telegramArrow(telegramDotDir(key, current));
}

// Mirrors the dashboard's classifyIndexOverallBias (client-side JS) exactly,
// using the same m.signal + m.gapScore.score inputs, both already available
// server-side -- this is the "Spot Alignment" closing line.
function telegramSpotAlignment(m: IndexMetrics): string {
  if (!m || m.error) return "DATA UNAVAILABLE";
  const gs = m.gapScore;
  const score = gs ? gs.score : 0;
  if (m.signal === "BUY" && score > 50) return "STRONG CE BIAS";
  if (m.signal === "BUY") return "MILD CE BIAS";
  if (m.signal === "SELL" && score < -50) return "STRONG PE BIAS";
  if (m.signal === "SELL") return "MILD PE BIAS";
  if (gs && Math.abs(score) < 10) return "SIDEWAYS / RANGE";
  return "WAIT - CONFLICTING DATA";
}

// Fast-cycle change trackers (1-min cadence, separate key space from the
// M10-M12b Maps above so neither system's dedup logic can interfere with
// the other's).
// ATM CE/PE OI trackers were removed here 2026-08-18 -- superseded by the
// per-expiry OI dot in the CE-side/PE-side blocks below (telegramDot),
// which covers OI for every fetched expiry, not just the fast 1-min ATM
// value. fast.atmCeOi/atmPeOi are still fetched (zero marginal Kite cost,
// same batch as fullChainPcr) but no longer separately displayed.
const TELEGRAM_FAST_LAST_FULLCHAIN_PCR: Map<string, number> = new Map();
// Added 2026-08-18 for the all-3-index PCR info box: OI PCR (ATM ¬±7 band)
// direction, tracked separately from full-chain PCR above.
const TELEGRAM_FAST_LAST_OI_PCR: Map<string, number> = new Map();
// Added 2026-08-18 for the Intrinsic/Extrinsic ¬±3 table: Extrinsic value
// % change per strike per side, keyed by "SYMBOL_ie3_CE/PE_extr_STRIKE".
// (The old single-ATM ATM_CE_LTP/ATM_PE_LTP trackers were removed -- the
// ATM row of this table now covers what those used to show.)
const TELEGRAM_FAST_LAST_IE3: Map<string, number> = new Map();

// 2026-08-19: state for the new "PDL Broken + O‚âàH" / "Opposite-Premium
// Higher-High Caution" pair, per user request. Keyed by
// "SYMBOL_EXPIRYLABEL_CE/PE" (e.g. "NIFTY_Current Expiry_PE"). Stores the
// dayHigh value seen as of the LAST Telegram message build for that leg, so
// the next build can tell whether a fresh high was made since then. This is
// a genuine tick-over-tick comparison of real Kite ohlc.high values, but its
// resolution is bounded by how often the underlying data actually refreshes
// (TELEGRAM_SLOW_CACHE, ~3-min normally / 1-min during adaptive-fast
// windows) -- NOT a literal continuous 1-second feed. Documented here and
// disclosed to the user rather than oversold as tick-precise.
const TELEGRAM_PREV_DAY_HIGH: Map<string, number> = new Map();

function telegramTrackDirection(key: string, current: number, lastMap: Map<string, number>): "up" | "down" | "flat" {
  const prev = lastMap.get(key);
  lastMap.set(key, current);
  if (prev == null || current === prev) return "flat";
  return current > prev ? "up" : "down";
}

// Combined direction + % change in ONE read-then-write pass (a single
// bug-prone mistake to avoid: computing direction and % change as two
// SEPARATE calls against the same map double-consumes the "previous value"
// read, since the first call's set() would make the second call's get()
// see the value that was just written instead of the real prior one).
function telegramTrackWithPct(key: string, current: number, lastMap: Map<string, number>): { dir: "up" | "down" | "flat"; pctChange: number | null } {
  const prev = lastMap.get(key);
  lastMap.set(key, current);
  if (prev == null) return { dir: "flat", pctChange: null };
  const dir: "up" | "down" | "flat" = current === prev ? "flat" : current > prev ? "up" : "down";
  const pctChange = prev !== 0 ? ((current - prev) / prev) * 100 : null;
  return { dir, pctChange };
}

// The FAST fetch itself: current-week expiry only, real Kite call (see
// module comment above -- this is genuine added load, once per symbol
// per minute). Reuses the cached instrument master (fetchInstruments has
// its own TTL cache) so this does NOT re-download the full instrument
// list every minute -- only the option-chain quote batch is fresh.
async function fetchTelegramFastPcrSnapshot(accessToken: string, symbol: string): Promise<OptionChainStats | null> {
  try {
    const instruments = await fetchInstruments(accessToken);
    const availableExpiries = getExpiryDatesFromInstruments(instruments, symbol);
    const currentWeekExpiry = availableExpiries[0] || null;
    if (!currentWeekExpiry) return null;
    const optionMap = buildOptionMap(instruments, symbol, currentWeekExpiry);
    const cachedM = TELEGRAM_SLOW_CACHE.get(symbol)?.m;
    const atmStrike = cachedM?.atmStrike;
    if (!atmStrike) return null;
    const strikeStep = STRIKE_STEP[symbol as keyof typeof STRIKE_STEP] || 100;
    return await fetchOptionChainStats(
      accessToken,
      optionMap,
      atmStrike,
      strikeStep,
      EXCHANGE_CODES[symbol as keyof typeof EXCHANGE_CODES],
      7
    );
  } catch (err) {
    console.error(`[Telegram Fast] PCR snapshot fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Builds the full message text from FAST numbers (just fetched) merged
// with whatever the SLOW cache last held (wall, all-expiry table, stocks,
// spot alignment) -- so those sections repeat unchanged across up to 3
// consecutive fast messages, by design.
function buildTelegramMarketSnapshotMessage(symbol: string, fast: OptionChainStats, allFast: Map<string, OptionChainStats>): string | null {
  const slow = TELEGRAM_SLOW_CACHE.get(symbol);
  if (!slow) return null;
  const m = slow.m;
  const istTime = () => new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

  // 2026-08-19: EOD summary event recorder (feature ‚ë£), per user request.
  // Records a plain-text log line for later Haiku summarization at market
  // close -- purely additive bookkeeping, never affects the message text
  // built below.
  const recordDailyEvent = (text: string) => {
    if (!TELEGRAM_DAILY_EVENTS.has(symbol)) TELEGRAM_DAILY_EVENTS.set(symbol, []);
    TELEGRAM_DAILY_EVENTS.get(symbol)!.push({ time: istTime(), text });
  };

  const lines: string[] = [];
  lines.push(`üîî <b>${symbol} MARKET SNAPSHOT</b>`);
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");

  // 1. PCR info box (2026-08-18 follow-up): all 3 indices' Full-Chain PCR +
  // OI PCR (ATM ¬±7 band) shown together, in EVERY message (NIFTY's message
  // shows the same box as BANKNIFTY's and SENSEX's) -- not just this
  // message's own symbol. Zero extra Kite cost: runTelegramFastCycle now
  // fetches all 3 symbols before building any message and passes the full
  // set in via `allFast`. Plus India VIX with its daily % change, read
  // from the existing slow-cache snapshot (also zero extra cost).
  lines.push(`üì¶ <b>PCR INFO BOX</b>`);
  const pcrSymbols: string[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  // 2026-08-19: captured for the new Confluence Note below -- this symbol's
  // own Full-Chain PCR direction, read straight from the box being built
  // right here (not recomputed).
  // Typed as plain `string` (not the "up"|"down"|"flat" union) deliberately:
  // TS's control-flow narrowing can't see the reassignment inside the
  // forEach closure below, and would otherwise keep treating this as the
  // literal "flat" for every later comparison, breaking the down/up checks.
  let thisSymbolPcrDir: string = "flat";
  pcrSymbols.forEach((sym) => {
    const f = allFast.get(sym);
    const nameCell = telegramPad(sym, 10);
    if (!f) {
      lines.push(`${nameCell}| DATA UNAVAILABLE`);
      return;
    }
    const fcDir = f.fullChainPcr != null ? telegramTrackDirection(sym + "_fc_pcr", f.fullChainPcr, TELEGRAM_FAST_LAST_FULLCHAIN_PCR) : "flat";
    if (sym === symbol) thisSymbolPcrDir = fcDir;
    const oiDir = f.oiPcr != null ? telegramTrackDirection(sym + "_oi_pcr", f.oiPcr, TELEGRAM_FAST_LAST_OI_PCR) : "flat";
    const fcText = f.fullChainPcr != null ? f.fullChainPcr.toFixed(3) : "-";
    const oiText = f.oiPcr != null ? f.oiPcr.toFixed(3) : "-";
    // 2026-08-19: Max Pain added to the PCR box, per user request. `f.maxPain`
    // is already computed inside fetchOptionChainStats() (the SAME call that
    // produces fullChainPcr/oiPcr above) -- zero extra Kite cost. The function
    // returns 0 (not null) when unavailable, an existing convention in this
    // codebase (see fetchOptionChainStats' early-return defaults), so 0 is
    // treated as "no data" here rather than a literal strike of 0.
    const maxPainText = f.maxPain > 0 ? String(f.maxPain) : "-";
    lines.push(`${nameCell}| Full ${fcText}${telegramArrow(fcDir)} | OI(¬±7) ${oiText}${telegramArrow(oiDir)} | Max Pain ${maxPainText}`);
  });
  if (m.vix != null) {
    const vixChangePct = m.vixChangePercent ?? null;
    const vixDir = vixChangePct != null && vixChangePct > 0 ? "up" : vixChangePct != null && vixChangePct < 0 ? "down" : "flat";
    const vixPctText = vixChangePct != null ? `${vixChangePct >= 0 ? "+" : ""}${vixChangePct.toFixed(2)}%` : "n/a";
    // 2026-08-19: elevated-VIX context note, per user request. Threshold
    // (15) is a commonly cited India VIX "elevated" watermark, not derived
    // from this codebase -- documented here so it's easy to tune later.
    const vixNote = m.vix >= 15 ? " ‚Äî Elevated VIX: wider swings, premiums costlier" : "";
    lines.push(`India VIX: ${m.vix.toFixed(2)} ${telegramArrow(vixDir)} (${vixPctText})${vixNote}`);
  }
  // 2026-08-19: expiry-day flag, per user request. Compares the Current
  // Expiry's actual expiryDate (real Kite instrument expiry, from the first
  // available ATM leg) against today's IST calendar date -- not a guess or
  // day-of-week heuristic.
  {
    const currentExp = (m.expiries || []).find((e) => e.expiry === "Current Expiry");
    const anyLeg = currentExp ? ((currentExp.ceStrikes || [])[0] || (currentExp.peStrikes || [])[0]) : null;
    if (anyLeg && anyLeg.expiryDate) {
      const todayIst = indiaTradingDate();
      if (anyLeg.expiryDate === todayIst) {
        lines.push(`üìÖ Expiry Day (${telegramFormatExpiryDate(anyLeg.expiryDate)}) ‚Äî theta decay accelerated`);
      }
    }
  }
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");

  // 2. Wall line -- kept from before (current expiry's max-OI strikes).
  const exp = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  let maxCallOiStrike: number | null = null, maxCallOi = -1;
  let maxPutOiStrike: number | null = null, maxPutOi = -1;
  if (exp) {
    (exp.ceStrikes || []).forEach((s) => { if (s.oi != null && s.oi > maxCallOi) { maxCallOi = s.oi; maxCallOiStrike = s.strike; } });
    (exp.peStrikes || []).forEach((s) => { if (s.oi != null && s.oi > maxPutOi) { maxPutOi = s.oi; maxPutOiStrike = s.strike; } });
  }
  lines.push(
    `üß± Call Wall <b>${maxCallOiStrike ?? "-"}</b> (OI ${maxCallOi >= 0 ? telegramFormatLakhs(maxCallOi) : "-"}) ` +
    `| Put Wall <b>${maxPutOiStrike ?? "-"}</b> (OI ${maxPutOi >= 0 ? telegramFormatLakhs(maxPutOi) : "-"})`
  );

  // 3. Intrinsic/Extrinsic table -- ATM ¬±3 strikes, CURRENT expiry only
  // (2026-08-18 follow-up: narrowed from "all expiry" to just this band,
  // as a real strike ladder table rather than one row per expiry). Reuses
  // `fast.bandStrikes` (already fetched ATM ¬±7 for OI PCR) -- zero extra
  // Kite cost, just filtered down to ¬±3. Each cell shows Intrinsic/
  // Extrinsic together (per the earlier "stay together" request) plus a
  // % change on the Extrinsic leg (the volatile part -- Intrinsic's %
  // change is often undefined/meaningless when it's 0).
  const atmStrike = m.atmStrike;
  const strikeStep = STRIKE_STEP[symbol as keyof typeof STRIKE_STEP] || 100;
  const ieBand = (fast.bandStrikes || []).filter((b) => Math.abs(b.strike - atmStrike) <= strikeStep * 3);
  lines.push(`<b>Intrinsic/Extrinsic (ATM ¬±3, Current Expiry)</b>`);
  let ieTable = "Strike | CE Intr/Ext          | PE Intr/Ext\n";
  let atmCeExtrDir: "up" | "down" | "flat" | null = null;
  let atmPeExtrDir: "up" | "down" | "flat" | null = null;
  ieBand.forEach((b) => {
    const isAtm = b.strike === atmStrike;
    const ceIntr = Math.max(0, m.current - b.strike);
    const peIntr = Math.max(0, b.strike - m.current);
    const ceIntrArrow = telegramDotTable(symbol + "_ie3_CE_intr_" + b.strike, ceIntr);
    const peIntrArrow = telegramDotTable(symbol + "_ie3_PE_intr_" + b.strike, peIntr);
    let ceCell = "-".padEnd(21);
    if (b.ceLtp != null) {
      const ceExtr = Math.max(0, b.ceLtp - ceIntr);
      const { dir, pctChange } = telegramTrackWithPct(symbol + "_ie3_CE_extr_" + b.strike, ceExtr, TELEGRAM_FAST_LAST_IE3);
      if (isAtm) atmCeExtrDir = dir;
      const pctText = pctChange != null ? `(${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}%)` : "(--)";
      ceCell = telegramPad(`${ceIntr.toFixed(1)}${ceIntrArrow}/${ceExtr.toFixed(1)}${telegramArrow(dir)} ${pctText}`, 21);
    }
    let peCell = "-".padEnd(21);
    if (b.peLtp != null) {
      const peExtr = Math.max(0, b.peLtp - peIntr);
      const { dir, pctChange } = telegramTrackWithPct(symbol + "_ie3_PE_extr_" + b.strike, peExtr, TELEGRAM_FAST_LAST_IE3);
      if (isAtm) atmPeExtrDir = dir;
      const pctText = pctChange != null ? `(${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}%)` : "(--)";
      peCell = telegramPad(`${peIntr.toFixed(1)}${peIntrArrow}/${peExtr.toFixed(1)}${telegramArrow(dir)} ${pctText}`, 21);
    }
    // 2026-08-19 bug fix (found during a fresh limitations review, not
    // user-reported): this line is inside a <pre> block sent with
    // parse_mode "HTML". A literal "<" character ANYWHERE in the text --
    // even inside <pre> -- is parsed by Telegram as the start of an HTML
    // tag, not literal text. "<- ATM" is not a recognized tag, so Telegram
    // would reject the whole sendMessage call with 400 "can't parse
    // entities". Worse, sendTelegramAlert() below doesn't check
    // response.ok, so that failure would be completely silent -- the
    // Intrinsic/Extrinsic table just never arrives, with no error logged
    // anywhere. Fixed by using the Unicode left-arrow (‚Üê) instead of the
    // literal "<-" ASCII marker -- same visual meaning, no "<" character.
    ieTable += `${telegramPad(String(b.strike), 7)}| ${ceCell}| ${peCell}${isAtm ? "  ‚Üê ATM" : ""}\n`;
  });
  lines.push(`<pre>${ieTable.trimEnd()}</pre>`);
  // 2026-08-18 follow-up: single verdict line at the end -- compares the
  // ATM CE vs ATM PE extrinsic direction (the volatile leg) to call a
  // skew. CE falling + PE rising = bearish skew (puts gaining relative
  // premium); CE rising + PE falling = bullish skew; anything else is
  // read as neutral/mixed (both sides moving the same way tells us less).
  if (atmCeExtrDir && atmPeExtrDir) {
    let skew = "neutral/mixed";
    if (atmCeExtrDir === "down" && atmPeExtrDir === "up") skew = "bearish skew";
    else if (atmCeExtrDir === "up" && atmPeExtrDir === "down") skew = "bullish skew";
    lines.push(`Verdict: CE extrinsic ${atmCeExtrDir === "flat" ? "flat" : atmCeExtrDir} at ATM, PE extrinsic ${atmPeExtrDir === "flat" ? "flat" : atmPeExtrDir} ‚Äî <b>${skew}</b>`);
  }

  // 4. OI Ladder -- 2026-08-18 follow-up: rebuilt as a ROW-form table
  // (Strike/CE-OI/PE-OI each their own horizontal row, not one row per
  // strike) with a verdict line under CE and another under PE. Narrowed
  // from ATM ¬±7 to ATM ¬±3 (reusing the same `ieBand` filter as Intr/Ext
  // above) specifically because row-form puts every strike on one line --
  // at ¬±7 (15 strikes) that line would run 100+ characters and wrap badly
  // on a phone; at ¬±3 (7 strikes) it stays readable. Same `bandStrikes`
  // data, zero extra Kite cost either way.
  lines.push(`<b>OI Ladder (ATM ¬±3, Current Expiry)</b>`);
  const oiCellW = 8;
  const strikeRow = "Strike : " + ieBand.map((b) => telegramPad(String(b.strike), oiCellW)).join("");
  const ceRow = "CE-OI  : " + ieBand.map((b) => b.ceOi != null ? telegramPad(telegramFormatLakhs(b.ceOi) + telegramDotTable(symbol + "_oiladder_CE_" + b.strike, b.ceOi), oiCellW) : telegramPad("-", oiCellW)).join("");
  const peRow = "PE-OI  : " + ieBand.map((b) => b.peOi != null ? telegramPad(telegramFormatLakhs(b.peOi) + telegramDotTable(symbol + "_oiladder_PE_" + b.strike, b.peOi), oiCellW) : telegramPad("-", oiCellW)).join("");
  lines.push(`<pre>${strikeRow}\n${ceRow}\n${peRow}</pre>`);

  // Verdict (CE): the highest CE-OI strike WITHIN this ¬±3 band is read as
  // near-term resistance; verdict (PE): highest PE-OI strike as near-term
  // support. (These can differ from the full-chain Call/Put Wall shown
  // above, which scans every strike, not just this ¬±3 band.)
  let bandMaxCeStrike: number | null = null, bandMaxCeOi = -1;
  let bandMaxPeStrike: number | null = null, bandMaxPeOi = -1;
  ieBand.forEach((b) => {
    if (b.ceOi != null && b.ceOi > bandMaxCeOi) { bandMaxCeOi = b.ceOi; bandMaxCeStrike = b.strike; }
    if (b.peOi != null && b.peOi > bandMaxPeOi) { bandMaxPeOi = b.peOi; bandMaxPeStrike = b.strike; }
  });
  if (bandMaxCeStrike != null) {
    const side = bandMaxCeStrike >= m.current ? "above" : "below";
    lines.push(`Verdict (CE): OI highest at ${bandMaxCeStrike} (${telegramFormatLakhs(bandMaxCeOi)}) ‚Äî resistance building ${side} spot`);
  }
  if (bandMaxPeStrike != null) {
    const side = bandMaxPeStrike <= m.current ? "below" : "above";
    lines.push(`Verdict (PE): OI highest at ${bandMaxPeStrike} (${telegramFormatLakhs(bandMaxPeOi)}) ‚Äî support easing ${side} spot`);
  }

  // 5. DH/DL table -- kept unchanged, all 4 expiries (Current, Next, Next
  // of Next, Monthly). PDH/PDL/DH/DL never fit in one 8-column table
  // (measured ~65 chars, too wide for phones), so DH/DL stays its own
  // narrow 4-column table here.
  const expiryRows = (m.expiries || [])
    .map((e) => ({
      e,
      dateLabel: telegramFormatExpiryDate(e.expiryDate),
      atmCe: (e.ceStrikes || []).find((s) => s.isAtm),
      atmPe: (e.peStrikes || []).find((s) => s.isAtm),
    }))
    .filter((r) => r.atmCe || r.atmPe);

  lines.push(`<b>DH/DL (intraday, all expiries)</b>`);
  let table2 = "Exp     | CE-DH  CE-DL  | PE-DH  PE-DL\n";
  expiryRows.forEach(({ e, dateLabel, atmCe, atmPe }) => {
    const kCe = symbol + "_CE_" + e.expiry;
    const kPe = symbol + "_PE_" + e.expiry;
    const cell = (v: number, key: string) => telegramPad(v.toFixed(1) + telegramDotTable(key, v), 7);
    const ceCells = atmCe ? `${cell(atmCe.dayHigh, kCe + "_dh")}${cell(atmCe.dayLow, kCe + "_dl")}` : telegramPad("-", 14);
    const peCells = atmPe ? `${cell(atmPe.dayHigh, kPe + "_dh")}${cell(atmPe.dayLow, kPe + "_dl")}` : telegramPad("-", 14);
    table2 += `${telegramPad(dateLabel, 8)}| ${ceCells}| ${peCells}\n`;
  });
  lines.push(`<pre>${table2.trimEnd()}</pre>`);

  // 2026-08-18 follow-up: reference lines under the DH/DL table -- just
  // the CE-side strike list (labelled "at DH") and the PE-side strike
  // list (labelled "at DL"), 2 lines only per the user's confirmed choice
  // (not a full 4-line CE/PE x DH/DL breakdown).
  const ceDhList = expiryRows.filter((r) => r.atmCe).map((r) => `${r.dateLabel}-${r.atmCe!.strike}`).join(", ");
  const peDlList = expiryRows.filter((r) => r.atmPe).map((r) => `${r.dateLabel}-${r.atmPe!.strike}`).join(", ");
  lines.push(`CE strikes: ${ceDhList || "-"} at DH`);
  lines.push(`PE strikes: ${peDlList || "-"} at DL`);

  // 2026-08-18 follow-up: PDH/PDL rebuilt as its own table, same layout as
  // the DH/DL table above (rather than plain reference lines), with the
  // same 2-line "CE strikes ... at PDH / PE strikes ... at PDL" reference
  // pattern below it -- mirroring the DH/DL table + reference-line design
  // exactly, per the user's explicit request. Kept as a SEPARATE table
  // from DH/DL (not merged into one 8-column table) since that combined
  // width was already measured at ~65 chars and rejected once before.
  lines.push(`<b>PDH/PDL (all expiries)</b>`);
  let table3 = "Exp     | CE-PDH CE-PDL | PE-PDH PE-PDL\n";
  expiryRows.forEach(({ e, dateLabel, atmCe, atmPe }) => {
    const kCe = symbol + "_CE_" + e.expiry;
    const kPe = symbol + "_PE_" + e.expiry;
    const cell = (v: number, key: string) => telegramPad(v.toFixed(1) + telegramDotTable(key, v), 7);
    const ceCells = atmCe ? `${cell(atmCe.pdh, kCe + "_pdh")}${cell(atmCe.pdl, kCe + "_pdl")}` : telegramPad("-", 14);
    const peCells = atmPe ? `${cell(atmPe.pdh, kPe + "_pdh")}${cell(atmPe.pdl, kPe + "_pdl")}` : telegramPad("-", 14);
    table3 += `${telegramPad(dateLabel, 8)}| ${ceCells}| ${peCells}\n`;
  });
  lines.push(`<pre>${table3.trimEnd()}</pre>`);

  const cePdhList = expiryRows.filter((r) => r.atmCe).map((r) => `${r.dateLabel}-${r.atmCe!.strike}`).join(", ");
  const pePdlList = expiryRows.filter((r) => r.atmPe).map((r) => `${r.dateLabel}-${r.atmPe!.strike}`).join(", ");
  lines.push(`CE strikes: ${cePdhList || "-"} at PDH`);
  lines.push(`PE strikes: ${pePdlList || "-"} at PDL`);

  // 2026-08-19: "PDL Broken + O‚âàH" caution + "Opposite-Premium Higher-High"
  // caution, per user request (grounded in the CE-rejection‚ÜíPE-reversal
  // pattern they described). Scoped to Current Expiry + Next Expiry ONLY
  // (per the user's explicit "current week and next week premium" -- Next
  // of Next / Monthly are skipped here by design).
  //
  // PDL Broken: today's LTP has traded below yesterday's low for this leg.
  // O‚âàH ("open approx equal to high"): today's high is within 1% of today's
  // open, i.e. the candle barely extended upward from its open -- read as a
  // weak/rejected upside attempt (this exact pattern, with a 0.02% gap, was
  // independently confirmed against a real TradingView chart the user sent
  // mid-session, so the 1% threshold here is a deliberately generous
  // superset of that real example, not an arbitrary number).
  //
  // Opposite-Premium Higher-High: once one leg (say CE) shows the pattern
  // above, this checks whether the OTHER leg (PE) of the SAME strike/expiry
  // made a fresh intraday high since the LAST Telegram message build for
  // that leg (TELEGRAM_PREV_DAY_HIGH). NOTE: resolution is bounded by how
  // often the underlying snapshot actually refreshes (~1-3 min depending on
  // adaptive cadence), not a literal live tick-by-tick feed -- disclosed to
  // the user, not oversold as tick-precise.
  const pdlBreachRows = expiryRows.filter((r) => r.e.expiry === "Current Expiry" || r.e.expiry === "Next Expiry");
  type LegBreach = { dateLabel: string; expiryLabel: string; side: "CE" | "PE"; strike: number; lastPrice: number; pdl: number; dayOpen: number; dayHigh: number; gapPct: number };
  const breaches: LegBreach[] = [];
  const freshHighLegs = new Set<string>(); // "CE"/"PE" keyed by expiryLabel, legs that made a new high THIS cycle
  pdlBreachRows.forEach(({ e, dateLabel, atmCe, atmPe }) => {
    ([["CE", atmCe], ["PE", atmPe]] as const).forEach(([side, leg]) => {
      if (!leg) return;
      const highKey = `${symbol}_${e.expiry}_${side}`;
      const prevHigh = TELEGRAM_PREV_DAY_HIGH.get(highKey);
      if (leg.dayHigh > 0 && prevHigh != null && leg.dayHigh > prevHigh) {
        freshHighLegs.add(`${e.expiry}_${side}`);
      }
      TELEGRAM_PREV_DAY_HIGH.set(highKey, leg.dayHigh);

      if (leg.pdl > 0 && leg.lastPrice < leg.pdl && leg.dayOpen > 0) {
        const gapPct = Math.abs(leg.dayHigh - leg.dayOpen) / leg.dayOpen * 100;
        if (gapPct <= 1) {
          breaches.push({ dateLabel, expiryLabel: e.expiry, side, strike: leg.strike, lastPrice: leg.lastPrice, pdl: leg.pdl, dayOpen: leg.dayOpen, dayHigh: leg.dayHigh, gapPct });
        }
      }
    });
  });
  if (breaches.length > 0) {
    lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");
    lines.push("‚ö†Ô∏è <b>PDL Broken + O‚âàH (Current+Next Week)</b>");
    breaches.forEach((b) => {
      // 2026-08-19 bug fix (found during a second self-initiated "check
      // now" re-check): this line had a literal "<" character ("LTP X <
      // PDL Y"). Message parse_mode is "HTML" -- Telegram parses ANY "<"
      // as the start of a tag, even in plain (non-<pre>) text, and "<
      // PDL" is not a recognized tag, so the WHOLE message would be
      // rejected with HTTP 400 "can't parse entities". This is the exact
      // same bug class fixed earlier this session ("<- ATM" inside a
      // <pre> block) -- reintroduced here in new code, caught before
      // shipping by re-reading every new lines.push() call for stray "<".
      // Fixed by rewording to avoid the character entirely, same approach
      // as the earlier fix.
      lines.push(`‚Ä¢ ${b.dateLabel} ${b.side} ${b.strike} ‚Äî LTP ${b.lastPrice.toFixed(1)} below PDL ${b.pdl.toFixed(1)} | O ${b.dayOpen.toFixed(1)} H ${b.dayHigh.toFixed(1)} (${b.gapPct.toFixed(2)}%)`);
      recordDailyEvent(`PDL Broken+O‚âàH: ${b.dateLabel} ${b.side} ${b.strike} (LTP ${b.lastPrice.toFixed(1)} below PDL ${b.pdl.toFixed(1)}, gap ${b.gapPct.toFixed(2)}%)`);
    });

    // Opposite-premium caution: for each breach, check if the OTHER side of
    // the SAME expiry made a fresh high this cycle.
    const cautionLines: string[] = [];
    breaches.forEach((b) => {
      const oppSide = b.side === "CE" ? "PE" : "CE";
      if (freshHighLegs.has(`${b.expiryLabel}_${oppSide}`)) {
        const row = pdlBreachRows.find((r) => r.e.expiry === b.expiryLabel);
        const oppLeg = row ? (oppSide === "CE" ? row.atmCe : row.atmPe) : null;
        if (oppLeg) {
          cautionLines.push(`‚Ä¢ ${b.dateLabel} ${oppSide} ${oppLeg.strike} ‚Äî new day-high ${oppLeg.dayHigh.toFixed(1)} THIS CYCLE, within same window as ${b.side} PDL break`);
          recordDailyEvent(`Opposite-Premium Caution: ${b.dateLabel} ${oppSide} ${oppLeg.strike} fresh high ${oppLeg.dayHigh.toFixed(1)} right after ${b.side} PDL break`);
        }
      }
    });
    if (cautionLines.length > 0) {
      lines.push("üö® <b>Opposite-Premium Caution</b>");
      cautionLines.forEach((l) => lines.push(l));
      lines.push("‚Üí Reading: rejection on one side + fresh high on the other, same window ‚Äî possible reversal setup building (your observed pattern)");
    }
  }

  // 2026-08-19: Confluence Note, per user request -- a plain-language
  // summary when 2+ already-computed data points point the same direction.
  // Deliberately labeled "observed", never "signal"/"buy"/"sell", consistent
  // with the earlier correction that delta/PCR are context, not entry
  // timing.
  {
    const confluenceFactors: string[] = [];
    if (thisSymbolPcrDir === "down") confluenceFactors.push(`PCR bearish(${symbol})`);
    else if (thisSymbolPcrDir === "up") confluenceFactors.push(`PCR bullish(${symbol})`);
    const ceBreach = breaches.find((b) => b.side === "CE");
    const peFreshAfterCe = ceBreach && freshHighLegs.has(`${ceBreach.expiryLabel}_PE`);
    if (ceBreach) confluenceFactors.push("CE rejection");
    if (peFreshAfterCe) confluenceFactors.push("PE fresh-high in same cycle");
    if (confluenceFactors.length >= 2) {
      const factorsText = confluenceFactors.join(" + ");
      lines.push(`üîé Confluence Note: ${factorsText} ‚Äî ${confluenceFactors.length} factors aligned`);
      // 2026-08-19: recorded for the async Haiku follow-up (feature ‚ë¢),
      // per user request. factorsKey doubles as the cost-guard signature --
      // the SAME combination of factors for this symbol won't re-trigger a
      // Haiku call (see TELEGRAM_CONFLUENCE_HAIKU_CACHE usage below).
      TELEGRAM_LAST_CONFLUENCE.set(symbol, { factorsText, factorsKey: `${symbol}::${factorsText}` });
    } else {
      TELEGRAM_LAST_CONFLUENCE.set(symbol, null);
    }
  }

  // 2026-08-19: BANKNIFTY-only round-number watch, per user request. Flags
  // when spot is within 0.3% of the nearest 1000-point level (a commonly
  // watched psychological level for BANKNIFTY specifically, given its much
  // larger index value vs NIFTY/SENSEX). Threshold is a starting point, easy
  // to retune.
  if (symbol === "BANKNIFTY" && m.current > 0) {
    const nearestThousand = Math.round(m.current / 1000) * 1000;
    // 2026-08-19 defensive fix (found during a self-initiated re-check): if
    // m.current were ever below 500 (never realistic for BANKNIFTY in
    // practice, but this guards it anyway), nearestThousand rounds to 0 and
    // the gapPct division below would divide by zero (Infinity/NaN pushed
    // into a live Telegram message). Guarding nearestThousand > 0 as well.
    if (nearestThousand > 0) {
      const gapPct = Math.abs(m.current - nearestThousand) / nearestThousand * 100;
      if (gapPct <= 0.3) {
        lines.push(`‚ö†Ô∏è Round-Number Watch: Spot ${m.current.toFixed(0)} ‚Üí within ${gapPct.toFixed(2)}% of ${nearestThousand} (psychological level)`);
      }
    }
  }

  // 2026-08-19: Delta 0.30‚Äì0.45 strike filter, per user request. Explicitly
  // labeled a "filter result", NOT a "signal" -- delta measures moneyness/
  // directional sensitivity (a strike-selection criterion), not entry
  // timing, per the earlier correction. Scans Current Expiry only.
  {
    const currentExp2 = (m.expiries || []).find((e) => e.expiry === "Current Expiry");
    if (currentExp2) {
      const ceMatch = (currentExp2.ceStrikes || []).find((s) => s.delta >= 0.30 && s.delta <= 0.45);
      const peMatch = (currentExp2.peStrikes || []).find((s) => s.delta <= -0.30 && s.delta >= -0.45);
      if (ceMatch || peMatch) {
        const ceText = ceMatch ? `CE ${ceMatch.strike} (Œî${ceMatch.delta.toFixed(2)})` : "CE -";
        const peText = peMatch ? `PE ${peMatch.strike} (Œî${peMatch.delta.toFixed(2)})` : "PE -";
        lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");
        lines.push(`üéØ Delta 0.30-0.45 Strikes: ${ceText} | ${peText}`);
        lines.push("Cross-check with live price action before entry");
      }
    }
  }

  lines.push("Legend: ‚ñ≤ up since last cycle | ‚ñº down | ‚óè first reading / unchanged");

  // Weekly (Current Expiry) vs Monthly direction comparison -- kept from
  // the previous version.
  const weeklyExp = (m.expiries || []).find((e) => e.expiry === "Current Expiry");
  const monthlyExp = (m.expiries || []).find((e) => e.expiry === "Monthly");
  const weeklyCe = weeklyExp ? (weeklyExp.ceStrikes || []).find((s) => s.isAtm) : null;
  const monthlyCe = monthlyExp ? (monthlyExp.ceStrikes || []).find((s) => s.isAtm) : null;
  if (weeklyCe && monthlyCe) {
    const wDir = weeklyCe.lastPrice >= weeklyCe.pdh ? "up" : weeklyCe.lastPrice <= weeklyCe.pdl ? "down" : "flat";
    const mDir = monthlyCe.lastPrice >= monthlyCe.pdh ? "up" : monthlyCe.lastPrice <= monthlyCe.pdl ? "down" : "flat";
    lines.push(`Weekly vs Monthly Direction: <b>${wDir === mDir ? "SAME" : "DIFFERENT"}</b>`);
  }
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");

  // 4. Key stocks/sectors (slow, 3-min)
  lines.push(`üìà <b>Key Stocks/Sectors</b>`);
  if (slow.stocks.length === 0) {
    lines.push("DATA UNAVAILABLE");
  } else {
    slow.stocks.forEach((s) => {
      lines.push(`${s.name}: ${telegramPctColor(s.changePct)} ${s.changePct != null ? (s.changePct >= 0 ? "+" : "") + s.changePct.toFixed(2) + "%" : "DATA UNAVAILABLE"}`);
    });
  }
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");

  // Last line: spot alignment (slow, 3-min)
  lines.push(`üéØ Spot Alignment: <b>${telegramSpotAlignment(m)}</b>`);
  lines.push(`üïí ${istTime()} IST`);

  return lines.join("\n");
}

async function runTelegramFastCycle(): Promise<void> {
  if (!isMarketOpenNowServer()) return;
  let activeSession: KiteSession | undefined;
  for (const s of sessions.values()) {
    if (s.expiresAt > Date.now()) { activeSession = s; break; }
  }
  if (!activeSession) return;

  const symbols: V2PremiumSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

  // Restart-safe Telegram warm-up: bootstrap only from the same server-held
  // market snapshot when it passes the existing 3-minute freshness rule.
  // No new Kite/API call is added here; stale/error snapshots remain blocked.
  const slowCacheBootstrapFresh = Boolean(
    activeSession.marketSnapshot &&
    activeSession.snapshotTime &&
    Date.now() - activeSession.snapshotTime < SNAPSHOT_TTL_MS
  );
  if (slowCacheBootstrapFresh) {
    for (const symbol of symbols) {
      if (TELEGRAM_SLOW_CACHE.has(symbol)) continue;
      const m = activeSession.marketSnapshot?.[symbol];
      if (m && !m.error && m.atmStrike) {
        TELEGRAM_SLOW_CACHE.set(symbol, { m, stocks: [], updatedAt: activeSession.snapshotTime! });
      }
    }
  }

  // 2026-08-18: the PCR info box shows all 3 indices in every message, so
  // all 3 symbols' fast snapshots are fetched FIRST (no new Kite cost --
  // this cycle already fetched all 3 individually before, just not into a
  // shared map) and only then are the 3 messages built/sent.
  const allFast: Map<string, OptionChainStats> = new Map();
  for (const symbol of symbols) {
    try {
      const fast = await fetchTelegramFastPcrSnapshot(activeSession.accessToken, symbol);
      if (fast) {
        allFast.set(symbol, fast);
        TELEGRAM_LATEST_FAST.set(symbol, fast);
      }
    } catch (err) {
      console.error(`[Telegram Fast] snapshot fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2026-08-19 fix (found during a fresh limitations review): this sends
  // 3 messages to the SAME chat_id back-to-back with no spacing. Telegram
  // documents a soft limit of roughly 1 message/second to a single chat --
  // firing 3 in a tight loop risks an occasional 429, which (before the
  // sendTelegramAlert fix above) would have failed completely silently.
  // A small delay between sends keeps this comfortably under that limit.
  let isFirstSend = true;
  for (const symbol of symbols) {
    try {
      const fast = allFast.get(symbol);
      if (!fast) continue;
      const message = buildTelegramMarketSnapshotMessage(symbol, fast, allFast);
      if (message) {
        if (!isFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));
        isFirstSend = false;
        await sendTelegramAlert(message, symbol);
      }
    } catch (err) {
      console.error(`[Telegram Fast] message build/send failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2026-08-19: Confluence Note Haiku explanation (feature ‚ë¢), per user
  // request. Runs AFTER the 3 main messages above (not fire-and-forget
  // mid-loop) specifically so it still respects the same 1.1s-per-send
  // spacing to the same chat_id -- an untracked concurrent send here could
  // silently violate Telegram's soft rate limit alongside the main loop.
  // Cost-guarded: only calls Haiku when this symbol's confluence
  // factor-combination is NEW or 15+ minutes have passed since it was last
  // explained (same window as the existing Haiku Verdict feature).
  for (const symbol of symbols) {
    try {
      const confluence = TELEGRAM_LAST_CONFLUENCE.get(symbol);
      if (!confluence) continue;
      const cached = TELEGRAM_CONFLUENCE_HAIKU_CACHE.get(symbol);
      const sameFactors = !!cached && cached.factorsKey === confluence.factorsKey;
      const guardWindowPassed = !cached || (Date.now() - cached.calledAt) >= 15 * 60 * 1000;
      if (sameFactors && !guardWindowPassed) continue;
      TELEGRAM_CONFLUENCE_HAIKU_CACHE.set(symbol, { factorsKey: confluence.factorsKey, calledAt: Date.now() });

      const prompt =
        `Confluence observed for ${symbol}: ${confluence.factorsText}. ` +
        `In ONE short sentence for a retail options trader reading on their phone, explain briefly why this combination is worth noting. ` +
        `Do NOT suggest a trade, do NOT say buy/sell/enter/exit, only explain the observation. Do NOT invent any data not given above.`;
      const explanation = await callHaikuPlain(prompt);
      if (explanation) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        // telegramEscapeHtml() is mandatory here -- explanation is
        // free-form Haiku text, not hand-written, so it could contain a
        // literal "<"/">" that would otherwise break Telegram's HTML parser
        // (see telegramEscapeHtml's own comment for the full reasoning).
        await sendTelegramAlert(`üí° <b>Why this matters (${symbol})</b>\n${telegramEscapeHtml(explanation)}`, symbol);
      }
    } catch (err) {
      console.error(`[Telegram Haiku Confluence] failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }
}

// 2026-08-18: periodic "what changed / what didn't" summary, sent every
// 15 min, 30 min, and 1 hour (each its own independent tag, so all 3 can
// fire together at hour boundaries -- e.g. 12:00 IST fires all 3). Zero
// extra Kite calls: reuses TELEGRAM_SLOW_CACHE (3-min) + TELEGRAM_LATEST_FAST
// (1-min) + a regime read from the existing V2 regime detector, which
// itself reads from session.snapshotHistory already in memory.
type TelegramPeriodicTag = "15MIN" | "30MIN" | "60MIN";

interface TelegramPeriodicSnapshot {
  timestamp: number;
  fullChainPcr: number | null;
  oiPcr: number | null;
  vix: number | null;
  callWallStrike: number | null;
  callWallOi: number | null;
  putWallStrike: number | null;
  putWallOi: number | null;
  atmCeExtrinsic: number | null;
  atmPeExtrinsic: number | null;
  stocks: Array<{ name: string; changePct: number | null }>;
  spotAlignment: string;
  regime: string | null;
  structuralBias: string | null;
}

const TELEGRAM_PERIODIC_SNAPSHOT_15: Map<string, TelegramPeriodicSnapshot> = new Map();
const TELEGRAM_PERIODIC_SNAPSHOT_30: Map<string, TelegramPeriodicSnapshot> = new Map();
const TELEGRAM_PERIODIC_SNAPSHOT_60: Map<string, TelegramPeriodicSnapshot> = new Map();

function buildTelegramPeriodicSnapshot(symbol: string, session: KiteSession): TelegramPeriodicSnapshot | null {
  const slow = TELEGRAM_SLOW_CACHE.get(symbol);
  if (!slow || slow.m.error) return null;
  const m = slow.m;
  const fast = TELEGRAM_LATEST_FAST.get(symbol);

  const exp = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  let callWallStrike: number | null = null, callWallOi = -1;
  let putWallStrike: number | null = null, putWallOi = -1;
  if (exp) {
    (exp.ceStrikes || []).forEach((s) => { if (s.oi != null && s.oi > callWallOi) { callWallOi = s.oi; callWallStrike = s.strike; } });
    (exp.peStrikes || []).forEach((s) => { if (s.oi != null && s.oi > putWallOi) { putWallOi = s.oi; putWallStrike = s.strike; } });
  }
  const atmCe = exp ? (exp.ceStrikes || []).find((s) => s.isAtm) : null;
  const atmPe = exp ? (exp.peStrikes || []).find((s) => s.isAtm) : null;
  const atmCeExtrinsic = atmCe ? Math.max(0, atmCe.lastPrice - Math.max(0, m.current - atmCe.strike)) : null;
  const atmPeExtrinsic = atmPe ? Math.max(0, atmPe.lastPrice - Math.max(0, atmPe.strike - m.current)) : null;

  let regime: string | null = null;
  let structuralBias: string | null = null;
  try {
    const m10 = buildV2MarketBehaviourRegime(symbol as V2PremiumSymbol, session, m);
    regime = (m10 as any)?.regime?.currentRegime ?? null;
    structuralBias = (m10 as any)?.regime?.structuralBias ?? null;
  } catch (err) {
    console.error(`[Telegram Periodic] regime calc failed for ${symbol}:`, err instanceof Error ? err.message : err);
  }

  return {
    timestamp: Date.now(),
    fullChainPcr: fast?.fullChainPcr ?? null,
    oiPcr: fast?.oiPcr ?? null,
    vix: m.vix ?? null,
    callWallStrike,
    callWallOi: callWallOi >= 0 ? callWallOi : null,
    putWallStrike,
    putWallOi: putWallOi >= 0 ? putWallOi : null,
    atmCeExtrinsic,
    atmPeExtrinsic,
    stocks: slow.stocks || [],
    spotAlignment: telegramSpotAlignment(m),
    regime,
    structuralBias,
  };
}

function telegramFormatIstTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

function buildTelegramPeriodicSummaryMessage(
  symbol: string,
  tag: TelegramPeriodicTag,
  prev: TelegramPeriodicSnapshot,
  curr: TelegramPeriodicSnapshot
): string {
  const tagLabel = tag === "15MIN" ? "15-MIN SUMMARY" : tag === "30MIN" ? "30-MIN SUMMARY" : "1-HOUR SUMMARY";
  const changed: string[] = [];
  const unchanged: string[] = [];

  const numField = (label: string, prevVal: number | null, currVal: number | null, decimals: number) => {
    if (prevVal == null || currVal == null) return;
    const prevText = prevVal.toFixed(decimals);
    const currText = currVal.toFixed(decimals);
    if (Math.abs(prevVal - currVal) > 1e-9) {
      changed.push(`${label}: ${prevText} ‚Üí ${currText} ${currVal > prevVal ? "‚ñ≤" : "‚ñº"}`);
    } else {
      unchanged.push(`${label}: ${currText} (flat)`);
    }
  };

  numField("Full-Chain PCR", prev.fullChainPcr, curr.fullChainPcr, 3);
  numField("OI PCR (¬±7)", prev.oiPcr, curr.oiPcr, 3);
  numField("India VIX", prev.vix, curr.vix, 2);
  numField("ATM CE Extrinsic", prev.atmCeExtrinsic, curr.atmCeExtrinsic, 1);
  numField("ATM PE Extrinsic", prev.atmPeExtrinsic, curr.atmPeExtrinsic, 1);

  if (prev.callWallStrike != null && curr.callWallStrike != null) {
    if (prev.callWallStrike !== curr.callWallStrike || prev.callWallOi !== curr.callWallOi) {
      changed.push(`Call Wall: ${prev.callWallStrike} (${telegramFormatLakhs(prev.callWallOi ?? 0)}) ‚Üí ${curr.callWallStrike} (${telegramFormatLakhs(curr.callWallOi ?? 0)})`);
    } else {
      unchanged.push(`Call Wall: ${curr.callWallStrike} (${telegramFormatLakhs(curr.callWallOi ?? 0)})`);
    }
  }
  if (prev.putWallStrike != null && curr.putWallStrike != null) {
    if (prev.putWallStrike !== curr.putWallStrike || prev.putWallOi !== curr.putWallOi) {
      changed.push(`Put Wall: ${prev.putWallStrike} (${telegramFormatLakhs(prev.putWallOi ?? 0)}) ‚Üí ${curr.putWallStrike} (${telegramFormatLakhs(curr.putWallOi ?? 0)})`);
    } else {
      unchanged.push(`Put Wall: ${curr.putWallStrike} (${telegramFormatLakhs(curr.putWallOi ?? 0)})`);
    }
  }

  if (curr.regime != null) {
    if (prev.regime !== curr.regime) changed.push(`Regime: ${prev.regime ?? "-"} ‚Üí ${curr.regime}`);
    else unchanged.push(`Regime: ${curr.regime}`);
  }
  if (curr.structuralBias != null) {
    if (prev.structuralBias !== curr.structuralBias) changed.push(`Structural Bias: ${prev.structuralBias ?? "-"} ‚Üí ${curr.structuralBias}`);
    else unchanged.push(`Structural Bias: ${curr.structuralBias}`);
  }

  curr.stocks.forEach((s) => {
    const prevStock = prev.stocks.find((p) => p.name === s.name);
    if (!prevStock || prevStock.changePct == null || s.changePct == null) return;
    const prevText = `${prevStock.changePct >= 0 ? "+" : ""}${prevStock.changePct.toFixed(2)}%`;
    const currText = `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%`;
    if (Math.abs(prevStock.changePct - s.changePct) > 0.001) changed.push(`${s.name}: ${prevText} ‚Üí ${currText}`);
    else unchanged.push(`${s.name}: ${currText}`);
  });

  // PDH/PDL is static for the whole trading day by definition -- always
  // reported unchanged, not diffed against a previous snapshot.
  unchanged.push("PDH/PDL: static for the day");

  if (prev.spotAlignment !== curr.spotAlignment) changed.push(`Spot Alignment: ${prev.spotAlignment} ‚Üí ${curr.spotAlignment}`);
  else unchanged.push(`Spot Alignment: ${curr.spotAlignment}`);

  const lines: string[] = [];
  lines.push(`üìã <b>${symbol} ${tagLabel}</b> (${telegramFormatIstTime(prev.timestamp)} ‚Üí ${telegramFormatIstTime(curr.timestamp)} IST)`);
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");
  if (changed.length > 0) {
    lines.push("<b>CHANGED:</b>");
    changed.forEach((c) => lines.push(c));
  }
  if (unchanged.length > 0) {
    if (changed.length > 0) lines.push("");
    lines.push("<b>UNCHANGED:</b>");
    unchanged.forEach((c) => lines.push(c));
  }
  lines.push("‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ");
  return lines.join("\n");
}

async function runTelegramPeriodicSummaryCycle(tags: TelegramPeriodicTag[]): Promise<void> {
  let activeSession: KiteSession | undefined;
  for (const s of sessions.values()) {
    if (s.expiresAt > Date.now()) { activeSession = s; break; }
  }
  if (!activeSession) return;

  // 2026-08-19 fix (found during a fresh limitations review): at hour
  // boundaries all 3 tags (15/30/60-min) can fire together for all 3
  // symbols -- up to 9 messages to the SAME chat_id in one pass. Same
  // ~1 message/second-per-chat concern as the fast cycle above, spaced
  // the same way.
  const symbols: V2PremiumSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  let isFirstSend = true;
  for (const symbol of symbols) {
    const curr = buildTelegramPeriodicSnapshot(symbol, activeSession);
    if (!curr) continue;
    for (const tag of tags) {
      const snapMap = tag === "15MIN" ? TELEGRAM_PERIODIC_SNAPSHOT_15 : tag === "30MIN" ? TELEGRAM_PERIODIC_SNAPSHOT_30 : TELEGRAM_PERIODIC_SNAPSHOT_60;
      const prev = snapMap.get(symbol);
      if (prev) {
        try {
          const message = buildTelegramPeriodicSummaryMessage(symbol, tag, prev, curr);
          if (!isFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));
          isFirstSend = false;
          await sendTelegramAlert(message, symbol);
        } catch (err) {
          console.error(`[Telegram Periodic] ${tag} summary failed for ${symbol}:`, err instanceof Error ? err.message : err);
        }
      }
      snapMap.set(symbol, curr);
    }
  }
}

// 2026-08-19 lacuna fix (found during a user-requested rigorous re-check of
// "Kite limits, Telegram message-fire system, or anything else"): Telegram's
// sendMessage API rejects any message with text over 4096 characters (HTTP
// 400 "message is too long"). Nothing in this codebase ever checked for
// this -- as this session's messages grew (PCR box + Intr/Ext table + OI
// Ladder + DH/DL + PDH/PDL + PDL-Broken/Opposite-Premium/Confluence/Delta
// sections), a busy cycle with every optional section firing could
// plausibly cross 4096 chars and simply fail to arrive, with only a log
// line (from the existing response.ok fix) to show for it -- no message,
// no visible fallback. Fixed by splitting oversized messages at this
// codebase's own section-separator boundary, which is safe specifically
// because every <b>/<pre> tag pair in every Telegram message builder in
// this file opens and closes WITHIN one section, never spanning a
// separator -- so a split here can never leave a tag open across chunks.
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_SECTION_SEPARATOR = "‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ‚îÅ";

function telegramSplitMessageSafely(message: string): string[] {
  if (message.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [message];
  const sections = message.split(`\n${TELEGRAM_SECTION_SEPARATOR}\n`);
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    const candidate = current ? `${current}\n${TELEGRAM_SECTION_SEPARATOR}\n${section}` : section;
    if (candidate.length > TELEGRAM_MAX_MESSAGE_LENGTH && current) {
      chunks.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  // Last-resort fallback ONLY: if a single section is itself over 4096
  // chars (not expected given this codebase's table sizes today, but
  // defensive rather than silently failing), hard-truncate it. This CAN
  // leave an HTML tag unclosed in the rare case it triggers -- an accepted
  // tradeoff since the alternative is Telegram rejecting the whole message
  // anyway; logged loudly so it's never silent.
  return chunks.map((c) => {
    if (c.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return c;
    console.error(`[Telegram] a single message section is ${c.length} chars, over the 4096 limit even alone -- hard-truncating (may leave a tag unclosed, logged for visibility)`);
    return c.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20) + "\n[...truncated]";
  });
}

// 2026-08-21: per-symbol chat routing, per user request ("separate telegram
// message for nifty banknifty sensex ... too much message at one screen
// makes confusion"). If the user has created a dedicated Telegram chat for
// a symbol and set its env var, that symbol's alerts go there; any symbol
// without a dedicated var (or when no symbol is passed at all, e.g. a
// future non-symbol-specific alert) falls back to the original shared
// TELEGRAM_CHAT_ID -- so a user who hasn't set up the 3 new chats yet keeps
// getting exactly today's behavior (everything in one chat), zero-risk
// rollout.
function telegramChatIdFor(symbol?: V2PremiumSymbol): string | null {
  const fallback = process.env.TELEGRAM_CHAT_ID?.trim() || null;
  if (!symbol) return fallback;
  const perSymbolEnvVar =
    symbol === "NIFTY" ? process.env.TELEGRAM_CHAT_ID_NIFTY :
    symbol === "BANKNIFTY" ? process.env.TELEGRAM_CHAT_ID_BANKNIFTY :
    symbol === "SENSEX" ? process.env.TELEGRAM_CHAT_ID_SENSEX :
    undefined;
  const perSymbol = perSymbolEnvVar?.trim();
  return perSymbol || fallback;
}

async function sendTelegramAlert(message: string, symbol?: V2PremiumSymbol): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = telegramChatIdFor(symbol);
  if (!token || !chatId) return; // not configured ‚Äî silently skip, no error spam
  const chunks = telegramSplitMessageSafely(message);
  if (chunks.length > 1) {
    console.log(`[Telegram] message (${message.length} chars) exceeds Telegram's 4096-char limit -- split into ${chunks.length} chunks at section boundaries`);
  }
  let isFirstChunk = true;
  for (const chunk of chunks) {
    // Same 1.1s-per-chat rate-limit spacing used everywhere else in this
    // file, applied here too since a split message now means multiple real
    // sendMessage calls for what was logically one alert.
    if (!isFirstChunk) await new Promise((resolve) => setTimeout(resolve, 1100));
    isFirstChunk = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "HTML" }),
      });
      // 2026-08-19 bug fix (found during a fresh limitations review): this
      // never checked response.ok before. fetch() only rejects on a network-
      // level failure -- an HTTP 400 (malformed HTML, e.g. a stray "<" in
      // the text) or 429 (rate limited) still resolves normally and was
      // being silently treated as success. Now logged so a bad message is
      // visible in the server logs instead of just vanishing.
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`[Telegram] sendMessage rejected: HTTP ${response.status}`, errorText.substring(0, 300));
      }
    } catch (err) {
      console.error("[Telegram] send failed:", err instanceof Error ? err.message : err);
    }
  }
}

// ============================================================================
// "Premium-only" live-tracking Telegram group (2026-08-21)
// ============================================================================
// Explicit user request: a SEPARATE dedicated group (not per-symbol like
// the 3 detailed-alert chats above) showing only Strike/Side + BUY NOW +
// SL/T1/T2/T3, where the SAME message is edited in place as the trade
// plays out, ending in a green tick (target) or red cross (SL) -- rather
// than a stream of separate messages. One shared group across NIFTY/
// BANKNIFTY/SENSEX, configured via TELEGRAM_CHAT_ID_PREMIUM_ONLY.
function telegramPremiumOnlyChatId(): string | null {
  return process.env.TELEGRAM_CHAT_ID_PREMIUM_ONLY?.trim() || null;
}

async function sendTelegramPremiumOnlyMessage(text: string): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = telegramPremiumOnlyChatId();
  if (!token || !chatId) return null; // not configured ‚Äî silently skip, no error spam
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[Telegram] premium-only sendMessage rejected: HTTP ${response.status}`, JSON.stringify(json)?.slice(0, 300));
      return null;
    }
    const messageId = json?.result?.message_id;
    return typeof messageId === "number" ? messageId : null;
  } catch (err) {
    console.error("[Telegram] premium-only send failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function editTelegramPremiumOnlyMessage(messageId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = telegramPremiumOnlyChatId();
  if (!token || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      // Telegram returns 400 "message is not modified" when the new text
      // is byte-identical to what's already there -- harmless (happens
      // whenever a cycle finds nothing changed), not logged as an error.
      if (!errorText.includes("message is not modified")) {
        console.error(`[Telegram] premium-only editMessageText rejected: HTTP ${response.status}`, errorText.slice(0, 300));
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Telegram] premium-only edit failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

interface PremiumOnlyLiveTracker {
  planId: string;
  messageId: number;
  symbol: V2PremiumSymbol;
  side: "CE" | "PE";
  strike: number | null;
  entry: number;
  sl: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  createdAtMs: number;
  resolved: boolean;
  // Trade Card Composer V1 snapshot (2026-08-21) -- captured ONCE at
  // creation time from the SAME already-computed prob/tmPlan/advancedGreeks
  // values the per-symbol M12b alert uses, so the edit-in-place cycle
  // (runPremiumOnlyLiveUpdateCycle) can rebuild the full 7-section card
  // without re-running calculateBuyProbability against stale/later data.
  // Optional so any tracker already in memory before this field existed
  // (in-memory only, resets on redeploy per this array's own disclosed
  // limitation) still renders via the legacy buildPremiumOnlyMessageText
  // fallback in buildPremiumOnlyTradeCardText.
  cardSnapshot?: {
    moneynessRole: string | null;
    probability: number;
    grade: string;
    confidence: string;
    scoreReasons: string[];
    contextNotes: string[];
    riskFlags: string[];
    tmRPremium: number | null;
    tmAtrUnderlying: number | null;
    tmDeltaUsed: number | null;
    tmTrailingRule: string | null;
    advancedGreeks: TradeCardAdvancedGreeks | null;
    futuresOiBuildup: string | null;
    marketRegime: string | null;
    // Frozen once from the same fail-closed dashboard/Telegram decision so
    // premium-only edits preserve the exact original setup and risk values.
    compactSignal?: string;
    compactDte?: number | null;
    compactLotRisk?: number | null;
    compactMaxRisk?: number | null;
    compactWhy?: string | null;
  };
}

// In-memory only, same disclosed limitation as outcomeRecords/journalEntries
// elsewhere in this file: resets on redeploy. A resolved tracker is kept
// (not deleted) until eviction so its final ‚úÖ/‚ùå state stays visible in
// this array for the rest of the process lifetime; only evicted once the
// cap is hit, oldest-resolved-first.
const premiumOnlyLiveTrackers: PremiumOnlyLiveTracker[] = [];
const PREMIUM_ONLY_MAX_TRACKERS = 200;

// Extracted (2026-08-21, Trade Card Composer V1) from buildPremiumOnlyMessageText's
// own switch so BOTH the legacy message builder below AND the new
// buildPremiumOnlyTradeCardText can share the exact same status vocabulary --
// no wording drift between the two.
function premiumOnlyStatusLine(finalStatus: string | null): string {
  switch (finalStatus) {
    case "TARGET_T1_HIT": return "‚úÖ T1 achieved";
    case "TARGET_T2_HIT": return "‚úÖ T2 achieved";
    case "TARGET_T3_HIT": return "‚úÖ T3 achieved (100%)";
    case "STOP_HIT": return "‚ùå SL hit";
    case "NEITHER_HIT": return "‚ö™ Window closed ‚Äî neither target nor SL hit";
    case "INCOMPLETE_WINDOW":
    case "INCOMPLETE_STRIKE_SHIFTED":
    case "INCOMPLETE_NO_ENTRY_DATA":
    case "INCOMPLETE_DATA":
      return "‚ö™ Incomplete data ‚Äî no clear outcome";
    default:
      return "üü° LIVE ‚Äî tracking...";
  }
}

function buildPremiumOnlyMessageText(t: PremiumOnlyLiveTracker, finalStatus: string | null): string {
  const header = `<b>${t.symbol} ${t.strike != null ? t.strike : "?"} ${t.side}</b> ‚Äî BUY NOW`;
  const levelParts: string[] = [`Entry: <b>‚Çπ${t.entry}</b>`];
  if (t.sl != null) levelParts.push(`SL: <b>‚Çπ${t.sl}</b>`);
  if (t.t1 != null) levelParts.push(`T1: <b>‚Çπ${t.t1}</b>`);
  if (t.t2 != null) levelParts.push(`T2: <b>‚Çπ${t.t2}</b>`);
  if (t.t3 != null) levelParts.push(`T3: <b>‚Çπ${t.t3}</b> (100%)`);
  const levels = levelParts.join(" | ");
  const statusLine = premiumOnlyStatusLine(finalStatus);
  const elapsedMin = Math.max(0, Math.round((Date.now() - t.createdAtMs) / 60000));
  return `${header}\n${levels}\nStatus: ${statusLine}\n<i>${elapsedMin} min since signal ¬∑ forward-test only, not backtested</i>`;
}

// Trade Card Composer V1 (2026-08-21) -- richer 7-section replacement for
// buildPremiumOnlyMessageText, used for BOTH the initial send and every
// in-place edit of the SAME premium-only group message (messageId unchanged
// -- this function only builds text, it never sends/edits itself, exactly
// like buildPremiumOnlyMessageText before it). Falls back to the legacy
// builder for any tracker that predates cardSnapshot (in-memory only, so
// this only matters immediately after a redeploy that adds this field).
// lastPrice is deliberately set to the FROZEN entry premium (a real,
// already-recorded value), never a live re-fetch -- this module has no
// network access and re-fetching here would be a second, possibly stale,
// source of truth for what was already decided at signal time. spot/dte
// are left null (never captured in this tracker) and are correctly OMITTED
// by the composer's own missing-field policy rather than guessed.
function buildPremiumOnlyTradeCardText(t: PremiumOnlyLiveTracker, finalStatus: string | null): string {
  const s = t.cardSnapshot;
  if (!s) return buildPremiumOnlyMessageText(t, finalStatus);

  const elapsedMin = Math.max(0, Math.round((Date.now() - t.createdAtMs) / 60000));
  if (s.compactSignal && s.compactDte != null && s.compactLotRisk != null
      && s.compactMaxRisk != null && t.strike != null && t.sl != null
      && t.t1 != null && t.t2 != null) {
    const emoji = t.side === "CE" ? "üü¢" : "üî¥";
    const why = s.compactWhy || "Validated price, premium, and risk structure.";
    return `${emoji} <b>${telegramEscapeHtml(t.symbol)} | ${telegramEscapeHtml(s.compactSignal)}</b>\n` +
      `üìä ${t.strike} ${telegramEscapeHtml(t.side)} | Premium ‚Çπ${t.entry} | ${s.compactDte} DTE\n` +
      `üéØ Entry ‚Çπ${t.entry} | SL ‚Çπ${t.sl} | T1 ‚Çπ${t.t1} | T2 ‚Çπ${t.t2}\n` +
      `üõ° Risk ‚Çπ${s.compactLotRisk} / max ‚Çπ${s.compactMaxRisk}\n` +
      `üí° Why: ${telegramEscapeHtml(why)}\n` +
      `Status: ${premiumOnlyStatusLine(finalStatus)}\n` +
      `<i>${elapsedMin} min | Manual review only; forward-test only.</i>`;
  }

  const tmPlanForCard: TradeCardTmPlan | null =
    t.sl != null && t.t1 != null && t.t2 != null && t.t3 != null &&
    s.tmRPremium != null && s.tmAtrUnderlying != null && s.tmDeltaUsed != null && s.tmTrailingRule != null
      ? {
          status: "OK",
          entry: t.entry,
          sl: t.sl,
          t1: t.t1,
          t2: t.t2,
          t3: t.t3,
          rPremium: s.tmRPremium,
          atrUnderlying: s.tmAtrUnderlying,
          deltaUsed: s.tmDeltaUsed,
          trailingRule: s.tmTrailingRule,
        }
      : null;

  const input: TradeCardInput = {
    symbol: t.symbol,
    decision: t.side === "CE" ? "BEST_CE" : "BEST_PE",
    label: t.side === "CE" ? "BUY" : "SELL",
    strike: t.strike,
    moneynessRole: s.moneynessRole,
    lastPrice: t.entry,
    spot: null,
    dte: null,
    probability: s.probability,
    grade: s.grade,
    confidence: s.confidence,
    scoreReasons: s.scoreReasons,
    contextNotes: s.contextNotes,
    riskFlags: s.riskFlags,
    tmPlan: tmPlanForCard,
    advancedGreeks: s.advancedGreeks,
    futuresOiBuildup: s.futuresOiBuildup,
    marketRegime: s.marketRegime,
    liveStatus: { statusLine: premiumOnlyStatusLine(finalStatus), elapsedMin },
    // Inlined rather than calling the shared istTime() helper -- that
    // helper is defined as a LOCAL const inside two other functions
    // (not a top-level hoisted declaration), so it is not in scope here.
    // Same formatting, verified identical to both existing definitions.
    timestampIst: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
  };
  return buildTelegramTradeCard(input);
}

// Runs on the same 60s cadence as runOutcomeEvaluationCycle (see setInterval
// near outcomeRecords), reading the SAME outcomeRecords array it just
// evaluated -- no new API calls, no new evaluation logic, purely a
// presentation layer over what the outcome-engine already decided. A plan's
// 4 parallel horizon records (30m/60m/90m/EOD) all share identical entry/
// sl/t1/t2/t3, so any one of them hitting a real target/stop IS the real
// outcome regardless of which horizon window is still open; only once
// EVERY horizon has settled with no hit does this consider the plan a
// non-event (NEITHER_HIT/INCOMPLETE_*, taken from the longest/EOD horizon
// as the most representative).
async function runPremiumOnlyLiveUpdateCycle(): Promise<void> {
  let isFirst = true;
  for (const tracker of premiumOnlyLiveTrackers) {
    if (tracker.resolved) continue;
    const related = outcomeRecords.filter((r) => r.planId === tracker.planId);
    if (related.length === 0) continue; // never crash on a tracker whose records were evicted

    const hit = related.find(
      (r) => r.status === "TARGET_T1_HIT" || r.status === "TARGET_T2_HIT" || r.status === "TARGET_T3_HIT" || r.status === "STOP_HIT"
    );
    const allSettled = related.every((r) => r.status !== "PENDING");
    let finalStatus: string | null = null;
    if (hit) {
      finalStatus = hit.status;
    } else if (allSettled) {
      finalStatus = related.find((r) => r.horizon === "EOD")?.status ?? related[related.length - 1].status;
    }

    const text = buildPremiumOnlyTradeCardText(tracker, finalStatus);
    if (!isFirst) await new Promise((resolve) => setTimeout(resolve, 1100));
    isFirst = false;
    await editTelegramPremiumOnlyMessage(tracker.messageId, text);
    if (finalStatus) tracker.resolved = true;
  }
}

// 2026-08-19: shared helper for the 2 new Telegram-side Haiku uses
// (Confluence Note explanation, EOD summary), per user request. Same
// design boundary as the existing /api/haiku-verdict endpoint: Haiku is
// given already-computed facts and asked to explain/summarize ONLY --
// never asked to decide anything or invent data not provided. Returns
// null (never throws) on any failure -- a missing/failed Haiku call must
// never block or corrupt the Telegram message pipeline it's attached to.
// 2026-08-19: mandatory before inserting ANY Haiku-generated free text into
// a Telegram message (parse_mode "HTML"). Haiku's output is free-form
// natural language -- it could easily contain a literal "<" or ">" (e.g.
// "CE premium < PE premium") which Telegram's HTML parser would try to
// read as a tag, exactly the same bug class fixed twice already this
// session in our OWN hand-written message text. Since this text isn't
// hand-written and can't be manually reworded in advance, it must be
// HTML-escaped instead -- the standard-compliant way to embed arbitrary
// text in Telegram's HTML parse mode.
function telegramEscapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function callHaikuPlain(prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[Telegram Haiku] Anthropic API error ${response.status}:`, errText.substring(0, 300));
      return null;
    }
    const json: any = await response.json();
    const textBlock = Array.isArray(json.content) ? json.content.find((b: any) => b.type === "text") : null;
    return textBlock && typeof textBlock.text === "string" ? textBlock.text.trim() : null;
  } catch (err) {
    console.error("[Telegram Haiku] call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// 2026-08-19: Telegram-side Haiku state, per user request (features ‚ë¢‚ë£).
//
// ‚ë¢ Confluence Note explanation: keyed by symbol, cost-guarded so the same
// confluence factor-set for the same symbol doesn't re-call Haiku every
// 1-min cycle while it persists -- only on a genuinely NEW factor
// combination or after 15 min, same cost-guard window as the existing
// Haiku Verdict feature.
const TELEGRAM_CONFLUENCE_HAIKU_CACHE: Map<string, { factorsKey: string; calledAt: number }> = new Map();
// Set by buildTelegramMarketSnapshotMessage() each time it computes a
// Confluence Note (overwritten every cycle, cleared to null when no
// confluence fires this cycle) so the CALLER (runTelegramFastCycle) can,
// after sending the main message, decide whether to fire the async Haiku
// follow-up below -- kept out-of-band rather than making the message
// builder itself async, since it's called synchronously from several
// places and converting it would be a much larger, riskier change than
// this session's scope calls for.
const TELEGRAM_LAST_CONFLUENCE: Map<string, { factorsText: string; factorsKey: string } | null> = new Map();

// ‚ë£ EOD summary: accumulates today's PDL-Broken / Opposite-Premium Caution
// events per symbol through the day, summarized once near market close,
// then cleared (also cleared by the existing daily reset as a safety net
// in case the EOD trigger is ever missed on a given day).
interface TelegramDailyEvent { time: string; text: string }
const TELEGRAM_DAILY_EVENTS: Map<string, TelegramDailyEvent[]> = new Map();
let telegramEodSummarySentDate: string | null = null;

async function runTelegramAlertCycle(session: KiteSession): Promise<void> {
  const symbols: V2PremiumSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  const istTime = () => new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

  // 2026-08-19 lacuna fix (found during a user-requested rigorous re-check):
  // this cycle can send up to 4 different alert types per symbol (M10
  // Regime Shift, M11 Evidence Fusion, M12a Research Signal, M12b Buy
  // Signal) x 3 symbols = up to 12 sendTelegramAlert() calls in one pass,
  // and NONE of them were spaced -- unlike every other Telegram cycle in
  // this file (Market Snapshot fast/periodic/EOD), which all got the
  // 1.1s-per-chat spacing fix earlier this session. This was a genuine gap
  // left over from before that fix was applied elsewhere. sendAlertSpaced()
  // below is a drop-in replacement for sendTelegramAlert() used by every
  // send in this function, sharing one first-send flag across the WHOLE
  // cycle (not per-symbol) so the spacing is correct across symbol
  // boundaries too.
  let alertIsFirstSend = true;
  const sendAlertSpaced = async (message: string, symbolForChat?: V2PremiumSymbol): Promise<void> => {
    if (!alertIsFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));
    alertIsFirstSend = false;
    await sendTelegramAlert(message, symbolForChat);
  };

  for (const symbol of symbols) {
    const m = session.marketSnapshot?.[symbol];

    // Market Snapshot slow cache (2026-08-18): refresh wall/expiry-table/
    // stocks/spot-alignment context once per 3-min cycle (this function's
    // own natural cadence, piggybacked exactly like M10-M12b -- zero extra
    // Kite calls except the stock watchlist, which IS a genuine new call
    // but only once per 3 min, not once per min). The 1-min fast cycle
    // reads this cache directly rather than recomputing any of it.
    if (m && !m.error) {
      try {
        const stocks = await fetchTelegramStockWatchlist(session.accessToken, symbol);
        TELEGRAM_SLOW_CACHE.set(symbol, { m, stocks, updatedAt: Date.now() });
      } catch (err) {
        console.error(`[Telegram] Slow cache refresh failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    // --- M10: Regime shift alert ---
    try {
      const m10 = buildV2MarketBehaviourRegime(symbol, session, m);
      const currentRegime = (m10 as any)?.regime?.currentRegime;
      if (currentRegime) {
        const prevRegime = TELEGRAM_LAST_REGIME.get(symbol);
        if (prevRegime && prevRegime !== currentRegime) {
          const spot = m?.spot != null ? m.spot.toFixed(2) : "‚Äî";
          await sendAlertSpaced(
            `üìä <b>REGIME SHIFT ‚Äî ${symbol}</b>\n${prevRegime} ‚Üí ${currentRegime}\nSpot: ${spot}\nTime: ${istTime()}`,
            symbol
          );
        }
        TELEGRAM_LAST_REGIME.set(symbol, currentRegime);
      }
    } catch (err) {
      console.error(`[Telegram] M10 check failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }

    // --- M11: High-confidence evidence alert (readiness=COMPLETE, no conflicts) ---
    try {
      const m11 = await buildV2EvidenceFusion(symbol, session, 20);
      const readiness = (m11 as any)?.readiness;
      const conflictCount = (m11 as any)?.conflictCount ?? -1;
      const isHighConfidence = readiness === "EVIDENCE_MATRIX_COMPLETE" && conflictCount === 0;
      const fingerprint = `${readiness}|${conflictCount}`;
      const prevFingerprint = TELEGRAM_LAST_M11_FINGERPRINT.get(symbol);
      if (isHighConfidence && fingerprint !== prevFingerprint) {
        await sendAlertSpaced(
          `üìà <b>HIGH-CONVICTION EVIDENCE ‚Äî ${symbol}</b>\nReadiness: EVIDENCE_MATRIX_COMPLETE | Conflicts: 0\n\n‚ö†Ô∏è Evidence/research summary ‚Äî not an auto-trade signal. Check TradeLab card for full detail.\nTime: ${istTime()}`,
          symbol
        );
      }
      TELEGRAM_LAST_M11_FINGERPRINT.set(symbol, fingerprint);
    } catch (err) {
      console.error(`[Telegram] M11 check failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }

    // --- M12: Unvalidated research candidate + Buy/Sell probability alert ---
    // NOTE: buildV2CandidateSelection() is now called ONCE per symbol per
    // cycle and shared by both the M12 "research candidate" alert and the
    // buy/sell probability alert below. The original called it twice (once
    // per alert block) -- same symbol, same session, same maxSnapshots=20 --
    // which doubled the Kite calls this function makes (buildV2RealizedVsImplied
    // is awaited inside it) for no reason. Calling it once and reusing the
    // result removes that duplicate cost.
    try {
      const m12 = await buildV2CandidateSelection(symbol, session, 20);
      const decision = (m12 as any)?.decision;
      const structure = (m12 as any)?.structureEngine as OptionBuyingStructureResult | undefined;
      if (structure?.signal === "NO TRADE") {
        const blockedGateNames = structure.gates.filter((gate) => gate.blocking).map((gate) => gate.name).slice(0, 4);
        const structureFingerprint = `NO_TRADE|${blockedGateNames.join("|")}`;
        if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint) {
          const reason = structure.hardBlockReasons[0] || "No validated option-buying setup is available.";
          await sendAlertSpaced(
            `‚õî <b>${telegramEscapeHtml(symbol)} | NO TRADE</b>\n` +
            `Reason: ${telegramEscapeHtml(reason)}\n` +
            `‚è∞ ${istTime()} | Manual review only.`,
            symbol
          );
          TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, structureFingerprint);
        }
      }

      // --- M12a: existing "unvalidated research candidate" alert (unchanged behavior) ---
      if (decision === "BEST_CE" || decision === "BEST_PE") {
        const fingerprint = v2CandidateFingerprint(m12);
        const prevFingerprint = TELEGRAM_LAST_M12_FINGERPRINT.get(symbol);
        if (fingerprint !== prevFingerprint) {
          const cand = (m12 as any)?.selectedCandidate;
          const strike = cand?.strike ?? "‚Äî";
          const role = cand?.moneynessRole ?? "";
          const premium = cand?.lastPrice != null ? `‚Çπ${cand.lastPrice}` : "‚Äî";
          await sendAlertSpaced(
            `‚ö†Ô∏è <b>UNVALIDATED RESEARCH SIGNAL ‚Äî ${symbol}</b>\n${decision} ‚Äî Strike ${strike} (${role})\nCurrent premium: ${premium}\n\nThis is NOT a validated trade recommendation. Verify independently before acting.\nTime: ${istTime()}`,
            symbol
          );
        }
        TELEGRAM_LAST_M12_FINGERPRINT.set(symbol, fingerprint);
      } else {
        TELEGRAM_LAST_M12_FINGERPRINT.set(symbol, `${decision}`);
      }

      // --- M12b: Buy/Sell probability alert ---
      // "BUY" = market showing buying pressure -> BEST_CE (buy a call).
      // "SELL" = market showing selling pressure -> BEST_PE (buy a put).
      // Neither label means writing/shorting an option -- both are
      // directional "buy an option" calls, per the user's own vocabulary.
      //
      // PRODUCTION-DATA-ONLY GATE: only fires when the selected candidate's
      // reviewStatus is REVIEWABLE_DATA (full data quality -- see
      // v2CandidateStatus / filterForBuyContext). PARTIAL_DATA or
      // BLOCKED_DATA candidates never reach this alert, regardless of score.
      const cand = (m12 as any)?.selectedCandidate;
      const dataIsProduction = cand?.reviewStatus === "REVIEWABLE_DATA";

      // `m` narrows to IndexMetrics (not | undefined) inside this branch via
      // the `&& m` check ‚Äî filterForBuyContext/calculateBuyProbability both
      // require a real IndexMetrics, not the optional session.marketSnapshot lookup.
      if ((decision === "BEST_CE" || decision === "BEST_PE") && dataIsProduction && m) {
        const currentExpiry = v2CurrentExpiry(m);
        const dte = currentExpiry ? (v2ExpiryDte(currentExpiry.expiryDate) ?? 0) : 0;
        const buyFilter = filterForBuyContext(cand, m, dte);

        if (buyFilter.verdict === "PASS") {
          const m1 = buildV2PremiumCompositionHistory(symbol, 20);
          const m2 = buildV2IvSkewHistory(symbol, 20);
          const m3 = buildV2IvTermStructure(symbol, m);
          const m5 = await buildV2RealizedVsImplied(symbol, session);
          const m6 = buildV2PremiumAttribution(symbol, 20);
          const m7 = buildV2OiPositioningEvidence(symbol, 20);
          const m10 = buildV2MarketBehaviourRegime(symbol, session, m);

          // Advanced Greeks -- only computed when we have everything
          // calcAdvancedGreeks() genuinely needs (real spot, real strike, a
          // live IV, and a real DTE). If any input is missing this stays
          // null and the score falls back to the base factors only.
          const advancedGreeks =
            m?.spot != null && cand.strike != null && cand.iv != null && dte >= 0
              ? calcAdvancedGreeks(m.spot, cand.strike, cand.iv, dte, decision === "BEST_CE")
              : null;

          // Futures OI Buildup (2026-08-19 addition) -- compare against the
          // PREVIOUS cycle's cached value BEFORE overwriting it, then store
          // this cycle's value for next time. futuresContracts[0] is the
          // Near-month contract, same one used everywhere else in this file.
          const futContract = m.futuresContracts && m.futuresContracts[0];
          const futNow = futContract && futContract.ltp > 0 && futContract.oi != null
            ? { ltp: futContract.ltp, oi: futContract.oi }
            : null;
          const futPrev = TELEGRAM_PREV_FUTURES_OI.get(symbol);
          const futuresOiBuildup = classifyFuturesOiBuildup(futPrev, futNow);
          if (futNow) TELEGRAM_PREV_FUTURES_OI.set(symbol, futNow);

          const prob = calculateBuyProbability({
            candidate: cand,
            symbol,
            marketSnapshot: m,
            m1, m2, m3, m5, m6, m7, m10,
            dte,
            advancedGreeks,
            futuresOiBuildup,
          });

          // Coarse fingerprint on purpose: decision + grade only. The raw
          // probability recomputes from live data every cycle and will
          // almost never repeat exactly, so including it here would
          // re-alert on nearly every poll. Grade buckets (A+/A/B/C/D/F)
          // change far less often, which is what dedup is actually for.
          const fingerprint = `${decision}|${structure?.signal || "UNVERIFIED"}|${prob.grade}`;
          const prevFingerprint = TELEGRAM_LAST_BUY_FINGERPRINT.get(symbol);

          if (prob.probability >= 70 && fingerprint !== prevFingerprint) {
            const label = structure?.signal || (decision === "BEST_CE" ? "BUY CE" : "BUY PE");
            const strike = cand?.strike ?? "‚Äî";
            const role = cand?.moneynessRole ?? "";
            const premium = cand?.lastPrice != null ? `‚Çπ${cand.lastPrice}` : "‚Äî";
            const emoji = prob.probability >= 85 ? "üü¢" : prob.probability >= 75 ? "üü°" : "üü†";
            // 2026-08-19 "check now" fix: originally capped at 7 (widened
            // from the prior 4), but a fresh re-check found that cap could
            // silently crowd out exactly the reasons this round was meant
            // to add. A strong signal is precisely when Delta + IV + RV/IV
            // + OI trend + Regime + DTE bonus + Volume + Spread + PCR can
            // ALL fire together -- that alone can fill 7+ slots before ever
            // reaching the new Term Structure / VIX / Futures OI Buildup
            // reasons below them, so the newest enrichment would routinely
            // never be visible in the exact messages it was built for.
            // Uncapped now that telegramSplitMessageSafely() (this same
            // round) safely handles any resulting message length -- no
            // silent truncation of computed evidence.
            // 2026-08-21 clarity fix, per user request ("make clear candidate
            // selection ... when my criteria meet"): every reasons.push() in
            // calculateBuyProbability() is consistently prefixed either "‚úÖ"
            // (a criterion that actually PASSED and added to the score) or
            // "‚ÑπÔ∏è" (informational-only context -- Term Structure/VIX/Advanced
            // Greeks summary -- that never affects the score, by this
            // function's own documented design). The old message dumped both
            // under one "‚úÖ Reasons:" header, which visually implied every
            // line was a criterion that passed and contributed to the score
            // -- not true for the ‚ÑπÔ∏è lines. Split here into two sections plus
            // an at-a-glance criteria-met count, using ONLY string filtering
            // on the existing computed data -- zero change to the scoring
            // engine itself, so the probability/grade this message reports
            // is exactly the same as before.
            const scoreReasons = prob.reasons.filter((r) => r.startsWith("‚úÖ"));
            const contextNotes = prob.reasons.filter((r) => r.startsWith("‚ÑπÔ∏è"));

            // Provisional Trade Management Plan (2026-08-21) -- Entry/SL/T1/T2/
            // Trailing. See computeProvisionalTradeManagementPlan's own doc
            // comment for the full method disclosure.
            // K-TM1 (2026-08-21, FULL_MIGRATION_TO_KITE_ONLY): switched from
            // dhanFetchDailyLevels() to v2FetchDailyLevelsKite() -- same
            // once-per-day cache pattern, same ATR(14)/PDH/PDL/PDC
            // semantics, now Kite-sourced instead of Dhan-sourced (this was
            // the LAST production dependency on Dhan for all 3 symbols,
            // per the K1 audit). No silent Dhan fallback: on any Kite
            // failure this returns status !== "OK" and the Telegram
            // message below already shows "UNAVAILABLE" with no numbers
            // fabricated, exactly as it did for a Dhan failure before.
            let tmPlan: ProvisionalTradeManagementPlan | null = null;
            try {
              const dailyLevels = await v2FetchDailyLevelsKite(symbol, session.accessToken);
              tmPlan = computeProvisionalTradeManagementPlan(
                decision === "BEST_CE" ? "CE" : "PE",
                cand?.lastPrice ?? null,
                cand?.delta ?? null,
                dailyLevels.atr14 ?? null
              );
            } catch (err) {
              console.error(`[Telegram] M12b trade-management plan failed for ${symbol}:`, err instanceof Error ? err.message : err);
            }
            const lotSize = cand?.contractMetadata?.lotSize;
            const estimatedLotLoss = tmPlan?.status === "OK" && tmPlan.rPremium != null && Number.isFinite(lotSize) && lotSize > 0
              ? Number((tmPlan.rPremium * lotSize).toFixed(2))
              : null;
            if (!tmPlan || tmPlan.status !== "OK" || estimatedLotLoss == null || (structure && estimatedLotLoss > structure.risk.maxLoss)) {
              const reason = estimatedLotLoss == null
                ? "A complete ATR/Delta stop and verified lot size are required before any buying alert."
                : `One-lot planned loss ‚Çπ${estimatedLotLoss} exceeds the configured maximum ‚Çπ${structure?.risk.maxLoss}.`;
              const riskFingerprint = `NO_TRADE_RISK|${reason}`;
              if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== riskFingerprint) {
                await sendAlertSpaced(
                  `‚õî <b>${telegramEscapeHtml(symbol)} | NO TRADE</b>\n` +
                  `Reason: ${telegramEscapeHtml(reason)}\n` +
                  `‚è∞ ${istTime()} | Manual review only.`,
                  symbol
                );
                TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, riskFingerprint);
              }
              continue;
            }
            // Spend Haiku tokens only after every structure, liquidity and
            // one-lot risk gate has passed. Reuse the dashboard explanation
            // cache so the same setup never spends tokens twice in 15 minutes.
            let haikuWhy: string | null = null;
            try {
              const cacheKey = `OPTION_BUYING_STRUCTURE:${symbol}`;
              const cached = haikuCache.get(cacheKey);
              if (cached && cached.verdict === label && Date.now() - cached.calledAt < HAIKU_COST_GUARD_MS) {
                haikuWhy = cached.explanation;
              } else {
                const haikuPrompt =
                  `Explain ${label} ${symbol} ${strike} (${role}) in one short Odia sentence; keep trading terms in English. ` +
                  `Facts: ${(structure?.explanationPacket.observations || []).slice(0, 3).join(" ")} ` +
                  `Do not change the signal or invent data, probability, targets, or automatic orders.`;
                haikuWhy = await callHaikuPlain(haikuPrompt);
                if (haikuWhy) haikuCache.set(cacheKey, { verdict: label, explanation: haikuWhy, calledAt: Date.now() });
              }
            } catch (err) {
              console.error(`[Telegram] M12b Haiku why-explanation failed for ${symbol}:`, err instanceof Error ? err.message : err);
            }
            const compactEvidence: string[] = [];
            if (structure?.evidenceGroups.priceStructure) compactEvidence.push("Price/VWAP confirmed");
            if (structure?.evidenceGroups.premiumBehaviour) compactEvidence.push(`${structure.side} premium strong`);
            if (structure?.premiums.next?.alignment === "SUPPORTIVE") compactEvidence.push("next expiry confirms");
            else if (structure?.evidenceGroups.pcrOi) compactEvidence.push("PCR/OI agrees");
            const compactWhy = haikuWhy || compactEvidence.slice(0, 3).join("; ") || "Validated price, premium, and risk structure.";

            await sendAlertSpaced(
              `${emoji} <b>${telegramEscapeHtml(symbol)} | ${telegramEscapeHtml(label)}</b>\n` +
              `üìä ${telegramEscapeHtml(String(strike))} ${telegramEscapeHtml(structure?.side || "")} | Premium ${telegramEscapeHtml(premium)} | ${structure?.dte ?? dte} DTE\n` +
              `üéØ Entry ‚Çπ${tmPlan.entry} | SL ‚Çπ${tmPlan.sl} | T1 ‚Çπ${tmPlan.t1} | T2 ‚Çπ${tmPlan.t2}\n` +
              `üõ° Risk ‚Çπ${estimatedLotLoss} / max ‚Çπ${structure?.risk.maxLoss ?? "‚Äî"}\n` +
              `üí° Why: ${telegramEscapeHtml(compactWhy)}\n` +
              `‚è∞ ${istTime()} | Manual review only; forward-test only.`,
              symbol
            );
            TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, `${label}|${structure?.side || "NONE"}`);

            // Forward-test recording -- TM_V1 (2026-08-21). Pushes this plan
            // into the EXISTING outcome-engine (outcome-engine.ts, built
            // 2026-08-08, already scheduled for evaluation every 60s via
            // runOutcomeEvaluationCycle). This is what turns "forward test and
            // save data" into a real accumulating record, visible at
            // /api/outcome/stats, without waiting for a historical backtest --
            // the user's own explicit choice. Only recorded when the plan has
            // real SL/T1/T2 numbers (status "OK") -- an UNAVAILABLE plan has
            // nothing determinate to evaluate and would only add
            // INCOMPLETE_NO_ENTRY_DATA noise.
            //
            // TM_V1 upgrade (per user-supplied "Forward-Only Validation Plan"
            // spec): records 4 PARALLEL observation horizons (30m/60m/90m/EOD)
            // for the SAME frozen entry/sl/t1/t2, sharing one planId so they
            // can be grouped back together on review -- these are independent
            // observation windows, not 4 different trade plans. Each also
            // carries the clamp-audit (raw vs clamped risk distance, which
            // bound fired), delta provenance (live quote vs the 0.5 fallback),
            // and context tags (market regime, expiry type, signal type) the
            // spec asked for, all as pure pass-through -- the outcome-engine
            // itself still computes nothing about ATR/Delta/regime, per its
            // own "self-contained" hard rule.
            if (tmPlan && tmPlan.status === "OK") {
              // Hoisted out of the try block below (2026-08-21) so the
              // premium-only live-tracking block after it can reuse the
              // SAME planId even if the outcome-record push itself fails
              // partway through -- the two are independent best-effort
              // features and one's failure must not silently break the
              // other's scope.
              const planId = `tm1-${Date.now()}-${randomBytes(3).toString("hex")}`;
              try {
                const marketRegime = m10?.regime?.pressure ?? null;
                const expiryType = (cand as any)?.contractMetadata?.expiryBucket ?? (dte <= 7 ? "WEEKLY" : "MONTHLY_OR_FAR");
                const horizons: Array<{ horizon: OutcomeHorizon; windowMinutes: number }> = [
                  { horizon: "30m", windowMinutes: 30 },
                  { horizon: "60m", windowMinutes: 60 },
                  { horizon: "90m", windowMinutes: 90 },
                  { horizon: "EOD", windowMinutes: eodWindowMinutes(Date.now()) },
                ];
                for (const h of horizons) {
                  const outcomeRecord = createOutcomeRecord({
                    symbol: symbol as OutcomeIndexSymbol,
                    tradingDate: recorderSession.tradingDate || indiaTradingDate(),
                    verdict: `${label}_${prob.grade}`,
                    score: prob.probability,
                    maxScore: 100,
                    confidence: prob.confidence,
                    side: (decision === "BEST_CE" ? "CE" : "PE") as OutcomeSide,
                    strike: typeof cand?.strike === "number" ? cand.strike : null,
                    entry: tmPlan.entry,
                    sl: tmPlan.sl,
                    t1: tmPlan.t1,
                    t2: tmPlan.t2,
                    t3: tmPlan.t3,
                    signalContributions: null,
                    windowMinutes: h.windowMinutes,
                    nowMs: Date.now(),
                    idSuffix: `${randomBytes(3).toString("hex")}-${h.horizon}`,
                    planId,
                    horizon: h.horizon,
                    rawRiskDistance: tmPlan.rawRiskDistance,
                    clampedRiskDistance: tmPlan.clampedRiskDistance,
                    clampApplied: tmPlan.clampApplied as OutcomeClampApplied | null,
                    deltaSource: tmPlan.deltaSource as OutcomeDeltaSource | null,
                    marketRegime,
                    expiryType,
                    signalType: "M12b",
                  });
                  outcomeRecords.push(outcomeRecord);
                  if (outcomeRecords.length > OUTCOME_MAX_RECORDS) {
                    const nonPendingIdx = outcomeRecords.findIndex((r) => r.status !== "PENDING");
                    outcomeRecords.splice(nonPendingIdx === -1 ? 0 : nonPendingIdx, 1);
                  }
                }
              } catch (err) {
                console.error(`[Telegram] M12b outcome-record push failed for ${symbol}:`, err instanceof Error ? err.message : err);
              }

              // "Premium-only" live-tracking group (2026-08-21, explicit user
              // request). Reuses the SAME planId as the 4 outcome-engine
              // records just pushed above -- runPremiumOnlyLiveUpdateCycle
              // reads those records to decide when/how to edit this message,
              // no separate evaluation logic. Fire-and-forget: a failure here
              // must never block the main alert or the outcome-engine push,
              // both of which already succeeded above.
              try {
                const tracker: PremiumOnlyLiveTracker = {
                  planId,
                  messageId: 0,
                  symbol: symbol as V2PremiumSymbol,
                  side: decision === "BEST_CE" ? "CE" : "PE",
                  strike: typeof cand?.strike === "number" ? cand.strike : null,
                  entry: tmPlan.entry,
                  sl: tmPlan.sl,
                  t1: tmPlan.t1,
                  t2: tmPlan.t2,
                  t3: tmPlan.t3,
                  createdAtMs: Date.now(),
                  resolved: false,
                  // Trade Card Composer V1 snapshot -- frozen at creation
                  // from the SAME prob/tmPlan/advancedGreeks values just
                  // computed above for the per-symbol M12b alert. See the
                  // interface's own comment for why this must be captured
                  // now rather than re-derived later.
                  cardSnapshot: {
                    moneynessRole: cand?.moneynessRole ?? null,
                    probability: prob.probability,
                    grade: prob.grade,
                    confidence: prob.confidence,
                    scoreReasons,
                    contextNotes,
                    riskFlags: prob.riskFlags,
                    tmRPremium: tmPlan.rPremium,
                    tmAtrUnderlying: tmPlan.atrUnderlying,
                    tmDeltaUsed: tmPlan.deltaUsed,
                    tmTrailingRule: tmPlan.trailingRule,
                    advancedGreeks: advancedGreeks
                      ? {
                          delta: advancedGreeks.delta,
                          gamma: advancedGreeks.gamma,
                          theta: advancedGreeks.theta,
                          vega: advancedGreeks.vega,
                          intrinsicValue: advancedGreeks.intrinsicValue,
                          extrinsicValue: advancedGreeks.extrinsicValue,
                        }
                      : null,
                    futuresOiBuildup: futuresOiBuildup ?? null,
                    marketRegime: m10?.regime?.pressure ?? null,
                    compactSignal: label,
                    compactDte: structure?.dte ?? dte,
                    compactLotRisk: estimatedLotLoss,
                    compactMaxRisk: structure?.risk.maxLoss ?? null,
                    compactWhy,
                  },
                };
                const initialText = buildPremiumOnlyTradeCardText(tracker, null);
                const messageId = await sendTelegramPremiumOnlyMessage(initialText);
                if (messageId != null) {
                  tracker.messageId = messageId;
                  premiumOnlyLiveTrackers.push(tracker);
                  if (premiumOnlyLiveTrackers.length > PREMIUM_ONLY_MAX_TRACKERS) {
                    const resolvedIdx = premiumOnlyLiveTrackers.findIndex((x) => x.resolved);
                    premiumOnlyLiveTrackers.splice(resolvedIdx === -1 ? 0 : resolvedIdx, 1);
                  }
                }
              } catch (err) {
                console.error(`[Telegram] premium-only tracker creation failed for ${symbol}:`, err instanceof Error ? err.message : err);
              }
            }

            TELEGRAM_LAST_BUY_FINGERPRINT.set(symbol, fingerprint);
          }
        } else {
          TELEGRAM_LAST_BUY_FINGERPRINT.set(symbol, "FILTER_BLOCKED");
        }
      } else {
        TELEGRAM_LAST_BUY_FINGERPRINT.set(symbol, "NO_SIGNAL");
      }
    } catch (err) {
      console.error(`[Telegram] M12 check failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }
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

// Telegram Market Snapshot fast cycle (2026-08-18, user-requested): a
// genuinely separate 1-minute cadence from the Recorder's 3-min cycle
// above, gated the same way (market hours only). This does a REAL extra
// Kite fetch per symbol per minute (fetchTelegramFastPcrSnapshot) --
// explicitly a deliberate cost tradeoff the user chose (fresh PCR/premium/
// OI every minute) over reusing the 3-min snapshot as-is. If TELEGRAM_SLOW_CACHE
// hasn't been populated yet (first 3-min cycle hasn't run), this silently
// no-ops per symbol (buildTelegramMarketSnapshotMessage returns null).
// 2026-08-18 follow-up (user-confirmed fix): none of the Telegram
// direction/pct-change trackers reset at day boundaries, including the
// pre-existing TELEGRAM_LAST_REGIME tracker (not introduced this
// session). On a server that stays up overnight (no redeploy), the first
// comparison of a new trading day would silently diff against the
// previous day's last value -- e.g. a 15-min summary at 09:15 comparing
// against yesterday's 15:29 snapshot, producing a meaningless "overnight
// change". Reset once per trading day, checked on every tick of this
// same 15s interval (cheap: just a string compare) so it fires as soon
// as the IST date rolls over, regardless of market-hours gating below.
let lastTelegramTrackerResetDate = "";
function resetTelegramDailyTrackers(): void {
  TELEGRAM_DOT_LAST_VALUE.clear();
  TELEGRAM_FAST_LAST_FULLCHAIN_PCR.clear();
  TELEGRAM_FAST_LAST_OI_PCR.clear();
  TELEGRAM_FAST_LAST_IE3.clear();
  TELEGRAM_PERIODIC_SNAPSHOT_15.clear();
  TELEGRAM_PERIODIC_SNAPSHOT_30.clear();
  TELEGRAM_PERIODIC_SNAPSHOT_60.clear();
  TELEGRAM_LAST_REGIME.clear();
  TELEGRAM_LAST_STRUCTURE_FINGERPRINT.clear();
  // 2026-08-19 bug fix (found during a self-initiated re-check, not
  // user-reported): TELEGRAM_PREV_DAY_HIGH (added for the Opposite-Premium
  // Higher-High caution) was never being cleared here. Without this, the
  // very first comparison on a new trading day would be against the
  // PREVIOUS day's closing dayHigh value for that expiry label, silently
  // suppressing legitimate "fresh high" triggers for a portion of the day
  // (since today's early dayHigh values start low and take time to exceed
  // yesterday's close). Cleared here so every day starts with no prior
  // reference, matching how all the other per-day trackers above behave.
  TELEGRAM_PREV_DAY_HIGH.clear();
  // 2026-08-19: safety net for the EOD summary (feature ‚ë£) -- normally
  // cleared by runTelegramEodSummary() itself right after sending, but if
  // that trigger were ever missed on a given day (e.g. server restart
  // during the 15:31+ window), this guarantees yesterday's events never
  // leak into tomorrow's summary.
  TELEGRAM_DAILY_EVENTS.clear();
  // 2026-08-19: TELEGRAM_PREV_FUTURES_OI (new, for the M12b Futures OI
  // Buildup enrichment) -- same reasoning as TELEGRAM_PREV_DAY_HIGH above:
  // without a daily clear, the first buildup classification of a new
  // trading day would compare against yesterday's closing futures OI/LTP,
  // producing a misleading buildup/unwinding label. Cleared here so day 1
  // always starts with "INSUFFICIENT_DATA" (no false first-tick signal).
  TELEGRAM_PREV_FUTURES_OI.clear();
  console.log("[Telegram] daily tracker reset for new trading day");
}

let lastTelegramFastMinute = -1;
setInterval(() => {
  const today = indiaTradingDate();
  if (today !== lastTelegramTrackerResetDate) {
    lastTelegramTrackerResetDate = today;
    resetTelegramDailyTrackers();
  }
  if (!isMarketOpenNowServer()) return;
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  if (minutesSinceMidnight === lastTelegramFastMinute) return; // already ran this minute
  lastTelegramFastMinute = minutesSinceMidnight;
  void runTelegramFastCycle().catch((err) =>
    console.error("[Telegram Fast] cycle error:", err instanceof Error ? err.message : err)
  );
}, 15 * 1000); // check every 15s so we don't miss the 1-min boundary

// 2026-08-18: 15/30/60-min periodic "what changed / what didn't" summary.
// Each tag has its own independent last-fired-minute guard, so at hour
// boundaries (e.g. 12:00 IST) all 3 tags can fire together in one pass --
// that's expected, not a bug. Zero extra Kite calls (see
// runTelegramPeriodicSummaryCycle above).
let lastTelegram15Minute = -1;
let lastTelegram30Minute = -1;
let lastTelegram60Minute = -1;
setInterval(() => {
  if (!isMarketOpenNowServer()) return;
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  const tags: TelegramPeriodicTag[] = [];
  if (minutesSinceMidnight % 15 === 0 && minutesSinceMidnight !== lastTelegram15Minute) {
    lastTelegram15Minute = minutesSinceMidnight;
    tags.push("15MIN");
  }
  if (minutesSinceMidnight % 30 === 0 && minutesSinceMidnight !== lastTelegram30Minute) {
    lastTelegram30Minute = minutesSinceMidnight;
    tags.push("30MIN");
  }
  if (minutesSinceMidnight % 60 === 0 && minutesSinceMidnight !== lastTelegram60Minute) {
    lastTelegram60Minute = minutesSinceMidnight;
    tags.push("60MIN");
  }
  if (tags.length === 0) return;
  void runTelegramPeriodicSummaryCycle(tags).catch((err) =>
    console.error("[Telegram Periodic] cycle error:", err instanceof Error ? err.message : err)
  );
}, 20 * 1000); // check every 20s so we don't miss any of the 15/30/60-min boundaries

// 2026-08-19: EOD (End-of-Day) Haiku summary, per user request (feature ‚ë£).
// Fires ONCE per trading day, shortly after market close, summarizing the
// day's PDL-Broken/O‚âàH and Opposite-Premium Caution events (recorded via
// recordDailyEvent() inside buildTelegramMarketSnapshotMessage) into one
// short plain-language paragraph per symbol. Weekday-only by construction
// (isMarketOpenNowServer() already excludes weekends, and this only ever
// fires once isMarketOpenNowServer() has gone from true to false for the
// day -- it does NOT independently re-check the day-of-week).
async function runTelegramEodSummary(): Promise<void> {
  const symbols: V2PremiumSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
  let isFirstSend = true;
  for (const symbol of symbols) {
    try {
      const events = TELEGRAM_DAILY_EVENTS.get(symbol) || [];
      if (events.length === 0) continue; // quiet day for this symbol -- no message, no Haiku call, per the earlier "skip when nothing changed" recommendation
      const eventLines = events.map((e) => `${e.time}: ${e.text}`).join("\n");
      const prompt =
        `Here are today's PDL-Broken and Opposite-Premium Caution events for ${symbol}, in order:\n${eventLines}\n\n` +
        `Summarize this in 2-3 short sentences for a retail options trader reviewing their day, plain language, on Telegram. ` +
        `Only describe what happened and any pattern in the events above -- do NOT suggest a trade, do NOT say buy/sell, do NOT invent data not given above.`;
      const summary = await callHaikuPlain(prompt);
      if (summary) {
        if (!isFirstSend) await new Promise((resolve) => setTimeout(resolve, 1100));
        isFirstSend = false;
        // telegramEscapeHtml() mandatory -- see its own comment for why.
        await sendTelegramAlert(`üìã <b>${symbol} ‚Äî End of Day Summary</b>\n${telegramEscapeHtml(summary)}\n\n<i>${events.length} event(s) today</i>`, symbol);
      }
    } catch (err) {
      console.error(`[Telegram EOD Summary] failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }
  // Clear immediately after summarizing so a missed/late reset doesn't
  // double-count today's events into tomorrow's summary.
  TELEGRAM_DAILY_EVENTS.clear();
}

setInterval(() => {
  const today = indiaTradingDate();
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const day = ist.getDay();
  if (day === 0 || day === 6) return; // weekend -- no EOD summary
  const minutesSinceMidnight = ist.getHours() * 60 + ist.getMinutes();
  // Fires once, 1 minute after market close (15:30 IST) -- late enough that
  // the last 1-min fast cycle of the day has already run and recorded its
  // events, early enough that it's still clearly "end of day" for the user.
  if (minutesSinceMidnight < 15 * 60 + 31) return;
  if (telegramEodSummarySentDate === today) return; // already sent today
  telegramEodSummarySentDate = today;
  void runTelegramEodSummary().catch((err) =>
    console.error("[Telegram EOD Summary] cycle error:", err instanceof Error ? err.message : err)
  );
}, 30 * 1000); // check every 30s -- this only needs to catch a single 1-min window once a day, no tighter cadence needed


// In-memory instruments cache (fetched once per app startup)
let instrumentsCache: Instrument[] = [];
let instrumentsCacheTime = 0;
let instrumentsCachePromise: Promise<Instrument[]> | null = null;
const INSTRUMENTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours


// ============================================================================
// V2 MODULE 5 ‚Äî REALIZED vs IMPLIED VOLATILITY ENGINE
// Observation-only, additive diagnostic.
//
// Realized volatility (RV) is computed from the underlying INDEX daily close
// series using close-to-close log returns and annualized with sqrt(252).
// Implied volatility (IV) is the CURRENT EXPIRY ATM CE/PE mean IV already
// model-computed by calcImpliedVolatility() from option LTP; it is NOT a
// Kite-published IV field.
//
// Load-safety / truth boundaries:
// - Historical daily candles are fetched ON DEMAND by this diagnostic endpoint,
//   at most once per symbol per India trading date, then cached in memory.
// - This module is NOT wired into the 3-minute recorder/background refresh.
// - No runRuleEngine()/score/verdict changes.
// - No AI/Haiku/GPT calls.
// - No Recorder mutation.
// - IV-vs-RV is volatility-pricing context only; it never maps directly to
//   CE/PE, bullish/bearish, BUY/SELL.
// ============================================================================

type V2RvIvState = "IV_PREMIUM_TO_REALIZED" | "IV_NEAR_REALIZED" | "REALIZED_ABOVE_IV" | "INSUFFICIENT_DATA";
type V2RvTrend = "EXPANDING" | "CONTRACTING" | "MIXED" | "STABLE" | "INSUFFICIENT_DATA";

interface V2RvHistoryMetrics {
  tradingDate: string;
  symbol: V2PremiumSymbol;
  historyFrom: string;
  historyTo: string;
  closesUsed: number;
  rv5d: number | null;
  rv10d: number | null;
  rv20d: number | null;
  rvTrend: V2RvTrend;
  historicalFetchStatus: "OK" | "INSUFFICIENT" | "ERROR";
}

interface V2RvIvResult extends V2RvHistoryMetrics {
  generatedAt: string;
  atmStrike: number | null;
  atmCeIv: number | null;
  atmPeIv: number | null;
  atmMeanIv: number | null;
  ivSource: "MODEL_COMPUTED_FROM_OPTION_LTP_NOT_KITE_PUBLISHED_IV";
  ivMinusRv20: number | null;
  ivToRv20Ratio: number | null;
  state: V2RvIvState;
  dataQuality: V2DataQuality;
  directionalBias: "NONE";
  scoringImpact: "NONE";
  source: string;
  interpretationGuard: string;
}

const v2RvDailyCache = new Map<V2PremiumSymbol, V2RvHistoryMetrics>();
const v2RvDailyPromise = new Map<V2PremiumSymbol, Promise<V2RvHistoryMetrics>>();

function v2AnnualizedRealizedVol(closes: number[], window: number): number | null {
  const clean = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length < window + 1) return null;
  const slice = clean.slice(-(window + 1));
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) returns.push(Math.log(slice[i] / slice[i - 1]));
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  if (!Number.isFinite(variance) || variance < 0) return null;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function v2ClassifyRvTrend(rv5: number | null, rv10: number | null, rv20: number | null): V2RvTrend {
  if (rv5 == null || rv10 == null || rv20 == null) return "INSUFFICIENT_DATA";
  const eps = 0.10; // 0.10 volatility-point tolerance; descriptive only.
  if (rv5 > rv10 + eps && rv10 > rv20 + eps) return "EXPANDING";
  if (rv5 + eps < rv10 && rv10 + eps < rv20) return "CONTRACTING";
  if (Math.abs(rv5 - rv10) <= eps && Math.abs(rv10 - rv20) <= eps) return "STABLE";
  return "MIXED";
}

function v2IndexHistoryLookup(symbol: V2PremiumSymbol): { exchange: string; tradingsymbol: string } {
  if (symbol === "SENSEX") return { exchange: "BSE", tradingsymbol: "SENSEX" };
  if (symbol === "BANKNIFTY") return { exchange: "NSE", tradingsymbol: "NIFTY BANK" };
  return { exchange: "NSE", tradingsymbol: "NIFTY 50" };
}

async function v2LoadRvHistoryOncePerDay(
  symbol: V2PremiumSymbol,
  accessToken: string
): Promise<V2RvHistoryMetrics> {
  const tradingDate = indiaDate();
  const cached = v2RvDailyCache.get(symbol);
  if (cached && cached.tradingDate === tradingDate) return cached;
  const pending = v2RvDailyPromise.get(symbol);
  if (pending) return pending;

  const promise = (async (): Promise<V2RvHistoryMetrics> => {
    // 60 calendar days gives comfortable headroom for 21+ trading closes
    // through weekends/holidays without requesting a large historical range.
    const historyFrom = indiaDate(-60);
    const historyTo = tradingDate;
    const fallback: V2RvHistoryMetrics = {
      tradingDate, symbol, historyFrom, historyTo, closesUsed: 0,
      rv5d: null, rv10d: null, rv20d: null, rvTrend: "INSUFFICIENT_DATA",
      historicalFetchStatus: "ERROR",
    };
    try {
      const instruments = await fetchInstruments(accessToken);
      if (instruments.length === 0) return fallback;
      const lookup = v2IndexHistoryLookup(symbol);
      const token = findIndexInstrumentToken(instruments, lookup.tradingsymbol, lookup.exchange);
      if (!token) return fallback;
      const candles = await fetchHistoricalDaily(accessToken, token, historyFrom, historyTo);
      const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0);
      const rv5d = v2AnnualizedRealizedVol(closes, 5);
      const rv10d = v2AnnualizedRealizedVol(closes, 10);
      const rv20d = v2AnnualizedRealizedVol(closes, 20);
      return {
        tradingDate, symbol, historyFrom, historyTo, closesUsed: closes.length,
        rv5d, rv10d, rv20d, rvTrend: v2ClassifyRvTrend(rv5d, rv10d, rv20d),
        historicalFetchStatus: rv20d != null ? "OK" : "INSUFFICIENT",
      };
    } catch (err) {
      console.error(`[V2 RV/IV] ${symbol} historical RV load failed:`, err instanceof Error ? err.message : err);
      return fallback;
    }
  })();

  v2RvDailyPromise.set(symbol, promise);
  try {
    const result = await promise;
    v2RvDailyCache.set(symbol, result); // cache failure too, preventing retry storms during the day
    return result;
  } finally {
    v2RvDailyPromise.delete(symbol);
  }
}

// K-TM1 (2026-08-21, FULL_MIGRATION_TO_KITE_ONLY) ‚Äî Kite-only equivalent of
// dhanFetchDailyLevels(), for TM_V1's ATR14/PDH/PDL/PDC. NOT new machinery:
// composed entirely from functions that already exist and are already
// live elsewhere in this file --
//   - fetchHistoricalDaily() -- the SAME Kite historical-candle fetch
//     v2LoadRvHistoryOncePerDay() (above) already uses for RV.
//   - v2IndexHistoryLookup() / findIndexInstrumentToken() -- the SAME
//     symbol -> Kite instrument-token resolution RV already uses.
//   - v2ComputeSimpleAtr() -- the SAME pure, provider-agnostic ATR(14)
//     function the Dhan path already uses (defined once, shared by both).
// Same 35-calendar-day window and "last completed candle" convention as
// the Dhan version, so PDH/PDL/PDC/ATR14 semantics are unchanged -- only
// the data source moves from Dhan to Kite. Cached once per calendar day
// per symbol, mirroring DHAN_DAILY_LEVELS_CACHE's own pattern. On any
// failure (no instruments, token not found, empty candle response, or a
// thrown error) returns status "INSUFFICIENT"/"FAIL" with all fields
// null -- NEVER falls back to Dhan (per the standing "no silent Dhan
// fallback" rule) and NEVER fabricates a number.
interface V2DailyLevelsKite {
  status: "OK" | "INSUFFICIENT" | "FAIL";
  pdcClose: number | null;
  pdh: number | null;
  pdl: number | null;
  atr14: number | null;
}
const V2_DAILY_LEVELS_KITE_CACHE = new Map<string, { dateKey: string; result: V2DailyLevelsKite }>();

async function v2FetchDailyLevelsKite(symbol: V2PremiumSymbol, accessToken: string): Promise<V2DailyLevelsKite> {
  const dateKey = indiaDate();
  const cached = V2_DAILY_LEVELS_KITE_CACHE.get(symbol);
  if (cached && cached.dateKey === dateKey) return cached.result;

  const fail = (status: "INSUFFICIENT" | "FAIL"): V2DailyLevelsKite => {
    const result: V2DailyLevelsKite = { status, pdcClose: null, pdh: null, pdl: null, atr14: null };
    V2_DAILY_LEVELS_KITE_CACHE.set(symbol, { dateKey, result });
    return result;
  };

  try {
    const instruments = await fetchInstruments(accessToken);
    if (instruments.length === 0) return fail("INSUFFICIENT");
    const lookup = v2IndexHistoryLookup(symbol);
    const token = findIndexInstrumentToken(instruments, lookup.tradingsymbol, lookup.exchange);
    if (!token) return fail("INSUFFICIENT");

    // Same 35-calendar-day window as the Dhan version -- comfortably covers
    // 15 completed daily candles (needed for ATR(14)) across a long
    // weekend/holiday cluster.
    const historyFrom = indiaDate(-35);
    const historyTo = indiaDate();
    const candles = await fetchHistoricalDaily(accessToken, token, historyFrom, historyTo);
    if (candles.length === 0) {
      console.error(`[KITE TM_V1 DAILY_LEVELS FAIL] symbol=${symbol} empty candle response`);
      return fail("FAIL");
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const lastIdx = candles.length - 1;
    const result: V2DailyLevelsKite = {
      status: "OK",
      pdcClose: typeof closes[lastIdx] === "number" ? closes[lastIdx] : null,
      pdh: typeof highs[lastIdx] === "number" ? highs[lastIdx] : null,
      pdl: typeof lows[lastIdx] === "number" ? lows[lastIdx] : null,
      atr14: v2ComputeSimpleAtr(closes, highs, lows, 14),
    };
    V2_DAILY_LEVELS_KITE_CACHE.set(symbol, { dateKey, result });
    return result;
  } catch (err) {
    console.error(`[KITE TM_V1 DAILY_LEVELS FAIL] symbol=${symbol} exception=${err instanceof Error ? err.message : "Unknown error"}`);
    return fail("FAIL");
  }
}

function v2CurrentAtmIv(m: IndexMetrics | undefined) {
  if (!m || m.error) return { atmStrike: null, atmCeIv: null, atmPeIv: null, atmMeanIv: null };
  const expiry = (m.expiries || []).find((e) => e.expiry === "Current Expiry") || (m.expiries || [])[0];
  if (!expiry) return { atmStrike: null, atmCeIv: null, atmPeIv: null, atmMeanIv: null };
  const atmCe = (expiry.ceStrikes || []).find((s) => s.isAtm);
  const atmPe = (expiry.peStrikes || []).find((s) => s.isAtm);
  const ceFresh = atmCe ? classifyTruthField(atmCe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options) : { verdict: "INVALID" as TruthVerdict };
  const peFresh = atmPe ? classifyTruthField(atmPe.quoteTimestamp, TRUTH_THRESHOLDS_MS.options) : { verdict: "INVALID" as TruthVerdict };
  const atmCeIv = ceFresh.verdict === "TRUE" ? v2FiniteIv(atmCe?.iv) : null;
  const atmPeIv = peFresh.verdict === "TRUE" ? v2FiniteIv(atmPe?.iv) : null;
  const ivs = [atmCeIv, atmPeIv].filter((v): v is number => v != null);
  return {
    atmStrike: atmCe?.strike ?? atmPe?.strike ?? null,
    atmCeIv,
    atmPeIv,
    atmMeanIv: ivs.length ? v2Average(ivs) : null,
  };
}

function v2ClassifyIvVsRv(atmIv: number | null, rv20: number | null): V2RvIvState {
  if (atmIv == null || rv20 == null || rv20 <= 0) return "INSUFFICIENT_DATA";
  // Relative band avoids arbitrary absolute IV-point cutoffs across indices/regimes.
  const ratio = atmIv / rv20;
  if (ratio > 1.10) return "IV_PREMIUM_TO_REALIZED";
  if (ratio < 0.90) return "REALIZED_ABOVE_IV";
  return "IV_NEAR_REALIZED";
}

async function buildV2RealizedVsImplied(
  symbol: V2PremiumSymbol,
  session: KiteSession
): Promise<V2RvIvResult> {
  const hist = await v2LoadRvHistoryOncePerDay(symbol, session.accessToken);
  const iv = v2CurrentAtmIv(session.marketSnapshot?.[symbol]);
  const state = v2ClassifyIvVsRv(iv.atmMeanIv, hist.rv20d);
  const ivMinusRv20 = iv.atmMeanIv != null && hist.rv20d != null ? iv.atmMeanIv - hist.rv20d : null;
  const ivToRv20Ratio = iv.atmMeanIv != null && hist.rv20d != null && hist.rv20d > 0 ? iv.atmMeanIv / hist.rv20d : null;
  const dataQuality: V2DataQuality =
    hist.historicalFetchStatus !== "OK" || iv.atmMeanIv == null ? "INSUFFICIENT" :
    iv.atmCeIv != null && iv.atmPeIv != null ? "OK" : "PARTIAL";

  return {
    ...hist,
    generatedAt: new Date().toISOString(),
    atmStrike: iv.atmStrike,
    atmCeIv: iv.atmCeIv,
    atmPeIv: iv.atmPeIv,
    atmMeanIv: iv.atmMeanIv,
    ivSource: "MODEL_COMPUTED_FROM_OPTION_LTP_NOT_KITE_PUBLISHED_IV",
    ivMinusRv20,
    ivToRv20Ratio,
    state,
    dataQuality,
    directionalBias: "NONE",
    scoringImpact: "NONE",
    source: "Kite index daily candles (cached once per symbol/trading day) + existing current-expiry ATM model IV from marketSnapshot",
    interpretationGuard: "IV-vs-RV measures volatility pricing versus recently realized movement. It is not a directional CE/PE or BUY/SELL signal.",
  };
}

// Kite API configuration
const KITE_API_BASE = "https://api.kite.trade";
const KITE_API_KEY = process.env.KITE_API_KEY?.trim() || "";
const KITE_API_SECRET = process.env.KITE_API_SECRET?.trim() || "";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SNAPSHOT_TTL_MS = 3 * 60 * 1000;
// 2026-08-18: adaptive refresh cadence for the master snapshot loop.
// Opening (09:15-10:00 IST) and closing (14:15-15:30 IST) windows get a
// faster 1-min refresh -- these are when option premiums/PCR/OI move
// fastest (opening range/gap resolution, and closing MTM squaring +
// expiry pinning). The rest of the session (10:00-14:15, the typical
// "lunch lull") keeps the existing 3-min cadence. This is safe for the
// V2 regime detector: v2WindowPoints() windows by real elapsed time, not
// sample count, so denser samples during the fast windows only improve
// resolution there -- nothing downstream breaks.
const SNAPSHOT_TTL_MS_FAST = 60 * 1000;
function getAdaptiveSnapshotTtlMs(): number {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istString);
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const openingFast = minutes >= 9 * 60 + 15 && minutes < 10 * 60; // 09:15-10:00
  const closingFast = minutes >= 14 * 60 + 15 && minutes <= 15 * 60 + 30; // 14:15-15:30
  return openingFast || closingFast ? SNAPSHOT_TTL_MS_FAST : SNAPSHOT_TTL_MS;
}

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

    let session = sessions.get(sessionId);
    if (!session && phase62RestoredKiteAuthority && kiteSessionIdMatchesFingerprint(sessionId, phase62RestoredKiteAuthority.sessionIdFingerprint)) {
      session = {
        accessToken: phase62RestoredKiteAuthority.accessToken,
        userId: phase62RestoredKiteAuthority.userId,
        email: phase62RestoredKiteAuthority.email ?? "",
        loginTime: phase62RestoredKiteAuthority.loginTime,
        expiresAt: phase62RestoredKiteAuthority.expiresAt,
      };
      sessions.set(sessionId, session);
      console.log("[PHASE62][KITE_AUTHORITY] restored in-memory session from shared authority");
    }
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

// V2.1 IV/Greeks integrity fix (2026-08-11): derivative expiry strings identify
// the calendar date, not midnight. On Railway (UTC), subtracting Date.now()
// from a midnight Date made same-day Tuesday NIFTY expiries look already
// expired during the live session, forcing IV/Greeks to zero. NSE index
// derivatives trade through the normal market close on expiry day, so use
// 15:30 IST (= 10:00 UTC) as the model expiry instant for an expiry date.
function daysToDerivativeExpiry(expiryStr: string, nowMs = Date.now()): number {
  if (!expiryStr) return 0;
  const parts = expiryStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return 0;
  const [y, m, d] = parts;
  const expiryCloseUtcMs = Date.UTC(y, m - 1, d, 10, 0, 0); // 15:30 IST
  return Math.max(0, (expiryCloseUtcMs - nowMs) / 86_400_000);
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
          tick_size: parseFloat(parts[7]) || 0,
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
  // Added 2026-08-18 for the Telegram 1-min fast cycle: the ATM CE/PE
  // ltp+oi from the SAME already-fetched `quotes` batch this function
  // builds for fullChainPcr/maxPain -- zero extra Kite calls. null when
  // the ATM strike's CE/PE instrument or quote isn't found.
  atmCeLtp: number | null;
  atmCeOi: number | null;
  atmPeLtp: number | null;
  atmPeOi: number | null;
  // Added 2026-08-18 for the Telegram Intr/Ext ¬±3 table and OI Ladder ¬±7
  // table: per-strike CE/PE ltp+oi across the ATM ¬±bandSize band, from the
  // SAME quotes batch already fetched for oiPcr/volumePcr above -- zero
  // extra Kite calls. Sorted ascending by strike.
  bandStrikes: Array<{ strike: number; ceOi: number | null; ceLtp: number | null; peOi: number | null; peLtp: number | null }>;
}

// OI PCR and Volume PCR use ATM ¬±7 strikes. Max Pain and full-chain PCR use
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
  // Per-strike lookup (strike -> {ceSymbol, peSymbol}) so we can build
  // bandStrikes below without a second pass over optionMap.
  const bandStrikeInfo: Array<{ strike: number; ceSymbol: string | null; peSymbol: string | null }> = [];

  for (let i = -bandSize; i <= bandSize; i++) {
    const strike = atmStrike + i * strikeStep;
    const ce = optionMap.get(`${strike}_CE`);
    const pe = optionMap.get(`${strike}_PE`);
    const ceSymbol = ce ? `${optExchange}:${ce.tradingsymbol}` : null;
    const peSymbol = pe ? `${optExchange}:${pe.tradingsymbol}` : null;
    if (ceSymbol) bandCeSymbols.push(ceSymbol);
    if (peSymbol) bandPeSymbols.push(peSymbol);
    bandStrikeInfo.push({ strike, ceSymbol, peSymbol });
  }

  const allInstruments = Array.from(optionMap.values());
  const allSymbols = allInstruments.map((inst) => `${optExchange}:${inst.tradingsymbol}`);
  if (allSymbols.length === 0) return { oiPcr: null, volumePcr: null, maxPain: 0, fullChainPcr: null, atmCeLtp: null, atmCeOi: null, atmPeLtp: null, atmPeOi: null, bandStrikes: [] };

  const quotes = await fetchKiteQuoteBatched(accessToken, allSymbols);
  if (!quotes) return { oiPcr: null, volumePcr: null, maxPain: 0, fullChainPcr: null, atmCeLtp: null, atmCeOi: null, atmPeLtp: null, atmPeOi: null, bandStrikes: [] };

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

  const bandStrikes = bandStrikeInfo.map(({ strike, ceSymbol, peSymbol }) => ({
    strike,
    ceOi: ceSymbol ? quotes[ceSymbol]?.oi ?? null : null,
    ceLtp: ceSymbol ? quotes[ceSymbol]?.last_price ?? null : null,
    peOi: peSymbol ? quotes[peSymbol]?.oi ?? null : null,
    peLtp: peSymbol ? quotes[peSymbol]?.last_price ?? null : null,
  }));

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

  const atmCeInst = optionMap.get(`${atmStrike}_CE`);
  const atmPeInst = optionMap.get(`${atmStrike}_PE`);
  const atmCeQuote = atmCeInst ? quotes[`${optExchange}:${atmCeInst.tradingsymbol}`] : null;
  const atmPeQuote = atmPeInst ? quotes[`${optExchange}:${atmPeInst.tradingsymbol}`] : null;

  return {
    oiPcr: totalCallOI > 0 ? totalPutOI / totalCallOI : null,
    volumePcr: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : null,
    maxPain,
    fullChainPcr: fullChainCallOI > 0 ? fullChainPutOI / fullChainCallOI : null,
    atmCeLtp: atmCeQuote?.last_price ?? null,
    atmCeOi: atmCeQuote?.oi ?? null,
    atmPeLtp: atmPeQuote?.last_price ?? null,
    atmPeOi: atmPeQuote?.oi ?? null,
    bandStrikes,
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
// separate quote calls (spot, futures, options per expiry, per index ‚Äî
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

    // Bug fix (2026-08-10, user-reported, verified against a full-day
    // archive: SENSEX futures_ltp/futures_oi were blank in 21.4% of
    // today's snapshots vs 0% for NIFTY/BankNifty). Root cause: this
    // only retried on 429 -- any 5xx or network-level failure on the
    // small, separate SENSEX futures quote call failed immediately
    // with no retry, unlike the option-chain batching path which
    // already had this resilience. Now retries 429 AND 5xx the same way.
    if ((response.status === 429 || response.status >= 500) && retriesLeft > 0) {
      const delayMs = 250 * (3 - retriesLeft); // 250ms, then 500ms
      console.warn(`[KITE] HTTP ${response.status}, retrying in ${delayMs}ms (${retriesLeft} attempt(s) left) for ${symbols.length} symbols`);
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
    // Same bug fix: network-level failures (timeout, connection reset,
    // DNS blip) previously failed immediately too -- these are exactly
    // the kind of transient error the archived data pointed to. Retry
    // with the same backoff as the 429/5xx path above.
    if (retriesLeft > 0) {
      const delayMs = 250 * (3 - retriesLeft);
      console.warn(`[KITE] Quote fetch threw (${err instanceof Error ? err.message : err}), retrying in ${delayMs}ms (${retriesLeft} attempt(s) left) for ${symbols.length} symbols`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetchKiteQuote(accessToken, symbols, retriesLeft - 1);
    }
    console.error("[KITE] Quote fetch error (out of retries):", err instanceof Error ? err.message : err);
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
// placeholder candle ‚Äî treat as "no data" rather than a misleading
// identical PDH/PDL.
function sanitizePdhPdl(high: number, low: number): { pdh: number; pdl: number } {
  if (high > 0 && high === low) return { pdh: 0, pdl: 0 };
  return { pdh: high, pdl: low };
}

// ============== PER-STRIKE PDH/PDL (previous day high/low of each option) ==============
// Previous-day levels for a given option contract don't change during the
// trading day, so results are cached in-memory (shared across all sessions)
// to avoid re-hitting Kite's historical endpoint on every 3-minute refresh.
// First 15-minute (9:15-9:30 IST) high/low ‚Äî sampled from whatever refresh
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

// ============== BLACK-SCHOLES GREEKS (Vega/Theta) ‚Äî estimated, NOT from Kite ==============
// Kite's quote API does not publish option Greeks. These are computed
// locally from spot, strike, IV, and days-to-expiry using the standard
// Black-Scholes model with an assumed risk-free rate ‚Äî a reasonable
// estimate, not an exchange-published figure.
const BS_RISK_FREE_RATE = 0.10; // NSE option-chain convention for displayed IV reference; model estimate only

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

// Implied Volatility solver (bisection) ‚Äî Kite's /quote endpoint does not
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
  let hi = 5.0; // 0.1% to 500% annualized vol ‚Äî wide enough bracket for any real option
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

// ============== ADVANCED GREEKS (Vanna/Charm/Speed/Zomma/Color) ‚Äî Phase 2 (2026-08-16) ==============
// Extends calcGreeks() (Delta/Vega/Theta above) with the 2nd/3rd-order
// Greeks plus the Intrinsic/Extrinsic premium split, requested for the
// HFT-desk-inspired roadmap. Reuses the SAME normPdf/normCdf/
// BS_RISK_FREE_RATE this file already uses for calcGreeks/
// calcImpliedVolatility ‚Äî no new math primitives, no new risk-free-rate
// convention. Pure calculation only: no live fetch, no Kite/Dhan call.
// ivPercent must come from a real source (live Dhan option-chain snapshot,
// or calcImpliedVolatility() above) ‚Äî Dhan's HISTORICAL IV endpoint is a
// confirmed empty-array gap (see memory), so this must never be fed a
// fabricated/placeholder IV.
function calcAdvancedGreeks(
  spot: number,
  strike: number,
  ivPercent: number,
  daysToExpiry: number,
  isCall: boolean
): {
  intrinsicValue: number; extrinsicValue: number; theoreticalPremium: number;
  delta: number; gamma: number; vega: number; theta: number;
  vanna: number; charm: number; speed: number; zomma: number; color: number;
  vomma: number; ultima: number;
} | null {
  if (spot <= 0 || strike <= 0 || ivPercent <= 0 || daysToExpiry < 0) return null;
  const sigma = ivPercent / 100;
  const T = Math.max(daysToExpiry / 365, 0.0001); // avoid divide-by-zero on expiry day
  const r = BS_RISK_FREE_RATE;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = normPdf(d1);
  const Nd1 = normCdf(isCall ? d1 : -d1);

  const intrinsic = isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const premium = isCall
    ? spot * normCdf(d1) - strike * Math.exp(-r * T) * normCdf(d2)
    : strike * Math.exp(-r * T) * normCdf(-d2) - spot * normCdf(-d1);
  const extrinsic = Math.max(0, premium - intrinsic);

  const { vega, theta, delta } = calcGreeks(spot, strike, ivPercent, daysToExpiry, isCall);
  const gamma = nd1 / (spot * sigma * sqrtT);
  const vanna = (vega / spot) * (1 - d1 / (sigma * sqrtT));
  const charm = (r * Nd1 - (nd1 * (2 * r * T - d2 * sigma * sqrtT)) / (2 * T * sigma * sqrtT)) / 365;
  const speed = (-gamma / spot) * (d1 / (sigma * sqrtT) + 1);
  const zomma = gamma * ((d1 * d2 - 1) / sigma);
  const color = gamma * (r + (sigma * d1) / (2 * T));

  // Vomma (a.k.a. "volga") = d(vega)/d(sigma) ‚Äî how much vega itself moves
  // for a further 1% move in IV. Standard BS closed form: vomma = vega * d1
  // * d2 / sigma, using the RAW (unscaled) vega. We then apply the SAME
  // /100 scaling convention already used above for `vega` (which is stored
  // as "premium change per 1% IV move", not per unit sigma) so `vomma`
  // stays unit-consistent with `vega` in this file: "how much `vega` moves
  // for a further 1% move in IV". 2026-08-16 addition, requested to detect
  // vol-of-vol risk (premium instability around high-IV events like
  // budget/RBI days/expiry) that delta/gamma/vega alone cannot see.
  const vegaRaw = spot * nd1 * sqrtT; // undo the /100 scaling done inside calcGreeks()
  const vomma = (vegaRaw * d1 * d2) / sigma / 100;

  // Ultima = d(vomma)/d(sigma) ‚Äî third derivative of premium w.r.t. vol.
  // Standard BS closed form: ultima = -vegaRaw/sigma^2 * (d1*d2*(1-d1*d2) + d1^2 + d2^2).
  // Same /100 scaling applied for consistency with vomma/vega above.
  const ultima = ((-vegaRaw / (sigma * sigma)) * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2)) / 100;

  return {
    intrinsicValue: Math.round(intrinsic * 100) / 100,
    extrinsicValue: Math.round(extrinsic * 100) / 100,
    theoreticalPremium: Math.round(premium * 100) / 100,
    delta: Math.round(delta * 10000) / 10000,
    gamma: Math.round(gamma * 1e6) / 1e6,
    vega: Math.round(vega * 10000) / 10000,
    theta: Math.round(theta * 10000) / 10000,
    vanna: Math.round(vanna * 1e6) / 1e6,
    charm: Math.round(charm * 1e6) / 1e6,
    speed: Math.round(speed * 1e8) / 1e8,
    zomma: Math.round(zomma * 1e6) / 1e6,
    color: Math.round(color * 1e6) / 1e6,
    vomma: Math.round(vomma * 1e6) / 1e6,
    ultima: Math.round(ultima * 1e6) / 1e6,
  };
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

// All available index futures, nearest expiry first ‚Äî used for the FUTURES
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
// "spot" symbol ‚Äî the underlying is whichever futures contract is currently
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

// USDINR ‚Äî Kite's currency derivatives (CDS exchange), used for the CONTEXT
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
    const commodityDaysToExpiry = commodityExpiryDate ? daysToDerivativeExpiry(expiry) : 0;

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
            const advGreeksCeMcx = calcAdvancedGreeks(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, true);
            const gammaCeMcx = advGreeksCeMcx ? advGreeksCeMcx.gamma : 0;
            baseMetrics.ceStrikes.push({
              strike,
              isAtm,
              instrumentToken: Number.isFinite(ceInst.instrument_token) ? ceInst.instrument_token : null,
              exchangeToken: Number.isFinite(ceInst.exchange_token) ? ceInst.exchange_token : null,
              expiryDate: ceInst.expiry || null,
              expiryBucket: "MCX_CURRENT",
              optionType: "CE",
              lotSize: ceInst.lot_size > 0 ? ceInst.lot_size : null,
              tickSize: ceInst.tick_size > 0 ? ceInst.tick_size : null,
              exchange: ceInst.exchange || null,
              segment: ceInst.segment || null,
              contractRegime: "LIVE_CONTRACT_MASTER",
              tradingSymbol: ceInst.tradingsymbol || null,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              volume: oq.volume != null ? oq.volume : null,
              vwap: oq.average_price && oq.average_price > 0 ? oq.average_price : null,
              vwapSource: (oq.average_price && oq.average_price > 0) ? "UNVERIFIED AVERAGE PRICE ‚Äî NOT VWAP" : "VWAP UNAVAILABLE",
              quoteTimestamp: parseKiteTimestampToUtcIso(oq.last_trade_time) || parseKiteTimestampToUtcIso(oq.timestamp) || null,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayOpen: oq.ohlc?.open || 0,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
              delta: greeks.delta,
              gamma: gammaCeMcx,
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
            const advGreeksPeMcx = calcAdvancedGreeks(baseMetrics.current, strike, computedIv, commodityDaysToExpiry, false);
            const gammaPeMcx = advGreeksPeMcx ? advGreeksPeMcx.gamma : 0;
            baseMetrics.peStrikes.push({
              strike,
              isAtm,
              instrumentToken: Number.isFinite(peInst.instrument_token) ? peInst.instrument_token : null,
              exchangeToken: Number.isFinite(peInst.exchange_token) ? peInst.exchange_token : null,
              expiryDate: peInst.expiry || null,
              expiryBucket: "MCX_CURRENT",
              optionType: "PE",
              lotSize: peInst.lot_size > 0 ? peInst.lot_size : null,
              tickSize: peInst.tick_size > 0 ? peInst.tick_size : null,
              exchange: peInst.exchange || null,
              segment: peInst.segment || null,
              contractRegime: "LIVE_CONTRACT_MASTER",
              tradingSymbol: peInst.tradingsymbol || null,
              bid: oq.depth?.buy?.[0]?.price || 0,
              ask: oq.depth?.sell?.[0]?.price || 0,
              lastPrice: oq.last_price || 0,
              change: oq.net_change || 0,
              iv: computedIv,
              oi: oq.oi || 0,
              volume: oq.volume != null ? oq.volume : null,
              vwap: oq.average_price && oq.average_price > 0 ? oq.average_price : null,
              vwapSource: (oq.average_price && oq.average_price > 0) ? "UNVERIFIED AVERAGE PRICE ‚Äî NOT VWAP" : "VWAP UNAVAILABLE",
              quoteTimestamp: parseKiteTimestampToUtcIso(oq.last_trade_time) || parseKiteTimestampToUtcIso(oq.timestamp) || null,
              atDayHigh: dayHigh ? oq.last_price >= dayHigh * 0.98 : false,
              atDayLow: dayLow ? oq.last_price <= dayLow * 1.02 : false,
              dayOpen: oq.ohlc?.open || 0,
              dayHigh: dayHigh || 0,
              dayLow: dayLow || 0,
              pdc: oq.ohlc?.close || 0,
              pdh: levels.pdh,
              pdl: levels.pdl,
              vega: greeks.vega,
              theta: greeks.theta,
              delta: greeks.delta,
              gamma: gammaPeMcx,
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
    // market timestamp" ‚Äî Kite's own response-timestamp field can reflect
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
          `[${symbol}] Fetching ${expiryName} options (${expiryDate}): ATM ${baseMetrics.atmStrike} ${symbol === "BANKNIFTY" ? "¬±6" : "¬±10"} strikes`
        );

        const optExchange = EXCHANGE_CODES[symbol as keyof typeof EXCHANGE_CODES];
        const optionMap = buildOptionMap(instruments, symbol, expiryDate);

        // ATM-2, ATM-1, ATM, ATM+1, ATM+2
        // BankNifty: ATM¬±6. NIFTY/SENSEX: ATM¬±10 (spec's "detailed table" range).
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
                const daysToExpiry = daysToDerivativeExpiry(ceInst.expiry || expiryDate);
                const computedIv = calcImpliedVolatility(q.last_price || 0, baseMetrics.current, strike, daysToExpiry, true);
                const greeks = calcGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, true);
                const advGreeksCe = calcAdvancedGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, true);
                const gammaCe = advGreeksCe ? advGreeksCe.gamma : 0;
                expiry.ceStrikes.push({
                  strike,
                  isAtm,
                  instrumentToken: Number.isFinite(ceInst.instrument_token) ? ceInst.instrument_token : null,
                  exchangeToken: Number.isFinite(ceInst.exchange_token) ? ceInst.exchange_token : null,
                  expiryDate: ceInst.expiry || null,
                  expiryBucket: expiryName,
                  optionType: "CE",
                  lotSize: ceInst.lot_size > 0 ? ceInst.lot_size : null,
                  tickSize: ceInst.tick_size > 0 ? ceInst.tick_size : null,
                  exchange: ceInst.exchange || null,
                  segment: ceInst.segment || null,
                  contractRegime: "LIVE_CONTRACT_MASTER",
                  tradingSymbol: ceInst.tradingsymbol || null,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  volume: q.volume != null ? q.volume : null,
                  vwap: q.average_price && q.average_price > 0 ? q.average_price : null,
                  vwapSource: (q.average_price && q.average_price > 0) ? "UNVERIFIED AVERAGE PRICE ‚Äî NOT VWAP" : "VWAP UNAVAILABLE",
                  quoteTimestamp: parseKiteTimestampToUtcIso(q.last_trade_time) || parseKiteTimestampToUtcIso(q.timestamp) || null,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayOpen: q.ohlc?.open || 0,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
              delta: greeks.delta,
                  gamma: gammaCe,
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
                const daysToExpiry = daysToDerivativeExpiry(peInst.expiry || expiryDate);
                const computedIv = calcImpliedVolatility(q.last_price || 0, baseMetrics.current, strike, daysToExpiry, false);
                const greeks = calcGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, false);
                const advGreeksPe = calcAdvancedGreeks(baseMetrics.current, strike, computedIv, daysToExpiry, false);
                const gammaPe = advGreeksPe ? advGreeksPe.gamma : 0;
                expiry.peStrikes.push({
                  strike,
                  isAtm,
                  instrumentToken: Number.isFinite(peInst.instrument_token) ? peInst.instrument_token : null,
                  exchangeToken: Number.isFinite(peInst.exchange_token) ? peInst.exchange_token : null,
                  expiryDate: peInst.expiry || null,
                  expiryBucket: expiryName,
                  optionType: "PE",
                  lotSize: peInst.lot_size > 0 ? peInst.lot_size : null,
                  tickSize: peInst.tick_size > 0 ? peInst.tick_size : null,
                  exchange: peInst.exchange || null,
                  segment: peInst.segment || null,
                  contractRegime: "LIVE_CONTRACT_MASTER",
                  tradingSymbol: peInst.tradingsymbol || null,
                  bid: q.depth?.buy?.[0]?.price || 0,
                  ask: q.depth?.sell?.[0]?.price || 0,
                  lastPrice: q.last_price || 0,
                  change: q.net_change || 0,
                  iv: computedIv,
                  oi: q.oi || 0,
                  volume: q.volume != null ? q.volume : null,
                  vwap: q.average_price && q.average_price > 0 ? q.average_price : null,
                  vwapSource: (q.average_price && q.average_price > 0) ? "UNVERIFIED AVERAGE PRICE ‚Äî NOT VWAP" : "VWAP UNAVAILABLE",
                  quoteTimestamp: parseKiteTimestampToUtcIso(q.last_trade_time) || parseKiteTimestampToUtcIso(q.timestamp) || null,
                  atDayHigh: dayHigh ? q.last_price >= dayHigh * 0.98 : false,
                  atDayLow: dayLow ? q.last_price <= dayLow * 1.02 : false,
                  dayOpen: q.ohlc?.open || 0,
                  dayHigh: dayHigh || 0,
                  dayLow: dayLow || 0,
                  pdc: q.ohlc?.close || 0,
                  pdh: levels.pdh,
                  pdl: levels.pdl,
                  vega: greeks.vega,
                  theta: greeks.theta,
              delta: greeks.delta,
                  gamma: gammaPe,
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
mountResearchRoutes(app);

// One browser/session per tab can point at the same Kite authority. A
// session-local refreshPromise cannot collapse those cross-session races, so
// the old background loop could launch duplicate NIFTY/BANKNIFTY/SENSEX fetch
// cycles in the same second and trigger Kite HTTP 429 responses.
const marketRefreshSingleFlight = new KeyedSingleFlight<IndexMetrics[]>();
const MARKET_REFRESH_REUSE_MS = 5_000;

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
    const sharedResults = await marketRefreshSingleFlight.run(
      marketAuthorityKey(session.accessToken),
      () => Promise.all([
        fetchIndexData(session.accessToken, "NIFTY"),
        fetchIndexData(session.accessToken, "BANKNIFTY"),
        fetchIndexData(session.accessToken, "SENSEX"),
      ]),
      MARKET_REFRESH_REUSE_MS,
    );
    // Gap-score trend and histories below are session-owned and mutate their
    // snapshot. Keep the upstream fetch shared but give every session its own
    // object graph so one dashboard cannot alter another dashboard's state.
    const results = structuredClone(sharedResults) as IndexMetrics[];
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
       emoji used throughout this dashboard (üî¥üü¢üììüîç‚öôÔ∏è etc.) was
       considered but deferred ‚Äî it would touch dozens of call sites
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
      <h1>‚ö° OptionPilot Pro</h1>
      <div class="header-right">
        <div class="kite-status">
          <div class="status-dot" id="statusDot"></div>
          <span class="status-text">Status:</span>
          <span class="status-text" id="statusText">Checking...</span>
          <span class="status-user" id="statusUser"></span>
        </div>
        <button class="btn primary" id="kiteConnectBtn" onclick="connectKite()">üîå Connect Kite</button>
        <div class="refresh-controls">
          <button class="btn" id="manualRefresh" onclick="refreshData()">üîÑ Refresh</button>
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
      <button class="tab-btn" onclick="switchTab('COMMODITIES')">üõ¢Ô∏è Commodities</button>
      <button class="tab-btn" onclick="switchTab('FIIDII')">üè¶ FII/DII</button>
      <button class="tab-btn" onclick="switchTab('VIXCORR')">üìâ VIX Correlation</button>
      <button class="tab-btn" onclick="switchTab('NEWS')">üì∞ News</button>
      <button class="tab-btn" onclick="switchTab('JOURNAL')">üìì Journal</button>
      <button class="tab-btn" onclick="switchTab('RESEARCH')">üîç Research</button>
      <button class="tab-btn" onclick="switchTab('SYSTEM')">‚öôÔ∏è System</button>
      <button class="tab-btn" onclick="switchTab('HOLIDAYS')">üìÖ Holidays</button>
      <button class="tab-btn" onclick="switchTab('TRADELAB')">üß™ Trade Lab</button>
      <button class="tab-btn" onclick="switchTab('MYACCOUNT')">üíº My Account</button>
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
    <div id="TRADELAB" class="tab-content"></div>
    <div id="MYACCOUNT" class="tab-content"></div>

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
        btn.textContent = '‚úì Kite Connected';
        btn.disabled = true;
      } else {
        dot.classList.remove('connected');
        text.textContent = 'Disconnected';
        user.textContent = '';
        btn.textContent = 'üîå Connect Kite';
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
        refreshOptionBuyingCards();
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
      // are never conflated ‚Äî Kite Authentication Session is shown
      // separately in the header above (Status: Connected/email); this bar
      // covers only the Live Market Quote Feed and Last Successful Refresh.
      // Visual styling (2026-08-08): terminal-ticker treatment ‚Äî 
      // monospace, pulsing live dot, subtle border glow matching state.
      const pulseAnim = state === 'LIVE' ? 'animation: tickerPulse 1.8s ease-in-out infinite;' : '';
      let html = '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(0,0,0,0.25); border-radius:8px; margin-bottom:10px; font-size:0.7rem; flex-wrap:wrap; gap:4px; font-family:var(--font-mono); border:1px solid color-mix(in srgb, ' + color + ' 20%, transparent); box-shadow:0 0 12px color-mix(in srgb, ' + color + ' 10%, transparent);">';
      html += '<span style="display:inline-flex; align-items:center; gap:6px;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:' + color + '; ' + pulseAnim + '"></span><span style="color:var(--muted);">FEED </span><span style="color:' + color + '; font-weight:700;">' + escapeHtml(state) + '</span></span>';
      html += '<span style="color:var(--muted);">SYNC ' + escapeHtml(lastUpdateText) + '</span>';
      html += '<span style="color:var(--muted);">NEXT ' + escapeHtml(nextRefreshText) + '</span>';
      // PHASE 4 (Mobile Resync): the server's OWN freshness verdict from
      // /api/market/latest-snapshot (Phase 2's LIVE/DEGRADED/FROZEN/LOCKED
      // classification), shown alongside the client's own FEED state
      // rather than replacing it ‚Äî the two are computed differently
      // (client: consecutive-failure/age heuristic; server: authoritative
      // per-snapshot classification) and disagreement between them is
      // itself useful information, not something to hide by merging.
      if (serverConnectionState) {
        const serverColor = serverConnectionState === 'LIVE' ? 'var(--green)'
          : (serverConnectionState === 'DEGRADED' || serverConnectionState === 'FROZEN') ? 'var(--gold)'
          : 'var(--red)';
        html += '<span style="color:var(--muted);">SERVER <span style="color:' + serverColor + '; font-weight:700;">' + escapeHtml(serverConnectionState) + '</span></span>';
      }
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
          htm◊ù˚„è ◊¨¢h≠µÁYX]\ôUò[Y\”€õP⁄X⁄‹›[SX]⁄àåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àÀOì[ôXYŸHô\Z\àõ€ŸàòZ[\ôHãà›‹ôY—õ›[ôàò[ŸKàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å◊”ó“QSïUW’ëTíQíP–US”à8†%ëTíQñW”ó‘’‘ëQ“QSïUW–TïQêP’¬ãÀ¬ãÀ»€‹Ÿ\»H\›[ùô\öYöYYõ›[ô][€àÿ\àõ›ô\»H»X[ô]‹ûHÇãÀ»€€ùòX››[YHY[ù]H\ùYòX›»
íQïW‘‘’íQïW—ïUíQïW”‘–—W–UJBãÀ»ÿ[àôHÿÿ]Y[ôôXYòX⁄»úõ€Hö]ôH⁄]ô\õŸX⁄XõHÿ[õ€öXÿ[ãÀ»⁄X⁄‹›[\À€‹úôX›€€ùòX›Y[ù]HöY[À[ô\]Z]ò[[ù[ôXYŸHòX⁄¬ãÀ»»Z\àHò]»€›[ù\ú\ùÀÇãÀ¬ãÀ»õ»ô]»[àô]⁄àõ»ô]»ôX]\ô\Ààõ»åà⁄[ôŸ\ÀàôXY[€õHYÿZ[ú›ãÀ»[ôXYK\›‹ôYö]ôH\ùYòX›ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇôù[ò›[€àÿ[õ€öXÿ[ú€€î›ö[ô⁄YûJò[YNà[ûJNà›ö[ô»¬àYà
\úò^Kö\–\úò^Jò[YJJHô]\õàñ»à
»ò[YKõX\
ÿ[õ€öXÿ[ú€€î›ö[ô⁄YûJKöõ⁄[äãäH
»óHé¬àYà
ò[YHOOHù[	âà\[Ÿàò[YHOOHõÿöôX›äH¬à€€ú›Ÿ^\»HÿöôX›öŸ^\ ò[YJKú€‹ù

N¬àô]\õàû»à
»Ÿ^\ÀõX\

 HOàî””ãú›ö[ô⁄YûJ H
»éàà
»ÿ[õ€öXÿ[ú€€î›ö[ô⁄YûJò[YV⁄◊JJKöõ⁄[äãäH
»üHé¬àBàô]\õàî””ãú›ö[ô⁄YûJò[YJN¬üBÇò€€ú›ó‘ëTURTëQ—íQSŒàôX€‹ô›ö[ôÀ›ö[ô÷◊OàH¬àíQïW‘‘’à»úﬁ[Xõ€ãúŸX›\ö]RYãö[ú›ù[Y[ùóKàíQïW—ïUà»úﬁ[Xõ€ãúŸX›\ö]RYãö[ú›ù[Y[ùãô^\ûHãùòY[ô‘ﬁ[Xõ€óKàíQïW”‘–—W–UNà»úﬁ[Xõ€ãö[ú›ù[Y[ùãõ‹[€ï\Hãô^\ûHóKÀ»ŸX›\ö]RY[ù[ù[€ò[Hù[\ôHKHŸYHŸX›\ö]RY€›\òŸH⁄X⁄»ô[›¬üN¬Çôù[ò›[€àô\öYûSíY[ù]QöY[ \‹Ÿ]Xô[à›ö[ôÀY[ù]Nà[ûJNà»Y[ù]T›]\Œà›ö[ôŒ»\‹›Y\Œà›ö[ô÷◊HH¬à€€ú›\‹›Y\Œà›ö[ô÷◊HH◊N¬à€€ú›ô\]Z\ôYöY[»Hó‘ëTURTëQ—íQS÷ÿ\‹Ÿ]Xô[H◊N¬àõ‹à
€€ú›àŸàô\]Z\ôYöY[ H¬àYà
Y[ù]HOHù[Y[ù]VŸóHOOH[ôYö[ôYY[ù]VŸóHOOHù[Y[ù]VŸóHOOHàäH¬à\‹›Y\Àú\⁄
RT‘“Së◊—íQSâŸüX
N¬àBàBàYà
Y[ù]OÀúﬁ[Xõ€OOHìíQïHäH\‹›Y\Àú\⁄
‘ì”ë◊‘÷SPì”â⁄Y[ù]OÀúﬁ[Xõ€X
N¬ÇàYà
\‹Ÿ]Xô[OOHìíQïW‘‘’äH¬àYà
Y[ù]OÀö[ú›ù[Y[ùOOHíSëVäH\‹›Y\Àú\⁄
‘ì”ë◊“Sî’ïSQSïâ⁄Y[ù]OÀö[ú›ù[Y[ùX
N¬àYà
Y[ù]OÀúŸX›\ö]RYOOHL H\‹›Y\Àú\⁄
SëVP’Q‘—P’TíUW“Qâ⁄Y[ù]OÀúŸX›\ö]RYX
N¬àBàYà
\‹Ÿ]Xô[OOHìíQïW—ïUäH¬àYà
Y[ù]OÀö[ú›ù[Y[ùOOHëïUQäH\‹›Y\Àú\⁄
‘ì”ë◊“Sî’ïSQSïâ⁄Y[ù]OÀö[ú›ù[Y[ùX
N¬àYà
ZY[ù]OÀúŸX›\ö]RY
H\‹›Y\Àú\⁄
ìRT‘“Së◊‘—P’TíUW“QäN¬àYà
ZY[ù]OÀô^\ûJH\‹›Y\Àú\⁄
ìRT‘“Së◊—VTñHäN¬àBàYà
\‹Ÿ]Xô[OOHìíQïW”‘–—W–UHäH¬àYà
Y[ù]OÀö[ú›ù[Y[ùOOHì‘QäH\‹›Y\Àú\⁄
‘ì”ë◊“Sî’ïSQSïâ⁄Y[ù]OÀö[ú›ù[Y[ùX
N¬àYà
Y[ù]OÀõ‹[€ï\HOOHê—HäH\‹›Y\Àú\⁄
‘ì”ë◊”‘S”ó’TNâ⁄Y[ù]OÀõ‹[€ï\_X
N¬àÀ»ŸX›\ö]RY\»VP’Qù[\ôH
õ€[ôÀPUHŸ\öY\Àõ»ö^Y€€ùòX›
HKH€õHõY»YÇàÀ»Hÿ›[Y[ùYôX\€€à\»Z\‹⁄[ôÀ⁄[òŸHH⁄[[ùù[€›[ôHHôX[ÿ\ÇàYà
Y[ù]OÀúŸX›\ö]RYOOHù[
H\‹›Y\Àú\⁄
SëVP’Q”ì”ó”ïS‘—P’TíUW“Qâ⁄Y[ù]OÀúŸX›\ö]RYX
N¬àYà
Y[ù]OÀúŸX›\ö]RY€›\òŸHOOHëSó‘ì”Së◊–UW”ì◊—íVQ–””ïêP’äH\‹›Y\Àú\⁄
ìRT‘“Së◊‘—P’TíUW“Q‘”’Tê—W—VSêUS”àäN¬àBÇàô]\õà»Y[ù]T›]\Œà\‹›Y\Àõ[ô›OOH»îT‘»ààêRSà	⁄\‹›Y\Àöõ⁄[äãä_X\‹›Y\»N¬üBÇò\ôŸ]
ãÿ\Kÿ]Y]›åÀ[ãZY[ù]K]ô\öYöXÿ][€ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå◊”ó“QSïUW’ëTíQíP–US”àãà\⁄ŒàïëTíQñW”ó‘’‘ëQ“QSïUW–TïQêP’»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›Yàã\ê\‹Ÿ]à◊HKå
N¬àBÇàûH¬à€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›Y[ù]T\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåó⁄Y[ù]Hã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ò]‘\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåW‹ò]»ã›‹ôTõ€›⁄Ÿ[äHàù[¬àYà
ZY[ù]T\ô[ùõ€\à\ò]‘\ô[ùõ€\äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[Yàã\ê\‹Ÿ]à◊HKå
N¬àBÇà€€ú›X[ô]‹ûP\‹Ÿ]»H»ìíQïW‘‘’ãìíQïW—ïUãìíQïW”‘–—W–UHóN¬à€€ú›\ê\‹Ÿ]à\úò^OôX€‹ô›ö[ôÀ[ûOèàH◊N¬à€€ú›ŸY[îŸX›\ö]RY»Hô]»X\›ö[ôÀ›ö[ô÷◊Oä
N»À»ŸX›\ö]RYOàÿ\‹Ÿ]Xô[◊Hõ‹à\Xÿ]H]X›[€ÇÇàõ‹à
€€ú›\‹Ÿ]Xô[ŸàX[ô]‹ûP\‹Ÿ] H¬à€€ú›\‹Ÿ]ô\›[àôX€‹ô›ö[ôÀ[ûOàH»\‹Ÿ]Xô[\úõ‹úŒà◊H\»›ö[ô÷◊HN¬ÇàÀ»KKH––UHKKBà€€ú›Y[ù]P\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[Y[ù]T\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›ö[\»HY[ù]P\‹Ÿ]õ€\à»]ÿZ]ö]ôS\›ö[\“[ëõ€\äY[ù]P\‹Ÿ]õ€\ã⁄Ÿ[äHà◊N¬à€€ú›Y[ù]Qö[\»Hö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
öY[ù]W»äJN¬àYà
Y[ù]Qö[\Àõ[ô›OOH
H¬à\‹Ÿ]ô\›[ôö[RYHù[¬à\‹Ÿ]ô\›[ôö[Sò[YHHù[¬à\‹Ÿ]ô\›[úôXYòX⁄‘›]\»Hìì’—ì’Sëé¬à\‹Ÿ]ô\›[ò⁄X⁄‹›[HHù[¬à\‹Ÿ]ô\›[úô\õŸX⁄Xö[]SX]⁄Hò[ŸN¬à\‹Ÿ]ô\›[öY[ù]T›]\»HëêRSàì◊”ó–TïQêP’—ì’Sëé¬à\‹Ÿ]ô\›[ìS[ôXYŸT›]\»Hìì’–“P“—Q”ì◊”ó–TïQêP’é¬à\‹Ÿ]ô\›[ô\úõ‹úÀú\⁄
ìõ»àY[ù]Hö[Hõ›[ô[àó⁄Y[ù]K»à
»\‹Ÿ]Xô[
N¬à\ê\‹Ÿ]ú\⁄
\‹Ÿ]ô\›[
N¬à€€ù[ùYN¬àBà€€ú›ëö[HHY[ù]Qö[\÷ÃN¬à\‹Ÿ]ô\›[ôö[RYHëö[KöY¬à\‹Ÿ]ô\›[ôö[Sò[YHHëö[Kõò[YN¬ÇàÀ»KKHëPQêP“»“P—K[ô\[ô[ùK»õ›ôHô\õŸX⁄Xö[]HKKBà€€ú›ôXYHH]ÿZ]ö]ôTôXYö[PûRY
ëö[KöY⁄Ÿ[äN¬à€€ú›ôXYàH]ÿZ]ö]ôTôXYö[PûRY
ëö[KöY⁄Ÿ[äN¬à€€ú›ôXYòX⁄‘›]\»HôXYHOOHù[	âàôXYàOOHù[»îT‘»ààëêRSé¬à\‹Ÿ]ô\›[úôXYòX⁄‘›]\»HôXYòX⁄‘›]\Œ¬àYà
ôXYòX⁄‘›]\»OOHîT‘»äH¬à\‹Ÿ]ô\›[ò⁄X⁄‹›[HHù[¬à\‹Ÿ]ô\›[úô\õŸX⁄Xö[]SX]⁄Hò[ŸN¬à\‹Ÿ]ô\›[öY[ù]T›]\»HëêRSàëPQ–êP“◊—êRSQé¬à\‹Ÿ]ô\›[ìS[ôXYŸT›]\»Hìì’–“P“—Q‘ëPQ–êP“◊—êRSQé¬à\‹Ÿ]ô\›[ô\úõ‹úÀú\⁄
ëö]ôHôXYXòX⁄»ô]\õôYù[€à]X\›€ôH][\àäN¬à\ê\‹Ÿ]ú\⁄
\‹Ÿ]ô\›[
N¬à€€ù[ùYN¬àBÇàÀ»KKH–Sì”íP–S“P“‘’SH
€‹ùYŸ^\À]\õZ[ö\›X HKKBà€€ú›⁄X⁄‹›[LHH‹ôX]R\⁄
ú⁄LçMàäKù\]Jÿ[õ€öXÿ[ú€€î›ö[ô⁄YûJôXYJJKôYŸ\›
ö^äN¬à€€ú›⁄X⁄‹›[LàH‹ôX]R\⁄
ú⁄LçMàäKù\]Jÿ[õ€öXÿ[ú€€î›ö[ô⁄YûJôXYäJKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]SX]⁄H⁄X⁄‹›[LHOOH⁄X⁄‹›[Lé¬à\‹Ÿ]ô\›[ò⁄X⁄‹›[HH⁄X⁄‹›[LN¬à\‹Ÿ]ô\›[úô\õŸX⁄Xö[]SX]⁄Hô\õŸX⁄Xö[]SX]⁄¬àYà
\ô\õŸX⁄Xö[]SX]⁄
H\‹Ÿ]ô\›[ô\úõ‹úÀú\⁄
ê⁄X⁄‹›[HYôô\ôYô]ŸY[à€»[ô\[ô[ùôXYXòX⁄‹»ŸàHÿ[YHö[KàäN¬ÇàÀ»KKHQSïUHíQSëTíQíP–US”à
€€ùòX›Y[ù]H€‹úôX›ô\‹ HKKBà€€ú›»Y[ù]T›]\À\‹›Y\»HHô\öYûSíY[ù]QöY[ \‹Ÿ]Xô[ôXYJN¬à\‹Ÿ]ô\›[öY[ù]T›]\»HY[ù]T›]\Œ¬àYà
\‹›Y\Àõ[ô›à
H\‹Ÿ]ô\›[ô\úõ‹úÀú\⁄
ããö\‹›Y\ N¬ÇàÀ»KKHHSëPQ—Nà\]Z]ò[[ù[[ôXYŸH⁄X⁄»öXHX]⁄[ô»\‹Ÿ][Xô[àÀ»õ€\à[àW‹ò]»KH€€ù[ùZ\⁄ò[Z[ô»YX[ú»Hò]»ö[H]ôYàÀ»\»Y[ù]HôX€‹ô
Yà[ûHÿ\»]ô\à‹ö][äH]ô\»[ô\àHÿ[YBàÀ»\‹Ÿ]Xô[àõ»ô]»[àô]⁄\ôõ‹õYYàKKBà€€ú›ò]–\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[ò]‘\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›ò]—ö[\»Hò]–\‹Ÿ]õ€\à»]ÿZ]ö]ôS\›ö[\“[ëõ€\äò]–\‹Ÿ]õ€\ã⁄Ÿ[äHà◊N¬à€€ú›ò]—ö[\—õ‹ê\‹Ÿ]Hò]—ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
úò]◊»äJN¬àYà
ò]—ö[\—õ‹ê\‹Ÿ]õ[ô›à
H¬à\‹Ÿ]ô\›[ìS[ôXYŸT›]\»HîT‘◊’íPW–T‘—U”PëS—ì”Tó”PU“é¬à\‹Ÿ]ô\›[õQö[RYHò]—ö[\—õ‹ê\‹Ÿ]ÃKöY¬à\‹Ÿ]ô\›[õQö[Sò[YHHò]—ö[\—õ‹ê\‹Ÿ]ÃKõò[YN¬àH[ŸH¬à\‹Ÿ]ô\›[ìS[ôXYŸT›]\»HëêRS”ì◊”W—íSW—ì’Së—ì‘ó–T‘—Ué¬à\‹Ÿ]ô\›[ô\úõ‹úÀú\⁄
ìõ»X]⁄[ô»ò]»ö[Hõ›[ô[ô\àW‹ò]À»à
»\‹Ÿ]Xô[
N¬àBÇàÀ»òX⁄»ŸX›\ö]RYõ‹à‹õ‹‹ÀX\‹Ÿ]\Xÿ]H]X›[€à
⁄⁄\ù[»KHBàÀ»ù[ŸX›\ö]RY\»Hÿ›[Y[ùY^X›Y›]Hõ‹àHõ€[ôÀPUBàÀ»‹[€àYÀõ›H\Xÿ]Hÿ[ôY]JKÇàYà
ôXYOÀúŸX›\ö]RYOOHù[	âàôXYOÀúŸX›\ö]RYOOH[ôYö[ôY
H¬à€€ú›Ÿ^HH›ö[ô ôXYKúŸX›\ö]RY
N¬à€€ú›\úàHŸY[îŸX›\ö]RYÀôŸ]
Ÿ^JH◊N¬à\úãú\⁄
\‹Ÿ]Xô[
N¬àŸY[îŸX›\ö]RYÀúŸ]
Ÿ^K\úäN¬àBÇà\ê\‹Ÿ]ú\⁄
\‹Ÿ]ô\›[
N¬àBÇà€€ú›\Xÿ]TŸX›\ö]RY»HÀããúŸY[îŸX›\ö]RYÀô[ùöY\ 
WKôö[\ä
ÀXô[◊JHOàXô[Àõ[ô›àJN¬à€€ú›\Xÿ]TŸX›\ö]RY⁄X⁄»H\Xÿ]TŸX›\ö]RYÀõ[ô›OOH»îT‘◊”ì◊—TP–UT»ààêRS—TP–UT◊—ì’Sëà	“î””ãú›ö[ô⁄YûJ\Xÿ]TŸX›\ö]RY _X¬Çà€€ú›[õ›[ôH\ê\‹Ÿ]ô]ô\ûJ
JHOàKôö[RYOOHù[
N¬à€€ú›[ôXYòX⁄‘\‹»H\ê\‹Ÿ]ô]ô\ûJ
JHOàKúôXYòX⁄‘›]\»OOHîT‘»äN¬à€€ú›[ô\õŸX⁄XõHH\ê\‹Ÿ]ô]ô\ûJ
JHOàKúô\õŸX⁄Xö[]SX]⁄OOHùYJN¬à€€ú›[Y[ù]T\‹»H\ê\‹Ÿ]ô]ô\ûJ
JHOàKöY[ù]T›]\»OOHîT‘»äN¬à€€ú›[[ôXYŸT\‹»H\ê\‹Ÿ]ô]ô\ûJ
JHOàKìS[ôXYŸT›]\»OOHîT‘◊’íPW–T‘—U”PëS—ì”Tó”PU“äN¬à€€ú›õ—\Xÿ]\»H\Xÿ]TŸX›\ö]RY⁄X⁄»OOHîT‘◊”ì◊—TP–UT»é¬Çà€€ú››ô\ò[›]\»Bà[õ›[ô	âà[ôXYòX⁄‘\‹»	âà[ô\õŸX⁄XõH	âà[Y[ù]T\‹»	âà[[ôXYŸT\‹»	âàõ—\Xÿ]\¬à»îT‘»Çàà
[õ›[ô	âà[ôXYòX⁄‘\‹»»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Àà\ê\‹Ÿ]à\Xÿ]TŸX›\ö]RY⁄X⁄Ààõ›[ô][€î›]\Œà¬àNàîT‘◊‘ëUíS’T”W’ëTíQíQQ’íPW””W”ó‘ì”—ó–Së””SëPQ—W‘ëTRTàãàéà›ô\ò[›]\ÀàŒàîT‘◊‘ëUíS’T”W’ëTíQíQQ’íPW”◊‘ì”—ó–Së””SëPQ—W‘ëTRTàãààîT‘◊‘ëUíS’T”W’ëTíQíQQ’íPW””SëPQ—W‘ëTRTà
ÀÃMàåW—ïUTëT◊‘’ïP’TëHôX]\ô\»€õJHãàKàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€ààY[ù]Hô\öYöXÿ][€àõ€ŸàòZ[\ôHãà\ê\‹Ÿ]à◊KàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å——ïUTëT◊”“W—íSêS’êSQUS”à8†%ì’ëW“T’‘íP–S—ïUTëT◊”“W—Së’◊—SëãÀ¬ãÀ»õ›ô\»
‹à\‹õ›ô\ H⁄]\à[à\›‹öXÿ[ù]\ô\»“H\»Ÿ[ùZ[ô[BãÀ»\ÿXõH[ô]ÀY[ôõ‹àH[ôXYK]ô\öYöYYíQïHù]\ô\»€€ùòX›ãÀ»
ŸX›\ö]RYNÃäKôYõ‹ôH[ûH“KXò\ŸYåHôX]\ôHŸ]»ùZ[ÇãÀ»⁄X⁄‹»Hù[⁄Z[éàô\]Y\›Oàò]»ô\‹€úŸHOà\úŸ\àOàH›‹òYŸBãÀ»Oà»‹ö]K\ôXY[ôô\‹ù»€ôHò[Y]Yõ€›Xÿ]\ŸH›]KÇãÀ¬ãÀ»Ÿ\»ì’ùZ[€ô–ùZ[\›]K‹⁄‹ùùZ[\›]KŸ]ÀàŸ\»ì’YHBãÀ»YÀàŸ\»ì’›X⁄åãàô]⁄\»H€X[ò[YY]Hò[ôŸH€õH
åçãLLÇãÀ»»åçãLLLJKõ›ù[»\›‹ûKÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇôù[ò›[€à€€X›Ÿ^\‘ôX›\ú⁄]ôJÿöéà[ûK\àù[Xô\ãôYö^HàäNà›ö[ô÷◊H¬àYà
\ÿöàOOHù[\[ŸàÿöàOOHõÿöôX›äHô]\õà◊N¬à€€ú›Ÿ^\Œà›ö[ô÷◊HH◊N¬àõ‹à
€€ú›»ŸàÿöôX›öŸ^\ ÿöäJH¬à€€ú›]HôYö^»	‹ôYö^Kâ⁄ﬂXàŒ¬àŸ^\Àú\⁄
]
N¬àYà
ÿöñ⁄◊HOOHù[	âà\[Ÿàÿöñ⁄◊HOOHõÿöôX›à	âàP\úò^Kö\–\úò^Jÿöñ⁄◊JJH¬àŸ^\Àú\⁄
ããò€€X›Ÿ^\‘ôX›\ú⁄]ôJÿöñ⁄◊K\HK]
JN¬àBàBàô]\õàŸ^\Œ¬üBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸYù]\ô\À[⁄KYö[ò[]ò[Y][€ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå——ïUTëT◊”“W—íSêS’êSQUS”àãà\⁄Œàîì’ëW“T’‘íP–S—ïUTëT◊”“W—Së’◊—SëãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàô\öYöYY€€ùòX›à»ŸX›\ö]RYàçNÃàãòY[ô‘ﬁ[Xõ€àìíQïKP]YÃåçãQïUã[ú›ù[Y[ùàëïUQã^⁄[ôŸTŸY€Y[ùàìî—W—ìì»ã^\ûNàååçãLLçHàKàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
]⁄Ÿ[äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYYàò[ŸHKå
N¬àBàYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëSó–P–—T‘◊’“—Sã—Só–”QSï“QZ\‹⁄[ôÀàãÿYôU‘õÿŸYYàò[ŸHKå
N¬àBÇàûH¬àÀ»KKHPSëU‘ñHëTUQT’
ÿ[ö]^ôYõŸHŸŸŸY⁄NùùYHõ›ô[àô\Ÿ[ù
HKKBà€€ú›ô\]Y\›õŸHH¬àŸX›\ö]RYàçNÃàãà^⁄[ôŸTŸY€Y[ùàìî—W—ìì»ãà[ú›ù[Y[ùàëïUQãà[ù\ùò[àåHãà⁄NàùYKàúõ€Q]NàååçãLLàNåMNåãà—]NàååçãLLLHMNåÃåãàN¬à€€ú›⁄QõY‘ô\Ÿ[ù[îô\]Y\›Hô\]Y\›õŸKõ⁄HOOHùYN¬Çà€€ú›ù]ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄[ùòY^Hã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJô\]Y\›õŸJKàJN¬à€€ú›ù]^H]ÿZ]ù]ô\Àù^

N¬à]ò]‘^[ÿYà[ûHHù[¬àûH»ò]‘^[ÿYHù]^»î””ãú\úŸJù]^
Hàù[»Hÿ]⁄»ò]‘^[ÿYHù[»BàYà
Yù]ô\Àõ⁄»\ò]‘^[ÿY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëù]\ô\»ô]⁄òZ[Yàã[í›]\Œàù]ô\Àú›]\Àô\]Y\›õŸTŸ[ùàô\]Y\›õŸK⁄QõY‘ô\Ÿ[ù[îô\]Y\›ÿYôU‘õÿŸYYàò[ŸHKå
N¬àBÇàÀ»KKHSî‘P’êU»ëT‘”î—H
ôYõ‹ôH[ûH\ú⁄[ô HKKBà€€ú›‹]ô[Ÿ^\»H\[Ÿàò]‘^[ÿYOOHõÿöôX›à	âàP\úò^Kö\–\úò^Jò]‘^[ÿY
H»ÿöôX›öŸ^\ ò]‘^[ÿY
Hà◊N¬à€€ú›[Ÿ^\—\àH€€X›Ÿ^\‘ôX›\ú⁄]ôJò]‘^[ÿYäN¬à€€ú›⁄RŸ^Pÿ[ôY]\»H»õ⁄Hãì“Hãõ‹[í[ù\ô\›ãõ‹[ó⁄[ù\ô\›óN¬à€€ú›⁄RŸ^Qõ›[ô[îò]»H⁄RŸ^Pÿ[ôY]\Àôö[ô

 HOà\úò^Kö\–\úò^Jò]‘^[ÿYÀñ⁄◊JJN¬à€€ú›ò]”⁄P\úò^Nà[ûV◊HH⁄RŸ^Qõ›[ô[îò]»»ò]‘^[ÿY€⁄RŸ^Qõ›[ô[îò]◊Hà◊N¬à€€ú›ò]’[Y\›[\\úò^Nà[ûV◊HH\úò^Kö\–\úò^Jò]‘^[ÿYÀù[Y\›[\
H»ò]‘^[ÿYù[Y\›[\à◊N¬à€€ú›ò]–\úò^S[ô›»H¬à[Y\›[\àò]’[Y\›[\\úò^Kõ[ô›à‹[éà\úò^Kö\–\úò^Jò]‘^[ÿYÀõ‹[äH»ò]‘^[ÿYõ‹[ãõ[ô›ààY⁄à\úò^Kö\–\úò^Jò]‘^[ÿYÀöY⁄
H»ò]‘^[ÿYöY⁄õ[ô›àà›Œà\úò^Kö\–\úò^Jò]‘^[ÿYÀõ› H»ò]‘^[ÿYõ›Àõ[ô›àà€‹ŸNà\úò^Kö\–\úò^Jò]‘^[ÿYÀò€‹ŸJH»ò]‘^[ÿYò€‹ŸKõ[ô›ààõ€[YNà\úò^Kö\–\úò^Jò]‘^[ÿYÀùõ€[YJH»ò]‘^[ÿYùõ€[YKõ[ô›àà⁄Nàò]”⁄P\úò^Kõ[ô›àN¬à€€ú›⁄P[Y€ú’⁄][Y\›[\»H⁄RŸ^Qõ›[ô[îò]»OOH[ôYö[ôY	âàò]”⁄P\úò^Kõ[ô›OOHò]’[Y\›[\\úò^Kõ[ô›	âàò]’[Y\›[\\úò^Kõ[ô›à¬Çà€€ú›ù[⁄P€›[ùHò]”⁄P\úò^Kôö[\ä
äHOààOOHù[àOOH[ôYö[ôY
Kõ[ô›¬à€€ú›[\S⁄P€›[ùHò]”⁄P\úò^Kôö[\ä
äHOààOOHàäKõ[ô›¬à€€ú›ôYÿ]]ôS⁄P€›[ùHò]”⁄P\úò^Kôö[\ä
äHOà\[ŸààOOHõù[Xô\àà	âàà
Kõ[ô›¬à€€ú›ò[Y⁄P€›[ùHò]”⁄P\úò^Kôö[\ä
äHOà\[ŸààOOHõù[Xô\àà	âààèH
Kõ[ô›¬Çà]ò]”⁄T›]\Œà›ö[ôŒ¬àYà
[⁄RŸ^Qõ›[ô[îò]»ò]”⁄P\úò^Kõ[ô›OOH
Hò]”⁄T›]\»HëêRSé¬à[ŸHYà
[⁄P[Y€ú’⁄][Y\›[\»ôYÿ]]ôS⁄P€›[ùà
Hò]”⁄T›]\»HîTïPSé¬à[ŸHYà
ò[Y⁄P€›[ùOOH
Hò]”⁄T›]\»HëêRSé¬à[ŸHò]”⁄T›]\»HîT‘»é¬ÇàÀ»KKHTî—Tà“P“ŒàŸ\»\úŸQ[îŸ\öY\»
Hù[ò›[€à\»€ŸXò\ŸBàÀ»X›X[H\Ÿ\»]ô\û]⁄\ôH[ŸJHô\Ÿ\ùôHHÿ[YH“Hò[Y\À‹àõ‹àÀ»[O»€€\\ôHò]»\úò^H\ôX›HYÿZ[ú›H\úŸYŸ\öY\ÀàKKBà€€ú›\úŸYŸ\öY\»H\úŸQ[îŸ\öY\ ò]‘^[ÿY
N¬à€€ú›\úŸ\ì⁄P€›[ùH\úŸYŸ\öY\Àõ⁄Kôö[\ä
äHOààOOHù[	âààOOH[ôYö[ôY
Kõ[ô›¬à]\úŸ\ïò[YSZ\€X]⁄\»H¬àõ‹à
]HH»HX]õZ[äò]”⁄P\úò^Kõ[ô›\úŸYŸ\öY\Àõ⁄Kõ[ô›
N»J  H¬à€€ú›ò]’ò[H\[Ÿàò]”⁄P\úò^V⁄WHOOHõù[Xô\àà»ò]”⁄P\úò^V⁄WHà
ò]”⁄P\úò^V⁄WHOOHù[ò]”⁄P\úò^V⁄WHOOH[ôYö[ôY»ù[àù[Xô\äò]”⁄P\úò^V⁄WJJN¬àYà
ò]’ò[OOH\úŸYŸ\öY\Àõ⁄V⁄WJH\úŸ\ïò[YSZ\€X]⁄\  Œ¬àBà€€ú›\úŸ\î›]\»H⁄RŸ^Qõ›[ô[îò]»	âà\úŸYŸ\öY\Àõ⁄Kõ[ô›OOHò]”⁄P\úò^Kõ[ô›	âà\úŸ\ïò[YSZ\€X]⁄\»OOH»îT‘»àà
⁄RŸ^Qõ›[ô[îò]»»ëêRSààëêRSäN¬ÇàÀ»KKHH’‘êQ—Nà‹ö]H\»ô]⁄	‹»ò]»^[ÿY
ô]»€€ù[ùZ\⁄ö[KàÀ»Ÿ\»õ››X⁄€›ô\ù‹ö]HHX\õY\à⁄[ô€KY^HHù]\ô\»ö[JKàÀ»[àëPQUêP“»[ôôKX⁄X⁄»“H\»›[ô\Ÿ[ù[àH›‹ôY€‹KàKKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›ò]‘\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåW‹ò]»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ò]—ù]õ€\àHò]‘\ô[ùõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW—ïUãò]‘\ô[ùõ€\ã⁄Ÿ[äHàù[¬Çà]T›‹òYŸT›]\»HëêRSé¬à]Qö[RYà›ö[ô»ù[Hù[¬à]P⁄X⁄‹›[Nà›ö[ô»ù[Hù[¬à]S⁄Tô\Ÿ\ùôY€îôXYòX⁄»Hò[ŸN¬àYà
ò]—ù]õ€\äH¬à€€ú›⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jù]^
KôYŸ\›
ö^äN¬à€€ú›ö[Sò[YHHò]◊”íQïW—ïU…ÿ⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKò]—ù]õ€\ã⁄Ÿ[äN¬àYà
Yö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àãù]^ò]—ù]õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬àBàQö[RYHö[RY¬àP⁄X⁄‹›[HH⁄X⁄‹›[N¬àYà
ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬à€€ú›ôXYòX⁄”⁄RŸ^HH⁄RŸ^Pÿ[ôY]\Àôö[ô

 HOà\úò^Kö\–\úò^JôXYòX⁄œÀñ⁄◊JJN¬àS⁄Tô\Ÿ\ùôY€îôXYòX⁄»HôXYòX⁄”⁄RŸ^HOOH[ôYö[ôY	âà\úò^Kö\–\úò^JôXYòX⁄÷‹ôXYòX⁄”⁄RŸ^WJH	âàôXYòX⁄÷‹ôXYòX⁄”⁄RŸ^WKõ[ô›OOHò]”⁄P\úò^Kõ[ô›¬àT›‹òYŸT›]\»HS⁄Tô\Ÿ\ùôY€îôXYòX⁄»»îT‘»ààëêRSé¬àBàBÇàÀ»KKHŒà€õHYà“Hõ›ô[à\ÿXõHõ›Y⁄\úŸ\ä”K‹ö]HHZ[ö[X[àÀ»T””UQ»“K[€õH\ùYòX›
Ÿ\\ò]Hö[KŸõ€\àúõ€HHXZ[à¬àÀ»\[[ôHKHŸ\»õ››X⁄‹à^[ôHõŸX›[€à»ÿ⁄[XJKàKKBà]”⁄T›]\»Hìì’–USTQé¬à]‘õ›–€›[ùH¬à]—ö[RYà›ö[ô»ù[Hù[¬à€€ú›⁄U\ÿXõT€—ò\àHò]”⁄T›]\»OOHîT‘»à	âà\úŸ\î›]\»OOHîT‘»à	âàT›‹òYŸT›]\»OOHîT‘»é¬àYà
⁄U\ÿXõT€—ò\äH¬à€€ú›⁄Uò[Y][€ëõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›⁄Uò[Y][€îﬁ[Xõ€õ€\àH⁄Uò[Y][€ëõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW—ïUTëT◊”“W’êSQUS”àã⁄Uò[Y][€ëõ€\ã⁄Ÿ[äHàù[¬àYà
⁄Uò[Y][€îﬁ[Xõ€õ€\äH¬à€€ú›”⁄Tõ›‹»H\úŸYŸ\öY\Àù[Y\›[\ÀõX\

ÀJHOà
¬à[Y\›[\à\ÿ⁄“\€  Kàﬁ[Xõ€àìíQïHãàŸX›\ö]RYàçNÃàãàù]\ô\–€‹ŸNà\úŸYŸ\öY\Àò€‹ŸV⁄WKàù]\ô\”⁄Nà\úŸYŸ\öY\Àõ⁄V⁄WKàÿ⁄[XUô\ú⁄[€éàõ◊€⁄W›ò[Y][€ó›åHãàJJN¬à€€ú›”⁄T›àHî””ãú›ö[ô⁄YûJ”⁄Tõ›‹ N¬à€€ú›”⁄P⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]J”⁄T›äKôYŸ\›
ö^äN¬à€€ú›—ö[Sò[YHHù]\ô\◊€⁄W›ò[Y][€ó”íQïWÃåçãLLó›◊ÃåçãLLLW…€”⁄P⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJ—ö[Sò[YK⁄Uò[Y][€îﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àYà
Yö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJ—ö[Sò[YKò\Xÿ][€ã⁄ú€€àã”⁄T›ã⁄Uò[Y][€îﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬àBà—ö[RYHö[RY¬àYà
ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬à‘õ›–€›[ùH\úò^Kö\–\úò^JôXYòX⁄ H»ôXYòX⁄Àõ[ô›à¬à”⁄T›]\»H‘õ›–€›[ùOOH”⁄Tõ›‹Àõ[ô›	âà‘õ›–€›[ùà»îT‘»ààëêRSé¬àH[ŸH¬à”⁄T›]\»HëêRSé¬àBàBàH[ŸH¬à”⁄T›]\»Hî““TQ”“W”ì’÷QU‘ì’ëSó’T–PìHé¬àBÇàÀ»KKHì”’–UT—H]\õZ[ò][€àKKBà]õ€›ÿ]\ŸNà›ö[ôŒ¬àYà
[⁄QõY‘ô\Ÿ[ù[îô\]Y\›
Hõ€›ÿ]\ŸHHîëTUQT’–ïQ◊”“W—ìQ◊”RT‘“Së»é¬à[ŸHYà
ò]”⁄T›]\»OOHëêRSäHõ€›ÿ]\ŸHHîì’íQTó‘ëT‘”î—W–Sì”PSHé¬à[ŸHYà
\úŸ\î›]\»OOHîT‘»äHõ€›ÿ]\ŸHHîTî—Tó–ïQ»é¬à[ŸHYà
T›‹òYŸT›]\»OOHîT‘»äHõ€›ÿ]\ŸHHìW‘’‘êQ—W—ì‘◊”“Hé¬à[ŸHYà
ò]”⁄T›]\»OOHîTïPSàò[Y⁄P€›[ùò]’[Y\›[\\úò^Kõ[ô›
àçJHõ€›ÿ]\ŸHHì“W‘ëT—Sï–ïU”ì’‘ëT—PTê“’T–PìHé¬à[ŸHYà
”⁄T›]\»OOHîT‘»äHõ€›ÿ]\ŸHHîT‘◊”“W’T–PìHé¬à[ŸHõ€›ÿ]\ŸHHì“W‘ëT—Sï–ïU”ì’‘ëT—PTê“’T–PìHé¬Çà€€ú››ô\ò[›]\»Hõ€›ÿ]\ŸHOOHîT‘◊”“W’T–PìHà»îT‘»àà
ò]”⁄T›]\»OOHëêRSà»îTïPSààëêRSäN¬à€€ú›ÿYôU‘õÿŸYYHõ€›ÿ]\ŸHOOHîT‘◊”“W’T–PìHé¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Ààô\]Y\›õŸTŸ[ùàô\]Y\›õŸKà⁄QõY‘ô\Ÿ[ù[îô\]Y\›àò]‘ô\‹€úŸR[ú‹X›[€éà¬à‹]ô[Ÿ^\Àà[Ÿ^\—\ãà⁄RŸ^Qõ›[ô[îò]Œà⁄RŸ^Qõ›[ô[îò]»ù[àò]–\úò^S[ô›Àà⁄P[Y€ú’⁄][Y\›[\Ààù[⁄P€›[ùà[\S⁄P€›[ùàôYÿ]]ôS⁄P€›[ùàò[Y⁄P€›[ùàKàò]”⁄T›]\Àà\úŸ\î›]\Àà\úŸ\ì⁄P€›[ùà\úŸ\ïò[YSZ\€X]⁄\ÀàT›‹òYŸT›]\ÀàQö[RYàP⁄X⁄‹›[KàS⁄Tô\Ÿ\ùôY€îôXYòX⁄Àà”⁄T›]\Àà‘õ›–€›[ùà—ö[RYà⁄P€›[ùàò]–\úò^S[ô›Àõ⁄Kà[Y\›[\€›[ùàò]–\úò^S[ô›Àù[Y\›[\àõ€›ÿ]\ŸKàôX]\ô\’[õÿ⁄ŸYàõ€›ÿ]\ŸHOOHîT‘◊”“W’T–PìHÇà»»ôù]\ô\”⁄P⁄[ôŸHãôù]\ô\”⁄T›⁄[ôŸHãõ€ô–ùZ[\›]Hãú⁄‹ùùZ[\›]Hãõ€ô’[ù⁄[ô[ô‘›]Hãú⁄‹ù€›ô\ö[ô‘›]HóBàà◊KàôX]\ô\‘›[õÿ⁄ŸYàõ€›ÿ]\ŸHOOHîT‘◊”“W’T–PìHÇà»»úõ€›ô\î›ãõôX\ï”ô^⁄SZY‹ò][€àãòÿ[[ô\î‹ôXY›]HóBàà»ôù]\ô\”⁄P⁄[ôŸHãôù]\ô\”⁄T›⁄[ôŸHãõ€ô–ùZ[\›]Hãú⁄‹ùùZ[\›]Hãõ€ô’[ù⁄[ô[ô‘›]Hãú⁄‹ù€›ô\ö[ô‘›]Hãúõ€›ô\î›ãõôX\ï”ô^⁄SZY‹ò][€àãòÿ[[ô\î‹ôXY›]HóKàÿYôU‘õÿŸYYàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àù]\ô\»“Hö[ò[ò[Y][€àòZ[\ôHãàÿYôU‘õÿŸYYàò[ŸKàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”—åW”“W—ëPUTëT»8†%ïRS’êSQUQ—ïUTëT◊”“W—ëPUTëT¬ãÀ¬ãÀ»ùZ[»Hàô]€K][õÿ⁄ŸYåH“HôX]\ô\»
ù]\ô\”⁄P⁄[ôŸKãÀ»ù]\ô\”⁄T›⁄[ôŸK€ô–ùZ[\›]K⁄‹ùùZ[\›]KãÀ»€ô’[ù⁄[ô[ô‘›]K⁄‹ù€›ô\ö[ô‘›]JHúõ€HHP’PS›‹ôY¬ãÀ»\ùYòX›
ô]ô\àôX€€\]YKHÿ[YHÿÿ]J‹ôXY]\õàõ›ô[à[àBãÀ»ÀOì[ôXYŸHô\Z\äKàHùZ[\›[ù⁄[ô[ô»›]\»\ôH[Ÿ[Y\»BãÀ»“Së”Hÿ]Y€‹öXÿ[öY[€»€€ùòYX›‹ûH⁄[][[ô[›\»›]\»\ôBãÀ»›ùX›\ò[H[\‹‹⁄XõKõ›ù\›⁄X⁄ŸYYù\àHòX›ÇãÀ¬ãÀ»õ»ÿ€‹ö[ôÀõ»ô\ôX›»KH\ŸH\ôH\ÿ‹ö\]ôH‹⁄][€ö[ô»›]\»€õKÇãÀ»õ»HYÀõ»‘ãõ»“Hÿ[Àõ»Uãõ»‹ôYZ‹Àõ»õ€›ô\àôX]\ô\ÀÇãÀ»õ»åà⁄[ôŸ\Ààõ»ô]»[àô]⁄
ôXY»€õHúõ€H[ôXYK\›‹ôY KÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇù\H‹⁄][€ö[ô‘›]HBàì”ë◊–ïRSTàî“‘ï–ïRSTàì”ë◊’Sï“SëSë»àî“‘ï–”’ëTíSë»ÇàìëUUêS”ì◊—TëP’S”êS–“Së—HàïSêUêRSPìHé¬Çö[ù\ôòXŸHù]\ô\”⁄Tõ›»¬à[Y\›[\à›ö[ôŒ¬àòY[ô—]Nà›ö[ôŒ¬àﬁ[Xõ€à›ö[ôŒ¬àôX]\ôQò[Z[NàëåW—ïUTëT◊‘’ïP’TëHé¬à›\úô[ùù]\ôP€‹ŸNàù[Xô\àù[¬à›\úô[ùù]\ôS⁄Nàù[Xô\àù[¬àöXŸP⁄[ôŸNàù[Xô\àù[¬àöXŸP⁄[ôŸT]X[]NàïêSQàïSêUêRSPìHé¬àù]\ô\”⁄P⁄[ôŸNàù[Xô\àù[¬àù]\ô\”⁄P⁄[ôŸT]X[]NàïêSQàïSêUêRSPìHé¬àù]\ô\”⁄T›⁄[ôŸNàù[Xô\àù[¬àù]\ô\”⁄T›⁄[ôŸT]X[]NàïêSQàïSêUêRSPìHàêSì”PS’T»é¬à‹⁄][€ö[ô‘›]Nà‹⁄][€ö[ô‘›]N¬à‹⁄][€ö[ô‘›]T]X[]NàïêSQàïSêUêRSPìHé¬àõ‹õ][Uô\ú⁄[€éà›ö[ôŒ¬à[ú]öY[ôYúŒà›ö[ô÷◊N¬à€›\òŸSX[öYô\›YŒàôX€‹ô›ö[ôÀ›ö[ô»ù[é¬àÿ[›[]Y]à›ö[ôŒ¬àÿ⁄[XUô\ú⁄[€éà›ö[ôŒ¬üBÇôù[ò›[€à€€\]Sù]\ô\”⁄Tõ›‹ ‘õ›‹Œà‘õ›÷◊K€›\òŸSX[öYô\›YŒàôX€‹ô›ö[ôÀ›ö[ô»ù[äNàù]\ô\”⁄Tõ›÷◊H¬à€€ú›ÿ[›[]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›õ‹õ][Uô\ú⁄[€àHëåW—ïUTëT◊”“W›åHé¬à€€ú›õ›‹Œàù]\ô\”⁄Tõ›÷◊HH◊N¬Çàõ‹à
]HH»H‘õ›‹Àõ[ô›»J  H¬à€€ú›õ›»H‘õ›‹÷⁄WN¬à€€ú›ô]àHHà»‘õ›‹÷⁄HHWHàù[¬à€€ú›€‹ŸHHõ›Àò›\úô[ùù]\ôP€‹ŸN¬à€€ú›⁄HHõ›Àò›\úô[ùù]\ôS⁄N¬ÇàÀ»KKHöXŸP⁄[ôŸHKKBà]öXŸP⁄[ôŸNàù[Xô\àù[Hù[¬à]öXŸP⁄[ôŸT]X[]Nàù]\ô\”⁄Tõ›÷»úöXŸP⁄[ôŸT]X[]HóHHïSêUêRSPìHé¬àYà
ô]à	âàô]ãò›\úô[ùù]\ôP€‹ŸHOOHù[	âà€‹ŸHOOHù[
H¬àöXŸP⁄[ôŸHH€‹ŸHHô]ãò›\úô[ùù]\ôP€‹ŸN¬àöXŸP⁄[ôŸT]X[]HHïêSQé¬àBÇàÀ»KKHù]\ô\”⁄P⁄[ôŸHKKBà]ù]\ô\”⁄P⁄[ôŸNàù[Xô\àù[Hù[¬à]ù]\ô\”⁄P⁄[ôŸT]X[]Nàù]\ô\”⁄Tõ›÷»ôù]\ô\”⁄P⁄[ôŸT]X[]HóHHïSêUêRSPìHé¬àYà
ô]à	âàô]ãò›\úô[ùù]\ôS⁄HOOHù[	âà⁄HOOHù[
H¬àù]\ô\”⁄P⁄[ôŸHH⁄HHô]ãò›\úô[ùù]\ôS⁄N¬àù]\ô\”⁄P⁄[ôŸT]X[]HHïêSQé¬àBÇàÀ»KKHù]\ô\”⁄T›⁄[ôŸH
^X⁄]ù[Nàô]ì“Hô\õ»‹àZ\‹⁄[ô»OàSêUêRSPìKô]ô\àòXúöXÿ]Y
HKKBà]ù]\ô\”⁄T›⁄[ôŸNàù[Xô\àù[Hù[¬à]ù]\ô\”⁄T›⁄[ôŸT]X[]Nàù]\ô\”⁄Tõ›÷»ôù]\ô\”⁄T›⁄[ôŸT]X[]HóHHïSêUêRSPìHé¬àYà
ù]\ô\”⁄P⁄[ôŸT]X[]HOOHïêSQà	âàô]à	âàô]ãò›\úô[ùù]\ôS⁄HOOHù[
H¬àYà
ô]ãò›\úô[ùù]\ôS⁄HOOH
H¬àù]\ô\”⁄T›⁄[ôŸT]X[]HHïSêUêRSPìHé»À»^X⁄]ù[HKHô]à“Hô\õ»YX[ú»	H⁄[ôŸH\»[ôYö[ôYõ›[ôö[ö]KŸòXúöXÿ]YàH[ŸH¬àù]\ô\”⁄T›⁄[ôŸHH
ù]\ô\”⁄P⁄[ôŸH\»ù[Xô\à»ô]ãò›\úô[ùù]\ôS⁄JH
àL¬àù]\ô\”⁄T›⁄[ôŸT]X[]HHïêSQé¬àBàBÇàÀ»KKH‹⁄][€ö[ô‘›]Nà⁄[ô€Hÿ]Y€‹öXÿ[öY[]]X[H^€\⁄]ôHûH€€ú›ùX›[€àKKBà]‹⁄][€ö[ô‘›]Nà‹⁄][€ö[ô‘›]HHïSêUêRSPìHé¬à]‹⁄][€ö[ô‘›]T]X[]Nàù]\ô\”⁄Tõ›÷»ú‹⁄][€ö[ô‘›]T]X[]HóHHïSêUêRSPìHé¬àYà
öXŸP⁄[ôŸT]X[]HOOHïêSQà	âàù]\ô\”⁄P⁄[ôŸT]X[]HOOHïêSQäH¬à‹⁄][€ö[ô‘›]T]X[]HHïêSQé¬à€€ú›»HöXŸP⁄[ôŸH\»ù[Xô\é¬à€€ú›ÿ»Hù]\ô\”⁄P⁄[ôŸH\»ù[Xô\é¬àYà
»OOHÿ»OOH
H¬à‹⁄][€ö[ô‘›]HHìëUUêS”ì◊—TëP’S”êS–“Së—Hé»À»ô]ô\à[ù\úô][ò⁄[ôŸYöXŸK”“H\»\ôX›[€ò[àH[ŸHYà
»à	âàÿ»à
H¬à‹⁄][€ö[ô‘›]HHì”ë◊–ïRSTé¬àH[ŸHYà
»	âàÿ»à
H¬à‹⁄][€ö[ô‘›]HHî“‘ï–ïRSTé¬àH[ŸHYà
»	âàÿ»
H¬à‹⁄][€ö[ô‘›]HHì”ë◊’Sï“SëSë»é¬àH[ŸHYà
»à	âàÿ»
H¬à‹⁄][€ö[ô‘›]HHî“‘ï–”’ëTíSë»é¬àBàBÇàõ›‹Àú\⁄
¬à[Y\›[\àõ›Àù[Y\›[\àòY[ô—]Nàõ›ÀùòY[ô—]Kàﬁ[Xõ€àõ›Àúﬁ[Xõ€àôX]\ôQò[Z[NàëåW—ïUTëT◊‘’ïP’TëHãà›\úô[ùù]\ôP€‹ŸNà€‹ŸKà›\úô[ùù]\ôS⁄Nà⁄KàöXŸP⁄[ôŸKàöXŸP⁄[ôŸT]X[]Kàù]\ô\”⁄P⁄[ôŸKàù]\ô\”⁄P⁄[ôŸT]X[]Kàù]\ô\”⁄T›⁄[ôŸKàù]\ô\”⁄T›⁄[ôŸT]X[]Kà‹⁄][€ö[ô‘›]Kà‹⁄][€ö[ô‘›]T]X[]Kàõ‹õ][Uô\ú⁄[€ãà[ú]öY[ôYúŒà»ò›\úô[ùù]\ôP€‹ŸHãò›\úô[ùù]\ôS⁄HóKà€›\òŸSX[öYô\›YÀàÿ[›[]Y]àÿ⁄[XUô\ú⁄[€éàõ€⁄W›åHãàJN¬àBÇàô]\õàõ›‹Œ¬üBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[YåK[⁄KYôX]\ô\À\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”—åW”“W—ëPUTëT»ãà\⁄ŒàêïRS’êSQUQ—ïUTëT◊”“W—ëPUTëT»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàôX]\ô\’\‘\‹Œà»ôù]\ô\”⁄P⁄[ôŸHãôù]\ô\”⁄T›⁄[ôŸHãõ€ô–ùZ[\›]Hãú⁄‹ùùZ[\›]Hãõ€ô’[ù⁄[ô[ô‘›]Hãú⁄‹ù€›ô\ö[ô‘›]HóKàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYYàò[ŸHKå
N¬àBÇàûH¬à€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õTﬁ[Xõ€õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›ôX]õ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåŸ\ö]ò]]ôWŸôX]\ô\»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ôX]ﬁ[Xõ€õ€\àHôX]õ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãôX]õ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õTﬁ[Xõ€õ€\àYôX]ﬁ[Xõ€õ€\äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YàãÿYôU‘õÿŸYYàò[ŸHKå
N¬àBÇà€€ú›—]HHô]»]J
N¬à€€ú›úõ€Q]HHô]»]J—]KôŸ][YJ
HHç
àå
àå
àL
N¬à€€ú›òY[ô—]T›àHúõ€Q]Kù“T”‘›ö[ô 
Kú€XŸJL
N¬ÇàÀ»KKH––UH
»ëPQHX›X[›‹ôY»\ùYòX›
ô]ô\àôX€€\]Y
HKKBà€€ú›õ‹õQö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õTﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à€€ú›–ÿ[ôY]\»Hõ‹õQö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
õ‹õX[^ôY”íQïW…›òY[ô—]T›üWÿ
JN¬àYà
–ÿ[ôY]\Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»›‹ôY»\ùYòX›õ›[ôõ‹à\»òY[ô»]KàãÿYôU‘õÿŸYYàò[ŸHKå
N¬àBà€€ú›—ö[HH–ÿ[ôY]\÷ÃN¬à€€ú››‹ôY‘õ›‹»H]ÿZ]ö]ôTôXYö[PûRY
—ö[KöY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J›‹ôY‘õ›‹ JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàî›‹ôY»ôXYXòX⁄»òZ[Yàã—ö[RYà—ö[KöYÿYôU‘õÿŸYYàò[ŸHKå
N¬àBà€€ú››‹ôY–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ›‹ôY‘õ›‹ JKôYŸ\›
ö^äN¬Çà€€ú›⁄Tô\Ÿ[ù[ì»H
›‹ôY‘õ›‹»\»‘õ›÷◊JKú€€YJ
äHOàãò›\úô[ùù]\ôS⁄HOOHù[	âàãò›\úô[ùù]\ôS⁄HOOH[ôYö[ôY
N¬àYà
[⁄Tô\Ÿ[ù[ì H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàî›‹ôY»\ùYòX›\»õ»›\úô[ùù]\ôS⁄Hò[Y\»KHÿ[õõ›ùZ[“HôX]\ô\»úõ€H]àã—ö[RYà—ö[KöYÿYôU‘õÿŸYYàò[ŸHKå
N¬àBÇà€€ú›€›\òŸSX[öYô\›YŒàôX€‹ô›ö[ôÀ›ö[ô»ù[àH¬à‘›‹ôYö[RYà—ö[KöYà‘›‹ôYö[Sò[YNà—ö[Kõò[YKà‘›‹ôY⁄X⁄‹›[Nà›‹ôY–⁄X⁄‹›[KàN¬ÇàÀ»KKH””TUH“P—Hõ‹àô\õŸX⁄Xö[]HKKBà€€ú›ù[åHH€€\]Sù]\ô\”⁄Tõ›‹ ›‹ôY‘õ›‹»\»‘õ›÷◊K€›\òŸSX[öYô\›Y N¬à€€ú›ù[åàH€€\]Sù]\ô\”⁄Tõ›‹ ›‹ôY‘õ›‹»\»‘õ›÷◊K€›\òŸSX[öYô\›Y N¬à€€ú››ö\H
õ›‹Œàù]\ô\”⁄Tõ›÷◊JHOàõ›‹ÀõX\

»ÿ[›[]Y]ããúô\›JHOàô\›
N¬à€€ú›ù[åP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ›ö\
ù[åJJJKôYŸ\›
ö^äN¬à€€ú›ù[åê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ›ö\
ù[åäJJKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKH””ïêQP’S”à“P“ŒàûH€€ú›ùX›[€à‹⁄][€ö[ô‘›]H\»H⁄[ô€BàÀ»öY[€»õ»õ›»ÿ[à€€»›]\»]€òŸHKHô\öYûH\¬àÀ»›ùX›\ò[H[û]ÿ^H
Yô[ú⁄]ôKõ›\‹›[YY
KàKKBà€€ú›€€ùòYX›[€ê€›[ùHù[åKôö[\ä
äHOà¬à€€ú›õY‹»H¬àãú‹⁄][€ö[ô‘›]HOOHì”ë◊–ïRSTãàãú‹⁄][€ö[ô‘›]HOOHî“‘ï–ïRSTãàãú‹⁄][€ö[ô‘›]HOOHì”ë◊’Sï“SëSë»ãàãú‹⁄][€ö[ô‘›]HOOHî“‘ï–”’ëTíSë»ãàKôö[\äõ€€X[äKõ[ô›¬àô]\õàõY‹»àN¬àJKõ[ô›¬ÇàÀ»KKH‘íUH»HVT’Së»Ÿ\ö]ò]]ôWŸôX]\ô\À”íQïHÿÿ][€ãôXYòX⁄Àô\öYûHKKBà€€ú›ö[Sò[YHH\ö]ò]]ô\◊—åW”“W”íQïW…›òY[ô—]T›üW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à€€ú›‹ö]T›àHî””ãú›ö[ô⁄YûJù[åJN¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à]‹ö]T›]\»Hìì’–USTQé¬àYà
[ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àã‹ö]T›ãôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬à‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]ôXY›]\»Hìì’–USTQé¬à]ôXYòX⁄‘õ›–€›[ùH¬àYà
ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬àôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JôXYòX⁄ H»ôXYòX⁄Àõ[ô›à¬àôXY›]\»HôXYòX⁄‘õ›–€›[ùOOHù[åKõ[ô›»îT‘»ààëêRSé¬àBÇàÀ»KKH’UH”’Sï»KKBà€€ú››]P€›[ù»H¬à”ë◊–ïRSTàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHì”ë◊–ïRSTäKõ[ô›à“‘ï–ïRSTàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHî“‘ï–ïRSTäKõ[ô›à”ë◊’Sï“SëSëŒàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHì”ë◊’Sï“SëSë»äKõ[ô›à“‘ï–”’ëTíSëŒàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHî“‘ï–”’ëTíSë»äKõ[ô›àëUUêS”ì◊—TëP’S”êS–“Së—Nàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHìëUUêS”ì◊—TëP’S”êS–“Së—HäKõ[ô›àSêUêRSPìNàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]HOOHïSêUêRSPìHäKõ[ô›àN¬à€€ú›[ò]òZ[XõP€›[ù»H¬àöXŸP⁄[ôŸNàù[åKôö[\ä
äHOàãúöXŸP⁄[ôŸT]X[]HOOHïSêUêRSPìHäKõ[ô›àù]\ô\”⁄P⁄[ôŸNàù[åKôö[\ä
äHOàãôù]\ô\”⁄P⁄[ôŸT]X[]HOOHïSêUêRSPìHäKõ[ô›àù]\ô\”⁄T›⁄[ôŸNàù[åKôö[\ä
äHOàãôù]\ô\”⁄T›⁄[ôŸT]X[]HOOHïêSQäKõ[ô›à‹⁄][€ö[ô‘›]Nàù[åKôö[\ä
äHOàãú‹⁄][€ö[ô‘›]T]X[]HOOHïSêUêRSPìHäKõ[ô›àN¬ÇàÀ»KKH”õ›“[ì⁄X⁄»
ÿ[YH›X\ô\»Hö\ú›åH\‹ HKKBà€€ú›\ÿ[›ŸYöY[—õ›[ôH»úÿ€‹ôHãùô\ôX›ãòÿ[ôY]Hãú›‹‹‹»ãú€ãù\ôŸ]Hãù\ôŸ]àãùHãùàãõ‹ô\íYãú⁄Y€ò[ãòöX\»ãúôX€€[Y[ô][€àóBàôö[\ä
äHOàù[åKú€€YJ
éà[ûJHOàà[àäJN¬à€€ú›”õ›“[ì⁄X⁄»H\ÿ[›ŸYöY[—õ›[ôõ[ô›OOH»îT‘◊”ì◊‘–”‘íSë◊”‘ó’ëTëP’—íQS»ààêRS—T–S’—Q—íQS◊—ì’Sëà	Ÿ\ÿ[›ŸYöY[—õ›[ôöõ⁄[äãä_X¬Çà€€ú››ô\ò[›]\»Bà‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»à	âàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âÇà€€ùòYX›[€ê€›[ùOOH	âà”õ›“[ì⁄X⁄Àú›\ù’⁄]
îT‘»äBà»îT‘»Çàà
‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\ÀàòY[ô—]NàòY[ô—]T›ãà›[õ›‹Œàù[åKõ[ô›à‹ö]T›]\ÀàôXY›]\ÀàôXYòX⁄‘õ›–€›[ùàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à€€ùòYX›[€ê€›[ùà›]P€›[ùÀà[ò]òZ[XõP€›[ùÀà”õ›“[ì⁄X⁄Àà€›\òŸSX[öYô\›YÀà[ôXYŸNàìHOààOà’‘ëQ”»Oàãà‘õ›–€›[ù\ŸYà›‹ôY‘õ›‹Àõ[ô›à€õ›€ì[Z]][€úŒà¬àëö\ú›õ›»ŸàHòY[ô»^H\»[ÿ^\»SêUêRSPìHX‹õ‹‹»[öY[»
õ»ô]ö[›\À[Z[ù]Hõ›»»YôàYÿZ[ú›
HKHûH\⁄Y€ãô]ô\àòXúöXÿ]YàãàìëUUêS”ì◊—TëP’S”êS–“Së—H\»ô\‹ùYŸ\\ò][Húõ€HH\ôX›[€ò[›]\»KH[ò⁄[ôŸYöXŸH‹à[ò⁄[ôŸY“H\»ô]ô\à€\‹⁄YöYY\»ùZ[\›[ù⁄[ô[ôÀ\àH^X⁄]ù[Kàãàî⁄[ô€H[ûHåKY^HíQïHÿ[\H€õHKHõ›õ€ŸàŸàù[À€][K\ﬁ[Xõ€€][KY^Hô[XXö[]Kàãàúõ€›ô\î›ôX\ï”ô^⁄SZY‹ò][€ãÿ[[ô\î‹ôXY›]Hô[XZ[à[Xô\ò][H[òùZ[
ô\]Z\ôH][KY^\ûH]Hõ›Y]ô]⁄Y
KàãàKàÿYôU‘õÿŸYYà›ô\ò[›]\»OOHîT‘»ãàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àåH“HôX]\ô\»ùZ[òZ[\ôHãàÿYôU‘õÿŸYYàò[ŸKàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”‘S”ó—UW—VSî“S”à8†%ïRS–Së’êSQUW”íQïW–—W‘W–UW‘T◊”RSïT◊Ã◊‘TSSëBãÀ¬ãÀ»^[ô»Hò[Y]Y⁄[ô€Hõ€[ôÀPUKP—Hÿ[\H»ôX[ö^Y\›öZŸBãÀ»—J‘H€€ùòX›»X‹õ‹‹»UKLÀãêUJÃ»õ‹àHôX\ô\›ò[YíQïH‹[€ÇãÀ»^\ûKà]ô\ûH€€ùòX›	‹»ŸX›\ö]RY\»ô\€€ôYúõ€H[â‹»X›X[ãÀ»[ú›ù[Y[ùX\›\à
ù[ÿÿ[ãô]ô\à›Y\‹ŸY
HKHHÿ[YH]\õà[ôXYBãÀ»õ›ô[àõ‹àù]\ô\Àà\›‹öXÿ[“À›õ€[YK”“H\»ô]⁄Y\àö^YãÀ»€€ùòX›öXH›åãÿ⁄\ùÀ⁄[ùòY^H
Hÿ[YH[ô⁄[ù[ôXYHõ›ô[ÇãÀ»ô[XXõHõ‹àù]\ô\»“JKì’H⁄[ô€Hõ€[ôÀPUHŸ\öY\»\ŸYôYõ‹ôKÇãÀ¬ãÀ»QU—”—÷Hì’H”àíT’‘íP–SUHà
ÿ›[Y[ùYõ›Y[äNàHù[BãÀ»\ã[Z[ù]K\ôKX[ò⁄‹ôYUH‹öY€›[ô\]Z\ôH[ò[ZXÿ[H›⁄]⁄[ô»⁄X⁄ãÀ»ö^Y€€ùòX›\»]Y\öYY\»‹›‹õ‹‹Ÿ\»›öZŸHõ›[ô\öY\»[ùòKY^HKBãÀ»]\»›]Ÿàÿ€‹Hõ‹à\»€X[ÿ[\Kà[ú›XYHUJ
H›öZŸH\¬ãÀ»[ò⁄‹ôY”ê—Húõ€HHŸ\‹⁄[€â‹»ö\ú›]òZ[XõH‹›öXŸH
NåMBãÀ»ÿ[ôJK\⁄[ô»íQïI‹»ôX[L\⁄[ù›öZŸH[ù\ùò[[ôHÿ[YH¬ãÀ»›öZŸ\»\ôH]Y\öYYõ‹àZ\àù[Y^H\›‹ûKà]ô\ûHõ›»\»›[ãÀ»⁄X⁄ŸYYÿZ[ú›HP’PS‹›]]‹X⁄YöX»Z[ù]H[ôõYŸŸYYÇãÀ»H[ò⁄‹à›öZŸH\»öYùY]ÿ^Húõ€HôZ[ô»Ÿ[ùZ[ô[HUH]]ãÀ»[€Y[ùKH€»öYù\»YX\›\ôY[ôô\‹ùYô]ô\à⁄[[ùH\‹›[YY]ÿ^KÇãÀ¬ãÀ»õ»åã—åÀ—çôX]\ô\Ààõ»][KY^\ûKàõ»Uàô\]Z\ô[Y[ùàõ»åà⁄[ôŸ\ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ﬁ[ò»ù[ò›[€à[îÿÿ[ìöYùS‹[€ê€€ùòX›—ù[
ﬁ[Xõ€\ò[Nà›ö[ô Nàõ€Z\ŸO¬àXY\ê€€Œà›ö[ô÷◊Hù[¬à›[õ›‹‘ÿÿ[õôYàù[Xô\é¬à‹õ›‹Œà[ê‹›îõ›÷◊N¬àô]⁄⁄Œàõ€€X[é¬à›]\Œàù[Xô\é¬üOà¬à€€ú›ô\»H]ÿZ]ô]⁄
öŒãÀ⁄[XYŸ\Àô[ãò€Àÿ\KY]Kÿ\K\ÿ‹ö\[X\›\ãò‹›àäN¬àYà
\ô\Àõ⁄»\ô\ÀòõŸJH¬àô]\õà»XY\ê€€Œàù[›[õ›‹‘ÿÿ[õôYà‹õ›‹Œà◊Kô]⁄⁄Œàò[ŸK›]\Œàô\Àú›]\»N¬àBà€€ú›ôXY\àHô\ÀòõŸKôŸ]ôXY\ä
N¬à€€ú›X€Ÿ\àHô]»^X€Ÿ\ä
N¬à]ùYôô\àHàé¬à]XY\ê€€Œà›ö[ô÷◊Hù[Hù[¬à€€ú›€€[ô^àôX€‹ô›ö[ôÀù[Xô\èàHﬂN¬à]›[õ›‹‘ÿÿ[õôYH¬à€€ú›‹õ›‹Œà[ê‹›îõ›÷◊HH◊N¬Çà⁄[H
ùYJH¬à€€ú›»€ôKò[YHHH]ÿZ]ôXY\ãúôXY

N¬àYà
€ôJHúôXZŒ¬àùYôô\à
œHX€Ÿ\ãôX€ŸJò[YK»›ôX[NàùYHJN¬à€€ú›[ô\»HùYôô\ãú‹]
óàäN¬àùYôô\àH[ô\Àú‹

Hœ»àé¬àõ‹à
€€ú›ò]”[ôHŸà[ô\ H¬à€€ú›[ôHHò]”[ôKùö[J
N¬àYà
[[ôJH€€ù[ùYN¬àYà
ZXY\ê€€ H¬àXY\ê€€»H[ôKú‹]
ãäN¬àXY\ê€€Àôõ‹ëXX⁄

JHOà»€€[ô^⁄ùö[J
WHHN»JN¬à€€ù[ùYN¬àBà›[õ›‹‘ÿÿ[õôY
 Œ¬à€€ú›€€»H[ôKú‹]
ãäN¬à€€ú›^⁄H€€÷ÿ€€[ô^»î—SW—VW—V““QóWHœ»àé¬à€€ú›[ú›\HH€€÷ÿ€€[ô^»î—SW“Sî’ïSQSï”êSQHóWHœ»àé¬àYà
^⁄OOHìî—Hà[ú›\HOOHì‘QäH€€ù[ùYN¬à€€ú›ﬁ[Sò[YHH
€€÷ÿ€€[ô^»î”W‘÷SPì””êSQHóWHœ»àäKù’\\êÿ\ŸJ
N¬à€€ú›òY[ô‘ﬁ[Xõ€H
€€÷ÿ€€[ô^»î—SW’êQSë◊‘÷SPì”óWHœ»àäKù’\\êÿ\ŸJ
N¬à€€ú›ﬁ[Xõ€X]⁄\»Hﬁ[Sò[YHOOHﬁ[Xõ€\ò[HòY[ô‘ﬁ[Xõ€OOHﬁ[Xõ€\ò[HòY[ô‘ﬁ[Xõ€ú›\ù’⁄]
ﬁ[Xõ€\ò[H
»ãHäN¬àYà
\ﬁ[Xõ€X]⁄\ H€€ù[ùYN¬à€€ú›õ›Œà[ê‹›îõ›»HﬂN¬àXY\ê€€Àôõ‹ëXX⁄

JHOà»õ›÷⁄ùö[J
WHH€€÷⁄WHœ»àé»JN¬à‹õ›‹Àú\⁄
õ› N¬àBàBàûH»]ÿZ]ôXY\ãòÿ[òŸ[

N»Hÿ]⁄ﬂBàô]\õà»XY\ê€€À›[õ›‹‘ÿÿ[õôY‹õ›‹Àô]⁄⁄ŒàùYK›]\Œàô\Àú›]\»N¬üBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[‹[€ãY]KY^[ú⁄[€ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”‘S”ó—UW—VSî“S”àãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
Hô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëSó–P–—T‘◊’“—Sã—Só–”QSï“QZ\‹⁄[ôÀàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬Çà€€ú›]Põÿ⁄Ÿ\úŒà›ö[ô÷◊HH◊N¬ÇàûH¬à€€ú›òY[ô—]T›àHååçãLLLHé¬à€€ú››öZŸT›\HL¬à€€ú››öZŸSŸôúŸ]»HÀLÀLãLKKã◊N¬ÇàÀ»KKH‘’
ù[Ÿ\‹⁄[€ãÿ[YHõ›ô[àÿ[
HKKBà€€ú›‹›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄[ùòY^Hã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJ»ŸX›\ö]RYàåL»ã^⁄[ôŸTŸY€Y[ùàíQ“Hã[ú›ù[Y[ùàíSëVã[ù\ùò[àåHã⁄Nàò[ŸKúõ€Q]Nà	›òY[ô—]T›üHNåMNå—]Nà	›òY[ô—]T›üHMNåÃåJKàJN¬à€€ú›‹›^H]ÿZ]‹›ô\Àù^

N¬à]‹›^[ÿYà[ûHHù[¬àûH»‹›^[ÿYH‹›^»î””ãú\úŸJ‹›^
Hàù[»Hÿ]⁄»‹›^[ÿYHù[»BàYà
\‹›ô\Àõ⁄»\‹›^[ÿY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàî‹›ô]⁄òZ[Yàã[í›]\Œà‹›ô\Àú›]\ÀÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àBà€€ú›‹›Ÿ\öY\»H\úŸQ[îŸ\öY\ ‹›^[ÿY
N¬àYà
‹›Ÿ\öY\Àúõ›–€›[ùOOH‹›Ÿ\öY\Àò€‹ŸVÃHOOHù[
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàî‹›Ÿ\öY\»[\H‹àö\ú›€‹ŸHù[KHÿ[õõ›[ò⁄‹àUKàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àBà€€ú›[ò⁄‹î‹›H‹›Ÿ\öY\Àò€‹ŸVÃH\»ù[Xô\é¬à€€ú›]T›öZŸHHôX\ô\›]T›öZŸJ[ò⁄‹î‹››öZŸT›\
N¬à€€ú›\ôŸ]›öZŸ\»H›öZŸSŸôúŸ]ÀõX\

ŸôäHOà]T›öZŸH
»Ÿôà
à›öZŸT›\
N¬ÇàÀ»KKHïS[ú›ù[Y[ù[X\›\àÿÿ[àõ‹àíQïH‘Q
ô]ô\à›Y\‹ŸY
HKKBà€€ú›ÿÿ[àH]ÿZ][îÿÿ[ìöYùS‹[€ê€€ùòX›—ù[
ìíQïHäN¬àYà
\ÿÿ[ãôô]⁄⁄»ÿÿ[ãõ‹õ›‹Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàí[ú›ù[Y[ùX\›\àÿÿ[àòZ[Y‹àõ›[ôõ»íQïH‘Qõ›‹ÀàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àBÇàÀ»KKHôX\ô\›ò[Y^\ûHèHòY[ô—]T›àKKBà€€ú›\›[ò›^\öY\»HÀããõô]»Ÿ]
ÿÿ[ãõ‹õ›‹ÀõX\

äHOàñ»î—SW—VTñW—UHóJKôö[\äõ€€X[äJWBàõX\

JHOà
»ò]ŒàK]Nàô]»]JJKôŸ][YJ
HJJBàôö[\ä
JHOàZ\”òSäKô]JH	âàKô]HèHô]»]JòY[ô—]T›äKôŸ][YJ
JBàú€‹ù

KäHOàKô]HHãô]JN¬àYà
\›[ò›^\öY\Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»ò[YíQïH‘Q^\ûHõ›[ô€ãÿYù\àòY[ô»]KàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àBà€€ú›^\ûU\ŸYH\›[ò›^\öY\÷ÃKúò]Œ¬à€€ú›^\ûQ]HH^\ûU\ŸYú€XŸJL
N¬à€€ú›\‘\ë^HHç
àå
àå
àL¬à€€ú›HHX]úõ›[ô

ô]»]J^\ûQ]H
»ïååàäKôŸ][YJ
HHô]»]JòY[ô—]T›à
»ïååàäKôŸ][YJ
JH»\‘\ë^JN¬ÇàÀ»KKHô\€€ôHXX⁄ŸàHM€€ùòX›»
»›öZŸ\»—K‘JHúõ€HHX\›\àKKBà\H€€ùòX›[àH»ŸôúŸ]àù[Xô\é»›öZŸNàù[Xô\é»⁄YNàê—HàîHé»ŸX›\ö]RYà›ö[ô»ù[»òY[ô‘ﬁ[Xõ€à›ö[ô»ù[N¬à€€ú›€€ùòX›[úŒà€€ùòX›[ñ◊HH◊N¬àõ‹à
€€ú››öZŸHŸà\ôŸ]›öZŸ\ H¬àõ‹à
€€ú›⁄YHŸà»ê—HãîHóH\»€€ú›
H¬à€€ú›X]⁄Hÿÿ[ãõ‹õ›‹Àôö[ô

äHOÇàñ»î—SW—VTñW—UHóHOOH^\ûU\ŸY	âÇàX]úõ›[ô
\úŸQõÿ]
ñ»î—SW‘’íR—W‘íP—HóHìòSàäJHOOH›öZŸH	âÇà
ñ»î—SW”‘S”ó’THóHàäKù’\\êÿ\ŸJ
HOOH⁄YBà
N¬à€€ùòX›[úÀú\⁄
¬àŸôúŸ]à
›öZŸHH]T›öZŸJH»›öZŸT›\à›öZŸKà⁄YKàŸX›\ö]RYàX]⁄»X]⁄»î—SW‘”T’‘—P’TíUW“QóHàù[àòY[ô‘ﬁ[Xõ€àX]⁄»X]⁄»î—SW’êQSë◊‘÷SPì”óHàù[àJN¬àBàBà€€ú›[úô\€€ôY€€ùòX›»H€€ùòX›[úÀôö[\ä

HOà\úŸX›\ö]RY
N¬ÇàÀ»KKHô]⁄XX⁄ô\€€ôY€€ùòX›	‹»ù[Y^H\›‹ûK‹ö]HJ”ã€€X›õ‹à»KKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›ò]‘\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåW‹ò]»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›Y[ù]T\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåó⁄Y[ù]Hã›‹ôTõ€›⁄Ÿ[äHàù[¬àYà
\ò]‘\ô[ùõ€\àZY[ù]T\ô[ùõ€\äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YàãÿYôU–ùZ[åéàò[ŸKÿYôU–ùZ[åŒàò[ŸKÿYôU–ùZ[çàò[ŸHKå
N¬àBÇà\H€€ùòX›ô\›[H€€ùòX›[à	à¬àô]⁄›]\Œà›ö[ôŒ»õ›–€›[ùàù[Xô\é»Qö[RYà›ö[ô»ù[»P⁄X⁄‹›[Nà›ö[ô»ù[¬àëö[RYà›ö[ô»ù[»ù[⁄P€›[ùàù[Xô\é»ôYÿ]]ôP€›[ùàù[Xô\é»\Xÿ]U[Y\›[\Œàù[Xô\é¬àŸ\öY\œŒà[î\úŸYŸ\öY\Œ¬àN¬à€€ú›€€ùòX›ô\›[Œà€€ùòX›ô\›[◊HH◊N¬Çàõ‹à
€€ú›[àŸà€€ùòX›[ú H¬àYà
\[ãúŸX›\ö]RY
H¬à€€ùòX›ô\›[Àú\⁄
»ããú[ãô]⁄›]\ŒàïSêUêRSPìW”ì’“Só“Sî’ïSQSï”PT’Tàãõ›–€›[ùàQö[RYàù[P⁄X⁄‹›[Nàù[ëö[RYàù[ù[⁄P€›[ùàôYÿ]]ôP€›[ùà\Xÿ]U[Y\›[\ŒàJN¬à€€ù[ùYN¬àBà€€ú›‹ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄[ùòY^Hã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJ»ŸX›\ö]RYà›ö[ô [ãúŸX›\ö]RY
K^⁄[ôŸTŸY€Y[ùàìî—W—ìì»ã[ú›ù[Y[ùàì‘Qã[ù\ùò[àåHã⁄NàùYKúõ€Q]Nà	›òY[ô—]T›üHNåMNå—]Nà	›òY[ô—]T›üHMNåÃåJKàJN¬à€€ú›‹^H]ÿZ]‹ô\Àù^

N¬à]‹^[ÿYà[ûHHù[¬àûH»‹^[ÿYH‹^»î””ãú\úŸJ‹^
Hàù[»Hÿ]⁄»‹^[ÿYHù[»BàYà
[‹ô\Àõ⁄»[‹^[ÿY
H¬à€€ùòX›ô\›[Àú\⁄
»ããú[ãô]⁄›]\ŒàëU“—êRSQ“…€‹ô\Àú›]\ﬂXõ›–€›[ùàQö[RYàù[P⁄X⁄‹›[Nàù[ëö[RYàù[ù[⁄P€›[ùàôYÿ]]ôP€›[ùà\Xÿ]U[Y\›[\ŒàJN¬à€€ù[ùYN¬àBà€€ú›Ÿ\öY\»H\úŸQ[îŸ\öY\ ‹^[ÿY
N¬à€€ú›ŸY[ï»Hô]»Ÿ]ù[Xô\èä
N¬à]\Xÿ]U[Y\›[\»H¬àŸ\öY\Àù[Y\›[\Àôõ‹ëXX⁄

 HOà»Yà
ŸY[ïÀö\  JH\Xÿ]U[Y\›[\  Œ»ŸY[ïÀòY
 N»JN¬à€€ú›ù[⁄P€›[ùHŸ\öY\Àõ⁄Kôö[\ä
äHOààOOHù[
Kõ[ô›¬à€€ú›ôYÿ]]ôP€›[ùHÀããúŸ\öY\Àõ⁄KããúŸ\öY\Àùõ€[YWKôö[\ä
äHOà\[ŸààOOHõù[Xô\àà	âàà
Kõ[ô›¬ÇàÀ»Bà€€ú›\‹Ÿ]Xô[HíQïW”‘…‹[ãú⁄Y_W–UI‹[ãõŸôúŸ]èH»ä»à
»[ãõŸôúŸ]à[ãõŸôúŸ]X¬à€€ú›ò]–\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[ò]‘\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›P⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]J‹^
KôYŸ\›
ö^äN¬à€€ú›Qö[Sò[YHHò]◊…ÿ\‹Ÿ]Xô[W…€P⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]Qö[RYHò]–\‹Ÿ]õ€\à»]ÿZ]ö]ôQö[ôö[PûSò[YJQö[Sò[YKò]–\‹Ÿ]õ€\ã⁄Ÿ[äHàù[¬àYà
[Qö[RY	âàò]–\‹Ÿ]õ€\äH¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJQö[Sò[YKò\Xÿ][€ã⁄ú€€àã‹^ò]–\‹Ÿ]õ€\ã⁄Ÿ[äN¬àQö[RYH\ÀöYœ»ù[¬àBÇàÀ»Çà€€ú›Y[ù]P\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[Y[ù]T\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›Y[ù]HH¬àﬁ[Xõ€àìíQïHã[ú›ù[Y[ùàì‘Qã‹[€ï\Nà[ãú⁄YK›öZŸNà[ãú›öZŸKà]SŸôúŸ]à[ãõŸôúŸ]^\ûNà^\ûQ]KKŸX›\ö]RYà[ãúŸX›\ö]RYàòY[ô‘ﬁ[Xõ€à[ãùòY[ô‘ﬁ[Xõ€òY[ô—]NàòY[ô—]T›ãàQö[RYP⁄X⁄‹›[KàN¬à€€ú›Y›àHî””ãú›ö[ô⁄YûJY[ù]JN¬à€€ú›Y⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]JY›äKôYŸ\›
ö^äN¬à€€ú›ëö[Sò[YHHY[ù]W…ÿ\‹Ÿ]Xô[W…⁄Y⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ëö[RYHY[ù]P\‹Ÿ]õ€\à»]ÿZ]ö]ôQö[ôö[PûSò[YJëö[Sò[YKY[ù]P\‹Ÿ]õ€\ã⁄Ÿ[äHàù[¬àYà
[ëö[RY	âàY[ù]P\‹Ÿ]õ€\äH¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJëö[Sò[YKò\Xÿ][€ã⁄ú€€àãY›ãY[ù]P\‹Ÿ]õ€\ã⁄Ÿ[äN¬àëö[RYH\ÀöYœ»ù[¬àBÇà€€ùòX›ô\›[Àú\⁄
»ããú[ãô]⁄›]\ŒàîT‘»ãõ›–€›[ùàŸ\öY\Àúõ›–€›[ùQö[RYP⁄X⁄‹›[Këö[RYù[⁄P€›[ùôYÿ]]ôP€›[ù\Xÿ]U[Y\›[\ÀŸ\öY\»JN¬àBÇà€€ú›ô\€€ôYô\›[»H€€ùòX›ô\›[Àôö[\ä
äHOàãôô]⁄›]\»OOHîT‘»äN¬à€€ú›ŸTô\›[»Hô\€€ôYô\›[Àôö[\ä
äHOàãú⁄YHOOHê—HäN¬à€€ú›Tô\›[»Hô\€€ôYô\›[Àôö[\ä
äHOàãú⁄YHOOHîHäN¬Çàù[ò›[€à⁄YT›[[X\ûJô\›[Œà€€ùòX›ô\›[◊JH¬à€€ú›ò[Y›öZŸT€›»Hô\›[Àôö[\ä
äHOàãúõ›–€›[ùà
Kõ[ô›¬à€€ú›“‘›]\»Hò[Y›öZŸT€›»OOH»»îT‘»àà
ò[Y›öZŸT€›»à»îTïPSààëêRSäN¬à€€ú›õ€[YT›]\»Hô\›[Àô]ô\ûJ
äHOàãúŸ\öY\»	âàãúŸ\öY\Àùõ€[YKú€€YJ
äHOààOOHù[
JH	âàò[Y›öZŸT€›»à»îT‘»àà
ò[Y›öZŸT€›»à»îTïPSààëêRSäN¬à€€ú›“T›]\»Hô\›[Àô]ô\ûJ
äHOàãúŸ\öY\»	âàãúŸ\öY\Àõ⁄Kú€€YJ
äHOààOOHù[
JH	âàò[Y›öZŸT€›»à»îT‘»àà
ò[Y›öZŸT€›»à»îTïPSààëêRSäN¬àô]\õà¬àô\]Y\›Y›öZŸT€›ŒàÀàò[Y›öZŸT€›ÀàZ\‹⁄[ô‘›öZŸT€›Œà»Hò[Y›öZŸT€›Àà“‘›]\Àõ€[YT›]\À“T›]\ÀàN¬àBà€€ú›—HH⁄YT›[[X\ûJ€€ùòX›ô\›[Àôö[\ä
äHOàãú⁄YHOOHê—HäJN¬à€€ú›HH⁄YT›[[X\ûJ€€ùòX›ô\›[Àôö[\ä
äHOàãú⁄YHOOHîHäJN¬ÇàÀ»KKHUàô\‹ùYŸ\\ò][Kô]ô\àô\]Z\ôYKKBà€€ú›]îô\‹ùHô\€€ôYô\›[ÀõX\

äHOà
¬àŸôúŸ]àãõŸôúŸ]⁄YNàãú⁄YKà]îô\Ÿ[ùàãúŸ\öY\»»ãúŸ\öY\Àö]ãú€€YJ
äHOààOOHù[
Hàò[ŸKàJJN¬ÇàÀ»KKHUHX\[ô»ò[Y][€àKKBà]]SZ\€X]⁄€›[ùH¬àõ‹à
]HH»H‹›Ÿ\öY\Àù[Y\›[\Àõ[ô›»J  H¬à€€ú›»H‹›Ÿ\öY\Àò€‹ŸV⁄WN¬àYà
»OOHù[
H€€ù[ùYN¬à€€ú›ùYP]P]\”Z[ù]HHôX\ô\›]T›öZŸJÀ›öZŸT›\
N¬àYà
ùYP]P]\”Z[ù]HOOH]T›öZŸJH]SZ\€X]⁄€›[ù
 Œ¬àBà€€ú›]SX\[ô‘›]\»H[úô\€€ôY€€ùòX›Àõ[ô›OOH»
]SZ\€X]⁄€›[ùOOH»îT‘»ààîTïPSäHàîTïPSé¬àYà
]SZ\€X]⁄€›[ùà
H]Põÿ⁄Ÿ\úÀú\⁄
UW—íQïàŸ\‹⁄[€àUH[ò⁄‹à
	ÿ]T›öZŸ_JHYôô\ôYúõ€HHùYH\ã[Z[ù]HUHõ‹à	ÿ]SZ\€X]⁄€›[ùK…‹‹›Ÿ\öY\Àúõ›–€›[ùHZ[ù]\»KHÿ›[Y[ùYõ›⁄[[ùH€‹úôX›Yò
N¬àYà
[úô\€€ôY€€ùòX›Àõ[ô›à
H]Põÿ⁄Ÿ\úÀú\⁄
SîëT””ëQ–””ïêP’Œà	›[úô\€€ôY€€ùòX›ÀõX\


HOà	‹ú⁄Y_I‹õŸôúŸ]èH»ä»à
»õŸôúŸ]àõŸôúŸ]X
Köõ⁄[äãä_Hõ›õ›[ô[à[ú›ù[Y[ùX\›\àõ‹à^\ûH	Ÿ^\ûQ]_Kò
N¬ÇàÀ»KKH[Y\›[\ﬁ[ò⁄õ€ö^ò][€àX‹õ‹‹»—K‘K‹‹›KKBà€€ú›‹›‘Ÿ]Hô]»Ÿ]
‹›Ÿ\öY\Àù[Y\›[\ N¬à]ﬁ[ò”Z\€X]⁄€›[ùH¬àõ‹à
€€ú›àŸàô\€€ôYô\›[ H¬àYà
\ãúŸ\öY\ H€€ù[ùYN¬àõ‹à
€€ú›»ŸàãúŸ\öY\Àù[Y\›[\ H¬àYà
\‹›‘Ÿ]ö\  JHﬁ[ò”Z\€X]⁄€›[ù
 Œ¬àBàBà€€ú›[Y\›[\ﬁ[ò⁄õ€ö^ò][€î›]\»Hô\€€ôYô\›[Àõ[ô›OOH»ëêRSàà
ﬁ[ò”Z\€X]⁄€›[ùOOH»îT‘»ààîTïPSäN¬ÇàÀ»KKHŒàﬁ[ò⁄õ€ö^ôY€€Xö[ôYôX€‹ô»
€ô»õ‹õX]€ôHõ›»\à[Y\›[\\àô\€€ôY€€ùòX›
HKKBà€€ú›‘õ›‹Œà[ûV◊HH◊N¬àõ‹à
€€ú›àŸàô\€€ôYô\›[ H¬àYà
\ãúŸ\öY\ H€€ù[ùYN¬àõ‹à
]HH»HãúŸ\öY\Àù[Y\›[\Àõ[ô›»J  H¬à€€ú›»HãúŸ\öY\Àù[Y\›[\÷⁄WN¬à€€ú›‹›YH‹›Ÿ\öY\Àù[Y\›[\Àö[ô^Ÿä N¬à€€ú›‹›H‹›YèH»‹›Ÿ\öY\Àò€‹ŸV‹‹›YHàù[¬à€€ú›\”⁄»HãúŸ\öY\Àò€‹ŸV⁄WHOOHù[¬à‘õ›‹Àú\⁄
¬à[Y\›[\à\ÿ⁄“\€  KàòY[ô—]NàòY[ô—]T›ãàﬁ[Xõ€àìíQïHãà‹›à]T›öZŸKà›öZŸNàãú›öZŸKà]SŸôúŸ]àãõŸôúŸ]à‹[€ï\Nàãú⁄YKà‹[éàãúŸ\öY\Àõ‹[ñ⁄WKY⁄àãúŸ\öY\ÀöY⁄⁄WK›ŒàãúŸ\öY\Àõ›÷⁄WK€‹ŸNàãúŸ\öY\Àò€‹ŸV⁄WKàõ€[YNàãúŸ\öY\Àùõ€[YV⁄WK⁄NàãúŸ\öY\Àõ⁄V⁄WKà^\ûNà^\ûQ]KKà]X[]Nà\”⁄»	âà‹›OOHù[»ïêSQààîTïPSãàÿ⁄[XUô\ú⁄[€éàõ◊€‹[€óŸ‹öY›åHãàJN¬àBàBà€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬ÇàÀ»€€\]H⁄XŸHõ‹àô\õŸX⁄Xö[]Bà€€ú›‘›åHHî””ãú›ö[ô⁄YûJ‘õ›‹ N¬à€€ú›–⁄X⁄‹›[LHH‹ôX]R\⁄
ú⁄LçMàäKù\]J‘›åJKôYŸ\›
ö^äN¬à€€ú›–⁄X⁄‹›[LàH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ‘õ›‹ JKôYŸ\›
ö^äN»À»ÿ[YH[ã[Y[[‹ûHõ›‹ÀôK\›ö[ô⁄YöYYà€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄H–⁄X⁄‹›[LHOOH–⁄X⁄‹›[Lé¬Çà]’‹ö]T›]\»Hìì’–USTQé¬à]—ö[RYà›ö[ô»ù[Hù[¬àYà
õ‹õS‹õ€\äH¬à€€ú›—ö[Sò[YHH‹[€óŸ‹öY–UW‘L◊”íQïW…›òY[ô—]T›üW…€–⁄X⁄‹›[LKú€XŸJMä_Köú€€ò¬à—ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJ—ö[Sò[YKõ‹õS‹õ€\ã⁄Ÿ[äN¬àYà
[—ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJ—ö[Sò[YKò\Xÿ][€ã⁄ú€€àã‘›åKõ‹õS‹õ€\ã⁄Ÿ[äN¬à—ö[RYH\ÀöYœ»ù[¬à’‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à’‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBàBà]‘ôXY›]\»Hìì’–USTQé¬à]‘ôXYòX⁄‘õ›–€›[ùH¬àYà
—ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
—ö[RY⁄Ÿ[äN¬à‘ôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JôXYòX⁄ H»ôXYòX⁄Àõ[ô›à¬à‘ôXY›]\»H‘ôXYòX⁄‘õ›–€›[ùOOH‘õ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú›U‹ö]TôXY›]\»Hô\€€ôYô\›[Àô]ô\ûJ
äHOàãõQö[RY
H	âàô\€€ôYô\›[Àõ[ô›à»îT‘»àà
ô\€€ôYô\›[Àú€€YJ
äHOàãõQö[RY
H»îTïPSààëêRSäN¬à€€ú›ï‹ö]TôXY›]\»Hô\€€ôYô\›[Àô]ô\ûJ
äHOàãõëö[RY
H	âàô\€€ôYô\›[Àõ[ô›à»îT‘»àà
ô\€€ôYô\›[Àú€€YJ
äHOàãõëö[RY
H»îTïPSààëêRSäN¬à€€ú›[ôXYŸT›]\»HU‹ö]TôXY›]\»OOHîT‘»à	âàï‹ö]TôXY›]\»OOHîT‘»à	âàô\€€ôYô\›[Àô]ô\ûJ
äHOàãõP⁄X⁄‹›[JH»îT‘»ààîTïPSé¬Çà€€ú››ô\ò[›]\»Bà—Kì“‘›]\»OOHîT‘»à	âàKì“‘›]\»OOHîT‘»à	âà—Kì“T›]\»OOHëêRSà	âàKì“T›]\»OOHëêRSà	âÇàU‹ö]TôXY›]\»OOHîT‘»à	âàï‹ö]TôXY›]\»OOHîT‘»à	âà’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âà‘ôXY›]\»OOHîT‘»à	âÇàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âà]SX\[ô‘›]\»OOHëêRSà	âà[Y\›[\ﬁ[ò⁄õ€ö^ò][€î›]\»OOHëêRSÇà»îT‘»Çàà

—Kùò[Y›öZŸT€›»àKùò[Y›öZŸT€›»à
H»îTïPSààëêRSäN¬Çà€€ú›ÿYôU–ùZ[åàH›ô\ò[›]\»OOHîT‘»é¬à€€ú›ÿYôU–ùZ[å»H›ô\ò[›]\»OOHîT‘»é¬à€€ú›ÿYôU–ùZ[çHò[ŸN»À»‹ôYZ‹À“Uà^X⁄]Hõ›õ›ô[à\ÿXõH\ôHKH[ÿ^\»ò[ŸHúõ€H\»›\ôYÿ\ô\‹»Ÿà›ô\ò[›]\¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Àà^\ûU\ŸYà^\ûQ]KàKà]T›öZŸP[ò⁄‹éà]T›öZŸKà[ò⁄‹î‹›à[Y\›[\’\›Yà‹›Ÿ\öY\Àúõ›–€›[ùà\ôŸ]›öZŸ\Àà—KKà]îô\‹ùYŸ\\ò][Nà]îô\‹ùà]SX\[ô‘›]\Àà]SZ\€X]⁄€›[ùà[Y\›[\ﬁ[ò⁄õ€ö^ò][€î›]\Ààﬁ[ò”Z\€X]⁄€›[ùà[úô\€€ôY€€ùòX›Œà[úô\€€ôY€€ùòX›ÀõX\


HOà
»›öZŸNàú›öZŸK⁄YNàú⁄YKŸôúŸ]àõŸôúŸ]JJKàU‹ö]TôXY›]\Ààï‹ö]TôXY›]\Àà’‹ö]TôXY›]\Œà’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âà‘ôXY›]\»OOHîT‘»à»îT‘»àà
’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäKà‘õ›–€›[ùà‘õ›‹Àõ[ô›à‘ôXYòX⁄‘õ›–€›[ùà—ö[RYà[ôXYŸT›]\Ààô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à]Põÿ⁄Ÿ\úÀà\ê€€ùòX›à€€ùòX›ô\›[ÀõX\

äHOà
¬à›öZŸNàãú›öZŸK⁄YNàãú⁄YKŸôúŸ]àãõŸôúŸ]ŸX›\ö]RYàãúŸX›\ö]RYàô]⁄›]\Œàãôô]⁄›]\Àõ›–€›[ùàãúõ›–€›[ùù[⁄P€›[ùàãõù[⁄P€›[ùàôYÿ]]ôP€›[ùàãõôYÿ]]ôP€›[ù\Xÿ]U[Y\›[\Œàãô\Xÿ]U[Y\›[\ÀàQö[RYàãõQö[RYëö[RYàãõëö[RYàJJKàY]Ÿ€ŸﬁSõ›NàêUJ
H[ò⁄‹ôY€òŸHúõ€HHNåMHŸ\‹⁄[€ã[‹[à‹›
íQïHL\⁄[ù›öZŸH[ù\ùò[
Kõ›ôKX[ò⁄‹ôY\àZ[ù]HKHŸYH\ò⁄]X›\ôTõ€H€€[Y[ù[à€›\òŸKà]SZ\€X]⁄€›[ùô\‹ù»›»X[ûHZ[ù]\»HùYH\ã[Z[ù]HUH€›[]ôHYôô\ôYúõ€H\»[ò⁄‹ã€»öYù\»YX\›\ôYô]ô\à⁄[[ùH\‹›[YY]ÿ^KàãàÿYôU–ùZ[åãàÿYôU–ùZ[åÀàÿYôU–ùZ[çàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à‹[€à]H^[ú⁄[€àòZ[\ôHãà]Põÿ⁄Ÿ\úÀàÿYôU–ùZ[åéàò[ŸKàÿYôU–ùZ[åŒàò[ŸKàÿYôU–ùZ[çàò[ŸKàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å——SêSRP◊–UW”PTSë»8†%ëSPT—VT’Së◊”‘S”ó—UW’◊’ïQW‘Tó’SQT’ST–UW”—ëî—U¬ãÀ¬ãÀ»\ôHò[úŸõ‹õX][€àŸàH[ôXYK\›‹ôYíQïH—K‘HUKLÀãäÃ»»‹öYÇãÀ»õ»ô]»[àô]⁄à‹öY⁄[ò[ö^Y\›öZŸHK”ã”»\ùYòX›»\ôHôXY[€õBãÀ»[ú]»\ôH[ô\ôHô]ô\à[ŸYöYYàõ‹à]ô\ûH[Y\›[\[ô\[ô[ùKãÀ»ôX€€\]\»HïQHUHúõ€H][Y\›[\	‹»›€à‹›ò[YH
ô]ô\àBãÀ»Ÿ\‹⁄[€ã[‹[à[ò⁄‹äK[ôô\‹ù»^X›H⁄X⁄Up¨L»€›»Hö^YãÀ»À\›öZŸHò\⁄Ÿ]ÿ[à[ôÿ[õõ›X›X[H€›ô\à\»H^I‹»UHöYùÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸY[ò[ZXÀX]K[X\[ôÀ\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå——SêSRP◊–UW”PTSë»ãà\⁄ŒàîëSPT—VT’Së◊”‘S”ó—UW’◊’ïQW‘Tó’SQT’ST–UW”—ëî—U»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YààKå
N¬ÇàûH¬à€€ú›òY[ô—]T›àHååçãLLLHé¬à€€ú››öZŸT›\HL¬ÇàÀ»KKH––UH
»ëPQHX›X[›‹ôYö^Y\›öZŸH»‹[€à‹öY
ô]ô\àôX€€\]Yô]ô\àôYô]⁄Y
HKKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YààKå
N¬Çà€€ú›ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›ÿ[ôY]\»Hö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
‹[€óŸ‹öY–UW‘L◊”íQïW…›òY[ô—]T›üWÿ
JN¬àYà
ÿ[ôY]\Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»›‹ôYö^Y\›öZŸH‹[€à‹öYõ›[ôõ‹à\»òY[ô»]KààKå
N¬àBà€€ú›€›\òŸQö[HHÿ[ôY]\÷ÃN¬à€€ú››‹ôYõ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
€›\òŸQö[KöY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J›‹ôYõ›‹ H›‹ôYõ›‹Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàî›‹ôY‹[€à‹öYôXYXòX⁄»òZ[Y‹à[\Kàã€›\òŸQö[RYà€›\òŸQö[KöYKå
N¬àBà€€ú››‹ôYö^Y›öZŸ\»HÀããõô]»Ÿ]
›‹ôYõ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬à€€ú›€›\òŸP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ›‹ôYõ›‹ JKôYŸ\›
ö^äN¬à€€ú›€›\òŸSX[öYô\›Y»H»€›\òŸS—ö[RYà€›\òŸQö[KöY€›\òŸS—ö[Sò[YNà€›\òŸQö[Kõò[YK€›\òŸS–⁄X⁄‹›[Nà€›\òŸP⁄X⁄‹›[HN¬ÇàÀ»KKHêSî—ì‘ìH
Yö[ôY\»H\ôHù[ò›[€à€»]ÿ[àôHù[à⁄XŸHõ‹àô\õŸX⁄Xö[]JHKKBàù[ò›[€àò[úŸõ‹õJõ›‹Œà[ûV◊JH¬à€€ú››]Hõ›‹ÀõX\

äHOà¬à€€ú›‹›àù[Xô\àù[Hãú‹›¬à€€ú››öZŸNàù[Xô\àHãú›öZŸN¬à€€ú›[ò[ZX–]T›öZŸHH‹›OOHù[»ôX\ô\›]T›öZŸJ‹››öZŸT›\
Hàù[¬à€€ú›[ò[ZX–]SŸôúŸ]H[ò[ZX–]T›öZŸHOOHù[»X]úõ›[ô

›öZŸHH[ò[ZX–]T›öZŸJH»›öZŸT›\
Hàù[¬à][ò[ZX”[€ô^[ô\‹Œà›ö[ô»ù[Hù[¬àYà
[ò[ZX–]SŸôúŸ]OOHù[
H¬àYà
[ò[ZX–]SŸôúŸ]OOH
H[ò[ZX”[€ô^[ô\‹»HêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH[ò[ZX”[€ô^[ô\‹»H[ò[ZX–]SŸôúŸ]»íUHààì’Hé¬à[ŸHYà
ãõ‹[€ï\HOOHîHäH[ò[ZX”[€ô^[ô\‹»H[ò[ZX–]SŸôúŸ]à»íUHààì’Hé¬àBàô]\õà¬à[Y\›[\àãù[Y\›[\à‹›à›öZŸKà‹[€ï\Nàãõ‹[€ï\KàŸ\‹⁄[€ê[ò⁄‹ê]Nàãò]T›öZŸKàŸ\‹⁄[€ê[ò⁄‹ìŸôúŸ]àãò]SŸôúŸ]à[ò[ZX–]T›öZŸKà[ò[ZX–]SŸôúŸ]à[ò[ZX”[€ô^[ô\‹Àà]X[]Nà‹›OOHù[»ïêSQààïSêUêRSPìHãàN¬àJN¬àô]\õà›]¬àBÇà€€ú›ù[åHHò[úŸõ‹õJ›‹ôYõ›‹ N¬à€€ú›ù[åàHò[úŸõ‹õJ›‹ôYõ›‹ N¬à€€ú›ù[åP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åJJKôYŸ\›
ö^äN¬à€€ú›ù[åê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åäJKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKHQUíP‘»KKBà€€ú›\›[ò›[Y\›[\»HÀããõô]»Ÿ]
ù[åKõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬à€€ú›[Y\›[\€›[ùH\›[ò›[Y\›[\Àõ[ô›¬ÇàÀ»[ò[ZX–]T›öZŸH\à[Y\›[\
ZŸHö\ú›õ›…‹»ò[YHõ‹à][Y\›[\KH—K‘Kÿ[›öZŸ\»⁄\ôH]ô\öYöYYô[› Bà€€ú›[ò[ZX–]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàù[åJH¬àYà
Y[ò[ZX–]PûUÀö\ ãù[Y\›[\
JH[ò[ZX–]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬àBÇà][ò[ZX–]P⁄[ôŸP€›[ùH¬à]ô]ê]Nàù[Xô\àù[[ôYö[ôYH[ôYö[ôY¬àõ‹à
€€ú›»Ÿà\›[ò›[Y\›[\ H¬à€€ú›]HH[ò[ZX–]PûUÀôŸ]
 Hœ»ù[¬àYà
ô]ê]HOOH[ôYö[ôY	âà]HOOHô]ê]JH[ò[ZX–]P⁄[ôŸP€›[ù
 Œ¬àô]ê]HH]N¬àBÇà€€ú›[ò[ZX–]Q\›öXù][€éàôX€‹ô›ö[ôÀù[Xô\èàHﬂN¬àõ‹à
€€ú›»Ÿà\›[ò›[Y\›[\ H¬à€€ú›]HH[ò[ZX–]PûUÀôŸ]
 N¬à€€ú›Ÿ^HH]HOOHù[]HOOH[ôYö[ôY»ïSêUêRSPìHàà›ö[ô ]JN¬à[ò[ZX–]Q\›öXù][€ñ⁄Ÿ^WHH
[ò[ZX–]Q\›öXù][€ñ⁄Ÿ^WH
H
»N¬àBÇà]ù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùH¬à]\ùX[P€›ô\ôY[Y\›[\€›[ùH¬à][ò€›ô\ôYô\]Z\ôY€›€›[ùH¬àõ‹à
€€ú›»Ÿà\›[ò›[Y\›[\ H¬à€€ú›]HH[ò[ZX–]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H»[ò€›ô\ôYô\]Z\ôY€›€›[ù
œHŒ»€€ù[ùYN»Bà€€ú›ô\]Z\ôY›öZŸ\»HÀLÀLãLKKã◊KõX\

ŸôäHOà]H
»Ÿôà
à›öZŸT›\
N¬à€€ú›€›ô\ôY€›[ùHô\]Z\ôY›öZŸ\Àôö[\ä
 HOà›‹ôYö^Y›öZŸ\Àö[ò€Y\  JKõ[ô›¬à[ò€›ô\ôYô\]Z\ôY€›€›[ù
œH
»H€›ô\ôY€›[ù
N¬àYà
€›ô\ôY€›[ùOOH Hù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ù
 Œ¬à[ŸHYà
€›ô\ôY€›[ùà
H\ùX[P€›ô\ôY[Y\›[\€›[ù
 Œ¬àBÇàÀ»KKHUPSUH“P“‘Œà\Xÿ]K⁄[ùò[YX\[ô»KKBàÀ»\Xÿ]SX\[ô–€›[ùàH⁄[ô€H
›öZŸK[Y\›[\‹[€ï\JH⁄›[X\»^X›H€ôH[ò[ZX–]SŸôúŸ]Çà€€ú›Ÿ^TŸY[àHô]»X\›ö[ôÀù[Xô\àù[ä
N¬à]\Xÿ]SX\[ô–€›[ùH¬àõ‹à
€€ú›àŸàù[åJH¬à€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_X¬àYà
Ÿ^TŸY[ãö\ Ÿ^JH	âàŸ^TŸY[ãôŸ]
Ÿ^JHOOHãô[ò[ZX–]SŸôúŸ]
H\Xÿ]SX\[ô–€›[ù
 Œ¬àŸ^TŸY[ãúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àBàÀ»[ùò[YX\[ô–€›[ùà—H[ôH]Hÿ[YH›öZŸK›[Y\›[\]\›⁄\ôHHÿ[YH[ò[ZX–]SŸôúŸ]Çà€€ú›ŸPûT›öZŸU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬à€€ú›PûT›öZŸU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàù[åJH¬à€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸPûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àYà
ãõ‹[€ï\HOOHîHäHPûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àBà][ùò[YX\[ô–€›[ùH¬àõ‹à
€€ú›⁄Ÿ^KŸSŸôúŸ]HŸàŸPûT›öZŸU H¬àYà
PûT›öZŸUÀö\ Ÿ^JH	âàPûT›öZŸUÀôŸ]
Ÿ^JHOOHŸSŸôúŸ]
H[ùò[YX\[ô–€›[ù
 Œ¬àBÇàÀ»KKH‘íUH\»Hô]ÀŸ\\ò]Hõ‹õX[^ôYô\ŸX\ò⁄öY]À[öŸY
ô]ô\à›ô\ù‹ö][ô»H€›\òŸJHKKBà€€ú›[ò[ZX’öY]—õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ—SêSRP◊–UW’íQU»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à]’‹ö]T›]\»Hìì’–USTQé¬à][ò[ZX—ö[RYà›ö[ô»ù[Hù[¬àYà
[ò[ZX’öY]—õ€\äH¬à€€ú››]›àHî””ãú›ö[ô⁄YûJù[åJN¬à€€ú›ö[Sò[YHH[ò[ZX◊ÿ]W›öY]◊”íQïW…›òY[ô—]T›üW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à[ò[ZX—ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YK[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬àYà
Y[ò[ZX—ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àã›]›ã[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬à[ò[ZX—ö[RYH\ÀöYœ»ù[¬à’‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à’‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBàBà]‘ôXY›]\»Hìì’–USTQé¬à]ôXYòX⁄‘õ›–€›[ùH¬àYà
[ò[ZX—ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
[ò[ZX—ö[RY⁄Ÿ[äN¬àôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JôXYòX⁄ H»ôXYòX⁄Àõ[ô›à¬à‘ôXY›]\»HôXYòX⁄‘õ›–€›[ùOOHù[åKõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú››ô\ò[›]\»Bà’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âà‘ôXY›]\»OOHîT‘»à	âàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âÇà\Xÿ]SX\[ô–€›[ùOOH	âà[ùò[YX\[ô–€›[ùOOHà»îT‘»Çàà
’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Àà€›\òŸSX[öYô\›YÀà€›\òŸQö^Y›öZŸ\Œà›‹ôYö^Y›öZŸ\Àà›[õ›‹Œàù[åKõ[ô›à‹ö]T›]\Œà’‹ö]T›]\ÀàôXY›]\Œà‘ôXY›]\ÀàôXYòX⁄‘õ›–€›[ùà[ò[ZX—ö[RYàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄àY]öX‹Œà¬à[Y\›[\€›[ùà[ò[ZX–]P⁄[ôŸP€›[ùàù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùà\ùX[P€›ô\ôY[Y\›[\€›[ùà[ò€›ô\ôYô\]Z\ôY€›€›[ùà[ò[ZX–]Q\›öXù][€ãà\Xÿ]SX\[ô–€›[ùà[ùò[YX\[ô–€›[ùàKà€õ›€ì[Z]][€úŒà¬àê€›ô\òYŸH\»]ò[X]YYÿZ[ú›HíVQÀ\›öZŸHò\⁄Ÿ][ôXYH›‹ôY
çÕLLççL
HKH[ûH[ò[ZX»UH⁄‹ŸHô\]Z\ôY0¨L»ò[ôŸHò[»›]⁄YH\»ò\⁄Ÿ]\»ô\‹ùY\»[ò€›ô\ôYô]ô\àòXúöXÿ]Y\»Hô]»€€ùòX›àãàô[ò[ZX”[€ô^[ô\‹»\»H⁄[\HUK–UK”’HXô[úõ€HŸôúŸ]⁄Y€à€õHKHõ»ô[Z][KXò\ŸY[€ô^[ô\‹»[ù\úô]][€à\»\ôõ‹õYY\ôKàãàKàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à[ò[ZX»UHX\[ô»òZ[\ôHãàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å——SêSRP◊–UW–”’ëTêQ—W‘ëTRTà8†%””TUW–UW‘L◊–”’ëTêQ—W–Së—íV”S”ëVSëT‘¬ãÀ¬ãÀ»Y»^X›HHàô]»€€ùòX›»
çÃ—KçÃJHôYYY»⁄]ôHù[ãÀ»Up¨L»€›ô\òYŸHõ‹àì’[ò[ZXÀPUHò[Y\»ŸY[à€àåçãLLLH
çL[ôãÀ»çL
K[àôYŸ[ô\ò]\»H»‹[€à‹öY
ô]»⁄X⁄‹›[K€\ùYòX›ãÀ»ô\Ÿ\ùôY[ù›X⁄Y
H[ôH[ò[ZX»UHöY]»€àH^[ôY\›öZŸBãÀ»ò\⁄Ÿ]à[€»^X⁄]Hô\öYöY\»—K‘H[€ô^[ô\‹»\»⁄YKX]ÿ\ôH[ôãÀ»ﬁ[[Y]öXÀ\àH⁄]ô[à[€ô^[ô\‹◊‹ù[KÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸY[ò[ZXÀX]KX€›ô\òYŸK\ô\Z\ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå——SêSRP◊–UW–”’ëTêQ—W‘ëTRTàãà\⁄Œàê””TUW–UW‘L◊–”’ëTêQ—W–Së—íV”S”ëVSëT‘»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YààKå
N¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
Hô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëSó–P–—T‘◊’“—Sã—Só–”QSï“QZ\‹⁄[ôÀààKå
N¬ÇàûH¬à€€ú›òY[ô—]T›àHååçãLLLHé¬à€€ú›^\ûQ]HHååçãLLNé¬à€€ú››öZŸT›\HL¬à€€ú›Ÿ\‹⁄[€ê[ò⁄‹ê]HHçL¬à€€ú›ô]‘›öZŸHHçÃ¬à€€ú›ô]‘Ÿ\‹⁄[€ìŸôúŸ]H
ô]‘›öZŸHHŸ\‹⁄[€ê[ò⁄‹ê]JH»›öZŸT›\»À»MÇàÀ»KKH––UHH^\›[ô»KÃó⁄Y[ù]K”»õ€\ú»
ô\Ÿ\ùôH]ô\û][ô»[ôXYH\ôJHKKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›ò]‘\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåW‹ò]»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›Y[ù]T\ô[ùõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåó⁄Y[ù]Hã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›[ò[ZX’öY]—õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ—SêSRP◊–UW’íQU»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬àYà
\ò]‘\ô[ùõ€\àZY[ù]T\ô[ùõ€\à[õ‹õS‹õ€\àY[ò[ZX’öY]—õ€\äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YààKå
N¬àBÇàÀ»KKHëPQH^\›[ô»›‹ôYö^Y\›öZŸH»‹[€à‹öY
€›\òŸHŸà‹›\à[Y\›[\
»ö[‹àõ›‹ HKKBà€€ú›^\›[ô—ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›^\›[ô–ÿ[ôY]\»H^\›[ô—ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
‹[€óŸ‹öY–UW‘L◊”íQïW…›òY[ô—]T›üWÿ
JN¬àYà
^\›[ô–ÿ[ôY]\Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»^\›[ô»»‹[€à‹öYõ›[ô»^[ôààKå
N¬àBà€€ú›^\›[ô”—ö[HH^\›[ô–ÿ[ôY]\÷ÃN¬à€€ú›^\›[ô‘õ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
^\›[ô”—ö[KöY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J^\›[ô‘õ›‹ H^\›[ô‘õ›‹Àõ[ô›OOH
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë^\›[ô»»‹öYôXYXòX⁄»òZ[Y‹à[\Kàã^\›[ô”—ö[RYà^\›[ô”—ö[KöYKå
N¬àBà€€ú›‹›ûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸà^\›[ô‘õ›‹ HYà
\‹›ûUÀö\ ãù[Y\›[\
JH‹›ûUÀúŸ]
ãù[Y\›[\ãú‹›
N¬ÇàÀ»KKHëT””ëHHàô]»€€ùòX›…»ôX[ŸX›\ö]RY»úõ€HH[ú›ù[Y[ùX\›\à
ô]ô\àòXúöXÿ]Y
HKKBà€€ú›ÿÿ[àH]ÿZ][îÿÿ[ìöYùS‹[€ê€€ùòX›—ù[
ìíQïHäN¬àYà
\ÿÿ[ãôô]⁄⁄ H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàí[ú›ù[Y[ùX\›\àÿÿ[àòZ[YààKå
N¬àBà€€ú›ô\€€ôP€€ùòX›H
⁄YNàê—HàîHäHOàÿÿ[ãõ‹õ›‹Àôö[ô

äHOÇà
ñ»î—SW—VTñW—UHóHàäKú€XŸJL
HOOH^\ûQ]H	âÇàX]úõ›[ô
\úŸQõÿ]
ñ»î—SW‘’íR—W‘íP—HóHìòSàäJHOOHô]‘›öZŸH	âÇà
ñ»î—SW”‘S”ó’THóHàäKù’\\êÿ\ŸJ
HOOH⁄YBà
N¬à€€ú›ŸSX]⁄Hô\€€ôP€€ùòX›
ê—HäN¬à€€ú›SX]⁄Hô\€€ôP€€ùòX›
îHäN¬àYà
XŸSX]⁄\SX]⁄
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàåçÃ—H[ô€‹àHõ›õ›[ô[à[ú›ù[Y[ùX\›\àõ‹à^\ûHåçãLLNàãŸQõ›[ôàHXŸSX]⁄Qõ›[ôàH\SX]⁄Kå
N¬àBÇà€€ú›\‘\ë^HHç
àå
àå
àL¬à€€ú›HHX]úõ›[ô

ô]»]J^\ûQ]H
»ïååàäKôŸ][YJ
HHô]»]JòY[ô—]T›à
»ïååàäKôŸ][YJ
JH»\‘\ë^JN¬ÇàÀ»KKHëU“€õH\ŸHà€€ùòX›…»€X[]Y]YY^H\›‹ûK‘íUHJ”àKKBà€€ú›ô]‘õ›‹–ûT⁄YNàôX€‹ôê—HàîHã[ûV◊OàH»—Nà◊KNà◊HN¬à€€ú›€€ùòX›ô\‹ùŒàôX€‹ô›ö[ôÀ[ûOàHﬂN¬àõ‹à
€€ú›‹⁄YKX]⁄HŸà÷»ê—HãŸSX]⁄K»îHãSX]⁄WH\»€€ú›
H¬à€€ú›ŸX›\ö]RYHX]⁄»î—SW‘”T’‘—P’TíUW“QóN¬à€€ú›òY[ô‘ﬁ[Xõ€HX]⁄»î—SW’êQSë◊‘÷SPì”óN¬à€€ú›‹ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄[ùòY^Hã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJ»ŸX›\ö]RYà›ö[ô ŸX›\ö]RY
K^⁄[ôŸTŸY€Y[ùàìî—W—ìì»ã[ú›ù[Y[ùàì‘Qã[ù\ùò[àåHã⁄NàùYKúõ€Q]Nà	›òY[ô—]T›üHNåMNå—]Nà	›òY[ô—]T›üHMNåÃåJKàJN¬à€€ú›‹^H]ÿZ]‹ô\Àù^

N¬à]‹^[ÿYà[ûHHù[¬àûH»‹^[ÿYH‹^»î””ãú\úŸJ‹^
Hàù[»Hÿ]⁄»‹^[ÿYHù[»BàYà
[‹ô\Àõ⁄»[‹^[ÿY
H¬à€€ùòX›ô\‹ù÷‹⁄YWHH»ô]⁄›]\ŒàëU“—êRSQ“…€‹ô\Àú›]\ﬂXŸX›\ö]RYN¬à€€ù[ùYN¬àBà€€ú›Ÿ\öY\»H\úŸQ[îŸ\öY\ ‹^[ÿY
N¬ÇàÀ»Bà€€ú›\‹Ÿ]Xô[HíQïW”‘…‹⁄Y_W–UI€ô]‘Ÿ\‹⁄[€ìŸôúŸ]X¬à€€ú›ò]–\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[ò]‘\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›P⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]J‹^
KôYŸ\›
ö^äN¬à€€ú›Qö[Sò[YHHò]◊…ÿ\‹Ÿ]Xô[W…€P⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]Qö[RYHò]–\‹Ÿ]õ€\à»]ÿZ]ö]ôQö[ôö[PûSò[YJQö[Sò[YKò]–\‹Ÿ]õ€\ã⁄Ÿ[äHàù[¬àYà
[Qö[RY	âàò]–\‹Ÿ]õ€\äH¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJQö[Sò[YKò\Xÿ][€ã⁄ú€€àã‹^ò]–\‹Ÿ]õ€\ã⁄Ÿ[äN¬àQö[RYH\ÀöYœ»ù[¬àBÇàÀ»Çà€€ú›Y[ù]P\‹Ÿ]õ€\àH]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\ä\‹Ÿ]Xô[Y[ù]T\ô[ùõ€\ã⁄Ÿ[äN¬à€€ú›Y[ù]HH»ﬁ[Xõ€àìíQïHã[ú›ù[Y[ùàì‘Qã‹[€ï\Nà⁄YK›öZŸNàô]‘›öZŸK]SŸôúŸ]àô]‘Ÿ\‹⁄[€ìŸôúŸ]^\ûNà^\ûQ]KKŸX›\ö]RYòY[ô‘ﬁ[Xõ€òY[ô—]NàòY[ô—]T›ãQö[RYP⁄X⁄‹›[HN¬à€€ú›Y›àHî””ãú›ö[ô⁄YûJY[ù]JN¬à€€ú›Y⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]JY›äKôYŸ\›
ö^äN¬à€€ú›ëö[Sò[YHHY[ù]W…ÿ\‹Ÿ]Xô[W…⁄Y⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ëö[RYHY[ù]P\‹Ÿ]õ€\à»]ÿZ]ö]ôQö[ôö[PûSò[YJëö[Sò[YKY[ù]P\‹Ÿ]õ€\ã⁄Ÿ[äHàù[¬àYà
[ëö[RY	âàY[ù]P\‹Ÿ]õ€\äH¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJëö[Sò[YKò\Xÿ][€ã⁄ú€€àãY›ãY[ù]P\‹Ÿ]õ€\ã⁄Ÿ[äN¬àëö[RYH\ÀöYœ»ù[¬àBàÀ»ô\öYûHàôXYXòX⁄¬à]îôXYòX⁄”⁄»Hò[ŸN¬àYà
ëö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ëö[RY⁄Ÿ[äN¬àîôXYòX⁄”⁄»Hòà	âàòãúŸX›\ö]RYOOHŸX›\ö]RY	âàòãú›öZŸHOOHô]‘›öZŸN¬àBÇà€€ùòX›ô\‹ù÷‹⁄YWHH»ô]⁄›]\ŒàîT‘»ãŸX›\ö]RYõ›–€›[ùàŸ\öY\Àúõ›–€›[ùQö[RYP⁄X⁄‹›[Këö[RYîôXYòX⁄”⁄»N¬ÇàÀ»KKH»õ›‹»õ‹à\»€€ùòX›õ⁄[ôY»‹›ûH[Y\›[\úõ€HH^\›[ô»‹öYKKBàõ‹à
]HH»HŸ\öY\Àù[Y\›[\Àõ[ô›»J  H¬à€€ú›»H\ÿ⁄“\€ Ÿ\öY\Àù[Y\›[\÷⁄WJN¬à€€ú›‹›H‹›ûUÀö\  H»‹›ûUÀôŸ]
 HHàù[¬àô]‘õ›‹–ûT⁄YV‹⁄YWKú\⁄
¬à[Y\›[\àÀàòY[ô—]NàòY[ô—]T›ãàﬁ[Xõ€àìíQïHãà‹›à]T›öZŸNàŸ\‹⁄[€ê[ò⁄‹ê]Kà›öZŸNàô]‘›öZŸKà]SŸôúŸ]àô]‘Ÿ\‹⁄[€ìŸôúŸ]à‹[€ï\Nà⁄YKà‹[éàŸ\öY\Àõ‹[ñ⁄WKY⁄àŸ\öY\ÀöY⁄⁄WK›ŒàŸ\öY\Àõ›÷⁄WK€‹ŸNàŸ\öY\Àò€‹ŸV⁄WKàõ€[YNàŸ\öY\Àùõ€[YV⁄WK⁄NàŸ\öY\Àõ⁄V⁄WKà^\ûNà^\ûQ]KKà]X[]NàŸ\öY\Àò€‹ŸV⁄WHOOHù[	âà‹›OOHù[»ïêSQààîTïPSãàÿ⁄[XUô\ú⁄[€éàõ◊€‹[€óŸ‹öY›åHãàJN¬àBàBÇàYà
€€ùòX›ô\‹ùÀê—OÀôô]⁄›]\»OOHîT‘»à€€ùòX›ô\‹ùÀîOÀôô]⁄›]\»OOHîT‘»äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàì€ôH‹àõ›ô]»€€ùòX›ô]⁄\»òZ[Yàã€€ùòX›ô\‹ù»Kå
N¬àBÇàÀ»KKHëQ—SëTêUHŒà^\›[ô»õ›‹»
»Hàô]»€€ùòX›…»õ›‹À\»HëU»ö[H
€ô\Ÿ\ùôY
HKKBà€€ú›€€Xö[ôY‘õ›‹»HÀããô^\›[ô‘õ›‹Àããõô]‘õ›‹–ûT⁄YKê—Kããõô]‘õ›‹–ûT⁄YKîWN¬à€€ú›€€Xö[ôY‘›àHî””ãú›ö[ô⁄YûJ€€Xö[ôY‘õ›‹ N¬à€€ú›€€Xö[ôY–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]J€€Xö[ôY‘›äKôYŸ\›
ö^äN¬à€€ú›ô]”—ö[Sò[YHH‹[€óŸ‹öY–UW‘L◊”íQïW…›òY[ô—]T›üW…ÿ€€Xö[ôY–⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ô]”—ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJô]”—ö[Sò[YKõ‹õS‹õ€\ã⁄Ÿ[äN¬à]’‹ö]T›]\»Hìì’–USTQé¬àYà
[ô]”—ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJô]”—ö[Sò[YKò\Xÿ][€ã⁄ú€€àã€€Xö[ôY‘›ãõ‹õS‹õ€\ã⁄Ÿ[äN¬àô]”—ö[RYH\ÀöYœ»ù[¬à’‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à’‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]‘ôXY›]\»Hìì’–USTQé¬à]‘ôXYòX⁄‘õ›–€›[ùH¬àYà
ô]”—ö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ô]”—ö[RY⁄Ÿ[äN¬à‘ôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JòäH»òãõ[ô›à¬à‘ôXY›]\»H‘ôXYòX⁄‘õ›–€›[ùOOH€€Xö[ôY‘õ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇàÀ»KKHëQ—SëTêUHH[ò[ZX»UHöY]»€àHVSëQò\⁄Ÿ]ù[à⁄XŸHõ‹àô\õŸX⁄Xö[]HKKBà€€ú›^[ôYö^Y›öZŸ\»HÀããõô]»Ÿ]
€€Xö[ôY‘õ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬Çàù[ò›[€àò[úŸõ‹õJõ›‹Œà[ûV◊JH¬àô]\õàõ›‹ÀõX\

äHOà¬à€€ú›‹›àù[Xô\àù[Hãú‹›¬à€€ú››öZŸNàù[Xô\àHãú›öZŸN¬à€€ú›[ò[ZX–]T›öZŸHH‹›OOHù[»ôX\ô\›]T›öZŸJ‹››öZŸT›\
Hàù[¬à€€ú›[ò[ZX–]SŸôúŸ]H[ò[ZX–]T›öZŸHOOHù[»X]úõ›[ô

›öZŸHH[ò[ZX–]T›öZŸJH»›öZŸT›\
Hàù[¬à][ò[ZX”[€ô^[ô\‹Œà›ö[ô»ù[Hù[¬àYà
[ò[ZX–]SŸôúŸ]OOHù[
H¬àYà
[ò[ZX–]SŸôúŸ]OOH
H[ò[ZX”[€ô^[ô\‹»HêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH[ò[ZX”[€ô^[ô\‹»H›öZŸH
[ò[ZX–]T›öZŸH\»ù[Xô\äH»íUHààì’Hé¬à[ŸHYà
ãõ‹[€ï\HOOHîHäH[ò[ZX”[€ô^[ô\‹»H›öZŸHà
[ò[ZX–]T›öZŸH\»ù[Xô\äH»íUHààì’Hé¬àBàô]\õà¬à[Y\›[\àãù[Y\›[\‹››öZŸK‹[€ï\Nàãõ‹[€ï\KàŸ\‹⁄[€ê[ò⁄‹ê]Nàãò]T›öZŸKŸ\‹⁄[€ê[ò⁄‹ìŸôúŸ]àãò]SŸôúŸ]à[ò[ZX–]T›öZŸK[ò[ZX–]SŸôúŸ][ò[ZX”[€ô^[ô\‹Àà]X[]Nà‹›OOHù[»ïêSQààïSêUêRSPìHãàN¬àJN¬àBà€€ú›ù[åHHò[úŸõ‹õJ€€Xö[ôY‘õ›‹ N¬à€€ú›ù[åàHò[úŸõ‹õJ€€Xö[ôY‘õ›‹ N¬à€€ú›ù[åP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åJJKôYŸ\›
ö^äN¬à€€ú›ù[åê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åäJKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKHQUíP‘»
ÿ[YHY]Ÿ€ŸﬁH\»Hö[‹àX\[ô»õ€ŸäHKKBà€€ú›\›[ò›[Y\›[\»HÀããõô]»Ÿ]
ù[åKõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬à€€ú›[Y\›[\€›[ùH\›[ò›[Y\›[\Àõ[ô›¬à€€ú›[ò[ZX–]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàù[åJHYà
Y[ò[ZX–]PûUÀö\ ãù[Y\›[\
JH[ò[ZX–]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬Çà]ù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùH¬à]\ùX[P€›ô\ôY[Y\›[\€›[ùH¬à][ò€›ô\ôYô\]Z\ôY€›€›[ùH¬àõ‹à
€€ú›»Ÿà\›[ò›[Y\›[\ H¬à€€ú›]HH[ò[ZX–]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H»[ò€›ô\ôYô\]Z\ôY€›€›[ù
œHŒ»€€ù[ùYN»Bà€€ú›ô\]Z\ôY›öZŸ\»HÀLÀLãLKKã◊KõX\

ŸôäHOà]H
»Ÿôà
à›öZŸT›\
N¬à€€ú›€›ô\ôY€›[ùHô\]Z\ôY›öZŸ\Àôö[\ä
 HOà^[ôYö^Y›öZŸ\Àö[ò€Y\  JKõ[ô›¬à[ò€›ô\ôYô\]Z\ôY€›€›[ù
œH
»H€›ô\ôY€›[ù
N¬àYà
€›ô\ôY€›[ùOOH Hù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ù
 Œ¬à[ŸHYà
€›ô\ôY€›[ùà
H\ùX[P€›ô\ôY[Y\›[\€›[ù
 Œ¬àBÇà€€ú›Ÿ^TŸY[àHô]»X\›ö[ôÀù[Xô\àù[ä
N¬à]\Xÿ]SX\[ô–€›[ùH¬àõ‹à
€€ú›àŸàù[åJH¬à€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_X¬àYà
Ÿ^TŸY[ãö\ Ÿ^JH	âàŸ^TŸY[ãôŸ]
Ÿ^JHOOHãô[ò[ZX–]SŸôúŸ]
H\Xÿ]SX\[ô–€›[ù
 Œ¬àŸ^TŸY[ãúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àBà€€ú›ŸPûT›öZŸU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬à€€ú›PûT›öZŸU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàù[åJH¬à€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸPûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àYà
ãõ‹[€ï\HOOHîHäHPûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX–]SŸôúŸ]
N¬àBà][ùò[YX\[ô–€›[ùH¬àõ‹à
€€ú›⁄Ÿ^KŸSŸôúŸ]HŸàŸPûT›öZŸU H¬àYà
PûT›öZŸUÀö\ Ÿ^JH	âàPûT›öZŸUÀôŸ]
Ÿ^JHOOHŸSŸôúŸ]
H[ùò[YX\[ô–€›[ù
 Œ¬àBÇàÀ»KKHS”ëVSëT‘»“P“‘»
^X⁄]\àH⁄]ô[à[€ô^[ô\‹◊‹ù[JHKKBà][ùò[Y[€ô^[ô\‹–€›[ùH¬àõ‹à
€€ú›àŸàù[åJH¬àYà
ãô[ò[ZX–]SŸôúŸ]OOHù[ãô[ò[ZX–]T›öZŸHOOHù[
H€€ù[ùYN¬à]^X›Yà›ö[ôŒ¬àYà
ãô[ò[ZX–]SŸôúŸ]OOH
H^X›YHêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH^X›YHãú›öZŸHãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬à[ŸH^X›YHãú›öZŸHàãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬àYà
ãô[ò[ZX”[€ô^[ô\‹»OOH^X›Y
H[ùò[Y[€ô^[ô\‹–€›[ù
 Œ¬àBà]ŸTS[€ô^[ô\‹‘ﬁ[[Y]ûUö[€][€ú»H¬à€€ú›ŸS[€ô^[ô\‹–ûT›öZŸU»Hô]»X\›ö[ôÀ›ö[ô»ù[ä
N¬à€€ú›S[€ô^[ô\‹–ûT›öZŸU»Hô]»X\›ö[ôÀ›ö[ô»ù[ä
N¬àõ‹à
€€ú›àŸàù[åJH¬à€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸS[€ô^[ô\‹–ûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX”[€ô^[ô\‹ N¬àYà
ãõ‹[€ï\HOOHîHäHS[€ô^[ô\‹–ûT›öZŸUÀúŸ]
Ÿ^Kãô[ò[ZX”[€ô^[ô\‹ N¬àBàõ‹à
€€ú›⁄Ÿ^KŸSWHŸàŸS[€ô^[ô\‹–ûT›öZŸU H¬à€€ú›SHHS[€ô^[ô\‹–ûT›öZŸUÀôŸ]
Ÿ^JN¬àYà
SHOOH[ôYö[ôYŸSHOOHù[SHOOHù[
H€€ù[ùYN¬àYà
ŸSHOOHêUHà	âàSHOOHêUHäH€€ù[ùYN»À»õ›UH]ŸôúŸ]KH€‹úôX›àYà
ŸSHOOHêUHàSHOOHêUHäH»ŸTS[€ô^[ô\‹‘ﬁ[[Y]ûUö[€][€ú  Œ»€€ù[ùYN»HÀ»€ôHUK›\àõ›KH€€ùòYX›[€Çà€€ú›^X›Y‹‹⁄]HH
ŸSHOOHíUHà	âàSHOOHì’HäH
ŸSHOOHì’Hà	âàSHOOHíUHäN¬àYà
Y^X›Y‹‹⁄]JHŸTS[€ô^[ô\‹‘ﬁ[[Y]ûUö[€][€ú  Œ¬àBÇàÀ»KKH‘íUHHôYŸ[ô\ò]Y[ò[ZX»öY]»
ô]»⁄X⁄‹›[K€öY]»ô\Ÿ\ùôY
HKKBà€€ú›[ëö[Sò[YHH[ò[ZX◊ÿ]W›öY]◊”íQïW…›òY[ô—]T›üW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à][ëö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJ[ëö[Sò[YK[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬à]öY]’‹ö]T›]\»Hìì’–USTQé¬àYà
Y[ëö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJ[ëö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJù[åJK[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬à[ëö[RYH\ÀöYœ»ù[¬àöY]’‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬àöY]’‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]öY]‘ôXY›]\»Hìì’–USTQé¬à]öY]‘ôXYòX⁄‘õ›–€›[ùH¬àYà
[ëö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
[ëö[RY⁄Ÿ[äN¬àöY]‘ôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JòäH»òãõ[ô›à¬àöY]‘ôXY›]\»HöY]‘ôXYòX⁄‘õ›–€›[ùOOHù[åKõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú›Y]öX‹–[X]⁄Bà[Y\›[\€›[ùOOHÕÕ	âÇàù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùOOHÕÕ	âÇà\ùX[P€›ô\ôY[Y\›[\€›[ùOOH	âÇà[ò€›ô\ôYô\]Z\ôY€›€›[ùOOH	âÇà\Xÿ]SX\[ô–€›[ùOOH	âÇà[ùò[YX\[ô–€›[ùOOH	âÇà[ùò[Y[€ô^[ô\‹–€›[ùOOH	âÇàŸTS[€ô^[ô\‹‘ﬁ[[Y]ûUö[€][€ú»OOH¬Çà€€ú››ô\ò[›]\»Bà’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âà‘ôXY›]\»OOHîT‘»à	âÇàöY]’‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàöY]‘ôXY›]\»OOHîT‘»à	âÇàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âàY]öX‹–[X]⁄à»îT‘»ÇààîTïPSé¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Ààô]–€€ùòX›Œà€€ùòX›ô\‹ùÀà^\›[ô”—ö[RYà^\›[ô”—ö[KöYàô]”—ö[RYà’‹ö]T›]\Àà‘ôXY›]\Àà‘ôXYòX⁄‘õ›–€›[ùà^[ôYö^Y›öZŸ\Àà[ëö[RYàöY]’‹ö]T›]\ÀàöY]‘ôXY›]\ÀàöY]‘ôXYòX⁄‘õ›–€›[ùàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄àY]öX‹Œà¬à[Y\›[\€›[ùàù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùà\ùX[P€›ô\ôY[Y\›[\€›[ùà[ò€›ô\ôYô\]Z\ôY€›€›[ùà\Xÿ]SX\[ô–€›[ùà[ùò[YX\[ô–€›[ùà[ùò[Y[€ô^[ô\‹–€›[ùàŸTS[€ô^[ô\‹‘ﬁ[[Y]ûUö[€][€úÀàKàY]öX‹–[X]⁄ô\]Z\ôY\‹”Y]öX‹ŒàY]öX‹–[X]⁄àåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à[ò[ZX»UH€›ô\òYŸHô\Z\àòZ[\ôHãàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”—åó‘ëSRUSW–ëRUíS’Tà8†%ïRS–Së’êSQUW—åó‘ëSRUSW—ëPUTëT¬ãÀ¬ãÀ»\ÿ‹ö\]ôK[€õHô[Z][HôZ]ö[›\àôX]\ô\»úõ€HHô\öYöYYíQïBãÀ»[ò[ZX»Up¨L»—K‘H]\Ÿ]à]ô\ûH[YK\Ÿ\öY\»öY[
ô[Z][P⁄[ôŸKãÀ»ô[ÿ⁄]KXÿŸ[\ò][€ãUH—K‘H⁄[ôŸK›òYH⁄[ôŸJH\»€€\]YãÀ»’íP’H⁄][à€ôHö^Y
›öZŸK‹[€ï\JH€€ùòX›	‹»›€àõ›¬ãÀ»Ÿ\]Y[òŸHKHô]ô\àYôôYX‹õ‹‹»Yôô\ô[ù€€ùòX›»ù\›ôXÿ]\ŸHõ›ãÀ»Ÿ\ôHXô[YUH]Yôô\ô[ù[€Y[ùÀàò]Jààõ€[ô»Ÿ\öY\»\ôHX\öŸYãÀ»SêUêRSPìH]H^X›Z[ù]HHùYHUH›öZŸHõ€À\àH⁄]ô[ÇãÀ»€€ù[ùZ]Hù[Kò]\à[àòXúöXÿ]YûH‹õ‹‹ÀX€€ùòX››XùòX›[€ãÇãÀ¬ãÀ»õ»ÿ€‹ö[ôÀõ»‘ãõ»ÿ[Àõ»Uã‹⁄Ÿ]Àõ»‹ôYZ‹Àõ»ô\ôX›ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[Yåã\ô[Z][KXôZ]ö[›\ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”—åó‘ëSRUSW–ëRUíS’Tàãà\⁄ŒàêïRS–Së’êSQUW—åó‘ëSRUSW—ëPUTëT»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYY—åŒàò[ŸHKå
N¬ÇàûH¬à€€ú›[ò[ZX’öY]—ö[RYHåLîôQﬁRV]PX]õL^Z›ûéå€êÿYïÕöôàé¬à€€ú›^X›Yõ›‹»HNN¬à€€ú››öZŸT›\HL¬ÇàÀ»KKHëP””ëUS”à–UHKKBà€€ú›[îõ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
[ò[ZX’öY]—ö[RY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J[îõ›‹ JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë[ò[ZX»öY]»ôXYXòX⁄»òZ[YàãÿYôU‘õÿŸYY—åŒàò[ŸHKå
N¬àBàYà
[îõ›‹Àõ[ô›OOH^X›Yõ›‹ H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ›»€›[ùZ\€X]⁄à^X›Y	Ÿ^X›Yõ›‹ﬂK€›	Ÿ[îõ›‹Àõ[ô›KòÿYôU‘õÿŸYY—åŒàò[ŸHKå
N¬àBà€€ú›ö^Y›öZŸ\“[ïöY]»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬à€€ú›\›[ò›»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬à€€ú›[ê]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸà[îõ›‹ HYà
Y[ê]PûUÀö\ ãù[Y\›[\
JH[ê]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬à]ù[P€›ô\ôYH¬àõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]HH[ê]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H€€ù[ùYN¬à€€ú›ô\]Z\ôYHÀLÀLãLKKã◊KõX\

 HOà]H
»»
à›öZŸT›\
N¬àYà
ô\]Z\ôYô]ô\ûJ
 HOàö^Y›öZŸ\“[ïöY]Àö[ò€Y\  JJHù[P€›ô\ôY
 Œ¬àBàÀ»[ùò[YX\[ô–€›[ù»ŸTHﬁ[[Y]ûH»[ùò[Y[€ô^[ô\‹–€›[ùôK]ô\öYöYYúõ€HHX›X[ö[H€€ù[ùà€€ú›ŸPûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à€€ú›PûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à][ùò[Y[€ô^[ô\‹–€›[ùH¬àõ‹à
€€ú›àŸà[îõ›‹ H¬àYà
ãô[ò[ZX–]SŸôúŸ]OOHù[	âàãô[ò[ZX–]T›öZŸHOOHù[
H¬à]^X›Yà›ö[ôŒ¬àYà
ãô[ò[ZX–]SŸôúŸ]OOH
H^X›YHêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH^X›YHãú›öZŸHãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬à[ŸH^X›YHãú›öZŸHàãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬àYà
ãô[ò[ZX”[€ô^[ô\‹»OOH^X›Y
H[ùò[Y[€ô^[ô\‹–€›[ù
 Œ¬àBà€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àYà
ãõ‹[€ï\HOOHîHäHPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àBà][ùò[YX\[ô–€›[ùH¬à]ŸTTﬁ[[Y]ûUö[€][€ú»H¬àõ‹à
€€ú›⁄Ÿ^KŸUóHŸàŸPûRŸ^JH¬à€€ú›UàHPûRŸ^KôŸ]
Ÿ^JN¬àYà
\UäH€€ù[ùYN¬àYà
ŸUãõŸôúŸ]OOHUãõŸôúŸ]
H[ùò[YX\[ô–€›[ù
 Œ¬àYà
ŸUãõ[€ô^[ô\‹»OOHù[	âàUãõ[€ô^[ô\‹»OOHù[
H¬àYà
ŸUãõ[€ô^[ô\‹»OOHêUHà	âàUãõ[€ô^[ô\‹»OOHêUHäH» à⁄»
ã»Bà[ŸHYà
ŸUãõ[€ô^[ô\‹»OOHêUHàUãõ[€ô^[ô\‹»OOHêUHäHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬à[ŸHYà
J
ŸUãõ[€ô^[ô\‹»OOHíUHà	âàUãõ[€ô^[ô\‹»OOHì’HäH
ŸUãõ[€ô^[ô\‹»OOHì’Hà	âàUãõ[€ô^[ô\‹»OOHíUHäJJHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬àBàBà€€ú›ôX€€ô][€î\‹»Hù[P€›ô\ôYOOH\›[ò›Àõ[ô›	âà[ùò[YX\[ô–€›[ùOOH	âà[ùò[Y[€ô^[ô\‹–€›[ùOOH	âàŸTTﬁ[[Y]ûUö[€][€ú»OOH¬àYà
\ôX€€ô][€î\‹ H¬àô]\õàÀöú€€ä¬àããúô\‹ù›]\ŒàëêRSã\úõ‹éàîôX€€ô][€àÿ]HòZ[YKH›‹[ô»ôYõ‹ôHùZ[[ô»[ûHåàôX]\ôKàãàù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀàÿYôU‘õÿŸYY—åŒàò[ŸKàKå
N¬àBÇàÀ»KKH––UHH»‹öYö[H⁄]X]⁄[ô»õ›»€›[ù
\»“À”“K⁄X⁄H[ò[ZX»öY]»Ÿ\»õ›
HKKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›ôX]õ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåŸ\ö]ò]]ôWŸôX]\ô\»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ôX]ﬁ[Xõ€õ€\àHôX]õ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãôX]õ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\àYôX]ﬁ[Xõ€õ€\äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YàãÿYôU‘õÿŸYY—åŒàò[ŸHKå
N¬Çà€€ú›—ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›–ÿ[ôY]\»H—ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
õ‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW»äJN¬à]‘õ›‹Œà[ûV◊Hù[Hù[¬à]—ö[U\ŸYà»Yà›ö[ôŒ»ò[YNà›ö[ô»Hù[Hù[¬àõ‹à
€€ú›àŸà–ÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬àYà
\úò^Kö\–\úò^JòäH	âàòãõ[ô›OOH^X›Yõ›‹ H»‘õ›‹»Hòé»—ö[U\ŸYHé»úôXZŒ»BàBàYà
[‘õ›‹»[—ö[U\ŸY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ»»‹öYö[Hõ›[ô⁄]	Ÿ^X›Yõ›‹ﬂHõ›‹Àòÿ[ôY]\–⁄X⁄ŸYà–ÿ[ôY]\ÀõX\

äHOàãõò[YJKÿYôU‘õÿŸYY—åŒàò[ŸHKå
N¬àBà€€ú›–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ‘õ›‹ JKôYŸ\›
ö^äN¬ÇàÀ»KKHQTë—Nà“À”“H
úõ€H H
»[ò[ZX»UHöY[»
úõ€H[ò[ZX»öY] KŸ^YYûH[Y\›[\›öZŸ_‹[€ï\HKKBà€€ú›[êûRŸ^HHô]»X\›ö[ôÀ[ûOä
N¬àõ‹à
€€ú›àŸà[îõ›‹ H[êûRŸ^KúŸ]
	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_XäN¬à\HY\ôŸYõ›»H»[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é»‹[€ï\Nàê—HàîHé»€‹ŸNàù[Xô\àù[»‹›àù[Xô\àù[»[ò[ZX–]T›öZŸNàù[Xô\àù[»[ò[ZX–]SŸôúŸ]àù[Xô\àù[N¬à€€ú›Y\ôŸYàY\ôŸYõ›÷◊HH‘õ›‹ÀõX\

äHOà¬à€€ú›[àH[êûRŸ^KôŸ]
	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_X
N¬àô]\õà»[Y\›[\àãù[Y\›[\›öZŸNàãú›öZŸK‹[€ï\Nàãõ‹[€ï\K€‹ŸNàãò€‹ŸK‹›àãú‹›[ò[ZX–]T›öZŸNà[à»[ãô[ò[ZX–]T›öZŸHàù[[ò[ZX–]SŸôúŸ]à[à»[ãô[ò[ZX–]SŸôúŸ]àù[N¬àJN¬ÇàÀ»KKH‹õ›\ûHö^Y€€ùòX›
›öZŸK‹[€ï\JK€‹ùXX⁄‹õ›\ûH[Y\›[\KKBà€€ú›‹õ›\»Hô]»X\›ö[ôÀY\ôŸYõ›÷◊Oä
N¬àõ‹à
€€ú›àŸàY\ôŸY
H¬à€€ú›Ÿ^HH	‹ãú›öZŸ__	‹ãõ‹[€ï\_X¬à€€ú›\úàH‹õ›\ÀôŸ]
Ÿ^JH◊N¬à\úãú\⁄
äN¬à‹õ›\ÀúŸ]
Ÿ^K\úäN¬àBàõ‹à
€€ú›\úàŸà‹õ›\Àùò[Y\ 
JH\úãú€‹ù

KäHOàKù[Y\›[\õÿÿ[P€€\\ôJãù[Y\›[\
JN¬ÇàÀ»KKH\ãX€€ùòX›[YHŸ\öY\Œàô[Z][P⁄[ôŸKô[Z][T›⁄[ôŸKô[Z][Uô[ÿ⁄]Kô[Z][PXÿŸ[\ò][€àKKBà[ù\ôòXŸHôX]\ôTõ›»¬à[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é»‹[€ï\Nàê—HàîHé»€‹ŸNàù[Xô\àù[»‹›àù[Xô\àù[¬à[ò[ZX–]T›öZŸNàù[Xô\àù[»[ò[ZX–]SŸôúŸ]àù[Xô\àù[¬àô[Z][P⁄[ôŸNàù[Xô\àù[»ô[Z][P⁄[ôŸT]X[]Nà›ö[ôŒ¬àô[Z][T›⁄[ôŸNàù[Xô\àù[»ô[Z][T›⁄[ôŸT]X[]Nà›ö[ôŒ¬àô[Z][Uô[ÿ⁄]Nàù[Xô\àù[»ô[Z][Uô[ÿ⁄]T]X[]Nà›ö[ôŒ¬àô[Z][PXÿŸ[\ò][€éàù[Xô\àù[»ô[Z][PXÿŸ[\ò][€î]X[]Nà›ö[ôŒ¬à[ùö[ú⁄X’ò[YNàù[Xô\àù[»ò]—^ö[ú⁄X’ò[YNàù[Xô\àù[»^ö[ú⁄X’ò[YNàù[Xô\àù[¬àBà€€ú›ôX]\ôTõ›‹ŒàôX]\ôTõ›÷◊HH◊N¬à]ö\ú›ÿúŸ\ùò][€ï[ò]òZ[XõP€›[ùH¬à]ô\õ—[õ€Z[ò]‹ê€›[ùH¬à]ôYÿ]]ôTò]—^ö[ú⁄X–€›[ùH¬à]ôYÿ]]ôTô[Z][P[õ€X[P€›[ùH¬Çàõ‹à
€€ú›À\úóHŸà‹õ›\ H¬à]ô]ïô[ÿ⁄]Nàù[Xô\àù[Hù[¬àõ‹à
]HH»H\úãõ[ô›»J  H¬à€€ú›õ›»H\úñ⁄WN¬à€€ú›ô]àHHà»\úñ⁄HHWHàù[¬ÇàYà
õ›Àò€‹ŸHOOHù[	âàõ›Àò€‹ŸH
HôYÿ]]ôTô[Z][P[õ€X[P€›[ù
 Œ¬Çà]ô[Z][P⁄[ôŸNàù[Xô\àù[Hù[ô[Z][P⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]ô[Z][T›⁄[ôŸNàù[Xô\àù[Hù[ô[Z][T›⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]ô[Z][Uô[ÿ⁄]Nàù[Xô\àù[Hù[ô[Z][Uô[ÿ⁄]T]X[]HHïSêUêRSPìHé¬à]ô[Z][PXÿŸ[\ò][€éàù[Xô\àù[Hù[ô[Z][PXÿŸ[\ò][€î]X[]HHïSêUêRSPìHé¬ÇàYà
\ô]äH¬àö\ú›ÿúŸ\ùò][€ï[ò]òZ[XõP€›[ù
 Œ¬àH[ŸHYà
ô]ãò€‹ŸHOOHù[	âàõ›Àò€‹ŸHOOHù[
H¬àô[Z][P⁄[ôŸHHõ›Àò€‹ŸHHô]ãò€‹ŸN¬àô[Z][P⁄[ôŸT]X[]HHïêSQé¬àYà
ô]ãò€‹ŸHOOH
H»ô\õ—[õ€Z[ò]‹ê€›[ù
 Œ»Bà[ŸH»ô[Z][T›⁄[ôŸHH
ô[Z][P⁄[ôŸH»ô]ãò€‹ŸJH
àL»ô[Z][T›⁄[ôŸT]X[]HHïêSQé»BÇà€€ú›[SZ[àH
ô]»]Jõ›Àù[Y\›[\
KôŸ][YJ
HHô]»]Jô]ãù[Y\›[\
KôŸ][YJ
JH»å¬àYà
[SZ[àà
H»ô[Z][Uô[ÿ⁄]HHô[Z][P⁄[ôŸH»[SZ[é»ô[Z][Uô[ÿ⁄]T]X[]HHïêSQé»BàBÇàYà
ô[Z][Uô[ÿ⁄]T]X[]HOOHïêSQà	âàô]ïô[ÿ⁄]HOOHù[
H¬àô[Z][PXÿŸ[\ò][€àHô[Z][Uô[ÿ⁄]HHHô]ïô[ÿ⁄]N¬àô[Z][PXÿŸ[\ò][€î]X[]HHïêSQé¬àBàô]ïô[ÿ⁄]HHô[Z][Uô[ÿ⁄]T]X[]HOOHïêSQà»ô[Z][Uô[ÿ⁄]Hàù[¬ÇàÀ»[ùö[ú⁄XÀŸ^ö[ú⁄X»KH\ã\õ›»òX›[ô\[ô[ùŸà€€ù[ùZ]Bà][ùö[ú⁄X’ò[YNàù[Xô\àù[Hù[ò]—^ö[ú⁄X’ò[YNàù[Xô\àù[Hù[^ö[ú⁄X’ò[YNàù[Xô\àù[Hù[¬àYà
õ›Àú‹›OOHù[
H¬à[ùö[ú⁄X’ò[YHHõ›Àõ‹[€ï\HOOHê—Hà»X]õX^
õ›Àú‹›Hõ›Àú›öZŸJHàX]õX^
õ›Àú›öZŸHHõ›Àú‹›
N¬àYà
õ›Àò€‹ŸHOOHù[
H¬àò]—^ö[ú⁄X’ò[YHHõ›Àò€‹ŸHH[ùö[ú⁄X’ò[YN¬à^ö[ú⁄X’ò[YHHX]õX^
ò]—^ö[ú⁄X’ò[YJN¬àYà
ò]—^ö[ú⁄X’ò[YH
HôYÿ]]ôTò]—^ö[ú⁄X–€›[ù
 Œ¬àBàBÇàôX]\ôTõ›‹Àú\⁄
¬à[Y\›[\àõ›Àù[Y\›[\›öZŸNàõ›Àú›öZŸK‹[€ï\Nàõ›Àõ‹[€ï\K€‹ŸNàõ›Àò€‹ŸK‹›àõ›Àú‹›à[ò[ZX–]T›öZŸNàõ›Àô[ò[ZX–]T›öZŸK[ò[ZX–]SŸôúŸ]àõ›Àô[ò[ZX–]SŸôúŸ]àô[Z][P⁄[ôŸKô[Z][P⁄[ôŸT]X[]Kô[Z][T›⁄[ôŸKô[Z][T›⁄[ôŸT]X[]Kàô[Z][Uô[ÿ⁄]Kô[Z][Uô[ÿ⁄]T]X[]Kô[Z][PXÿŸ[\ò][€ãô[Z][PXÿŸ[\ò][€î]X[]Kà[ùö[ú⁄X’ò[YKò]—^ö[ú⁄X’ò[YK^ö[ú⁄X’ò[YKàJN¬àBàBÇà€€ú›ôX]\ôPûRŸ^HHô]»X\›ö[ôÀôX]\ôTõ›œä
N¬àõ‹à
€€ú›àŸàôX]\ôTõ›‹ HôX]\ôPûRŸ^KúŸ]
	Ÿãù[Y\›[\_	Ÿãú›öZŸ__	Ÿãõ‹[€ï\_XäN¬ÇàÀ»KKH—K‘Hÿ[YK\›öZŸH‹õ‹‹»ôX]\ô\»KKBà[ù\ôòXŸHZ\îõ›»¬à[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é¬àŸTTÿ[YT›öZŸTô[Z][Tò][Œàù[Xô\àù[»ŸTTÿ[YT›öZŸTô[Z][Tò][‘]X[]Nà›ö[ôŒ¬àŸTTÿ[YT›öZŸTô\‹€úŸQYôô\ô[òŸNàù[Xô\àù[»ŸTTÿ[YT›öZŸTô\‹€úŸQYôô\ô[òŸT]X[]Nà›ö[ôŒ¬àBà€€ú›Z\îõ›‹ŒàZ\îõ›÷◊HH◊N¬à]ò[Yÿ[YT›öZŸPŸTTZ\ê€›[ùH¬à€€ú››öZŸ\“[ïöY]»Hö^Y›öZŸ\“[ïöY]Œ¬àõ‹à
€€ú›»Ÿà\›[ò› H¬àõ‹à
€€ú››öZŸHŸà›öZŸ\“[ïöY] H¬à€€ú›ŸHHôX]\ôPûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__—X
N¬à€€ú›HHôX]\ôPûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__X
N¬àYà
XŸH\JH€€ù[ùYN¬àò[Yÿ[YT›öZŸPŸTTZ\ê€›[ù
 Œ¬à]ò][Œàù[Xô\àù[Hù[ò][‘HHïSêUêRSPìHé¬àYà
ŸKò€‹ŸHOOHù[	âàKò€‹ŸHOOHù[
H¬àYà
Kò€‹ŸHOOH
H»ô\õ—[õ€Z[ò]‹ê€›[ù
 Œ»Bà[ŸH»ò][»HŸKò€‹ŸH»Kò€‹ŸN»ò][‘HHïêSQé»BàBà]Yôéàù[Xô\àù[Hù[YôîHHïSêUêRSPìHé¬àYà
ŸKúô[Z][T›⁄[ôŸT]X[]HOOHïêSQà	âàKúô[Z][T›⁄[ôŸT]X[]HOOHïêSQäH¬àYôàH
ŸKúô[Z][T›⁄[ôŸH\»ù[Xô\äHH
Kúô[Z][T›⁄[ôŸH\»ù[Xô\äN¬àYôîHHïêSQé¬àBàZ\îõ›‹Àú\⁄
»[Y\›[\àÀ›öZŸKŸTTÿ[YT›öZŸTô[Z][Tò][Œàò][ÀŸTTÿ[YT›öZŸTô[Z][Tò][‘]X[]Nàò][‘KŸTTÿ[YT›öZŸTô\‹€úŸQYôô\ô[òŸNàYôãŸTTÿ[YT›öZŸTô\‹€úŸQYôô\ô[òŸT]X[]NàYôîHJN¬àBàBÇàÀ»KKHUHﬁ[ù]X»õ€[ô»Ÿ\öY\Œà]PŸTô[Z][P⁄[ôŸK]TTô[Z][P⁄[ôŸK›òYHKKBà[ù\ôòXŸH]Tõ›»¬à[Y\›[\à›ö[ôŒ»[ò[ZX–]T›öZŸNàù[Xô\àù[¬à]PŸP€‹ŸNàù[Xô\àù[»]TP€‹ŸNàù[Xô\àù[¬à]PŸTô[Z][P⁄[ôŸNàù[Xô\àù[»]PŸTô[Z][P⁄[ôŸT]X[]Nà›ö[ôŒ¬à]TTô[Z][P⁄[ôŸNàù[Xô\àù[»]TTô[Z][P⁄[ôŸT]X[]Nà›ö[ôŒ¬à]T›òYTô[Z][Nàù[Xô\àù[»]T›òYTô[Z][T]X[]Nà›ö[ôŒ¬à]T›òYP⁄[ôŸNàù[Xô\àù[»]T›òYP⁄[ôŸT]X[]Nà›ö[ôŒ¬à]T›òYT›⁄[ôŸNàù[Xô\àù[»]T›òYT›⁄[ôŸT]X[]Nà›ö[ôŒ¬àBà€€ú›]Tõ›‹Œà]Tõ›÷◊HH◊N¬à]]Tõ€ò[ú⁄][€ê€›[ùH¬à]€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùH¬à]ò[Y]T›òYP€›[ùH¬à]ô]ê]T›öZŸNàù[Xô\àù[[ôYö[ôYH[ôYö[ôY¬à]ô]ê]PŸP€‹ŸNàù[Xô\àù[Hù[¬à]ô]ê]TP€‹ŸNàù[Xô\àù[Hù[¬à]ô]î›òYNàù[Xô\àù[Hù[¬Çàõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]T›öZŸHH[ê]PûUÀôŸ]
 Hœ»ù[¬à€€ú›]PŸHH]T›öZŸHOOHù[»ôX]\ôPûRŸ^KôŸ]
	›ﬂ_	ÿ]T›öZŸ__—X
Hà[ôYö[ôY¬à€€ú›]THH]T›öZŸHOOHù[»ôX]\ôPûRŸ^KôŸ]
	›ﬂ_	ÿ]T›öZŸ__X
Hà[ôYö[ôY¬à€€ú›]PŸP€‹ŸHH]PŸH»]PŸKò€‹ŸHàù[¬à€€ú›]TP€‹ŸHH]TH»]TKò€‹ŸHàù[¬Çà€€ú›õ€YHô]ê]T›öZŸHOOH[ôYö[ôY	âà]T›öZŸHOOHô]ê]T›öZŸN¬àYà
ô]ê]T›öZŸHOOH[ôYö[ôY	âà]T›öZŸHOOHù[	âàô]ê]T›öZŸHOOHù[	âà]T›öZŸHOOHô]ê]T›öZŸJH]Tõ€ò[ú⁄][€ê€›[ù
 Œ¬Çà]]PŸTô[Z][P⁄[ôŸNàù[Xô\àù[Hù[]PŸTHHïSêUêRSPìHé¬à]]TTô[Z][P⁄[ôŸNàù[Xô\àù[Hù[]TTHHïSêUêRSPìHé¬àYà
ô]ê]T›öZŸHOOH[ôYö[ôYõ€Y]T›öZŸHOOHù[
H¬àYà
ô]ê]T›öZŸHOOH[ôYö[ôY
H€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ù
 Œ¬àH[ŸHYà
]PŸP€‹ŸHOOHù[	âàô]ê]PŸP€‹ŸHOOHù[
H¬à]PŸTô[Z][P⁄[ôŸHH]PŸP€‹ŸHHô]ê]PŸP€‹ŸN»]PŸTHHïêSQé¬àBàYà
Jô]ê]T›öZŸHOOH[ôYö[ôYõ€Y]T›öZŸHOOHù[
H	âà]TP€‹ŸHOOHù[	âàô]ê]TP€‹ŸHOOHù[
H¬à]TTô[Z][P⁄[ôŸHH]TP€‹ŸHHô]ê]TP€‹ŸN»]TTHHïêSQé¬àBÇà]›òYNàù[Xô\àù[Hù[›òYTHHïSêUêRSPìHé¬àYà
]PŸP€‹ŸHOOHù[	âà]TP€‹ŸHOOHù[
H»›òYHH]PŸP€‹ŸH
»]TP€‹ŸN»›òYTHHïêSQé»ò[Y]T›òYP€›[ù
 Œ»BÇà]›òYP⁄[ôŸNàù[Xô\àù[Hù[›òYP⁄[ôŸTHHïSêUêRSPìHé¬à]›òYT›⁄[ôŸNàù[Xô\àù[Hù[›òYT›⁄[ôŸTHHïSêUêRSPìHé¬àYà
Jô]ê]T›öZŸHOOH[ôYö[ôYõ€Y
H	âà›òYTHOOHïêSQà	âàô]î›òYHOOHù[
H¬à›òYP⁄[ôŸHH›òYHHHô]î›òYN»›òYP⁄[ôŸTHHïêSQé¬àYà
ô]î›òYHOOH
H»ô\õ—[õ€Z[ò]‹ê€›[ù
 Œ»H[ŸH»›òYT›⁄[ôŸHH
›òYP⁄[ôŸH»ô]î›òYJH
àL»›òYT›⁄[ôŸTHHïêSQé»BàBÇà]Tõ›‹Àú\⁄
»[Y\›[\àÀ[ò[ZX–]T›öZŸNà]T›öZŸK]PŸP€‹ŸK]TP€‹ŸK]PŸTô[Z][P⁄[ôŸK]PŸTô[Z][P⁄[ôŸT]X[]Nà]PŸTK]TTô[Z][P⁄[ôŸK]TTô[Z][P⁄[ôŸT]X[]Nà]TTK]T›òYTô[Z][Nà›òYK]T›òYTô[Z][T]X[]Nà›òYTK]T›òYP⁄[ôŸNà›òYP⁄[ôŸK]T›òYP⁄[ôŸT]X[]Nà›òYP⁄[ôŸTK]T›òYT›⁄[ôŸNà›òYT›⁄[ôŸK]T›òYT›⁄[ôŸT]X[]Nà›òYT›⁄[ôŸTHJN¬Çàô]ê]T›öZŸHH]T›öZŸN»ô]ê]PŸP€‹ŸHH]PŸP€‹ŸN»ô]ê]TP€‹ŸHH]TP€‹ŸN»ô]î›òYHH›òYN¬àBÇàÀ»KKH\‹Ÿ[XõHö[ò[›]]
»›XãX\úò^\À€ôH€€Xö[ôY\ùYòX›
HKKBà€€ú›€›\òŸSX[öYô\›Y»H»[ò[ZX’öY]—ö[RY—ö[RYà—ö[U\ŸYöY—ö[Sò[YNà—ö[U\ŸYõò[YK–⁄X⁄‹›[HN¬à€€ú›ÿ[›[]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú››]]^[ÿYH»ôX]\ôQò[Z[Nàëåó‘ëSRUSW–ëRUíS’Tàãõ‹õ][Uô\ú⁄[€éàëåó‘ëSRUSW–ëRUíS’Tó›åHã€›\òŸSX[öYô\›YÀÿ[›[]Y]\ê€€ùòX›àôX]\ôTõ›‹ÀŸTTZ\úŒàZ\îõ›‹À]TŸ\öY\Œà]Tõ›‹»N¬Çàù[ò›[€à€€\]P⁄X⁄‹›[J^[ÿYà\[Ÿà›]]^[ÿY
H¬à€€ú›»ÿ[›[]Y]ããúô\›HH^[ÿY¬àô]\õà‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJô\›
JKôYŸ\›
ö^äN¬àBà€€ú›ù[åP⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N¬à€€ú›ù[åê⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N»À»ÿ[YH[ã[Y[[‹ûH]KôKZ\⁄YKHõ›ô\»›XõHŸ\öX[^ò][€Çà€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKH‘íUH»^\›[ô»Y\ò\ò⁄KëPQêP“Àô\öYûHKKBà€€ú›ö[Sò[YHH\ö]ò]]ô\◊—åó”íQïWÃåçãLLLW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à]‹ö]T›]\»Hìì’–USTQé¬àYà
[ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJ›]]^[ÿY
KôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬à‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]ôXY›]\»Hìì’–USTQé¬àYà
ö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬àôXY›]\»Hòà	âà\úò^Kö\–\úò^Jòãú\ê€€ùòX›
H	âàòãú\ê€€ùòX›õ[ô›OOHôX]\ôTõ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú›ò[Yô[Z][P⁄[ôŸP€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãúô[Z][P⁄[ôŸT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Yô[ÿ⁄]P€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãúô[Z][Uô[ÿ⁄]T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[YXÿŸ[\ò][€ê€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãúô[Z][PXÿŸ[\ò][€î]X[]HOOHïêSQäKõ[ô›¬Çà€€ú›”õ›ùZ[öY[—õ›[ôH»ú‹àãòÿ[ÿ[ãú]ÿ[ãùÿ[ZY‹ò][€àãö]àãú⁄Ÿ]»ãô[Hãôÿ[[XHãù]HãùôYÿHãúÿ€‹ôHãúõÿòXö[]HãòöX\»ãòÿ[ôY]Hãô[ùûHãú€ãù\ôŸ]ãùô\ôX›óBàôö[\ä
äHOàôX]\ôTõ›‹Àú€€YJ
éà[ûJHOàà[àäH]Tõ›‹Àú€€YJ
éà[ûJHOàà[àäHZ\îõ›‹Àú€€YJ
éà[ûJHOàà[àäJN¬à€€ú›”õ›ùZ[⁄X⁄»H”õ›ùZ[öY[—õ›[ôõ[ô›OOH»îT‘»ààêRSà	Ÿ”õ›ùZ[öY[—õ›[ôöõ⁄[äãä_X¬Çà€€ú›[ôXYŸT›]\»H€›\òŸSX[öYô\›YÀô[ò[ZX’öY]—ö[RY	âà€›\òŸSX[öYô\›YÀõ—ö[RY	âà€›\òŸSX[öYô\›YÀõ–⁄X⁄‹›[H»îT‘»ààëêRSé¬Çà€€ú››ô\ò[›]\»Bà‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»à	âàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âÇà[ôXYŸT›]\»OOHîT‘»à	âà”õ›ùZ[⁄X⁄»OOHîT‘»Çà»îT‘»Çàà
‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\ÀàôX]\ô\–ùZ[à»úô[Z][P⁄[ôŸHãúô[Z][T›⁄[ôŸHãúô[Z][Uô[ÿ⁄]Hãúô[Z][PXÿŸ[\ò][€àãòŸTTÿ[YT›öZŸTô[Z][Tò][»ãòŸTTÿ[YT›öZŸTô\‹€úŸQYôô\ô[òŸHãò]PŸTô[Z][P⁄[ôŸHãò]TTô[Z][P⁄[ôŸHãò]T›òYTô[Z][Hãò]T›òYP⁄[ôŸHãò]T›òYT›⁄[ôŸHãö[ùö[ú⁄X’ò[YHãúò]—^ö[ú⁄X’ò[YHãô^ö[ú⁄X’ò[YHóKà›[[ú]õ›‹Œà‘õ›‹Àõ[ô›à›[ôX]\ôTõ›‹ŒàôX]\ôTõ›‹Àõ[ô›àò[Yô[Z][P⁄[ôŸP€›[ùàò[Yô[ÿ⁄]P€›[ùàò[YXÿŸ[\ò][€ê€›[ùàò[Yÿ[YT›öZŸPŸTTZ\ê€›[ùàò[Y]T›òYP€›[ùà]Tõ€ò[ú⁄][€ê€›[ùà€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùàö\ú›ÿúŸ\ùò][€ï[ò]òZ[XõP€›[ùàô\õ—[õ€Z[ò]‹ê€›[ùàôYÿ]]ôTò]—^ö[ú⁄X–€›[ùàôYÿ]]ôTô[Z][P[õ€X[P€›[ùà[õ€X[P€›[ùàôYÿ]]ôTò]—^ö[ú⁄X–€›[ù
»ôYÿ]]ôTô[Z][P[õ€X[P€›[ùà‹ö]T›]\ÀàôXY›]\Ààö[RYàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à[ôXYŸT›]\Àà€›\òŸSX[öYô\›YÀà”õ›ùZ[⁄X⁄ÀàôX€€ô][€éà»ù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀ\‹ŒàôX€€ô][€î\‹»KàÿYôU‘õÿŸYY—åŒà›ô\ò[›]\»OOHîT‘»ãàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àåàô[Z][HôZ]ö[›\àùZ[òZ[\ôHãàÿYôU‘õÿŸYY—åŒàò[ŸKàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”—å◊”“W‘’ïP’TëH8†%ïRS–Së’êSQUW—å◊”“W‘’ïP’TëW—ëPUTëT¬ãÀ¬ãÀ»“H›ùX›\ôH[ô‹⁄][€ö[ô»ôX]\ô\»úõ€HHô\öYöYYíQïH[ò[ZX¬ãÀ»Up¨L»—K‘H]\Ÿ]à]ô\ûH\ãX€€ùòX›[YK\Ÿ\öY\»öY[
⁄P⁄[ôŸKãÀ»⁄T›⁄[ôŸK⁄Uô[ÿ⁄]JH\»€€\]Y’íP’H⁄][à€ôHö^Y
›öZŸKãÀ»‹[€ï\JH€€ùòX›	‹»›€àõ›»Ÿ\]Y[òŸKà]ô\ûH\ã][Y\›[\YŸ‹ôYÿ]BãÀ»
ÿ[À€€òŸ[ùò][€ãŸZY⁄YŸ[ù\äH\»€€\]Y”ìHX‹õ‹‹»BãÀ»›\úô[ùH]Y]YUp¨L»›öZŸH[ö]ô\úŸH]]^X›[Y\›[\KHô]ô\ÇãÀ»^ò\€]Y»Hù[‹[€à⁄Z[ãô]ô\àZ^YX‹õ‹‹»^\öY\ÀÇãÀ¬ãÀ»õ»‘à
ç
Kõ»Uã‹⁄Ÿ]Àõ»‹ôYZ‹Àõ»ù[\⁄ÿôX\ö\⁄[ù\úô]][€ããÀ»õ»ÿ€‹ö[ôÀõ»ô\ôX›Àà–S‘Uÿ[Xô[»ÿ\úûHõ»\ôX›[€ò[ãÀ»YX[ö[ô»\ôHKH^H\ôH\ô[H‹⁄][€ò[“KX€€òŸ[ùò][€àòX›ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[YåÀ[⁄K\›ùX›\ôK\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”—å◊”“W‘’ïP’TëHãà\⁄ŒàêïRS–Së’êSQUW—å◊”“W‘’ïP’TëW—ëPUTëT»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYY—çàò[ŸHKå
N¬ÇàûH¬à€€ú›[ò[ZX’öY]—ö[RYHåLîôQﬁRV]PX]õL^Z›ûéå€êÿYïÕöôàé¬à€€ú›^X›Yõ›‹»HNN¬à€€ú››öZŸT›\HL¬ÇàÀ»KKHëP””ëUS”à–UH
Y[ùXÿ[€›ô\òYŸK‹ﬁ[[Y]ûH⁄X⁄»\ŸYôYõ‹ôHåäHKKBà€€ú›[îõ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
[ò[ZX’öY]—ö[RY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J[îõ›‹ JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë[ò[ZX»öY]»ôXYXòX⁄»òZ[YàãÿYôU‘õÿŸYY—çàò[ŸHKå
N¬àBàYà
[îõ›‹Àõ[ô›OOH^X›Yõ›‹ H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ›»€›[ùZ\€X]⁄à^X›Y	Ÿ^X›Yõ›‹ﬂK€›	Ÿ[îõ›‹Àõ[ô›KòÿYôU‘õÿŸYY—çàò[ŸHKå
N¬àBà€€ú›ö^Y›öZŸ\“[ïöY]»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬à€€ú›\›[ò›»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬à€€ú›[ê]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸà[îõ›‹ HYà
Y[ê]PûUÀö\ ãù[Y\›[\
JH[ê]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬à]ù[P€›ô\ôYH¬àõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]HH[ê]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H€€ù[ùYN¬à€€ú›ô\]Z\ôYHÀLÀLãLKKã◊KõX\

 HOà]H
»»
à›öZŸT›\
N¬àYà
ô\]Z\ôYô]ô\ûJ
 HOàö^Y›öZŸ\“[ïöY]Àö[ò€Y\  JJHù[P€›ô\ôY
 Œ¬àBà€€ú›ŸPûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à€€ú›PûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à][ùò[Y[€ô^[ô\‹–€›[ùH¬àõ‹à
€€ú›àŸà[îõ›‹ H¬àYà
ãô[ò[ZX–]SŸôúŸ]OOHù[	âàãô[ò[ZX–]T›öZŸHOOHù[
H¬à]^X›Yà›ö[ôŒ¬àYà
ãô[ò[ZX–]SŸôúŸ]OOH
H^X›YHêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH^X›YHãú›öZŸHãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬à[ŸH^X›YHãú›öZŸHàãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬àYà
ãô[ò[ZX”[€ô^[ô\‹»OOH^X›Y
H[ùò[Y[€ô^[ô\‹–€›[ù
 Œ¬àBà€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àYà
ãõ‹[€ï\HOOHîHäHPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àBà][ùò[YX\[ô–€›[ùH¬à]ŸTTﬁ[[Y]ûUö[€][€ú»H¬àõ‹à
€€ú›⁄Ÿ^KŸUóHŸàŸPûRŸ^JH¬à€€ú›UàHPûRŸ^KôŸ]
Ÿ^JN¬àYà
\UäH€€ù[ùYN¬àYà
ŸUãõŸôúŸ]OOHUãõŸôúŸ]
H[ùò[YX\[ô–€›[ù
 Œ¬àYà
ŸUãõ[€ô^[ô\‹»OOHù[	âàUãõ[€ô^[ô\‹»OOHù[
H¬àYà
ŸUãõ[€ô^[ô\‹»OOHêUHà	âàUãõ[€ô^[ô\‹»OOHêUHäH» à⁄»
ã»Bà[ŸHYà
ŸUãõ[€ô^[ô\‹»OOHêUHàUãõ[€ô^[ô\‹»OOHêUHäHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬à[ŸHYà
J
ŸUãõ[€ô^[ô\‹»OOHíUHà	âàUãõ[€ô^[ô\‹»OOHì’HäH
ŸUãõ[€ô^[ô\‹»OOHì’Hà	âàUãõ[€ô^[ô\‹»OOHíUHäJJHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬àBàBà€€ú›ôX€€ô][€î\‹»Hù[P€›ô\ôYOOH\›[ò›Àõ[ô›	âà[ùò[YX\[ô–€›[ùOOH	âà[ùò[Y[€ô^[ô\‹–€›[ùOOH	âàŸTTﬁ[[Y]ûUö[€][€ú»OOH¬àYà
\ôX€€ô][€î\‹ H¬àô]\õàÀöú€€ä¬àããúô\‹ù›]\ŒàëêRSã\úõ‹éàîôX€€ô][€àÿ]HòZ[YKH›‹[ô»ôYõ‹ôHùZ[[ô»[ûHå»ôX]\ôKàãàù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀàÿYôU‘õÿŸYY—çàò[ŸKàKå
N¬àBÇàÀ»KKH––UH^\›[ô»ö]ôHõ€\ú»KKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›ôX]õ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåŸ\ö]ò]]ôWŸôX]\ô\»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ôX]ﬁ[Xõ€õ€\àHôX]õ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãôX]õ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\àYôX]ﬁ[Xõ€õ€\äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YàãÿYôU‘õÿŸYY—çàò[ŸHKå
N¬ÇàÀ»KKHëTURTëHåàT‘»–UH
ÿ]H€õHKHåà›]]\»ì’\ŸY\»å»[ú]
HKKBà€€ú›ôX]ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à€€ú›åêÿ[ôY]\»HôX]ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
ô\ö]ò]]ô\◊—åó”íQïWÃåçãLLLW»äJN¬à]åëÿ]HHò[ŸN¬àõ‹à
€€ú›àŸàåêÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬àYà
òà	âà\úò^Kö\–\úò^Jòãú\ê€€ùòX›
H	âàòãú\ê€€ùòX›õ[ô›OOH^X›Yõ›‹ H»åëÿ]HHùYN»úôXZŒ»BàBàYà
Yåëÿ]JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëåàôX€€ô][€àõ›ÿ]\ŸöYYKHõ»ò[Y\ö]ò]]ô\◊—åó”íQïWÃåçãLLLW ãöú€€àõ›[ô[àŸ\ö]ò]]ôWŸôX]\ô\À”íQïKàãÿYôU‘õÿŸYY—çàò[ŸHKå
N¬àBÇàÀ»KKH––UHH»‹öYö[H⁄]X]⁄[ô»õ›»€›[ù
\»“À”“K›õ€[YJHKKBà€€ú›—ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›–ÿ[ôY]\»H—ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
õ‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW»äJN¬à]‘õ›‹Œà[ûV◊Hù[Hù[¬à]—ö[U\ŸYà»Yà›ö[ôŒ»ò[YNà›ö[ô»Hù[Hù[¬àõ‹à
€€ú›àŸà–ÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬àYà
\úò^Kö\–\úò^JòäH	âàòãõ[ô›OOH^X›Yõ›‹ H»‘õ›‹»Hòé»—ö[U\ŸYHé»úôXZŒ»BàBàYà
[‘õ›‹»[—ö[U\ŸY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ»»‹öYö[Hõ›[ô⁄]	Ÿ^X›Yõ›‹ﬂHõ›‹Àòÿ[ôY]\–⁄X⁄ŸYà–ÿ[ôY]\ÀõX\

äHOàãõò[YJKÿYôU‘õÿŸYY—çàò[ŸHKå
N¬àBà€€ú›–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ‘õ›‹ JKôYŸ\›
ö^äN¬ÇàÀ»KKHQTë—Nà“K›õ€[YH
úõ€H H
»[ò[ZX»UHöY[»
úõ€H[ò[ZX»öY] KŸ^YYûH[Y\›[\›öZŸ_‹[€ï\HKKBà€€ú›[êûRŸ^HHô]»X\›ö[ôÀ[ûOä
N¬àõ‹à
€€ú›àŸà[îõ›‹ H[êûRŸ^KúŸ]
	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_XäN¬à\HY\ôŸYõ›»H»[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é»‹[€ï\Nàê—HàîHé»⁄Nàù[Xô\àù[»õ€[YNàù[Xô\àù[»‹›àù[Xô\àù[»[ò[ZX–]T›öZŸNàù[Xô\àù[»[ò[ZX–]SŸôúŸ]àù[Xô\àù[N¬à]\Xÿ]RY[ù]P€›[ùH¬à€€ú›ŸY[íY[ù]HHô]»Ÿ]›ö[ôœä
N¬à€€ú›Y\ôŸYàY\ôŸYõ›÷◊HH◊N¬àõ‹à
€€ú›àŸà‘õ›‹ H¬à€€ú›YŸ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_X¬àYà
ŸY[íY[ù]Kö\ YŸ^JJH»\Xÿ]RY[ù]P€›[ù
 Œ»€€ù[ùYN»BàŸY[íY[ù]KòY
YŸ^JN¬à€€ú›[àH[êûRŸ^KôŸ]
YŸ^JN¬àY\ôŸYú\⁄
»[Y\›[\àãù[Y\›[\›öZŸNàãú›öZŸK‹[€ï\Nàãõ‹[€ï\K⁄Nàãõ⁄Kõ€[YNàãùõ€[YK‹›àãú‹›[ò[ZX–]T›öZŸNà[à»[ãô[ò[ZX–]T›öZŸHàù[[ò[ZX–]SŸôúŸ]à[à»[ãô[ò[ZX–]SŸôúŸ]àù[JN¬àBÇàÀ»KKH‹õ›\ûHö^Y€€ùòX›
›öZŸK‹[€ï\JK€‹ùXX⁄‹õ›\ûH[Y\›[\KKBà€€ú›‹õ›\»Hô]»X\›ö[ôÀY\ôŸYõ›÷◊Oä
N¬àõ‹à
€€ú›àŸàY\ôŸY
H¬à€€ú›Ÿ^HH	‹ãú›öZŸ__	‹ãõ‹[€ï\_X¬à€€ú›\úàH‹õ›\ÀôŸ]
Ÿ^JH◊N¬à\úãú\⁄
äN¬à‹õ›\ÀúŸ]
Ÿ^K\úäN¬àBàõ‹à
€€ú›\úàŸà‹õ›\Àùò[Y\ 
JH\úãú€‹ù

KäHOàKù[Y\›[\õÿÿ[P€€\\ôJãù[Y\›[\
JN¬ÇàÀ»KKH‹›\à[Y\›[\
ÿ[YH[ô^öXŸHX‹õ‹‹»[›öZŸ\À€‹[€ï\\»]H⁄]ô[à HKKBà€€ú›‹›ûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàY\ôŸY
HYà
\‹›ûUÀö\ ãù[Y\›[\
JH‹›ûUÀúŸ]
ãù[Y\›[\ãú‹›
N¬ÇàÀ»KKH\ãX€€ùòX›[YHŸ\öY\Œà⁄P⁄[ôŸK⁄T›⁄[ôŸK⁄Uô[ÿ⁄]Kõ€[YS⁄Tò][»KKBà[ù\ôòXŸHôX]\ôTõ›»¬à[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é»‹[€ï\Nàê—HàîHé»⁄Nàù[Xô\àù[»õ€[YNàù[Xô\àù[¬à[ò[ZX–]T›öZŸNàù[Xô\àù[»[ò[ZX–]SŸôúŸ]àù[Xô\àù[¬à⁄P⁄[ôŸNàù[Xô\àù[»⁄P⁄[ôŸT]X[]Nà›ö[ôŒ¬à⁄T›⁄[ôŸNàù[Xô\àù[»⁄T›⁄[ôŸT]X[]Nà›ö[ôŒ¬à⁄Uô[ÿ⁄]Nàù[Xô\àù[»⁄Uô[ÿ⁄]T]X[]Nà›ö[ôŒ¬àõ€[YS⁄Tò][Œàù[Xô\àù[»õ€[YS⁄Tò][‘]X[]Nà›ö[ôŒ¬àBà€€ú›ôX]\ôTõ›‹ŒàôX]\ôTõ›÷◊HH◊N¬à]€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùH¬à]ô\õ—[õ€Z[ò]‹ê€›[ùH¬à]ôYÿ]]ôS⁄P[õ€X[P€›[ùH¬Çàõ‹à
€€ú›À\úóHŸà‹õ›\ H¬àõ‹à
]HH»H\úãõ[ô›»J  H¬à€€ú›õ›»H\úñ⁄WN¬à€€ú›ô]àHHà»\úñ⁄HHWHàù[¬ÇàYà
õ›Àõ⁄HOOHù[	âàõ›Àõ⁄H
HôYÿ]]ôS⁄P[õ€X[P€›[ù
 Œ¬Çà]⁄P⁄[ôŸNàù[Xô\àù[Hù[⁄P⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]⁄T›⁄[ôŸNàù[Xô\àù[Hù[⁄T›⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]⁄Uô[ÿ⁄]Nàù[Xô\àù[Hù[⁄Uô[ÿ⁄]T]X[]HHïSêUêRSPìHé¬ÇàYà
\ô]äH¬à€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ù
 Œ¬àH[ŸHYà
ô]ãõ⁄HOOHù[	âàõ›Àõ⁄HOOHù[
H¬à⁄P⁄[ôŸHHõ›Àõ⁄HHô]ãõ⁄N¬à⁄P⁄[ôŸT]X[]HHïêSQé¬àYà
ô]ãõ⁄HOOH
H»ô\õ—[õ€Z[ò]‹ê€›[ù
 Œ»Bà[ŸH»⁄T›⁄[ôŸHH
⁄P⁄[ôŸH»ô]ãõ⁄JH
àL»⁄T›⁄[ôŸT]X[]HHïêSQé»BÇà€€ú›[SZ[àH
ô]»]Jõ›Àù[Y\›[\
KôŸ][YJ
HHô]»]Jô]ãù[Y\›[\
KôŸ][YJ
JH»å¬àYà
[SZ[àà
H»⁄Uô[ÿ⁄]HH⁄P⁄[ôŸH»[SZ[é»⁄Uô[ÿ⁄]T]X[]HHïêSQé»BàBÇà]õ€[YS⁄Tò][Œàù[Xô\àù[Hù[õ€[YS⁄Tò][‘]X[]HHïSêUêRSPìHé¬àYà
õ›Àùõ€[YHOOHù[	âàõ›Àõ⁄HOOHù[
H¬àYà
õ›Àõ⁄HOOH
H»ô\õ—[õ€Z[ò]‹ê€›[ù
 Œ»Bà[ŸH»õ€[YS⁄Tò][»Hõ›Àùõ€[YH»õ›Àõ⁄N»õ€[YS⁄Tò][‘]X[]HHïêSQé»BàBÇàôX]\ôTõ›‹Àú\⁄
¬à[Y\›[\àõ›Àù[Y\›[\›öZŸNàõ›Àú›öZŸK‹[€ï\Nàõ›Àõ‹[€ï\K⁄Nàõ›Àõ⁄Kõ€[YNàõ›Àùõ€[YKà[ò[ZX–]T›öZŸNàõ›Àô[ò[ZX–]T›öZŸK[ò[ZX–]SŸôúŸ]àõ›Àô[ò[ZX–]SŸôúŸ]à⁄P⁄[ôŸK⁄P⁄[ôŸT]X[]K⁄T›⁄[ôŸK⁄T›⁄[ôŸT]X[]K⁄Uô[ÿ⁄]K⁄Uô[ÿ⁄]T]X[]Kàõ€[YS⁄Tò][Àõ€[YS⁄Tò][‘]X[]KàJN¬àBàBÇà€€ú›ôX]\ôPûRŸ^HHô]»X\›ö[ôÀôX]\ôTõ›œä
N¬àõ‹à
€€ú›àŸàôX]\ôTõ›‹ HôX]\ôPûRŸ^KúŸ]
	Ÿãù[Y\›[\_	Ÿãú›öZŸ__	Ÿãõ‹[€ï\_XäN¬ÇàÀ»KKH\ã][Y\›[\YŸ‹ôYÿ]\Œà›[À€€òŸ[ùò][€ãŸZY⁄YŸ[ù\ãÿ[»KKBà[ù\ôòXŸHYŸ‘õ›»¬à[Y\›[\à›ö[ôŒ»[ò[ZX–]T›öZŸNàù[Xô\àù[¬àŸU›[⁄SôX\ê]Nàù[Xô\àù[»ŸU›[⁄SôX\ê]T]X[]Nà›ö[ôŒ¬àU›[⁄SôX\ê]Nàù[Xô\àù[»U›[⁄SôX\ê]T]X[]Nà›ö[ôŒ¬à⁄P€€òŸ[ùò][€éàù[Xô\àù[»⁄P€€òŸ[ùò][€î]X[]Nà›ö[ôŒ¬àŸS⁄P€€òŸ[ùò][€éàù[Xô\àù[»ŸS⁄P€€òŸ[ùò][€î]X[]Nà›ö[ôŒ¬àS⁄P€€òŸ[ùò][€éàù[Xô\àù[»S⁄P€€òŸ[ùò][€î]X[]Nà›ö[ôŒ¬à⁄UŸZY⁄YŸ[ù\éàù[Xô\àù[»⁄UŸZY⁄YŸ[ù\î]X[]Nà›ö[ôŒ¬àÿ[ÿ[›öZŸNàù[Xô\àù[»ÿ[ÿ[›ô[ô›àù[Xô\àù[»ÿ[ÿ[\›[òŸQúõ€T‹›àù[Xô\àù[»ÿ[ÿ[]X[]Nà›ö[ôŒ¬à]ÿ[›öZŸNàù[Xô\àù[»]ÿ[›ô[ô›àù[Xô\àù[»]ÿ[\›[òŸQúõ€T‹›àù[Xô\àù[»]ÿ[]X[]Nà›ö[ôŒ¬àÿ[ÿ[ZY‹ò][€éàù[Xô\àù[»ÿ[ÿ[ZY‹ò][€î]X[]Nà›ö[ôŒ¬à]ÿ[ZY‹ò][€éàù[Xô\àù[»]ÿ[ZY‹ò][€î]X[]Nà›ö[ôŒ¬àBà€€ú›YŸ‘õ›‹ŒàYŸ‘õ›÷◊HH◊N¬à]ò[Y⁄P€€òŸ[ùò][€ê€›[ùH¬à]ò[Y⁄UŸZY⁄YŸ[ù\ê€›[ùH¬à]ò[Yÿ[ÿ[€›[ùH¬à]ò[Y]ÿ[€›[ùH¬à]ò[Yÿ[ZY‹ò][€ê€›[ùH¬à]ô]êÿ[ÿ[›öZŸNàù[Xô\àù[[ôYö[ôYH[ôYö[ôY¬à]ô]î]ÿ[›öZŸNàù[Xô\àù[[ôYö[ôYH[ôYö[ôY¬Çàõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]T›öZŸHH[ê]PûUÀôŸ]
 Hœ»ù[¬à€€ú›‹›H‹›ûUÀôŸ]
 Hœ»ù[¬Çà€€ú›ŸQ[ùöY\Œà»›öZŸNàù[Xô\é»⁄Nàù[Xô\àV◊HH◊N¬à€€ú›Q[ùöY\Œà»›öZŸNàù[Xô\é»⁄Nàù[Xô\àV◊HH◊N¬àõ‹à
€€ú››öZŸHŸàö^Y›öZŸ\“[ïöY] H¬à€€ú›ŸHHôX]\ôPûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__—X
N¬à€€ú›HHôX]\ôPûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__X
N¬àYà
ŸH	âàŸKõ⁄HOOHù[
HŸQ[ùöY\Àú\⁄
»›öZŸK⁄NàŸKõ⁄HJN¬àYà
H	âàKõ⁄HOOHù[
HQ[ùöY\Àú\⁄
»›öZŸK⁄NàKõ⁄HJN¬àBÇà]ŸU›[⁄SôX\ê]Nàù[Xô\àù[Hù[ŸU›[⁄SôX\ê]T]X[]HHïSêUêRSPìHé¬àYà
ŸQ[ùöY\Àõ[ô›à
H»ŸU›[⁄SôX\ê]HHŸQ[ùöY\ÀúôYXŸJ
ÀJHOà»
»Kõ⁄K
N»ŸU›[⁄SôX\ê]T]X[]HHïêSQé»Bà]U›[⁄SôX\ê]Nàù[Xô\àù[Hù[U›[⁄SôX\ê]T]X[]HHïSêUêRSPìHé¬àYà
Q[ùöY\Àõ[ô›à
H»U›[⁄SôX\ê]HHQ[ùöY\ÀúôYXŸJ
ÀJHOà»
»Kõ⁄K
N»U›[⁄SôX\ê]T]X[]HHïêSQé»BÇàù[ò›[€à\ôö[ôZ
[ùöY\Œà»›öZŸNàù[Xô\é»⁄Nàù[Xô\àV◊JNàù[Xô\àù[¬à€€ú››[H[ùöY\ÀúôYXŸJ
ÀJHOà»
»Kõ⁄K
N¬àYà
›[H
Hô]\õàù[¬àô]\õà[ùöY\ÀúôYXŸJ
ÀJHOà»
»X]ú› Kõ⁄H»›[äK
N¬àBà€€ú›ŸS⁄P€€òŸ[ùò][€àH\ôö[ôZ
ŸQ[ùöY\ N¬à€€ú›S⁄P€€òŸ[ùò][€àH\ôö[ôZ
Q[ùöY\ N¬à€€ú›€€Xö[ôY[ùöY\»HÀããòŸQ[ùöY\ÀããúQ[ùöY\◊N¬à€€ú›⁄P€€òŸ[ùò][€àH\ôö[ôZ
€€Xö[ôY[ùöY\ N¬à€€ú›ŸS⁄P€€òŸ[ùò][€î]X[]HHŸS⁄P€€òŸ[ùò][€àOOHù[»ïêSQààïSêUêRSPìHé¬à€€ú›S⁄P€€òŸ[ùò][€î]X[]HHS⁄P€€òŸ[ùò][€àOOHù[»ïêSQààïSêUêRSPìHé¬à€€ú›⁄P€€òŸ[ùò][€î]X[]HH⁄P€€òŸ[ùò][€àOOHù[»ïêSQààïSêUêRSPìHé¬àYà
⁄P€€òŸ[ùò][€î]X[]HOOHïêSQäHò[Y⁄P€€òŸ[ùò][€ê€›[ù
 Œ¬Çà]⁄UŸZY⁄YŸ[ù\éàù[Xô\àù[Hù[⁄UŸZY⁄YŸ[ù\î]X[]HHïSêUêRSPìHé¬à€€ú›€€Xö[ôY›[H€€Xö[ôY[ùöY\ÀúôYXŸJ
ÀJHOà»
»Kõ⁄K
N¬àYà
€€Xö[ôY›[à
H¬à⁄UŸZY⁄YŸ[ù\àH€€Xö[ôY[ùöY\ÀúôYXŸJ
ÀJHOà»
»Kú›öZŸH
àKõ⁄K
H»€€Xö[ôY›[¬à⁄UŸZY⁄YŸ[ù\î]X[]HHïêSQé¬àò[Y⁄UŸZY⁄YŸ[ù\ê€›[ù
 Œ¬àBÇà]ÿ[ÿ[›öZŸNàù[Xô\àù[Hù[ÿ[ÿ[›ô[ô›àù[Xô\àù[Hù[ÿ[ÿ[\›[òŸQúõ€T‹›àù[Xô\àù[Hù[ÿ[ÿ[]X[]HHïSêUêRSPìHé¬àYà
ŸQ[ùöY\Àõ[ô›à	âàŸU›[⁄SôX\ê]HOOHù[	âàŸU›[⁄SôX\ê]Hà
H¬à€€ú›‹HŸQ[ùöY\ÀúôYXŸJ
KäHOà
ãõ⁄HàKõ⁄H»ààJJN¬àÿ[ÿ[›öZŸHH‹ú›öZŸN¬àÿ[ÿ[›ô[ô›H‹õ⁄H»ŸU›[⁄SôX\ê]N¬àÿ[ÿ[\›[òŸQúõ€T‹›H‹›OOHù[»‹ú›öZŸHH‹›àù[¬àÿ[ÿ[]X[]HHïêSQé¬àò[Yÿ[ÿ[€›[ù
 Œ¬àBà]]ÿ[›öZŸNàù[Xô\àù[Hù[]ÿ[›ô[ô›àù[Xô\àù[Hù[]ÿ[\›[òŸQúõ€T‹›àù[Xô\àù[Hù[]ÿ[]X[]HHïSêUêRSPìHé¬àYà
Q[ùöY\Àõ[ô›à	âàU›[⁄SôX\ê]HOOHù[	âàU›[⁄SôX\ê]Hà
H¬à€€ú›‹HQ[ùöY\ÀúôYXŸJ
KäHOà
ãõ⁄HàKõ⁄H»ààJJN¬à]ÿ[›öZŸHH‹ú›öZŸN¬à]ÿ[›ô[ô›H‹õ⁄H»U›[⁄SôX\ê]N¬à]ÿ[\›[òŸQúõ€T‹›H‹›OOHù[»‹ú›öZŸHH‹›àù[¬à]ÿ[]X[]HHïêSQé¬àò[Y]ÿ[€›[ù
 Œ¬àBÇà]ÿ[ÿ[ZY‹ò][€éàù[Xô\àù[Hù[ÿ[ÿ[ZY‹ò][€î]X[]HHïSêUêRSPìHé¬à]]ÿ[ZY‹ò][€éàù[Xô\àù[Hù[]ÿ[ZY‹ò][€î]X[]HHïSêUêRSPìHé¬àYà
ô]êÿ[ÿ[›öZŸHOOH[ôYö[ôY	âàô]êÿ[ÿ[›öZŸHOOHù[	âàÿ[ÿ[›öZŸHOOHù[
H¬àÿ[ÿ[ZY‹ò][€àHÿ[ÿ[›öZŸHHô]êÿ[ÿ[›öZŸN¬àÿ[ÿ[ZY‹ò][€î]X[]HHïêSQé¬àò[Yÿ[ZY‹ò][€ê€›[ù
 Œ¬àBàYà
ô]î]ÿ[›öZŸHOOH[ôYö[ôY	âàô]î]ÿ[›öZŸHOOHù[	âà]ÿ[›öZŸHOOHù[
H¬à]ÿ[ZY‹ò][€àH]ÿ[›öZŸHHô]î]ÿ[›öZŸN¬à]ÿ[ZY‹ò][€î]X[]HHïêSQé¬àò[Yÿ[ZY‹ò][€ê€›[ù
 Œ¬àBÇàYŸ‘õ›‹Àú\⁄
¬à[Y\›[\àÀ[ò[ZX–]T›öZŸNà]T›öZŸKàŸU›[⁄SôX\ê]KŸU›[⁄SôX\ê]T]X[]KU›[⁄SôX\ê]KU›[⁄SôX\ê]T]X[]Kà⁄P€€òŸ[ùò][€ã⁄P€€òŸ[ùò][€î]X[]KŸS⁄P€€òŸ[ùò][€ãŸS⁄P€€òŸ[ùò][€î]X[]KS⁄P€€òŸ[ùò][€ãS⁄P€€òŸ[ùò][€î]X[]Kà⁄UŸZY⁄YŸ[ù\ã⁄UŸZY⁄YŸ[ù\î]X[]Kàÿ[ÿ[›öZŸKÿ[ÿ[›ô[ô›ÿ[ÿ[\›[òŸQúõ€T‹›ÿ[ÿ[]X[]Kà]ÿ[›öZŸK]ÿ[›ô[ô›]ÿ[\›[òŸQúõ€T‹›]ÿ[]X[]Kàÿ[ÿ[ZY‹ò][€ãÿ[ÿ[ZY‹ò][€î]X[]K]ÿ[ZY‹ò][€ã]ÿ[ZY‹ò][€î]X[]KàJN¬Çàô]êÿ[ÿ[›öZŸHHÿ[ÿ[›öZŸN¬àô]î]ÿ[›öZŸHH]ÿ[›öZŸN¬àBÇàÀ»KKH\‹Ÿ[XõHö[ò[›]]
à›XãX\úò^\À€ôH€€Xö[ôY\ùYòX›
HKKBà€€ú›€›\òŸSX[öYô\›Y»H»[ò[ZX’öY]—ö[RY—ö[RYà—ö[U\ŸYöY—ö[Sò[YNà—ö[U\ŸYõò[YK–⁄X⁄‹›[HN¬à€€ú›ÿ[›[]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú››]]^[ÿYH»ôX]\ôQò[Z[Nàëå◊”“W‘’ïP’TëHãõ‹õ][Uô\ú⁄[€éàëå◊”“W‘’ïP’TëW›åHã€›\òŸSX[öYô\›YÀÿ[›[]Y]\ê€€ùòX›àôX]\ôTõ›‹ÀYŸ‹ôYÿ]\ŒàYŸ‘õ›‹»N¬Çàù[ò›[€à€€\]P⁄X⁄‹›[J^[ÿYà\[Ÿà›]]^[ÿY
H¬à€€ú›»ÿ[›[]Y]ããúô\›HH^[ÿY¬àô]\õà‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJô\›
JKôYŸ\›
ö^äN¬àBà€€ú›ù[åP⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N¬à€€ú›ù[åê⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKH‘íUH»^\›[ô»Y\ò\ò⁄KëPQêP“Àô\öYûHKKBà€€ú›ö[Sò[YHH\ö]ò]]ô\◊—å◊”íQïWÃåçãLLLW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à]‹ö]T›]\»Hìì’–USTQé¬àYà
[ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJ›]]^[ÿY
KôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬à‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]ôXY›]\»Hìì’–USTQé¬àYà
ö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬àôXY›]\»Hòà	âà\úò^Kö\–\úò^Jòãú\ê€€ùòX›
H	âàòãú\ê€€ùòX›õ[ô›OOHôX]\ôTõ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú›ò[Y⁄P⁄[ôŸP€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãõ⁄P⁄[ôŸT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y⁄Uô[ÿ⁄]P€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãõ⁄Uô[ÿ⁄]T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Yõ€[YS⁄Tò][–€›[ùHôX]\ôTõ›‹Àôö[\ä
äHOàãùõ€[YS⁄Tò][‘]X[]HOOHïêSQäKõ[ô›¬Çà€€ú›”õ›ùZ[öY[—õ›[ôH»ú‹àãö]àãú⁄Ÿ]»ãô[Hãôÿ[[XHãù]HãùôYÿHãúÿ€‹ôHãúõÿòXö[]HãòöX\»ãòÿ[ôY]Hãô[ùûHãú€ãù\ôŸ]ãùô\ôX›óBàôö[\ä
äHOàôX]\ôTõ›‹Àú€€YJ
éà[ûJHOàà[àäHYŸ‘õ›‹Àú€€YJ
éà[ûJHOàà[àäJN¬à€€ú›”õ›ùZ[⁄X⁄»H”õ›ùZ[öY[—õ›[ôõ[ô›OOH»îT‘»ààêRSà	Ÿ”õ›ùZ[öY[—õ›[ôöõ⁄[äãä_X¬Çà€€ú›[ôXYŸT›]\»H€›\òŸSX[öYô\›YÀô[ò[ZX’öY]—ö[RY	âà€›\òŸSX[öYô\›YÀõ—ö[RY	âà€›\òŸSX[öYô\›YÀõ–⁄X⁄‹›[H»îT‘»ààëêRSé¬Çà€€ú›[õ€X[P€›[ùHôYÿ]]ôS⁄P[õ€X[P€›[ù
»\Xÿ]RY[ù]P€›[ù¬Çà€€ú››ô\ò[›]\»Bà‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»à	âàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âÇà[ôXYŸT›]\»OOHîT‘»à	âà”õ›ùZ[⁄X⁄»OOHîT‘»à	âà\Xÿ]RY[ù]P€›[ùOOHà»îT‘»Çàà
‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\ÀàôX]\ô\–ùZ[à»õ⁄P⁄[ôŸHãõ⁄T›⁄[ôŸHãõ⁄Uô[ÿ⁄]HãòŸU›[⁄SôX\ê]HãúU›[⁄SôX\ê]Hãõ⁄P€€òŸ[ùò][€àãòŸS⁄P€€òŸ[ùò][€àãúS⁄P€€òŸ[ùò][€àãõ⁄UŸZY⁄YŸ[ù\àãòÿ[ÿ[›öZŸHãú]ÿ[›öZŸHãòÿ[ÿ[›ô[ô›ãú]ÿ[›ô[ô›ãòÿ[ÿ[\›[òŸQúõ€T‹›ãú]ÿ[\›[òŸQúõ€T‹›ãòÿ[ÿ[ZY‹ò][€àãú]ÿ[ZY‹ò][€àãùõ€[YS⁄Tò][»óKà›[[ú]õ›‹Œà‘õ›‹Àõ[ô›à›[ôX]\ôTõ›‹ŒàôX]\ôTõ›‹Àõ[ô›àò[Y⁄P⁄[ôŸP€›[ùàò[Y⁄Uô[ÿ⁄]P€›[ùàò[Y⁄P€€òŸ[ùò][€ê€›[ùàò[Y⁄UŸZY⁄YŸ[ù\ê€›[ùàò[Yÿ[ÿ[€›[ùàò[Y]ÿ[€›[ùàò[Yÿ[ZY‹ò][€ê€›[ùàò[Yõ€[YS⁄Tò][–€›[ùà€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùàô\õ—[õ€Z[ò]‹ê€›[ùàôYÿ]]ôS⁄P[õ€X[P€›[ùà\Xÿ]RY[ù]P€›[ùà[õ€X[P€›[ùà‹ö]T›]\ÀàôXY›]\Ààö[RYàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à[ôXYŸT›]\Àà€›\òŸSX[öYô\›YÀà”õ›ùZ[⁄X⁄ÀàôX€€ô][€éà»ù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀ\‹ŒàôX€€ô][€î\‹»Kàåëÿ]Kà€õ›€ì[Z]][€úŒà¬àïÿ[À€€òŸ[ùò][€ã[ôŸZY⁄YŸ[ù\à\ôH€€\]Y€õH⁄][àH]Y]YUp¨L»
À\›öZŸJH[ö]ô\úŸKõ›Hù[‹[€à⁄Z[àKHõ›^ò\€]Y⁄Y\ãàãàòÿ[ÿ[ZY‹ò][€ã‹]ÿ[ZY‹ò][€à\ôHSêUêRSPìHõ‹àHö\ú›[Y\›[\[ô⁄[ô]ô\àH›\úô[ù‹àô]ö[›\»ÿ[›öZŸH€›[õ›ôH]\õZ[ôYàãàìõ»\ôX›[€ò[
›\‹ù‹ô\⁄\›[òŸKù[\⁄ÿôX\ö\⁄
HYX[ö[ô»\»\‹⁄Y€ôY»[ûHÿ[‹à€€òŸ[ùò][€àò[YKàãàKàÿYôU‘õÿŸYY—çà›ô\ò[›]\»OOHîT‘»ãàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àå»“H›ùX›\ôHùZ[òZ[\ôHãàÿYôU‘õÿŸYY—çàò[ŸKàKL
N¬àBüJN¬ÇÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”—ç‘‘à8†%ïRS–Së’êSQUW—ç‘‘ó—ëPUTëT¬ãÀ¬ãÀ»‘à
]Pÿ[ò][ HôX]\ô\»úõ€HHô\öYöYYíQïH[ò[ZX»Up¨L»—K‘BãÀ»]\Ÿ]àôX\ê]T‹ì⁄K€ôX\ê]T‹ïõ€[YH[ôZ\à\ö]ôY⁄[ôŸK›ô[ÿ⁄]K¬ãÀ»XÿŸ[\ò][€ã‹\òŸ[ù[HŸ\öY\»\ôH€€\]YYÿZ[ú›HíVQÀ\›öZŸBãÀ»]Y]Y[ö]ô\úŸH
€€ùòX›X€€ù[ù[›\»X‹õ‹‹»H^Kõ»UK\õ€ãÀ»\ÿ€€ù[ùZ]JKà]S€õT‹ì⁄Kÿ]S€õT‹ïõ€[YH\ôHŸ\\ò]H⁄[ùZ[ã][YBãÀ»€ò\⁄›»YY»HX›X[õ€[ô»UH›öZŸN»\àHêUHõ€]\›ãÀ»õ›‹ôX]H\ùYöX⁄X[‘àù[\»àù[Kõ»⁄[ôŸK›ô[ÿ⁄]KÿXÿŸ[\ò][€ÇãÀ»Ÿ\öY\»\»\ö]ôYúõ€HH]S€õHò[Y\»[à\»\‹ÀÇãÀ¬ãÀ»õ»ù[\⁄ÿôX\ö\⁄›\‹ù‹ô\⁄\›[òŸK‹à⁄Y\ãX⁄Z[à‘à\»õŸXŸYÇãÀ»õ»Uã‹⁄Ÿ]Àõ»ô\ôX›õ»ÿ€‹ö[ôÀõ»òX⁄›\›[ôÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[Yç\‹ã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”—ç‘‘àãà\⁄ŒàêïRS–Së’êSQUW—ç‘‘ó—ëPUTëT»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬ÇàûH¬à€€ú›[ò[ZX’öY]—ö[RYHåLîôQﬁRV]PX]õL^Z›ûéå€êÿYïÕöôàé¬à€€ú›^X›Yõ›‹»HNN¬à€€ú››öZŸT›\HL¬ÇàÀ»KKHëP””ëUS”à–UH
Y[ùXÿ[€›ô\òYŸK‹ﬁ[[Y]ûH⁄X⁄»\ŸYôYõ‹ôHåã—å HKKBà€€ú›[îõ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
[ò[ZX’öY]—ö[RY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J[îõ›‹ JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë[ò[ZX»öY]»ôXYXòX⁄»òZ[YàãÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬àBàYà
[îõ›‹Àõ[ô›OOH^X›Yõ›‹ H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ›»€›[ùZ\€X]⁄à^X›Y	Ÿ^X›Yõ›‹ﬂK€›	Ÿ[îõ›‹Àõ[ô›KòÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬àBà€€ú›ö^Y›öZŸ\“[ïöY]»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬à€€ú›\›[ò›»HÀããõô]»Ÿ]
[îõ›‹ÀõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬à€€ú›[ê]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸà[îõ›‹ HYà
Y[ê]PûUÀö\ ãù[Y\›[\
JH[ê]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬à]ù[P€›ô\ôYH¬àõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]HH[ê]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H€€ù[ùYN¬à€€ú›ô\]Z\ôYHÀLÀLãLKKã◊KõX\

 HOà]H
»»
à›öZŸT›\
N¬àYà
ô\]Z\ôYô]ô\ûJ
 HOàö^Y›öZŸ\“[ïöY]Àö[ò€Y\  JJHù[P€›ô\ôY
 Œ¬àBà€€ú›ŸPûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à€€ú›PûRŸ^HHô]»X\›ö[ôÀ»ŸôúŸ]àù[Xô\àù[»[€ô^[ô\‹Œà›ö[ô»ù[Oä
N¬à][ùò[Y[€ô^[ô\‹–€›[ùH¬àõ‹à
€€ú›àŸà[îõ›‹ H¬àYà
ãô[ò[ZX–]SŸôúŸ]OOHù[	âàãô[ò[ZX–]T›öZŸHOOHù[
H¬à]^X›Yà›ö[ôŒ¬àYà
ãô[ò[ZX–]SŸôúŸ]OOH
H^X›YHêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH^X›YHãú›öZŸHãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬à[ŸH^X›YHãú›öZŸHàãô[ò[ZX–]T›öZŸH»íUHààì’Hé¬àYà
ãô[ò[ZX”[€ô^[ô\‹»OOH^X›Y
H[ùò[Y[€ô^[ô\‹–€›[ù
 Œ¬àBà€€ú›Ÿ^HH	‹ãù[Y\›[\_	‹ãú›öZŸ_X¬àYà
ãõ‹[€ï\HOOHê—HäHŸPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àYà
ãõ‹[€ï\HOOHîHäHPûRŸ^KúŸ]
Ÿ^K»ŸôúŸ]àãô[ò[ZX–]SŸôúŸ][€ô^[ô\‹Œàãô[ò[ZX”[€ô^[ô\‹»JN¬àBà][ùò[YX\[ô–€›[ùH¬à]ŸTTﬁ[[Y]ûUö[€][€ú»H¬àõ‹à
€€ú›⁄Ÿ^KŸUóHŸàŸPûRŸ^JH¬à€€ú›UàHPûRŸ^KôŸ]
Ÿ^JN¬àYà
\UäH€€ù[ùYN¬àYà
ŸUãõŸôúŸ]OOHUãõŸôúŸ]
H[ùò[YX\[ô–€›[ù
 Œ¬àYà
ŸUãõ[€ô^[ô\‹»OOHù[	âàUãõ[€ô^[ô\‹»OOHù[
H¬àYà
ŸUãõ[€ô^[ô\‹»OOHêUHà	âàUãõ[€ô^[ô\‹»OOHêUHäH» à⁄»
ã»Bà[ŸHYà
ŸUãõ[€ô^[ô\‹»OOHêUHàUãõ[€ô^[ô\‹»OOHêUHäHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬à[ŸHYà
J
ŸUãõ[€ô^[ô\‹»OOHíUHà	âàUãõ[€ô^[ô\‹»OOHì’HäH
ŸUãõ[€ô^[ô\‹»OOHì’Hà	âàUãõ[€ô^[ô\‹»OOHíUHäJJHŸTTﬁ[[Y]ûUö[€][€ú  Œ¬àBàBà€€ú›ôX€€ô][€î\‹»Hù[P€›ô\ôYOOH\›[ò›Àõ[ô›	âà[ùò[YX\[ô–€›[ùOOH	âà[ùò[Y[€ô^[ô\‹–€›[ùOOH	âàŸTTﬁ[[Y]ûUö[€][€ú»OOH¬àYà
\ôX€€ô][€î\‹ H¬àô]\õàÀöú€€ä¬àããúô\‹ù›]\ŒàëêRSã\úõ‹éàîôX€€ô][€àÿ]HòZ[YKH›‹[ô»ôYõ‹ôHùZ[[ô»[ûHçôX]\ôKàãàù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀàÿYôU‘õÿŸYY—çNàò[ŸKàKå
N¬àBÇàÀ»KKH––UH^\›[ô»ö]ôHõ€\ú»KKBà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›ôX]õ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåŸ\ö]ò]]ôWŸôX]\ô\»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ôX]ﬁ[Xõ€õ€\àHôX]õ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãôX]õ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\àYôX]ﬁ[Xõ€õ€\äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YàãÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬ÇàÀ»KKHëTURTëH»
»å»T‘»–UT»
ÿ]H€õHKHôZ]\à\»\ŸY\»ç[ú]»çôKY\ö]ô\»[ô\[ô[ùHúõ€H HKKBà€€ú›—ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›–ÿ[ôY]\»H—ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
õ‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW»äJN¬à]‘õ›‹Œà[ûV◊Hù[Hù[¬à]—ö[U\ŸYà»Yà›ö[ôŒ»ò[YNà›ö[ô»Hù[Hù[¬àõ‹à
€€ú›àŸà–ÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬àYà
\úò^Kö\–\úò^JòäH	âàòãõ[ô›OOH^X›Yõ›‹ H»‘õ›‹»Hòé»—ö[U\ŸYHé»úôXZŒ»BàBàYà
[‘õ›‹»[—ö[U\ŸY
H¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàõ»»‹öYö[Hõ›[ô⁄]	Ÿ^X›Yõ›‹ﬂHõ›‹»
ô\]Z\ôS‘\‹»òZ[Y
Kòÿ[ôY]\–⁄X⁄ŸYà–ÿ[ôY]\ÀõX\

äHOàãõò[YJKÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬àBà€€ú›–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ‘õ›‹ JKôYŸ\›
ö^äN¬Çà€€ú›ôX]ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à€€ú›å–ÿ[ôY]\»HôX]ö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
ô\ö]ò]]ô\◊—å◊”íQïWÃåçãLLLW»äJN¬à]å—ÿ]HHò[ŸN¬àõ‹à
€€ú›àŸàå–ÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬àYà
òà	âà\úò^Kö\–\úò^JòãòYŸ‹ôYÿ]\ H	âàòãòYŸ‹ôYÿ]\Àõ[ô›OOH\›[ò›Àõ[ô›
H»å—ÿ]HHùYN»úôXZŒ»BàBàYà
Yå—ÿ]JH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëå»ôX€€ô][€àõ›ÿ]\ŸöYYKHõ»ò[Y\ö]ò]]ô\◊—å◊”íQïWÃåçãLLLW ãöú€€àõ›[ô[àŸ\ö]ò]]ôWŸôX]\ô\À”íQïKàãÿYôU‘õÿŸYY—çNàò[ŸHKå
N¬àBÇàÀ»KKHQTë—Nà“K›õ€[YKŸ^\ûH
úõ€H H
»[ò[ZX»UHöY[»
úõ€H[ò[ZX»öY] KŸ^YYûH[Y\›[\›öZŸ_‹[€ï\HKKBà€€ú›[êûRŸ^HHô]»X\›ö[ôÀ[ûOä
N¬àõ‹à
€€ú›àŸà[îõ›‹ H[êûRŸ^KúŸ]
	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_XäN¬à\HY\ôŸYõ›»H»[Y\›[\à›ö[ôŒ»›öZŸNàù[Xô\é»‹[€ï\Nàê—HàîHé»⁄Nàù[Xô\àù[»õ€[YNàù[Xô\àù[»^\ûNà›ö[ô»ù[N¬à€€ú›Y\ôŸYàY\ôŸYõ›÷◊HH‘õ›‹ÀõX\

äHOà
»[Y\›[\àãù[Y\›[\›öZŸNàãú›öZŸK‹[€ï\Nàãõ‹[€ï\K⁄Nàãõ⁄Kõ€[YNàãùõ€[YK^\ûNàãô^\ûHœ»ù[JJN¬à€€ú›ûRŸ^HHô]»X\›ö[ôÀY\ôŸYõ›œä
N¬àõ‹à
€€ú›àŸàY\ôŸY
HûRŸ^KúŸ]
	‹ãù[Y\›[\_	‹ãú›öZŸ__	‹ãõ‹[€ï\_XäN¬ÇàÀ»KKH\ã][Y\›[\YŸ‹ôYÿ]HùZ[KKBà[ù\ôòXŸH‹îõ›»¬à[Y\›[\à›ö[ôŒ»[ò[ZX–]T›öZŸNàù[Xô\àù[»^\ûNà›ö[ô»ù[¬àôX\ê]T‹ì⁄Nàù[Xô\àù[»ôX\ê]T‹ì⁄T]X[]Nà›ö[ôŒ¬àôX\ê]T‹ïõ€[YNàù[Xô\àù[»ôX\ê]T‹ïõ€[YT]X[]Nà›ö[ôŒ¬à]S€õT‹ì⁄Nàù[Xô\àù[»]S€õT‹ì⁄T]X[]Nà›ö[ôŒ¬à]S€õT‹ïõ€[YNàù[Xô\àù[»]S€õT‹ïõ€[YT]X[]Nà›ö[ôŒ¬àŸTS⁄R[Xò[[òŸNàù[Xô\àù[»ŸTS⁄R[Xò[[òŸT]X[]Nà›ö[ôŒ¬àŸTUõ€[YR[Xò[[òŸNàù[Xô\àù[»ŸTUõ€[YR[Xò[[òŸT]X[]Nà›ö[ôŒ¬à‹ì⁄P⁄[ôŸNàù[Xô\àù[»‹ì⁄P⁄[ôŸT]X[]Nà›ö[ôŒ¬à‹ïõ€[YP⁄[ôŸNàù[Xô\àù[»‹ïõ€[YP⁄[ôŸT]X[]Nà›ö[ôŒ¬à‹ì⁄Uô[ÿ⁄]Nàù[Xô\àù[»‹ì⁄Uô[ÿ⁄]T]X[]Nà›ö[ôŒ¬à‹ïõ€[YUô[ÿ⁄]Nàù[Xô\àù[»‹ïõ€[YUô[ÿ⁄]T]X[]Nà›ö[ôŒ¬à‹ì⁄PXÿŸ[\ò][€éàù[Xô\àù[»‹ì⁄PXÿŸ[\ò][€î]X[]Nà›ö[ôŒ¬à‹ïõ€[YPXÿŸ[\ò][€éàù[Xô\àù[»‹ïõ€[YPXÿŸ[\ò][€î]X[]Nà›ö[ôŒ¬à‹ì⁄T\òŸ[ù[U⁄][ë^Nàù[Xô\àù[»‹ì⁄T\òŸ[ù[U⁄][ë^T]X[]Nà›ö[ôŒ¬à‹ïõ€[YT\òŸ[ù[U⁄][ë^Nàù[Xô\àù[»‹ïõ€[YT\òŸ[ù[U⁄][ë^T]X[]Nà›ö[ôŒ¬àBÇà]ô\õ–ŸS⁄Q[õ€Z[ò]‹ê€›[ùH¬à]ô\õ–ŸUõ€[YQ[õ€Z[ò]‹ê€›[ùH¬à]]Tõ€ò[ú⁄][€ê€›[ùH¬à]€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùH¬à][õ€X[P€›[ùH¬Çà€€ú›õ›‹Œà‹îõ›÷◊HH◊N¬à]ô]ê]T›öZŸNàù[Xô\àù[[ôYö[ôYH[ôYö[ôY¬à]ô]ë^\ûNà›ö[ô»ù[[ôYö[ôYH[ôYö[ôY¬à]ô]ìôX\ê]T‹ì⁄Nàù[Xô\àù[Hù[¬à]ô]ìôX\ê]T‹ïõ€[YNàù[Xô\àù[Hù[¬à]ô]ïô[ÿ⁄]S⁄Nàù[Xô\àù[Hù[¬à]ô]ïô[ÿ⁄]Uõ€[YNàù[Xô\àù[Hù[¬à]ô]ï—õ‹ë[Nà›ö[ô»ù[Hù[¬Çàõ‹à
€€ú›»Ÿà\›[ò› H¬à€€ú›]T›öZŸHH[ê]PûUÀôŸ]
 Hœ»ù[¬à]^\ûNà›ö[ô»ù[Hù[¬àõ‹à
€€ú››öZŸHŸàö^Y›öZŸ\“[ïöY] H¬à€€ú›[ûTõ›»HûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__—X
Hœ»ûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__X
N¬àYà
[ûTõ› H»^\ûHH[ûTõ›Àô^\ûN»úôXZŒ»BàBÇà€€ú›õ€YHô]ê]T›öZŸHOOH[ôYö[ôY	âà]T›öZŸHOOHô]ê]T›öZŸN¬àYà
ô]ê]T›öZŸHOOH[ôYö[ôY	âà]T›öZŸHOOHù[	âàô]ê]T›öZŸHOOHù[	âà]T›öZŸHOOHô]ê]T›öZŸJH]Tõ€ò[ú⁄][€ê€›[ù
 Œ¬à€€ú›^\ûP⁄[ôŸYHô]ë^\ûHOOH[ôYö[ôY	âà^\ûHOOHù[	âàô]ë^\ûHOOHù[	âà^\ûHOOHô]ë^\ûN¬ÇàÀ»KKHôX\ãPUH›[»›ô\àHö^YÀ\›öZŸH[ö]ô\úŸHKKBà]›[ŸS⁄HH›[S⁄HH›[ŸUõ€[YHH›[Uõ€[YHH¬àõ‹à
€€ú››öZŸHŸàö^Y›öZŸ\“[ïöY] H¬à€€ú›ŸHHûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__—X
N¬à€€ú›HHûRŸ^KôŸ]
	›ﬂ_	‹›öZŸ__X
N¬àYà
ŸH	âàŸKõ⁄HOOHù[
H»Yà
ŸKõ⁄H
H[õ€X[P€›[ù
 Œ»[ŸH›[ŸS⁄H
œHŸKõ⁄N»BàYà
H	âàKõ⁄HOOHù[
H»Yà
Kõ⁄H
H[õ€X[P€›[ù
 Œ»[ŸH›[S⁄H
œHKõ⁄N»BàYà
ŸH	âàŸKùõ€[YHOOHù[
H»Yà
ŸKùõ€[YH
H[õ€X[P€›[ù
 Œ»[ŸH›[ŸUõ€[YH
œHŸKùõ€[YN»BàYà
H	âàKùõ€[YHOOHù[
H»Yà
Kùõ€[YH
H[õ€X[P€›[ù
 Œ»[ŸH›[Uõ€[YH
œHKùõ€[YN»BàBÇà]ôX\ê]T‹ì⁄Nàù[Xô\àù[Hù[ôX\ê]T‹ì⁄T]X[]HHïSêUêRSPìHé¬àYà
›[ŸS⁄Hà
H»ôX\ê]T‹ì⁄HH›[S⁄H»›[ŸS⁄N»ôX\ê]T‹ì⁄T]X[]HHïêSQé»Bà[ŸHô\õ–ŸS⁄Q[õ€Z[ò]‹ê€›[ù
 Œ¬Çà]ôX\ê]T‹ïõ€[YNàù[Xô\àù[Hù[ôX\ê]T‹ïõ€[YT]X[]HHïSêUêRSPìHé¬àYà
›[ŸUõ€[YHà
H»ôX\ê]T‹ïõ€[YHH›[Uõ€[YH»›[ŸUõ€[YN»ôX\ê]T‹ïõ€[YT]X[]HHïêSQé»Bà[ŸHô\õ–ŸUõ€[YQ[õ€Z[ò]‹ê€›[ù
 Œ¬Çà]ŸTS⁄R[Xò[[òŸNàù[Xô\àù[Hù[ŸTS⁄R[Xò[[òŸT]X[]HHïSêUêRSPìHé¬àYà
›[S⁄H
»›[ŸS⁄Hà
H»ŸTS⁄R[Xò[[òŸHH
›[S⁄HH›[ŸS⁄JH»
›[S⁄H
»›[ŸS⁄JN»ŸTS⁄R[Xò[[òŸT]X[]HHïêSQé»BÇà]ŸTUõ€[YR[Xò[[òŸNàù[Xô\àù[Hù[ŸTUõ€[YR[Xò[[òŸT]X[]HHïSêUêRSPìHé¬àYà
›[Uõ€[YH
»›[ŸUõ€[YHà
H»ŸTUõ€[YR[Xò[[òŸHH
›[Uõ€[YHH›[ŸUõ€[YJH»
›[Uõ€[YH
»›[ŸUõ€[YJN»ŸTUõ€[YR[Xò[[òŸT]X[]HHïêSQé»BÇàÀ»KKHUK[€õH€ò\⁄›
õ€[ô»›öZŸKõ»\ö]ôY[YHŸ\öY\ HKKBà]]S€õT‹ì⁄Nàù[Xô\àù[Hù[]S€õT‹ì⁄T]X[]HHïSêUêRSPìHé¬à]]S€õT‹ïõ€[YNàù[Xô\àù[Hù[]S€õT‹ïõ€[YT]X[]HHïSêUêRSPìHé¬àYà
]T›öZŸHOOHù[
H¬à€€ú›]PŸHHûRŸ^KôŸ]
	›ﬂ_	ÿ]T›öZŸ__—X
N¬à€€ú›]THHûRŸ^KôŸ]
	›ﬂ_	ÿ]T›öZŸ__X
N¬àYà
]PŸH	âà]TH	âà]PŸKõ⁄HOOHù[	âà]TKõ⁄HOOHù[
H¬àYà
]PŸKõ⁄Hà
H»]S€õT‹ì⁄HH]TKõ⁄H»]PŸKõ⁄N»]S€õT‹ì⁄T]X[]HHïêSQé»Bà[ŸHô\õ–ŸS⁄Q[õ€Z[ò]‹ê€›[ù
 Œ¬àBàYà
]PŸH	âà]TH	âà]PŸKùõ€[YHOOHù[	âà]TKùõ€[YHOOHù[
H¬àYà
]PŸKùõ€[YHà
H»]S€õT‹ïõ€[YHH]TKùõ€[YH»]PŸKùõ€[YN»]S€õT‹ïõ€[YT]X[]HHïêSQé»Bà[ŸHô\õ–ŸUõ€[YQ[õ€Z[ò]‹ê€›[ù
 Œ¬àBàBÇàÀ»KKH⁄[ôŸH»ô[ÿ⁄]H»XÿŸ[\ò][€ã\ö]ôY”ìHúõ€HHö^Y][ö]ô\úŸHôX\ê]T‹àŸ\öY\»KKBà]‹ì⁄P⁄[ôŸNàù[Xô\àù[Hù[‹ì⁄P⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]‹ïõ€[YP⁄[ôŸNàù[Xô\àù[Hù[‹ïõ€[YP⁄[ôŸT]X[]HHïSêUêRSPìHé¬à]‹ì⁄Uô[ÿ⁄]Nàù[Xô\àù[Hù[‹ì⁄Uô[ÿ⁄]T]X[]HHïSêUêRSPìHé¬à]‹ïõ€[YUô[ÿ⁄]Nàù[Xô\àù[Hù[‹ïõ€[YUô[ÿ⁄]T]X[]HHïSêUêRSPìHé¬à]‹ì⁄PXÿŸ[\ò][€éàù[Xô\àù[Hù[‹ì⁄PXÿŸ[\ò][€î]X[]HHïSêUêRSPìHé¬à]‹ïõ€[YPXÿŸ[\ò][€éàù[Xô\àù[Hù[‹ïõ€[YPXÿŸ[\ò][€î]X[]HHïSêUêRSPìHé¬Çà€€ú›ÿ[ê€€\\ôU‘ô]àHô]ï—õ‹ë[HOOHù[	âàY^\ûP⁄[ôŸY¬àYà
ô]ï—õ‹ë[HOOHù[^\ûP⁄[ôŸY
H¬à€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ù
 Œ¬àH[ŸH¬àYà
ôX\ê]T‹ì⁄T]X[]HOOHïêSQà	âàô]ìôX\ê]T‹ì⁄HOOHù[
H¬à‹ì⁄P⁄[ôŸHHôX\ê]T‹ì⁄HHHô]ìôX\ê]T‹ì⁄N¬à‹ì⁄P⁄[ôŸT]X[]HHïêSQé¬à€€ú›[SZ[àH
ô]»]J KôŸ][YJ
HHô]»]Jô]ï—õ‹ë[JKôŸ][YJ
JH»å¬àYà
[SZ[àà
H»‹ì⁄Uô[ÿ⁄]HH‹ì⁄P⁄[ôŸH»[SZ[é»‹ì⁄Uô[ÿ⁄]T]X[]HHïêSQé»BàBàYà
ôX\ê]T‹ïõ€[YT]X[]HOOHïêSQà	âàô]ìôX\ê]T‹ïõ€[YHOOHù[
H¬à‹ïõ€[YP⁄[ôŸHHôX\ê]T‹ïõ€[YHHHô]ìôX\ê]T‹ïõ€[YN¬à‹ïõ€[YP⁄[ôŸT]X[]HHïêSQé¬à€€ú›[SZ[àH
ô]»]J KôŸ][YJ
HHô]»]Jô]ï—õ‹ë[JKôŸ][YJ
JH»å¬àYà
[SZ[àà
H»‹ïõ€[YUô[ÿ⁄]HH‹ïõ€[YP⁄[ôŸH»[SZ[é»‹ïõ€[YUô[ÿ⁄]T]X[]HHïêSQé»BàBàBàYà
‹ì⁄Uô[ÿ⁄]T]X[]HOOHïêSQà	âàô]ïô[ÿ⁄]S⁄HOOHù[
H¬à‹ì⁄PXÿŸ[\ò][€àH‹ì⁄Uô[ÿ⁄]HHHô]ïô[ÿ⁄]S⁄N¬à‹ì⁄PXÿŸ[\ò][€î]X[]HHïêSQé¬àBàYà
‹ïõ€[YUô[ÿ⁄]T]X[]HOOHïêSQà	âàô]ïô[ÿ⁄]Uõ€[YHOOHù[
H¬à‹ïõ€[YPXÿŸ[\ò][€àH‹ïõ€[YUô[ÿ⁄]HHHô]ïô[ÿ⁄]Uõ€[YN¬à‹ïõ€[YPXÿŸ[\ò][€î]X[]HHïêSQé¬àBÇàõ›‹Àú\⁄
¬à[Y\›[\àÀ[ò[ZX–]T›öZŸNà]T›öZŸK^\ûKàôX\ê]T‹ì⁄KôX\ê]T‹ì⁄T]X[]KôX\ê]T‹ïõ€[YKôX\ê]T‹ïõ€[YT]X[]Kà]S€õT‹ì⁄K]S€õT‹ì⁄T]X[]K]S€õT‹ïõ€[YK]S€õT‹ïõ€[YT]X[]KàŸTS⁄R[Xò[[òŸKŸTS⁄R[Xò[[òŸT]X[]KŸTUõ€[YR[Xò[[òŸKŸTUõ€[YR[Xò[[òŸT]X[]Kà‹ì⁄P⁄[ôŸK‹ì⁄P⁄[ôŸT]X[]K‹ïõ€[YP⁄[ôŸK‹ïõ€[YP⁄[ôŸT]X[]Kà‹ì⁄Uô[ÿ⁄]K‹ì⁄Uô[ÿ⁄]T]X[]K‹ïõ€[YUô[ÿ⁄]K‹ïõ€[YUô[ÿ⁄]T]X[]Kà‹ì⁄PXÿŸ[\ò][€ã‹ì⁄PXÿŸ[\ò][€î]X[]K‹ïõ€[YPXÿŸ[\ò][€ã‹ïõ€[YPXÿŸ[\ò][€î]X[]Kà‹ì⁄T\òŸ[ù[U⁄][ë^Nàù[‹ì⁄T\òŸ[ù[U⁄][ë^T]X[]NàïSêUêRSPìHãà‹ïõ€[YT\òŸ[ù[U⁄][ë^Nàù[‹ïõ€[YT\òŸ[ù[U⁄][ë^T]X[]NàïSêUêRSPìHãàJN¬ÇàÀ»îô]ö[›\»à⁄[ù\ú»[ÿ^\»Yò[òŸH»T»[Y\›[\	‹»›€àò[YH
‹àù[Yà\»[Y\›[\ÿ\¬àÀ»]Ÿ[à[ùò[Y
HKH€€\\ö\€€ú»[ÿ^\»\ŸHH›öX›KXYòXŸ[ùö[‹à[Y\›[\ô]ô\àH›[BàÀ»ÿ\úöYYYõ‹ùÿ\ôò[YHúõ€Hù\ù\àòX⁄ÀàH
î]X[]HõY‹»Xõ›ôH[ôXYHÿ]H⁄]\à]àÀ»YòXŸ[ù€€\\ö\€€àÿ\»\ÿXõKÇàô]ê]T›öZŸHH]T›öZŸN¬àô]ë^\ûHH^\ûN¬àô]ìôX\ê]T‹ì⁄HHôX\ê]T‹ì⁄T]X[]HOOHïêSQà»ôX\ê]T‹ì⁄Hàù[¬àô]ìôX\ê]T‹ïõ€[YHHôX\ê]T‹ïõ€[YT]X[]HOOHïêSQà»ôX\ê]T‹ïõ€[YHàù[¬àô]ïô[ÿ⁄]S⁄HH‹ì⁄Uô[ÿ⁄]T]X[]HOOHïêSQà»‹ì⁄Uô[ÿ⁄]Hàù[¬àô]ïô[ÿ⁄]Uõ€[YHH‹ïõ€[YUô[ÿ⁄]T]X[]HOOHïêSQà»‹ïõ€[YUô[ÿ⁄]Hàù[¬àô]ï—õ‹ë[HHŒ¬àBÇàÀ»KKH\òŸ[ù[K]⁄][ãY^H
€€\]YYù\àù[Ÿ\öY\»\»€õ›€äHKKBà€€ú›ò[Y⁄Uò[Y\»Hõ›‹Àôö[\ä
äHOàãõôX\ê]T‹ì⁄T]X[]HOOHïêSQäKõX\

äHOàãõôX\ê]T‹ì⁄H\»ù[Xô\äKú€‹ù

KäHOàHHäN¬à€€ú›ò[Yõ€ò[Y\»Hõ›‹Àôö[\ä
äHOàãõôX\ê]T‹ïõ€[YT]X[]HOOHïêSQäKõX\

äHOàãõôX\ê]T‹ïõ€[YH\»ù[Xô\äKú€‹ù

KäHOàHHäN¬àõ‹à
€€ú›àŸàõ›‹ H¬àYà
ãõôX\ê]T‹ì⁄T]X[]HOOHïêSQà	âàò[Y⁄Uò[Y\Àõ[ô›àJH¬à€€ú›€›[ùHHò[Y⁄Uò[Y\Àôö[\ä
äHOààH
ãõôX\ê]T‹ì⁄H\»ù[Xô\äJKõ[ô›¬àãú‹ì⁄T\òŸ[ù[U⁄][ë^HH

€›[ùHHJH»
ò[Y⁄Uò[Y\Àõ[ô›HJJH
àL¬àãú‹ì⁄T\òŸ[ù[U⁄][ë^T]X[]HHïêSQé¬àBàYà
ãõôX\ê]T‹ïõ€[YT]X[]HOOHïêSQà	âàò[Yõ€ò[Y\Àõ[ô›àJH¬à€€ú›€›[ùHHò[Yõ€ò[Y\Àôö[\ä
äHOààH
ãõôX\ê]T‹ïõ€[YH\»ù[Xô\äJKõ[ô›¬àãú‹ïõ€[YT\òŸ[ù[U⁄][ë^HH

€›[ùHHJH»
ò[Yõ€ò[Y\Àõ[ô›HJJH
àL¬àãú‹ïõ€[YT\òŸ[ù[U⁄][ë^T]X[]HHïêSQé¬àBàBÇà€€ú›ò[YôX\ê]T‹ì⁄P€›[ùHõ›‹Àôö[\ä
äHOàãõôX\ê]T‹ì⁄T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[YôX\ê]T‹ïõ€[YP€›[ùHõ›‹Àôö[\ä
äHOàãõôX\ê]T‹ïõ€[YT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y]S€õT‹ì⁄P€›[ùHõ›‹Àôö[\ä
äHOàãò]S€õT‹ì⁄T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y]S€õT‹ïõ€[YP€›[ùHõ›‹Àôö[\ä
äHOàãò]S€õT‹ïõ€[YT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ì⁄P⁄[ôŸP€›[ùHõ›‹Àôö[\ä
äHOàãú‹ì⁄P⁄[ôŸT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ïõ€[YP⁄[ôŸP€›[ùHõ›‹Àôö[\ä
äHOàãú‹ïõ€[YP⁄[ôŸT]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ì⁄Uô[ÿ⁄]P€›[ùHõ›‹Àôö[\ä
äHOàãú‹ì⁄Uô[ÿ⁄]T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ïõ€[YUô[ÿ⁄]P€›[ùHõ›‹Àôö[\ä
äHOàãú‹ïõ€[YUô[ÿ⁄]T]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ì⁄PXÿŸ[\ò][€ê€›[ùHõ›‹Àôö[\ä
äHOàãú‹ì⁄PXÿŸ[\ò][€î]X[]HOOHïêSQäKõ[ô›¬à€€ú›ò[Y‹ïõ€[YPXÿŸ[\ò][€ê€›[ùHõ›‹Àôö[\ä
äHOàãú‹ïõ€[YPXÿŸ[\ò][€î]X[]HOOHïêSQäKõ[ô›¬ÇàÀ»KKH\‹Ÿ[XõHö[ò[›]]KKBà€€ú›€›\òŸSX[öYô\›Y»H»[ò[ZX’öY]—ö[RY—ö[RYà—ö[U\ŸYöY—ö[Sò[YNà—ö[U\ŸYõò[YK–⁄X⁄‹›[HN¬à€€ú›ÿ[›[]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú››]]^[ÿYH»ôX]\ôQò[Z[Nàëç‘‘àãõ‹õ][Uô\ú⁄[€éàëç‘‘ó›åHã€›\òŸSX[öYô\›YÀÿ[›[]Y]Ÿ\öY\Œàõ›‹»N¬Çàù[ò›[€à€€\]P⁄X⁄‹›[J^[ÿYà\[Ÿà›]]^[ÿY
H¬à€€ú›»ÿ[›[]Y]ããúô\›HH^[ÿY¬àô]\õà‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJô\›
JKôYŸ\›
ö^äN¬àBà€€ú›ù[åP⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N¬à€€ú›ù[åê⁄X⁄‹›[HH€€\]P⁄X⁄‹›[J›]]^[ÿY
N¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»KKH‘íUH»^\›[ô»Y\ò\ò⁄KëPQêP“Àô\öYûHKKBà€€ú›ö[Sò[YHH\ö]ò]]ô\◊—ç”íQïWÃåçãLLLW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]ö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à]‹ö]T›]\»Hìì’–USTQé¬àYà
[ö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJ›]]^[ÿY
KôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÀöYœ»ù[¬à‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]ôXY›]\»Hìì’–USTQé¬àYà
ö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬àôXY›]\»Hòà	âà\úò^Kö\–\úò^JòãúŸ\öY\ H	âàòãúŸ\öY\Àõ[ô›OOHõ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇà€€ú›”õ›ùZ[öY[—õ›[ôH»ö]àãú⁄Ÿ]»ãô[Hãôÿ[[XHãù]HãùôYÿHãúÿ€‹ôHãúõÿòXö[]HãòöX\»ãòÿ[ôY]Hãô[ùûHãú€ãù\ôŸ]ãùô\ôX›ãòù[\⁄ãòôX\ö\⁄ãú›\‹ùãúô\⁄\›[òŸHóBàôö[\ä
äHOàõ›‹Àú€€YJ
éà[ûJHOàà[àäJN¬à€€ú›”õ›ùZ[⁄X⁄»H”õ›ùZ[öY[—õ›[ôõ[ô›OOH»îT‘»ààêRSà	Ÿ”õ›ùZ[öY[—õ›[ôöõ⁄[äãä_X¬ÇàÀ»òSã“[ôö[ö]H›X\ôKHô\öYûHõ›[ô»õ€ãYö[ö]HXYH][ù»H^[ÿYà]ò[ì‹í[ôö[ö]P€›[ùH¬àõ‹à
€€ú›àŸàõ›‹ H¬àõ‹à
€€ú›àŸàÿöôX›ùò[Y\ äJH¬àYà
\[ŸààOOHõù[Xô\àà	âàSù[Xô\ãö\—ö[ö]JäJHò[ì‹í[ôö[ö]P€›[ù
 Œ¬àBàBàYà
ò[ì‹í[ôö[ö]P€›[ùà
H[õ€X[P€›[ù
œHò[ì‹í[ôö[ö]P€›[ù¬Çà€€ú›[ôXYŸT›]\»H€›\òŸSX[öYô\›YÀô[ò[ZX’öY]—ö[RY	âà€›\òŸSX[öYô\›YÀõ—ö[RY	âà€›\òŸSX[öYô\›YÀõ–⁄X⁄‹›[H»îT‘»ààëêRSé¬Çà€€ú››ô\ò[›]\»Bà‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»à	âàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âÇà[ôXYŸT›]\»OOHîT‘»à	âà”õ›ùZ[⁄X⁄»OOHîT‘»à	âàò[ì‹í[ôö[ö]P€›[ùOOHà»îT‘»Çàà
‹ö]T›]\Àú›\ù’⁄]
îT‘»äH»îTïPSààëêRSäN¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\ÀàôX]\ô\–ùZ[à»õôX\ê]T‹ì⁄HãõôX\ê]T‹ïõ€[YHãò]S€õT‹ì⁄Hãò]S€õT‹ïõ€[YHãú‹ì⁄P⁄[ôŸHãú‹ïõ€[YP⁄[ôŸHãú‹ì⁄Uô[ÿ⁄]Hãú‹ïõ€[YUô[ÿ⁄]Hãú‹ì⁄PXÿŸ[\ò][€àãú‹ïõ€[YPXÿŸ[\ò][€àãú‹ì⁄T\òŸ[ù[U⁄][ë^Hãú‹ïõ€[YT\òŸ[ù[U⁄][ë^HãòŸTS⁄R[Xò[[òŸHãòŸTUõ€[YR[Xò[[òŸHóKà›[[ú]õ›‹Œà‘õ›‹Àõ[ô›à[Y\›[\€›[ùà\›[ò›Àõ[ô›àò[YôX\ê]T‹ì⁄P€›[ùàò[YôX\ê]T‹ïõ€[YP€›[ùàò[Y]S€õT‹ì⁄P€›[ùàò[Y]S€õT‹ïõ€[YP€›[ùàò[Y‹ì⁄P⁄[ôŸP€›[ùàò[Y‹ïõ€[YP⁄[ôŸP€›[ùàò[Y‹ì⁄Uô[ÿ⁄]P€›[ùàò[Y‹ïõ€[YUô[ÿ⁄]P€›[ùàò[Y‹ì⁄PXÿŸ[\ò][€ê€›[ùàò[Y‹ïõ€[YPXÿŸ[\ò][€ê€›[ùàô\õ–ŸS⁄Q[õ€Z[ò]‹ê€›[ùàô\õ–ŸUõ€[YQ[õ€Z[ò]‹ê€›[ùà€€ùòX›ò[ú⁄][€ï[ò]òZ[XõP€›[ùà]Tõ€ò[ú⁄][€ê€›[ùà[õ€X[P€›[ùà‹ö]T›]\ÀàôXY›]\Ààö[RYàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à[ôXYŸT›]\Àà€›\òŸSX[öYô\›YÀà”õ›ùZ[⁄X⁄ÀàôX€€ô][€éà»ù[P€›ô\ôY[Y\›[\€›[ùà\›[ò›Àõ[ô›[ùò[YX\[ô–€›[ù[ùò[Y[€ô^[ô\‹–€›[ùŸTTﬁ[[Y]ûUö[€][€úÀ\‹ŒàôX€€ô][€î\‹»Kà—ÿ]NàùYKàå—ÿ]Kà€õ›€ì[Z]][€úŒà¬àú‹ì⁄P⁄[ôŸK‹‹ïõ€[YP⁄[ôŸK’ô[ÿ⁄]K–XÿŸ[\ò][€à\ôH\ö]ôY€õHúõ€HHö^Y][ö]ô\úŸHôX\ê]T‹ì⁄K’õ€[YHŸ\öY\»KH]S€õT‹ì⁄K’õ€[YH\ôH⁄[ùZ[ã][YH€ò\⁄›»⁄]õ»\ö]ôY[YHŸ\öY\À⁄[òŸHHUH›öZŸH]Ÿ[àõ€»[ùòY^KàãàòŸTS⁄R[Xò[[òŸH[ôŸTUõ€[YR[Xò[[òŸH\ŸHHÿ[YHö^YUp¨L»[ö]ô\úŸH›[»\»ôX\ê]T‹ãõ›HUK[€õH€€ùòX›àãàî\òŸ[ù[K]⁄][ãY^H\»H\ô[H\ÿ‹ö\]ôHò[ö»
LL
H›ô\à\»⁄[ô€HòY[ô»^I‹»ò[YÿúŸ\ùò][€ú»KHõ›HõŸX›[€àÿ€‹ö[ô»⁄Y€ò[\à\ô‹ù[\Ààãàìõ»ù[X⁄Z[à‘à\»õŸXŸY‹à[\YY»[‘àò[Y\»\ôHÿ€‹Y›öX›H»H]Y]YUp¨L»›öZŸH[ö]ô\úŸKàãàKàÿYôU‘õÿŸYY—çNà›ô\ò[›]\»OOHîT‘»ãàåï[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àç‘àùZ[òZ[\ôHãàÿYôU‘õÿŸYY—çNàò[ŸKàKL
N¬àBüJN¬ÇÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å—”—çW“Uó‘–“QSê—H8†%UPSUKQ–UQT’‘íP–SUàëPUTëT¬ãÀ¬ãÀ»\»\»Hö\ú›çH€XŸKà]€€ú›[Y\»€õHH[ôXYK\›‹ôYô\öYöYYãÀ»íQïHUp¨L»\›‹öXÿ[‹öY[ô]»[ò[ZXÀPUHöY]Ààõ›öY\àUà\»ô]ô\ÇãÀ»ÿ[›[]Y[\]Yõ‹ùÿ\ôYö[Y‹à€€ùô\ùYúõ€HZ\‹⁄[ô»»ô\õÀÇãÀ»Z\‹⁄[ôÀô\õÀôYÿ]]ôKõ€ã[ù[Y\öXÀ[ôõ€ãYö[ö]HUà[òZ[Hò]ÀRUÇãÀ»]X[]Hÿ]Kà⁄[ôŸK›ô[ÿ⁄]KÿXÿŸ[\ò][€à\ôHÿ[›[]Y€õH[ú⁄YH€ôBãÀ»ö^Y
^\ûK›öZŸK‹[€ï\JH€€ùòX›[ô€õHX‹õ‹‹»[à[ö[ù\úù\YãÀ»€ôK[Z[ù]HÿY[òŸKà\‹\ú⁄[€ã‹ò[ôŸH\ŸHò[YRUàõ›‹»€õH[ô^X⁄]BãÀ»\ÿ€‹ŸH\ùX[][ö]ô\úŸH€›ô\òYŸKÇãÀ¬ãÀ»õ»çã‹ÿ€‹ö[ôÀ‹õÿòXö[]KÿöX\Àÿÿ[ôY]K€‹ô\ã›ô\ôX›–RH€‹ö»\»\ôõ‹õYYÇãÀ»YàH›‹ôY[à\›‹ûH€€ùZ[ú»õ»ò[YUã\»õ›]Hô]\õú»ì–“—QãÀ»[ô‹ö]\»õ»çH\ùYòX›à]\»Hô\]Z\ôY€ô\››]€€YKõ›HòZ[\ôBãÀ»»ôHY[à⁄][Ÿ[X€€\]Y‹àòXúöXÿ]Yò[Y\ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ôŸ]
ãÿ\Kÿ]Y]›åŸ[YçKZ]ã\ÿ⁄Y[òŸK\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBÇà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH¬à\ò⁄]X›\ôTõ€Nàïå—”—çW“Uó‘–“QSê—Hãà\⁄ŒàêïRS‘UPSUW—–UQ—çW“Uó—ëPUTëT»ãàŸ[ô\ò]Y]àﬁ[Xõ€àìíQïHãàòY[ô—]NàååçãLLLHãàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YàãÿYôU‘õÿŸYY—çéàò[ŸKçìõ››\ùYàùYHKå
N¬àBÇàûH¬à€€ú›^X›Y‘õ›‹»HNN¬à€€ú›^X›Y[Y\›[\€›[ùHÕÕ¬à€€ú›ô\]Z\ôY]SŸôúŸ]»HÀLÀLãLKKã◊N¬à€€ú›ô\]Z\ôYŸôúŸ]Ÿ]Hô]»Ÿ]
ô\]Z\ôY]SŸôúŸ] N¬à€€ú›^X›Y€€ùòX›‘\ï[Y\›[\Hô\]Z\ôY]SŸôúŸ]Àõ[ô›
àé¬à€€ú›^X›Yô\]Z\ôY[ö]ô\úŸTõ›‹»H^X›Y[Y\›[\€›[ù
à^X›Y€€ùòX›‘\ï[Y\›[\¬à€€ú›[ò[ZX’öY]—ö[RYHåLîôQﬁRV]PX]õL^Z›ûéå€êÿYïÕöôàé¬ÇàÀ»KKHåã—åÀ—ç€›\òŸHôX€€ô][€éà^X›ô\öYöYY[ò[ZX»öY]»KKBà€€ú›[îõ›‹Œà[ûV◊HH]ÿZ]ö]ôTôXYö[PûRY
[ò[ZX’öY]—ö[RY⁄Ÿ[äN¬àYà
P\úò^Kö\–\úò^J[îõ›‹ H[îõ›‹Àõ[ô›OOH^X›Y‘õ›‹ H¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà[ò[ZX»UHöY]»ÿ]HòZ[Yà^X›Y	Ÿ^X›Y‘õ›‹ﬂHõ›‹À€›	–\úò^Kö\–\úò^J[îõ›‹ H»[îõ›‹Àõ[ô›àõõ€ãX\úò^HüKòàÿYôU‘õÿŸYY—çéàò[ŸKàçìõ››\ùYàùYKàKå
N¬àBÇà€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›ôX]õ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äåŸ\ö]ò]]ôWŸôX]\ô\»ã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›ôX]ﬁ[Xõ€õ€\àHôX]õ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïHãôX]õ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\àYôX]ﬁ[Xõ€õ€\äH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàí\›‹öXÿ[›‹ôHõ€\à€⁄›\òZ[YàãÿYôU‘õÿŸYY—çéàò[ŸKçìõ››\ùYàùYHKå
N¬àBÇàÀ»KKH^X⁄]çÿ]Nà^X›[ôXYŸH\»⁄X⁄ŸYYù\à»\»Ÿ[X›YKKBà€€ú›ôX]\ôQö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬à€€ú›çÿ[ôY]\»HôX]\ôQö[\Àôö[\ä
ö[JHOàö[Kõò[YKú›\ù’⁄]
ô\ö]ò]]ô\◊—ç”íQïWÃåçãLLLW»äJN¬ÇàÀ»KKHÿÿ]HH^X›NN\õ›»›‹ôY»‹öY\ŸYûHåãQçKKBà€€ú›—ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›–ÿ[ôY]\»H—ö[\Àôö[\ä
ö[JHOàö[Kõò[YKú›\ù’⁄]
õ‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW»äJN¬à]‘õ›‹Œà[ûV◊Hù[Hù[¬à]—ö[U\ŸYà»Yà›ö[ôŒ»ò[YNà›ö[ô»Hù[Hù[¬àõ‹à
€€ú›ö[HŸà–ÿ[ôY]\ H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[KöY⁄Ÿ[äN¬àYà
\úò^Kö\–\úò^JôXYòX⁄ H	âàôXYòX⁄Àõ[ô›OOH^X›Y‘õ›‹ H¬à‘õ›‹»HôXYòX⁄Œ¬à—ö[U\ŸYHö[N¬àúôXZŒ¬àBàBàYà
[‘õ›‹»[—ö[U\ŸY
H¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà»ÿ]HòZ[Yàõ»	Ÿ^X›Y‘õ›‹ﬂK\õ›»‹[€à‹öYõ›[ôòà–ÿ[ôY]\–⁄X⁄ŸYà–ÿ[ôY]\ÀõX\

ö[JHOàö[Kõò[YJKàÿYôU‘õÿŸYY—çéàò[ŸKàçìõ››\ùYàùYKàKå
N¬àBÇà€€ú›–⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ‘õ›‹ JKôYŸ\›
ö^äN¬à€€ú›[ê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ[îõ›‹ JKôYŸ\›
ö^äN¬ÇàÀ»Hÿ[YKY]K‹õ›ÀX€›[ùçö[H\»õ››YôöX⁄Y[ùà]]\›õ›ôH]]àÀ»ÿ\»ùZ[úõ€H\»^X›»ö[Kÿ⁄X⁄‹›[H[ô\»[ò[ZXÀ]öY]»QÇà]ç\ùYòX›à[ûHHù[¬à]çö[U\ŸYà»Yà›ö[ôŒ»ò[YNà›ö[ô»Hù[Hù[¬àõ‹à
€€ú›ö[HŸàçÿ[ôY]\ H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[KöY⁄Ÿ[äN¬à€€ú›[ôXYŸHHôXYòX⁄œÀú€›\òŸSX[öYô\›YŒ¬àYà
ôXYòX⁄œÀôôX]\ôQò[Z[HOOHëç‘‘àà	âÇà\úò^Kö\–\úò^JôXYòX⁄ÀúŸ\öY\ H	âàôXYòX⁄ÀúŸ\öY\Àõ[ô›OOH^X›Y[Y\›[\€›[ù	âÇà[ôXYŸOÀô[ò[ZX’öY]—ö[RYOOH[ò[ZX’öY]—ö[RY	âÇà[ôXYŸOÀõ—ö[RYOOH—ö[U\ŸYöY	âÇà[ôXYŸOÀõ–⁄X⁄‹›[HOOH–⁄X⁄‹›[JH¬àç\ùYòX›HôXYòX⁄Œ¬àçö[U\ŸYHö[N¬àúôXZŒ¬àBàBàYà
Yç\ùYòX›Yçö[U\ŸY
H¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éàëçÿ]HòZ[Yàõ»ôXYXõHÕÕ\õ›»ç‘‘à\ùYòX›⁄]^X›»[ôXYŸHõ›[ôàãàçÿ[ôY]\–⁄X⁄ŸYàçÿ[ôY]\ÀõX\

ö[JHOàö[Kõò[YJKàô\]Z\ôY—ö[RYà—ö[U\ŸYöYàô\]Z\ôY–⁄X⁄‹›[Nà–⁄X⁄‹›[KàÿYôU‘õÿŸYY—çéàò[ŸKàçìõ››\ùYàùYKàKå
N¬àBà€€ú›ç⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJç\ùYòX›
JKôYŸ\›
ö^äN¬ÇàÀ»KKHY\ôŸH[ò[ZX»ŸôúŸ]€ù»»⁄]›]⁄[ô⁄[ô»‹à[ùô[ù[ô»[àUàöY[KKBà€€ú›[êûRŸ^HHô]»X\›ö[ôÀ[ûOä
N¬à][ò[ZX“õ⁄[ë\Xÿ]P€›[ùH¬àõ‹à
€€ú›õ›»Ÿà[îõ›‹ H¬à€€ú›Ÿ^HH	‹õ›Àù[Y\›[\_	‹õ›Àú›öZŸ__	‹õ›Àõ‹[€ï\_X¬àYà
[êûRŸ^Kö\ Ÿ^JJH[ò[ZX“õ⁄[ë\Xÿ]P€›[ù
 Œ¬à[êûRŸ^KúŸ]
Ÿ^Kõ› N¬àBà][ò[ZX“õ⁄[ìZ\‹⁄[ô–€›[ùH¬à€€ú›Y\ôŸYõ›‹»H‘õ›‹ÀõX\

õ› HOà¬à€€ú›[ò[ZX‘õ›»H[êûRŸ^KôŸ]
	‹õ›Àù[Y\›[\_	‹õ›Àú›öZŸ__	‹õ›Àõ‹[€ï\_X
N¬àYà
Y[ò[ZX‘õ› H[ò[ZX“õ⁄[ìZ\‹⁄[ô–€›[ù
 Œ¬àô]\õà¬àããúõ›Àà[ò[ZX–]SŸôúŸ]à[ò[ZX‘õ›œÀô[ò[ZX–]SŸôúŸ]œ»ù[àN¬àJN¬ÇàÀ»H\›‹öXÿ[ò\⁄Ÿ]€€ùZ[ú»ö^Y›öZŸ\»Yù\àH€›ô\òYŸHô\Z\ãÇàÀ»çH\»^X⁄]Hÿ€‹YòX⁄»»HùYH\ã][Y\›[\Up¨L»[ö]ô\úŸKÇà€€ú›ô\]Z\ôY[ö]ô\úŸTõ›‹»HY\ôŸYõ›‹Àôö[\ä
õ› HOÇà\[Ÿàõ›Àô[ò[ZX–]SŸôúŸ]OOHõù[Xô\àà	âàô\]Z\ôYŸôúŸ]Ÿ]ö\ õ›Àô[ò[ZX–]SŸôúŸ]
Bà
N¬à€€ú›õ›‹–ûU[Y\›[\Hô]»X\›ö[ôÀ[ûV◊Oä
N¬àõ‹à
€€ú›õ›»Ÿàô\]Z\ôY[ö]ô\úŸTõ›‹ H¬à€€ú›õ›‹»Hõ›‹–ûU[Y\›[\ôŸ]
õ›Àù[Y\›[\
H◊N¬àõ›‹Àú\⁄
õ› N¬àõ›‹–ûU[Y\›[\úŸ]
õ›Àù[Y\›[\õ›‹ N¬àBà€€ú›^X›YŸôúŸ]⁄YRŸ^\»Hô\]Z\ôY]SŸôúŸ]Àôõ]X\

ŸôúŸ]
HOàÿ	€ŸôúŸ]_—X	€ŸôúŸ]_XJN¬à][ö]ô\úŸRY[ù]Uö[€][€ê€›[ùH¬àõ‹à
€€ú›õ›‹»Ÿàõ›‹–ûU[Y\›[\ùò[Y\ 
JH¬à€€ú›€€ùòX›Ÿ^\»Hô]»Ÿ]
õ›‹ÀõX\

õ› HOà	‹õ›Àô^\û__	‹õ›Àú›öZŸ__	‹õ›Àõ‹[€ï\_X
JN¬à€€ú›^\ûTŸ]Hô]»Ÿ]
õ›‹ÀõX\

õ› HOàõ›Àô^\ûJJN¬à€€ú›ŸôúŸ]⁄YP€›[ù»Hô]»X\›ö[ôÀù[Xô\èä
N¬àõ‹à
€€ú›õ›»Ÿàõ›‹ H¬à€€ú›Ÿ^HH	‹õ›Àô[ò[ZX–]SŸôúŸ]_	‹õ›Àõ‹[€ï\_X¬àŸôúŸ]⁄YP€›[ùÀúŸ]
Ÿ^K
ŸôúŸ]⁄YP€›[ùÀôŸ]
Ÿ^JHœ»
H
»JN¬àBà€€ú›^X›ŸôúŸ]⁄YU[ö]ô\úŸHH^X›YŸôúŸ]⁄YRŸ^\Àô]ô\ûJ
Ÿ^JHOàŸôúŸ]⁄YP€›[ùÀôŸ]
Ÿ^JHOOHJN¬àYà
õ›‹Àõ[ô›OOH^X›Y€€ùòX›‘\ï[Y\›[\à€€ùòX›Ÿ^\Àú⁄^ôHOOH^X›Y€€ùòX›‘\ï[Y\›[\à^\ûTŸ]ú⁄^ôHOOHHàY^X›ŸôúŸ]⁄YU[ö]ô\úŸJH¬à[ö]ô\úŸRY[ù]Uö[€][€ê€›[ù
 Œ¬àBàBà€€ú›[ö]ô\úŸTôX€€ô][€î\‹»Bà[ò[ZX“õ⁄[ë\Xÿ]P€›[ùOOH	âÇà[ò[ZX“õ⁄[ìZ\‹⁄[ô–€›[ùOOH	âÇàô\]Z\ôY[ö]ô\úŸTõ›‹Àõ[ô›OOH^X›Yô\]Z\ôY[ö]ô\úŸTõ›‹»	âÇàõ›‹–ûU[Y\›[\ú⁄^ôHOOH^X›Y[Y\›[\€›[ù	âÇà[ö]ô\úŸRY[ù]Uö[€][€ê€›[ùOOH¬àYà
][ö]ô\úŸTôX€€ô][€î\‹ H¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éàêUp¨L»[ö]ô\úŸHôX€€ô][€àòZ[Y»›‹[ô»ôYõ‹ôHUàôX]\ôH€€ú›ùX›[€ãàãàô\]Z\ôY[ö]ô\úŸTõ›–€›[ùàô\]Z\ôY[ö]ô\úŸTõ›‹Àõ[ô›à^X›Yô\]Z\ôY[ö]ô\úŸTõ›‹Àà[Y\›[\€›[ùàõ›‹–ûU[Y\›[\ú⁄^ôKà^X›Y[Y\›[\€›[ùà[ö]ô\úŸRY[ù]Uö[€][€ê€›[ùà[ò[ZX“õ⁄[ë\Xÿ]P€›[ùà[ò[ZX“õ⁄[ìZ\‹⁄[ô–€›[ùàÿYôU‘õÿŸYY—çéàò[ŸKàçìõ››\ùYàùYKàKå
N¬àBÇà€€ú›€›\òŸR]ëöY[ô\Ÿ[òŸHH¬à]éà‘õ›‹Àôö[\ä
õ› HOàÿöôX›úõ››\Kö\”›€îõ‹\ùKòÿ[
õ›Àö]àäJKõ[ô›à[\YYõ€][]Nà‘õ›‹Àôö[\ä
õ› HOàÿöôX›úõ››\Kö\”›€îõ‹\ùKòÿ[
õ›Àö[\YYõ€][]HäJKõ[ô›à[\YY›õ€][]Nà‘õ›‹Àôö[\ä
õ› HOàÿöôX›úõ››\Kö\”›€îõ‹\ùKòÿ[
õ›Àö[\YY›õ€][]HäJKõ[ô›àN¬ÇàÀ»KKH\ôH]\õZ[ö\›X»çHùZ[
]X[]Hÿ]Hù[ú»ôYõ‹ôH]ô\ûHôX]\ôJHKKBà€€ú›çHHùZ[çR]îÿ⁄Y[òŸJY\ôŸYõ›‹À»^X›YÿY[òŸSZ[ù]\ŒàKô\]Z\ôY]SŸôúŸ]»JN¬à€€ú›€›\òŸSX[öYô\›Y»H¬à[ò[ZX’öY]—ö[RYà[ò[ZX’öY]–⁄X⁄‹›[Nà[ê⁄X⁄‹›[Kà—ö[RYà—ö[U\ŸYöYà—ö[Sò[YNà—ö[U\ŸYõò[YKà–⁄X⁄‹›[Kàçö[RYàçö[U\ŸYöYàçö[Sò[YNàçö[U\ŸYõò[YKàç⁄X⁄‹›[KàN¬à€€ú›ÿ[›[]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú››]]^[ÿYH¬àôX]\ôQò[Z[NàëçW“Uó‘–“QSê—Hãàõ‹õ][Uô\ú⁄[€éàçKôõ‹õ][Uô\ú⁄[€ãà€›\òŸSX[öYô\›YÀàÿ[›[]Y]à^X›YÿY[òŸSZ[ù]\ŒàçKô^X›YÿY[òŸSZ[ù]\Ààô\]Z\ôY]SŸôúŸ]ŒàçKúô\]Z\ôY]SŸôúŸ]Àà^X›Y€€ùòX›‘\ï[Y\›[\àçKô^X›Y€€ùòX›‘\ï[Y\›[\à]X[]T›[[X\ûNàçKú]X[]T›[[X\ûKà\ê€€ùòX›àçKú\ê€€ùòX›à‹õ‹‹‘ŸX›[€éàçKò‹õ‹‹‘ŸX›[€ãàN¬Çà€€ú›⁄X⁄‹›[T^[ÿYH»ããõ›]]^[ÿYÿ[›[]Y]à[ôYö[ôYN¬à€€ú›ù[åP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ⁄X⁄‹›[T^[ÿY
JKôYŸ\›
ö^äN¬à€€ú›ù[åê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJ⁄X⁄‹›[T^[ÿY
JKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬ÇàÀ»ì–“—Q\»[à[ù[ù[€ò[õÀ]‹ö]Hô\›[à»õ›\ú⁄\›[à[\H‹ÇàÀ»]\⁄XõK[€⁄⁄[ô»çH\ùYòX›⁄[àH€›\òŸH€€ùZ[ú»õ»ò[YUãÇà]ö[RYà›ö[ô»ù[Hù[¬à]‹ö]T›]\»HçKú›]\»OOHêì–“—Qà»ìì’–USTQ–ì–“—Q”ì◊’êSQ“Uàààìì’–USTQé¬à]ôXY›]\»HçKú›]\»OOHêì–“—Qà»ìì’–USTQ–ì–“—Q”ì◊’êSQ“Uàààìì’–USTQé¬àYà
çKú›]\»OOHêì–“—QäH¬à€€ú›ö[Sò[YHH\ö]ò]]ô\◊—çW”íQïWÃåçãLLLW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬àö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJö[Sò[YKôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àYà
[ö[RY
H¬à€€ú›\ÿYH]ÿZ]\ÿYö[U—ö]ôJö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJ›]]^[ÿY
KôX]ﬁ[Xõ€õ€\ã⁄Ÿ[äN¬àö[RYH\ÿYÀöYœ»ù[¬à‹ö]T›]\»H\ÿY»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBàYà
ö[RY
H¬à€€ú›ôXYòX⁄»H]ÿZ]ö]ôTôXYö[PûRY
ö[RY⁄Ÿ[äN¬àôXY›]\»HôXYòX⁄œÀôôX]\ôQò[Z[HOOHëçW“Uó‘–“QSê—Hà	âÇà\úò^Kö\–\úò^JôXYòX⁄Àú\ê€€ùòX›
H	âàôXYòX⁄Àú\ê€€ùòX›õ[ô›OOHçKú\ê€€ùòX›õ[ô›	âÇà\úò^Kö\–\úò^JôXYòX⁄Àò‹õ‹‹‘ŸX›[€äH	âàôXYòX⁄Àò‹õ‹‹‘ŸX›[€ãõ[ô›OOHçKò‹õ‹‹‘ŸX›[€ãõ[ô›à»îT‘»ÇààëêRSé¬àBàBÇà€€ú›õ‹òöY[ëöY[»H»ô[Hãôÿ[[XHãù]HãùôYÿHãúÿ€‹ôHãúõÿòXö[]HãòöX\»ãòÿ[ôY]Hãô[ùûHãú€ãù\ôŸ]ãùô\ôX›ãòù[\⁄ãòôX\ö\⁄óN¬à€€ú›”õ›ùZ[öY[—õ›[ôHõ‹òöY[ëöY[Àôö[\ä
öY[
HOÇàçKú\ê€€ùòX›ú€€YJ
õ›Œà[ûJHOàöY[[àõ› HçKò‹õ‹‹‘ŸX›[€ãú€€YJ
õ›Œà[ûJHOàöY[[àõ› Bà
N¬à€€ú›”õ›ùZ[⁄X⁄»H”õ›ùZ[öY[—õ›[ôõ[ô›OOH»îT‘»ààêRSà	Ÿ”õ›ùZ[öY[—õ›[ôöõ⁄[äãä_X¬à€€ú›[ôXYŸT›]\»HÿöôX›ùò[Y\ €›\òŸSX[öYô\›Y Kô]ô\ûJõ€€X[äH»îT‘»ààëêRSé¬Çà€€ú›\ú⁄\›Y⁄»H‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»é¬à]›ô\ò[›]\ŒàîT‘»àîTïPSàêì–“—QàëêRSé¬àYà
çKú›]\»OOHêì–“—QäH›ô\ò[›]\»Hêì–“—Qé¬à[ŸHYà
\\ú⁄\›Y⁄»\ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄[ôXYŸT›]\»OOHîT‘»à”õ›ùZ[⁄X⁄»OOHîT‘»äH›ô\ò[›]\»HëêRSé¬à[ŸH›ô\ò[›]\»HçKú›]\Œ¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Ààõÿ⁄Ÿ\ê€ŸNàçKòõÿ⁄Ÿ\ê€ŸKàõÿ⁄Ÿ\ë^[ò][€éàçKú›]\»OOHêì–“—QÇà»ïH›‹ôY[à\›‹öXÿ[‹[€à‹öY€€ùZ[ú»õ»‹⁄]]ôHö[ö]Hõ›öY\àUãàçH€‹úôX›H›‹Y»õ»Uàÿ\»ÿ[›[]Y[\]Yõ‹ùÿ\ôYö[Y‹àô\XŸY⁄]ô\õÀàÇààù[àôX]\ô\“[\[Y[ùYà»ö]ê⁄[ôŸHãö]ïô[ÿ⁄]T\ìZ[ù]Hãö]êXÿŸ[\ò][€î\ìZ[ù]Làãö]ë\‹\ú⁄[€àãö]îò[ôŸHóKà]X[]Qÿ]T›]\Œà»ïêSQãìRT‘“Së»ãñëTì◊–Sì”PSHãíSïêSQ”ëQ–UUëHãíSïêSQ”ì”ó”ïSQTíP»ãíSïêSQ”ì”ó—íSíUHóKà€›\òŸR]ëöY[ô\Ÿ[òŸKà]X[]T›[[X\ûNàçKú]X[]T›[[X\ûKà‹ö]T›]\ÀàôXY›]\Ààö[RYàù[åP⁄X⁄‹›[Kàù[åê⁄X⁄‹›[Kàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄à[ôXYŸT›]\Àà€›\òŸSX[öYô\›YÀà”õ›ùZ[⁄X⁄ÀàôX€€ô][€éà¬àçÿ]NàùYKàç^X›”[ôXYŸQÿ]NàùYKà—ÿ]NàùYKà[ò[ZX–]Qÿ]NàùYKà[ò[ZX“õ⁄[ë\Xÿ]P€›[ùà[ò[ZX“õ⁄[ìZ\‹⁄[ô–€›[ùàô\]Z\ôY[ö]ô\úŸTõ›–€›[ùàô\]Z\ôY[ö]ô\úŸTõ›‹Àõ[ô›à^X›Yô\]Z\ôY[ö]ô\úŸTõ›‹Àà[Y\›[\€›[ùàõ›‹–ûU[Y\›[\ú⁄^ôKà^X›Y[Y\›[\€›[ùà[ö]ô\úŸRY[ù]Uö[€][€ê€›[ùà\‹Œà[ö]ô\úŸTôX€€ô][€î\‹ÀàKà€õ›€ì[Z]][€úŒà¬àï\»\‹»€€ú›[Y\»õ›öY\àUà€õKà]Ÿ\»õ›ÿ[›[]H\›‹öXÿ[Uàúõ€H‹[€àöXŸ\ÀàãàïH]Y]Y€›\òŸH\»íQïH€àåçãLLLH€õN»êSí”íQïK—Sî—V][KY^K[ô][KY^\ûHUàÿ⁄Y[òŸH\ôH›]⁄YH\»çH€XŸKàãàê‹õ‹‹À\ŸX›[€ò[\‹\ú⁄[€à\»‹[][€à›[ô\ô]öX][€àŸàò[YUà[ú⁄YHHùYH\ã][Y\›[\Up¨L»—K‘H[ö]ô\úŸN»ò[ôŸH\»X^
ò[YUäHHZ[äò[YUäKà\ùX[›XúŸ]»\ôHXô[YTïPSô]ô\àô\Ÿ[ùY\»ù[][ö]ô\úŸH›]\›X‹Ààãàëçà\»[ù[ù[€ò[Hõ››\ùYûH\»õ›]KàãàKàÿYôU‘õÿŸYY—çéà›ô\ò[›]\»OOHîT‘»ãàçìõ››\ùYàùYKàåï[ù›X⁄Y⁄X⁄ŒàùYKàåï—ç[ù›X⁄Y⁄X⁄ŒàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä¬àããúô\‹ùà›]\ŒàëêRSãà\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àçHUàÿ⁄Y[òŸHùZ[òZ[\ôHãàÿYôU‘õÿŸYY—çéàò[ŸKàçìõ››\ùYàùYKàKL
N¬àBüJN¬ÇÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»å——QTP–UW”‘S”ó—‘íQ8†%€ôK[Ÿôàô\Z\àõ‹àH\Xÿ][€àùY»[àBãÀ»€›ô\òYŸK\ô\Z\à[ô⁄[ùXõ›ôNàôK\ù[õö[ô»][ô⁄[ùôX]Y]»›€ÇãÀ»ö[‹à›]]\»ô^\›[ô»à[ôôKX\[ôYHÿ[YHà€€ùòX›ÀõŸX⁄[ô¬ãÀ»çÃÃàõ›‹»
N€€ùòX› H[ú›XYŸàH€‹úôX›NN
Mà€€ùòX› KÇãÀ»\»[ô⁄[ùôXY»H’TîëSï
\Xÿ]Y
H‹öYY\Xÿ]\»ûBãÀ»
[Y\›[\›öZŸK‹[€ï\JHŸY\[ô»€ôHÿ[õ€öXÿ[õ›»\àŸ^K‹ö]\¬ãÀ»H€X[àö[KôYŸ[ô\ò]\»H[ò[ZX»UHöY]»úõ€HH€X[à]K[ôãÀ»ô\öYöY\»H€‹úôX›Y€›[ù»ôYõ‹ôH[û][ô»[ŸH\»[›ŸY»ùZ[€ÇãÀ»‹Ÿà\»]\Ÿ]ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBò\ôŸ]
ãÿ\Kÿ]Y]›åŸYY\Xÿ]K[‹[€ãY‹öY\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBà€€ú›Ÿ[ô\ò]Y]Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ô\‹ùàôX€‹ô›ö[ôÀ[ûOàH»\ò⁄]X›\ôTõ€Nàïå——QTP–UW”‘S”ó—‘íQãŸ[ô\ò]Y]ﬁ[Xõ€àìíQïHãòY[ô—]NàååçãLLLHàN¬Çà€€ú›⁄Ÿ[àH]ÿZ]Ÿ]ò[Yö]ôPXÿŸ\‹’⁄Ÿ[ä
N¬àYà
]⁄Ÿ[äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàë€€Ÿ€Hö]ôH\»õ›€€õôX›YààKå
N¬ÇàûH¬à€€ú››öZŸT›\HL¬à€€ú›úòZ[îõ€›H]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äì‹[€î[›–úòZ[àãù[⁄Ÿ[äN¬à€€ú››‹ôTõ€›HúòZ[îõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äïå◊“\›‹öXÿ[‘›‹ôHãúòZ[îõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õQõ€\àH›‹ôTõ€›»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äå◊€õ‹õX[^ôYã›‹ôTõ€›⁄Ÿ[äHàù[¬à€€ú›õ‹õS‹õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ–UW‘L»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬à€€ú›[ò[ZX’öY]—õ€\àHõ‹õQõ€\à»]ÿZ]ö[ô‹ê‹ôX]Qö]ôQõ€\äìíQïW”‘S”ó—‘íQ—SêSRP◊–UW’íQU»ãõ‹õQõ€\ã⁄Ÿ[äHàù[¬àYà
[õ‹õS‹õ€\àY[ò[ZX’öY]—õ€\äHô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàëõ€\à€⁄›\òZ[YààKå
N¬ÇàÀ»KKHö[ôH\ôŸ\›
[‹›ôXŸ[ù[‹›õ›‹ H^\›[ô»‹öYö[HKHH\Xÿ]Y€ôHKKBà€€ú›ö[\»H]ÿZ]ö]ôS\›ö[\“[ëõ€\äõ‹õS‹õ€\ã⁄Ÿ[äN¬à€€ú›ÿ[ôY]\»Hö[\Àôö[\ä
äHOàãõò[YKú›\ù’⁄]
õ‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW»äJN¬àYà
ÿ[ôY]\Àõ[ô›OOH
Hô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»‹öYö[\»õ›[ôààKå
N¬Çà]\ôŸ\›à»Yà›ö[ôŒ»ò[YNà›ö[ôŒ»õ›‹Œà[ûV◊HHù[Hù[¬à€€ú›[ÿ[ôY]P€›[ùŒà\úò^O»ò[YNà›ö[ôŒ»õ›–€›[ùàù[Xô\àOàH◊N¬àõ‹à
€€ú›àŸàÿ[ôY]\ H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
ãöY⁄Ÿ[äN¬à€€ú›õ›–€›[ùH\úò^Kö\–\úò^JòäH»òãõ[ô›à¬à[ÿ[ôY]P€›[ùÀú\⁄
»ò[YNàãõò[YKõ›–€›[ùJN¬àYà
\úò^Kö\–\úò^JòäH	âà
[\ôŸ\›òãõ[ô›à\ôŸ\›úõ›‹Àõ[ô›
JH\ôŸ\›H»YàãöYò[YNàãõò[YKõ›‹ŒàòàN¬àBàYà
[\ôŸ\›
Hô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éàìõ»ôXYXõH‹öYö[Hõ›[ôàã[ÿ[ôY]P€›[ù»Kå
N¬Çà€€ú›ôYõ‹ôTõ›–€›[ùH\ôŸ\›úõ›‹Àõ[ô›¬ÇàÀ»KKHY\Xÿ]Nà€ôHÿ[õ€öXÿ[õ›»\à
[Y\›[\›öZŸK‹[€ï\JHKKBà€€ú›ŸY[àHô]»X\›ö[ôÀ[ûOä
N¬à]\Xÿ]\‘ô[[›ôYH¬àõ‹à
€€ú›õ›»Ÿà\ôŸ\›úõ›‹ H¬à€€ú›Ÿ^HH	‹õ›Àù[Y\›[\_	‹õ›Àú›öZŸ__	‹õ›Àõ‹[€ï\_X¬àYà
ŸY[ãö\ Ÿ^JJH»\Xÿ]\‘ô[[›ôY
 Œ»€€ù[ùYN»HÀ»ŸY\ö\ú›ÿÿ›\úô[òŸKõ‹Hô\›àŸY[ãúŸ]
Ÿ^Kõ› N¬àBà€€ú›€X[îõ›‹»HÀããúŸY[ãùò[Y\ 
WN¬à€€ú›€X[î›öZŸ\»HÀããõô]»Ÿ]
€X[îõ›‹ÀõX\

äHOàãú›öZŸJJWKú€‹ù

KäHOàHHäN¬à€€ú›€X[ï[Y\›[\»HÀããõô]»Ÿ]
€X[îõ›‹ÀõX\

äHOàãù[Y\›[\
JWKú€‹ù

N¬ÇàÀ»KKH‹ö]HH”PSà‹öY\»Hô]»ö[H
ô]»⁄X⁄‹›[JHKKBà€€ú›€X[î›àHî””ãú›ö[ô⁄YûJ€X[îõ›‹ N¬à€€ú›€X[ê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]J€X[î›äKôYŸ\›
ö^äN¬à€€ú›€X[ëö[Sò[YHH‹[€óŸ‹öY–UW‘L◊”íQïWÃåçãLLLW…ÿ€X[ê⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à]€X[ëö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJ€X[ëö[Sò[YKõ‹õS‹õ€\ã⁄Ÿ[äN¬à]‹ö]T›]\»Hìì’–USTQé¬àYà
X€X[ëö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJ€X[ëö[Sò[YKò\Xÿ][€ã⁄ú€€àã€X[î›ãõ‹õS‹õ€\ã⁄Ÿ[äN¬à€X[ëö[RYH\ÀöYœ»ù[¬à‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà]ôXY›]\»Hìì’–USTQé¬à]ôXYòX⁄‘õ›–€›[ùH¬àYà
€X[ëö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
€X[ëö[RY⁄Ÿ[äN¬àôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JòäH»òãõ[ô›à¬àôXY›]\»HôXYòX⁄‘õ›–€›[ùOOH€X[îõ›‹Àõ[ô›»îT‘»ààëêRSé¬àBÇàÀ»KKHôYŸ[ô\ò]HH[ò[ZX»UHöY]»úõ€HH”PSà]Kù[à⁄XŸHõ‹àô\õŸX⁄Xö[]HKKBàù[ò›[€àò[úŸõ‹õJõ›‹Œà[ûV◊JH¬àô]\õàõ›‹ÀõX\

äHOà¬à€€ú›‹›àù[Xô\àù[Hãú‹›¬à€€ú››öZŸNàù[Xô\àHãú›öZŸN¬à€€ú›[ò[ZX–]T›öZŸHH‹›OOHù[»ôX\ô\›]T›öZŸJ‹››öZŸT›\
Hàù[¬à€€ú›[ò[ZX–]SŸôúŸ]H[ò[ZX–]T›öZŸHOOHù[»X]úõ›[ô

›öZŸHH[ò[ZX–]T›öZŸJH»›öZŸT›\
Hàù[¬à][ò[ZX”[€ô^[ô\‹Œà›ö[ô»ù[Hù[¬àYà
[ò[ZX–]SŸôúŸ]OOHù[
H¬àYà
[ò[ZX–]SŸôúŸ]OOH
H[ò[ZX”[€ô^[ô\‹»HêUHé¬à[ŸHYà
ãõ‹[€ï\HOOHê—HäH[ò[ZX”[€ô^[ô\‹»H›öZŸH
[ò[ZX–]T›öZŸH\»ù[Xô\äH»íUHààì’Hé¬à[ŸHYà
ãõ‹[€ï\HOOHîHäH[ò[ZX”[€ô^[ô\‹»H›öZŸHà
[ò[ZX–]T›öZŸH\»ù[Xô\äH»íUHààì’Hé¬àBàô]\õà»[Y\›[\àãù[Y\›[\‹››öZŸK‹[€ï\Nàãõ‹[€ï\KŸ\‹⁄[€ê[ò⁄‹ê]Nàãò]T›öZŸKŸ\‹⁄[€ê[ò⁄‹ìŸôúŸ]àãò]SŸôúŸ][ò[ZX–]T›öZŸK[ò[ZX–]SŸôúŸ][ò[ZX”[€ô^[ô\‹À]X[]Nà‹›OOHù[»ïêSQààïSêUêRSPìHàN¬àJN¬àBà€€ú›ù[åHHò[úŸõ‹õJ€X[îõ›‹ N¬à€€ú›ù[åàHò[úŸõ‹õJ€X[îõ›‹ N¬à€€ú›ù[åP⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åJJKôYŸ\›
ö^äN¬à€€ú›ù[åê⁄X⁄‹›[HH‹ôX]R\⁄
ú⁄LçMàäKù\]Jî””ãú›ö[ô⁄YûJù[åäJKôYŸ\›
ö^äN¬à€€ú›ô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄Hù[åP⁄X⁄‹›[HOOHù[åê⁄X⁄‹›[N¬Çà€€ú›[ëö[Sò[YHH[ò[ZX◊ÿ]W›öY]◊”íQïWÃåçãLLLW…‹ù[åP⁄X⁄‹›[Kú€XŸJMä_Köú€€ò¬à][ëö[RYH]ÿZ]ö]ôQö[ôö[PûSò[YJ[ëö[Sò[YK[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬à][ï‹ö]T›]\»Hìì’–USTQé¬àYà
Y[ëö[RY
H¬à€€ú›\H]ÿZ]\ÿYö[U—ö]ôJ[ëö[Sò[YKò\Xÿ][€ã⁄ú€€àãî””ãú›ö[ô⁄YûJù[åJK[ò[ZX’öY]—õ€\ã⁄Ÿ[äN¬à[ëö[RYH\ÀöYœ»ù[¬à[ï‹ö]T›]\»H\»îT‘»ààëêRSé¬àH[ŸH¬à[ï‹ö]T›]\»HîT‘◊–SëPQW—VT’Qé¬àBà][îôXY›]\»Hìì’–USTQé¬à][îôXYòX⁄‘õ›–€›[ùH¬àYà
[ëö[RY
H¬à€€ú›òàH]ÿZ]ö]ôTôXYö[PûRY
[ëö[RY⁄Ÿ[äN¬à[îôXYòX⁄‘õ›–€›[ùH\úò^Kö\–\úò^JòäH»òãõ[ô›à¬à[îôXY›]\»H[îôXYòX⁄‘õ›–€›[ùOOHù[åKõ[ô›»îT‘»ààëêRSé¬àBÇàÀ»KKH€›ô\òYŸHY]öX‹»€àH”PSà]HKKBà€€ú›[ê]PûU»Hô]»X\›ö[ôÀù[Xô\àù[ä
N¬àõ‹à
€€ú›àŸàù[åJHYà
Y[ê]PûUÀö\ ãù[Y\›[\
JH[ê]PûUÀúŸ]
ãù[Y\›[\ãô[ò[ZX–]T›öZŸJN¬à]ù[P€›ô\ôYH¬àõ‹à
€€ú›»Ÿà€X[ï[Y\›[\ H¬à€€ú›]HH[ê]PûUÀôŸ]
 N¬àYà
]HOOHù[]HOOH[ôYö[ôY
H€€ù[ùYN¬à€€ú›ô\]Z\ôYHÀLÀLãLKKã◊KõX\

 HOà]H
»»
à›öZŸT›\
N¬àYà
ô\]Z\ôYô]ô\ûJ
 HOà€X[î›öZŸ\Àö[ò€Y\  JJHù[P€›ô\ôY
 Œ¬àBÇà€€ú›^X›Yõ›–€›[ùH€X[ï[Y\›[\Àõ[ô›
à€X[î›öZŸ\Àõ[ô›
àé»À»[Y\›[\»›öZŸ\»
—J‘JBà€€ú››ô\ò[›]\»Bà‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âàôXY›]\»OOHîT‘»à	âà[ï‹ö]T›]\Àú›\ù’⁄]
îT‘»äH	âà[îôXY›]\»OOHîT‘»à	âÇàô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄	âà€X[îõ›‹Àõ[ô›OOH^X›Yõ›–€›[ù	âàù[P€›ô\ôYOOH€X[ï[Y\›[\Àõ[ô›à»îT‘»ààîTïPSé¬Çàô]\õàÀöú€€ä¬àããúô\‹ùà›]\Œà›ô\ò[›]\Àà€›\òŸQö[U\ŸYà»Yà\ôŸ\›öYò[YNà\ôŸ\›õò[YHKà[ÿ[ôY]P€›[ùÀàôYõ‹ôTõ›–€›[ùà\Xÿ]\‘ô[[›ôYàYù\îõ›–€›[ùà€X[îõ›‹Àõ[ô›à^X›Yõ›–€›[ùà€X[î›öZŸ\Àà[Y\›[\€›[ùà€X[ï[Y\›[\Àõ[ô›àù[P€›ô\ôY]T\”Z[ù\Ã’[Y\›[\€›[ùàù[P€›ô\ôYà€X[ì—ö[RYà€X[ëö[RYà‹ö]T›]\ÀôXY›]\ÀôXYòX⁄‘õ›–€›[ùà€X[ë[ò[ZX’öY]—ö[RYà[ëö[RYà[ï‹ö]T›]\À[îôXY›]\À[îôXYòX⁄‘õ›–€›[ùàù[åP⁄X⁄‹›[Kù[åê⁄X⁄‹›[Kô\õŸX⁄Xö[]P⁄X⁄‹›[SX]⁄àåï[ù›X⁄Y⁄X⁄ŒàùYK‹ô\êXÿŸ\‹’\ŸYàò[ŸK⁄Ÿ[ë^‹ŸYàò[ŸKàKå
N¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»ããúô\‹ù›]\ŒàëêRSã\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€àY\òZ[\ôHàKL
N¬àBüJN¬ÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»êQHPà8†%ôXY[€õHYŸ‹ôYÿ]‹à
\ŸHãåçãLLLäBãÀ»€€Xö[ô\»VT’Së»›]]»€õNàLL
ôY⁄[YJKLLH
]öY[òŸHù\⁄[€äKãÀ»LLà
ÿ[ôY]HŸ]
HöXH\ôX›ù[ò›[€àô]\ŸK[ô[àõ‹õX[^ôYãÀ»‹ôYZ‹»öXH[à[ù\õò[Ÿ[ãYô]⁄»H^\›[ô»ÿ\KŸ[ã€õ‹õX[^ôYãÀ»õ›]H
ô\õ»⁄[ôŸ\»»]õ›]JKàŸ\»ì’‹ôX]H[ûHô]»ÿ€‹ö[ôÀãÀ»Ÿ\»ì’ÿ[[ûHô]»[à[ô⁄[ùŸ\»ì’›X⁄õŸX›[€àô\ôX›ÇãÀ»‹ôYZ»[ô⁄[ôH»[ùûH]X[]H^Y\ú»\ôH[ù[ù[€ò[Hì’⁄\ôYY]8†%ãÀ»\»›\€õHõ›ô\»HôXY[€õH]H[Xö[ô»[ô]ÀY[ôÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»‘ëQR»Së“SëH8†%\ôH€€ùòX›\›Z]Xö[]H€€\\ò]‹à
\ŸHÀåçãLLLäBãÀ»[ú]àH[àõ‹õX[^ôYY»]H[ôXYHô]⁄YûHÿ\K›òY[XãÇãÀ»›]]à⁄YKXûK\⁄YHUH—H»KRUH—H»UHH»KRUHH€€\\ö\€€à€ÇãÀ»[K—ÿ[[XK’]K’ôYÿK“Uã‹‹ôXY€\]ZY]KàŸ\»ì’X⁄YHù[\⁄¬ãÀ»ôX\ö\⁄\ôX›[€à[ôŸ\»ì’‹ôX]HHõÿòXö[]K‹ÿ€‹ôH8†%\ôX›[€ÇãÀ»€€Y\»€õHúõ€HLL”LLK”LLà[àH\ô[ùÿ\K›òY[Xàô\‹€úŸKÇãÀ»õ»ô]»[àÿ[Àõ»]]][€àŸà[ûH^\›[ô»[Ÿ[KÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»êQSPàSãS”ìHRQ‘êUS”à8†%Lã”LÀ”N”NH
åçãLLLã\ŸHJBãÀ»€ÿ[àòYSXâ‹»Uà⁄Ÿ]»
LäKUà\õH›ùX›\ôH
L Kõ€›ô\àZY‹ò][€ÇãÀ»
N
K[ô][KQ^\ûH[Y€õY[ù
NJH]\›ôHSà”ìH8†%õ»⁄]HôXYãÀ»õ»⁄]Hò[òX⁄Àà\»õÿ⁄»\»[ù\ô[HëUÀÿY]]ôNÇãÀ»HŸ\»ì’[ŸYûHùZ[åí]î⁄Ÿ]“\›‹ûKùZ[åí]ï\õT›ùX›\ôKãÀ»ùZ[åîõ€›ô\ìZY‹ò][€ãùZ[åì][Q^\ûP[Y€õY[ù‹à[ûHŸÇãÀ»LK”M”MK”Mã”MÀ”LL”LLK”LLà8†%‹ŸHŸY\Ÿ\ùö[ô»H^\›[ô¬ãÀ»⁄]KXò\ŸYëTëP’Xà[ôXY€õ‹›X»[ô⁄[ù»[ò⁄[ôŸYÇãÀ»Hô]\Ÿ\»åï\õTõ›Àåê€\‹⁄YûU\õT›ùX›\ôKåì][Q^\ûTõ›ÀãÀ»åê€\‹⁄YûS][Q^\ûS⁄Kåê€\‹⁄YûS][Q^\ûR]ã[ôãÀ»åîõ€›ô\ë^\ûT›[[X\ûHSê“Së—Q8†%€õHHSîU\»[ã\⁄\YãÀ»[ú›XYŸà⁄]K\⁄\YöXHH⁄[Hô[›Àà[ù\úô]][€àù[\¬ãÀ»
H€\‹⁄YöXÿ][€àù[ò›[€ú»[\Ÿ[ô\ H\ôH[ù›X⁄YÇãÀ»Hô]\Ÿ\»H^\›[ô»ÿ\KŸ[ã€õ‹õX[^ôY

Hõ›]HöXH[ù\õò[ãÀ»Ÿ[ãYô]⁄õ‹àõ››\úô[ùSëô^^\ûH
[ôXYH›\‹ù»[ÇãÀ»Ÿ^\ûOH›ô\úöYJK€»õ»ô]»‹[€ãX⁄Z[à\ú⁄[ô»€ŸH\»‹ö][ÇãÀ»[ôH^X›ÿ[YH]î›\‹X›Ÿ‹ôYZ‹‘›\‹X›òZ[X€‹ŸYŸ⁄X»\Y\ÀÇãÀ»Hô]\Ÿ\»H^X›ÿ[YHSó”UëW––P“HŸ^Hÿ⁄[YBãÀ»
^\û[\›…‹ﬁ[Xõ€X‹[€ò⁄Z[ó…‹ﬁ[Xõ€W…Ÿ^\û_X
H[ôXYBãÀ»\ŸYûHKQK”LK€»H’TîëSï^\ûHô]⁄\»ô\ûHZŸ[H[ôXYBãÀ»ÿ\õHúõ€HLI‹»›€àÀ[Z[ù]HòX⁄Ÿ‹õ›[ôõÿà8†%€õHHëV^\ûH\¬ãÀ»HŸ[ùZ[ô[Hô]»ô]⁄\àﬁX€KÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇò\ﬁ[ò»ù[ò›[€àòYSXë[ëŸ]^\ûS\›
ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäNàõ€Z\ŸO›ö[ô÷◊Hù[à¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
Hô]\õàù[¬à€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô Hô]\õàù[¬à€€ú›^\ûPÿX⁄RŸ^HH^\û[\›…‹ﬁ[Xõ€X¬à€€ú›ÿX⁄YHSó”UëW––P“KôŸ]
^\ûPÿX⁄RŸ^JN¬àYà
ÿX⁄Y	âà]Kõõ› 
HHÿX⁄Yôô]⁄Y]H
àå
àL
Hô]\õàÿX⁄Yú^[ÿY¬à€€ú›XY\ú»H»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYN¬àûH¬à€€ú›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åã€‹[€ò⁄Z[ãŸ^\û[\›ã¬àY]Ÿàî‘’ãXY\úÀàõŸNàî””ãú›ö[ô⁄YûJ»[ô\õZ[ô‘ÿ‹ö\àX\[ôÀù[ô\õZ[ô‘ÿ‹ö\[ô\õZ[ô‘ŸYŒàX\[ôÀù[ô\õZ[ô‘ŸY»JKàJN¬à€€ú›ò]»H]ÿZ]ô\Àù^

N¬à]\úŸYà[ûHHù[¬àûH»\úŸYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»\úŸYHù[»BàYà
\ô\Àõ⁄»\\úŸYP\úò^Kö\–\úò^J\úŸYô]JH\úŸYô]Kõ[ô›OOH
Hô]\õàù[¬àSó”UëW––P“KúŸ]
^\ûPÿX⁄RŸ^K»ô]⁄Y]à]Kõõ› 
K^[ÿYà\úŸYô]HJN¬àô]\õà\úŸYô]N¬àHÿ]⁄
\úäH¬à€€ú€€Kô\úõ‹ä’êQSPó—SóH^\û[\›ô]⁄òZ[Yõ‹à	‹ﬁ[Xõ€Nò\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà\úäN¬àô]\õàù[¬àBüBÇò\ﬁ[ò»ù[ò›[€àòYSXë[ëô]⁄õ‹õX[^ôYõ‹ë^\ûJﬁ[Xõ€à›ö[ôÀ^\ûNà›ö[ôÀ‹ùà›ö[ô Nàõ€Z\ŸO[ûOà¬àûH¬à€€ú›ô\»H]ÿZ]ô]⁄
ãÀ€ÿÿ[‹›â‹‹ùKÿ\KŸ[ã€õ‹õX[^ôY‹ﬁ[Xõ€I‹ﬁ[Xõ€Iô^\ûOIŸ[ò€ŸUTíP€€\€ô[ù
^\ûJ_X
N¬àô]\õà]ÿZ]ô\Àöú€€ä
N¬àHÿ]⁄
\úäH¬àô]\õà»›]\ŒàëëU“—êRSQã\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹ààN¬àBüBÇö[ù\ôòXŸHòYSXë[ì][Q^\ûT€ò\⁄›¬à›]\Œàì“»àìì’–””ëíQ’TëQàìì’÷QU”PTQàëêRSé¬àõ›ô[ò[òŸNàëSàé¬àﬁ[Xõ€à›ö[ôŒ¬àŸ[ô\ò]Y]à›ö[ôŒ¬à]òZ[XõQ^\ûP€›[ùàù[Xô\é¬à›\úô[ùà[ûHù[»À»ô\‹€úŸHõ‹à^\öY\÷ÃBàô^à[ûHù[»À»ô\‹€úŸHõ‹à^\öY\÷ÃWKYà]^\›¬üBÇò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ì][Q^\ûT€ò\⁄›
ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Vã‹ùà›ö[ô Nàõ€Z\ŸOòYSXë[ì][Q^\ûT€ò\⁄›à¬à€€ú›[ê€€ôöY›\ôYH\—[ê€€ôöY›\ôY

N¬àYà
Y[ê€€ôöY›\ôY
H¬àô]\õà»›]\Œàìì’–””ëíQ’TëQãõ›ô[ò[òŸNàëSàãﬁ[Xõ€Ÿ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K]òZ[XõQ^\ûP€›[ùà›\úô[ùàù[ô^àù[N¬àBà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô H¬àô]\õà»›]\Œàìì’÷QU”PTQãõ›ô[ò[òŸNàëSàãﬁ[Xõ€Ÿ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K]òZ[XõQ^\ûP€›[ùà›\úô[ùàù[ô^àù[N¬àBà€€ú›^\öY\»H]ÿZ]òYSXë[ëŸ]^\ûS\›
ﬁ[Xõ€
N¬àYà
Y^\öY\»^\öY\Àõ[ô›OOH
H¬àô]\õà»›]\ŒàëêRSãõ›ô[ò[òŸNàëSàãﬁ[Xõ€Ÿ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K]òZ[XõQ^\ûP€›[ùà›\úô[ùàù[ô^àù[N¬àBà€€ú››\úô[ù^\ûHH^\öY\÷ÃN¬à€€ú›ô^^\ûHH^\öY\Àõ[ô›àH»^\öY\÷ÃWHàù[¬à€€ú››\úô[ùH]ÿZ]òYSXë[ëô]⁄õ‹õX[^ôYõ‹ë^\ûJﬁ[Xõ€›\úô[ù^\ûK‹ù
N¬à€€ú›ô^Hô^^\ûH»]ÿZ]òYSXë[ëô]⁄õ‹õX[^ôYõ‹ë^\ûJﬁ[Xõ€ô^^\ûK‹ù
Hàù[¬àô]\õà¬à›]\Œàì“»ãàõ›ô[ò[òŸNàëSàãàﬁ[Xõ€àŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà]òZ[XõQ^\ûP€›[ùà^\öY\Àõ[ô›à›\úô[ùà›\úô[ù	âà›\úô[ùú›]\»OOHîT‘»à»›\úô[ùàù[àô^àô^	âàô^ú›]\»OOHîT‘»à»ô^àù[àN¬üBÇãÀ»⁄[Nà€€ùô\ù»€ôH
ÿ\KŸ[ã€õ‹õX[^ôY
Hô\‹€úŸH[ù»HVP’ãÀ»^\ûQ]K‘ô[Z][Q]H⁄\H]åï\õTõ›À›åì][Q^\ûTõ›À¬ãÀ»åîõ€›ô\ë^\ûT›[[X\ûH[ôXYH^X›8†%ÿ[YHX⁄ö\]YHLI‹¬ãÀ»[ï“[ô^Y]öX‹‘⁄[H[ôXYH\Ÿ\Àà][›U[Y\›[\\»Ÿ]»HãÀ»òX⁄Ÿ[ô\ôXŸZ\[YH
Ÿ[ô\ò]Y]
Kì’Yù\»ïSêUêRSPìW—îì”W‘ì’íQTàããÀ»ôXÿ]\ŸHHô]\ŸYúô\⁄ô\‹»⁄X⁄»
€\‹⁄YûUù]öY[
HôYY»HôX[ãÀ»[Y\›[\»]ò[X]H8†%\»Z\úõ‹ú»LI‹»[ôXYKX\õ›ôYôXŸY[ùŸÇãÀ»\⁄[ô»[à€ô\›òX⁄Ÿ[ô\ôXŸZ\õﬁH⁄[à[à\»õ»Ÿ[ùZ[ôH\ã\][›BãÀ»^⁄[ôŸH[Y\›[\
ŸYH[ï“[ô^Y]öX‹‘⁄[I‹»^⁄[ôŸU[Y\›[\€€[Y[ù
KÇãÀ»›\‹X›Uã—‹ôYZ‹»
]î›\‹X›Ÿ‹ôYZ‹‘›\‹X›[ôXYH€€\]YûH
H\ôBãÀ»\‹ŸYõ›Y⁄\»ù[8†%ëUëTà›Xú›]]Y⁄]8†%€»›€ú›ôX[BãÀ»]T]X[]HŸ⁄X»[àHô]\ŸY€\‹⁄YöY\ú»€‹úôX›HôX]»[H\¬ãÀ»SêUêRSPìK^X›H\»][ôXYHŸ\»õ‹àŸ[ùZ[ô[HZ\‹⁄[ô»⁄]H]KÇãÀ»OOOOHLLà›Xã\›\à
åçãLLL H8†%[à€€ùòX›Y[ù]HY]Y]HOOOOBãÀ»›]X»\ã\ﬁ[Xõ€›\⁄^ôKŸ^⁄[ôŸK‹ŸY€Y[ù€€ôö\õYYTëP’Húõ€BãÀ»[â‹»›€àÿ‹ö\[X\›\à‘’àöXHÿ\Kÿ]Y]Ÿ[ãZ[ú›ù[Y[ù[X\›\à
ÿ[YBãÀ»[ô⁄[ùŸ]öY[òŸH›[ô\ô[ôXYH\ŸY»€€ôö\õH—Sî—V’íVŸX›\ö]RY BãÀ»8†%õ››Y\‹ŸYõ›ÿ\úöYY›ô\àúõ€H⁄]Kà€€ôö\õYYåçãLLLŒÇãÀ»íQïNà—SW”’’SíUœMçKå—SW—VW—V““QSî—BãÀ»êSí”íQïNà—SW”’’SíUœLÃå—SW—VW—V““QSî—BãÀ»—Sî—Và—SW”’’SíUœLåå—SW—VW—V““QPî—BãÀ»ŸY€Y[ù\Ÿ\»[â‹»›€à^⁄[ôŸK\ŸY€Y[ùò[Z[ô»
î—W—ììÀ–î—W—ìì Kõ›BãÀ»⁄]KXõ‹úõ›ŸYXô[à”ëT’Hì’Nà›⁄^ô\»\ôH^⁄[ôŸK\Ÿ][ôÿ[àôBãÀ»ô]ö\ŸY\ö[ŸXÿ[H
—PíHŸ\»\»ÿÿÿ\⁄[€ò[JH8†%\»›]X»XõH\¬ãÀ»H€ò\⁄›\»ŸàH€€ôö\õX][€à]HXõ›ôKõ›H]ôHZ[H⁄X⁄ÀàBãÀ»ù]\ôHôYö[ô[Y[ù€›[ôK]ô\öYûH]\ö[ŸXÿ[HöXHHÿ[YH]Y]ãÀ»[ô⁄[ù»õ›€ôH\ôH»ŸY\\»›Xã\›\ÿ€‹YÇò€€ú›Só–””ïêP’”QUQUNàôX€‹ôìíQïHàêêSí”íQïHàî—Sî—Vã»›⁄^ôNàù[Xô\é»^⁄[ôŸNà›ö[ôŒ»ŸY€Y[ùà›ö[ô»OàH¬àíQïNà»›⁄^ôNàçK^⁄[ôŸNàìî—HãŸY€Y[ùàìî—W—ìì»àKàêSí”íQïNà»›⁄^ôNàÃ^⁄[ôŸNàìî—HãŸY€Y[ùàìî—W—ìì»àKà—Sî—Và»›⁄^ôNàå^⁄[ôŸNàêî—HãŸY€Y[ùàêî—W—ìì»àKüN¬Çôù[ò›[€àòYSXë[ìõ‹õX[^ôY—^\ûQ]Jô\›[à[ûJNà^\ûQ]Hù[¬àYà
Yô\›[ô\›[ú›]\»OOHîT‘»àP\úò^Kö\–\úò^Jô\›[õõ‹õX[^ôY
JHô]\õàù[¬à€€ú›]T›öZŸHHô\›[ò]T›öZŸN¬à€€ú›ôXŸZ\[Y\›[\Hô\›[ôŸ[ô\ò]Y]ô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›Y]HHSó–””ïêP’”QUQUVŸô\›[úﬁ[Xõ€\»ìíQïHàêêSí”íQïHàî—Sî—VóHù[¬à€€ú›‘H
YŒà[ûJNàô[Z][Q]HOÇà
¬à›öZŸNàYÀú›öZŸKà\–]NàYÀú›öZŸHOOH]T›öZŸKàÀ»[â‹»›€à€€ùòX›ŸX›\ö]HQ\ŸY\»HY[ù]H⁄Ÿ[à8†%\¬àÀ»T»[â‹»ôX[\ãX€€ùòX›Y[ùYöY\à
ÿ[YHöY[[ôXYBàÀ»ÿ‹ö\[X\›\ãX€€ôö\õYY[Ÿ]⁄\ôJKõ›HòXúöXÿ]Y›[ôZ[àõ‹ÇàÀ»⁄]I‹»[ú›ù[Y[ù⁄Ÿ[ãÇà[ú›ù[Y[ù⁄Ÿ[éà\[ŸàYÀúŸX›\ö]RYOOHõù[Xô\àà»YÀúŸX›\ö]RYàù[à^⁄[ôŸU⁄Ÿ[éàù[à^\ûQ]Nàô\›[ô^\ûKàÀ»ö^YåçãLLL»
›Xã\›\äNàÿ\»\ô€ŸY»ïòYSXó—[àãàÀ»⁄X⁄€›[ô]ô\à\]X[›\úô[ù^\ûKô^\ûH[ô€›[[ÿ^\»òZ[àÀ»â‹»^\ûPùX⁄Ÿ]X]⁄⁄X⁄Ààõ›»Ÿ]»HX›X[^\ûH›ö[ôÀàÀ»X]⁄[ô»HöY[	‹»ôX[€€\\ö\€€à\ôŸ]Çà^\ûPùX⁄Ÿ]àô\›[ô^\ûKà‹[€ï\NàYÀõ‹[€ï\Kà›⁄^ôNàY]H»Y]Kõ›⁄^ôHà
\[ŸàYÀõ›⁄^ôHOOHõù[Xô\àà»YÀõ›⁄^ôHàù[
KàX⁄‘⁄^ôNàYÀùX⁄‘⁄^ôKà^⁄[ôŸNàY]H»Y]Kô^⁄[ôŸHàù[àŸY€Y[ùàY]H»Y]KúŸY€Y[ùà
YÀô^⁄[ôŸTŸY€Y[ùù[
Kà€€ùòX›ôY⁄[YNàëSó”‘S”ê“RSó—TíUëQãàòY[ô‘ﬁ[Xõ€àYÀùòY[ô‘ﬁ[Xõ€àöYàYÀòöYà\⁄ŒàYÀò\⁄Àà\›öXŸNàYÀõ\›öXŸKà⁄[ôŸNàYÀò⁄[ôŸKà]éàYÀö]î›\‹X›»ù[àYÀö]ãà⁄NàYÀõ⁄Kàõ€[YNàYÀùõ€[YKàùÿ\àù[àùÿ\€›\òŸNàïï–TSêUêRSPìHãà][›U[Y\›[\àôXŸZ\[Y\›[\À»€ô\›òX⁄Ÿ[ô\ôXŸZ\õﬁH8†%ÿ[YH]\õàLH[ôXYH\Ÿ\»õ‹à‹›à]^RY⁄àò[ŸKà]^S›Œàò[ŸKà^RY⁄àYÀô^RY⁄à^S›ŒàYÀô^S›ÀàŒàù[ààYÀúààYÀúàôYÿNàYÀô‹ôYZ‹‘›\‹X›»ù[àYÀùôYÿKà]NàYÀô‹ôYZ‹‘›\‹X›»ù[àYÀù]Kà[NàYÀô‹ôYZ‹‘›\‹X›»ù[àYÀô[KàH\»[ö€õ›€à\»ô[Z][Q]JN¬Çà€€ú›ŸT›öZŸ\»Hô\›[õõ‹õX[^ôYôö[\ä
éà[ûJHOàãòŸJKõX\

éà[ûJHOà‘
ãòŸJJKú€‹ù

Nà[ûKéà[ûJHOàKú›öZŸHHãú›öZŸJN¬à€€ú›T›öZŸ\»Hô\›[õõ‹õX[^ôYôö[\ä
éà[ûJHOàãúJKõX\

éà[ûJHOà‘
ãúJJKú€‹ù

Nà[ûKéà[ûJHOàKú›öZŸHHãú›öZŸJN¬àô]\õà»^\ûNàô\›[ô^\ûK^\ûQ]Nàô]»]Jô\›[ô^\ûJKŸT›öZŸ\ÀT›öZŸ\»N¬üBÇãÀ»OOOOHL»
[äH8†%Uà\õH›ùX›\ôHOOOOBò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìL ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Vã‹ùà›ö[ô H¬à€€ú›ù[ôHH]ÿZ]ùZ[òYSXë[ì][Q^\ûT€ò\⁄›
ﬁ[Xõ€‹ù
N¬àYà
ù[ôKú›]\»OOHì“»äH¬àô]\õà»[Ÿ[NàìL◊“Uó’TìW‘’ïP’TëHãõ›ô[ò[òŸNàëSàã›]\Œàù[ôKú›]\À]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]K›]NàíSî’QëíP“QSï—UHà\»åï\õT›ùX›\ôT›]Kõ›‹Œà◊H\»åï\õT›ùX›\ôTõ›÷◊HN¬àBà€€ú›õ›‹Œàåï\õT›ùX›\ôTõ›÷◊HH◊N¬à€€ú››\ëQHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jù[ôKò›\úô[ù
N¬à€€ú›ô^QHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jù[ôKõô^
N¬àYà
›\ëQ
Hõ›‹Àú\⁄
åï\õTõ› ›\ëQ
JN»À»åï\õTõ›ŒàVT’SëÀ[õ[ŸYöYYàYà
ô^Q
Hõ›‹Àú\⁄
åï\õTõ› ô^Q
JN»À»åï\õTõ›ŒàVT’SëÀ[õ[ŸYöYYà€€ú›\ÿXõHHõ›‹Àôö[\ä
äHOàãò]SYX[í]àOHù[
N¬à€€ú››]HHåê€\‹⁄YûU\õT›ùX›\ôJõ›‹ N»À»VT’SëÀ[õ[ŸYöYYà€€ú›]T]X[]Nàåë]T]X[]HH\ÿXõKõ[ô›à»íSî’QëíP“QSïààõ›‹Àô]ô\ûJ
äHOàãô]T]X[]HOOHì“»äH»ì“»ààîTïPSé¬àô]\õà¬à[Ÿ[NàìL◊“Uó’TìW‘’ïP’TëHãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K›]K]T]X[]K\ÿXõQ^\ûP€›[ùà\ÿXõKõ[ô›õ›‹Ààõ›Nàë[à›\úô[ù
€ô^^\ûH€õH
[àŸ\»õ›^‹ŸHH[€ùKY^\ûH⁄‹ù›]Hÿ^H⁄]I‹»[ú›ù[Y[ùX\›\àŸ\ H8†%\ÿXõQ^\ûP€›[ùôYõX›»\»€ô\›Kõ›òXúöXÿ]Y\»Hù[\õH›ùX›\ôKàãàN¬üBÇãÀ»OOOOHNH
[äH8†%][KQ^\ûH[Y€õY[ùOOOOBò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìNJﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Vã‹ùà›ö[ô H¬à€€ú›ù[ôHH]ÿZ]ùZ[òYSXë[ì][Q^\ûT€ò\⁄›
ﬁ[Xõ€‹ù
N¬àYà
ù[ôKú›]\»OOHì“»äH¬àô]\õà»[Ÿ[NàìNW”USW—VTñW–SQ”ìQSïãõ›ô[ò[òŸNàëSàã›]\Œàù[ôKú›]\À]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]K›]NàíSî’QëíP“QSï—UHà\»åì][Q^\ûP[Y€õY[ù›]Kõ›‹Œà◊H\»åì][Q^\ûP[Y€õY[ùõ›÷◊HN¬àBà€€ú›õ›‹Œàåì][Q^\ûP[Y€õY[ùõ›÷◊HH◊N¬à€€ú››\ëQHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jù[ôKò›\úô[ù
N¬à€€ú›ô^QHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jù[ôKõô^
N¬àYà
›\ëQ
Hõ›‹Àú\⁄
åì][Q^\ûTõ› ›\ëQ
JN»À»VT’SëÀ[õ[ŸYöYYàYà
ô^Q
Hõ›‹Àú\⁄
åì][Q^\ûTõ› ô^Q
JN»À»VT’SëÀ[õ[ŸYöYYà€€ú›⁄P[Y€õY[ùHåê€\‹⁄YûS][Q^\ûS⁄Jõ›‹ N»À»VT’SëÀ[õ[ŸYöYYà€€ú›]ê[Y€õY[ùHåê€\‹⁄YûS][Q^\ûR]äõ›‹ N»À»VT’SëÀ[õ[ŸYöYYà€€ú›]T]X[]Nàåë]T]X[]HHõ›‹Àõ[ô›à»íSî’QëíP“QSïààõ›‹Àô]ô\ûJ
éà[ûJHOàãô]T]X[]HOOHì“»äH»ì“»ààîTïPSé¬àô]\õà¬à[Ÿ[NàìNW”USW—VTñW–SQ”ìQSïãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K⁄P[Y€õY[ù]ê[Y€õY[ù]T]X[]Kõ›‹Àà\ôX›[€ò[öX\Œàìì”ëHãàN¬üBÇãÀ»OOOOH⁄\ôYõ€[ô»\›‹ûHùYôô\àõ‹àLà
⁄Ÿ]À[›ô\ã][YJH[ôN
õ€›ô\ã[›ô\ã][YJHOOOOBãÀ»ÿ[YHÀ[Z[ù]HÿY[òŸH\»LI‹»Só”LW‘ì—P’S”ó‘ëQîëT“”TÀô]\ŸY
õ›ãÀ»ôYYö[ôY
H»]õ⁄YHŸX€€ô€Y⁄KYYôô\ô[ù[Y\ãàõ›ÿ]Y€ÇãÀ»X\öŸ]›\ú»
X]⁄\»LI‹»^\›[ô»[ò€€ô][€ò[\ôYúô\⁄ôXŸY[ù
H8†%ãÀ»[â‹»Yù\ãZ›\ú»‹[€ãX⁄Z[àô\‹€úŸH\»›[HôX[€ô\›K][Y\›[\YãÀ»€ò\⁄›ù\›õ›Húô\⁄[ùòY^H€ôKÇò€€ú›êQSPó—Só”USQVTñW“T’‘ñHHô]»X\ìíQïHàêêSí”íQïHàî—Sî—VãòYSXë[ì][Q^\ûT€ò\⁄›◊Oä
N¬ò€€ú›êQSPó—Só”USQVTñW”PV‘”êT“’»Hå»À»X]⁄\»ëP”‘ëTó”PV‘”êT“’»»Só”LW‘ì—P’S”ó”PV‘”êT“’¬ÇãÀ»OOOOH›\ÀåH
åçãLLL H8†%[à‹›\öXŸHõ€[ô»\›‹ûHùYôô\àOOOOBãÀ»ô]\Ÿ\»H‹›[ôXYHô\Ÿ[ù[àù[ôKò›\úô[ùú‹›
HãÀ»ÿ\KŸ[ã€õ‹õX[^ôYô\‹€úŸHô]⁄YûHùZ[òYSXë[ì][Q^\ûT€ò\⁄›ãÀ»Xõ›ôJH8†%\»ùYôô\à\»‹[]YSî“QHHÿ[YHôYúô\⁄ﬁX€Hô[›À€¬ãÀ»]€‹›»ëTì»Y][€ò[[àTHÿ[»»ò]K[[Z]ùYŸ]àZ\úõ‹ú»BãÀ»⁄\Håî‹›\›‹ûQõ‹îﬁ[Xõ€[ôXYHô]\õú»õ‹à⁄]H
›[Y\›[\ãÀ»‹›ö^JK€»H^\›[ô»Ÿ[ô\öX»⁄[ô›⁄[ô»[\ú»
åï⁄[ô›‘⁄[ùÀãÀ»åî]›]Àåê€\‹⁄YûT]
Hÿ[àôHô]\ŸY[õ[ŸYöYYõ‹àH[à]ÇãÀ»ö^\»[ù[ù[€ò[Hù[\ôH8†%MíV\»HŸ\\ò]H[àô]⁄ãÀ»
ùZ[òYSXë[ìM
Hõ››\úô[ùHõ⁄[ôY[ù»\»ÿY[òŸN»⁄\ö[ô»]ãÀ»[à\»H‹‹⁄XõHù]\ôHôYö[ô[Y[ùõ›òXúöXÿ]Y\»Çù\H[î‹›⁄[ùH»àù[Xô\é»[Y\›[\à›ö[ôŒ»‹›àù[Xô\é»ö^àù[Xô\àù[N¬ò€€ú›Só‘‘’“T’‘ñHHô]»X\ìíQïHàêêSí”íQïHàî—Sî—Vã[î‹›⁄[ù◊Oä
N¬ò€€ú›Só‘‘’“T’‘ñW”PV‘“Sï»Hå»À»ÿ[YHÿ\\»êQSPó—Só”USQVTñW”PV‘”êT“’¬Çò\ﬁ[ò»ù[ò›[€àòYSXë[ì][Q^\ûTôYúô\⁄ﬁX€J
H¬à€€ú›‹ùHõÿŸ\‹Àô[ùãî‘ï›ö[ô ‘ï
N¬àõ‹à
€€ú›ﬁ[Xõ€Ÿà»ìíQïHãêêSí”íQïHãî—Sî—VóH\»€€ú›
H¬à€€ú›€ò\H]ÿZ]ùZ[òYSXë[ì][Q^\ûT€ò\⁄›
ﬁ[Xõ€‹ù
N¬àYà
€ò\ú›]\»OOHì“»äH€€ù[ùYN¬à€€ú›\úàHêQSPó—Só”USQVTñW“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬à\úãú\⁄
€ò\
N¬àYà
\úãõ[ô›àêQSPó—Só”USQVTñW”PV‘”êT“’ H\úãú⁄Yù

N¬àêQSPó—Só”USQVTñW“T’‘ñKúŸ]
ﬁ[Xõ€\úäN¬Çà€€ú›‹›ò[H€ò\ò›\úô[ù	âà\[Ÿà€ò\ò›\úô[ùú‹›OOHõù[Xô\àà»€ò\ò›\úô[ùú‹›àù[¬àYà
‹›ò[OHù[	âà‹›ò[à
H¬à€€ú›õ›“\€»Hô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›‹›\úàHSó‘‘’“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬à‹›\úãú\⁄
»à]Kõõ› 
K[Y\›[\àõ›“\€À‹›à‹›ò[ö^àù[JN¬àYà
‹›\úãõ[ô›àSó‘‘’“T’‘ñW”PV‘“Sï H‹›\úãú⁄Yù

N¬àSó‘‘’“T’‘ñKúŸ]
ﬁ[Xõ€‹›\úäN¬àBàBüBÇöYà
õÿŸ\‹Àô[ùãìì—W—SïàOOHù\›à	âà\—[ê€€ôöY›\ôY

JH¬àòYSXë[ì][Q^\ûTôYúô\⁄ﬁX€J
Kòÿ]⁄

\úäHOà€€ú€€Kô\úõ‹äñ’êQSPó—SóH[ö]X[][KY^\ûHôYúô\⁄òZ[Yàã\úäJN¬àŸ][ù\ùò[


HOà¬àòYSXë[ì][Q^\ûTôYúô\⁄ﬁX€J
Kòÿ]⁄

\úäHOà€€ú€€Kô\úõ‹äñ’êQSPó—SóHÿ⁄Y[Y][KY^\ûHôYúô\⁄òZ[Yàã\úäJN¬àKSó”LW‘ì—P’S”ó‘ëQîëT“”T N¬üBÇãÀ»OOOOHLLH
[äH8†%]öY[òŸHù\⁄[€àOOOOBãÀ»ô]\Ÿ\»H–SQHŸ[ô\öX»ù\⁄[€à[\ú»H⁄]HLLH\Ÿ\»
åëù\⁄[€î]X[]KãÀ»åê€›[ù›]\ H[ôZŸ\»H[ôXYKX€€\]Y[àLã”LÀ”M”MK”N”NK”LLãÀ»[Ÿ[H›]]»\»\ò[Y]\ú»8†%ì»ô]»[àô]⁄\»\»\ôH\‹Ÿ[XõHŸÇãÀ»]Hÿ\K›òY[Xà[ôXYH€€\]YX\õY\à[àHÿ[YHô\]Y\›àLK”Mã”M¬ãÀ»\ôH\‹ŸY[à€Àù]^H\ôHì’ôKZ[\[Y[ùYõ‹à[à\ôHôXÿ]\ŸBãÀ»^H[ôXYH[ù\õò[Hõ›]H»[àõ‹àíQïK–êSí”íQïH
ŸYBãÀ»ùZ[åîô[Z][P€€\‹⁄][€í\›‹ûI‹»›€àíQïK–êSí”íQïx°§ë[àúò[ò⁄
H8†%BãÀ»–SQHLK€Mã€M»ò[Y\»\ŸYûHH⁄]K[Xô[YLLH\ôH[ôXYH[ã\€›\òŸYãÀ»õ‹à‹ŸH€»ﬁ[Xõ€Œ»€õH—Sî—VŸ[ùZ[ô[H\Ÿ\»⁄]H\ôK€ô\›BãÀ»ôYõX›YöXHL[MõM‘õ›ô[ò[òŸH[ôXYH^‹ŸY[Ÿ]⁄\ôH[àHô\‹€úŸKÇãÀ»”ëT’Hì’NàLë[à[ôN[à»õ›Y]ÿ\úûHH€\‹⁄YöYY›]HXô[ãÀ»Hÿ^HZ\à⁄]H€›[ù\ú\ù»»
ùZ[åí]î⁄Ÿ]“\›‹ûH»õ€›ô\à›]BãÀ»€\‹⁄YöXÿ][€àŸ\ôHô]ô\à‹ùY»H[à]
H8†%\»ù[ò›[€àŸ\¬ãÀ»ì’òXúöXÿ]H€ôKà]ô\‹ù»HôX[ù[Y\öX»]Z[»[ú›XY[ôX\ö‹¬ãÀ»›]H\»ìì’÷QU–”T‘“QíQQ—Só‘Uã€ô\›Kõ›\»Sî’QëíP“QSïãÀ»
]H^\›À€õHHXô[Ÿ\€â›
KÇôù[ò›[€àùZ[òYSXë[ìLLJàﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VãàLNà[ûKLë[éà[ûKL—[éà[ûKM[éà[ûKMQ[éà[ûKàMéà[ûKMŒà[ûKN[éà[ûKNQ[éà[ûKLL[éà[ûBäH¬à€€ú›€€\‹⁄][€î›]\»Håê€›[ù›]\ 
LKò€€\\ö\€€ú»◊JKõX\

à[ûJHOàò€€\‹⁄][€î›]JJN¬à€€ú›]öXù][€î›]\»Håê€›[ù›]\ 
Mãò]öXù][€ú»◊JKõX\

à[ûJHOàô€Z[ò[ùö]ô\äJN¬Çà€€ú›õ›‹Œàåë]öY[òŸSX]ö^õ›÷◊HH¬à¬à[Ÿ[NàìLW‘ëSRUSW–””T‘“US”àã€XZ[éàúô[Z][WÿXÿ€›[ù[ô»ãà›]NàÿöôX›öŸ^\ €€\‹⁄][€î›]\ Kõ[ô›»ÿöôX›öŸ^\ €€\‹⁄][€î›]\ Hà»íSî’QëíP“QSï“T’‘ñHóKà]T]X[]Nàåëù\⁄[€î]X[]JLKô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»€ò\⁄›€›[ùàLKú€ò\⁄›€›[ù›]P€›[ùŒà€€\‹⁄][€î›]\Àõ›öY\éàLKúõ›öY\àí“UHàKà›X\ôàí[ùö[ú⁄XÀŸ^ö[ú⁄X»€€\‹⁄][€à^Z[ú»ô[Z][H›ùX›\ôN»]\»õ›H›[ôX[€ôH—K‘H⁄Y€ò[àãàKà¬à[Ÿ[NàìLó“Uó‘“—U»ã€XZ[éàùõ€][]W‹›\ôòXŸWÿ›\úô[ùŸ^\ûHãà›]NàLë[ãú›]\»OOHì“»à	âàLë[ãò›\úô[ù»ìì’÷QU–”T‘“QíQQ—Só‘UààíSî’QëíP“QSï—UHãà]T]X[]Nàåëù\⁄[€î]X[]JLë[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»]TSZ[ù\–ŸT‹ôXYàLë[ãò›\úô[ùÀò]TSZ[ù\–ŸT‹ôXYœ»ù[⁄[ôŸNàLë[ãò⁄[ôŸHœ»ù[Kà›X\ôàíUã‹⁄Ÿ]»\»õ€][]K\öX⁄[ô»\ﬁ[[Y]ûKõ›\ôX›[€àûH]Ÿ[ãàãàKà¬à[Ÿ[NàìL◊“Uó’TìW‘’ïP’TëHã€XZ[éàùõ€][]W›\õW‹›ùX›\ôHãà›]NàL—[ãú›]HíSî’QëíP“QSï—UHãà]T]X[]Nàåëù\⁄[€î]X[]JL—[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»\ÿXõQ^\ûP€›[ùàL—[ãù\ÿXõQ^\ûP€›[ùœ»Kà›X\ôàëúõ€ùÿòX⁄À[ÿYYUà\»X]\ö]HöX⁄[ô»€€ù^õ›HòYH\ôX›[€ãàãàKà¬à[Ÿ[NàìM’íV‘ëQ“SQW–””ïVã€XZ[éàõX\öŸ]›õ€][]Wÿ€€ù^ãà›]NàM[ãú›]\»OOHì“»à»ê’TîëSï’íV–””ïV””ìHààíSî’QëíP“QSï—UHãà]T]X[]Nàåëù\⁄[€î]X[]JM[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»›\úô[ùö^àM[ãùö^œ»ù[›\úô[ùö^⁄[ôŸT\òŸ[ùàM[ãùö^⁄[ôŸT\òŸ[ùœ»ù[Kà›X\ôàëù[LY^H\òŸ[ù[HíVôY⁄[YH\»õ›ôKYô]⁄YûHLLN»\ŸH^\›[ô»ÿ\K›ö^X€‹úô[][€à›]]àíV\»õ€ãY\ôX›[€ò[€€ù^àãàKà¬à[Ÿ[NàìMW‘ëPSVëQ’î◊“STQQã€XZ[éàùõ€][]W‹öX⁄[ô◊›ú◊‹ôX[^ôYãà›]Nà€MQ[ãú›]HíSî’QëíP“QSï—UHãMQ[ãúùïô[ôíSî’QëíP“QSï—UHóKà]T]X[]Nàåëù\⁄[€î]X[]JMQ[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»ùååàMQ[ãúùååœ»ù[]SYX[í]éàMQ[ãò]SYX[í]àœ»ù[]ï‘ùååò][ŒàMQ[ãö]ï‘ùååò][»œ»ù[Kà›X\ôàíUã]úÀTïàYX\›\ô\»öX⁄ô\‹Àÿ⁄X\ô\‹»Ÿàõ€][]Kõ›—K‘H\ôX›[€ãàãàKà¬à[Ÿ[NàìMó‘ëSRUSW–UíPïUS”àã€XZ[éàúô[Z][W€[›ôWŸö]ô\ú»ãà›]NàÿöôX›öŸ^\ ]öXù][€î›]\ Kõ[ô›»ÿöôX›öŸ^\ ]öXù][€î›]\ Hà»íSî’QëíP“QSï“T’‘ñHóKà]T]X[]Nàåëù\⁄[€î]X[]JMãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»ö]ô\ê€›[ùŒà]öXù][€î›]\»Kà›X\ôàë‹ôYZ»]öXù][€à\»ö\ú›[‹ô\à[ôô\⁄YX[X]ÿ\ôN»]\»õ›õ€ŸàŸàÿ]\ÿ[]KàãàKà¬à[Ÿ[NàìM◊”“W‘‘“US”íSë»ã€XZ[éàò›\úô[ùŸ^\ûW‹‹⁄][€ö[ô»ãà›]NàMÀòYŸ‹ôYÿ]T›]K]T]X[]Nàåëù\⁄[€î]X[]JMÀô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»ù^Y\ï‹ö]\í[ôô\ô[òŸNàMÀòù^Y\ï‹ö]\í[ôô\ô[òŸKõ€[YR\›‹ûP]òZ[XõNàMÀùõ€[YR\›‹ûP]òZ[XõHKà›X\ôàì“HŸ\»õ›ô]ôX[ù^Y\ã]ô\ú›\À]‹ö]\àY[ù]KàãàKà¬à[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àã€XZ[éàô^\ûW€ZY‹ò][€àãà›]NàN[ãú›]\»OOHì“»à	âàN[ãò›\úô[ù»ìì’÷QU–”T‘“QíQQ—Só‘Uàà
N[ãú›]HíSî’QëíP“QSï—UHäKà]T]X[]Nàåëù\⁄[€î]X[]JN[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»€ò\⁄›€›[ùàN[ãú€ò\⁄›€›[ùœ»Kà›X\ôàîõ€›ô\à\»^\ûHZY‹ò][€à]öY[òŸKõ›X\öŸ]\ôX›[€àûH]Ÿ[ãàãàKà¬à[Ÿ[NàìNW”USW—VTñW–SQ”ìQSïã€XZ[éàò‹õ‹‹◊Ÿ^\ûW‹›ùX›\ôHãà›]Nà€NQ[ãõ⁄P[Y€õY[ùíSî’QëíP“QSï—UHãNQ[ãö]ê[Y€õY[ùíSî’QëíP“QSï—UHóKà]T]X[]Nàåëù\⁄[€î]X[]JNQ[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»\ÿXõQ^\ûP€›[ùà
NQ[ãúõ›‹»◊JKõ[ô›Kà›X\ôàê—K‘H‹õ‹‹ÀY^\ûH›ùX›\ôH\»õ›\]Z]ò[[ù»ù[\⁄ÿôX\ö\⁄\ôX›[€à‹àù^Y\ã›‹ö]\àY[ù]KàãàKà¬à[Ÿ[NàìLL”PTí—U‘ëQ“SQW—VSëQã€XZ[éàúöXŸW‹›ùX›\ôWÿ[ô›ò[ú⁄][€àãà›]Nà¬àLL[ãõ‹[ö[ôœÀò€€ô][€àíSî’QëíP“QSï—UHãLL[ãõ‹[ö[ôœÀòôZ]ö[›\àíSî’QëíP“QSï—UHãàLL[ãúôY⁄[YOÀò›\úô[ùôY⁄[YHíSî’QëíP“QSï—UHãLL[ãúôY⁄[YOÀúô\‹›\ôHíSî’QëíP“QSï—UHãàLL[ãúôY⁄[YOÀú›ùX›\ò[öX\»íSî’QëíP“QSï—UHãàKà]T]X[]Nàåëù\⁄[€î]X[]JLL[ãô]T]X[]JK\ôX›[€ò[€Z[Nàìì”ëHãà]Z[Œà»úôXZ€›]ôZ]ö[›\éàLL[ãú›ùX›\ôOÀòúôXZ€›]ôZ]ö[›\àœ»ù[ô]ô\úÿ[ÿ[ôY]NàLL[ãú›ùX›\ôOÀúô]ô\úÿ[ÿ[ôY]Hœ»ù[Kà›X\ôàîôY⁄[YHXô[»\ÿ‹öXôH›\úô[ù›ùX›\ôK›ò[ú⁄][€ãàõ›ö\⁄[€ò[ô\⁄€»ô\]Z\ôHòX⁄›\›[ô\ôHõ›ÿ€‹ö[ô»ŸZY⁄ÀàãàKàN¬Çà€€ú›€€ôõX›Œà›ö[ô÷◊HH◊N¬àYà
NQ[ãõ⁄P[Y€õY[ùOOHê‘ì‘‘◊—VTñW–””ëìP’àNQ[ãö]ê[Y€õY[ùOOHê‘ì‘‘◊—VTñW–””ëìP’äH€€ôõX›Àú\⁄
ìNW–‘ì‘‘◊—VTñW–””ëìP’äN¬àYà
L—[ãú›]HOOHìRVQ’TìW‘’ïP’TëHäH€€ôõX›Àú\⁄
ìL◊’TìW‘’ïP’TëW”RVQäN¬à€€ú›ô\⁄YX[\ôŸP€›[ùH
Mãò]öXù][€ú»◊JKôö[\ä
à[ûJHOàô€Z[ò[ùö]ô\àOOHîëT“QPS”Të—HäKõ[ô›¬àYà
ô\⁄YX[\ôŸP€›[ùà
H€€ôõX›Àú\⁄
ìMó”Të—W‘ëT“QPS‘ëT—SïäN¬Çà€€ú›]X[]T›[[X\ûHHõ›‹ÀúôYXŸJ
XÿŒàôX€‹ô›ö[ôÀù[Xô\èãõ› HOà¬àXÿ÷‹õ›Àô]T]X[]WHH
Xÿ÷‹õ›Àô]T]X[]WH
H
»N¬àô]\õàXÿŒ¬àKﬂJN¬Çàô]\õà¬à[Ÿ[NàìLLW—UíQSê—W—ïT“S”àãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kﬁ[Xõ€à]öY[òŸTõ›‹Œàõ›‹À€€ôõX›À]X[]T›[[X\ûKà\ôX›[€ò[öX\Œàìì”ëHãÿ€‹ö[ô“[\X›àìì”ëHãà[ù\úô]][€ë›X\ôàï\»X]ö^ù\Ÿ\»ÿúŸ\ùò][€ã[€õH]öY[òŸHX‹õ‹‹»LKSLLà][ù[ù[€ò[HXZŸ\»ì»\ôX›[€ò[€Z[H[ô\»õ›H›Xú›]]Hõ‹àLLàÿ[ôY]HŸ[X›[€ãàÿ[YH›X\ô\»H⁄]KXò\ŸYLLKàãàN¬üBÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»LLà
[äH8†%”ëT’TëUKTUPSUH–UH
›Xã\›\»ÀMåçãLLL BãÀ¬ãÀ»Z\úõ‹ú»HSïSïŸà⁄]I‹»
åêÿ[ôY]R\ô]Qÿ]JNà\ôXõÿ⁄»BãÀ»ÿ[ôY]H€àZ\‹⁄[ôÀ‹›[H]Kúõ⁄Ÿ[à€€ùòX›Y[ù]K‹à[à[ùò[YãÀ»öXŸKàô]ô\àôYX›»\ôX›[€à‹àõŸö]Xö[]KÇãÀ¬ãÀ»SPëTêUKT—TãP””ëíTìQQTTïTëHîì”H“UI‘»à⁄]I‹»Y][€ò[BãÀ»ô\]Z\ô\»H⁄€K\€ò\⁄›ù]ô\‹ù»ôXX⁄›ô\ò[ô\ôX›OOHïïQHããÀ»⁄X⁄]Ÿ[àô\]Z\ô\»‹›
Ÿù]\ô\ €‹[€ú»»ôH[àﬁ[òÀàõ»[àù]\ô\¬ãÀ»Y\\à^\›»Y]
H\ÿ€‹ŸYòX⁄ŸYÿ\8†%ŸYBãÀ»ÿ\K›åãŸã‹ôX€‹ô\ã\õ›öY\ãX]Y]
K€»[ã\€›\òŸYù]\»TìPSëSïBãÀ»ÿ\Y]TïPS[ô\àH^\›[ô»€€\]Uù]ô\‹ùŸ⁄XÀàô]\⁄[ô»]ãÀ»ô\]Z\ô[Y[ùô\òò][H€›[XZŸH\»ÿ]Hì–“—Qõ‹ô]ô\à8†%õ›[à€ô\›ãÀ»ÿYô]H⁄Y€ò[ù\›HXY[ôà\»[àÿ]H[ú›XY\ôXõÿ⁄‹»€à⁄]ãÀ»[à–SàX›X[Hõ›ôHŸ^H
€ò\⁄›‹][›Húô\⁄ô\‹À€€ùòX›Y[ù]BãÀ»öXHãQ[ãöXŸHò[Y]JH[ôŸ\»ì’ô\]Z\ôHù]\ô\À\ﬁ[òÀÇãÀ»ù]\ô\–Y\\î›]\»\»ô\‹ùY^X⁄]H€à]ô\ûHô\›[€»\»\¬ãÀ»ô]ô\à⁄[[ùHZ\›ZŸ[àõ‹à⁄]I‹»›õ€ôŸ\à›X\ò[ùYKà⁄[àH[àù]\ô\¬ãÀ»Y\\à\»]ô[ùX[HùZ[\»ù[ò›[€à\»H€ôHXŸH»ô]ö\⁄][ôãÀ»YHôX[ù]\ô\À\ﬁ[ò»ô\]Z\ô[Y[ù€à‹Ÿà⁄][ôXYH^\›»\ôKÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇôù[ò›[€àåêÿ[ôY]R\ô]Qÿ]Q[äàﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Vãà›\úô[ù^\ûNà^\ûQ]Kàÿ[ôY]Nàåîô]öY]–ÿ[ôY]Kàéàåê€€ùòX›Y[ù]Qÿ]Tô\›[ù[à[êù[ôQŸ[ô\ò]Y]à›ö[ô»ù[äH¬à€€ú›\ôõÿ⁄‘ôX\€€úŒà›ö[ô÷◊HH◊N¬à€€ú›ÿ\õö[ô‹Œà›ö[ô÷◊HH◊N¬Çà€€ú›ù[ôQúô\⁄H€\‹⁄YûUù]öY[
[êù[ôQŸ[ô\ò]Y]ïU’ëT“”◊”TÀõ‹[€ú N¬àYà
ù[ôQúô\⁄ùô\ôX›OOHïïQHäH\ôõÿ⁄‘ôX\€€úÀú\⁄
Só‘”êT“’…ÿù[ôQúô\⁄ùô\ôX›X
N¬ÇàYà
ZäH\ôõÿ⁄‘ôX\€€úÀú\⁄
íó—Só—–UW”RT‘“Së»äN¬à[ŸHYà
ãú›]\»OOHîT‘»äH\ôõÿ⁄‘ôX\€€úÀú\⁄
ããöãö\ôõÿ⁄‘ôX\€€úÀõX\

äHOàó…‹üX
JN¬Çà€€ú›^\ûQ]SÿöàH›\úô[ù^\ûKô^\ûQ]H[ú›[òŸ[Ÿà]Bà»›\úô[ù^\ûKô^\ûQ]Bààô]»]J›ö[ô ›\úô[ù^\ûKô^\ûQ]JJN¬à€€ú›HHù[Xô\ãö\—ö[ö]J^\ûQ]SÿöãôŸ][YJ
JBà»X]ôõ€‹ä
^\ûQ]SÿöãôŸ][YJ
HH]Kõõ› 
JH»ç
Bààù[¬àYà
HOHù[H
H\ôõÿ⁄‘ôX\€€úÀú\⁄
í◊—W“SïêSQäN¬ÇàYà
ÿ[ôY]Kúô]öY]‘›]\»OOHêì–“—Q—UHäH\ôõÿ⁄‘ôX\€€úÀú\⁄
ê–SëQUW‘US’W–ì–“—QäN¬àYà
ÿ[ôY]Kúô]öY]‘›]\»OOHîTïPS—UHäHÿ\õö[ô‹Àú\⁄
ê–SëQUW”‘S”êS—íQS◊‘TïPSäN¬àYà
Jÿ[ôY]Kõ\›öXŸHOHù[	âàÿ[ôY]Kõ\›öXŸHà
JH\ôõÿ⁄‘ôX\€€úÀú\⁄
ê–SëQUW”“SïêSQäN¬Çàô]\õà¬à›]\Œà\ôõÿ⁄‘ôX\€€úÀõ[ô›OOH»îT‘»à\»åêÿ[ôY]R\ôÿ]T›]\»àêì–“—Qà\»åêÿ[ôY]R\ôÿ]T›]\Àà\ôõÿ⁄‘ôX\€€úŒà\úò^Kôúõ€Jô]»Ÿ]
\ôõÿ⁄‘ôX\€€ú JKàÿ\õö[ô‹Œà\úò^Kôúõ€Jô]»Ÿ]
ÿ\õö[ô‹ JKà[ïù]à¬à€ò\⁄›úô\⁄ô\‹Œàù[ôQúô\⁄ùô\ôX›à€ò\⁄›YŸS\Œàù[ôQúô\⁄òYŸS\Ààù]\ô\–Y\\î›]\Œàìì’÷QU“STSQSïQãàõ›Nàë[ã\]ÿ]H[ù[ù[€ò[HŸ\»õ›ô\]Z\ôH‹›Yù]\ô\À[‹[€ú»ö\K\ﬁ[ò»ïQH
[õZŸH⁄]I‹»
HôXÿ]\ŸHõ»[àù]\ô\»Y\\à^\›»Y]8†%H\ÿ€‹ŸYòX⁄ŸYÿ\õ›H]ôHòZ[\ôKàô]ö\⁄]\»ÿ]H€òŸHH[àù]\ô\»Y\\à\»ùZ[àãàKàî›]\ŒàèÀú›]\»ìRT‘“Së»ãàKà[ù\úô]][€ë›X\ôàë[ã\]8†%T‘»YX[ú»\»ÿ[ôY]I‹»[ã\€›\òŸY]H\»ù\›€‹ùH[õ›Y⁄»]ò[X]H[ô\à[â‹»›\úô[ùôX[ÿ\Xö[]H
õ»ù]\ô\À\ﬁ[ò»€Z[JKà]\»õ›HõŸö]Xö[]H›X\ò[ùYH‹àõÿòXö[]Hÿ€‹ôKàãàN¬üBÇò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìLLäﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Vã‹ùà›ö[ô H¬à€€ú›ù[ôHH]ÿZ]ùZ[òYSXë[ì][Q^\ûT€ò\⁄›
ﬁ[Xõ€‹ù
N¬àYà
ù[ôKú›]\»OOHì“»äH¬àô]\õà»[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãõ›ô[ò[òŸNàëSàãﬁ[Xõ€›]\ŒàíSî’QëíP“QSïãÿ]\Œà◊K\ôõÿ⁄‘ôX\€€úŒà»ìì◊—Só–ïSëHóKŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
HN¬àBà€€ú››\ëQHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jù[ôKò›\úô[ù
N¬àYà
X›\ëQ
H¬àô]\õà»[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãõ›ô[ò[òŸNàëSàãﬁ[Xõ€›]\ŒàíSî’QëíP“QSïãÿ]\Œà◊K\ôõÿ⁄‘ôX\€€úŒà»ìì◊–’TîëSï—VTñHóKŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
HN¬àBà€€ú›]T›öZŸHHù[ôKò›\úô[ùò]T›öZŸN¬àYà
Jù[Xô\ãö\—ö[ö]J]T›öZŸJH	âà]T›öZŸHà
JH¬àô]\õà»[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãõ›ô[ò[òŸNàëSàãﬁ[Xõ€›]\ŒàíSî’QëíP“QSïãÿ]\Œà◊K\ôõÿ⁄‘ôX\€€úŒà»ìì◊–UW‘’íR—HóKŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
HN¬àBÇàÀ»LK”Mã”M»[ôXYH[ã\õ›]Yõ‹àíQïK–êSí”íQïH
ÿ[YHõŸX›[€ÇàÀ»ù[ò›[€ú»]ô\ûH›\àòYSXà[Ÿ[H[ôXYHô[Y\»€äH8†%õ»ô]¬àÀ»[àô]⁄\ôKÇà€€ú›LHHùZ[åîô[Z][P€€\‹⁄][€í\›‹ûJﬁ[Xõ€å
N¬à€€ú›MàHùZ[åîô[Z][P]öXù][€äﬁ[Xõ€å
N¬à€€ú›M»HùZ[åì⁄T‹⁄][€ö[ô—]öY[òŸJﬁ[Xõ€å
N¬Çà€€ú›YúŒà\úò^O»ê—HàîHãêUHàåW“UHóOàH÷»ê—HãêUHóK»ê—HãåW“UHóK»îHãêUHóK»îHãåW“UHóWN¬à€€ú›ÿ[ôY]\Œàåîô]öY]–ÿ[ôY]V◊HH◊N¬àõ‹à
€€ú›‹⁄YKõ€WHŸàYú H¬à€€ú›Håëö[ôÿ[ôY]SY ›\ëQ⁄YH\»[ûK]T›öZŸKõ€JN¬àYà

Hÿ[ôY]\Àú\⁄
åï‘ô]öY]–ÿ[ôY]J⁄YH\»[ûKõ€KLKMãM JN¬àBÇà€€ú›Ÿ[ô\ò]Y]Hù[ôKò›\úô[ùôŸ[ô\ò]Y]
ù[ôH\»[ûJKôŸ[ô\ò]Y]ô]»]J
Kù“T”‘›ö[ô 
N¬à€€ú›ÿ]\»Hÿ[ôY]\ÀõX\

ÿ[ôY]JHOà¬à€€ú›àHåëÿ]Pÿ[ôY]RY[ù]Q[äﬁ[Xõ€›\ëQ]T›öZŸKÿ[ôY]JN¬àô]\õà»⁄YNàÿ[ôY]Kú⁄YK›öZŸNàÿ[ôY]Kú›öZŸK[€ô^[ô\‹‘õ€Nàÿ[ôY]Kõ[€ô^[ô\‹‘õ€Kããùåêÿ[ôY]R\ô]Qÿ]Q[äﬁ[Xõ€›\ëQÿ[ôY]KãŸ[ô\ò]Y]
HN¬àJN¬Çà€€ú›õÿ⁄ŸYHÿ]\Àôö[\ä
Œà[ûJHOàÀú›]\»OOHîT‘»äN¬àô]\õà¬à[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãàõ›ô[ò[òŸNàëSàãàﬁ[Xõ€àŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà›]\Œàÿ]\Àõ[ô›OOH»íSî’QëíP“QSïààõÿ⁄ŸYõ[ô›OOH»îT‘»ààêì–“—Qãàÿ]\Àà›[[X\ûNà»›[ÿ[ôY]\Œàÿ]\Àõ[ô›\‹ŸYàÿ]\Àõ[ô›Hõÿ⁄ŸYõ[ô›õÿ⁄ŸYàõÿ⁄ŸYõ[ô›Kà\ôõÿ⁄‘ôX\€€úŒà\úò^Kôúõ€Jô]»Ÿ]
õÿ⁄ŸYôõ]X\

Œà[ûJHOàÀö\ôõÿ⁄‘ôX\€€ú»◊JJJKàÿ€‹ö[ô“[\X›àìì”ëHãàõÿòXö[]R[\X›àìì”ëHãàZPÿ[àìì”ëHãà€õ›€ì[Z]][€úŒà¬àìõ»[àù]\ô\»Y\\à^\›»Y]8†%\»ÿ]HŸ\»õ›ô\]Z\ôH‹›Yù]\ô\À[‹[€ú»ﬁ[ò»ïQK[õZŸH⁄]I‹»àŸYH[ïù]ôù]\ô\–Y\\î›]\»€àXX⁄ÿ]Kàãàï\»\»HY\]Z]ò[[ù]K\]X[]Hÿ]H€õH
LLàÿ€‹HY‹ôYYåçãLLL Kà]Ÿ\»õ›Y][ò€YHHLLêã\›[H\ôX›[€ò[ëT’–—K–ëT’‘HŸ[X›[€àôYH8†%]ô[XZ[ú»⁄]K[€õHõ‹àõ›ÀàãàKàN¬üBÇò\ôŸ]
ãÿ\Kÿ]Y]ÿYò[òŸYY‹ôYZ‹À\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBà€€ú›‹›Hù[Xô\äÀúô\Kú]Y\ûJú‹›äJN¬à€€ú››öZŸHHù[Xô\äÀúô\Kú]Y\ûJú›öZŸHäJN¬à€€ú›^\’—^\ûHHù[Xô\äÀúô\Kú]Y\ûJôHäJN¬à€€ú›]î\òŸ[ùHù[Xô\äÀúô\Kú]Y\ûJö]àäJN¬à€€ú›\–ÿ[H
Àúô\Kú]Y\ûJù\HäHê—HäKù’\\êÿ\ŸJ
HOOHîHé¬àYà
V‹‹››öZŸK^\’—^\ûK]î\òŸ[ùKô]ô\ûJù[Xô\ãö\—ö[ö]JJH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàî]Y\ûH\ò[\»ô\]Z\ôYà‹››öZŸKK]ã\OP—_KààK
N¬àBà€€ú›ô\›[Hÿ[–Yò[òŸY‹ôYZ‹ ‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[
N¬àô]\õàÀöú€€ä¬à\ò⁄]X›\ôTõ€NàêQêSê—Q—‘ëQR‘◊‘TëW––S◊‘ì”—àãàôXY€õS[ŸNàùYKà‹ô\êXÿŸ\‹’\ŸYàò[ŸKà⁄Ÿ[ë^‹ŸYàò[ŸKà[ú]à»‹››öZŸK^\’—^\ûK]î\òŸ[ù‹[€ï\Nà\–ÿ[»ê—HààîHàKàô\›[àõ›Nàî\ôHõX⁄ÀTÿ⁄€\»ÿ[›[][€à
õ»]ôHô]⁄
Kà]î\òŸ[ù]\›ôH€›\òŸYúõ€HHôX[]ôHUà8†%\»[ô⁄[ùŸ\»õ›ô]⁄‹àò[Y]HUà]Ÿ[ãàãàKå
N¬üJN¬Çò\ôŸ]
ãÿ\Kÿ]Y]›òY[XãY[ã[LLã\õ€Ÿàã\ﬁ[ò»
 HOà¬à€€ú›]Y]Ÿ^HHõÿŸ\‹Àô[ùãëSó–UQU“—VOÀùö[J
Hàé¬à€€ú›õ›öYYŸ^HHÀúô\Kú]Y\ûJöŸ^HäOÀùö[J
Hàé¬àYà
X]Y]Ÿ^Hõ›öYYŸ^HOOH]Y]Ÿ^JH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàìZ\‹⁄[ô»‹à[ùò[Y]Y]Ÿ^KààK N¬àBà€€ú›ﬁ[Xõ€\ò[HH
Àúô\Kú]Y\ûJúﬁ[Xõ€äHìíQïHäKù’\\êÿ\ŸJ
N¬àYà
J»ìíQïHãêêSí”íQïHãî—Sî—VóH\»›ö[ô÷◊JKö[ò€Y\ ﬁ[Xõ€\ò[JJH¬àô]\õàÀöú€€ä»›]\ŒàëTîì‘àã\úõ‹éàï[ú›\‹ùYﬁ[Xõ€à\ŸHíQïKêSí”íQïK‹à—Sî—VààK
N¬àBà€€ú›‹ùHõÿŸ\‹Àô[ùãî‘ï›ö[ô ‘ï
N¬à€€ú›ô\›[H]ÿZ]ùZ[òYSXë[ìLLäﬁ[Xõ€\ò[H\»ìíQïHàêêSí”íQïHàî—Sî—Vã‹ù
N¬àô]\õàÀöú€€ä»\ò⁄]X›\ôTõ€NàïêQSPó”LLó—Só‘ì”—àãôXY€õS[ŸNàùYK‹ô\êXÿŸ\‹’\ŸYàò[ŸK⁄Ÿ[ë^‹ŸYàò[ŸKããúô\›[Kå
N¬üJN¬ÇÇôù[ò›[€àùZ[òYSXë[ìN
ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäH¬à€€ú›\›HêQSPó—Só”USQVTñW“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬à€€ú›]\›H\›⁄\›õ[ô›HWN¬àYà
[]\›[]\›ò›\úô[ù[]\›õô^
H¬àô]\õà¬à[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãà›]NàíSî’QëíP“QSï—UHà\»åîõ€›ô\î›]K€ò\⁄›€›[ùà\›õ[ô›]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]Kà[ù\úô]][€ë›X\ôàìôYYH›\úô[ù
€ô^[à€ò\⁄›⁄]õ›^\öY\»ô\Ÿ[ùôYõ‹ôHZY‹ò][€àÿ[àôH\‹Ÿ\‹ŸYàãàN¬àBà€€ú›]\››\ëQHòYSXë[ìõ‹õX[^ôY—^\ûQ]J]\›ò›\úô[ù
N¬à€€ú›]\›ô^QHòYSXë[ìõ‹õX[^ôY—^\ûQ]J]\›õô^
N¬àYà
[]\››\ëQ[]\›ô^Q
H¬àô]\õà»[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\Œàì“»ã›]NàíSî’QëíP“QSï—UHà\»åîõ€›ô\î›]K€ò\⁄›€›[ùà\›õ[ô›]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]HN¬àBà€€ú›]\››[[X\ûHH»›\úô[ùàåîõ€›ô\ë^\ûT›[[X\ûJ]\››\ëQ
Kô^àåîõ€›ô\ë^\ûT›[[X\ûJ]\›ô^Q
HN»À»VT’Së»õã[õ[ŸYöYYÇà]ô]ö[›\Œà»›\úô[ùà[ûN»ô^à[ûHHù[Hù[¬àõ‹à
]HH\›õ[ô›Hé»HèH»KKJH¬à€€ú›H\›⁄WN¬àYà
Zò›\úô[ùZõô^
H€€ù[ùYN¬à€€ú››\ëQHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jò›\úô[ù
N¬à€€ú›ô^QHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jõô^
N¬àYà
\›\ëQ\ô^Q
H€€ù[ùYN¬àYà
›\ëQô^\ûHOOH]\››\ëQô^\ûH	âàô^Qô^\ûHOOH]\›ô^Qô^\ûJH¬àô]ö[›\»H»›\úô[ùàåîõ€›ô\ë^\ûT›[[X\ûJ›\ëQ
Kô^àåîõ€›ô\ë^\ûT›[[X\ûJô^Q
HN¬àúôXZŒ¬àBàBàYà
\ô]ö[›\ H¬àô]\õà¬à[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãà›]NàíSî’QëíP“QSï“T’‘ñHà\»åîõ€›ô\î›]K€ò\⁄›€›[ùà\›õ[ô›à›\úô[ùà]\››[[X\ûKò›\úô[ùô^à]\››[[X\ûKõô^]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]Kà[ù\úô]][€ë›X\ôàìôYY]X\›€»[à€ò\⁄›»⁄]Hÿ[YH›\úô[ù€ô^ÿ[[ô\à^\öY\»ôYõ‹ôHZY‹ò][€àÿ[àôH\‹Ÿ\‹ŸYàãàN¬àBàô]\õà¬à[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K€ò\⁄›€›[ùà\›õ[ô›à›\úô[ùà]\››[[X\ûKò›\úô[ùô^à]\››[[X\ûKõô^]T]X[]Nàì“»à\»åë]T]X[]Kàõ›Nàëù[[H€€\]][€à
›\⁄^ôHõ‹õX[^ò][€ã‹õ‹‹ÀY^\ûH[\ H[ù[ù[€ò[HZ\úõ‹ú»ùZ[åîõ€›ô\ìZY‹ò][€â‹»›€àÿ€‹Hõ‹à\»\‹»8†%\»ô]\õú»H€»€€\\òXõH›[[X\öY\Œ»Y\\à[HX]\»Y[ùXÿ[Ÿ⁄X»»H^\›[ô»
[õ[ŸYöYY
Hù[ò›[€à[ôÿ[àôH^Y\ôY€àY[ùXÿ[H€òŸH\»ò\ŸH\»\õ›ôYàãàN¬üBÇãÀ»OOOOHLà
[äH8†%Uà⁄Ÿ]»OOOOBãÀ»ÿ[YHõ‹õ][\»\»ùZ[åí]î⁄Ÿ]‘€ò\⁄›
UHHUàHUH—HUã⁄[ô»‹ôXY¬ãÀ»ú»UJKôKZ[\[Y[ùY\ôX›HYÿZ[ú›^\ûQ]K‘ô[Z][Q]H[ú›XYŸÇãÀ»ôX€‹ô\î€ò\⁄›ôXÿ]\ŸHH‹öY⁄[ò[ù[ò›[€â‹»[ú]\H\»\ô]⁄\ôYãÀ»»H⁄]HôX€‹ô\â‹»ÿ⁄[XH[ôÿ[õõ›XÿŸ\[à]H⁄]›]⁄[ô⁄[ô¬ãÀ»]ù[ò›[€à]Ÿ[à
⁄X⁄\»›]Ÿàÿ€‹H8†%ùZ[åí]î⁄Ÿ]‘€ò\⁄›¬ãÀ»ùZ[åí]î⁄Ÿ]“\›‹ûH\ôHì’[ŸYöYYûH\»ZY‹ò][€äKÇôù[ò›[€àòYSXë[í]î⁄Ÿ]‘€ò\⁄›
Yà^\ûQ]JH¬à€€ú›]PŸHH
YòŸT›öZŸ\»◊JKôö[ô

 HOàÀö\–]JN¬à€€ú›]THH
YúT›öZŸ\»◊JKôö[ô

 HOàÀö\–]JN¬à€€ú›]PŸR]àHåëö[ö]R]ä]PŸOÀö]äN¬à€€ú›]TR]àHåëö[ö]R]ä]TOÀö]äN¬à€€ú›ŸU⁄[ô‹»H
YòŸT›öZŸ\»◊JKôö[\ä
 HOà\Àö\–]H	âàÀú›öZŸHà
]PŸOÀú›öZŸHœ»R[ôö[ö]JJN¬à€€ú›U⁄[ô‹»H
YúT›öZŸ\»◊JKôö[\ä
 HOà\Àö\–]H	âàÀú›öZŸH
]TOÀú›öZŸHœ»[ôö[ö]JJN¬à€€ú›ŸU⁄[ô“]àHåê]ô\òYŸJŸU⁄[ô‹ÀõX\

 HOàåëö[ö]R]äÀö]äJKôö[\ä

Nà\»ù[Xô\àOàOHù[
JN¬à€€ú›U⁄[ô“]àHåê]ô\òYŸJU⁄[ô‹ÀõX\

 HOàåëö[ö]R]äÀö]äJKôö[\ä

Nà\»ù[Xô\àOàOHù[
JN¬à€€ú›ŸU⁄[ô’ú–]T‹ôXYHŸU⁄[ô“]àOHù[	âà]PŸR]àOHù[»ŸU⁄[ô“]àH]PŸR]ààù[¬à€€ú›U⁄[ô’ú–]T‹ôXYHU⁄[ô“]àOHù[	âà]TR]àOHù[»U⁄[ô“]àH]TR]ààù[¬à€€ú›]TSZ[ù\–ŸT‹ôXYH]TR]àOHù[	âà]PŸR]àOHù[»]TR]àH]PŸR]ààù[¬à€€ú›]T]X[]Nàåë]T]X[]HH]PŸR]àOHù[	âà]TR]àOHù[»ì“»àà]PŸR]àOHù[]TR]àOHù[»îTïPSààíSî’QëíP“QSïé¬àô]\õà»[Y\›[\àYô^\ûQ]OÀù“T”‘›ö[ôœÀä
Hù[]T›öZŸNà]PŸOÀú›öZŸHœ»]TOÀú›öZŸHœ»ù[]PŸR]ã]TR]ãŸU⁄[ô’ú–]T‹ôXYU⁄[ô’ú–]T‹ôXY]TSZ[ù\–ŸT‹ôXY]T]X[]HN¬üBÇôù[ò›[€àùZ[òYSXë[ìLäﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäH¬à€€ú›\›HêQSPó—Só”USQVTñW“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬à€€ú›]\›H\›⁄\›õ[ô›HWN¬à€€ú›]\›QH]\›Àò›\úô[ù»òYSXë[ìõ‹õX[^ôY—^\ûQ]J]\›ò›\úô[ù
Hàù[¬àYà
[]\›Q
H¬àô]\õà»[Ÿ[NàìLó“Uó‘“—U»ãõ›ô[ò[òŸNàëSàã›]\Œàì“»ã€ò\⁄›€›[ùà\›õ[ô››\úô[ùàù[]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]HN¬àBà€€ú››\úô[ùHòYSXë[í]î⁄Ÿ]‘€ò\⁄›
]\›Q
N¬Çà]ô]ö[›\–€€\\òXõNàô]\õï\O\[ŸàòYSXë[í]î⁄Ÿ]‘€ò\⁄›àù[Hù[¬àõ‹à
]HH\›õ[ô›Hé»HèH»KKJH¬à€€ú›H\›⁄WN¬àYà
Zò›\úô[ù
H€€ù[ùYN¬à€€ú›YHòYSXë[ìõ‹õX[^ôY—^\ûQ]Jò›\úô[ù
N¬àYà
YY
H€€ù[ùYN¬à€€ú›ÿ[ôY]HHòYSXë[í]î⁄Ÿ]‘€ò\⁄›
Y
N¬àYà
ÿ[ôY]Kò]T›öZŸHOOH›\úô[ùò]T›öZŸJH»ô]ö[›\–€€\\òXõHHÿ[ôY]N»úôXZŒ»BàBÇà€€ú›⁄[ôŸHHô]ö[›\–€€\\òXõH»¬à]PŸR]éà›\úô[ùò]PŸR]àOHù[	âàô]ö[›\–€€\\òXõKò]PŸR]àOHù[»›\úô[ùò]PŸR]àHô]ö[›\–€€\\òXõKò]PŸR]ààù[à]TR]éà›\úô[ùò]TR]àOHù[	âàô]ö[›\–€€\\òXõKò]TR]àOHù[»›\úô[ùò]TR]àHô]ö[›\–€€\\òXõKò]TR]ààù[à]TSZ[ù\–ŸT‹ôXYà›\úô[ùò]TSZ[ù\–ŸT‹ôXYOHù[	âàô]ö[›\–€€\\òXõKò]TSZ[ù\–ŸT‹ôXYOHù[»›\úô[ùò]TSZ[ù\–ŸT‹ôXYHô]ö[›\–€€\\òXõKò]TSZ[ù\–ŸT‹ôXYàù[àHàù[¬Çà€€ú›]T]X[]Nàåë]T]X[]HH›\úô[ùô]T]X[]HOOHíSî’QëíP“QSïà»íSî’QëíP“QSïààô]ö[›\–€€\\òXõHOHù[»îTïPSàà›\úô[ùô]T]X[]N¬Çàô]\õà¬à[Ÿ[NàìLó“Uó‘“—U»ãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
K€ò\⁄›€›[ùà\›õ[ô››\úô[ùô]ö[›\–€€\\òXõK⁄[ôŸK]T]X[]Kà[ù\úô]][€ë›X\ôàíUã‹⁄Ÿ]»\»õ€][]K\öX⁄[ô»\ﬁ[[Y]ûKõ›H›[ôX[€ôH—K‘H\ôX›[€àõ›H8†%ÿ[YH›X\ô\»H⁄]KXò\ŸYLãàãàN¬üBÇãÀ»OOOOHM
[äH8†%íVôY⁄[YH€€ù^OOOOBãÀ»ŸX›\ö]RYLåHô\€€ôYúõ€H[â‹»›€àÿ‹ö\[X\›\à‘’à
—SW’êQSë◊‘÷SPì”ãÀ»HíSëPHíVãî—KSëV8†%õ››Y\‹ŸY
H[ô]ôK]ô\öYöYYöXBãÀ»ÿ\Kÿ]Y]Ÿ[ãZ[ôX]ö^\‹›Z[ùòY^KX⁄X⁄»
\›€‹ŸOLLKçÀãÀ»UT“PìW‘êSë—W—ì‘ó“SëPW’íVT‘ H[ôÿ\Kÿ]Y]Ÿ[ãZ[ôX]ö^\][›KX⁄X⁄¬ãÀ»
ò]»öY[⁄\H€€ôö\õYYà\›‹öXŸK⁄Àò€‹ŸKô]ÿ⁄[ôŸJKÇãÀ»€€\]][€àZ\úõ‹ú»H^\›[ô»⁄]KXò\ŸYM^X›NÇãÀ»ö^H\›‹öXŸN»ö^⁄[ôŸHH\›‹öXŸHH⁄Àò€‹ŸN¬ãÀ»ö^⁄[ôŸT\òŸ[ùHö^⁄[ôŸH»⁄Àò€‹ŸH
àL
⁄[à⁄Àò€‹ŸHà
KÇãÀ»\»\»HëUÀ[ã[€õHÿ\ô[àòYSXà
Mö^ôY⁄[YQ[äH8†%H^\›[ô¬ãÀ»LLH]öY[òŸKYù\⁄[€àM’íV‘ëQ“SQW–””ïVõ›»
⁄]K\€›\òŸY
H\»[ù›X⁄YÇò€€ú›Só“SëPW’íV‘—P’TíUW“QHåN¬Çò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìM

H¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àô]\õà»[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬àBàûH¬à€€ú›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åã€X\öŸ]ôYY‹][›Hã¬àY]Ÿàî‘’ãàXY\úŒà¬àê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãàòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãàò€Y[ùZYéà€Y[ùYàKàõŸNàî””ãú›ö[ô⁄YûJ»Q“Nà—Só“SëPW’íV‘—P’TíUW“QHJKàJN¬à€€ú›ò]»H]ÿZ]ô\Àù^

N¬à]\úŸYà[ûHHù[¬àûH»\úŸYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»\úŸYHù[»Bà€€ú›õ›»H\úŸYÀô]OÀíQ“OÀñ‘›ö[ô Só“SëPW’íV‘—P’TíUW“Q
WN¬àYà
\ô\Àõ⁄»\õ›»\[Ÿàõ›Àõ\›‹öXŸHOOHõù[Xô\àäH¬à€€ú€€Kô\úõ‹ä—SàMêRSH›]\œI‹ô\Àú›]\ﬂHõŸT€ö\]I‹ò]Àú€XŸJÃ
_X
N¬àô]\õà»[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã›]\Œàô\Àú›]\À]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]HN¬àBà€€ú›ö^Hõ›Àõ\›‹öXŸN¬à€€ú›ô]ê€‹ŸHH\[Ÿàõ›Àõ⁄œÀò€‹ŸHOOHõù[Xô\àà»õ›Àõ⁄Àò€‹ŸHàù[¬à€€ú›ö^⁄[ôŸHHô]ê€‹ŸHOHù[	âàô]ê€‹ŸHà»ö^Hô]ê€‹ŸHàù[¬à€€ú›ö^⁄[ôŸT\òŸ[ùHö^⁄[ôŸHOHù[	âàô]ê€‹ŸHOHù[	âàô]ê€‹ŸHà»
ö^⁄[ôŸH»ô]ê€‹ŸJH
àLàù[¬àô]\õà¬à[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kàö^ô]ê€‹ŸKö^⁄[ôŸKö^⁄[ôŸT\òŸ[ùà]T]X[]NàîTïPSà\»åë]T]X[]KÀ»TïPSõ›“ŒàX]⁄\»⁄]HM	‹»›€à€€ùô[ù[€à
]ôK[€õKõ»LY^H\òŸ[ù[HôY⁄[YH\ôJBà[ù\úô]][€ë›X\ôàê›\úô[ùUíV€€ù^€õKõ€ãY\ôX›[€ò[8†%ÿ[YH›X\ô\»H⁄]KXò\ŸYMàù[LY^H\òŸ[ù[HôY⁄[YH\»õ›ôKYô]⁄Y\ôN»ŸYHÿ\K›ö^X€‹úô[][€ãàãàN¬àHÿ]⁄
\úäH¬à€€ú›\úì\Ÿ»H\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹àé¬à€€ú€€Kô\úõ‹ä—SàMêRSH^Ÿ\[€èIŸ\úì\ŸﬂX
N¬àô]\õà»[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\ŸÀ]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]HN¬àBüBÇãÀ»OOOOH›\ÀåH8†%[àZ[H]ô[»
ô]ö[›\ÀY^H€‹ŸK‘‘
HOOOOBãÀ»\Ÿ\»›åãÿ⁄\ùÀ⁄\›‹öXÿ[H–SQH[ô⁄[ù[ôXYH]ôK]ô\öYöYY[àBãÀ»åÀQ›\H‹›⁄\›‹ûH]Y]õ‹àíQïK–êSí”íQïK‘—Sî—V
‹[ã⁄Y⁄€›À¬ãÀ»€‹ŸK›õ€[YK›[Y\›[\Z[H\úò^\ÀSó’SëTìRSë◊”PTYö]ô[ãô]ô\ÇãÀ»òXúöXÿ]Y
KàÿX⁄Y€òŸH\àﬁ[Xõ€\àÿ[[ô\à^H8†%Z[H]ô[»€â›ãÀ»⁄[ôŸH[ùòY^K€»\»ô]ô\àY»»HK\ô\KÃ‹»]ôHò]K[[Z]ùYŸ]ãÀ»ô^[€ôH⁄[ô€Hÿ[\àﬁ[Xõ€\à^KÇö[ù\ôòXŸH[ëZ[S]ô[»¬à›]\Œàì“»àíSî’QëíP“QSïàìì’–””ëíQ’TëQàìì’÷QU”PTQàëêRSé¬à–€‹ŸNàù[Xô\àù[¬ààù[Xô\àù[¬ààù[Xô\àù[¬àÀ»]åMYYåçãLLåHõ‹àHõ›ö\⁄[€ò[òYHX[òYŸ[Y[ù[ÇàÀ»
[ùûK‘”’K’äKà⁄[\H
õ€ãU⁄[\ã\€[€›Y
H]ô\òYŸHùYHò[ôŸH›ô\ÇàÀ»H\›M€€\]YZ[Hÿ[ô\À\ÿ€‹ŸY\»›X⁄]ô\û]⁄\ôH]\¬àÀ»\ŸY8†%ù[⁄[àô]Ÿ\à[àM€€\]Yÿ[ô\»\ôH]òZ[XõKô]ô\ÇàÀ»€€\]Yúõ€HH\ùX[⁄[ô›ÀÇà]åMàù[Xô\àù[¬üBÇãÀ»⁄[\H
[ú€[€›Y
HUéà]ô\òYŸHŸàùYHò[ôŸH›ô\àH\›\ö[ŸãÀ»€€\]Yÿ[ô\Ààñ⁄WHHX^
Y⁄[›ÀY⁄\ô]ê€‹Ÿ_›À\ô]ê€‹Ÿ_
KÇãÀ»ô]\õú»ù[€à[ú›YôöX⁄Y[ù]Hò]\à[à€€\][ô»úõ€HH\ùX[ãÀ»⁄[ô›»8†%€€ú⁄\›[ù⁄]\»ö[I‹»›[ô[ô»õõ»òXúöXÿ][€ààù[KÇôù[ò›[€àåê€€\]T⁄[\P]ä€‹Ÿ\Œàù[Xô\ñ◊KY⁄Œàù[Xô\ñ◊K›‹Œàù[Xô\ñ◊K\ö[Ÿàù[Xô\äNàù[Xô\àù[¬à€€ú›àHX]õZ[ä€‹Ÿ\Àõ[ô›Y⁄Àõ[ô››‹Àõ[ô›
N¬àYà
à\ö[Ÿ
»JHô]\õàù[¬à€€ú›ùYTò[ôŸ\Œàù[Xô\ñ◊HH◊N¬àõ‹à
]HHàH\ö[Ÿ»Hé»J  H¬à€€ú›ô]ê€‹ŸHH€‹Ÿ\÷⁄HHWN¬à€€ú›àHX]õX^
àY⁄÷⁄WHH›‹÷⁄WKàX]òXú Y⁄÷⁄WHHô]ê€‹ŸJKàX]òXú ›‹÷⁄WHHô]ê€‹ŸJBà
N¬àYà
Sù[Xô\ãö\—ö[ö]JäJHô]\õàù[¬àùYTò[ôŸ\Àú\⁄
äN¬àBàYà
ùYTò[ôŸ\Àõ[ô›\ö[Ÿ
Hô]\õàù[¬à€€ú››[HHùYTò[ôŸ\ÀúôYXŸJ
KäHOàH
»ã
N¬àô]\õàù[Xô\ä
›[H»ùYTò[ôŸ\Àõ[ô›
Kù—ö^Y
äJN¬üBò€€ú›Só—RSW”UëS◊––P“HHô]»X\›ö[ôÀ»]RŸ^Nà›ö[ôŒ»ô\›[à[ëZ[S]ô[»Oä
N¬Çò\ﬁ[ò»ù[ò›[€à[ëô]⁄Z[S]ô[ ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäNàõ€Z\ŸO[ëZ[S]ô[œà¬à€€ú›]RŸ^HHô]»]J
Kù“T”‘›ö[ô 
Kú€XŸJL
N¬à€€ú›ÿX⁄YHSó—RSW”UëS◊––P“KôŸ]
ﬁ[Xõ€
N¬àYà
ÿX⁄Y	âàÿX⁄Yô]RŸ^HOOH]RŸ^JHô]\õàÿX⁄Yúô\›[¬Çà€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
Hô]\õà»›]\Œàìì’–””ëíQ’TëQã–€‹ŸNàù[àù[àù[]åMàù[N¬Çà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô Hô]\õà»›]\Œàìì’÷QU”PTQã–€‹ŸNàù[àù[àù[]åMàù[N¬Çà€€ú›—]HHô]»]J
N¬àÀ»⁄Y[ôYúõ€HL»ÕHÿ[[ô\à^\»òX⁄»
åçãLLåKõ‹à]åM
HKBàÀ»L^\»€õH€€Yõ‹ùXõH€›ô\ôY‘	‹»úô]ö[›\»òY[ô»^HàôYY¬àÀ»UäM
HôYY»MH€€\]YZ[Hÿ[ô\À⁄X⁄ÕHÿ[[ô\à^\¬àÀ»ô[XXõH€›ô\ú»]ô[àX‹õ‹‹»H€ô»ŸYZŸ[ô⁄€Y^H€\›\ãàÿ[YH⁄[ô€BàÀ»ô\]Y\›ÿ[YH€òŸK\\ãY^HÿX⁄H8†%õ»^òHTHÿYÇà€€ú›úõ€Q]HHô]»]J—]KôŸ][YJ
HHÕH
àç
àå
àå
àL
N¬à€€ú›õ]H
à]JHOàù“T”‘›ö[ô 
Kú€XŸJL
N¬ÇàûH¬à€€ú›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄\›‹öXÿ[ã¬àY]Ÿàî‘’ãàXY\úŒà¬àê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãàXÿŸ\àò\Xÿ][€ã⁄ú€€àãàòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãàò€Y[ùZYéà€Y[ùYàKàõŸNàî””ãú›ö[ô⁄YûJ¬àŸX›\ö]RYà›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
Kà^⁄[ôŸTŸY€Y[ùàX\[ôÀù[ô\õZ[ô‘ŸYÀà[ú›ù[Y[ùàíSëVãà^\ûP€ŸNàà⁄Nàò[ŸKàúõ€Q]Nàõ]
úõ€Q]JKà—]Nàõ]
—]JKàJKàJN¬à€€ú›ò]»H]ÿZ]ô\Àù^

N¬à]^[ÿYà[ûHHù[¬àûH»^[ÿYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»^[ÿYHù[»BÇà€€ú›€‹ŸP\úàH\úò^Kö\–\úò^J^[ÿYÀò€‹ŸJH»^[ÿYò€‹ŸHàù[¬à€€ú›Y⁄\úàH\úò^Kö\–\úò^J^[ÿYÀöY⁄
H»^[ÿYöY⁄àù[¬à€€ú››–\úàH\úò^Kö\–\úò^J^[ÿYÀõ› H»^[ÿYõ›»àù[¬àYà
\ô\Àõ⁄»X€‹ŸP\úàZY⁄\úà[›–\úà€‹ŸP\úãõ[ô›OOH
H¬à€€ú€€Kô\úõ‹ä—SàLLRSW”UëS»êRSHﬁ[Xõ€I‹ﬁ[Xõ€H›]\œI‹ô\Àú›]\ﬂHõŸT€ö\]I‹ò]Àú€XŸJÃ
_X
N¬à€€ú›ô\›[à[ëZ[S]ô[»H»›]\ŒàëêRSã–€‹ŸNàù[àù[àù[]åMàù[N¬àSó—RSW”UëS◊––P“KúŸ]
ﬁ[Xõ€»]RŸ^Kô\›[JN¬àô]\õàô\›[¬àBÇàÀ»\›õ›»›[[àH\úò^H\»H[‹›ôXŸ[ù””TUQòY[ô»^BàÀ»
Ÿ^I‹»›[Yõ‹õZ[ô»ÿ[ôH\»õ›\ùŸàHZ[KZ\›‹ûHô\‹€úŸBàÀ»ô]⁄Y[ùòY^JH8†%ÿ[YHõ\›€€\]Yÿ[ôHà€€ùô[ù[€àBàÀ»^\›[ô»⁄]KXò\ŸY‹‹–€‹ŸH[ôXYH\Ÿ\ÀÇà€€ú›\›YH€‹ŸP\úãõ[ô›HN¬à€€ú›ô\›[à[ëZ[S]ô[»H¬à›]\Œàì“»ãà–€‹ŸNà\[Ÿà€‹ŸP\úñ€\›YHOOHõù[Xô\àà»€‹ŸP\úñ€\›YHàù[àà\[ŸàY⁄\úñ€\›YHOOHõù[Xô\àà»Y⁄\úñ€\›YHàù[àà\[Ÿà›–\úñ€\›YHOOHõù[Xô\àà»›–\úñ€\›YHàù[à]åMàåê€€\]T⁄[\P]ä€‹ŸP\úãY⁄\úã›–\úãM
KàN¬àSó—RSW”UëS◊––P“KúŸ]
ﬁ[Xõ€»]RŸ^Kô\›[JN¬àô]\õàô\›[¬àHÿ]⁄
\úäH¬à€€ú€€Kô\úõ‹ä—SàLLRSW”UëS»êRSHﬁ[Xõ€I‹ﬁ[Xõ€H^Ÿ\[€èIŸ\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹àüX
N¬à€€ú›ô\›[à[ëZ[S]ô[»H»›]\ŒàëêRSã–€‹ŸNàù[àù[àù[]åMàù[N¬àSó—RSW”UëS◊––P“KúŸ]
ﬁ[Xõ€»]RŸ^Kô\›[JN¬àô]\õàô\›[¬àBüBÇãÀ»OOOOH›\ÀåH8†%LL
[äH8†%X\öŸ]ôZ]ö[›\àôY⁄[YHOOOOBãÀ»[àô\ú⁄[€àŸàùZ[åìX\öŸ]ôZ]ö[›\îôY⁄[YKàô]\Ÿ\»H–SQHŸ[ô\öX¬ãÀ»⁄[ô›⁄[ôÀÿ€\‹⁄YöXÿ][€à[\ú»
åï⁄[ô›‘⁄[ùÀåî]›]ÀãÀ»åê€\‹⁄YûT]åïö^›]Qúõ€T‹›\›‹ûKåêúôXZ€›]ôZ]ö[›\ããÀ»åîò[ôŸT›Xù\Kåîô]ô\úÿ[ÿ[ôY]JH8†%‹ŸHZŸHZ[à⁄[ùÀ‹ö[Z]]ô\ÀãÀ»õ›H⁄]TŸ\‹⁄[€ã€»õ›[ô»\ôHôYYY\Xÿ][ôÀà€õHH€¬ãÀ»€X[[ô^Y]öX‹À]\Y[\ú»
‹[ö[ô»€€ô][€à»‹[ö[ô»ôZ]ö[›\äBãÀ»\ôHôZ[\[Y[ùY\ôH[õ[ôH⁄]ö[Z]]ôH\ò[\À»]õ⁄Yô\]Z\ö[ô»BãÀ»òZŸK‹\ùX[[ô^Y]öX‹»ÿöôX›ù\›»ÿ]\ŸûH⁄]K\‹X⁄YöX»\[ôÀÇôù[ò›[€à[ì‹[ö[ô–€€ô][€ä^S‹[éàù[Xô\ãô]ê€‹ŸNàù[Xô\ãàù[Xô\àù[àù[Xô\àù[
Nàåì‹[ö[ô–€€ô][€à¬àYà
J^S‹[àà
HJô]ê€‹ŸHà
JHô]\õàïSí”ì’”àé¬à€€ú›ÿ\›H

^S‹[àHô]ê€‹ŸJH»ô]ê€‹ŸJH
àL¬àYà
X]òXú ÿ\›
Hå Hô]\õàëìU”‘ó”ëPTó—ìU”‘Sàé¬àYà
ÿ\›à
Hô]\õàOHù[	âàà	âà^S‹[àà»ë–T’T–Pì’ëW‘ààë–T’T“Sî“QW‘ëUíS’T◊‘êSë—Hé¬àô]\õàOHù[	âàà	âà^S‹[à»ë–T—’”ó–ëS’◊‘ààë–T—’”ó“Sî“QW‘ëUíS’T◊‘êSë—Hé¬üBÇôù[ò›[€à[ì‹[ö[ô–ôZ]ö[›\äà‹[ö[ô–€€ô][€éàåì‹[ö[ô–€€ô][€ãà›\úô[ùàù[Xô\ãà^S‹[éàù[Xô\ãàô]ê€‹ŸNàù[Xô\ãà›]LMNàåîôY⁄[YT›]BäNàåì‹[ö[ô–ôZ]ö[›\à¬àYà
J^S‹[àà
HJô]ê€‹ŸHà
JHô]\õàíSî’QëíP“QSï“T’‘ñHé¬à€€ú›\—ÿ\\H‹[ö[ô–€€ô][€ãú›\ù’⁄]
ë–T’TäN¬à€€ú›\—ÿ\›€àH‹[ö[ô–€€ô][€ãú›\ù’⁄]
ë–T—’”àäN¬àYà
\—ÿ\\
H¬àYà
›\úô[ùHô]ê€‹ŸJHô]\õàëïS—–T—íS”‘ó‘ëUëTî–Sé¬àYà
›\úô[ù^S‹[äHô]\õàîTïPS—–T—íSé¬àô]\õàë–T“””‘ó—VSî“S”àé¬àBàYà
\—ÿ\›€äH¬àYà
›\úô[ùèHô]ê€‹ŸJHô]\õàëïS—–T—íS”‘ó‘ëUëTî–Sé¬àYà
›\úô[ùà^S‹[äHô]\õàîTïPS—–T—íSé¬àô]\õàë–T“””‘ó—VSî“S”àé¬àBàYà
›]LMHOOHïëSëSë◊’TäHô]\õàì‘SíSë◊—íUëW’Té¬àYà
›]LMHOOHïëSëSë◊—’”àäHô]\õàì‘SíSë◊—íUëW—’”àé¬àô]\õà›]LMHOOHíSî’QëíP“QSï“T’‘ñHà»íSî’QëíP“QSï“T’‘ñHààêêSSê—Q”‘Sàé¬üBÇò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìLL
ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäH¬à€€ú›⁄[ù»HSó‘‘’“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬àYà
⁄[ùÀõ[ô›OOH
H¬àô]\õà»[Ÿ[NàìLL”PTí—U‘ëQ“SQW—VSëQãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàìì◊‘‘’“T’‘ñW÷QUã]T]X[]NàíSî’QëíP“QSïà\»åë]T]X[]HN¬àBà€€ú››\úô[ùH⁄[ù÷‹⁄[ùÀõ[ô›HWKú‹›¬à€€ú›^S‹[àH⁄[ù÷ÃKú‹›»À»ö\ú›ÿ[\HôX€‹ôYŸ^H8†%ô\›]òZ[XõHõﬁN»[à‹[€ãX⁄Z[àô\‹€úŸH\»õ»Ÿ\\ò]Hô^H‹[ààöY[à€€ú›Z[HH]ÿZ][ëô]⁄Z[S]ô[ ﬁ[Xõ€
N¬à€€ú›ô]ê€‹ŸHHZ[Kú–€‹ŸHœ»¬à€€ú›HZ[Kú¬à€€ú›HZ[Kú¬Çà€€ú›‹[ö[ô–€€ô][€àH[ì‹[ö[ô–€€ô][€ä^S‹[ãô]ê€‹ŸK
N¬à€€ú›‹[ö[ô—ÿ\›H^S‹[àà	âàô]ê€‹ŸHà»

^S‹[àHô]ê€‹ŸJH»ô]ê€‹ŸJH
àLàù[¬Çà€€ú›MHHåï⁄[ô›‘⁄[ù ⁄[ùÀMJN¬à€€ú›ÃHåï⁄[ô›‘⁄[ù ⁄[ùÀÃ
N¬à€€ú›åHåï⁄[ô›‘⁄[ù ⁄[ùÀå
N¬à€€ú›ÃMHHåî]›] MJN¬à€€ú›ÃÃHåî]›] Ã
N¬à€€ú›ÕåHåî]›] å
N¬à€€ú››]LMHHåê€\‹⁄YûT]
ÃMJN¬à€€ú››]LÃHåê€\‹⁄YûT]
ÃÃ
N¬à€€ú››]MåHåê€\‹⁄YûT]
Õå
N¬Çà€€ú›‹[ö[ô–ôZ]ö[›\àH[ì‹[ö[ô–ôZ]ö[›\ä‹[ö[ô–€€ô][€ã›\úô[ù^S‹[ãô]ê€‹ŸK›]LMJN¬à€€ú››\úô[ùú”‹[àH^S‹[àà»
›\úô[ùà^S‹[à»êPì’ëW”‘Sààà›\úô[ù^S‹[à»êëS’◊”‘SàààêU”‘SàäHàïSí”ì’”àé¬à€€ú›ô]ö[›\‘ò[ôŸSÿÿ][€àHOHù[	âàà	âàOHù[	âààà»
›\úô[ùà»êPì’ëW‘àà›\úô[ù»êëS’◊‘ààíSî“QW‘ëUíS’T◊‘êSë—HäBààïSí”ì’”àé¬Çà]›\úô[ùô\‹›\ôHHìëUUêS”‘ó”RVQé¬àYà
›]LMHOOHïëSëSë◊’Tà	âà
›]LÃOOHïëSëSë◊’Tà›]LÃOOHïêSî“US”êSäJH›\úô[ùô\‹›\ôHHïTé¬à[ŸHYà
›]LMHOOHïëSëSë◊—’”àà	âà
›]LÃOOHïëSëSë◊—’”àà›]LÃOOHïêSî“US”êSäJH›\úô[ùô\‹›\ôHHë’”àé¬à[ŸHYà
›]LMHOOHíSî’QëíP“QSï“T’‘ñHäH›\úô[ùô\‹›\ôHHíSî’QëíP“QSï“T’‘ñHé¬Çà]›ùX›\ò[öX\»HìëUUêS”‘ó’Sê””ëíTìQQé¬àYà
ô]ö[›\‘ò[ôŸSÿÿ][€àOOHêPì’ëW‘äH›ùX›\ò[öX\»HïT‘’ïP’TëHé¬à[ŸHYà
ô]ö[›\‘ò[ôŸSÿÿ][€àOOHêëS’◊‘äH›ùX›\ò[öX\»Hë’”ó‘’ïP’TëHé¬à[ŸHYà
›\úô[ùú”‹[àOOHêPì’ëW”‘Sàà	âà›]LÃOOHïëSëSë◊’TäH›ùX›\ò[öX\»HïT‘’ïP’TëW‘ì’íT“S”êSé¬à[ŸHYà
›\úô[ùú”‹[àOOHêëS’◊”‘Sàà	âà›]LÃOOHïëSëSë◊—’”àäH›ùX›\ò[öX\»Hë’”ó‘’ïP’TëW‘ì’íT“S”êSé¬Çà€€ú›úôXZ€›]ôZ]ö[›\àHåêúôXZ€›]ôZ]ö[›\äÃ›\úô[ùœ»œ»
N¬à€€ú›ò[ôŸT›Xù\HHåîò[ôŸT›Xù\JÃMKÃÃ›]LMK›]LÃ
N¬à€€ú›ô]ô\úÿ[ÿ[ôY]HHåîô]ô\úÿ[ÿ[ôY]JÃÃ›]LMK›]LÃ›\úô[ùô\‹›\ôK›ùX›\ò[öX\ N¬Çà]›\úô[ùôY⁄[YNà›ö[ô»H›]LÃ¬àYà
ò[ôŸT›Xù\HOOHîêSë—W–””TëT‘“S”ó‘ì’íT“S”êSäH›\úô[ùôY⁄[YHHîêSë—W–””TëT‘“S”ó‘ì’íT“S”êSé¬à[ŸHYà
›]LÃOOHïëSëSë◊’Tà	âà›]LMHOOHì‘–“SUSë◊”‘ó‘êSë—HäH›\úô[ùôY⁄[YHHïTëSë‘SêP“◊”‘ó‘UT—Hé¬à[ŸHYà
›]LÃOOHïëSëSë◊—’”àà	âà›]LMHOOHì‘–“SUSë◊”‘ó‘êSë—HäH›\úô[ùôY⁄[YHHë’”ïëSë‘SêP“◊”‘ó‘UT—Hé¬Çàô]\õà¬à[Ÿ[NàìLL”PTí—U‘ëQ“SQW—VSëQãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà]T]X[]Nà
⁄[ùÀõ[ô›èH»»ì“»ààîTïPSäH\»åë]T]X[]KàY]Ÿ€ŸﬁNà¬à€›\òŸNàëSó‘‘’“T’‘ñH
YŸﬁXòX⁄ŸY€àH^\›[ô»À[Z[àòYSXà][KY^\ûHôYúô\⁄ô\õ»^òH[àÿ[ H
»›åãÿ⁄\ùÀ⁄\›‹öXÿ[õ‹àZ[H]ô[»
ÿX⁄Y€òŸKŸ^JHãàô\⁄€Œàîì’íT“S”êS‘ëTURTëT◊–êP“’T’8†%ÿ[YH\»H⁄]KXò\ŸYLLãà[Z]][€éàë[ã\€›\òŸYÿ[\\»\ôHåÀ[Z[ù]HÿúŸ\ùò][€ú»
ÿ[YHÿY[òŸH\»òYSXàLã”LÀ”N”NJKõ›X⁄À[]ô[à^S‹[à\»\õﬁ[X]Y\»Hö\ú›ÿ[\HôX€‹ôYŸ^Kõ›HŸ[ùZ[ôH^⁄[ôŸH^K[‹[àX⁄»8†%[â‹»‹[€ãX⁄Z[àô\‹€úŸH\»õ»Ÿ\\ò]H^K[‹[àöY[àãàKà‹[ö[ôŒà»€€ô][€éà‹[ö[ô–€€ô][€ãôZ]ö[›\éà‹[ö[ô–ôZ]ö[›\ãÿ\›à‹[ö[ô—ÿ\›^S‹[éà^S‹[àù[ô]ö[›\–€‹ŸNàô]ê€‹ŸHà»ô]ê€‹ŸHàù[KàôY⁄[YNà»›\úô[ùôY⁄[YKò[ôŸT›Xù\Kô\‹›\ôNà›\úô[ùô\‹›\ôK›ùX›\ò[öX\Àò[ú⁄][€éàìì’–””TUQ“Só—Só”LL’åHàKà›ùX›\ôNà»›\úô[ùú”‹[ãô]ö[›\‘ò[ôŸSÿÿ][€ãúôXZ€›]ôZ]ö[›\ãô]ô\úÿ[ÿ[ôY]HKà⁄[ô›‹Œà»åM[Héà»›]Nà›]LMK›]ŒàÃMHKåÃHéà»›]Nà›]LÃ›]ŒàÃÃKçåHéà»›]Nà›]Må›]ŒàÕåHKàô]ö[›\—^S]ô[Œà»àù[àù[–€‹ŸNàô]ê€‹ŸHù[Kà[ù\úô]][€ë›X\ôàë\ÿ‹ö\]ôHX\öŸ]\›ùX›\ôH€€ù^€õH8†%ÿ[YH›X\ô\»H⁄]KXò\ŸYLLàõ›H\ôX›[€ò[—K‘H‹àïVK‘—S⁄Y€ò[àãàN¬üBÇãÀ»OOOOH›\Àåà
åçãLLL H8†%[àZ[H€‹Ÿ\»õ‹àôX[^ôYõ€OOOOBãÀ»[àô\ú⁄[€àŸàåìÿYùí\›‹ûS€òŸT\ë^Kàÿ[YH›åãÿ⁄\ùÀ⁄\›‹öXÿ[ãÀ»[ô⁄[ù[ëô]⁄Z[S]ô[»[ôXYH\Ÿ\»
õ›ô[àõ‹àíQïK–êSí”íQïK¬ãÀ»—Sî—V
Kù\›H€ôŸ\àåY^Hò[ôŸH€»åê[õùX[^ôYôX[^ôYõ€
Ÿ[ô\öXÀãÀ»ZŸ\»HZ[à€‹Ÿ\÷◊H\úò^Kõ»⁄]H\[ô[òﬁJH\»[õ›Y⁄€‹Ÿ\»õ‹ÇãÀ»HåY^H⁄[ô›ÀàÿX⁄Y€òŸH\àﬁ[Xõ€\àÿ[[ô\à^KÇò€€ú›Só‘ïó—RSW––P“HHô]»X\›ö[ôÀ»]RŸ^Nà›ö[ôŒ»ô\›[àåîùí\›‹ûSY]öX‹»Oä
N¬Çò\ﬁ[ò»ù[ò›[€à[ëô]⁄Z[P€‹Ÿ\ ﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäNàõ€Z\ŸOåîùí\›‹ûSY]öX‹œà¬à€€ú›òY[ô—]HH[ôXQ]J
N¬à€€ú›ÿX⁄YHSó‘ïó—RSW––P“KôŸ]
ﬁ[Xõ€
N¬àYà
ÿX⁄Y	âàÿX⁄Yô]RŸ^HOOHòY[ô—]JHô]\õàÿX⁄Yúô\›[¬Çà€€ú›\›‹ûQúõ€HH[ôXQ]JMå
N¬à€€ú›\›‹ûU»HòY[ô—]N¬à€€ú›ò[òX⁄Œàåîùí\›‹ûSY]öX‹»H¬àòY[ô—]Kﬁ[Xõ€\›‹ûQúõ€K\›‹ûUÀ€‹Ÿ\’\ŸYààùçYàù[ùåLàù[ùååàù[ùïô[ôàíSî’QëíP“QSï—UHãà\›‹öXÿ[ô]⁄›]\ŒàëTîì‘àãàN¬Çà€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àSó‘ïó—RSW––P“KúŸ]
ﬁ[Xõ€»]RŸ^NàòY[ô—]Kô\›[àò[òX⁄»JN¬àô]\õàò[òX⁄Œ¬àBà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô H¬àSó‘ïó—RSW––P“KúŸ]
ﬁ[Xõ€»]RŸ^NàòY[ô—]Kô\›[àò[òX⁄»JN¬àô]\õàò[òX⁄Œ¬àBÇàûH¬à€€ú›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄\›‹öXÿ[ã¬àY]Ÿàî‘’ãàXY\úŒà¬àê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãàXÿŸ\àò\Xÿ][€ã⁄ú€€àãàòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãàò€Y[ùZYéà€Y[ùYàKàõŸNàî””ãú›ö[ô⁄YûJ¬àŸX›\ö]RYà›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
Kà^⁄[ôŸTŸY€Y[ùàX\[ôÀù[ô\õZ[ô‘ŸYÀà[ú›ù[Y[ùàíSëVãà^\ûP€ŸNàà⁄Nàò[ŸKàúõ€Q]Nà\›‹ûQúõ€Kà—]Nà\›‹ûUÀàJKàJN¬à€€ú›ò]»H]ÿZ]ô\Àù^

N¬à]^[ÿYà[ûHHù[¬àûH»^[ÿYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»^[ÿYHù[»Bà€€ú›€‹ŸP\úàH\úò^Kö\–\úò^J^[ÿYÀò€‹ŸJH»^[ÿYò€‹ŸHàù[¬àYà
\ô\Àõ⁄»X€‹ŸP\úà€‹ŸP\úãõ[ô›OOH
H¬à€€ú€€Kô\úõ‹ä—SàMHïàêRSHﬁ[Xõ€I‹ﬁ[Xõ€H›]\œI‹ô\Àú›]\ﬂHõŸT€ö\]I‹ò]Àú€XŸJÃ
_X
N¬àSó‘ïó—RSW––P“KúŸ]
ﬁ[Xõ€»]RŸ^NàòY[ô—]Kô\›[àò[òX⁄»JN¬àô]\õàò[òX⁄Œ¬àBà€€ú›€‹Ÿ\»H€‹ŸP\úãôö[\ä
éà[ö€õ›€äHOà\[ŸààOOHõù[Xô\àà	âàù[Xô\ãö\—ö[ö]JäH	âààà
H\»ù[Xô\ñ◊N¬à€€ú›ùçYHåê[õùX[^ôYôX[^ôYõ€
€‹Ÿ\ÀJN¬à€€ú›ùåLHåê[õùX[^ôYôX[^ôYõ€
€‹Ÿ\ÀL
N¬à€€ú›ùååHåê[õùX[^ôYôX[^ôYõ€
€‹Ÿ\Àå
N¬à€€ú›ô\›[àåîùí\›‹ûSY]öX‹»H¬àòY[ô—]Kﬁ[Xõ€\›‹ûQúõ€K\›‹ûUÀ€‹Ÿ\’\ŸYà€‹Ÿ\Àõ[ô›àùçYùåLùååùïô[ôàåê€\‹⁄YûTùïô[ô
ùçYùåLùåå
Kà\›‹öXÿ[ô]⁄›]\ŒàùååOHù[»ì“»ààíSî’QëíP“QSïãàN¬àSó‘ïó—RSW––P“KúŸ]
ﬁ[Xõ€»]RŸ^NàòY[ô—]Kô\›[JN¬àô]\õàô\›[¬àHÿ]⁄
\úäH¬à€€ú€€Kô\úõ‹ä—SàMHïàêRSHﬁ[Xõ€I‹ﬁ[Xõ€H^Ÿ\[€èIŸ\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹àüX
N¬àSó‘ïó—RSW––P“KúŸ]
ﬁ[Xõ€»]RŸ^NàòY[ô—]Kô\›[àò[òX⁄»JN¬àô]\õàò[òX⁄Œ¬àBüBÇãÀ»OOOOH›\Àåà8†%MH
[äH8†%ôX[^ôYú»[\YYOOOOBãÀ»ô]\Ÿ\»òYSXë[í]î⁄Ÿ]‘€ò\⁄›
[ôXYH€€\]\»UH—K‘HUàúõ€HBãÀ»–SQH[à][KY^\ûH€ò\⁄›Là[ôXYH\Ÿ\»8†%õ»ô]»‹[€ãX⁄Z[ÇãÀ»ô]⁄
Hõ‹àHUà⁄YK[ëô]⁄Z[P€‹Ÿ\»
Xõ›ôJHõ‹àHïà⁄YK[ôãÀ»HŸ[ô\öX»åê€\‹⁄YûR]ïú‘ùà
⁄]KZ[ô\[ô[ù
H»€\‹⁄YûKàZ\úõ‹ú¬ãÀ»ùZ[åîôX[^ôYú“[\YY	‹»⁄\KŸöY[»€»Húõ€ù[ôÿ\ô]\õà\¬ãÀ»ò[Z[X\ãÇò\ﬁ[ò»ù[ò›[€àùZ[òYSXë[ìMJﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—VäH¬à€€ú›\›HêQSPó—Só”USQVTñW“T’‘ñKôŸ]
ﬁ[Xõ€
H◊N¬à€€ú›]\›H\›⁄\›õ[ô›HWN¬à€€ú›]\›QH]\›Àò›\úô[ù»òYSXë[ìõ‹õX[^ôY—^\ûQ]J]\›ò›\úô[ù
Hàù[¬à€€ú›]î€ò\H]\›Q»òYSXë[í]î⁄Ÿ]‘€ò\⁄›
]\›Q
Hàù[¬à€€ú›]PŸR]àH]î€ò\Àò]PŸR]àœ»ù[¬à€€ú›]TR]àH]î€ò\Àò]TR]àœ»ù[¬à€€ú›]ú»Hÿ]PŸR]ã]TR]óKôö[\ä
äNàà\»ù[Xô\àOààOHù[
N¬à€€ú›]SYX[í]àH]úÀõ[ô›»åê]ô\òYŸJ]ú Hàù[¬Çà€€ú›ùí\›H]ÿZ][ëô]⁄Z[P€‹Ÿ\ ﬁ[Xõ€
N¬à€€ú››]HHåê€\‹⁄YûR]ïú‘ùä]SYX[í]ãùí\›úùåå
N¬à€€ú›]ìZ[ù\‘ùååH]SYX[í]àOHù[	âàùí\›úùååOHù[»]SYX[í]àHùí\›úùååàù[¬à€€ú›]ï‘ùååò][»H]SYX[í]àOHù[	âàùí\›úùååOHù[	âàùí\›úùååà»]SYX[í]à»ùí\›úùååàù[¬à€€ú›]T]X[]Nàåë]T]X[]HBàùí\›ö\›‹öXÿ[ô]⁄›]\»OOHì“»à]SYX[í]àOHù[»íSî’QëíP“QSïàÇà]PŸR]àOHù[	âà]TR]àOHù[»ì“»ààîTïPSé¬Çàô]\õà¬à[Ÿ[NàìMW‘ëPSVëQ’î◊“STQQãõ›ô[ò[òŸNàëSàã›]\Œàì“»ãàããúùí\›àŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà]T›öZŸNà]î€ò\Àò]T›öZŸHœ»ù[à]PŸR]ã]TR]ã]SYX[í]ãà]î€›\òŸNàìS—S–””TUQ—îì”W—Só”‘S”ê“RSó”ãà]ìZ[ù\‘ùåå]ï‘ùååò][À›]K]T]X[]Kà\ôX›[€ò[öX\Œàìì”ëHãÿ€‹ö[ô“[\X›àìì”ëHãà€›\òŸNàë[à›åãÿ⁄\ùÀ⁄\›‹öXÿ[Z[H€‹Ÿ\»
ÿX⁄Y€òŸKŸ^JH
»[à‹[€ãX⁄Z[àUHUà
⁄\ôY⁄]LäHãà[ù\úô]][€ë›X\ôàíUã]úÀTïàYX\›\ô\»õ€][]HöX⁄[ô»ô\ú›\»ôXŸ[ùHôX[^ôY[›ô[Y[ùà]\»õ›H\ôX›[€ò[—K‘H‹àïVK‘—S⁄Y€ò[8†%ÿ[YH›X\ô\»H⁄]KXò\ŸYMKàãàN¬üBÇôù[ò›[€àùZ[‹ôYZ—[ô⁄[ôJ[ìõ‹õX[^ôYà[ûJH¬àYà
Y[ìõ‹õX[^ôY[ìõ‹õX[^ôYú›]\»OOHîT‘»àP\úò^Kö\–\úò^J[ìõ‹õX[^ôYõõ‹õX[^ôY
JH¬àô]\õà¬à\ò⁄]X›\ôTõ€Nàë‘ëQR◊—Së“SëW‘T—W–»ãà›]\ŒàïSêUêRSPìHãàôX\€€éàë[àõ‹õX[^ôY]Hõ›]òZ[XõH
ŸYH[ìõ‹õX[^ôYú›]\»[à\ô[ùô\‹€úŸJKàãàN¬àBÇà€€ú›õ›‹»H[ìõ‹õX[^ôYõõ‹õX[^ôY\»\úò^O»›öZŸNàù[Xô\é»ŸNà[ûN»Nà[ûHOé¬à€€ú›]T›öZŸHH[ìõ‹õX[^ôYò]T›öZŸN¬à€€ú›€‹ùY›öZŸ\»Hõ›‹ÀõX\

äHOàãú›öZŸJKú€‹ù

KäHOàHHäN¬à]ÿ\àù[Xô\àù[Hù[¬àõ‹à
]HHN»H€‹ùY›öZŸ\Àõ[ô›»J  H¬à€€ú›H€‹ùY›öZŸ\÷⁄WHH€‹ùY›öZŸ\÷⁄HHWN¬àYà
ÿ\OOHù[ÿ\
Hÿ\H¬àBÇà€€ú›]Tõ›»Hõ›‹Àôö[ô

äHOàãú›öZŸHOOH]T›öZŸJN¬à€€ú›]P—T›öZŸHHÿ\OOHù[»]T›öZŸHHÿ\àù[»À»›Ÿ\à›öZŸHHUHõ‹à—Bà€€ú›]TT›öZŸHHÿ\OOHù[»]T›öZŸH
»ÿ\àù[»À»Y⁄\à›öZŸHHUHõ‹àBà€€ú›]P—Tõ›»H]P—T›öZŸHOOHù[»õ›‹Àôö[ô

äHOàãú›öZŸHOOH]P—T›öZŸJHà[ôYö[ôY¬à€€ú›]TTõ›»H]TT›öZŸHOOHù[»õ›‹Àôö[ô

äHOàãú›öZŸHOOH]TT›öZŸJHà[ôYö[ôY¬Çàù[ò›[€à]ò[X]SY YŒà[ûKXô[à›ö[ô H¬àYà
[Y Hô]\õà»Xô[›]\ŒàïSêUêRSPìHãôX\€€éàî›öZŸHõ›ô\Ÿ[ù[àô]⁄YUp¨L»⁄[ô›ÀààN¬àYà
YÀö]î›\‹X›YÀô‹ôYZ‹‘›\‹X›
H¬àô]\õà»Xô[›öZŸNàYÀú›öZŸK›]\ŒàïSêUêRSPìHãôX\€€éàëõYŸŸY]î›\‹X›‹à‹ôYZ‹‘›\‹X›õ‹à\»Y»8†%ôX]Y\»SêUêRSPìKõ›ô\õÀààN¬àBà€€ú›‹ôXYHYÀò\⁄»OHù[	âàYÀòöYOHù[»ù[Xô\ä
YÀò\⁄»HYÀòöY
Kù—ö^Y
äJHàù[¬à€€ú›‹ôXY›H‹ôXYOOHù[	âàYÀõ\›öXŸH»ù[Xô\ä

‹ôXY»YÀõ\›öXŸJH
àL
Kù—ö^Y
äJHàù[¬à€€ú›\]ZY]Sõ›HBà‹ôXY›OOHù[»ïSêUêRSPìHàà‹ôXY›H»ïQ“‘‘ëPQàà‹ôXY›»»ìS—TêUW‘‘ëPQààï“QW‘‘ëPQé¬àô]\õà¬àXô[à›]\Œàì“»ãà›öZŸNàYÀú›öZŸKà[€ô^[ô\‹ŒàYÀõ[€ô^[ô\‹Àà\›öXŸNàYÀõ\›öXŸKà]ô\òYŸTöXŸNàYÀò]ô\òYŸTöXŸKà]ô\òYŸTöXŸT€›\òŸNàYÀò]ô\òYŸTöXŸT€›\òŸKà[NàYÀô[Kàÿ[[XNàYÀôÿ[[XKà]NàYÀù]KàôYÿNàYÀùôYÿKà]éàYÀö]ãà⁄NàYÀõ⁄Kàõ€[YNàYÀùõ€[YKàöYàYÀòöYà\⁄ŒàYÀò\⁄Àà‹ôXYà‹ôXY›à\]ZY]Sõ›KàN¬àBÇàô]\õà¬à\ò⁄]X›\ôTõ€Nàë‘ëQR◊—Së“SëW‘T—W–»ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà›]\Œàì“»ãà\ú‹ŸNàê€€ùòX››Z]Xö[]H€€\\ö\€€à€õH
[K—ÿ[[XK’]K’ôYÿK“Uã‹‹ôXY€\]ZY]JKàãà\ôX›[€îù[NàëŸ\»ì’X⁄YHù[\⁄ÿôX\ö\⁄[ôŸ\»ì’‹ôX]HHõÿòXö[]K‹ÿ€‹ôKà\ôX›[€à€€Y\»€õHúõ€HLL”LLK”LLà[àH\ô[ùô\‹€úŸKàãà]T›öZŸKà›öZŸQÿ\àÿ\àÿ[ôY]\Œà¬àUW–—Nà]ò[X]SY ]Tõ›œÀòŸKêUW–—HäKàULW–—Nà]ò[X]SY ]P—Tõ›œÀòŸKåW“UW–—HäKàUW‘Nà]ò[X]SY ]Tõ›œÀúKêUW‘HäKàULW‘Nà]ò[X]SY ]TTõ›œÀúKåW“UW‘HäKàKàN¬üBÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»SïñHUPSUHVQTà8†%\ôH\ãX€€ùòX›[Z[ô»]ò[X]‹à
\ŸHåçãLLLäBãÀ»[ú]à‹ôYZ»[ô⁄[ôHÿ[ôY]\»
‹ôXY€\]ZY]JH
»Y»]ô\òYŸTöXŸBãÀ»
^X⁄]HSïëTíQíQQì’ï–T\àõ›JH
»^\›[ô»ù]\ô\’ùÿ\öX\¬ãÀ»úõ€H[ô^Y]öX‹»
[ôXYH€€\]YûHHõŸX›[€àù[KLM[ô⁄[ôH8†%ãÀ»õ»ô]»ô]⁄
Kà›]]\àÿ[ôY]NàSïñW”ì’»–RU◊”ì’–“T—HãÀ»”‘ó”TURQUHì’–SQ”ëQà\»\»\ãP””ïêP’^X›][€ã\]X[]BãÀ»€õH8†%]Ÿ\»ì’€€\]HHëU»ù^K‹Ÿ[⁄Y€ò[à[ùûHõ€ôK‘”’K’ÇãÀ»ô[XZ[àSê–SPîêUQ\à‹X»[ù[QëK”PQHô\ŸX\ò⁄^\›ÀÇãÀ»ô\⁄€»ô[›»\ôHì’íT“S”êS‘ëTURTëT◊–êP“’T’ÿ[YH›]\»\»BãÀ»ô\›ŸàH€ŸXò\ŸI‹»[ãXòX⁄›\›Yô\⁄€»
KôÀàù[HM‘
KÇãÀ¬ãÀ»\ôX›[€ò[[Y€õY[ùÿ]H
YYåçãLLåK\Ÿ\ã\ô\‹ùY€€ôù\⁄[€éÇãÀ»ò[ô[Z][H[ùûH⁄›⁄[ô»[à8†%UW–—K“ULW–—K–UW‘K“ULW‘HŸ\ôH[ãÀ»⁄›⁄[ô»SïñW”ì’»]€òŸK⁄X⁄ôXY»ZŸHH⁄[][[ô[›\»—J‘Hù^BãÀ»⁄Y€ò[]ô[à›Y⁄\»^Y\àô]ô\à€⁄ŸY]\ôX›[€äKà\»ÿ]BãÀ»ô]\Ÿ\»HVT’Së»LLàÿ[ôY]K\Ÿ[X›[€àX⁄\⁄[€ÇãÀ»
ëT’–—K–ëT’‘K’–RU ã”ì◊’êQW ã[ôXYH€€\]YûBãÀ»ùZ[åêÿ[ôY]TŸ[X›[€ã\‹ŸY[à\»ÿ[ôY]QX⁄\⁄[€ò8†%õ»ô]¬ãÀ»\ôX›[€à\»òXúöXÿ]Y\ôJKàYàHY…‹»⁄YHŸ\»õ›X]⁄LLâ‹¬ãÀ»Ÿ[X›Y⁄YH
‹àLLà\»õ»\ôX›[€ò[YŸHY]
K[à›\ù⁄\ŸBãÀ»SïñW”ì’»ô\ôX›\»›€ô‹òYY»ì’–SQ”ëQà–RU—◊”ì’–“T—K¬ãÀ»”‘ó”TURQUH\ôHYù\ÀZ\»⁄[òŸH^H[ôXYH[HòY\àõ›¬ãÀ»X›à›[Ÿ\»õ››ô\úöYHLL”LLK”LLà8†%]€õHôXY»LLâ‹»^\›[ô¬ãÀ»›]]»›‹\‹^Z[ô»ì’⁄Y\»\»úôXYH»[ù\àà]€òŸKÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBôù[ò›[€àùZ[[ùûT]X[]S^Y\ä‹ôYZ—[ô⁄[ôNà[ûKù]\ô\’ùÿ\öX\Œà›ö[ô»[ôYö[ôYÿ[ôY]QX⁄\⁄[€èŒà›ö[ô H¬àYà
Y‹ôYZ—[ô⁄[ôH‹ôYZ—[ô⁄[ôKú›]\»OOHì“»äH¬àô]\õà¬à\ò⁄]X›\ôTõ€NàëSïñW‘UPSUW”VQTó‘T—W—ãà›]\ŒàïSêUêRSPìHãàôX\€€éàë‹ôYZ»[ô⁄[ôH]Hõ›]òZ[XõH
ŸYH‹ôYZ—[ô⁄[ôKú›]\»[à\ô[ùô\‹€úŸJKàãàN¬àBÇàù[ò›[€à]ò[X]Pÿ[ôY]Jÿ[ôà[ûK⁄YNàê—HàîHäH¬àYà
Xÿ[ôÿ[ôú›]\»OOHì“»äH¬àô]\õà»Xô[àÿ[ôÀõXô[ïSí”ì’”àã[ùûT]X[]Nàî”‘ó”TURQUHãôX\€€úŒà»ìY»]HSêUêRSPìHúõ€H‹ôYZ»[ô⁄[ôH8†%ÿ[õõ›\‹Ÿ\‹»^X›][€à]X[]KàóHN¬àBà€€ú›ôX\€€úŒà›ö[ô÷◊HH◊N¬à][ùûT]X[]NàëSïñW”ì’»àï–RUàë◊”ì’–“T—Hàî”‘ó”TURQUHàìì’–SQ”ëQàHëSïñW”ì’»é¬ÇàÀ»\]ZY]Hÿ]H
‹ôXYXò\ŸYúõ€H‹ôYZ»[ô⁄[ôJBàYà
ÿ[ôõ\]ZY]Sõ›HOOHï“QW‘‘ëPQäH¬à[ùûT]X[]HHî”‘ó”TURQUHé¬àôX\€€úÀú\⁄
öYX\⁄»‹ôXY	ÿÿ[ôú‹ôXY›IHŸàô[Z][H8†%⁄Y\à[àHõ›ö\⁄[€ò[…H€€Yõ‹ùò[ôò
N¬àH[ŸHYà
ÿ[ôõ\]ZY]Sõ›HOOHïSêUêRSPìHäH¬à[ùûT]X[]HHî”‘ó”TURQUHé¬àôX\€€úÀú\⁄
î‹ôXY€›[õ›ôH€€\]Y
Z\‹⁄[ô»öYÿ\⁄ H8†%\]ZY]H[ö€õ›€ãàäN¬àBÇàÀ»ô[Z][H^[ú⁄[€àÿ]H8†%]ô\òYŸTöXŸH\»^X⁄]HSïëTíQíQQ”ì’ï–T
õ›JKàÀ»€»\»\»Hõ›Y⁄]\ö\›X»€õK[ÿ^\»\ÿ€‹ŸY\»›X⁄ÇàÀ»
[ìõ‹õX[^ôYY»]ô\òYŸHöXŸH\»]X⁄YûHHÿ[\à€ù»ÿ[ôò]ô\òYŸTöXŸJBàYà
\[Ÿàÿ[ôò]ô\òYŸTöXŸHOOHõù[Xô\àà	âàÿ[ôò]ô\òYŸTöXŸHà	âà\[Ÿàÿ[ôõ\›öXŸHOOHõù[Xô\àäH¬à€€ú›^[ú⁄[€î›Hù[Xô\ä


ÿ[ôõ\›öXŸHHÿ[ôò]ô\òYŸTöXŸJH»ÿ[ôò]ô\òYŸTöXŸJH
àL
Kù—ö^Y
äJN¬àYà
[ùûT]X[]HOOHî”‘ó”TURQUHäH¬àYà
^[ú⁄[€î›àMJH¬à[ùûT]X[]HHë◊”ì’–“T—Hé¬àôX\€€úÀú\⁄
ô[Z][H\»	Ÿ^[ú⁄[€î›IHXõ›ôH]»Ÿ\‹⁄[€à]ô\òYŸHöXŸH
SïëTíQíQQõ›ï–T
H8†%õ›ö\⁄[€ò[⁄\ŸHô\⁄€\»MIKò
N¬àH[ŸHYà
^[ú⁄[€î›LMJH¬à[ùûT]X[]HHï–RUé¬àôX\€€úÀú\⁄
ô[Z][H\»	Ÿ^[ú⁄[€î›IHô[›»]»Ÿ\‹⁄[€à]ô\òYŸHöXŸH
SïëTíQíQQõ›ï–T
H8†%õ›ö\⁄[€ò[ô\⁄€õY‹»\»\»–RU[ô[ô»›Xö[^ò][€ãò
N¬àBàBàH[ŸH¬àôX\€€úÀú\⁄
îô[Z][H^[ú⁄[€à€›[õ›ôH\‹Ÿ\‹ŸY8†%]ô\òYŸTöXŸH[ò]òZ[XõHõ‹à\»YÀàäN¬àBÇàÀ»ù]\ô\»€€ôö\õX][€àÿ]H
ô]\Ÿ\»^\›[ô»ù[KLMù]\ô\’ùÿ\öX\Àõ»ô]»ô]⁄
BàYà
[ùûT]X[]HOOHëSïñW”ì’»äH¬àYà
Yù]\ô\’ùÿ\öX\»ù]\ô\’ùÿ\öX\»OOHïSí”ì’”àäH¬à[ùûT]X[]HHï–RUé¬àôX\€€úÀú\⁄
ëù]\ô\»ï–TöX\»\»Sí”ì’”à8†%õ»[ô\[ô[ù[Z[ô»€€ôö\õX][€à]òZ[XõHY]àäN¬àH[ŸH¬àôX\€€úÀú\⁄
ù]\ô\»ï–TöX\Œà	Ÿù]\ô\’ùÿ\öX\ﬂH
^\›[ô»ù[KLM⁄Y€ò[ô]\ŸY\ÀZ\ Kò
N¬àBàBÇàÀ»\ôX›[€ò[[Y€õY[ùÿ]H
åçãLLåJH8†%ŸYHõÿ⁄»€€[Y[ùXõ›ôKÇàÀ»€õH›€ô‹òY\»[àSïñW”ì’»ô\ôX›»›\à›]\Ÿ\»[ôXYHÿ^Hô€â›X›ãÇàYà
[ùûT]X[]HOOHëSïñW”ì’»äH¬àYà
ÿ[ôY]QX⁄\⁄[€àOOHêëT’–—Hà	âà⁄YHOOHîHäH¬à[ùûT]X[]HHìì’–SQ”ëQé¬àôX\€€úÀú\⁄
ìLLàÿ[ôY]HŸ[X›[€à›\úô[ùHò]õ‹ú»—Kõ›H8†%\»Y»\»^X›][€ã\ôXYH€à\]ZY]K›[Z[ôÀù]\»H‹õ€ô»⁄YKàäN¬àH[ŸHYà
ÿ[ôY]QX⁄\⁄[€àOOHêëT’‘Hà	âà⁄YHOOHê—HäH¬à[ùûT]X[]HHìì’–SQ”ëQé¬àôX\€€úÀú\⁄
ìLLàÿ[ôY]HŸ[X›[€à›\úô[ùHò]õ‹ú»Kõ›—H8†%\»Y»\»^X›][€ã\ôXYH€à\]ZY]K›[Z[ôÀù]\»H‹õ€ô»⁄YKàäN¬àH[ŸHYà
ÿ[ôY]QX⁄\⁄[€à	âàÿ[ôY]QX⁄\⁄[€àOOHêëT’–—Hà	âàÿ[ôY]QX⁄\⁄[€àOOHêëT’‘HäH¬à[ùûT]X[]HHìì’–SQ”ëQé¬àôX\€€úÀú\⁄
LLàÿ[ôY]HŸ[X›[€à\»õ»\ôX›[€ò[YŸHöY⁄õ›»
	ÿÿ[ôY]QX⁄\⁄[€üJH8†%ôZ]\à—Hõ‹àH\»›\úô[ùHò]õ‹ôYò
N¬àH[ŸHYà
Xÿ[ôY]QX⁄\⁄[€äH¬àôX\€€úÀú\⁄
ìLLàÿ[ôY]HX⁄\⁄[€à[ò]òZ[XõH8†%\ôX›[€ò[[Y€õY[ù€›[õ›ôH⁄X⁄ŸYàäN¬àBàBÇàYà
ôX\€€úÀõ[ô›OOH
HôX\€€úÀú\⁄
ìõ»õ›ö\⁄[€ò[]ô\⁄€€€ô][€ú»öYŸŸ\ôYàäN¬àô]\õà»Xô[àÿ[ôõXô[›öZŸNàÿ[ôú›öZŸK[ùûT]X[]KôX\€€ú»N¬àBÇà€€ú›ÿ»H‹ôYZ—[ô⁄[ôKòÿ[ôY]\»ﬂN¬àô]\õà¬à\ò⁄]X›\ôTõ€NàëSïñW‘UPSUW”VQTó‘T—W—ãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà›]\Œàì“»ãàÿ€‹NàîTó–””ïêP’—VP’US”ó‘UPSUW””ìHãà\ôX›[€îù[NàëŸ\»ì’€€\]HHëU»\ôX›[€ãàô]\Ÿ\»H^\›[ô»LLàÿ[ôY]QX⁄\⁄[€à
\‹ŸY[äH€õH»›‹⁄›⁄[ô»õ›—H[ôH\»SïñW”ì’»]€òŸH8†%H[ô\õZ[ô»\ôX›[€à›[€€Y\»€õHúõ€HLL”LLK”LLãàãà\ôX›[€î€›\òŸNàÿ[ôY]QX⁄\⁄[€àïSêUêRSPìHãàô\⁄€›]\Œàîì’íT“S”êS‘ëTURTëT◊–êP“’T’ãà[ùûVõ€ôT›‹‹‹’\ôŸ]ŒàïSê–SPîêUQ8†%[ô[ô»\›‹öXÿ[QëK”PQHô\ŸX\ò⁄
\à‹XÀõ»òXúöXÿ]Yù[Xô\ú Kàãàÿ[ôY]\Œà¬àUW–—Nà]ò[X]Pÿ[ôY]JÿÀêUW–—Kê—HäKàULW–—Nà]ò[X]Pÿ[ôY]JÿÀíULW–—Kê—HäKàUW‘Nà]ò[X]Pÿ[ôY]JÿÀêUW‘KîHäKàULW‘Nà]ò[X]Pÿ[ôY]JÿÀíULW‘KîHäKàKàN¬üBÇò\ôŸ]
ãÿ\K›òY[Xàã\ﬁ[ò»
 HOà¬à€€ú›ò]‘ﬁ[Xõ€H›ö[ô Àúô\Kú]Y\ûJúﬁ[Xõ€äHìíQïHäKù’\\êÿ\ŸJ
N¬àYà
J»ìíQïHãêêSí”íQïHãî—Sî—VóH\»›ö[ô÷◊JKö[ò€Y\ ò]‘ﬁ[Xõ€
JH¬àô]\õàÀöú€€ä»\úõ‹éàï[ú›\‹ùYﬁ[Xõ€à\ŸHíQïKêSí”íQïK‹à—Sî—VààK
N¬àBà€€ú›ﬁ[Xõ€Hò]‘ﬁ[Xõ€\»åîô[Z][Tﬁ[Xõ€¬à€€ú›Ÿ\‹⁄[€àHŸ]Ÿ\‹⁄[€ä N¬àYà
\Ÿ\‹⁄[€äHô]\õàÀöú€€ä»\úõ‹éàí⁄]Hõ›€€õôX›YàX\ŸH€€õôX›⁄]Hö\ú›ààKJN¬Çà€€ú›[ê€€ôöY›\ôYH\—[ê€€ôöY›\ôY

N¬ÇàÀ»ô]⁄^\›[ô»LL”LLK”LLà›]]»\ôX›H
ÿ[YHù[ò›[€ú»BàÀ»^\›[ô»\⁄õÿ\ôXú»[ôXYH\ŸH8†%õ»\Xÿ]HŸ⁄X KÇà€€ú›HHŸ\‹⁄[€ãõX\öŸ]€ò\⁄›Àñ‹ﬁ[Xõ€N¬à€€ú›LLHùZ[åìX\öŸ]ôZ]ö[›\îôY⁄[YJﬁ[Xõ€Ÿ\‹⁄[€ãJN¬à€€ú›LLHH]ÿZ]ùZ[åë]öY[òŸQù\⁄[€äﬁ[Xõ€Ÿ\‹⁄[€ãå
N¬à€€ú›LLàH]ÿZ]ùZ[åêÿ[ôY]TŸ[X›[€äﬁ[Xõ€Ÿ\‹⁄[€ãå
N¬ÇàÀ»\ŸHêH
åçãLLL Nà€ô\›LK”Mã”M»õ›ô[ò[òŸHõ‹àHRKà\»\»BàÀ»Y]Y]K[€õHôXY8†%ùZ[åîô[Z][P€€\‹⁄][€í\›‹ûH\»H–SQBàÀ»õŸX›[€àõ›]\àLK”Mã”M»[ôXYHÿ[[ù\õò[H
öXHLLHXõ›ôJKàõ¬àÀ»ô]»ô]⁄õ»ô]»[à\›‹ûHùYôô\ãõ»\Xÿ]H[ô⁄[ôH8†%\»ù\›àÀ»ôXY»Hõ›öY\òöY[H^\›[ô»[à›]›ô\à
ãåJH[ôXYBàÀ»]X⁄\»õ‹àíQïK–êSí”íQïK€»òYSXàÿ[à›‹Z\€Xô[[ô¬àÀ»[ãXòX⁄ŸYLK”Mã”M»]H\»⁄]KÇà€€ú›LQ\ôX›HùZ[åîô[Z][P€€\‹⁄][€í\›‹ûJﬁ[Xõ€å
N¬à€€ú›L[MõM‘õ›ô[ò[òŸHH
LQ\ôX›\»[ûJKúõ›öY\àOOHëSàà»ëSàààí“UHé¬ÇàÀ»[àõ‹õX[^ôY‹ôYZ‹À“Uà8†%[ù\õò[Ÿ[ãYô]⁄»HVT’Së¬àÀ»õ›]H€»]»Ÿ⁄X»\»ô]\ŸYô\òò][Kõ›\Xÿ]YÇà]à[ûHH»›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬àYà
[ê€€ôöY›\ôY
H¬àûH¬à€€ú›‹ùHõÿŸ\‹Àô[ùãî‘ï›ö[ô ‘ï
N¬à€€ú›ô\»H]ÿZ]ô]⁄
ãÀ€ÿÿ[‹›â‹‹ùKÿ\KŸ[ã€õ‹õX[^ôY‹ﬁ[Xõ€I‹ﬁ[Xõ€X
N¬àH]ÿZ]ô\Àöú€€ä
N¬àHÿ]⁄
\úäH¬àH»›]\ŒàëëU“—êRSQã\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹ààN¬àBàBÇà€€ú›‹ôYZ—[ô⁄[ôHHùZ[‹ôYZ—[ô⁄[ôJ
N¬ÇàÀ»ù]\ô\»Y\\à›ÿ\
åçãLLM
NàôYô\àH[ã\€›\òŸYù]\ô\»ï–TàÀ»öX\»
[ëù]\ô\’ùÿ\öX\ H⁄[à]ô]\õôY›]\»ì“»àõ‹àŸ^K€¬àÀ»[ùûH]X[]I‹»ù]\ô\ÀX€€ôö\õX][€àÿ]Hõ»€ôŸ\àôYY»⁄]Hõ‹à\¬àÀ»[ú]àòZ[»€‹ŸY»H‹öY⁄[ò[⁄]HOÀôù]\ô\’ùÿ\öX\»Yà[â‹¬àÀ»€€\]][€à\»““TQ—êRS“Sî’QëíP“QSï
KôÀàôYõ‹ôHX\öŸ]‹[äH8†%àÀ»ô]ô\à⁄[[ùHôX]Y\»Sí”ì’”à⁄[àHôX[⁄]Hò[YH^\›ÀÇà]ù]\ô\’ùÿ\öX\‘ö[X\ûHHOÀôù]\ô\’ùÿ\öX\Œ¬à]ù]\ô\’ùÿ\öX\‘õ›ô[ò[òŸHHí“UHé¬àYà
[ê€€ôöY›\ôY
H¬àûH¬à€€ú›[ëù]öX\»H]ÿZ][ëù]\ô\’ùÿ\öX\ ﬁ[Xõ€
N¬àYà
[ëù]öX\Àú›]\»OOHì“»äH¬àù]\ô\’ùÿ\öX\‘ö[X\ûHH[ëù]öX\ÀòöX\Œ¬àù]\ô\’ùÿ\öX\‘õ›ô[ò[òŸHHëSàé¬àBàHÿ]⁄¬àÀ»òZ[»€‹ŸY»⁄]Hò[YH[ôXYHŸ]Xõ›ôH8†%õ»òXúöXÿ][€ÇàBàBà€€ú›[ùûT]X[]HHùZ[[ùûT]X[]S^Y\ä‹ôYZ—[ô⁄[ôKù]\ô\’ùÿ\öX\‘ö[X\ûK
LLà\»[ûJOÀôX⁄\⁄[€äN¬ÇàÀ»òYSXà[ã[€õHZY‹ò][€ãà\ŸHH
åçãLLLäNàLã”LÀ”N”NH€€\]YàÀ»úõ€H[à€õKöXHH⁄\ôY][KY^\ûH^Y\àXõ›ôKà\ŸHÇàÀ»
åçãLLL NàM
íV
HYY\»HŸ\\ò]H[ã[€õHô]⁄à\ŸHÀàÀ»›\ÀåH
åçãLLL NàLLYY[ã\€›\òŸY‹›Z\›‹ûH
»Z[BàÀ»]ô[»
ŸYHùZ[òYSXë[ìLL
KàLK”Mã”M»\ôHSàõ‹àíQïK–êSí”íQïBàÀ»[ô“UHõ‹à—Sî—V
ŸYHL[MõM‘õ›ô[ò[òŸHô[› KàMK”LLK”LLàô[XZ[ÇàÀ»^X›H\»ôYõ‹ôH
⁄]KXò\ŸYô]\ŸY[ò⁄[ôŸY
H8†%ŸYBàÀ»LLQ]öY[òŸQù\⁄[€ãô]öY[òŸTõ›‹»õ‹à‹ŸK⁄X⁄›[[ò€Y\»H”àÀ»⁄]K\€›\òŸYLã”LÀ”N”NK”LLõ›‹»€ÀŸ\õ‹à⁄YKXûK\⁄YH€€\\ö\€€ÇàÀ»\ö[ô»\»ZY‹ò][€ãõ›ô[[›ôYÇà€€ú›‹ùHõÿŸ\‹Àô[ùãî‘ï›ö[ô ‘ï
N¬à]Lë[éà[ûHH»[Ÿ[NàìLó“Uó‘“—U»ãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]L—[éà[ûHH»[Ÿ[NàìL◊“Uó’TìW‘’ïP’TëHãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]M[éà[ûHH»[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]N[éà[ûHH»[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]NQ[éà[ûHH»[Ÿ[NàìNW”USW—VTñW–SQ”ìQSïãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]LL[éà[ûHH»[Ÿ[NàìLL”PTí—U‘ëQ“SQW—VSëQãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]MQ[éà[ûHH»[Ÿ[NàìMW‘ëPSVëQ’î◊“STQQãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]LLQ[éà[ûHH»[Ÿ[NàìLLW—UíQSê—W—ïT“S”àãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬à]LLë[éà[ûHH»[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãõ›ô[ò[òŸNàëSàã›]\Œàî““TQãôX\€€éàëSó”ì’–””ëíQ’TëQàN¬àYà
[ê€€ôöY›\ôY
H¬àûH¬àLë[àHùZ[òYSXë[ìLäﬁ[Xõ€
N¬àL—[àH]ÿZ]ùZ[òYSXë[ìL ﬁ[Xõ€‹ù
N¬àM[àH]ÿZ]ùZ[òYSXë[ìM

N¬àN[àHùZ[òYSXë[ìN
ﬁ[Xõ€
N¬àNQ[àH]ÿZ]ùZ[òYSXë[ìNJﬁ[Xõ€‹ù
N¬àLL[àH]ÿZ]ùZ[òYSXë[ìLL
ﬁ[Xõ€
N¬àMQ[àH]ÿZ]ùZ[òYSXë[ìMJﬁ[Xõ€
N¬àÀ»Mã”M»[ôXYH[ã\õ›]Yõ‹àíQïK–êSí”íQïHöXHùZ[åîô[Z][P€€\‹⁄][€í\›‹ûBàÀ»
ÿ[YHù[ò›[€àLQ\ôX›Xõ›ôH[ôXYHÿ[Y
H8†%€€\]Y\ôH\»LLI‹»[ú]ÀàÀ»õ»ô]»[àô]⁄ÿ[YHô]\ŸYù[ò›[€à]ô\ûH›\à[Ÿ[H[ôXYHô[Y\»€ãÇà€€ú›Mëõ‹ëù\⁄[€àHùZ[åîô[Z][P]öXù][€äﬁ[Xõ€å
N¬à€€ú›M—õ‹ëù\⁄[€àHùZ[åì⁄T‹⁄][€ö[ô—]öY[òŸJﬁ[Xõ€å
N¬àLLQ[àHùZ[òYSXë[ìLLJﬁ[Xõ€LQ\ôX›Lë[ãL—[ãM[ãMQ[ãMëõ‹ëù\⁄[€ãM—õ‹ëù\⁄[€ãN[ãNQ[ãLL[äN¬àÀ»LLà›Xã\›\H
åçãLLL Nà⁄\ôY\»HTêSSöY[[€ô‹⁄YHBàÀ»^\›[ô»⁄]KXò\ŸYLLêÿ[ôY]TŸ]8†%Ÿ\»ì’ô\XŸH][ôŸ\¬àÀ»ì’ô[[›ôHH⁄]HŸ\‹⁄[€àÿ]HXõ›ôKà\»\»H€ô\›àÀ»[ãY\]Z]ò[[ù\ô]K\]X[]Hÿ]H€õH
ŸYBàÀ»åêÿ[ôY]R\ô]Qÿ]Q[äKõ›Y]HLLêà\ôX›[€ò[Ÿ[X›‹ãÇàLLë[àH]ÿZ]ùZ[òYSXë[ìLLäﬁ[Xõ€‹ù
N¬àHÿ]⁄
\úäH¬à€€ú›\úì\Ÿ»H\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHàï[ö€õ›€à\úõ‹àé¬àLë[àH»[Ÿ[NàìLó“Uó‘“—U»ãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àL—[àH»[Ÿ[NàìL◊“Uó’TìW‘’ïP’TëHãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àM[àH»[Ÿ[NàìM’íV‘ëQ“SQW–””ïVãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àN[àH»[Ÿ[NàìN‘ì”’ëTó”RQ‘êUS”àãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àNQ[àH»[Ÿ[NàìNW”USW—VTñW–SQ”ìQSïãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àLL[àH»[Ÿ[NàìLL”PTí—U‘ëQ“SQW—VSëQãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àMQ[àH»[Ÿ[NàìMW‘ëPSVëQ’î◊“STQQãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àLLQ[àH»[Ÿ[NàìLLW—UíQSê—W—ïT“S”àãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àLLë[àH»[Ÿ[NàìLLó––SëQUW“Të—UW—–UHãõ›ô[ò[òŸNàëSàã›]\ŒàëêRSã\úõ‹éà\úì\Ÿ»N¬àBàBÇàÀ»›\ìLL›ÿ\à
åçãLLM
NàLLX\öŸ]ôY⁄[YHõ›»ëQëTî»H[ã\€›\òŸYàÀ»LL
€‹ö‹»õ‹àíQïK–êSí”íQïK‘—Sî—VöXHSó‘‘’“T’‘ñJH⁄[à]àÀ»ô]\õôY›]\»ì“»à8†%ô\öYöYYöY[Yõ‹ãYöY[€€\]XõH⁄]⁄]BàÀ»úõ€ù[ôLLÿ\ôX›X[HôXY»
ôY⁄[YKò›\úô[ùôY⁄[YK‹›ùX›\ò[öX\À¬àÀ»ò[ú⁄][€ã]T]X[]JKàòZ[»€‹ŸY»H‹öY⁄[ò[⁄]HLLYà[â‹¬àÀ»\»Z\‹⁄[ôÀ⁄[ú›YôöX⁄Y[ù€»õ›[ô»úôXZ‹»Yà[à]H\€â›ôXYHY]Çà€€ú›LLö[X\ûHH
[ê€€ôöY›\ôY	âàLL[à	âàLL[ãú›]\»OOHì“»äH»LL[ààLL¬à€€ú›LLö[X\ûTõ›ô[ò[òŸHH
[ê€€ôöY›\ôY	âàLL[à	âàLL[ãú›]\»OOHì“»äH»ëSàààí“UHé¬Çàô]\õàÀöú€€ä¬à\ò⁄]X›\ôTõ€NàïêQSPó‘T—W–ó–Q—‘ëQ–U‘àãàŸ[ô\ò]Y]àô]»]J
Kù“T”‘›ö[ô 
Kà€ò\⁄›Yà	‹ﬁ[Xõ€KI—]Kõõ› 
_KI”X]úò[ô€J
Kù‘›ö[ô ÕäKú€XŸJã
_Xàﬁ[Xõ€àôXY€õNàùYKà[ê€€ôöY›\ôYà[ìõ‹õX[^ôYààLLX\öŸ]ôY⁄[YNàLLö[X\ûKàLLX\öŸ]ôY⁄[YTõ›ô[ò[òŸNàLLö[X\ûTõ›ô[ò[òŸKàLLQ]öY[òŸQù\⁄[€éàLLKàLLêÿ[ôY]TŸ]àLLãà‹ôYZ—[ô⁄[ôKà[ùûT]X[]Kàù]\ô\’ùÿ\öX\‘õ›ô[ò[òŸKàLí]î⁄Ÿ]—[éàLë[ãàL“]ï\õT›ùX›\ôQ[éàL—[ãàMö^ôY⁄[YQ[éàM[ãàNõ€›ô\ìZY‹ò][€ë[éàN[ãàNS][Q^\ûP[Y€õY[ù[éàNQ[ãàLLX\öŸ]ôY⁄[YQ[éàLL[ãàMTôX[^ôYú“[\YY[éàMQ[ãàLLQ]öY[òŸQù\⁄[€ë[éàLLQ[ãàLLêÿ[ôY]TŸ][éàLLë[ãàL[MõM‘õ›ô[ò[òŸKàõ›NàìLã”LÀ”M”MK”N”NK”LL”LLK”LLà\ôHSà”ìH
ŸYHH
ë[àöY[ KàLK”Mã”M»\ôHSàõ‹àíQïK–êSí”íQïH[ô“UHõ‹à—Sî—V
ŸYHL[MõM‘õ›ô[ò[òŸJH8†%ÿ[YH[ôXYKY^\›[ô»ãåHõŸX›[€àõ›]\ãù\›õ›»€ô\›HXô[YàLLêÿ[ôY]TŸ]
⁄]JH\»›[HõŸX›[€àÿ[ôY]HŸ]»LLêÿ[ôY]TŸ][à\»Hô]»€ô\›[àY\]Z]ò[[ùÿ]H
åçãLLL Kù[õö[ô»[à\ò[[õ‹à€€\\ö\€€à8†%ì’Y]õ€[›Y»ô\XŸHH⁄]H][ôH[ô⁄[ù]Ÿ[à›[ô\]Z\ô\»H⁄]HŸ\‹⁄[€à
ŸYHŸ]Ÿ\‹⁄[€àÿ]HXõ›ôJHõ‹à]ôX\€€ãàòYSXà\ŸH»LLà›Xã\›\»KMH\ôHõ›»[€€\]N»ô[[›ö[ô»H⁄]HŸ\‹⁄[€àÿ]Húõ€H\»[ô⁄[ù\»Hô^[ôö[ò[\ŸH»›\[Xô\ò][HYô\úôY»]»›€àŸ\‹⁄[€ãàãàJN¬üJN¬ÇãÀ»åçãLLå
ŸYZ»K‹›‹ôT‘S\ú⁄\›[òŸJNàù[ú»€òŸH]õ€›ôYõ‹ôHBãÀ»Ÿ\ùô\à›\ù»XÿŸ\[ô»òYôöX»[ôôYõ‹ôH[ûHôX€‹ô\ã’[Y‹ò[BãÀ»[ù\ùò[ö\ô\Ààô\›‹ô\»—VI‹»[ôXYK\ôX€‹ôY›]Húõ€H‹›‹ô\»€¬ãÀ»HòZ[ÿ^HôY\ﬁH‹à‹ò\⁄ZYY^Hõ»€ôŸ\à⁄[[ùH⁄\\»]KHBãÀ»^X›ÿ\ÿ\\ôTôX€‹ô\î€ò\⁄›	‹»›€à€€[Y[ù\ŸY»õY»
õõ¬ãÀ»]Xò\ŸHY]»[›ôH]»äKàYàUPêT—W’Tì\€â›Ÿ]‹àHà\¬ãÀ»[úôXX⁄XõK‹àô\›‹ôHòZ[»õ‹à[ûHôX\€€ã\»\»H\ôHõÀ[‹[ôãÀ»H\›\ù»^X›H\»][ÿ^\»Y
[\H[ã[Y[[‹ûH›]JHKHŸYBãÀ»ãù…‹»›€à€€[Y[ùõ‹àHX]⁄[ô»\ôÿYô]Hù[H€à]⁄YKÇò\ﬁ[ò»ù[ò›[€àô\›‹ôT\ú⁄\›Y›]J
Nàõ€Z\ŸOõ⁄Yà¬à]ÿZ]í[ö]

N¬àõ⁄Y[ú›\ôRQ\ö]ôYÿ⁄[XJ
Kòÿ]⁄

\úäHOà€€ú€€Kô\úõ‹äñ“WH\ö]ôYÿ⁄[XH[ö]òZ[Y
]ôH][òYôôX›Y
Nàã\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà\úäJN¬àYà
Yí\–€€ôöY›\ôY

JHô]\õé¬àûH¬à€€ú›Ÿ^HH[ôXUòY[ô—]J
N¬à€€ú›\›]SŸàH
\€Œà›ö[ô Nà›ö[ô»Oà¬àûH¬àô]\õàô]»]Jô]»]J\€ Kù”ÿÿ[T›ö[ô ô[ãUT»ã»[YVõ€ôNàê\⁄XK“€€ÿ]HàJJKù“T”‘›ö[ô 
Kú€XŸJL
N¬àHÿ]⁄¬àô]\õààé¬àBàN¬ÇàÀ»õ›\õò[[ùöY\»KHÿ[YKY^H€õKà[à€^I‹»[ùöY\»€›[ŸYYàÀ»\ö]ôTõ€[ô’ô\ôX›ÿ€€Xö[ôUô\ôX›»⁄]‹õ‹‹ÀY^H]H‹ŸBàÀ»ù[ò›[€ú»Ÿ\ôHô]ô\à\⁄Y€ôY»ŸYKÇà€€ú›õ›\õò[õ›‹»H]ÿZ]ìÿYôXŸ[ùõ›\õò[[ùûOäöõ›\õò[Ÿ[ùûHãì’TìêS”PV—SïíQT N¬à€€ú›Ÿ^\“õ›\õò[Hõ›\õò[õ›‹Àôö[\ä
JHOà\›]SŸäKù[Y\›[\
HOOHŸ^JN¬àõ›\õò[[ùöY\Àú\⁄
ããùŸ^\“õ›\õò[
N¬àYà
Ÿ^\“õ›\õò[õ[ô›à
H€€ú€€KõŸ —óHô\›‹ôY	›Ÿ^\“õ›\õò[õ[ô›Hõ›\õò[[ùöY\»õ‹à	›Ÿ^_X
N¬ÇàÀ»ôX€‹ô\à€ò\⁄›»KHÿ[YKY^H€õK[ôô\›‹ôYëQì‘ëBàÀ»ÿ\\ôTôX€‹ô\î€ò\⁄›

H]ô\àù[ú»\»õ€›à]ù[ò›[€àô\Ÿ]¬àÀ»ôX€‹ô\îŸ\‹⁄[€à»[\H⁄[ô]ô\àôX€‹ô\îŸ\‹⁄[€ãùòY[ô—]HOOBàÀ»Ÿ^HKH€àHúô\⁄õ€›òY[ô—]H›\ù»\»àã€»⁄]›]\¬àÀ»ô\›‹ôH]»ô\ûHö\ú›ÿ[€à[à[ùòKY^Hô\›\ù€›[⁄[[ùBàÀ»\ÿÿ\ô]ô\û][ô»[ôXYHôX€‹ôYŸ^KÇà€€ú›€ò\⁄›õ›‹»H]ÿZ]ìÿYôXŸ[ùôX€‹ô\î€ò\⁄›äúôX€‹ô\ó‹€ò\⁄›ãëP”‘ëTó”PV‘”êT“’ N¬à€€ú›Ÿ^\‘€ò\⁄›»H€ò\⁄›õ›‹Àôö[\ä
 HOà\›]SŸäÀòòX⁄Ÿ[ô[Y\›[\
HOOHŸ^JN¬àYà
Ÿ^\‘€ò\⁄›Àõ[ô›à
H¬àôX€‹ô\îŸ\‹⁄[€àH¬àòY[ô—]NàŸ^Kà›]\ŒàîëP”‘ëSë»ãà›\ùY]àŸ^\‘€ò\⁄›÷ÃKòòX⁄Ÿ[ô[Y\›[\à\›€ò\⁄›]àŸ^\‘€ò\⁄›÷›Ÿ^\‘€ò\⁄›Àõ[ô›HWKòòX⁄Ÿ[ô[Y\›[\à€ò\⁄›ŒàŸ^\‘€ò\⁄›Àà\›\úõ‹îôYX›Yàù[àN¬à€€ú€€KõŸ —óHô\›‹ôY	›Ÿ^\‘€ò\⁄›Àõ[ô›HôX€‹ô\à€ò\⁄›»õ‹à	›Ÿ^_X
N¬àBÇàÀ»õ€›ô\à\›‹ûHKH€ôH⁄\ôYàö⁄[ôàX‹õ‹‹»[»ﬁ[Xõ€Œ»‹]àÀ»òX⁄»›]\àﬁ[Xõ€[ôÿ[YKY^KYö[\ôYõ‹àHÿ[YHôX\€€à\»Xõ›ôKÇà€€ú›õ€›ô\îõ›‹»H]ÿZ]ìÿYôXŸ[ùåîõ€›ô\î€ò\⁄›äúõ€›ô\ó‹€ò\⁄›ãëP”‘ëTó”PV‘”êT“’»
à N¬à€€ú›Ÿ^\‘õ€›ô\àHõ€›ô\îõ›‹Àôö[\ä
äHOà\›]SŸäãù[Y\›[\
HOOHŸ^JN¬à]ô\›‹ôYõ€›ô\ê€›[ùH¬àõ‹à
€€ú›€ò\ŸàŸ^\‘õ€›ô\äH¬àYà
€ò\úﬁ[Xõ€	âàåîõ€›ô\í\›‹ûV‹€ò\úﬁ[Xõ€JH¬àåîõ€›ô\í\›‹ûV‹€ò\úﬁ[Xõ€Kú\⁄
€ò\
N¬àô\›‹ôYõ€›ô\ê€›[ù
 Œ¬àBàBàYà
ô\›‹ôYõ€›ô\ê€›[ùà
H€€ú€€KõŸ —óHô\›‹ôY	‹ô\›‹ôYõ€›ô\ê€›[ùHõ€›ô\à€ò\⁄›»õ‹à	›Ÿ^_X
N¬ÇàÀ»íRK—RH[ùöY\»KH[Xô\ò][H‘ì‘‘ÀQVH
Hõ€[ô»X[ùX[ŸÀõ›àÀ»Hÿ[YKY^HôYYZŸHHôYHXõ›ôJK€»õ»]Hö[\ãàŸY\€õBàÀ»HUT’õ›»\à]H[àÿ\ŸH[à\Ÿ\ùÿ\»ÿ]ôY[‹ôH[à€òŸBàÀ»X‹õ‹‹»ô\›\ùÀX]⁄[ô»H\	‹»›€à\Ÿ\ùXûKY]HôZ]ö[‹ãÇà€€ú›öZQZTõ›‹»H]ÿZ]ìÿYôXŸ[ùöZQZQ[ùûOäôöZWŸZWŸ[ùûHãíRW—RW”PV—SïíQT»
à N¬à€€ú›ûQ]HHô]»X\›ö[ôÀöZQZQ[ùûOä
N¬àõ‹à
€€ú›HŸàöZQZTõ›‹ HûQ]KúŸ]
Kô]KJN»À»õ›‹»\úö]ôH€\›Yö\ú›KH\›‹ö]H⁄[ú»\à]Bà€€ú›Y\YöZQZHHÀããòûQ]Kùò[Y\ 
WKú€‹ù

KäHOàKô]Kõÿÿ[P€€\\ôJãô]JJKú€XŸJQíRW—RW”PV—SïíQT N¬àöZQZQ[ùöY\Àú\⁄
ããôY\YöZQZJN¬àYà
Y\YöZQZKõ[ô›à
H€€ú€€KõŸ —óHô\›‹ôY	ŸY\YöZQZKõ[ô›HíRK—RH[ùöY\ÿ
N¬àHÿ]⁄
\úäH¬àÀ»ìÿYôXŸ[ù

H]Ÿ[àÿ[õõ›õ›»
ŸYHãù HKH\»›X\ô»€õBàÀ»Hö[\ö[ôÀÿ\‹⁄Y€õY[ùŸ⁄X»Xõ›ôK€»HùY»\ôH›[ÿ[â›àÀ»õÿ⁄»õ€›àò[»òX⁄»»›\ù[ô»[\Kÿ[YH\»ôYõ‹ôH\¬àÀ»ôX]\ôH^\›YÇà€€ú€€Kô\úõ‹äñ—óHô\›‹ôK[€ãXõ€›òZ[YKH›\ù[ô»⁄][\H[ã[Y[[‹ûH›]Nàã\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà\úäN¬àBüBÇöYà
õÿŸ\‹Àô[ùãìì—W—SïàOOHù\›äH¬àõ⁄Yô\›‹ôT\ú⁄\›Y›]J
Kôö[ò[J

HOà¬àŸ\ùôJ»ô]⁄à\ôô]⁄‹ùà‘ïK
[ôõ HOà¬à€€ú€€KõŸ ‘—TïëTóH‹[€î[›õ»\›[ö[ô»€à‹ù	⁄[ôõÀú‹ùX
N¬àJN¬àJN¬ÇàÀ»åçãLLNà›]\àX⁄»Y⁄[ôYúõ€H”êT“’’”T»
»Z[äH»Ã»€¬àÀ»HY\]ôHK[Z[àò\›]⁄[ô›»ô\⁄€ô[›»\»X›X[HôXX⁄XõHKBàÀ»HÀ[Z[à›]\àX⁄»€›[ô]ô\àôYúô\⁄[‹ôHŸù[à[à]ô\ûH»Z[àõ¬àÀ»X]\à⁄]ô\⁄€\»€‹€€\]Y[ú⁄YH]ÇàŸ][ù\ùò[


HOà¬à€€ú›YôôX›]ôUHŸ]Y\]ôT€ò\⁄›\ 
N¬àõ‹à
€€ú›‹Ÿ\‹⁄[€íYŸ\‹⁄[€óHŸàŸ\‹⁄[€ú H¬àYà
]Kõõ› 
HèHŸ\‹⁄[€ãô^\ô\–]
H¬àŸ\‹⁄[€úÀô[]JŸ\‹⁄[€íY
N¬à€€ù[ùYN¬àBàYà
\Ÿ\‹⁄[€ãú€ò\⁄›[YH]Kõõ› 
HHŸ\‹⁄[€ãú€ò\⁄›[YHèHYôôX›]ôU
H¬àõ⁄YôYúô\⁄X\öŸ]€ò\⁄›
Ÿ\‹⁄[€äKòÿ]⁄

\úäHOà¬à€€ú€€Kô\úõ‹äàñ–êP“—‘ì’SëHX\öŸ]ôYúô\⁄òZ[Yàãà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà\úÇà
N¬àJN¬àBàBàKÃ
àL
N¬üBÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBãÀ»—ëìSëHëT—PTê“S—SH8†%KVQPTàT’‘íP–SêP“’T’
»‘ëQ—Sà‘ëQR‘»êQ¬ãÀ»YYåçãLLMãà’íP’T””US”à””ïêP’
ôXY\»ôYõ‹ôH›X⁄[ô NÇãÀ¬ãÀ»KàT””UQì’UTà8†%]ô\ûHõ›]H\ôH]ô\»[ô\àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ ÇãÀ»€à]»›€à€õ»›Xã\õ›]\à
Ÿôõ[ôTô\ŸX\ò⁄õ›]\äK[›[ùY€ù»BãÀ»XZ[à\öXH\úõ›]J
Kà]⁄\ô\»HõÿŸ\‹»ù]õ›Hõ›]BãÀ»XõH⁄][ûHõŸX›[€à[ô⁄[ù
ÿ\KŸ]Kÿ\K›òY[XããÀ»ÿ\K⁄⁄]K ãÿ\KÿXÿ€›[ù ãÿ\K‹ô\ŸX\ò⁄ à]ÀäH8†%õ›[ô»\ôBãÀ»›ô\ù‹ö]\»‹à‹ò\»[à^\›[ô»[ô\ãÇãÀ»ãàëTì»‘ëTàVP’US”àíT“»8†%\»ö[H[\‹ù»”ìHÿ[–Yò[òŸY‹ôYZ‹ÀãÀ»ÿ[—‹ôYZ‹Àõ‹õPŸã€õ‹õTà
\ôHX][ôXYH\ŸY[Ÿ]⁄\ôH[à\¬ãÀ»ö[Hõ‹àôXY[€õH\‹^JH[ôõŸI‹»úÀ‹]
[€»[ôXYH[\‹ùYãÀ»Xõ›ôHõ‹àŸ\‹⁄[€à\ú⁄\›[òŸJKà]Ÿ\»ì’[\‹ùÿ[‹àôYô\ô[òŸBãÀ»[ûH⁄]K—[à‹ô\ã\XŸ[Y[ùù[ò›[€ãà‹ô\X⁄X⁄ÿXõHòX›à\¬ãÀ»[ù\ôH€ŸXò\ŸH\»ô\õ»XŸS‹ô\ã€‹ô\ãY^X›][€àù[ò›[€ú»¬ãÀ»ôY⁄[à⁄]
ŸYHH\⁄õÿ\ô	‹»›€àõ€›\éàîôXY[€õHX⁄\⁄[€ÇãÀ»›\‹ùàõ›[à‹ô\ã\XŸ[Y[ùﬁ\›[KàäH8†%€»\ôH\»õ›[ô»õ‹ÇãÀ»\»[Ÿ[H»Xÿ⁄Y[ù[HöYŸŸ\à]ô[à[àö[ò⁄\KÇãÀ»Ààì”ãPì–““Së»VP’US”à8†%HòZ]ôHõ‹ò€‹›ô\àHYX\àŸà[ùòY^BãÀ»õX⁄ÀTÿ⁄€\ÀŸ‹ôYZ‹»€€\]][€ú»
[ú»Ÿà›\ÿ[ô»Ÿà]\ò][€ú BãÀ»”’Sõÿ⁄»õŸI‹»⁄[ô€H]ô[ù[€‹ôXY]ô[à[ú⁄YH[à\ﬁ[òÿãÀ»ù[ò›[€ãôXÿ]\ŸH\ﬁ[òÿ[€ôHŸ\»õ›ZY[€€ùõ€8†%€õH[ÇãÀ»X›X[]ÿZ]Ÿ\Àà€»HòX⁄›\›€‹ô[›»\»⁄[öŸYà]ãÀ»õÿŸ\‹Ÿ\»Hõ›[ôYò]⁄[à]ÿZ]»HŸ][[YYX]XX⁄»ôYõ‹ôBãÀ»Hô^ò]⁄[ô[ô»€€ùõ€òX⁄»»H]ô[ù€‹€»]ôBãÀ»ÿ\KŸ]Kÿ\K›òY[Xãÿ\KÿXÿ€›[ù à€[ô»ô\]Y\›»\ôHŸ\ùôYãÀ»[àô]ŸY[àò]⁄\»⁄]õ»YY][òﬁKàHõ›]H[ô\à]Ÿ[ÇãÀ»ô]\õú»HõÿíY[[YYX][H
åäH[ôŸ\»H€‹ö»[àBãÀ»ö\ôKX[ôYõ‹ôŸ]òX⁄Ÿ‹õ›[ô\⁄»8†%ÿ[\ú»€õ‹à›]\À‹ô\›[ÇãÀ»àTîì‘à””ïRSìQSï8†%]ô\ûH\›‹öXÿ[ôX€‹ô\»õÿŸ\‹ŸY[ú⁄YH]¬ãÀ»›€àûKÿÿ]⁄€»€ôHX[õ‹õYYõ›»
òY‹›“Uã—JHX\ö‹»]õ›¬ãÀ»êRSQ[ô[›ô\»€à[ú›XYŸàXõ‹ù[ô»H⁄€Hõÿãà]ô\ûHõ›]BãÀ»[ô\à\»‹ò\Y[à[à›]\àûKÿÿ]⁄][ÿ^\»ô]\õú»î””ÇãÀ»
ô]ô\àõ›‹»\›€õ K€»H\úŸH\úõ‹à‹àôX›‹ãY[Y[ú⁄[€ÇãÀ»Z\€X]⁄[àHêQ»]Y\ûH]ÿ[àô]ô\à‹ò\⁄HŸ\ùô\àõÿŸ\‹ÀÇãÀ»OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOBÇãÀ»KKKH\\»KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKBÇã äà€ôHõ›»Ÿà\›‹öXÿ[[ôXYK\ôX€‹ôYX\öŸ]]KàôXY[€õH[ú]8†%à
àô]ô\à]]]Yô]ô\à‹ö][àòX⁄»»Húõ⁄Ÿ\ãà
ã¬ö[ù\ôòXŸH\›‹öXÿ[‹ôYZ‹‘ôX€‹ô¬à äàT”»]K›[YHŸà\»\›‹öXÿ[ÿúŸ\ùò][€ãKôÀàååçKLLMUNååå
ÃNåÃà
ã¬à[Y\›[\à›ö[ôŒ¬àﬁ[Xõ€àìíQïHàêêSí”íQïHàî—Sî—Và›ö[ôŒ¬à‹›àù[Xô\é¬à›öZŸNàù[Xô\é¬à]î\òŸ[ùàù[Xô\é¬à^\’—^\ûNàù[Xô\é¬à\–ÿ[àõ€€X[é¬à äà‹[€ò[à⁄]X›X[H\[ôYô^Yà[›H]ôH]
KôÀàô^Y^Bà
àô[Z][H	K\ŸY€õHõ‹àêQ»ù⁄]\[ôYYù\à⁄[Z[\à‹ôYZ‹»Çà
à€⁄›\»8†%ô]ô\à\ŸY»XŸH‹à⁄^ôHHòYJKà
ã¬àõ‹ùÿ\ô›]€€YOŒà¬àô[Z][P⁄[ôŸT›Œàù[Xô\é¬à‹›⁄[ôŸT›Œàù[Xô\é¬àõ›OŒà›ö[ôŒ¬àN¬ÇàÀ»KKKHYYåçãLLMéà[ú›]][€ò[\›[H€€ù^öY[Àà\ŸHZ\úõ‹ÇàÀ»⁄]õŸô\‹⁄[€ò[‹[€úÀ›õ€\⁄‹»òX⁄»[€ô‹⁄YHò]»‹ôYZ‹»8†%õ›àÀ»[ùô[ùYúõ€Hÿ‹ò]⁄ù]›[ô\ôŸ[Z€õ›€àY]öX‹»
“Hõ›ÀàÀ»ôX[^ôY]úÀZ[\YYõ€^X›Y]úÀXX›X[[›ôKX[\àÿ[[XBàÀ»^‹›\ôJKà[‹[€ò[€»HZ[àX[ùX[Rî””àÿòX⁄›\›‹ù[à]àÀ»ŸY\»€‹ö⁄[ô»[ò⁄[ôŸYYàHÿ[\àŸ\€â››\H[KàKKKBÇà äàŸ^I‹»‹[à[ù\ô\›õ‹à\»‹X⁄YöX»€€ùòX›
[ã[ò]]ôK⁄[Çà
àH[ôŸ\›[€à]ô\]Y\›Y]8†%ŸYH⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[
Kà
ã¬à⁄OŒàù[Xô\é¬à äàô]ö[›\»òY[ô»^I‹»“Hõ‹àHÿ[YH€€ùòX›8†%]»HòX⁄›\›à
à€\‹⁄YûH“Hõ›»
ïRST’Sï“SëSë HHÿ[YHÿ^H[ú›]][€ò[\⁄‹¬à
àôXYöXŸJ”“HŸŸ]\ãõ›“H[€ôKà
ã¬à⁄Tô]ë^OŒàù[Xô\é¬à äàòZ[[ôÀLå]òY[ôÀY^H[õùX[^ôYôX[^ôYõ€][]HŸàBà
àSëTìRSë»
\ö⁄[ú€€àY⁄[›»\›[X]‹à8†%ç^[‹ôHÿ[\KYYôöX⁄Y[ùà
à[à€‹ŸK]ÀX€‹ŸHõ‹àHÿ[YH⁄[ô›À›[ô\ô€àõ€\⁄‹ Kà
à^ô\‹ŸY\»H\òŸ[ù»ôH\ôX›H€€\\òXõH»]î\òŸ[ùà
ã¬àôX[^ôYõ€›Œàù[Xô\é¬à äàH[ô\õZ[ô…‹»X›X[‹›öXŸH€àH^HôX\ô\›»\¬à
à€€ùòX›	‹»^\ûH⁄][àH[ôŸ\›Y⁄[ô›»
X^HôHXúŸ[ùõ‹àõ›‹¬à
à€»€‹ŸH»H[ôŸ\›[€à⁄[ô›…‹»[ô»ŸYHõ‹ùÿ\ô
Kà\ŸY¬à
à€€\]H›»]X⁄HX\öŸ]X›X[H[›ôYûH^\ûHô\ú›\»⁄]Bà
à‹[€â‹»Uà[\YY]€›[[›ôH8†%H›[ô\ôùÿ\»UàöX⁄‹Çà
à⁄X\[à[ô⁄Y⁄à[ú›]][€ò[⁄X⁄Àà
ã¬àõ‹ùÿ\ô‹›]^\ûOŒàù[Xô\é¬üBÇö[ù\ôòXŸHòX⁄›\›õ›‘ô\›[¬à[Y\›[\à›ö[ôŒ¬àﬁ[Xõ€à›ö[ôŒ¬à›öZŸNàù[Xô\é¬à\–ÿ[àõ€€X[é¬à›]\Œàì“»àëêRSQé¬à\úõ‹èŒà›ö[ôŒ¬àYò[òŸY‹ôYZ‹œŒàô]\õï\O\[Ÿàÿ[–Yò[òŸY‹ôYZ‹œé¬à äàÿ[YH’PìK’–U“’Sî’PìH€\‹⁄YöXÿ][€àH]ôHêYò[òŸY‹ôYZ‹¬à
àô\ôX›à\⁄õÿ\ôÿ\ô\Ÿ\»
»KLà» »ö\⁄À\›[HõY‹ K€€\]Yà
à[ô\[ô[ùH\ôH8†%\»[Ÿ[Hô]ô\àÿ[»ÿ[›[]Pù^TõÿòXö[]Bà
à‹à›X⁄\»H]ôHLLàÿ[ôY]K\Ÿ[X›[€à]à
ã¬àô\ôX›Œàî’PìHàï–U“àïSî’PìHé¬àõY‹œŒà›ö[ô÷◊N¬à äàÿ\úöYYõ›Y⁄úõ€HH€›\òŸHôX€‹ô€»ÿòX⁄›\›‹›[[X\ûKŒöõÿíYÿ[Çà
àùX⁄Ÿ]ô\ôX›»ûHõﬁ[Z]H»^\ûH
KôÀàôŸ\»[ú›Xö[]H€\›\Çà
à[àH\›KLà^\»ôYõ‹ôH^\ûO»äH⁄]›]ôKYô]⁄[ô»[û][ôÀà
ã¬à^\’—^\ûQõ‹î›[[X\ûOŒàù[Xô\é¬ÇàÀ»KKKH[ú›]][€ò[\›[H\ö]ôYY]öX‹»
åçãLLMäH8†%€€\]Y\ôKàÀ»€òŸKúõ€HH\›‹öXÿ[‹ôYZ‹‘ôX€‹ô	‹»ò]»⁄K‹ôX[^ôYõ€›¬àÀ»õ‹ùÿ\ô‹›]^\ûH[ú]À€»]ô\ûH€€ú›[Y\à
›[[X\ûH[ô⁄[ùêQ¬àÀ»X]⁄\Àò]»ô\›[î””äHŸY\»Hÿ[YHù[Xô\úÀàKKKBÇà⁄OŒàù[Xô\é¬à⁄P⁄[ôŸT›Œàù[Xô\é¬à äà⁄[\H“KYõ›»ôXYÿ[YH‹\ö]\»\»€ŸXò\ŸI‹»^\›[ô¬à
àåì⁄PYŸ‹ôYÿ]T›]H€\‹⁄YöXÿ][€à[Ÿ]⁄\ôH
öXŸJ”“HŸŸ]\à\¬à
à⁄]\⁄‹»X›X[Hÿ]⁄8†%\»[Ÿ[HôXY»][ô\[ô[ùK]à
àŸ\»õ›ÿ[[ù»]]ôK\][ù[K€Ÿ⁄X Kà
ã¬à⁄T›]OŒàêïRSTàïSï“SëSë»àëìUàíSî’QëíP“QSï“T’‘ñHé¬à äà[ô\õZ[ô…‹»òZ[[ô»ôX[^ôYõ€
\ö⁄[ú€€äKõ‹à\ôX›€€\\ö\€€Çà
àYÿZ[ú›\»õ›…‹»›€à]î\òŸ[ùà
ã¬àôX[^ôYõ€›Œàù[Xô\é¬à äà]î\òŸ[ùHôX[^ôYõ€›à‹⁄]]ôHHUàöX⁄\à[àôXŸ[ùôX[^ôYà
à[›ô[Y[ù
€\‹⁄X»õ€\Ÿ[[ô»Ÿ]\
N»ôYÿ]]ôHHUà⁄X\ô[]]ôH¬à
àôX[^ôY
€\‹⁄X»õ€Xù^Z[ô»Ÿ]\
Kà\»\»H€‹ôHùõ€][]Bà
àö\⁄»ô[Z][Hàù[Xô\àõŸô\‹⁄[€ò[õ€\⁄‹»òX⁄Àà
ã¬à]ìZ[ù\‘ùî›Œàù[Xô\é¬à äàH‹[€â‹»›€àK\⁄Y€XH[\YY[›ôH»^\ûK\»	HŸà‹›Çà
à]î\òŸ[ù
à‹\ù
^\’—^\ûH»ÕçJKà
ã¬à[\YY[›ôT›Œàù[Xô\é¬à äà⁄]H[ô\õZ[ô»P’PSH[›ôY
Xú€€]H	JHûHH[YH\¬à
à€€ùòX›	‹»^\ûH\úö]ôY⁄[à]]Hò[»[ú⁄YHH[ôŸ\›Yà
à⁄[ô›Àà€€\\ôH\ôX›H»[\YY[›ôT›à
ã¬àôX[^ôY[›ôU—^\ûT›Œàù[Xô\é¬à äàôX[^ôY[›ôU—^\ûT›»[\YY[›ôT›àåHHHX\öŸ][›ôYS‘ëBà
à[à‹[€ú»öXŸY[à
‹[€ú»Ÿ\ôH⁄X\[à[ô⁄Y⁄
N»HHBà
àX\öŸ][›ôYT‘»
‹[€ú»Ÿ\ôHöX⁄[à[ô⁄Y⁄Xÿ^HZŸ[H€€äKÇà
à\»\»H⁄[ô€Hù[Xô\à][»[›H⁄]\àH‹ôYZ‹ÀYö]ô[Çà
àô\ôX›€à\»^H€⁄[ò⁄YY⁄][àõ‹[€ú»Ÿ\ôHZ\‹öXŸYÇà
à\ö[Ÿ8†%ù[⁄[àôX[^ôY[›ôU—^\ûT›\€â›]òZ[XõHY]à
ã¬à[›ôTò][œŒàù[Xô\é¬à äà⁄[\YöYYSî“Q”ëQõ›[€ò[ÿ[[XKY^‹›\ôHõﬁHõ‹à\»€ôBà
à€€ùòX›à⁄H
àÿ[[XH
à›⁄^ôH
à‹›åà
àåH
€\ãYÿ[[XK\\ãLIKBà
à[›ôH€€ùô[ù[€à\ŸYûH\⁄‹»ZŸH‹›ÿ[[XJKà[Xô\ò][Hõ›à
à⁄Y€ôYŸX[\ãX]öXù]Y8†%\»[Ÿ[H\»õ»ÿ^H»€õ›»⁄]\àBà
à“H\»›\›€Y\ã[€ô»‹àX\öŸ][XZŸ\ã\⁄‹ù⁄X⁄\»Hÿ[YBà
àŸ[Z€õ›€àÿ]ôX]]ô\ûHô]Z[YòX⁄[ô»—V\›[X]Hÿ\úöY\Àà\ŸYù[à
à€õH\»Hô[]]ôKŸ^K[›ô\ãY^HXY€ö]YKõ›[àXú€€]HX[\Çà
à‹⁄][€ö[ô»ôXYà
ã¬àÿ[[XQ^‹›\ôSõ›[€ò[Œàù[Xô\é¬à äà]\ö\›X»“Q”ëQX[\ãYÿ[[XHõﬁKYYåçãLLMà\à\Ÿ\ã\›\YYà
àô\ŸX\ò⁄‹X»
ôX[\óŸŸ^äKà\Ÿ\»Hÿ[YH›[ô\ôô]Z[YòX⁄[ô¬à
à]\ö\›X»[ú›]][€ò[—V\⁄õÿ\ô»
KôÀà‹›ÿ[[XK\›[JHXõ\⁄Çà
à–S‹[à[ù\ô\›\»\‹›[YYX[\ãT“‘ïYÿ[[XH
›\›€Y\ú»ô]ù^Bà
àÿ[ÀX[\ú»\ôHH€›[ù\ú\ùJH€»]€€ùöXù]\»HëQ–UUëH⁄Y€é¬à
àU‹[à[ù\ô\›\»\‹›[YYX[\ãS”ëÀYÿ[[XH€»]€€ùöXù]\»Bà
à‘“UUëH⁄Y€ãàT»T»SàT‘’STS”ãì’HQPT’TëSQSï8†%[â‹»]Bà
à
ZŸH]ô\ûHXõX»‹[€úÀX⁄Z[àôYY
HŸ\»õ›^‹ŸHX›X[X[\Çà
à‹⁄][€ö[ôÀ€»ôX]\»\»H€€[[€õK]\ŸY[ô\›ûHõﬁKõ›à
àô\öYöYYòX›àXY€ö]YH\»Y[ùXÿ[»ÿ[[XQ^‹›\ôSõ›[€ò[Xõ›ôN¬à
à€õHH⁄Y€àYôô\úÀà
ã¬à]\ö\›X—X[\ëŸ^õ›[€ò[Œàù[Xô\é¬ÇàÀ»KKKH›]€€YK]YYöY[»
åçãLLMäH8†%ù⁄]X›X[H\[ôYô^ÇàÀ»õ‹àT»€€ùòX›
ÿ[YHﬁ[Xõ€
‹›öZŸJ⁄\–ÿ[
K€€\]YûHH‹›\\‹¬àÀ»›ô\àH€‹ùYŸ\öY\»€òŸHH⁄€Hõÿà\»€ôKà\»\»⁄]\õú¬àÀ»HòX⁄›\›úõ€H\ô[HT–‘íTUëH
⁄[àŸ\»[ú›Xö[]H\[äBàÀ»[ù»’U””QKUQQ
YHô\ôX›€à^Hà€⁄[ò⁄YH⁄]HôX[àÀ»[›ôHH^HYù\äH8†%H€»\ôHõ›Hÿ[YH€Z[K[ô€õHBàÀ»ŸX€€ô€ôH[»[›HHô\ôX›\»€‹ùôXX›[ô»Ààô[Z][H\ôBàÀ»\»[‹ô]Xÿ[ô[Z][H
ÿ[–Yò[òŸY‹ôYZ‹…»›€àôK\öX⁄[ô»]]àÀ»^I‹»‹›“Uã—JHò]\à[àHò]»][›Yô[Z][H8†%⁄[òŸHUàÿ\¬àÀ»]Ÿ[à[\YYîì”HHò]»ô[Z][H][ôŸ\›[€à[YK[‹ô]Xÿ[ô[Z][BàÀ»òX⁄‹»HôX[][›Yô[Z][H€‹Ÿ[HûH€€ú›ùX›[€ã€»\»\»BàÀ»Y⁄][X]H›[ôZ[à⁄]›]ôYY[ô»»Ÿ\\ò][Hô]Z[àò]»][›\Àà
ã¬àô^ÿúŸ\ùò][€ï[Y\›[\Œà›ö[ôŒ¬à äà	H⁄[ôŸH[à[‹ô]Xÿ[ô[Z][Húõ€H\»õ›»»Hô^ÿ[YKX€€ùòX›à
àÿúŸ\ùò][€ãà‹⁄]]ôHHô[Z][H‹ô]»
òYõ‹àH⁄‹ù‹Ÿ[\äKà
ã¬àô^ÿúŸ\ùò][€îô[Z][P⁄[ôŸT›Œàù[Xô\é¬à äà	H⁄[ôŸH[à^ö[ú⁄X’ò[YH
[YHò[YJH8†%H\ôX›]KYXÿ^K]úÀBà
à]ô[ù	ìõﬁHõ‹àH\›]Xÿ[ô[Z][K\Ÿ[\ãà\›X[HôYÿ]]ôBà
à
Xÿ^JH€à]ZY]^\Œ»H⁄\ú‹⁄]]ôH‹ZŸH\ôH€àH^H\¬à
à[Ÿ[HõYŸŸY–U“’Sî’PìH\»^X›HHùHõY»ÿ]Y⁄HôX[à
à]ô[ùà⁄Y€ò]\ôH»€⁄»õ‹ãà
ã¬àô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›Œàù[Xô\é¬üBÇö[ù\ôòXŸHòX⁄›\›õÿà¬àYà›ö[ôŒ¬à›]\ŒàîUQUQQàîïSìíSë»àë”ëHàëêRSQé¬à›[ôX€‹ôŒàù[Xô\é¬àõÿŸ\‹ŸYôX€‹ôŒàù[Xô\é¬à›\ùY]àù[Xô\é¬àö[ö\⁄Y]àù[Xô\àù[¬à\úõ‹éà›ö[ô»ù[¬àô\›[ŒàòX⁄›\›õ›‘ô\›[◊N¬üBÇãÀ»KKKH[ã[Y[[‹ûHõÿà›‹ôH
\€€]Yúõ€H[]ôK]òY[ô»›]JHKKKKKKKKKKBÇò€€ú›Ÿôõ[ôTô\ŸX\ò⁄õÿú»Hô]»X\›ö[ôÀòX⁄›\›õÿèä
N¬ã äà⁄[\H[ã[Y[[‹ûHôX›‹à[ô^ùZ[úõ€H€€\]YòX⁄›\›ù[úÀ\ŸYûBà
àHêQÀ\›[H⁄[Z[\ö]H[ô⁄[ùô[›Ààô]ô\à\ú⁄\›Yô]ô\à⁄\ôYà
à⁄][ûH]ôHX⁄\⁄[€à]à
ã¬ò€€ú›Ÿôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^à»Yà›ö[ôŒ»ôX›‹éàù[Xô\ñ◊N»ôX€‹ôàòX⁄›\›õ›‘ô\›[V◊HH◊N¬Çôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄õÿíY

Nà›ö[ô»¬àô]\õàòù»à
»]Kõõ› 
Kù‘›ö[ô ÕäH
»ó»à
»X]úò[ô€J
Kù‘›ö[ô ÕäKú€XŸJãL
N¬üBÇãÀ»KKKH\ôH\ã\õ›»€\‹⁄YöXÿ][€à
›[ô[€ôH8†%Ÿ\»ì’ÿ[ãÀ»ÿ[›[]Pù^TõÿòXö[]H‹à[û][ô»€àH]ôHLLà]
HKKKKKKKKKKKBÇôù[ò›[€à€\‹⁄YûPYò[òŸY‹ôYZ‹‘õ› àYŒàõ€ìù[XõOô]\õï\O\[Ÿàÿ[–Yò[òŸY‹ôYZ‹œèÇäNà»ô\ôX›àî’PìHàï–U“àïSî’PìHé»õY‹Œà›ö[ô÷◊HH¬à€€ú›õY‹Œà›ö[ô÷◊HH◊N¬àÀ»ô\⁄€»ëP–SPîêUQåçãLLMà
õô\‹Àÿ[YH^JHYÿZ[ú›BàÀ»P’PSò[Y_\òŸ[ù[H\›öXù][€àÿúŸ\ùôYúõ€HHôX[çKÃçKY^BàÀ»[ôŸ\›YòX⁄›\›õÿà
ŸYHÿòX⁄›\›‹›[[X\ûI‹»‹ôYZ‹—\›öXù][€ÇàÀ»öY[
KàH‹öY⁄[ò[õ]ù[Xô\ú»ô[›»
⁄\õHåãò[õòHçKõ€[XBàÀ»åK€€‹àåKõ€[XHKå[[XHKçJHŸ\ôHZ]\à[ö\ö]YàÀ»›Y\‹Ÿ\»‹àZŸ[à\ÀZ\»úõ€HH\Ÿ\â‹»ô\ŸX\ò⁄‹XÀô]ô\à⁄X⁄ŸYàÀ»YÿZ[ú›\»ö[I‹»›€àõX⁄ÀTÿ⁄€\»ÿÿ[[ôÀà€»Ÿ\ôH€€ôö\õYYàÀ»úõ⁄Ÿ[àûH]ôX[]Nà[[XI‹»ô\⁄€
KçJHÿ]ëS’»BàÀ»QQPSàÿúŸ\ùôYò[YH
LååãéJK€»]ö\ôY€àçç…HŸà^\»8†%àÀ»ô[]ò]Yà[àò[YH€õKàò[õòI‹»ô\⁄€
çJHÿ]Pì’ëHHPVSUSBàÀ»ÿúŸ\ùôYò[YH
X^ååMÃ K€»]ô]ô\àö\ôY][à[Ÿ]ô[à\ôBàÀ»õ›»Ÿ]»XX⁄‹ôYZ…‹»›€àL
‹åL	HHŸ[ùZ[ô[H[ù\›X[]àÀ»^Kõ›\Xÿ[
Húõ€H]ÿ[YHôX[]\Ÿ]€»]ô\ûHõY»YX[ú¬àÀ»õ›Y⁄HHÿ[YH[ôŒàù\»\»[àH‹åL	H[‹›^ô[YH^\»õ‹ÇàÀ»\»‹X⁄YöX»‹ôYZÀàõ›ù\Xÿ[Y\Ÿ^Kàà‹YY\»Yù[ò⁄[ôŸY8†%àÀ»]»›€à\›öXù][€à\»[à^ô[YH€ô»Z[
MHååãX^àÀ»ååLL H]€€\Ÿ\»[ô\àãYX⁄[X[õ›[ô[ôÀ€»]	‹»Ÿ\\»BàÀ»‹öY⁄[ò[ò\ôKY]ô[ùô\⁄€
[ôXYHö\ö[ô»€àIHŸà^\À⁄X⁄\¬àÀ»H[ù[ôYôZ]ö[‹àõ‹à]€ôJKàôKY\ö]ôH\ŸHYÿZ[àúõ€HBàÀ»úô\⁄\›öXù][€à€òŸH[‹ôH\›‹ûHXÿ›[][]\»8†%\ŸH\ôHBàÀ»ôX[Y]KZ[ôõ‹õYY›\ù[ô»⁄[ùõ›H\õX[ô[ùHö^Y€€ú›[ùÇàYà
X]òXú YÀò⁄\õJHàåéJHõY‹Àú\⁄
ë[]ò]Y⁄\õH
[HXÿ^Hö\⁄»[ù»^\ûJHäN¬àYà
X]òXú YÀùò[õòJHàåç HõY‹Àú\⁄
ë[]ò]Yò[õòH
[HŸ[ú⁄]]ö]H»Uà⁄Yù HäN¬àYà
X]òXú YÀûõ€[XJHàåççHX]òXú YÀò€€‹äHàåŒ
HõY‹Àú\⁄
ë[]ò]Yõ€[XKÿ€€‹à
ÿ[[XH[ú›Xö[]JHäN¬àYà
YÀú‹YYOOH	âàX]òXú YÀú‹YY
HàåJHõY‹Àú\⁄
ë[]ò]Y‹YY
ÿ[[XH€€ùô^]Hö\⁄ HäN¬àYà
X]òXú YÀùõ€[XJHàãçŒJHõY‹Àú\⁄
ë[]ò]Yõ€[XH
ôYÿH[ú›Xö[]Kô[Z][HŸ[ú⁄]]ôH»ù\ù\àUà[›ô\ HäN¬àYà
X]òXú YÀù[[XJHàLÀçJHõY‹Àú\⁄
ë[]ò]Y[[XH
^ô[YHõ€[Ÿã]õ€Ÿ[ú⁄]]ö]JHäN¬à€€ú›ô\ôX›HõY‹Àõ[ô›OOH»î’PìHààõY‹Àõ[ô›Hà»ï–U“ààïSî’PìHé¬àô]\õà»ô\ôX›õY‹»N¬üBÇôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄ôX]\ôUôX›‹äYŒàõ€ìù[XõOô]\õï\O\[Ÿàÿ[–Yò[òŸY‹ôYZ‹œèã]î\òŸ[ùàù[Xô\ãNàù[Xô\äNàù[Xô\ñ◊H¬àÀ»ö^Y[[ô›ù[Y\öX»ôX]\ôHôX›‹àõ‹à€‹⁄[ôK\⁄[Z[\ö]HŸX\ò⁄ÇàÀ»åçãLLMéàYYõ€[XK›[[XH
LÀY[Kÿ\»LKY[JH8†%[ã[Y[[‹ûH[ô^àÀ»€õKôXùZ[úô\⁄€à]ô\ûHòX⁄›\›ù[ã€»õ»›[K[[ô›ôX›‹ú¬àÀ»]ô\àZ^⁄]\»ô]»⁄\KÇàô]\õàÿYÀô[KYÀôÿ[[XKYÀùôYÿKYÀù]KYÀùò[õòKYÀò⁄\õKYÀú‹YYYÀûõ€[XKYÀò€€‹ãYÀùõ€[XKYÀù[[XK]î\òŸ[ù»LH»ÕçWN¬üBÇôù[ò›[€à€‹⁄[ôT⁄[Z[\ö]JNàù[Xô\ñ◊Kéàù[Xô\ñ◊JNàù[Xô\à¬àYà
Kõ[ô›OOHãõ[ô›Kõ[ô›OOH
Hô]\õà¬à]›HXY–HHXY–àH¬àõ‹à
]HH»HKõ[ô›»J  H¬à›
œHV⁄WH
àñ⁄WN¬àXY–H
œHV⁄WH
àV⁄WN¬àXY–à
œHñ⁄WH
àñ⁄WN¬àBàYà
XY–HOOHXY–àOOH
Hô]\õà¬àô]\õà›»
X]ú‹\ù
XY–JH
àX]ú‹\ù
XY–äJN¬üBÇãÀ»KKKH⁄[öŸYõ€ãXõÿ⁄⁄[ô»òX⁄›\›ù[õô\àKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKBÇò€€ú›—ëìSëW‘ëT—PTê“–êU“‘“VëHHå»À»ZY[»H]ô[ù€‹]ô\ûHàõ›‹¬Çôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄ZY[

Nàõ€Z\ŸOõ⁄Yà¬àô]\õàô]»õ€Z\ŸJ
ô\€€ôJHOàõŸTŸ][[YYX]Jô\€€ôJJN¬üBÇã äà\ö]ô\»H[ú›]][€ò[\›[HY]öX‹»
“Hõ›ÀUãTïà‹ôXY[\YYà
àú»ôX[^ôY[›ôKÿ[[XH^‹›\ôHõﬁJHúõ€HHôX€‹ô	‹»‹[€ò[ò]¬à
à[ú]»
»]»›€à€€\]Y‹ôYZ‹Àà\ôHù[ò›[€ãõ»K”»8†%ÿYôH»ÿ[à
à\ã\õ›»[ú⁄YHHÿ[YH⁄[öŸYﬁZY[[ô»€‹⁄]›]Y[ô»][òﬁKà
ã¬ôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄\ö]ôR[ú›]][€ò[Y]öX‹ àôXŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ôàYŒàõ€ìù[XõOô]\õï\O\[Ÿàÿ[–Yò[òŸY‹ôYZ‹œèÇäNàX⁄œòX⁄›\›õ›‘ô\›[õ⁄Hàõ⁄P⁄[ôŸT›àõ⁄T›]HàúôX[^ôYõ€›àö]ìZ[ù\‘ùî›àö[\YY[›ôT›àúôX[^ôY[›ôU—^\ûT›àõ[›ôTò][»àôÿ[[XQ^‹›\ôSõ›[€ò[àö]\ö\›X—X[\ëŸ^õ›[€ò[èà¬à€€ú››]àô]\õï\O\[ŸàŸôõ[ôTô\ŸX\ò⁄\ö]ôR[ú›]][€ò[Y]öX‹œàHﬂN¬ÇàYà
\[ŸàôXÀõ⁄HOOHõù[Xô\àäH¬à›]õ⁄HHôXÀõ⁄N¬àYà
\[ŸàôXÀõ⁄Tô]ë^HOOHõù[Xô\àà	âàôXÀõ⁄Tô]ë^Hà
H¬à›]õ⁄P⁄[ôŸT›HX]úõ›[ô


ôXÀõ⁄HHôXÀõ⁄Tô]ë^JH»ôXÀõ⁄Tô]ë^JH
àL
H»L¬à›]õ⁄T›]HH›]õ⁄P⁄[ôŸT›àH»êïRSTàà›]õ⁄P⁄[ôŸT›MH»ïSï“SëSë»ààëìUé¬àH[ŸH¬à›]õ⁄T›]HHíSî’QëíP“QSï“T’‘ñHé¬àBà€€ú››⁄^ôHH
Só–””ïêP’”QUQUH\»ôX€‹ô›ö[ôÀ»›⁄^ôNàù[Xô\àOäV‹ôXÀúﬁ[Xõ€OÀõ›⁄^ôN¬àYà
›⁄^ôJH¬àÀ»€\ãYÿ[[XK\\ãLIK[[›ôH€€ùô[ù[€à
3§…H“H
à][\Y\à
àÿ[[XH
à◊åà
àåJKÇàÀ»[ú⁄Y€ôYõﬁH8†%ŸYHHöY[	‹»›€àÿ»€€[Y[ùõ‹à⁄H⁄Y€ãŸX[\ÇàÀ»]öXù][€à\»[Xô\ò][Hõ›€Z[YYÇà›]ôÿ[[XQ^‹›\ôSõ›[€ò[HX]úõ›[ô
ôXÀõ⁄H
à›⁄^ôH
àYÀôÿ[[XH
àôXÀú‹›
àôXÀú‹›
àåJN¬àÀ»]\ö\›X»⁄Y€éà–S“HOà\‹›[YYX[\ã\⁄‹ù
ôYÿ]]ôJKàÀ»U“HOà\‹›[YYX[\ã[€ô»
‹⁄]]ôJKàŸYHöY[ÿ»€€[Y[ùÇà›]ö]\ö\›X—X[\ëŸ^õ›[€ò[HôXÀö\–ÿ[»[›]ôÿ[[XQ^‹›\ôSõ›[€ò[à›]ôÿ[[XQ^‹›\ôSõ›[€ò[¬àBàBÇàYà
\[ŸàôXÀúôX[^ôYõ€›OOHõù[Xô\àäH¬à›]úôX[^ôYõ€›HôXÀúôX[^ôYõ€›¬à›]ö]ìZ[ù\‘ùî›HX]úõ›[ô

ôXÀö]î\òŸ[ùHôXÀúôX[^ôYõ€›
H
àL
H»L¬àBÇà€€ú›[\YY[›ôT›HôXÀö]î\òŸ[ù
àX]ú‹\ù
X]õX^
ôXÀô^\’—^\ûK
H»ÕçJH¬à›]ö[\YY[›ôT›HX]úõ›[ô
[\YY[›ôT›
àL
H»L¬àYà
\[ŸàôXÀôõ‹ùÿ\ô‹›]^\ûHOOHõù[Xô\àà	âàôXÀú‹›à
H¬à€€ú›ôX[^ôY[›ôT›H
X]òXú ôXÀôõ‹ùÿ\ô‹›]^\ûHHôXÀú‹›
H»ôXÀú‹›
H
àL¬à›]úôX[^ôY[›ôU—^\ûT›HX]úõ›[ô
ôX[^ôY[›ôT›
àL
H»L¬àYà
[\YY[›ôT›à
H›]õ[›ôTò][»HX]úõ›[ô

ôX[^ôY[›ôT›»[\YY[›ôT›
H
àL
H»L¬àBÇàô]\õà›]¬üBÇò\ﬁ[ò»ù[ò›[€àù[ìŸôõ[ôTô\ŸX\ò⁄òX⁄›\›
õÿéàòX⁄›\›õÿãôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊JNàõ€Z\ŸOõ⁄Yà¬àõÿãú›]\»HîïSìíSë»é¬àûH¬àõ‹à
]HH»HôX€‹ôÀõ[ô›»J  H¬à€€ú›ôX»HôX€‹ô÷⁄WN¬àûH¬àYà
à\[ŸàôXœÀú‹›OOHõù[Xô\àà\[ŸàôXœÀú›öZŸHOOHõù[Xô\ààà\[ŸàôXœÀö]î\òŸ[ùOOHõù[Xô\àà\[ŸàôXœÀô^\’—^\ûHOOHõù[Xô\ààà\[ŸàôXœÀö\–ÿ[OOHòõ€€X[àà\ôXÀú‹›\ôXÀú›öZŸBà
H¬àõ›»ô]»\úõ‹äìX[õ‹õYY\›‹öXÿ[ôX€‹ô
Z\‹⁄[ôÀ⁄[ùò[Y‹››öZŸK]î\òŸ[ù^\’—^\ûK‹à\–ÿ[
KàäN¬àBà€€ú›Y»Hÿ[–Yò[òŸY‹ôYZ‹ ôXÀú‹›ôXÀú›öZŸKôXÀö]î\òŸ[ùôXÀô^\’—^\ûKôXÀö\–ÿ[
N¬àYà
XY Hõ›»ô]»\úõ‹äòÿ[–Yò[òŸY‹ôYZ‹»ô]\õôYù[õ‹à\»ôX€‹ô
[ùò[Y[ú] KàäN¬à€€ú›»ô\ôX›õY‹»HH€\‹⁄YûPYò[òŸY‹ôYZ‹‘õ› Y N¬à€€ú›[ú›]][€ò[HŸôõ[ôTô\ŸX\ò⁄\ö]ôR[ú›]][€ò[Y]öX‹ ôXÀY N¬à€€ú›õ›ŒàòX⁄›\›õ›‘ô\›[H¬à[Y\›[\àôXÀù[Y\›[\àﬁ[Xõ€àôXÀúﬁ[Xõ€à›öZŸNàôXÀú›öZŸKà\–ÿ[àôXÀö\–ÿ[à›]\Œàì“»ãàYò[òŸY‹ôYZ‹ŒàYÀàô\ôX›àõY‹Àà^\’—^\ûQõ‹î›[[X\ûNàôXÀô^\’—^\ûKàããö[ú›]][€ò[àN¬àõÿãúô\›[Àú\⁄
õ› N¬àŸôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^ú\⁄
¬àYàõÿãöY
»ó»à
»KàôX›‹éàŸôõ[ôTô\ŸX\ò⁄ôX]\ôUôX›‹äYÀôXÀö]î\òŸ[ùôXÀô^\’—^\ûJKàôX€‹ôàõ›ÀàJN¬àHÿ]⁄
õ›—\úäH¬àÀ»Tîì‘à””ïRSìQSïà€ôHòYõ›»ô]ô\àXõ‹ù»HõÿãÇàõÿãúô\›[Àú\⁄
¬à[Y\›[\àôXœÀù[Y\›[\œ»ù[ö€õ›€àãàﬁ[Xõ€àôXœÀúﬁ[Xõ€œ»ù[ö€õ›€àãà›öZŸNàôXœÀú›öZŸHœ»à\–ÿ[àH\ôXœÀö\–ÿ[à›]\ŒàëêRSQãà\úõ‹éàõ›—\úà[ú›[òŸ[Ÿà\úõ‹à»õ›—\úãõY\‹ÿYŸHà›ö[ô õ›—\úäKàJN¬àBàõÿãúõÿŸ\‹ŸYôX€‹ô»HH
»N¬àYà

H
»JH	H—ëìSëW‘ëT—PTê“–êU“‘“VëHOOH
H¬à]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ZY[

N»À»[ô€€ùõ€òX⁄»»H]ô[ù€‹àBàBÇàÀ»’U””QKUQQ‘’TT‘Œà‹õ›\ÿ[YKX€€ùòX›
ﬁ[Xõ€
‹›öZŸJ⁄\–ÿ[
BàÀ»õ›‹À€‹ù⁄õ€õ€Ÿ⁄Xÿ[K[ôõ‹àXX⁄õ›»ôX€‹ô⁄]àÀ»[‹ô]Xÿ[ô[Z][KŸ^ö[ú⁄X’ò[YHY]HëTñHëVÿúŸ\ùò][€ÇàÀ»Ÿà]ÿ[YH€€ùòX›à\»\»⁄]]»ÿòX⁄›\›‹›[[X\ûKŒöõÿíYàÀ»[ú›Ÿ\àôYHô\ôX›ôYX›[û][ô»àò]\à[àù\›ù⁄[àYàÀ»õY‹»ö\ôHà8†%ŸYHHöY[ÿ»€€[Y[ù»€àòX⁄›\›õ›‘ô\›[Xõ›ôKÇà€€ú›‹õ›\»Hô]»X\›ö[ôÀòX⁄›\›õ›‘ô\›[◊Oä
N¬àõ‹à
€€ú›õ›»Ÿàõÿãúô\›[ H¬àYà
õ›Àú›]\»OOHì“»à\õ›ÀòYò[òŸY‹ôYZ‹ H€€ù[ùYN¬à€€ú›Ÿ^HHõ›Àúﬁ[Xõ€
»üà
»õ›Àú›öZŸH
»üà
»õ›Àö\–ÿ[¬àYà
Y‹õ›\Àö\ Ÿ^JJH‹õ›\ÀúŸ]
Ÿ^K◊JN¬à‹õ›\ÀôŸ]
Ÿ^JHKú\⁄
õ› N¬àBà]‹õ›\€›[ùH¬àõ‹à
€€ú›‹õ›\Ÿà‹õ›\Àùò[Y\ 
JH¬à‹õ›\ú€‹ù

KäHOà
Kù[Y\›[\ãù[Y\›[\»LHàKù[Y\›[\àãù[Y\›[\»Hà
JN¬àõ‹à
]»H»»‹õ›\õ[ô›HN»   H¬à€€ú››\àH‹õ›\Ÿ◊Kô^H‹õ›\Ÿ»
»WN¬à€€ú››\îô[HH›\ãòYò[òŸY‹ôYZ‹»Kù[‹ô]Xÿ[ô[Z][Kô^ô[HHô^òYò[òŸY‹ôYZ‹»Kù[‹ô]Xÿ[ô[Z][N¬à€€ú››\ë^H›\ãòYò[òŸY‹ôYZ‹»Kô^ö[ú⁄X’ò[YKô^^Hô^òYò[òŸY‹ôYZ‹»Kô^ö[ú⁄X’ò[YN¬à›\ãõô^ÿúŸ\ùò][€ï[Y\›[\Hô^ù[Y\›[\¬àYà
›\îô[Hà
H›\ãõô^ÿúŸ\ùò][€îô[Z][P⁄[ôŸT›HX]úõ›[ô


ô^ô[HH›\îô[JH»›\îô[JH
àL
H»L¬àYà
›\ë^àåJH›\ãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›HX]úõ›[ô


ô^^H›\ë^
H»›\ë^
H
àL
H»L¬àBà‹õ›\€›[ù
 Œ¬àYà
‹õ›\€›[ù	HLOOH
H]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ZY[

N¬àBÇàõÿãú›]\»Hë”ëHé¬àHÿ]⁄
\úäH¬àÀ»⁄›[ôH[úôXX⁄XõH
\ã\õ›»ûKÿÿ]⁄Xõ›ôHXú€‹òú»õ›»\úõ‹ú KàÀ»ù]Ÿ\\»H\›\ô\€‹ù€€ùZ[õY[ùõ›[ô\ûHõ‹àH⁄€HõÿãÇàõÿãú›]\»HëêRSQé¬àõÿãô\úõ‹àH\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäN¬àHö[ò[H¬àõÿãôö[ö\⁄Y]H]Kõõ› 
N¬àBüBÇãÀ»KKKH\€€]Yõ›]\àKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKBÇò€€ú›Ÿôõ[ôTô\ŸX\ò⁄õ›]\àHô]»€õ 
N¬ÇõŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ã⁄X[ã
 HOà¬àô]\õàÀöú€€ä¬à⁄ŒàùYKà[Ÿ[NàõŸôõ[ôK\ô\ŸX\ò⁄ãàõ›Nàí\€€]YôXY[€õKàõ»úõ⁄Ÿ\à‹ô\ãY^X›][€à€⁄‹»^\›[à\»[Ÿ[H‹à[û]⁄\ôH[à\»€ŸXò\ŸKàãàX›]ôRõÿúŒàŸôõ[ôTô\ŸX\ò⁄õÿúÀú⁄^ôKàôX›‹í[ô^⁄^ôNàŸôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^õ[ô›àJN¬üJN¬Çã äÇà
à‘’ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹ù[Çà
àõŸNà»ôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊HBà
à⁄X⁄‹»ŸôàH⁄[öŸYõ€ãXõÿ⁄⁄[ô»òX⁄Ÿ‹õ›[ôõÿà[ôô]\õú»[[YYX][Bà
à
åàXÿŸ\Y
H⁄]HõÿíY»€àô]ô\à›X⁄\»]ôHõ›]\À‹›]KÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãú‹›
ãÿòX⁄›\›‹ù[àã\ﬁ[ò»
 HOà¬àûH¬à€€ú›õŸHH]ÿZ]Àúô\Köú€€ä
Kòÿ]⁄


HOàù[
N¬à€€ú›ôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊H[ôYö[ôYHõŸOÀúôX€‹ôŒ¬àYà
P\úò^Kö\–\úò^JôX€‹ô HôX€‹ôÀõ[ô›OOH
H¬àô]\õàÀöú€€ä»\úõ‹éàêõŸH]\›ôH»ôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊HH⁄]]X\›€ôHõ›ÀààK
N¬àBàYà
ôX€‹ôÀõ[ô›àL
H¬àô]\õàÀöú€€ä»\úõ‹éàï€»X[ûHôX€‹ô»[à€ôHõÿà
X^L8†%‹][ù»][\Hù[ú KààK
N¬àBà€€ú›õÿéàòX⁄›\›õÿàH¬àYàŸôõ[ôTô\ŸX\ò⁄õÿíY

Kà›]\ŒàîUQUQQãà›[ôX€‹ôŒàôX€‹ôÀõ[ô›àõÿŸ\‹ŸYôX€‹ôŒàà›\ùY]à]Kõõ› 
Kàö[ö\⁄Y]àù[à\úõ‹éàù[àô\›[Œà◊KàN¬àŸôõ[ôTô\ŸX\ò⁄õÿúÀúŸ]
õÿãöYõÿäN¬àÀ»ö\ôKX[ôYõ‹ôŸ]àì’]ÿZ]Y€»\»ô\]Y\›ô]\õú»[[YYX][H[ôàÀ»]ôH\⁄õÿ\ô€[ô»€€ù[ùY\»[ö[ù\úù\Y⁄[H]ù[úÀÇàõ⁄Yù[ìŸôõ[ôTô\ŸX\ò⁄òX⁄›\›
õÿãôX€‹ô Kòÿ]⁄

\úäHOà¬àõÿãú›]\»HëêRSQé¬àõÿãô\úõ‹àH\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäN¬àõÿãôö[ö\⁄Y]H]Kõõ› 
N¬àJN¬àô]\õàÀöú€€ä»õÿíYàõÿãöY›]\Œàõÿãú›]\À›[ôX€‹ôŒàõÿãù›[ôX€‹ô»KåäN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàëòZ[Y»]Y]YHòX⁄›\›õÿéàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äà—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹›]\ÀŒöõÿíY8†%Y⁄ŸZY⁄€õ»ô\›[^[ÿYà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ãÿòX⁄›\›‹›]\ÀŒöõÿíYã
 HOà¬àûH¬à€€ú›õÿàHŸôõ[ôTô\ŸX\ò⁄õÿúÀôŸ]
Àúô\Kú\ò[JöõÿíYäJN¬àYà
ZõÿäHô]\õàÀöú€€ä»\úõ‹éàï[ö€õ›€àõÿíYààK
N¬àô]\õàÀöú€€ä¬àõÿíYàõÿãöYà›]\Œàõÿãú›]\Àà›[ôX€‹ôŒàõÿãù›[ôX€‹ôÀàõÿŸ\‹ŸYôX€‹ôŒàõÿãúõÿŸ\‹ŸYôX€‹ôÀàõŸ‹ô\‹‘›àõÿãù›[ôX€‹ô»»X]úõ›[ô

õÿãúõÿŸ\‹ŸYôX€‹ô»»õÿãù›[ôX€‹ô H
àL
H»Làà›\ùY]àõÿãú›\ùY]àö[ö\⁄Y]àõÿãôö[ö\⁄Y]à\úõ‹éàõÿãô\úõ‹ãàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàî›]\»€⁄›\òZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äà—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹ô\›[ŒöõÿíY8†%ù[õ›À[]ô[ô\›[»€òŸH”ëKà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ãÿòX⁄›\›‹ô\›[ŒöõÿíYã
 HOà¬àûH¬à€€ú›õÿàHŸôõ[ôTô\ŸX\ò⁄õÿúÀôŸ]
Àúô\Kú\ò[JöõÿíYäJN¬àYà
ZõÿäHô]\õàÀöú€€ä»\úõ‹éàï[ö€õ›€àõÿíYààK
N¬àYà
õÿãú›]\»OOHë”ëHà	âàõÿãú›]\»OOHëêRSQäH¬àô]\õàÀöú€€ä»\úõ‹éàíõÿàõ›ö[ö\⁄YY]àã›]\Œàõÿãú›]\ÀõŸ‹ô\‹‘›àõÿãù›[ôX€‹ô»»X]úõ›[ô

õÿãúõÿŸ\‹ŸYôX€‹ô»»õÿãù›[ôX€‹ô H
àL
H»LàKJN¬àBà€€ú›⁄‘õ›‹»Hõÿãúô\›[Àôö[\ä
äHOàãú›]\»OOHì“»äN¬à€€ú››[[X\ûHH¬à›XõNà⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHî’PìHäKõ[ô›àÿ]⁄à⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHï–U“äKõ[ô›à[ú›XõNà⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHïSî’PìHäKõ[ô›àòZ[Yàõÿãúô\›[Àõ[ô›H⁄‘õ›‹Àõ[ô›àN¬àô]\õàÀöú€€ä»õÿíYàõÿãöY›]\Œàõÿãú›]\À\úõ‹éàõÿãô\úõ‹ã›[[X\ûKô\›[Œàõÿãúô\›[»JN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîô\›[ô]⁄òZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äÇà
à—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹›[[X\ûKŒöõÿíYà
à[X[ã\ôXYXõHYŸ‹ôYÿ]H›]À€»[›Hô]ô\à]ôH»X[ùX[H€›[ùBà
àî””à\úò^HŸàZ[Hõ›‹Àà€€\]\Œà›ô\ò[’PìK’–U“’Sî’PìH	Kà
àHÿ[YHúôXZŸ›€à‹]ûHô^\»»^\ûHàùX⁄Ÿ]
€»[›Hÿ[àŸYBà
à⁄]\à[ú›Xö[]H€\›\ú»ôX\à^\ûKKôÀà⁄\õHXÿ^JK[ô]ô\òYŸBà
à‹ôYZ»XY€ö]Y\Àà\ôHôXY[€õHYŸ‹ôYÿ][€à›ô\àõÿãúô\›[»8†%Ÿ\»õ›à
àôKYô]⁄[û][ô»‹à›X⁄[ûH]ôH›]KÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ãÿòX⁄›\›‹›[[X\ûKŒöõÿíYã
 HOà¬àûH¬à€€ú›õÿàHŸôõ[ôTô\ŸX\ò⁄õÿúÀôŸ]
Àúô\Kú\ò[JöõÿíYäJN¬àYà
ZõÿäHô]\õàÀöú€€ä»\úõ‹éàï[ö€õ›€àõÿíYààK
N¬àYà
õÿãú›]\»OOHë”ëHà	âàõÿãú›]\»OOHëêRSQäH¬àô]\õàÀöú€€ä»\úõ‹éàíõÿàõ›ö[ö\⁄YY]àã›]\Œàõÿãú›]\»KJN¬àBà€€ú›⁄‘õ›‹»Hõÿãúô\›[Àôö[\ä
äHOàãú›]\»OOHì“»à	âàãòYò[òŸY‹ôYZ‹ N¬à€€ú››[Hõÿãúô\›[Àõ[ô›¬à€€ú››H
éàù[Xô\ãŸéàù[Xô\äHOà
Ÿàà»X]úõ›[ô

à»ŸäH
àL
H»Là
N¬Çà€€ú››XõP€›[ùH⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHî’PìHäKõ[ô›¬à€€ú›ÿ]⁄€›[ùH⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHï–U“äKõ[ô›¬à€€ú›[ú›XõP€›[ùH⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHïSî’PìHäKõ[ô›¬à€€ú›òZ[Y€›[ùH›[H⁄‘õ›‹Àõ[ô›¬ÇàÀ»ùX⁄Ÿ]ûHõﬁ[Z]H»^\ûH8†%\»\»H]\õà[‹›€‹ùàÀ»ŸYZ[ôŒàŸ\»[ú›Xö[]H€\›\àöY⁄ôYõ‹ôH^\ûH
⁄\õK›]BàÀ»Xÿ^HYôôX› H‹à\»]‹ôXY]ô[õO¬à\HùX⁄Ÿ]H»Xô[à›ö[ôŒ»Z[éàù[Xô\é»X^àù[Xô\àN¬à€€ú›ùX⁄Ÿ]ŒàùX⁄Ÿ]◊HH¬à»Xô[àåLH^\»»^\ûHãZ[éàX^àHKà»Xô[àåãM^\»»^\ûHãZ[éàãX^àKà»Xô[àçKLL^\»»^\ûHãZ[éàKX^àLKà»Xô[àåLJ»^\»»^\ûHãZ[éàLKX^à[ôö[ö]HKàN¬àÀ»^\’—^\ûH\€â››‹ôY\ôX›H€àòX⁄›\›õ›‘ô\›[€õH[ú⁄YBàÀ»H‹öY⁄[ò[ôX€‹ô]ÿ\»€€\]Yúõ€H8†%ôX€€\]HHùX⁄Ÿ]Ÿ^BàÀ»úõ€HYò[òŸY‹ôYZ‹…»›€à]Kÿ⁄\õH⁄Y€à\»[úô[XXõK€»[ú›XYàÀ»ŸHùX⁄Ÿ]\⁄[ô»Hõ›…‹»[Y\›[\]úÀ[õ›[ô»\»õ›‹‹⁄XõH\ôN¬àÀ»[ú›XY^‹ŸH\ã\õ›»^\’—^\ûHûHÿ\úûZ[ô»]õ›Y⁄àŸYBàÀ»õ›Hô[›ŒàùX⁄Ÿ][ô»\Ÿ\»ãô^\’—^\ûQõ‹î›[[X\ûHYàô\Ÿ[ùÇà€€ú›ûPùX⁄Ÿ]HùX⁄Ÿ]ÀõX\

äHOà¬à€€ú›õ›‹»H⁄‘õ›‹Àôö[\ä
éà[ûJHOà¬à€€ú›HHãô^\’—^\ûQõ‹î›[[X\ûN¬àô]\õà\[ŸàHOOHõù[Xô\àà	âàHèHãõZ[à	âàHHãõX^¬àJN¬à€€ú›[ú›XõHHõ›‹Àôö[\ä
äHOàãùô\ôX›OOHïSî’PìHäKõ[ô›¬à€€ú›ÿ]⁄Hõ›‹Àôö[\ä
äHOàãùô\ôX›OOHï–U“äKõ[ô›¬à€€ú››XõHHõ›‹Àôö[\ä
äHOàãùô\ôX›OOHî’PìHäKõ[ô›¬àô]\õà»ùX⁄Ÿ]àãõXô[^\Œàõ›‹Àõ[ô››XõT›à›
›XõKõ›‹Àõ[ô›
Kÿ]⁄›à›
ÿ]⁄õ›‹Àõ[ô›
K[ú›XõT›à›
[ú›XõKõ›‹Àõ[ô›
HN¬àJN¬Çà€€ú›]ô»H
õéà
YŒàõ€ìù[XõOòX⁄›\›õ›‘ô\›[»òYò[òŸY‹ôYZ‹»óOäHOàù[Xô\äHOÇà⁄‘õ›‹Àõ[ô›»X]úõ›[ô

⁄‘õ›‹ÀúôYXŸJ
ÀäHOà»
»X]òXú õäãòYò[òŸY‹ôYZ‹»JJK
H»⁄‘õ›‹Àõ[ô›
H
àL
H»Làù[¬ÇàÀ»õY»úô\]Y[òﬁH8†%⁄X⁄‹X⁄YöX»ö\⁄»õY»ö\ô\»[‹›Ÿù[ãÇà€€ú›õY–€›[ùŒàôX€‹ô›ö[ôÀù[Xô\èàHﬂN¬à⁄‘õ›‹Àôõ‹ëXX⁄

äHOà
ãôõY‹»◊JKôõ‹ëXX⁄

äHOà»õY–€›[ù÷ŸóHH
õY–€›[ù÷ŸóH
H
»N»JJN¬Çàô]\õàÀöú€€ä¬àõÿíYàõÿãöY›]\Œàõÿãú›]\Àà›[^\Œà›[òZ[Y^\ŒàòZ[Y€›[ùà›ô\ò[à¬à›XõT›à›
›XõP€›[ù⁄‘õ›‹Àõ[ô›
Kÿ]⁄›à›
ÿ]⁄€›[ù⁄‘õ›‹Àõ[ô›
K[ú›XõT›à›
[ú›XõP€›[ù⁄‘õ›‹Àõ[ô›
Kà›XõQ^\Œà›XõP€›[ùÿ]⁄^\Œàÿ]⁄€›[ù[ú›XõQ^\Œà[ú›XõP€›[ùàKàûQ^\’—^\ûNàûPùX⁄Ÿ]à]ô\òYŸPXú—‹ôYZ‹Œà¬àò[õòNà]ô 
Y HOàYÀùò[õòJK⁄\õNà]ô 
Y HOàYÀò⁄\õJK‹YYà]ô 
Y HOàYÀú‹YY
Kõ€[XNà]ô 
Y HOàYÀûõ€[XJK€€‹éà]ô 
Y HOàYÀò€€‹äKàõ€[XNà]ô 
Y HOàYÀùõ€[XJK[[XNà]ô 
Y HOàYÀù[[XJKàKà[‹›€€[[€ëõY‹ŒàÿöôX›ô[ùöY\ õY–€›[ù Kú€‹ù

KäHOàñÃWHHVÃWJKõX\

ŸõYÀ€›[ùJHOà
»õYÀÿÿ›\úôY€ë^\Œà€›[ù›Ÿë^\Œà›
€›[ù⁄‘õ›‹Àõ[ô›
HJJKàÀ»‘ëQR‘»T’íPïUS”à8†%YYåçãLLMà[à\ôX›ô\‹€úŸH»HôX[àÀ»ö[ô[ôŒàHõ€[XK›[[XHõY»ô\⁄€»
Kå»KçJHŸ\ôHZŸ[ÇàÀ»\ÀZ\»úõ€HH\Ÿ\â‹»ô\ŸX\ò⁄‹XÀì’[ô\[ô[ùHÿ[Xúò]YàÀ»YÿZ[ú›\»€ŸXò\ŸI‹»›€àÿ[[XK›ôYÿHÿÿ[[ô»€€ùô[ù[€ãàH]ôBàÀ»ù[à⁄›ŸYH[[XHõY»ö\ö[ô»€àçç…HŸà^\»
õ›ô[]ò]YãàÀ»ù\›ù\›X[äK⁄X⁄€€\ŸYH’PìHò\Ÿ[[ôHôYYYõ‹àBàÀ»KX€€ùõ€Y‹⁄Y€öYöXÿ[òŸH€€\\ö\€€úÀàò]\à[à›Y\‹»Hô]¬àÀ»ô\⁄€\»^‹Ÿ\»HP’PSò[Y_\òŸ[ù[H\›öXù][€ÇàÀ»õ‹àò[õòKÿ⁄\õK‹‹YYﬁõ€[XKÿ€€‹ã›õ€[XK›[[XHúõ€H\»õÿâ‹»›€ÇàÀ»]K€»Hô\⁄€ôX\àHLŒM]\òŸ[ù[H
KôKàŸ[ùZ[ô[BàÀ»[ù\›X[õ›\Xÿ[
Hÿ[àôHX⁄ŸY[\\öXÿ[Hô^Çà‹ôYZ‹—\›öXù][€éà


HOà¬àù[ò›[€à\òŸ[ù[T›] ò[Y\Œàù[Xô\ñ◊JH¬àYà
]ò[Y\Àõ[ô›
Hô]\õàù[¬à€€ú›€‹ùYHÀããùò[Y\◊Kú€‹ù

KäHOàHHäN¬à€€ú››[HH
àù[Xô\äHOà€‹ùY”X]õZ[ä€‹ùYõ[ô›HKX]ôõ€‹ä
»L
H
à€‹ùYõ[ô›
JWN¬àô]\õà¬à€›[ùà€‹ùYõ[ô›àZ[éàX]úõ›[ô
€‹ùYÃH
àYMäH»YMãàLàX]úõ›[ô
›[JL
H
àYMäH»YMãàLàX]úõ›[ô
›[JL
H
àYMäH»YMãàMNàX]úõ›[ô
›[JMJH
àYMäH»YMãàNNàX]úõ›[ô
›[JNJH
àYMäH»YMãàX^àX]úõ›[ô
€‹ùY‹€‹ùYõ[ô›HWH
àYMäH»YMãàN¬àBà€€ú›öY[Œà
Ÿ^[Ÿàõ€ìù[XõOòX⁄›\›õ›‘ô\›[»òYò[òŸY‹ôYZ‹»óOäV◊HH»ùò[õòHãò⁄\õHãú‹YYãûõ€[XHãò€€‹àãùõ€[XHãù[[XHóN¬à€€ú››]àôX€‹ô›ö[ôÀô]\õï\O\[Ÿà\òŸ[ù[T›]œèàHﬂN¬àöY[Àôõ‹ëXX⁄

äHOà¬à›]ŸóHH\òŸ[ù[T›] ⁄‘õ›‹ÀõX\

äHOàX]òXú ãòYò[òŸY‹ôYZ‹»VŸóJJJN¬àJN¬àô]\õà›]¬àJJ
Kà‹ôYZ‹—\›öXù][€ìõ›Nàî\òŸ[ù[\»Ÿàò[Y_X‹õ‹‹»[^\»[à\»õÿãà›\úô[ùõY»ô\⁄€Œà⁄\õOååãò[õòOåçKõ€[XOååH‘à€€‹èååK‹YYååKõ€[XOçKå[[XOåKçH8†%€€\\ôHXX⁄ô\⁄€YÿZ[ú›]‹ôYZ…‹»L‹MH\ôKàYàHô\⁄€⁄]»ëS’»L
ZŸH[[XH\X\ú» K]	‹»ö\ö[ô»€àHXZõ‹ö]HŸà^\»[ô\€â›X›X[HõYŸ⁄[ô»[û][ô»[ù\›X[»Hõ‹\õH	Ÿ[]ò]Y	»ô\⁄€⁄›[⁄]€‹ŸH»L\MHŸà\»õÿâ‹»›€à\›öXù][€ãàãà[ú›]][€ò[à


HOà¬à€€ú›⁄Tõ›‹»H⁄‘õ›‹Àôö[\ä
äHOàãõ⁄T›]H	âàãõ⁄T›]HOOHíSî’QëíP“QSï“T’‘ñHäN¬à€€ú›ùîõ›‹»H⁄‘õ›‹Àôö[\ä
äHOà\[Ÿàãö]ìZ[ù\‘ùî›OOHõù[Xô\àäN¬à€€ú›[›ôTõ›‹»H⁄‘õ›‹Àôö[\ä
äHOà\[Ÿàãõ[›ôTò][»OOHõù[Xô\àäN¬à€€ú›]ô”ŸàH
\úéàù[Xô\ñ◊JHOà
\úãõ[ô›»X]úõ›[ô

\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›
H
àL
H»Làù[
N¬àÀ»HŸ^HôYX›]ôH‹õ‹‹À]Xéà€à^\»õYŸŸYSî’PìKYBàÀ»X\öŸ]›XúŸ\]Y[ùH[›ôHS‘ëHô[]]ôH»⁄]Uà[\YYàÀ»
[›ôTò][»àJH[‹ôHŸù[à[à€à’PìH^\œ»YàY\À]	‹¬àÀ»ôX[]öY[òŸHH‹ôYZ‹ÀYö]ô[àô\ôX›\»ÿ]⁄[ô»€€Y][ô¬àÀ»H‹[€â‹»›€àUàÿ\»Z\‹öX⁄[ô»8†%õ›ù\›H\ÿ‹ö\]ôHõYÀÇà€€ú›[›ôTò][–ûUô\ôX›H
»î’PìHãï–U“ãïSî’PìHóH\»€€ú›
KõX\

äHOà¬à€€ú›õ›‹»H[›ôTõ›‹Àôö[\ä
äHOàãùô\ôX›OOHäN¬àô]\õà»ô\ôX›àã^\Œàõ›‹Àõ[ô›]ô”[›ôTò][Œà]ô”Ÿäõ›‹ÀõX\

äHOàãõ[›ôTò][»JJK›⁄\ôSX\öŸ][›ôY[‹ôU[í[\YYà›
õ›‹Àôö[\ä
äHOàãõ[›ôTò][»HàJKõ[ô›õ›‹Àõ[ô›
HN¬àJN¬àô]\õà¬à⁄Qõ›Œà¬à^\’⁄]⁄Q]Nà⁄Tõ›‹Àõ[ô›àùZ[\›à›
⁄Tõ›‹Àôö[\ä
äHOàãõ⁄T›]HOOHêïRSTäKõ[ô›⁄Tõ›‹Àõ[ô›
Kà[ù⁄[ô[ô‘›à›
⁄Tõ›‹Àôö[\ä
äHOàãõ⁄T›]HOOHïSï“SëSë»äKõ[ô›⁄Tõ›‹Àõ[ô›
Kàõ]›à›
⁄Tõ›‹Àôö[\ä
äHOàãõ⁄T›]HOOHëìUäKõ[ô›⁄Tõ›‹Àõ[ô›
KàKàõ€][]Tö\⁄‘ô[Z][Nà¬à^\’⁄]ùë]Nàùîõ›‹Àõ[ô›à]ô“]ìZ[ù\‘ùî›à]ô”Ÿäùîõ›‹ÀõX\

äHOàãö]ìZ[ù\‘ùî›JJKà›^\“]îöX⁄\ï[îùéà›
ùîõ›‹Àôö[\ä
äHOà
ãö]ìZ[ù\‘ùî›œ»
Hà
Kõ[ô›ùîõ›‹Àõ[ô›
Kà[ù\úô]][€éàî‹⁄]]ôH]ô“]ìZ[ù\‘ùî›HUàÿ\»\Xÿ[HöX⁄\à[àH[ô\õZ[ô…‹»ôXŸ[ùôX[^ôY[›ô\»
€\‹⁄X»õ€\Ÿ[[ô»òX⁄Ÿõ‹
KàôYÿ]]ôHHUàÿ\»\Xÿ[H⁄X\ô[]]ôH»ôX[^ôY
€\‹⁄X»õ€Xù^Z[ô»òX⁄Ÿõ‹
KàãàKà[\YYú‘ôX[^ôY[›ôNà¬à^\’⁄][›ôQ]Nà[›ôTõ›‹Àõ[ô›à]ô”[›ôTò][Œà]ô”Ÿä[›ôTõ›‹ÀõX\

äHOàãõ[›ôTò][»JJKà›^\”X\öŸ][›ôY[‹ôU[í[\YYà›
[›ôTõ›‹Àôö[\ä
äHOàãõ[›ôTò][»HàJKõ[ô›[›ôTõ›‹Àõ[ô›
KàûUô\ôX›à[›ôTò][–ûUô\ôX›à[ù\úô]][€éàõ[›ôTò][»àHYX[ú»H[ô\õZ[ô»X›X[H[›ôYS‘ëHûH\»€€ùòX›	‹»^\ûH[à]»›€àUà[\YY]€›[
‹[€ú»Ÿ\ôH⁄X\[à[ô⁄Y⁄
Kà€€\\ôHûUô\ôX›õ›‹ŒàYàSî’PìKY^H[›ôTò][‹»ù[àY⁄\à[à’PìKY^H[›ôTò][‹À]	‹»]öY[òŸHHô\ôX›\»ÿ]⁄[ô»ôX[Z\‹öX⁄[ôÀõ›ù\›õ⁄\ŸKàãàKàX[\ëŸ^à¬à^\’⁄]⁄Q]Nà⁄Tõ›‹Àõ[ô›à]ô’[ú⁄Y€ôYÿ[[XQ^‹›\ôSõ›[€ò[à]ô”Ÿä⁄Tõ›‹ÀõX\

äHOàãôÿ[[XQ^‹›\ôSõ›[€ò[œ»
JKà]ô“]\ö\›X‘⁄Y€ôYX[\ëŸ^õ›[€ò[à]ô”Ÿä⁄Tõ›‹ÀõX\

äHOàãö]\ö\›X—X[\ëŸ^õ›[€ò[œ»
JKà[ù\úô]][€éàö]\ö\›X—X[\ëŸ^õ›[€ò[\Y\»H€€[[€à[ô\›ûHT‘’STS”à
ÿ[“HHX[\à⁄‹ùÿ[[XHHôYÿ]]ôH⁄Y€é»]“HHX[\à€ô»ÿ[[XHH‹⁄]]ôH⁄Y€äH8†%[â‹»]Hÿ[õõ›€€ôö\õHX›X[X[\à‹⁄][€ö[ôÀ€»ôXY\»\»H⁄Y[K]\ŸYõﬁKõ›Hô\öYöYYòX›àHôYÿ]]ôH]ô\òYŸH›YŸŸ\›»HõYŸŸY€€ùòX›»⁄Ÿ]ŸY›ÿ\ôÿ[»
HôY⁄[YH⁄\ôHX[\úÀ[ô\à\»\‹›[\[€ã€›[ôHY⁄[ô»ûHù^Z[ô»[ù»ò[Y\À‹Ÿ[[ô»[ù»\»8†%[\YûZ[ô»[›ô\ N»‹⁄]]ôH›YŸŸ\›»H‹‹⁄]H
[\[ö[ô»[›ô\ KàãàKàN¬àJJ
KàÀ»’U””QKUQQàH\ôX›[ú›Ÿ\à»ôŸ\»Hô\ôX›ôYX›àÀ»[û][ôÀ‹à\»]ù\›\ÿ‹ö\]ôHà8†%]ô\òYŸHô^[ÿúŸ\ùò][€ÇàÀ»ô[Z][KŸ^ö[ú⁄XÀ]ò[YH⁄[ôŸK‹]ûHHô\ôX›]ÿ\¬àÀ»⁄›⁄[ô»€àHíS‘à^Kà[€»[ò€Y\»ò]»[ùö[ú⁄XÀŸ^ö[ú⁄XÀ¬àÀ»[‹ô]Xÿ[ô[Z][H]ô\òYŸ\»ûHô\ôX›⁄[òŸH^ö[ú⁄X»ò[YBàÀ»
[YHò[YJH\»H\ôX›]KYXÿ^H	ìõﬁHõ‹àBàÀ»\›]Xÿ[ô[Z][HŸ[\ãÇà›]€€YPûUô\ôX›à


HOà¬à€€ú›⁄]›]€€YHH⁄‘õ›‹Àôö[\ä
äHOà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àäN¬à€€ú›]ô”ŸàH
\úéàù[Xô\ñ◊JHOà
\úãõ[ô›»X]úõ›[ô

\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›
H
àL
H»Làù[
N¬àô]\õà
»î’PìHãï–U“ãïSî’PìHóH\»€€ú›
KõX\

äHOà¬à€€ú›ô\ôX›õ›‹»H⁄‘õ›‹Àôö[\ä
äHOàãùô\ôX›OOHäN¬à€€ú››]€€YTõ›‹»H⁄]›]€€YKôö[\ä
äHOàãùô\ôX›OOHäN¬àô]\õà¬àô\ôX›àãà^\Œàô\ôX›õ›‹Àõ[ô›à]ô“[ùö[ú⁄X’ò[YNà]ô”Ÿäô\ôX›õ›‹ÀõX\

äHOàãòYò[òŸY‹ôYZ‹»Kö[ùö[ú⁄X’ò[YJJKà]ô—^ö[ú⁄X’ò[YNà]ô”Ÿäô\ôX›õ›‹ÀõX\

äHOàãòYò[òŸY‹ôYZ‹»Kô^ö[ú⁄X’ò[YJJKà]ô’[‹ô]Xÿ[ô[Z][Nà]ô”Ÿäô\ôX›õ›‹ÀõX\

äHOàãòYò[òŸY‹ôYZ‹»Kù[‹ô]Xÿ[ô[Z][JJKà^\’⁄]ô^ÿúŸ\ùò][€éà›]€€YTõ›‹Àõ[ô›à]ô”ô^ÿúŸ\ùò][€îô[Z][P⁄[ôŸT›à]ô”Ÿä›]€€YTõ›‹ÀõX\

äHOàãõô^ÿúŸ\ùò][€îô[Z][P⁄[ôŸT›JJKà]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›à]ô”Ÿä›]€€YTõ›‹ÀõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JJKàN¬àJN¬àJJ
Kà›]€€YR[ù\úô]][€éàê€€\\ôH]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›X‹õ‹‹»HôYHô\ôX›õ›‹»Xõ›ôKàYàSî’PìK’–U“^\»⁄›»HTë—Tà
[‹ôH‹⁄]]ôK‹à\‹»ôYÿ]]ôJHô^[ÿúŸ\ùò][€à^ö[ú⁄X»⁄[ôŸH[à’PìH^\À]	‹»\ôX›]öY[òŸHHô\ôX›\»ÿ]⁄[ô»ôX[ô[Z][K]ò[YH]ô[ùÀõ›ù\›õ⁄\ŸH8†%Hô[Z][HŸ[\à€›[]ôHÿ[ùY»]õ⁄Y⁄YŸH€à^X›H‹ŸHõYŸŸY^\ÀàYàHôYH\ôHõ›Y⁄H\]X[Hô\ôX›\€â›
Y]
HôYX›[ô»›]€€Y\»€à\»ÿ[\H8†%€õH\ÿ‹öXö[ô»⁄[àõôÃ‹ô[‹ô\à‹ôYZ‹»\ôH[]ò]Y⁄X⁄\»›[\ŸYù[€€ù^ù]õ›õ€ŸàŸàòY[ô»YŸKà–UëPUà\»€€\\ö\€€à\»””ëì’SëQûH^\À]ÀY^\ûH8†%–U“’Sî’PìH^\»\ôH€€òŸ[ùò]YôX\à^\ûK⁄\ôH^ö[ú⁄X»ò[YH\»ò]\ò[H€X[[ô	KYXÿ^H\»ò]\ò[H\ôŸ\àôYÿ\ô\‹»Ÿà[ûHõYÀ€»\»XõH[€ôHÿ[â›Ÿ\\ò]H	›HõY»X]\ú…»úõ€H	ÿôZ[ô»ôX\à^\ûHX]\ú…ÀàŸYHP€€ùõ€Y›]€€YHô[›»õ‹àHõ‹\õH€€ùõ€Yô\ú⁄[€àŸà\»ÿ[YH]Y\›[€ãàãàÀ»KP””ïì”Q‘ì‘‘ÀUPà8†%HöY€‹õ›\»ô\ú⁄[€àŸà›]€€YPûUô\ôX›àÀ»Xõ›ôKà‹]»ûH
^\À]ÀY^\ûHùX⁄Ÿ]
H
ô\ôX›
H€»’PìH[ôàÀ»–U“’Sî’PìH\ôH€õH]ô\à€€\\ôYYÿZ[ú›XX⁄›\à“USàBàÀ»ÿ[YH\›[òŸK]ÀY^\ûKô[[›ö[ô»HH€€ôõ›[ôà[€»ô\‹ù¬àÀ»H›[ô\ô]öX][€àŸàHô^Y^H^ö[ú⁄X»⁄[ôŸH
õ›ù\›àÀ»H]ô\òYŸJH8†%HõY»]Ÿ\€â›[›ôHH]ô\òYŸHù]⁄Y[ú»BàÀ»‹ôXY\»›[YX[ö[ôŸù[HYôô\ô[ù
[‹ôHZ[ö\⁄ K⁄X⁄[ÇàÀ»]ô\òYŸK[€õH€€\\ö\€€à€›[YKàŸ[»⁄][ô\àå^\»\ôBàÀ»^X⁄]HõYŸŸY’◊‘–STW‘“VëHò]\à[à⁄[[ùH[ò€YY8†%àÀ»\àHõõ»⁄[[ùÿ\»àö[ò⁄\K€X[ÿ[\\»\ôHXô[Yõ›àÀ»Y[à‹àõ‹YÇàP€€ùõ€Y›]€€YNà


HOà¬à€€ú››]ìŸàH
\úéàù[Xô\ñ◊JHOà¬àYà
\úãõ[ô›äHô]\õàù[¬à€€ú›YX[àH\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›¬à€€ú›ò\öX[òŸHH\úãúôYXŸJ
ÀäHOà»
»
àHYX[äH
à
àHYX[äK
H»
\úãõ[ô›HJN¬àô]\õàX]úõ›[ô
X]ú‹\ù
ò\öX[òŸJH
àL
H»L¬àN¬à€€ú›]ô”ŸåàH
\úéàù[Xô\ñ◊JHOà
\úãõ[ô›»X]úõ›[ô

\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›
H
àL
H»Làù[
N¬à€€ú›õ›‹Œà»PùX⁄Ÿ]à›ö[ôŒ»ô\ôX›à›ö[ôŒ»^\Œàù[Xô\é»]ô—^ö[ú⁄X’ò[YNàù[Xô\àù[»]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›àù[Xô\àù[»›]ìô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›àù[Xô\àù[»ÿ[\T⁄^ôUÿ\õö[ôŒà›ö[ô»ù[V◊HH◊N¬àõ‹à
€€ú›àŸàùX⁄Ÿ] H¬àõ‹à
€€ú›àŸà»î’PìHãï–U“ãïSî’PìHóH\»€€ú›
H¬à€€ú›Ÿ[õ›‹»H⁄‘õ›‹Àôö[\ä
éà[ûJHOà¬à€€ú›HHãô^\’—^\ûQõ‹î›[[X\ûN¬àô]\õàãùô\ôX›OOHà	âà\[ŸàHOOHõù[Xô\àà	âàHèHãõZ[à	âàHHãõX^¬àJN¬àYà
Ÿ[õ›‹Àõ[ô›OOH
H€€ù[ùYN»À»€â›ô\‹ù[\HŸ[»8†%Ÿ[ùZ[ô[Hõ»]Kõ›Hô\õ»ô\›[à€€ú››]€€YUò[»HŸ[õ›‹Àôö[\ä
äHOà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬àõ›‹Àú\⁄
¬àPùX⁄Ÿ]àãõXô[ô\ôX›àã^\ŒàŸ[õ›‹Àõ[ô›à]ô—^ö[ú⁄X’ò[YNà]ô”ŸåäŸ[õ›‹ÀõX\

äHOàãòYò[òŸY‹ôYZ‹»Kô^ö[ú⁄X’ò[YJJKà]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›à]ô”Ÿåä›]€€YUò[ Kà›]ìô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›à›]ìŸä›]€€YUò[ Kàÿ[\T⁄^ôUÿ\õö[ôŒàŸ[õ›‹Àõ[ô›å»ì’◊‘–STW‘“VëH
à
»Ÿ[õ›‹Àõ[ô›
»à^\ H8†%ôX]\»Ÿ[\»[ôXŸ›[õ››]\›Xÿ[Hô[XXõHààù[àJN¬àBàBàô]\õàõ›‹Œ¬àJJ
KàP€€ùõ€Y[ù\úô]][€éàîôXY\»XõHûHHùX⁄Ÿ]€€\\ö[ô»ô\ôX›»“USàHÿ[YHùX⁄Ÿ]€õH
ô]ô\àX‹õ‹‹»ùX⁄Ÿ]»8†%]	‹»H€€ôõ›[ô\»XõHô[[›ô\ Kà⁄][àHùX⁄Ÿ]⁄]Y\]X]Hÿ[\H⁄^ôH
õ»ÿ[\T⁄^ôUÿ\õö[ô H€àõ›’PìH[ô–U“’Sî’PìHõ›‹ŒàYà–U“’Sî’PìI‹»]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›‹à›]à\»YX[ö[ôŸù[HYôô\ô[ùúõ€H’PìI‹À]	‹»ôX[]öY[òŸHHô\ôX›Y»[ôõ‹õX][€àô^[€ôù\›	⁄›»€‹ŸH»^\ûIÀàYàHùX⁄Ÿ]€õH\»’PìH]H
õ»–U“’Sî’PìHõ›‹»]]JKõ»€€\\ö\€€à\»‹‹⁄XõH\ôHY]8†%ôYY»[‹ôH[ôŸ\›Y\›‹ûH»ö[[ãàŸYH⁄Y€öYöXÿ[òŸU\›ô[›»õ‹à[àÿöôX›]ôHôX[]úÀ[õ⁄\ŸHôXY€à\»ÿ[YH€€\\ö\€€ã[ôûR[ô]öYX[õY»õ‹à⁄X⁄‘P“QíP»õY»
õ›HYŸ‹ôYÿ]Hô\ôX›
Hÿ\úöY\»H⁄Y€ò[àãàÀ»’UT’P–S“Q”íQíP–Sê—HT’8†%\õú»ùH]ô\òYŸ\»€⁄»Yôô\ô[ùà[ù¬àÀ»[àÿöôX›]ôHôXYàŸ[⁄	‹»]\›
[ô\]X[ò\öX[òŸ\ÀŸ\€â›\‹›[YBàÀ»’PìH[ô–U“’Sî’PìH]ôHHÿ[YH‹ôXY8†%^H\›X[H€€â›
BàÀ»€€\\ö[ô»ô^Y^H^ö[ú⁄XÀ]ò[YH⁄[ôŸNà’PìHú»–U“
’Sî’PìBàÀ»€€Xö[ôY
€€Xö[ôYôXÿ]\ŸHSî’PìH[€ôH\»\›X[H€»€X[BàÀ»ÿ[\H€à]»›€à8†%ŸYH]»›€à^H€›[ù»ùYŸJK€€\]YàÀ»“USàXX⁄HùX⁄Ÿ]€»][ö\ö]»Hÿ[YH€€ôõ›[ôYúôYBàÀ»€€\\ö\€€à\»HXõHXõ›ôKààåà\»H›[ô\ôù[K[Ÿã][XÇàÀ»õ‹àúõÿòXõHõ›õ⁄\ŸHà]éMIH€€ôöY[òŸH[àôX\€€òXõK\⁄^ôYàÀ»ÿ[\\»8†%ô\‹ùY\»HZ[ã[[ô›XYŸHô\ôX›õ›Hò]»›]€õBàÀ»H›]\›X⁄X[à€›[ôXYÇà⁄Y€öYöXÿ[òŸU\›à


HOà¬àù[ò›[€àŸ[⁄
Nàù[Xô\ñ◊Kéàù[Xô\ñ◊JNà»àù[Xô\é»êNàù[Xô\é»êéàù[Xô\àHù[¬àYà
Kõ[ô›Hãõ[ô›JHô]\õàù[»À»€»€X[õ‹à[ûH]\›»YX[à[û][ô¬à€€ú›YX[àH
\úéàù[Xô\ñ◊JHOà\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›¬à€€ú›ò\öX[òŸHH
\úéàù[Xô\ñ◊KNàù[Xô\äHOà\úãúôYXŸJ
ÀäHOà»
»
àHJH
à
àHJK
H»
\úãõ[ô›HJN¬à€€ú›PHHYX[äJKPàHYX[ääN¬à€€ú›êHHò\öX[òŸJKPJKêàHò\öX[òŸJãPäN¬à€€ú›ŸHHX]ú‹\ù
êH»Kõ[ô›
»êà»ãõ[ô›
N¬àYà
ŸHOOH
Hô]\õàù[¬àô]\õà»àX]úõ›[ô


PHHPäH»ŸJH
àL
H»LêNàKõ[ô›êéàãõ[ô›N¬àBàô]\õàùX⁄Ÿ]ÀõX\

äHOà¬à€€ú››XõUò[»H⁄‘õ›‹Àôö[\ä
éà[ûJHOàãùô\ôX›OOHî’PìHà	âà\[Ÿàãô^\’—^\ûQõ‹î›[[X\ûHOOHõù[Xô\àà	âàãô^\’—^\ûQõ‹î›[[X\ûHèHãõZ[à	âàãô^\’—^\ûQõ‹î›[[X\ûHHãõX^	âà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬à€€ú›õYŸŸYò[»H⁄‘õ›‹Àôö[\ä
éà[ûJHOà
ãùô\ôX›OOHï–U“àãùô\ôX›OOHïSî’PìHäH	âà\[Ÿàãô^\’—^\ûQõ‹î›[[X\ûHOOHõù[Xô\àà	âàãô^\’—^\ûQõ‹î›[[X\ûHèHãõZ[à	âàãô^\’—^\ûQõ‹î›[[X\ûHHãõX^	âà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬à€€ú›ô\›[HŸ[⁄
›XõUò[ÀõYŸŸYò[ N¬àô]\õà¬àPùX⁄Ÿ]àãõXô[à›XõTÿ[\T⁄^ôNà›XõUò[Àõ[ô›õYŸŸYÿ[\T⁄^ôNàõYŸŸYò[Àõ[ô›à›]àô\›[Àùœ»ù[àô\ôX›à\ô\›[»íSî’QëíP“QSï—UH
ôYY]X\›H^\»€àõ›⁄Y\ HààX]òXú ô\›[ù
Hàà»ìR—SW‘ëPS—QëëTëSê—Hààìì’—T’Së’RT“PìW—îì”W”ì“T—HãàN¬àJKôö[\ä
äHOàãú›XõTÿ[\T⁄^ôHàãôõYŸŸYÿ[\T⁄^ôHà
N¬àJJ
Kà⁄Y€öYöXÿ[òŸU\›[ù\úô]][€éàù›]\»HŸ[⁄	‹»\›]\›X»€€\\ö[ô»’PìHú»
–U“
’Sî’PìH€€Xö[ôY
Hô^Y^H^ö[ú⁄XÀ]ò[YH⁄[ôŸK⁄][àXX⁄HùX⁄Ÿ]à›]àåà\»ôXY\»R—SW‘ëPS—QëëTëSê—H
õÿòXõHõ›ù\›õ⁄\ŸKéMIH€€ôöY[òŸHù[HŸà[XäN»›\ù⁄\ŸHì’—T’Së’RT“PìW—îì”W”ì“T—HYX[ú»\»ÿ[\Hÿ[â›Y][HõY»\\ùúõ€Hò[ô€[ô\‹»]]H8†%]\»[à€ô\›	›ŸH€â›€õ›»Y]	Àõ›H	›HõY»Ÿ\€â›€‹ö…Àà[‹ôH[ôŸ\›Y\›‹ûH
öYŸŸ\àÿ[\JH\»⁄]ò\úõ›‹»]›€ãàãàÀ»TãQìQ»îëPR—’”à8†%HYŸ‹ôYÿ]H’PìK’–U“’Sî’PìHô\ôX›àÀ»ù[ô\»][\HYôô\ô[ùö\⁄»õY‹»ŸŸ]\à
⁄\õHXÿ^Kò[õòKàÀ»õ€[XKÿ€€‹ã‹YY
Kà^HX^Hõ›ÿ\úûH\]X[⁄Y€ò[8†%\»úôXZ‹¬àÀ»H›]€€YH[ò[\⁄\»›€àûHH‘P“QíP»õY»^[ú›XY€»[›BàÀ»ÿ[àŸYH⁄X⁄[ô]öYX[õôÃ‹ô[‹ô\à‹ôYZ»\»X›X[H⁄[ô»BàÀ»ôYX›]ôH€‹öÀò]\à[à‹ôY][ô»H⁄€Hô\ôX›ùX⁄Ÿ]ÇàûR[ô]öYX[õYŒà


HOà¬à€€ú›]ô”Ÿå»H
\úéàù[Xô\ñ◊JHOà
\úãõ[ô›»X]úõ›[ô

\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›
H
àL
H»Làù[
N¬à€€ú›õY‘Ÿ]Hô]»Ÿ]›ö[ôœä
N¬à⁄‘õ›‹Àôõ‹ëXX⁄

äHOà
ãôõY‹»◊JKôõ‹ëXX⁄

äHOàõY‘Ÿ]òY
äJJN¬àô]\õà\úò^Kôúõ€JõY‘Ÿ]
KõX\

õY HOà¬à€€ú›õYŸŸYõ›‹»H⁄‘õ›‹Àôö[\ä
äHOà
ãôõY‹»◊JKö[ò€Y\ õY JN¬à€€ú››]€€YUò[»HõYŸŸYõ›‹Àôö[\ä
äHOà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬àô]\õà¬àõYÀ^\ŒàõYŸŸYõ›‹Àõ[ô›à]ô—^ö[ú⁄X’ò[YNà]ô”Ÿå õYŸŸYõ›‹ÀõX\

äHOàãòYò[òŸY‹ôYZ‹»Kô^ö[ú⁄X’ò[YJJKà]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›à]ô”Ÿå ›]€€YUò[ Kàÿ[\T⁄^ôUÿ\õö[ôŒàõYŸŸYõ›‹Àõ[ô›å»ì’◊‘–STW‘“VëH
à
»õYŸŸYõ›‹Àõ[ô›
»à^\ Hààù[àN¬àJKú€‹ù

KäHOàãô^\»HKô^\ N¬àJJ
Kàõ›NàûPùX⁄Ÿ]ô]ô\ûJ
äHOàãô^\»OOH
Bà»òûQ^\’—^\ûH\»[\Hõ‹à\»õÿà8†%]öY[\»€õH‹[]Yõ‹àõÿú»ù[àYù\à\»›[[X\ûHôX]\ôHÿ\»YYàôK\ù[à⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[»Ÿ]]ö[Y[ãàÇàà[ôYö[ôYàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàî›[[X\ûHòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äÇà
à—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\››ŸôKŒöõÿíYà
àÿ[ÀQõ‹ùÿ\ôYôöX⁄Y[òﬁH
—ëJH8†%YYåçãLLMà\à\Ÿ\ã\›\YYà
àô\ŸX\ò⁄‹X»
[ó‹ÿ[\WŸ^\Œåå›]€Ÿó‹ÿ[\WŸ^\ŒçKò][»åKà
àZ[ó›ŸôW›ô\⁄€åççJKàôXY[€õK[ã[Y[[‹ûK\€€]Y8†%ÿ[YHÿYô]Bà
à€€ùòX›\»]ô\ûH›\àõ›]H[à\»õ›]\ãÇà
Çà
à“HT»PUTîŒà]ô\ûH›\à›[[X\ûH›][à\»[Ÿ[H
›]€€YPûUô\ôX›à
àP€€ùõ€Y›]€€YK⁄Y€öYöXÿ[òŸU\›
H\»€€\]Y›ô\àH“”H[ôŸ\›Yà
à⁄[ô›»]€òŸKà]	‹»[à[ã\ÿ[\K[€õHYX\›\ô[Y[ù8†%]ÿ[â›[[›Bà
à⁄]\àH’PìK]úÀU–U“’Sî’PìHYôôX›õ›[ô[àŸ\]H›[⁄›‹¬à
à\[àõ›à]K‹à⁄]\à]ÿ\»HõZŸHŸà]\ùX›[\à⁄[ô›¬à
à
€\‹⁄X»›ô\ôö][ô»ö\⁄»[à[ûHòX⁄›\›
Kà—ëH[ú›Ÿ\ú»]ûHõ€[ô»Bà
àåY^HùòZ[àà⁄[ô›»õ‹ùÿ\ô^HûH^KXX⁄[YH⁄X⁄⁄[ô»H–SQBà
àYôôX›
]ô»ô^Y^H^ö[ú⁄XÀ]ò[YH⁄[ôŸNà–U“
’Sî’PìHZ[ù\»’PìJBà
à€àHô\ûHô^Hù\›à^\»H⁄[ô›»\€â›ŸY[àY][à€€\\ö[ô¬à
à›][Ÿã\ÿ[\HYôôX›⁄^ôH»[ã\ÿ[\HYôôX›⁄^ôKÇà
Çà
à”ëT’SRUUS”éà\»ôYY»]X\›çH\›[ò›òY[ô»^\»ŸÇà
à[ôŸ\›Y\›‹ûH
å[ã\ÿ[\H
»H›][Ÿã\ÿ[\JH\à⁄[ô›Àà⁄]ô[Çà
à[â‹»€€ôö\õYY⁄‹ùõ€[ôÀ[‹[€à€⁄ÿòX⁄»
ŸYH‹õÿôKŸ[ã\õ€[ôÀ[€⁄ÿòX⁄¬à
àõ›\ KHúô\⁄[ôŸ\›X^Hõ›]ôH[õ›Y⁄\›[ò›^\»Y]8†%[à]ÿ\ŸBà
à\»[ô⁄[ùô]\õú»⁄[ô›‹–€€\]Yà[ôÿ^\»€»Z[õKò]\à[Çà
àòXúöXÿ][ô»H—ëHù[Xô\àúõ€H€»]H]KÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ãÿòX⁄›\››ŸôKŒöõÿíYã
 HOà¬àûH¬à€€ú›õÿàHŸôõ[ôTô\ŸX\ò⁄õÿúÀôŸ]
Àúô\Kú\ò[JöõÿíYäJN¬àYà
ZõÿäHô]\õàÀöú€€ä»\úõ‹éàï[ö€õ›€àõÿíYààK
N¬àYà
õÿãú›]\»OOHë”ëHà	âàõÿãú›]\»OOHëêRSQäH¬àô]\õàÀöú€€ä»\úõ‹éàíõÿàõ›ö[ö\⁄YY]àã›]\Œàõÿãú›]\»KJN¬àBà€€ú›Só‘–STW—VT»Hå¬à€€ú›’U”—ó‘–STW—VT»HN¬à€€ú›RSó’—ëW’ëT“”HççN¬Çà€€ú›⁄‘õ›‹»Hõÿãúô\›[Àôö[\äà
äHOàãú›]\»OOHì“»à	âàãùô\ôX›	âà\[Ÿàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OOHõù[Xô\àÇà
N¬ÇàÀ»‹õ›\ûHÿ[[ô\à^H
]H‹ù[€àŸà[Y\›[\€õJKÇà€€ú›^SŸàH
Œà›ö[ô HOàÀú€XŸJL
N¬à€€ú›^SX\Hô]»X\›ö[ôÀòX⁄›\›õ›‘ô\›[◊Oä
N¬à⁄‘õ›‹Àôõ‹ëXX⁄

äHOà¬à€€ú›H^SŸäãù[Y\›[\
N¬àYà
Y^SX\ö\ 
JH^SX\úŸ]
◊JN¬à^SX\ôŸ]

HKú\⁄
äN¬àJN¬à€€ú›€‹ùY^\»H\úò^Kôúõ€J^SX\öŸ^\ 
JKú€‹ù

N¬ÇàÀ»YôôX›⁄^ôHõ‹à€ôHŸ]Ÿàõ›‹Œà]ô»ô^Y^H^ö[ú⁄X»⁄[ôŸHõ‹ÇàÀ»–U“
’Sî’PìHZ[ù\»]ô»õ‹à’PìH
ÿ[YH]X[ù]H⁄Y€öYöXÿ[òŸU\›àÀ»\Ÿ\À€»—ëH[ô⁄Y€öYöXÿ[òŸU\›\ôH\ôX›H€€\\òXõJKÇàù[ò›[€àYôôX›⁄^ôJõ›‹ŒàòX⁄›\›õ›‘ô\›[◊JNà»YôôX›àù[Xô\àù[»î›XõNàù[Xô\é»ëõYŸŸYàù[Xô\àH¬à€€ú››XõUò[»Hõ›‹Àôö[\ä
äHOàãùô\ôX›OOHî’PìHäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬à€€ú›õYŸŸYò[»Hõ›‹Àôö[\ä
äHOàãùô\ôX›OOHï–U“àãùô\ôX›OOHïSî’PìHäKõX\

äHOàãõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›JN¬àYà
›XõUò[Àõ[ô›»õYŸŸYò[Àõ[ô› Hô]\õà»YôôX›àù[î›XõNà›XõUò[Àõ[ô›ëõYŸŸYàõYŸŸYò[Àõ[ô›N¬à€€ú›YX[àH
\úéàù[Xô\ñ◊JHOà\úãúôYXŸJ
ÀäHOà»
»ã
H»\úãõ[ô›¬àô]\õà»YôôX›àYX[äõYŸŸYò[ HHYX[ä›XõUò[ Kî›XõNà›XõUò[Àõ[ô›ëõYŸŸYàõYŸŸYò[Àõ[ô›N¬àBÇà\HŸôU⁄[ô›»H¬à[îÿ[\Q^\Œà›ö[ô÷◊N»›]Ÿîÿ[\Q^\Œà›ö[ô÷◊N¬à[îÿ[\QYôôX›àù[Xô\àù[»›]Ÿîÿ[\QYôôX›àù[Xô\àù[¬àŸôTò][Œàù[Xô\àù[¬àô\ôX›à›ö[ôŒ¬àN¬à€€ú›⁄[ô›‹ŒàŸôU⁄[ô›÷◊HH◊N¬Çàõ‹à
]HH»H
»Só‘–STW—VT»
»’U”—ó‘–STW—VT»H€‹ùY^\Àõ[ô›»J  H¬à€€ú›[ë^\»H€‹ùY^\Àú€XŸJKH
»Só‘–STW—VT N¬à€€ú››]^\»H€‹ùY^\Àú€XŸJH
»Só‘–STW—VTÀH
»Só‘–STW—VT»
»’U”—ó‘–STW—VT N¬à€€ú›[îõ›‹»H[ë^\Àôõ]X\


HOà^SX\ôŸ]

H◊JN¬à€€ú››]õ›‹»H›]^\Àôõ]X\


HOà^SX\ôŸ]

H◊JN¬à€€ú›[ëûHYôôX›⁄^ôJ[îõ›‹ N¬à€€ú››]ûHYôôX›⁄^ôJ›]õ›‹ N¬Çà]ŸôTò][Œàù[Xô\àù[Hù[¬à]ô\ôX›à›ö[ôŒ¬àYà
[ëûôYôôX›OOHù[›]ûôYôôX›OOHù[
H¬àô\ôX›HíSî’QëíP“QSï—UH
ôYY]X\›»’PìH[ô»–U“’Sî’PìH^\»€àõ›⁄Y\ Hé¬àH[ŸHYà
[ëûôYôôX›OOH
H¬àô\ôX›HíSó‘–STW—QëëP’÷ëTì»
ÿ[õõ›€€\]HHò][ Hé¬àH[ŸH¬àŸôTò][»HX]úõ›[ô

›]ûôYôôX›»[ëûôYôôX›
H
àL
H»L¬àYà
X]ú⁄Y€ä›]ûôYôôX›
HOOHX]ú⁄Y€ä[ëûôYôôX›
JH¬àô\ôX›Hî“Q”ó—ìTQ
YôôX›ô]ô\úŸY›][Ÿã\ÿ[\H8†%ZŸ[H›ô\ôö]»õ›H›XõH]\õàY]
Hé¬àH[ŸHYà
ŸôTò][»èHRSó’—ëW’ëT“”
H¬àô\ôX›HîT‘»
›][Ÿã\ÿ[\Hô]Z[ú»èHà
»
RSó’—ëW’ëT“”
àL
H
»âHŸà[ã\ÿ[\HYôôX›
Hé¬àH[ŸH¬àô\ôX›HëêRS
›][Ÿã\ÿ[\HYôôX›Xÿ^\»ô[›»Hà
»
RSó’—ëW’ëT“”
àL
H
»âHô\⁄€8†%ôX][ã\ÿ[\HYôôX›⁄]ÿ]][€äHé¬àBàBà⁄[ô›‹Àú\⁄
¬à[îÿ[\Q^\Œà⁄[ë^\÷ÃK[ë^\÷⁄[ë^\Àõ[ô›HWWKà›]Ÿîÿ[\Q^\Œà€›]^\÷ÃK›]^\÷€›]^\Àõ[ô›HWWKà[îÿ[\QYôôX›à[ëûôYôôX›OHù[»X]úõ›[ô
[ëûôYôôX›
àL
H»Làù[à›]Ÿîÿ[\QYôôX›à›]ûôYôôX›OHù[»X]úõ›[ô
›]ûôYôôX›
àL
H»Làù[àŸôTò][Ààô\ôX›àJN¬àBÇà€€ú›\‹–€›[ùH⁄[ô›‹Àôö[\ä
 HOàÀùô\ôX›ú›\ù’⁄]
îT‘»äJKõ[ô›¬à€€ú›òZ[€›[ùH⁄[ô›‹Àôö[\ä
 HOàÀùô\ôX›ú›\ù’⁄]
ëêRSäHÀùô\ôX›ú›\ù’⁄]
î“Q”ó—ìTQäJKõ[ô›¬à€€ú›[ú›YôöX⁄Y[ù€›[ùH⁄[ô›‹Àõ[ô›H\‹–€›[ùHòZ[€›[ù¬Çàô]\õàÀöú€€ä¬àõÿíYàõÿãöYà\›[ò›òY[ô—^\–]òZ[XõNà€‹ùY^\Àõ[ô›à^\‘ô\]Z\ôY\ï⁄[ô›ŒàSó‘–STW—VT»
»’U”—ó‘–STW—VTÀà⁄[ô›‹–€€\]Yà⁄[ô›‹Àõ[ô›à⁄[ô›‹Àà›ô\ò[à¬à\‹–€›[ùòZ[€›[ù[ú›YôöX⁄Y[ù€›[ùàKàõ›Nà⁄[ô›‹Àõ[ô›OOHà»õ›[õ›Y⁄\›[ò›òY[ô»^\»[ôŸ\›YY]8†%ôYY]X\›	“Só‘–STW—VT»
»’U”—ó‘–STW—VTﬂH\›[ò›^\À\»õÿà\»	‹€‹ùY^\Àõ[ô›Kà[ôŸ\›[‹ôH\›‹ûH
‹àÿZ]õ‹àZ[HXÿ›[][][€äH[ôôKX⁄X⁄»\»[ô⁄[ù⁄]Hÿ[YHõÿíY8†%õ»òXúöXÿ]Yô\›[\»ô]\õôY[àHYX[ù[YKòààîôXYXX⁄⁄[ô›»Yù]À\öY⁄
€\›ö\ú›
KàT‘»YX[ú»H[ã\ÿ[\HYôôX›[\›][Ÿã\ÿ[\H][YH8†%H€‹Ÿ\à»€€ú⁄\›[ùHT‘»X‹õ‹‹»⁄[ô›‹ÀH[‹ôH\»€⁄‹»ZŸHHôX[Ÿ[ô\ò[^ö[ô»]\õàò]\à[à[à\ùYòX›Ÿà€ôHX⁄ﬁH›ô]⁄Ÿà^\ÀàãàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàï—ëHòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äÇà
à‘’ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹òYÀ‹]Y\ûBà
àõŸNà»‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[‹œ»Bà
à€€\]\»‹ôYŸ[à‹ôYZ‹»õ‹àH⁄]ô[à
\›]Xÿ[‹à]ôK[ÿúŸ\ùôY
Bà
à€€ùòX›⁄\K[àö[ô»H[‹›⁄[Z[\à\›‹öXÿ[õ›‹»[ôXYBà
à[ôŸ\›YöXHÿòX⁄›\›‹ù[ãûH€‹⁄[ôH⁄[Z[\ö]H›ô\àH‹ôYZ‹»ôX]\ôBà
àôX›‹ãà\ôH€⁄›\8†%ôXY[€õKõ»⁄YHYôôX›»€à]ôH›]KÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãú‹›
ã‹òYÀ‹]Y\ûHã\ﬁ[ò»
 HOà¬àûH¬à€€ú›õŸHH]ÿZ]Àúô\Köú€€ä
Kòÿ]⁄


HOàù[
N¬à€€ú›»‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[‹»HHõŸHœ»ﬂN¬àYà
\[Ÿà‹›OOHõù[Xô\àà\[Ÿà›öZŸHOOHõù[Xô\àà\[Ÿà]î\òŸ[ùOOHõù[Xô\àà\[Ÿà^\’—^\ûHOOHõù[Xô\àà\[Ÿà\–ÿ[OOHòõ€€X[àäH¬àô]\õàÀöú€€ä»\úõ‹éàêõŸH]\›[ò€YHù[Y\öX»‹››öZŸK]î\òŸ[ù^\’—^\ûH[ôõ€€X[à\–ÿ[ààK
N¬àBàYà
Ÿôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^õ[ô›OOH
H¬àô]\õàÀöú€€ä»\úõ‹éàïôX›‹à[ô^\»[\H8†%ù[à]X\›€ôHÿòX⁄›\›‹ù[àõÿàö\ú›»‹[]H\›‹öXÿ[[ò[Ÿ‹ÀààKJN¬àBà€€ú›Y»Hÿ[–Yò[òŸY‹ôYZ‹ ‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[
N¬àYà
XY Hô]\õàÀöú€€ä»\úõ‹éàòÿ[–Yò[òŸY‹ôYZ‹»ô]\õôYù[õ‹àH⁄]ô[à[ú]»
⁄X⁄»‹›‹›öZŸK⁄]î\òŸ[ùŸ^\’—^\ûJKààK
N¬à€€ú›]Y\ûUôX›‹àHŸôõ[ôTô\ŸX\ò⁄ôX]\ôUôX›‹äYÀ]î\òŸ[ù^\’—^\ûJN¬à€€ú›»HX]õZ[äX]õX^
Kù[Xô\ä‹ HJKL
N¬à€€ú›ÿ€‹ôYHŸôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^àõX\

[ùûJHOà
»⁄[Z[\ö]Nà€‹⁄[ôT⁄[Z[\ö]J]Y\ûUôX›‹ã[ùûKùôX›‹äKôX€‹ôà[ùûKúôX€‹ôJJBàú€‹ù

KäHOàãú⁄[Z[\ö]HHKú⁄[Z[\ö]JBàú€XŸJ N¬à€€ú›»ô\ôX›õY‹»HH€\‹⁄YûPYò[òŸY‹ôYZ‹‘õ› Y N¬àô]\õàÀöú€€ä¬à]Y\ûNà»‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[Yò[òŸY‹ôYZ‹ŒàYÀô\ôX›õY‹»KàX]⁄\Œàÿ€‹ôYõX\

 HOà
»⁄[Z[\ö]NàX]úõ›[ô
Àú⁄[Z[\ö]H
àL
H»LããúÀúôX€‹ôJJKàõ›Nàí\›‹öXÿ[⁄[Z[\ö]H€õH8†%õ›H]ôHòYH⁄Y€ò[à\»[Ÿ[Hô]ô\à›X⁄\»HLLàÿ[ôY]K\Ÿ[X›[€à‹à[Y‹ò[H[\ù]ÀàãàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîêQ»]Y\ûHòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬Çã äàSUHÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹ô\Ÿ]8†%€X\ú»[ã[Y[[‹ûHõÿú»
»ôX›‹à[ô^
]à€€ùô[öY[òŸKõ»]ôK\›]H[\X›
Kà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãô[]Jã‹ô\Ÿ]ã
 HOà¬àûH¬àŸôõ[ôTô\ŸX\ò⁄õÿúÀò€X\ä
N¬àŸôõ[ôTô\ŸX\ò⁄ôX›‹í[ô^õ[ô›H¬àô]\õàÀöú€€ä»⁄ŒàùYKõ›NàìŸôõ[ôK\ô\ŸX\ò⁄[ã[Y[[‹ûH›]H€X\ôYà]ôH\⁄õÿ\ô”LLã’[Y‹ò[H]»Ÿ\ôHô]ô\à›X⁄YààJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîô\Ÿ]òZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬ÇãÀ»KKKH[à\›‹öXÿ[]H[ôŸ\›[€à
ôXY[€õJHKKKKKKKKKKKKKKKKKKKKKKKKKKKKBãÀ¬ãÀ»ö[»HÿòX⁄›\›‹ù[à\[[ôHXõ›ôHúõ€HëPS[à\›‹ûH[ú›XYŸÇãÀ»ô\]Z\ö[ô»[›H»[ôXùZ[Hî””à\úò^H[›\úŸ[ãà\Ÿ\»”ìHH[ÇãÀ»[ô⁄[ù\»€ŸXò\ŸH\»[ôXYH]ôK]ô\öYöYY[Ÿ]⁄\ôBãÀ»
›åãÿ⁄\ùÀ⁄\›‹öXÿ[8†%€€ôö\õYYT‘»⁄]‹[ã⁄Y⁄€›Àÿ€‹ŸK›õ€[YK¬ãÀ»[Y\›[\\úò^\»ûH[ê]Y]‹›\›‹ûJ
JKÿ[Y⁄XŸNà€òŸHõ‹àBãÀ»[ô\õZ[ô»[ô^
‹›\à^JH[ô€òŸHõ‹àH‹X⁄YöX»‹[€à€€ùòX›ãÀ»
ô[Z][H\à^JKà][Xô\ò][HŸ\»ì’\ŸHHô]Ÿ\à›åãÿ⁄\ùÀ¬ãÀ»õ€[ô€‹[€à[ô⁄[ù
⁄X⁄\»€ŸXò\ŸI‹»›€àåÀQ]Y]€€[Y[ù¬ãÀ»õY»\»õõ›H€€ôö\õYYÿ⁄[XHà8†%]»[\YY›õ€][]K‹‹›öY[¬ãÀ»]ôHô]ô\àôY[à⁄X⁄ŸYYÿZ[ú›H]ôHô\‹€úŸH\ôJK€»\»õ›¬ãÀ»ùZ[€à[à[ùô\öYöYYõ›[ô][€ãà[ú›XYUà\»[\YY›\úŸ[ô\»öXBãÀ»ö\ŸX›[€àYÿZ[ú›Hÿ[YHÿ[–Yò[òŸY‹ôYZ‹ 
HöXŸ\à[ôXYH\ŸYãÀ»]ôK€»H⁄€H\[[ôH\»Ÿ[ãX€€ú⁄\›[ù[ô»[ôÇãÀ¬ãÀ»[›H›\HH‹[€à€€ùòX›	‹»›€à[àŸX›\ö]RY
Ÿ]]úõ€H[›\ÇãÀ»^\›[ô»ÿ\KŸ[ãÿ€€ùòX›»‹àH‹[€ãX⁄Z[à[ô⁄[ù K]»›öZŸBãÀ»[ô^\ûH]H8†%\»[Ÿ[HŸ\»õ›ô\€€ôH‹ŸH€à]»›€ã€»]ãÀ»ÿ[àô]ô\à›Y\‹»‹õ€ô»Xõ›]⁄X⁄€€ùòX›]	‹»öX⁄[ôÀÇÇôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄[ï[Y\›[\—]T›äŒàù[Xô\äNà›ö[ô»¬àÀ»Z\úõ‹ú»H\ÿ⁄\ŸX€€ôÀ]úÀ[Z[\ŸX€€ô»]\ö\›X»[ôXYH\ŸYûBàÀ»[ê]Y]‹›\›‹ûJ
HXõ›ôH
»àLOàZ[\ŸX€€ô KÇà€€ú›\»H»àLÃÃÃ»»à»
àL¬àô]\õàô]»]J\ Kù“T”‘›ö[ô 
Kú€XŸJL
N¬üBÇã äàö\ŸX›[€àŸX\ò⁄õ‹àHUà]XZŸ\»ÿ[–Yò[òŸY‹ôYZ‹…»[‹ô]Xÿ[à
àô[Z][HX]⁄[àÿúŸ\ùôYX\öŸ]ô[Z][Kàõ›[ôY]\ò][€à€›[ù€»Bà
àòY⁄[\‹‹⁄XõH\ôŸ]
KôÀàô[Z][HXõ›ôH[ùö[ú⁄X ⁄YŸH^ö[ú⁄X Bà
àÿ[àô]ô\à‹[àõ‹ô]ô\à8†%]ù\›ô]\õú»H€‹Ÿ\›úòX⁄Ÿ]õ›[ôà
ã¬ôù[ò›[€àŸôõ[ôTô\ŸX\ò⁄[\R]äà‹›àù[Xô\ã›öZŸNàù[Xô\ã^\’—^\ûNàù[Xô\ã\–ÿ[àõ€€X[ã\ôŸ]ô[Z][Nàù[Xô\ÇäNàù[Xô\àù[¬à]»HçKHHÃ»À»çIKãåÃ	HUàŸX\ò⁄ò[ôà€€ú›öXŸP]H
]î›àù[Xô\äHOàÿ[–Yò[òŸY‹ôYZ‹ ‹››öZŸK]î›^\’—^\ûK\–ÿ[
OÀù[‹ô]Xÿ[ô[Z][N¬à€€ú›öXŸS»HöXŸP]
 N¬à€€ú›öXŸRHHöXŸP]
JN¬àYà
öXŸS»OHù[öXŸRHOHù[
Hô]\õàù[¬àYà
\ôŸ]ô[Z][HHöXŸS Hô]\õàŒ¬àYà
\ôŸ]ô[Z][HèHöXŸRJHô]\õàN¬àõ‹à
]]\àH»]\à»]\ä  H¬à€€ú›ZYH
»
»JH»é¬à€€ú›öXŸSZYHöXŸP]
ZY
N¬àYà
öXŸSZYOHù[
Hô]\õàù[¬àYà
X]òXú öXŸSZYH\ôŸ]ô[Z][JHåJHô]\õàZY¬àYà
öXŸSZY\ôŸ]ô[Z][JH»HZY»[ŸHHHZY¬àBàô]\õà
»
»JH»é¬üBÇö[ù\ôòXŸH[í\›‹öXÿ[ÿ[ô\»¬à‹[éàù[Xô\ñ◊N»Y⁄àù[Xô\ñ◊N»›Œàù[Xô\ñ◊N»€‹ŸNàù[Xô\ñ◊N»õ€[YNàù[Xô\ñ◊N»[Y\›[\àù[Xô\ñ◊N¬à äà€õHô\Ÿ[ù€YX[ö[ôŸù[õ‹à‹[€ãŸù]\ôHY‹»
ô\]Y\›YöXBà
à[ò€YS⁄O]ùYHô[› H8†%[ôXŸ\»ÿ\úûHõ»“K€»[ô\õZ[ô»ô]⁄\¬à
àô]ô\àô\]Y\›]à
ã¬à⁄OŒàù[Xô\ñ◊N¬üBÇò\ﬁ[ò»ù[ò›[€àŸôõ[ôTô\ŸX\ò⁄ô]⁄[í\›‹öXÿ[
àXÿŸ\‹’⁄Ÿ[éà›ö[ôÀ€Y[ùYà›ö[ôÀàŸX›\ö]RYà›ö[ôÀ^⁄[ôŸTŸY€Y[ùà›ö[ôÀ[ú›ù[Y[ùà›ö[ôÀàúõ€Q]Nà›ö[ôÀ—]Nà›ö[ôÀà[ò€YS⁄Nàõ€€X[àHò[ŸBäNàõ€Z\ŸO»⁄ŒàùYN»ÿ[ô\Œà[í\›‹öXÿ[ÿ[ô\»H»⁄Œàò[ŸN»\úõ‹éà›ö[ô»Oà¬àûH¬à€€ú›ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ⁄\›‹öXÿ[ã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJ»ŸX›\ö]RY^⁄[ôŸTŸY€Y[ù[ú›ù[Y[ù^\ûP€ŸNà⁄Nà[ò€YS⁄Kúõ€Q]K—]HJKàJN¬à€€ú›ò]»H]ÿZ]ô\Àù^

N¬à]^[ÿYà[ûHHù[¬àûH»^[ÿYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»^[ÿYHù[»BàYà
\ô\Àõ⁄»\^[ÿY\[Ÿà^[ÿYOOHõÿöôX›äH¬à€€ú›õ›öY\ì\Ÿ»H^[ÿYÀô\úõ‹ìY\‹ÿYŸH	‹ô\Àú›]\ﬂX¬àô]\õà»⁄Œàò[ŸK\úõ‹éàë[à\›‹öXÿ[ô\]Y\›òZ[Yàà
»õ›öY\ì\Ÿ»N¬àBà€€ú›»‹[ãY⁄›À€‹ŸKõ€[YK[Y\›[\⁄HHH^[ÿY¬àYà
V€‹[ãY⁄›À€‹ŸKõ€[YK[Y\›[\Kô]ô\ûJ
JHOà\úò^Kö\–\úò^JJJJH¬àô]\õà»⁄Œàò[ŸK\úõ‹éàë[à\›‹öXÿ[ô\‹€úŸHZ\‹⁄[ô»€ôH‹à[‹ôHŸà‹[ã⁄Y⁄€›Àÿ€‹ŸK›õ€[YK›[Y\›[\\úò^\ÀààN¬àBàô]\õà»⁄ŒàùYKÿ[ô\Œà»‹[ãY⁄›À€‹ŸKõ€[YK[Y\›[\⁄Nà\úò^Kö\–\úò^J⁄JH»⁄Hà[ôYö[ôYHN¬àHÿ]⁄
\úäH¬àô]\õà»⁄Œàò[ŸK\úõ‹éà\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäHN¬àBüBÇã äÇà
à‘’ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[à
àõŸNà¬à
àﬁ[Xõ€àìíQïHüêêSí”íQïHüî—Sî—VüëíSìíQïHüìRQ‘íQïHãà
à‹[€îŸX›\ö]RYà›ö[ôﬂù[Xô\ãÀ»H‘P“QíP»€€ùòX›	‹»[àŸX›\ö]HQà
à›öZŸNàù[Xô\ãà
à^\ûQ]Nà›ö[ôÀÀ»ñVVVKSSKQÇà
à\–ÿ[àõ€€X[ãà
àúõ€Q]Nà›ö[ôÀ—]Nà›ö[ô»À»ñVVVKSSKQÇà
àBà
àô]⁄\»ôX[[à\›‹ûH
ôXY[€õJK[\Y\»Uà\à^HYÿZ[ú›Bà
à]ôHÿ[–Yò[òŸY‹ôYZ‹»öXŸ\ã[à[ô»Hô\›[[ô»ôX€‹ô»»Bà
à–SQH⁄[öŸY€õ€ãXõÿ⁄⁄[ô»ù[ìŸôõ[ôTô\ŸX\ò⁄òX⁄›\›

Hõÿà\[[ôH\¬à
àÿòX⁄›\›‹ù[à8†%€»\»\»ù\›[à[\õò]KôX[Y]KXòX⁄ŸYÿ^H¬à
à‹[]HHõÿãõ›HŸX€€ô€ŸH]Çà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãú‹›
ã⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[ã\ﬁ[ò»
 HOà¬àûH¬à€€ú›õŸHH]ÿZ]Àúô\Köú€€ä
Kòÿ]⁄


HOàù[
N¬à€€ú›ﬁ[Xõ€H›ö[ô õŸOÀúﬁ[Xõ€àäKùö[J
Kù’\\êÿ\ŸJ
N¬à€€ú›‹[€îŸX›\ö]RYHõŸOÀõ‹[€îŸX›\ö]RY¬à€€ú››öZŸHHù[Xô\äõŸOÀú›öZŸJN¬à€€ú›^\ûQ]HH›ö[ô õŸOÀô^\ûQ]HàäN¬à€€ú›\–ÿ[HHXõŸOÀö\–ÿ[¬à€€ú›úõ€Q]HH›ö[ô õŸOÀôúõ€Q]HàäN¬à€€ú›—]HH›ö[ô õŸOÀù—]HàäN¬ÇàYà
\ﬁ[Xõ€‹[€îŸX›\ö]RYOHù[Sù[Xô\ãö\—ö[ö]J›öZŸJHY^\ûQ]HYúõ€Q]H]—]JH¬àô]\õàÀöú€€ä»\úõ‹éàêõŸH]\›[ò€YHﬁ[Xõ€‹[€îŸX›\ö]RY›öZŸK^\ûQ]K\–ÿ[úõ€Q]K—]KààK
N¬àBà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô H¬àô]\õàÀöú€€ä»\úõ‹éà[ö€õ›€àﬁ[Xõ€â‹ﬁ[Xõ€Hãà›\‹ùYà	”ÿöôX›öŸ^\ Só’SëTìRSë◊”PT
Köõ⁄[äãä_XK
N¬àBà€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àô]\õàÀöú€€ä»\úõ‹éàë[àõ›€€ôöY›\ôY
Só–P–—T‘◊’“—Sãÿ]]À\ôYúô\⁄‹àSó–”QSï“QZ\‹⁄[ô KààKL N¬àBÇàÀ»Kà[ô\õZ[ô»‹›\›‹ûH8†%H””ëíTìQQ]€‹ö⁄[ô»ÿ[‹⁄\KÇàÀ»[ôXŸ\»ÿ\úûHõ»“K€»\»ô]⁄ô]ô\àô\]Y\›»]Çà€€ú›‹›ô\›[H]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ô]⁄[í\›‹öXÿ[
àXÿŸ\‹’⁄Ÿ[ã€Y[ùY›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
KX\[ôÀù[ô\õZ[ô‘ŸYÀíSëVãúõ€Q]K—]Kò[ŸBà
N¬àYà
\‹›ô\›[õ⁄ Hô]\õàÀöú€€ä»\úõ‹éàï[ô\õZ[ô»ô]⁄òZ[Yàà
»‹›ô\›[ô\úõ‹àKLäN¬ÇàÀ»ãà\»‹X⁄YöX»‹[€à€€ùòX›	‹»›€àô[Z][J”“H\›‹ûH8†%ÿ[YBàÀ»[ô⁄[ù‹⁄\KYôô\ô[ùŸX›\ö]RY‹ŸY€Y[ù⁄[ú›ù[Y[ùà“H\¬àÀ»ô\]Y\›Y
[ò€YS⁄O]ùYJH€»⁄T›]KŸÿ[[XKY^‹›\ôHÿ[àôBàÀ»€€\]Y[€ô‹⁄YHH‹ôYZ‹À[ú›]][€ò[Y\⁄»›[KÇà€€ú›‹[€ú‘ŸY€Y[ùHﬁ[Xõ€OOHî—Sî—Và»êî—W—ìì»ààìî—W—ìì»é¬à€€ú›‹[€îô\›[H]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ô]⁄[í\›‹öXÿ[
àXÿŸ\‹’⁄Ÿ[ã€Y[ùY›ö[ô ‹[€îŸX›\ö]RY
K‹[€ú‘ŸY€Y[ùì‘Qãúõ€Q]K—]KùYBà
N¬àYà
[‹[€îô\›[õ⁄ Hô]\õàÀöú€€ä»\úõ‹éàì‹[€à€€ùòX›ô]⁄òZ[Yàà
»‹[€îô\›[ô\úõ‹àKLäN¬ÇàÀ»ùZ[H]HOà‹›€‹ŸK⁄Y⁄€›»X\SëH]K\€‹ùYŸ\öY\»
BàÀ»]\àôYYYõ‹àHòZ[[ôÀLåY^H\ö⁄[ú€€àôX[^ôY]õ€⁄[ô›¬àÀ»[ôõ‹à€⁄⁄[ô»\ù⁄]Y‹›X›X[H»ûH^\ûHäKàôXY[€õBàÀ»€⁄›\õ»]]][€àŸà[ûH]ôHŸ\‹⁄[€ã€X\öŸ]Y]H›]H[Ÿ]⁄\ôBàÀ»[à\»ö[KÇà€€ú›‹›ûQ]HHô]»X\›ö[ôÀ»€‹ŸNàù[Xô\é»Y⁄àù[Xô\é»›Œàù[Xô\àOä
N¬à‹›ô\›[òÿ[ô\Àù[Y\›[\ôõ‹ëXX⁄

ÀJHOà¬à‹›ûQ]KúŸ]
Ÿôõ[ôTô\ŸX\ò⁄[ï[Y\›[\—]T›ä K¬à€‹ŸNà‹›ô\›[òÿ[ô\Àò€‹ŸV⁄WKY⁄à‹›ô\›[òÿ[ô\ÀöY⁄⁄WK›Œà‹›ô\›[òÿ[ô\Àõ›÷⁄WKàJN¬àJN¬à€€ú›‹›Ÿ\öY\‘€‹ùYH\úò^Kôúõ€J‹›ûQ]Kô[ùöY\ 
JBàõX\

Ÿ]KóJHOà
»]KããùàJJBàú€‹ù

KäHOà
Kô]Hãô]H»LHàKô]Hàãô]H»Hà
JN¬à€€ú›‹›]R[ô^Hô]»X\›ö[ôÀù[Xô\èä
N¬à‹›Ÿ\öY\‘€‹ùYôõ‹ëXX⁄

õ›ÀY
HOà‹›]R[ô^úŸ]
õ›Àô]KY
JN¬ÇàÀ»òZ[[ôÀSãY^H\ö⁄[ú€€àôX[^ôYõ€][]H[ô[ô»]
[ôàÀ»[ò€Y[ô HH⁄]ô[à]K[õùX[^ôY»H\òŸ[ù8†%\ôX›BàÀ»€€\\òXõH»]î\òŸ[ùà›[ô\ô\›[X]‹éà[‹ôHÿ[\KYYôöX⁄Y[ùàÀ»[à€‹ŸK]ÀX€‹ŸHõ‹àHÿ[YH⁄[ô›»ôXÿ]\ŸH]\Ÿ\»XX⁄^I‹¬àÀ»ù[Y⁄[›»ò[ôŸKõ›ù\›H€‹ŸKÇà€€ú›Tí“Sî””ó’“Së’»Hå¬àù[ò›[€à\ö⁄[ú€€îùî›[ô[ô–]
]T›éà›ö[ô Nàù[Xô\àù[¬à€€ú›YH‹›]R[ô^ôŸ]
]T›äN¬àYà
YOHù[Y
»HTí“Sî””ó’“Së’ Hô]\õàù[¬à€€ú›⁄[ô›»H‹›Ÿ\öY\‘€‹ùYú€XŸJYHTí“Sî””ó’“Së’»
»KY
»JN¬à]›[T‹HH¬àõ‹à
€€ú›^HŸà⁄[ô› H¬àYà
J^KöY⁄à
HJ^Kõ›»à
H^KöY⁄^Kõ› Hô]\õàù[¬à€€ú›íHX]õŸ ^KöY⁄»^Kõ› N¬à›[T‹H
œHí
àí¬àBà€€ú›ò\öX[òŸHH›[T‹H»

àX]ìåà
àTí“Sî””ó’“Së’ N¬àYà
Sù[Xô\ãö\—ö[ö]Jò\öX[òŸJHò\öX[òŸH
Hô]\õàù[¬àô]\õàX]úõ›[ô
X]ú‹\ù
ò\öX[òŸJH
àX]ú‹\ù
çLäH
àL
àL
H»L¬àBÇà€€ú›^\ûS\»Hô]»]J^\ûQ]H
»ïååàäKôŸ][YJ
N¬àYà
ù[Xô\ãö\”òSä^\ûS\ JHô]\õàÀöú€€ä»\úõ‹éà[ùò[Y^\ûQ]HâŸ^\ûQ]_Hà
^X›YVVVKSSKQ
KòK
N¬àÀ»‹›€à
‹àôX\ô\›òY[ô»^H]ÿYù\äH^\ûKYà]]Hò[¬àÀ»[ú⁄YHH[ôŸ\›Y[ô\õZ[ô»⁄[ô›»8†%\ŸYõ‹àH[\YY]úÀBàÀ»ôX[^ôY[[›ôH€€\\ö\€€ãàYù[ôYö[ôY
õ››Y\‹ŸY
H⁄[àBàÀ»⁄[ô›»Ÿ\€â›ôXX⁄]ò\ãÇà€€ú›^\ûQ]S€õT›àH^\ûQ]N¬à€€ú›õ‹ùÿ\ô‹›]^\ûHH‹›ûQ]KôŸ]
^\ûQ]S€õT›äOÀò€‹ŸBàœ»‹›Ÿ\öY\‘€‹ùYôö[ô

õ› HOàõ›Àô]HèH^\ûQ]S€õT›äOÀò€‹ŸN¬Çà€€ú›ôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊HH◊N¬à]⁄⁄\YH¬à€€ú›‹ÿ[ô\»H‹[€îô\›[òÿ[ô\Œ¬àõ‹à
]HH»H‹ÿ[ô\Àù[Y\›[\õ[ô›»J  H¬àûH¬à€€ú›]T›àHŸôõ[ôTô\ŸX\ò⁄[ï[Y\›[\—]T›ä‹ÿ[ô\Àù[Y\›[\⁄WJN¬à€€ú›‹›õ›»H‹›ûQ]KôŸ]
]T›äN¬à€€ú›ô[Z][HH‹ÿ[ô\Àò€‹ŸV⁄WN¬àYà
‹›õ›»OHù[Sù[Xô\ãö\—ö[ö]J‹›õ›Àò€‹ŸJHSù[Xô\ãö\—ö[ö]Jô[Z][JHô[Z][HH
H»⁄⁄\Y
 Œ»€€ù[ùYN»Bà€€ú›‹›H‹›õ›Àò€‹ŸN¬à€€ú›^S\»Hô]»]J]T›à
»ïååàäKôŸ][YJ
N¬à€€ú›^\’—^\ûHHX]õX^
X]úõ›[ô

^\ûS\»H^S\ H»óÕÃ
JN¬à€€ú›[\YY]àHŸôõ[ôTô\ŸX\ò⁄[\R]ä‹››öZŸK^\’—^\ûK\–ÿ[ô[Z][JN¬àYà
[\YY]àOHù[
H»⁄⁄\Y
 Œ»€€ù[ùYN»Bà€€ú›⁄HH‹ÿ[ô\Àõ⁄OÀñ⁄WN¬à€€ú›⁄Tô]ë^HHHà»‹ÿ[ô\Àõ⁄OÀñ⁄HHWHà[ôYö[ôY¬àôX€‹ôÀú\⁄
¬à[Y\›[\à]T›ãﬁ[Xõ€‹››öZŸK]î\òŸ[ùà[\YY]ã^\’—^\ûK\–ÿ[à⁄Nà\[Ÿà⁄HOOHõù[Xô\àà»⁄Hà[ôYö[ôYà⁄Tô]ë^Nà\[Ÿà⁄Tô]ë^HOOHõù[Xô\àà»⁄Tô]ë^Hà[ôYö[ôYàôX[^ôYõ€›à\ö⁄[ú€€îùî›[ô[ô–]
]T›äHœ»[ôYö[ôYàõ‹ùÿ\ô‹›]^\ûNà^S\»H^\ûS\»»õ‹ùÿ\ô‹›]^\ûHà[ôYö[ôYàJN¬àHÿ]⁄¬à⁄⁄\Y
 Œ¬àBàYà

H
»JH	H—ëìSëW‘ëT—PTê“–êU“‘“VëHOOH
H]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ZY[

N¬àBÇàYà
ôX€‹ôÀõ[ô›OOH
H¬àô]\õàÀöú€€ä»\úõ‹éàìõ»\ÿXõHôX€‹ô»ùZ[
‹›‹ô[Z][H]\»Yâ››ô\õ\‹àUà€›[õ›ôH[\YYõ‹à[ûH^JKàã⁄⁄\YKåäN¬àBÇà€€ú›õÿéàòX⁄›\›õÿàH¬àYàŸôõ[ôTô\ŸX\ò⁄õÿíY

K›]\ŒàîUQUQQãà›[ôX€‹ôŒàôX€‹ôÀõ[ô›õÿŸ\‹ŸYôX€‹ôŒàà›\ùY]à]Kõõ› 
Kö[ö\⁄Y]àù[\úõ‹éàù[ô\›[Œà◊KàN¬àŸôõ[ôTô\ŸX\ò⁄õÿúÀúŸ]
õÿãöYõÿäN¬àõ⁄Yù[ìŸôõ[ôTô\ŸX\ò⁄òX⁄›\›
õÿãôX€‹ô Kòÿ]⁄

\úäHOà¬àõÿãú›]\»HëêRSQé¬àõÿãô\úõ‹àH\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäN¬àõÿãôö[ö\⁄Y]H]Kõõ› 
N¬àJN¬Çàô]\õàÀöú€€ä¬àõÿíYàõÿãöY›]\Œàõÿãú›]\ÀàôX€‹ô“[ôŸ\›YàôX€‹ôÀõ[ô›ôX€‹ô‘⁄⁄\Yà⁄⁄\Yàõ›NàíUàÿ\»[\YYÿÿ[HöXHö\ŸX›[€àYÿZ[ú›ÿ[–Yò[òŸY‹ôYZ‹»8†%õ›ôXY\ôX›Húõ€H[à
[â‹»›€à[\YY›õ€][]HöY[[à›åãÿ⁄\ùÀ‹õ€[ô€‹[€ã\»õ›Y]ÿ⁄[XKX€€ôö\õYY[à\»€ŸXò\ŸJKàXX⁄^H[€»ÿ\úöY\»“Hõ›ÀUã]úÀ\ôX[^ôY]õ€‹ôXY[ô[\YY]úÀ\ôX[^ôY[›ôH
[ú›]][€ò[\›[H€€ù^
H⁄\ôHH]H[›‹»]à€ÿòX⁄›\›‹›]\ÀŒöõÿíYô^àãàKåäN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàí[ôŸ\›[€àòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬ã äÇà
à‘’ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûBà
àõŸNà»ﬁ[Xõ€⁄YNàê—HüîHãúõ€Q]K—]K^\ûUŸYZŸ^O»Bà
Çà
àHõ‹\à€€õ‹àHôX[USKQVTñHK^YX\àòX⁄›\›àHôY›[\Çà
à⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[Xõ›ôH€õH€‹ö‹»õ‹à”ëH[ôXYKZY[ùYöYYà
à›[[\›Y€€ùòX›8†%[ô[â‹»‹[€à⁄Z[à
\ŸY»€⁄»\Bà
à€€ùòX›	‹»ŸX›\ö]RY
H€õH^‹Ÿ\»’TîëSï—ïUTëH^\öY\Àô]ô\Çà
à^\ôY€ô\Àà€»\ôH\»õ»ÿ^H»ÿ[»òX⁄›ÿ\ôŸYZÀXûK]ŸYZ»[ôà
àô\€€ôHXX⁄\›ŸYZ…‹»€€ùòX››\úŸ[ô\Àà[â‹»›€Çà
à›åãÿ⁄\ùÀ‹õ€[ô€‹[€à[ô⁄[ù^\›»»€€ôH^X›H\Œà]à
àô]\õú»H€€ù[ù[›\»ò[ÿ^\À[ôX\ô\›PUHà[YHŸ\öY\»X‹õ‹‹»H]Bà
àò[ôŸKõ€[ô»úõ€H€ôHŸYZ€H^\ûH»Hô^[ù\õò[K[à”ëBà
àÿ[8†%õ»\ã]ŸYZ»ô\€€][€àôYYY€à›\à⁄YKÇà
Çà
à”ëT’Hì’H
ôXYôYõ‹ôHù\›[ô»H›]]
Nà\»€ŸXò\ŸH\»€õBà
à]ô\àì–ëQ›åãÿ⁄\ùÀ‹õ€[ô€‹[€à€òŸHôYõ‹ôH
[àHåÀQ]Y]à
àŸX›[€àXõ›ôJK[ô]õÿôI‹»›€à€€[Y[ùÿ^\»]»^X›ô\‹€úŸBà
àÿ⁄[XH\»õ›\àô\›YYôõ‹ùôXYŸà[â‹»ÿ‹Àõ›H€€ôö\õYYà
àÿ⁄[XHãà€»\»[ô\à\úŸ\»Hô\‹€úŸHQëSî“UëSH8†%]⁄X⁄‹¬à
àõ‹àŸ]ô\ò[]\⁄XõHöY[ò[Y\»ò]\à[à\‹›[Z[ô»€ôH8†%[ô]à
àXZŸ\»”ëHù\ù\à\‹›[\[€à]ÿ[õõ›ô\öYûHúõ€H\ôNà⁄X⁄ŸYZŸ^Bà
àî—I‹»›\úô[ùŸYZ€H^\ûHò[»€à
\ŸY»\›[X]H^\’—^\ûBà
à\àõ›À⁄[òŸHHõ€[ô»Ÿ\öY\»Ÿ\€â›\X\à»ô]\õàXX⁄õ›…‹¬à
à^X›^\ûH]JKà]\‹›[\[€à\»H\ò[Y]\à
^\ûUŸYZŸ^Kà
àYò][àHY\Ÿ^Kî—I‹»ŸYZ€KY^\ûHŸYZŸ^H\»ŸàH[‹›ôXŸ[ùà
à€€ôö\õYY[ôõ‹õX][€à\ŸY[à\»€ŸXò\ŸI‹»òZ[ö[ô H8†%›ô\úöYH]à
àYà[›\àö\ú›ôX[ù[â‹»ô\›[»€⁄»‹õ€ô»
KôÀà^\’—^\ûHô]ô\Çà
àôXX⁄[ô»‹àù[ò⁄[ô»ŸJKÇà
ã¬ã äÇà
à—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹õÿôKŸ[ã\õ€[ôÀ[€⁄ÿòX⁄œ‹ﬁ[Xõ€SíQïIú⁄YOP—Bà
Çà
àö[ô»[â‹»ôX[\›‹öXÿ[€⁄ÿòX⁄»[Z]õ‹à›åãÿ⁄\ùÀ‹õ€[ô€‹[€Çà
à[à”ëHÿ[[ú›XYŸà[›HX[ùX[HûZ[ô»]\»€ôH]H[YKàõÿô\¬à
àŸ]ô\ò[€X[
KY^JH⁄[ô›‹»][ò‹ôX\⁄[ô»\›[òŸ\»[ù»H\›à
à
ÀMKÃKåLLåMLNçÃÕçH^\»òX⁄»úõ€HŸ^JH[ôà
àô\‹ù»⁄X⁄€ô\»›XÿŸYYY8†%Hõ›[ô\ûHô]ŸY[àH\›’P–—T‘»[ôà
àHö\ú›êRSTëH\»[›\àôX[\ÿXõH€⁄ÿòX⁄»⁄[ô›»õ‹Çà
à⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûKàôXY[€õK€X[ô\]Y\›»€õH
H^\¬à
àXX⁄
K[õ›Y⁄Hÿ[YHò]K[[Z]Y]Y]YH\»]ô\ûH›\à[àÿ[à
à\ôKÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ã‹õÿôKŸ[ã\õ€[ôÀ[€⁄ÿòX⁄»ã\ﬁ[ò»
 HOà¬àûH¬à€€ú›ﬁ[Xõ€H
Àúô\Kú]Y\ûJúﬁ[Xõ€äHìíQïHäKùö[J
Kù’\\êÿ\ŸJ
N¬à€€ú›⁄YHH
Àúô\Kú]Y\ûJú⁄YHäHê—HäKùö[J
Kù’\\êÿ\ŸJ
N¬àYà
⁄YHOOHê—Hà	âà⁄YHOOHîHäHô]\õàÀöú€€ä»\úõ‹éàú⁄YH]\›ôH—H‹àKààK
N¬à€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô Hô]\õàÀöú€€ä»\úõ‹éà[ö€õ›€àﬁ[Xõ€â‹ﬁ[Xõ€Hãà›\‹ùYà	”ÿöôX›öŸ^\ Só’SëTìRSë◊”PT
Köõ⁄[äãä_XK
N¬à€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
Hô]\õàÀöú€€ä»\úõ‹éàë[àõ›€€ôöY›\ôYààKL N¬Çà€€ú›‹[€ú‘ŸY€Y[ùHﬁ[Xõ€OOHî—Sî—Và»êî—W—ìì»ààìî—W—ìì»é¬à€€ú›Ÿ^S\»H]Kõõ› 
N¬à€€ú›—ëî—U◊—VT»HÕÀMKÃKåLLåMLNçÃÕçWN¬à€€ú›õ]H
\Œàù[Xô\äHOàô]»]J\ Kù“T”‘›ö[ô 
Kú€XŸJL
N¬Çà€€ú›õÿôTô\›[Œà»ŸôúŸ]^\Œàù[Xô\é»úõ€Nà›ö[ôŒ»Œà›ö[ôŒ»⁄Œàõ€€X[é»]Z[à›ö[ô»V◊HH◊N¬àõ‹à
€€ú›ŸôúŸ]Ÿà—ëî—U◊—VT H¬à€€ú›⁄[ô›—[ô\»HŸ^S\»HŸôúŸ]
àóÕÃ¬à€€ú›⁄[ô›‘›\ù\»H⁄[ô›—[ô\»H
àóÕÃ»À»KY^HõÿôH⁄[ô›¬à€€ú›úõ€HHõ]
⁄[ô›‘›\ù\ N¬à€€ú›»Hõ]
⁄[ô›—[ô\ N¬àûH¬à€€ú›õ€ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ‹õ€[ô€‹[€àã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJ¬à^⁄[ôŸTŸY€Y[ùà‹[€ú‘ŸY€Y[ù[ù\ùò[àåHãŸX›\ö]RYà›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
Kà[ú›ù[Y[ùàì‘Qã^\ûQõYŒàï—QR»ã^\ûP€ŸNàK›öZŸNàêUHãàùì‹[€ï\Nà⁄YHOOHê—Hà»ê–SààîUãàô\]Z\ôY]Nà»ò€‹ŸHãõ⁄Hãö[\YY›õ€][]Hãú‹›óKúõ€Q]Nàúõ€K—]NàÀàJKàJN¬à€€ú›ò]»H]ÿZ]õ€ô\Àù^

N¬à]^[ÿYà[ûHHù[¬àûH»^[ÿYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»^[ÿYHù[»BàYà
\õ€ô\Àõ⁄»\^[ÿY
H¬àõÿôTô\›[Àú\⁄
»ŸôúŸ]^\ŒàŸôúŸ]úõ€KÀ⁄Œàò[ŸK]Z[à
^[ÿYÀô\úõ‹ê€ŸHàäH
»àà
»
^[ÿYÀô\úõ‹ìY\‹ÿYŸH	‹õ€ô\Àú›]\ﬂX
HJN¬àH[ŸH¬à€€ú››]\àH
^[ÿYô]H	âà\[Ÿà^[ÿYô]HOOHõÿöôX›äH»^[ÿYô]Hà^[ÿY¬à€€ú›⁄YQ]HH›]\ñ‹⁄YHOOHê—Hà»òŸHààúHóH›]\é¬à€€ú›\—]HH⁄YQ]H	âà\[Ÿà⁄YQ]HOOHõÿöôX›à	âàÿöôX›ùò[Y\ ⁄YQ]JKú€€YJ
äHOà\úò^Kö\–\úò^JäH	âàãõ[ô›à
N¬àõÿôTô\›[Àú\⁄
»ŸôúŸ]^\ŒàŸôúŸ]úõ€KÀ⁄ŒàHZ\—]K]Z[à\—]H»ô]Hô\Ÿ[ùààúô\‹€úŸH“»ù]õ»õ€ãY[\H\úò^\»õ›[ôàJN¬àBàHÿ]⁄
\úäH¬àõÿôTô\›[Àú\⁄
»ŸôúŸ]^\ŒàŸôúŸ]úõ€KÀ⁄Œàò[ŸK]Z[à\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäHJN¬àBàBÇà€€ú›\››XÿŸ\‹»HÀããúõÿôTô\›[◊Kúô]ô\úŸJ
Kôö[ô

äHOàãõ⁄ N¬à€€ú›ö\ú›òZ[\ôPYù\î›XÿŸ\‹»HõÿôTô\›[Àôö[ô

äHOà\››XÿŸ\‹»	âàãõŸôúŸ]^\»à\››XÿŸ\‹ÀõŸôúŸ]^\»	âà\ãõ⁄ N¬Çàô]\õàÀöú€€ä¬àﬁ[Xõ€⁄YKõÿôY]àõ]
Ÿ^S\ KàõÿôTô\›[ÀàôX€€[Y[ôYÿYôS€⁄ÿòX⁄—^\Œà\››XÿŸ\‹»»\››XÿŸ\‹ÀõŸôúŸ]^\»àù[àôX€€[Y[ôYúõ€Q]Nà\››XÿŸ\‹»»\››XÿŸ\‹Àôúõ€Hàù[àõ›[ô\ûSõ›Nà\››XÿŸ\‹»	âàö\ú›òZ[\ôPYù\î›XÿŸ\‹¬à»\ÿXõH€⁄ÿòX⁄»\»€€Y]⁄\ôHô]ŸY[à	€\››XÿŸ\‹ÀõŸôúŸ]^\ﬂH^\»
€‹öŸY
H[ô	Ÿö\ú›òZ[\ôPYù\î›XÿŸ\‹ÀõŸôúŸ]^\ﬂH^\»
òZ[Y
HòX⁄»úõ€HŸ^Kà\ŸHôX€€[Y[ôYúõ€Q]H\»H–QëH›\ù[ô»⁄[ùõ‹à⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûI‹»úõ€Q]Kòàà\››XÿŸ\‹»»[õÿôYŸôúŸ]»\»	€\››XÿŸ\‹ÀõŸôúŸ]^\ﬂH^\»›XÿŸYYY8†%ûH⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûH⁄]úõ€Q]H]ô[àù\ù\àòX⁄»[à	€\››XÿŸ\‹Àôúõ€_HYà[›Hÿ[ù[‹ôH\›‹ûKòààìõ»ŸôúŸ]›XÿŸYYY8†%⁄X⁄»[à€€ôöY›\ò][€ã‹Ÿ\‹⁄[€ã‹à\»[ô⁄[ùX^Hõ›ôH]òZ[XõH€à[›\à[à[ãàãàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîõÿôHòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãú‹›
ã⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûHã\ﬁ[ò»
 HOà¬àûH¬à€€ú›õŸHH]ÿZ]Àúô\Köú€€ä
Kòÿ]⁄


HOàù[
N¬à€€ú›ﬁ[Xõ€H›ö[ô õŸOÀúﬁ[Xõ€àäKùö[J
Kù’\\êÿ\ŸJ
N¬à€€ú›⁄YHH›ö[ô õŸOÀú⁄YHàäKùö[J
Kù’\\êÿ\ŸJ
N¬à€€ú›úõ€Q]HH›ö[ô õŸOÀôúõ€Q]HàäN¬à€€ú›—]HH›ö[ô õŸOÀù—]HàäN¬à€€ú›^\ûUŸYZŸ^HHù[Xô\ãö\“[ùYŸ\äõŸOÀô^\ûUŸYZŸ^JH»õŸKô^\ûUŸYZŸ^Hàé»À»T›[ããçèTÿ]Yò][Y\Ÿ^BÇàYà
\ﬁ[Xõ€
⁄YHOOHê—Hà	âà⁄YHOOHîHäHYúõ€Q]H]—]JH¬àô]\õàÀöú€€ä»\úõ‹éàêõŸH]\›[ò€YHﬁ[Xõ€⁄YH
—H‹àJKúõ€Q]K—]H
VVVKSSKQ
KààK
N¬àBà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô H¬àô]\õàÀöú€€ä»\úõ‹éà[ö€õ›€àﬁ[Xõ€â‹ﬁ[Xõ€Hãà›\‹ùYà	”ÿöôX›öŸ^\ Só’SëTìRSë◊”PT
Köõ⁄[äãä_XK
N¬àBà€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àô]\õàÀöú€€ä»\úõ‹éàë[àõ›€€ôöY›\ôY
Só–P–—T‘◊’“—Sãÿ]]À\ôYúô\⁄‹àSó–”QSï“QZ\‹⁄[ô KààKL N¬àBÇàÀ»Kà[ô\õZ[ô»‹›\›‹ûH›ô\àHù[ò[ôŸH8†%H””ëíTìQQ]€‹ö⁄[ô¬àÀ»ÿ[‹⁄\KôYYYõ‹àH\ö⁄[ú€€àôX[^ôY]õ€⁄[ô›»[ô\»BàÀ»‹›ò[òX⁄»YàHõ€[ô»ô\‹€úŸHŸ\€â›ÿ\úûH]»›€à‹›Çà€€ú›‹›ô\›[H]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ô]⁄[í\›‹öXÿ[
àXÿŸ\‹’⁄Ÿ[ã€Y[ùY›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
KX\[ôÀù[ô\õZ[ô‘ŸYÀíSëVãúõ€Q]K—]Kò[ŸBà
N¬àYà
\‹›ô\›[õ⁄ Hô]\õàÀöú€€ä»\úõ‹éàï[ô\õZ[ô»ô]⁄òZ[Yàà
»‹›ô\›[ô\úõ‹àKLäN¬à€€ú›‹›ûQ]HHô]»X\›ö[ôÀ»€‹ŸNàù[Xô\é»Y⁄àù[Xô\é»›Œàù[Xô\àOä
N¬à‹›ô\›[òÿ[ô\Àù[Y\›[\ôõ‹ëXX⁄

ÀJHOà¬à‹›ûQ]KúŸ]
Ÿôõ[ôTô\ŸX\ò⁄[ï[Y\›[\—]T›ä K¬à€‹ŸNà‹›ô\›[òÿ[ô\Àò€‹ŸV⁄WKY⁄à‹›ô\›[òÿ[ô\ÀöY⁄⁄WK›Œà‹›ô\›[òÿ[ô\Àõ›÷⁄WKàJN¬àJN¬à€€ú›‹›Ÿ\öY\‘€‹ùYH\úò^Kôúõ€J‹›ûQ]Kô[ùöY\ 
JKõX\

Ÿ]KóJHOà
»]KããùàJJKú€‹ù

KäHOà
Kô]Hãô]H»LHàKô]Hàãô]H»Hà
JN¬à€€ú›‹›]R[ô^Hô]»X\›ö[ôÀù[Xô\èä
N¬à‹›Ÿ\öY\‘€‹ùYôõ‹ëXX⁄

õ›ÀY
HOà‹›]R[ô^úŸ]
õ›Àô]KY
JN¬à€€ú›Tí“Sî””ó’“Së’»Hå¬àù[ò›[€à\ö⁄[ú€€îùî›[ô[ô–]
]T›éà›ö[ô Nàù[Xô\àù[¬à€€ú›YH‹›]R[ô^ôŸ]
]T›äN¬àYà
YOHù[Y
»HTí“Sî””ó’“Së’ Hô]\õàù[¬à€€ú›⁄[ô›»H‹›Ÿ\öY\‘€‹ùYú€XŸJYHTí“Sî””ó’“Së’»
»KY
»JN¬à]›[T‹HH¬àõ‹à
€€ú›^HŸà⁄[ô› H¬àYà
J^KöY⁄à
HJ^Kõ›»à
H^KöY⁄^Kõ› Hô]\õàù[¬à€€ú›íHX]õŸ ^KöY⁄»^Kõ› N¬à›[T‹H
œHí
àí¬àBà€€ú›ò\öX[òŸHH›[T‹H»

àX]ìåà
àTí“Sî””ó’“Së’ N¬àYà
Sù[Xô\ãö\—ö[ö]Jò\öX[òŸJHò\öX[òŸH
Hô]\õàù[¬àô]\õàX]úõ›[ô
X]ú‹\ù
ò\öX[òŸJH
àX]ú‹\ù
çLäH
àL
àL
H»L¬àBÇàÀ»ãàHõ€[ôÀPUH‹[€àŸ\öY\Àà[àÿ\»\»[ô⁄[ù]L^\¬àÀ»\àÿ[
€€ôö\õYY]ôHåçãLLMéà\úõ‹àNLHë]Hõ‹à‹[€ÇàÀ»⁄\ù»ÿ[àôHô]⁄Yõ‹àL^\»]H[YHà⁄[àHù[YX\àÿ\¬àÀ»ô\]Y\›Y[à€ôH⁄›
H8†%€»HK^YX\àò[ôŸH\»ÿ[ŸY[àNKY^BàÀ»⁄[ö‹»
Ÿ\Hô]»^\»[ô\àHÿ\\»X\ô⁄[äH[ô›]⁄YàÀ»ŸŸ]\à\ôKàXX⁄⁄[ö»›[€Ÿ\»õ›Y⁄[îò]S[Z]Yô]⁄àÀ»€»HX[ô]‹ûH[ù\ã\ô\]Y\›‹X⁄[ô»\»ô\‹X›Y]]€X]Xÿ[N¬àÀ»\»€‹Ÿ\»õ›Y[ûH^òHX[ùX[€Y\ÀÇà€€ú›‹[€ú‘ŸY€Y[ùHﬁ[Xõ€OOHî—Sî—Và»êî—W—ìì»ààìî—W—ìì»é¬à€€ú›“Sí◊—VT»HN¬à€€ú›ò[ôŸT›\ù\»Hô]»]Júõ€Q]H
»ïååàäKôŸ][YJ
N¬à€€ú›ò[ôŸQ[ô\»Hô]»]J—]H
»ïååàäKôŸ][YJ
N¬àYà
ù[Xô\ãö\”òSäò[ôŸT›\ù\ Hù[Xô\ãö\”òSäò[ôŸQ[ô\ Hò[ôŸQ[ô\»ò[ôŸT›\ù\ H¬àô]\õàÀöú€€ä»\úõ‹éàí[ùò[Yúõ€Q]K›—]H
^X›YVVVKSSKQúõ€Q]HH—]JKààK
N¬àBà€€ú›⁄[ö‹Œà»úõ€Nà›ö[ôŒ»Œà›ö[ô»V◊HH◊N¬àõ‹à
]⁄[ö‘›\ùHò[ôŸT›\ù\Œ»⁄[ö‘›\ùHò[ôŸQ[ô\Œ»⁄[ö‘›\ù
œH
“Sí◊—VT»
»JH
àóÕÃ
H¬à€€ú›⁄[ö—[ôHX]õZ[ä⁄[ö‘›\ù
»“Sí◊—VT»
àóÕÃò[ôŸQ[ô\ N¬à⁄[ö‹Àú\⁄
»úõ€Nàô]»]J⁄[ö‘›\ù
Kù“T”‘›ö[ô 
Kú€XŸJL
KŒàô]»]J⁄[ö—[ô
Kù“T”‘›ö[ô 
Kú€XŸJL
HJN¬àBÇà€€ú›ôX€‹ôŒà\›‹öXÿ[‹ôYZ‹‘ôX€‹ô◊HH◊N¬à]⁄⁄\YH¬à]]ëöY[ŸY[ê[û]⁄\ôHHò[ŸN¬à]\›ô\‹€úŸRŸ^\—õ›[ôà›ö[ô÷◊HH◊N¬à€€ú›⁄[ö—\úõ‹úŒà»úõ€Nà›ö[ôŒ»Œà›ö[ôŒ»\úõ‹éà›ö[ôŒ»›]\œŒàù[Xô\é»\úõ‹ê€ŸOŒà›ö[ôŒ»\úõ‹ï\OŒà›ö[ôŒ»ô\]Y\›Ÿ[ùŒà[ûN»ò]‘€ö\]Œà›ö[ô»V◊HH◊N¬Çàõ‹à
€€ú›⁄[ö»Ÿà⁄[ö‹ H¬àûH¬à€€ú›õ€õŸHH¬à^⁄[ôŸTŸY€Y[ùà‹[€ú‘ŸY€Y[ùà[ù\ùò[àåHãàÀ»ŸX›\ö]RY\»H’íSë»€à]ô\ûH›\à€€ôö\õYY]€‹ö⁄[ô»[ÇàÀ»ÿ[[à\»€ŸXò\ŸH
Ÿôõ[ôTô\ŸX\ò⁄ô]⁄[í\›‹öXÿ[àÀ»[ê]Y]‹›\›‹ûK]ÀäH8†%ö^YåçãLLMàYù\àHö\ú›àÀ»]ôHõ€[ô€‹[€à][\òZ[Y⁄]HŸ[ô\öX»õZ\‹⁄[ô¬àÀ»ô\]Z\ôYöY[»»òYò[Y\»à\úõ‹à€à]ô\ûH⁄[öÀ[ô\¬àÀ»ÿ\»H€ôH\ò[HŸ[ù\»Hò]»ù[Xô\à\ôH[ú›XYŸà›ö[ô 
KÇàŸX›\ö]RYà›ö[ô X\[ôÀù[ô\õZ[ô‘ÿ‹ö\
Kà[ú›ù[Y[ùàì‘Qãà^\ûQõYŒàï—QR»ãà^\ûP€ŸNàKà›öZŸNàêUHãàùì‹[€ï\Nà⁄YHOOHê—Hà»ê–SààîUãàô\]Z\ôY]Nà»õ‹[àãöY⁄ãõ›»ãò€‹ŸHãùõ€[YHãõ⁄Hãö[\YY›õ€][]Hãú‹›óKàúõ€Q]Nà⁄[öÀôúõ€K—]Nà⁄[öÀùÀàN¬à€€ú›õ€ô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åãÿ⁄\ùÀ‹õ€[ô€‹[€àã¬àY]Ÿàî‘’ãàXY\úŒà»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãXÿŸ\àò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYKàõŸNàî””ãú›ö[ô⁄YûJõ€õŸJKàJN¬à€€ú›õ€ò]»H]ÿZ]õ€ô\Àù^

N¬à]õ€^[ÿYà[ûHHù[¬àûH»õ€^[ÿYHõ€ò]»»î””ãú\úŸJõ€ò] Hàù[»Hÿ]⁄»õ€^[ÿYHù[»BàYà
\õ€ô\Àõ⁄»\õ€^[ÿY\[Ÿàõ€^[ÿYOOHõÿöôX›äH¬à€€ú›\Ÿ»H
õ€^[ÿY	âà\[Ÿàõ€^[ÿYOOHõÿöôX›à»õ€^[ÿYô\úõ‹ìY\‹ÿYŸHàù[
H	‹õ€ô\Àú›]\ﬂX¬à⁄[ö—\úõ‹úÀú\⁄
¬àúõ€Nà⁄[öÀôúõ€KŒà⁄[öÀùÀ\úõ‹éà\ŸÀ›]\Œàõ€ô\Àú›]\Àà\úõ‹ê€ŸNàõ€^[ÿYÀô\úõ‹ê€ŸK\úõ‹ï\Nàõ€^[ÿYÀô\úõ‹ï\Kàô\]Y\›Ÿ[ùà⁄[ö—\úõ‹úÀõ[ô›OOH»õ€õŸHà[ôYö[ôYÀ»€õHX⁄»Hô\]Y\›€àHíTî’òZ[\ôK»ŸY\Hô\‹€úŸH€X[àò]‘€ö\]à⁄[ö—\úõ‹úÀõ[ô›OOH»õ€ò]Àú€XŸJÃ
Hà[ôYö[ôYàJN¬à€€ù[ùYN¬àBÇàÀ»Yô[ú⁄]ôHöY[^òX›[€à8†%Ÿ]ô\ò[]\⁄XõHŸ^Hò[Y\À¬àÀ»ÿÿ][€úÀ⁄[òŸHH^X›ÿ⁄[XH\€â›€€ôö\õYYà””ëíTìQQàÀ»UëHåçãLLMéàHôX[‹[]ô[⁄\H\»»ŸNàÀããüKNÇàÀ»ÀããüHH8†%XX⁄⁄YI‹»›€à\úò^\»ô\›Y[ô\à]»›€àŸ^Kõ›àÀ»õ]]H‹]ô[ZŸHHX\õY\àõÿôH\‹›[YYàôYô\ÇàÀ»H⁄YHX]⁄[ô»ùì‹[€ï\N»ò[òX⁄»»‹[]ô[€›\ÇàÀ»⁄YKŸ]K]‹ò\\à[àÿ\ŸHHù]\ôHô\‹€úŸH⁄\HYôô\ú»YÿZ[ãÇà€€ú››]\àH
õ€^[ÿYô]H	âà\[Ÿàõ€^[ÿYô]HOOHõÿöôX›äH»õ€^[ÿYô]Hàõ€^[ÿY¬à€€ú›⁄YRŸ^HH⁄YHOOHê—Hà»òŸHààúHé¬à€€ú›‹ò»H
›]\ñ‹⁄YRŸ^WH	âà\[Ÿà›]\ñ‹⁄YRŸ^WHOOHõÿöôX›äH»›]\ñ‹⁄YRŸ^WBàà
›]\ãòŸH›]\ãúJH	âà\[Ÿà
›]\ãòŸH›]\ãúJHOOHõÿöôX›à»
›]\ãòŸH›]\ãúJBàà›]\é¬à\›ô\‹€úŸRŸ^\—õ›[ôHÿöôX›öŸ^\ ›]\äN¬à€€ú›X⁄»H
ããõò[Y\Œà›ö[ô÷◊JHOàò[Y\ÀõX\

äHOà‹ò÷€óJKôö[ô

äHOà\úò^Kö\–\úò^JäJN¬à€€ú›[Y\›[\Œàù[Xô\ñ◊H[ôYö[ôYHX⁄ ù[Y\›[\ãù[YHãú›\ù’[YHäN¬à€€ú›€‹Ÿ\Œàù[Xô\ñ◊H[ôYö[ôYHX⁄ ò€‹ŸHäN¬à€€ú›õ€‹›Œàù[Xô\ñ◊H[ôYö[ôYHX⁄ ú‹›ãù[ô\õZ[ô‘‹›ãù[ô\õZ[ô◊‹‹›äN¬à€€ú›]úŒàù[Xô\ñ◊H[ôYö[ôYHX⁄ ö[\YY›õ€][]Hãö[\YYõ€][]Hãö]àäN¬à€€ú›⁄\Œàù[Xô\ñ◊H[ôYö[ôYHX⁄ õ⁄Hãõ‹[í[ù\ô\›äN¬àYà
\úò^Kö\–\úò^J]ú JH]ëöY[ŸY[ê[û]⁄\ôHHùYN¬ÇàYà
P\úò^Kö\–\úò^J[Y\›[\ HP\úò^Kö\–\úò^J€‹Ÿ\ H[Y\›[\Àõ[ô›OOH
H¬à⁄[ö—\úõ‹úÀú\⁄
»úõ€Nà⁄[öÀôúõ€KŒà⁄[öÀùÀ\úõ‹éàìõ»\ÿXõH[Y\›[\ÿ€‹ŸH\úò^\»[à\»⁄[ö…‹»ô\‹€úŸH
›]\àŸ^\Œàà
»\›ô\‹€úŸRŸ^\—õ›[ôöõ⁄[äãäH
»é»[õô\ã»à
»⁄YRŸ^H
»àŸ^\Œàà
»ÿöôX›öŸ^\ ‹ò Köõ⁄[äãäH
»äKààJN¬à€€ù[ùYN¬àBÇàõ‹à
]HH»H[Y\›[\Àõ[ô›»J  H¬àûH¬à€€ú›]T›àHŸôõ[ôTô\ŸX\ò⁄[ï[Y\›[\—]T›ä[Y\›[\÷⁄WJN¬à€€ú›ô[Z][HH€‹Ÿ\÷⁄WN¬à€€ú›‹›H
\úò^Kö\–\úò^Jõ€‹› H»õ€‹›÷⁄WHà[ôYö[ôY
Hœ»‹›ûQ]KôŸ]
]T›äOÀò€‹ŸN¬àYà
Sù[Xô\ãö\—ö[ö]Jô[Z][JHô[Z][HH‹›OHù[Sù[Xô\ãö\—ö[ö]J‹›
JH»⁄⁄\Y
 Œ»€€ù[ùYN»BÇàÀ»T‘’STS”à
ŸYH[ô\àÿ»€€[Y[ù
Nàô^ÿÿ›\úô[òŸHŸÇàÀ»^\ûUŸYZŸ^H€ãÿYù\à\»]H\»ôX]Y\»\»õ›…‹¬àÀ»ŸYZ€H^\ûK⁄[òŸHHõ€[ô»Ÿ\öY\»Ÿ\€â›ô]\õà[ÇàÀ»^X⁄]\ã\õ›»^\ûH]KÇà€€ú›^HHô]»]J]T›à
»ïååàäN¬à€€ú›^\’[ù[ŸYZŸ^HH
^\ûUŸYZŸ^HH^KôŸ]U—^J
H
» H	HŒ¬à€€ú›^\’—^\ûHH^\’[ù[ŸYZŸ^N»À»YàŸ^HT»H\‹›[YY^\ûH^Bà€€ú››öZŸHHX]úõ›[ô
‹›
N»À»UH\õﬁ8†%[àŸ\€â›ô]\õàHô\€€ôY›öZŸH]Ÿ[à[à\»Ÿ\öY\¬Çà]]î\òŸ[ùàù[Xô\à[ôYö[ôYH\úò^Kö\–\úò^J]ú H»]ú÷⁄WHà[ôYö[ôY¬àYà
\[Ÿà]î\òŸ[ùOOHõù[Xô\àà	âà]î\òŸ[ùà	âà]î\òŸ[ùJH]î\òŸ[ùH]î\òŸ[ù
àL»À»õ‹õX[^ôHûúòX›[€àOà\òŸ[ùYà]	‹»⁄][àŸ[ùàYà
\[Ÿà]î\òŸ[ùOOHõù[Xô\ààJ]î\òŸ[ùà
JH¬à€€ú›[\YYHŸôõ[ôTô\ŸX\ò⁄[\R]ä‹››öZŸK^\’—^\ûK⁄YHOOHê—Hãô[Z][JN¬àYà
[\YYOHù[
H»⁄⁄\Y
 Œ»€€ù[ùYN»Bà]î\òŸ[ùH[\YY¬àBÇà€€ú›⁄HH\úò^Kö\–\úò^J⁄\ H»⁄\÷⁄WHà[ôYö[ôY¬à€€ú›⁄Tô]ë^HH\úò^Kö\–\úò^J⁄\ H	âàHà»⁄\÷⁄HHWHà[ôYö[ôY¬ÇàôX€‹ôÀú\⁄
¬à[Y\›[\à]T›ãﬁ[Xõ€‹››öZŸK]î\òŸ[ù^\’—^\ûK\–ÿ[à⁄YHOOHê—Hãà⁄Nà\[Ÿà⁄HOOHõù[Xô\àà»⁄Hà[ôYö[ôYà⁄Tô]ë^Nà\[Ÿà⁄Tô]ë^HOOHõù[Xô\àà»⁄Tô]ë^Hà[ôYö[ôYàôX[^ôYõ€›à\ö⁄[ú€€îùî›[ô[ô–]
]T›äHœ»[ôYö[ôYàJN¬àHÿ]⁄¬à⁄⁄\Y
 Œ¬àBàBàHÿ]⁄
⁄[ö—\úäH¬à⁄[ö—\úõ‹úÀú\⁄
»úõ€Nà⁄[öÀôúõ€KŒà⁄[öÀùÀ\úõ‹éà⁄[ö—\úà[ú›[òŸ[Ÿà\úõ‹à»⁄[ö—\úãõY\‹ÿYŸHà›ö[ô ⁄[ö—\úäHJN¬àBà]ÿZ]Ÿôõ[ôTô\ŸX\ò⁄ZY[

N»À»ZY[ô]ŸY[à⁄[ö‹»ôYÿ\ô\‹»8†%XX⁄⁄[ö»ÿ[àôH[ôôY»Ÿàõ›‹¬àBÇàYà
ôX€‹ôÀõ[ô›OOH
H¬àô]\õàÀöú€€ä¬à\úõ‹éàìõ»\ÿXõHôX€‹ô»ùZ[úõ€H[ûH⁄[ö»ŸàHõ€[ô»Ÿ\öY\Ààãà⁄[ö‹‘ô\]Y\›Yà⁄[ö‹Àõ[ô›⁄[ö‹—òZ[Yà⁄[ö—\úõ‹úÀõ[ô›⁄[ö—\úõ‹úÀà⁄⁄\Yô\‹€úŸRŸ^\—õ›[ôà\›ô\‹€úŸRŸ^\—õ›[ôàKåäN¬àBÇà€€ú›õÿéàòX⁄›\›õÿàH¬àYàŸôõ[ôTô\ŸX\ò⁄õÿíY

K›]\ŒàîUQUQQãà›[ôX€‹ôŒàôX€‹ôÀõ[ô›õÿŸ\‹ŸYôX€‹ôŒàà›\ùY]à]Kõõ› 
Kö[ö\⁄Y]àù[\úõ‹éàù[ô\›[Œà◊KàN¬àŸôõ[ôTô\ŸX\ò⁄õÿúÀúŸ]
õÿãöYõÿäN¬àõ⁄Yù[ìŸôõ[ôTô\ŸX\ò⁄òX⁄›\›
õÿãôX€‹ô Kòÿ]⁄

\úäHOà¬àõÿãú›]\»HëêRSQé¬àõÿãô\úõ‹àH\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäN¬àõÿãôö[ö\⁄Y]H]Kõõ› 
N¬àJN¬Çàô]\õàÀöú€€ä¬àõÿíYàõÿãöY›]\Œàõÿãú›]\ÀàôX€‹ô“[ôŸ\›YàôX€‹ôÀõ[ô›ôX€‹ô‘⁄⁄\Yà⁄⁄\Yà⁄[ö‹‘ô\]Y\›Yà⁄[ö‹Àõ[ô›⁄[ö‹‘›XÿŸYYYà⁄[ö‹Àõ[ô›H⁄[ö—\úõ‹úÀõ[ô›à⁄[ö—\úõ‹úŒà⁄[ö—\úõ‹úÀõ[ô›»⁄[ö—\úõ‹ú»à[ôYö[ôYà]î€›\òŸNà]ëöY[ŸY[ê[û]⁄\ôH»ëSó‘ì”Së”‘S”ó—íQS
ô[òX⁄»»ÿÿ[ö\ŸX›[€à€à[ûHõ›»⁄\ôH]ÿ\»Z\‹⁄[ôÀ⁄[ùò[Y
Hààì––S–íT—P’S”à
õ€[ô€‹[€àô\‹€úŸHYõ»\ÿXõH[\YY›õ€][]HöY[[à[ûH⁄[ö Hãà^\ûUŸYZŸ^P\‹›[YYà^\ûUŸYZŸ^Kàô\‹€úŸRŸ^\—õ›[ôà\›ô\‹€úŸRŸ^\—õ›[ôàõ›Nàï\»\ŸYHSê””ëíTìQQ›åãÿ⁄\ùÀ‹õ€[ô€‹[€àÿ⁄[XH[ô[à\‹›[YYŸYZ€KY^\ûHŸYZŸ^H8†%⁄X⁄»^\’—^\ûHò[Y\»[àHô\›[õ‹àÿ[ö]H
⁄›[ﬁX€HMãô]ô\àôYÿ]]ôH‹à›X⁄ KàYà^H€⁄»‹õ€ôÀôK\ù[à⁄]HYôô\ô[ù^\ûUŸYZŸ^H
T›[ããçèTÿ]
H‹àŸ[ôYHô\‹€úŸRŸ^\—õ›[ô
»Hò]»ÿ[\H[ôI€ö^HöY[X\[ôÀà[à[Z]»\»[ô⁄[ù»L^\»\àÿ[€»Hô\]Y\›Yò[ôŸHÿ\»‹][ù»à
»⁄[ö‹Àõ[ô›
»à⁄[ö  H[ô›]⁄YŸŸ]\à8†%Yà⁄[ö‹‘›XÿŸYYY\»\‹»[à⁄[ö‹‘ô\]Y\›YŸYH⁄[ö—\úõ‹ú»õ‹à⁄X⁄]Hò[ôŸ\»òZ[Yà–î—TïëQåçãLLMéà€\à⁄[ö‹»
ù\ù\àòX⁄»[àå»ŸYZ‹ HòZ[Y⁄]NLH⁄[HH[‹›ôXŸ[ù⁄[ö»›XÿŸYYY8†%\»X^HYX[à[â‹»õ€[ô€‹[€à[ô⁄[ù€õHŸ\ùô\»H[Z]YôXŸ[ù€⁄ÿòX⁄»⁄[ô›Àõ›Hù[ô\]Y\›Yò[ôŸKàYà[›HôYY»€€ôö\õKŸö[ô]›]ŸôãûHH€X[\€€]Yò[ôŸH
KôÀàù\›H\›Ã^\ H[ô[à\⁄Húõ€Q]HõŸ‹ô\‹⁄]ô[Hù\ù\àòX⁄»[ù[NLHôX\X\úÀàãàKåäN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîõ€[ô»[ôŸ\›[€àòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬ãÀ»[›[ùH\€€]Yõ›]\ãà\úõ›]J
Hò[Y\‹XŸ\»]ô\ûH]Xõ›ôH[ô\ÇãÀ»ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ à8†%]Ÿ\»õ›ôY⁄\›\à€ã‹ò\‹à⁄Y›»[ûBãÀ»^\›[ô»õ›]K[ô^\›[ô»õ›]\»ôY⁄\›\ôYX\õY\à[à\»ö[H\ôBãÀ»€€\][H[òYôôX›YûH\»ÿ[Çã äÇà
à—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹ô\€€ôKŸ[ãX€€ùòX›à
à‹ﬁ[Xõ€SíQïIú›öZŸOLçL	ô^\ûQ]OLåçãLLé	ú⁄YOP—Bà
Çà
à€€ùô[öY[òŸH€⁄›\€»[›H€â›]ôH»X[ùX[Hö[ôH€€ùòX›	‹»[Çà
àŸX›\ö]RYôYõ‹ôHÿ[[ô»⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[àô]\Ÿ\»H–SQBà
àŸôöX⁄X[‹[€à⁄Z[àTHÿ[\»€ŸXò\ŸH[ôXYH\Ÿ\»[Ÿ]⁄\ôBà
à
›åã€‹[€ò⁄Z[à8†%ŸYHHàŸX›\ö]KRQX\\àXõ›ôK⁄X⁄€€ôö\õYYà
à]ôH]XX⁄›öZŸK‹⁄YHY»ÿ\úöY\»]»›€àŸX›\ö]W⁄YöY[
K€¬à
à\»\»õ›Hô]À›[ùô\öYöYY€⁄›\]8†%ù\›\»‹X⁄YöX»›öZŸBà
àX⁄ŸY›]ŸàHÿ[YHô\‹€úŸH⁄\H[ôXYHõ›ô[à»€‹ö»\ôKÇà
àôXY[€õNà€ôH—U»[â‹»‹[€à⁄Z[ãõ›[ô»‹ö][à[û]⁄\ôKÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ã‹ô\€€ôKŸ[ãX€€ùòX›ã\ﬁ[ò»
 HOà¬àûH¬à€€ú›ﬁ[Xõ€H
Àúô\Kú]Y\ûJúﬁ[Xõ€äHàäKùö[J
Kù’\\êÿ\ŸJ
N¬à€€ú››öZŸT\ò[HHù[Xô\äÀúô\Kú]Y\ûJú›öZŸHäJN¬à€€ú›^\ûQ]HH
Àúô\Kú]Y\ûJô^\ûQ]HäHàäKùö[J
N¬à€€ú›⁄YHH
Àúô\Kú]Y\ûJú⁄YHäHàäKùö[J
Kù’\\êÿ\ŸJ
N¬ÇàYà
\ﬁ[Xõ€Sù[Xô\ãö\—ö[ö]J›öZŸT\ò[JHY^\ûQ]H
⁄YHOOHê—Hà	âà⁄YHOOHîHäJH¬àô]\õàÀöú€€ä»\úõ‹éàî]Y\ûH]\›[ò€YHﬁ[Xõ€›öZŸH
ù[Xô\äK^\ûQ]H
VVVKSSKQ
K⁄YH
—H‹àJKààK
N¬àBà€€ú›X\[ô»HSó’SëTìRSë◊”PT‹ﬁ[Xõ€N¬àYà
[X\[ô H¬àô]\õàÀöú€€ä»\úõ‹éà[ö€õ›€àﬁ[Xõ€â‹ﬁ[Xõ€Hãà›\‹ùYà	”ÿöôX›öŸ^\ Só’SëTìRSë◊”PT
Köõ⁄[äãä_XK
N¬àBàÀ»[â‹»‹[€à⁄Z[à€õHXÿŸ\»H’TîëSïKST’Q^\ûH
H]BàÀ»]›[\»[àX›]ôH€€ùòX›Ÿ\öY\ H8†%[à\òö]ò\ûH‹à[ôXYKBàÀ»^\ôY]H
KôÀàH\›úöY^JHŸ]»ôZôX›Y⁄]Hò\ôHàÀ»[ôõ»\ŸYù[õŸKàÿ]⁄]\ôH⁄]H€X\àY\‹ÿYŸH[ú›XYŸÇàÀ»\‹⁄[ô»[àÿùö[›\€KZ[ùò[Y]Hõ›Y⁄»[ãÇà€€ú›^\ûS\–⁄X⁄»Hô]»]J^\ûQ]H
»ïååàäKôŸ][YJ
N¬àYà
ù[Xô\ãö\”òSä^\ûS\–⁄X⁄ JH¬àô]\õàÀöú€€ä»\úõ‹éà[ùò[Y^\ûQ]HâŸ^\ûQ]_Hà8†%^X›YVVVKSSKQòK
N¬àBàYà
^\ûS\–⁄X⁄»]Kõõ› 
HHç
àå
àå
àL
H¬àô]\õàÀöú€€ä¬à\úõ‹éà^\ûQ]HâŸ^\ûQ]_Hà\»[àH\›8†%]\»[ôXYH^\ôY€»[à⁄[ôZôX›]àŸ]HôX[›\úô[ùK[\›Y^\ûHö\ú›úõ€H—Uÿ\KŸ[ãÿ€€ùòX›œ‹ﬁ[Xõ€I‹ﬁ[Xõ€H
ŸYH]»ò[^\öY\»àöY[
H[ô\ŸH€ôHŸà‹ŸH^X›]\ÀòàK
N¬àBà€€ú›XÿŸ\‹’⁄Ÿ[àH
]ÿZ]Ÿ]ò[Y[êXÿŸ\‹’⁄Ÿ[ä
JHàé¬à€€ú›€Y[ùYHõÿŸ\‹Àô[ùãëSó–”QSï“QÀùö[J
Hàé¬àYà
XXÿŸ\‹’⁄Ÿ[àX€Y[ùY
H¬àô]\õàÀöú€€ä»\úõ‹éàë[àõ›€€ôöY›\ôY
Só–P–—T‘◊’“—Sãÿ]]À\ôYúô\⁄‹àSó–”QSï“QZ\‹⁄[ô KààKL N¬àBÇà€€ú›XY\ú»H»ê€€ù[ùU\Héàò\Xÿ][€ã⁄ú€€àãòXÿŸ\‹À]⁄Ÿ[àéàXÿŸ\‹’⁄Ÿ[ãò€Y[ùZYéà€Y[ùYN¬à€€ú›⁄Z[îô\»H]ÿZ][îò]S[Z]Yô]⁄
öŒãÀÿ\Kô[ãò€À›åã€‹[€ò⁄Z[àã¬àY]Ÿàî‘’ãàXY\úÀàõŸNàî””ãú›ö[ô⁄YûJ»[ô\õZ[ô‘ÿ‹ö\àX\[ôÀù[ô\õZ[ô‘ÿ‹ö\[ô\õZ[ô‘ŸYŒàX\[ôÀù[ô\õZ[ô‘ŸYÀ^\ûNà^\ûQ]HJKàJN¬à€€ú›ò]»H]ÿZ]⁄Z[îô\Àù^

N¬à]^[ÿYà[ûHHù[¬àûH»^[ÿYHò]»»î””ãú\úŸJò] Hàù[»Hÿ]⁄»^[ÿYHù[»BàYà
X⁄Z[îô\Àõ⁄»\^[ÿYÀô]H\[Ÿà^[ÿYô]Kõÿ»OOHõÿöôX›äH¬àÀ»›\ôòXŸH[â‹»X›X[\úõ‹àõŸH
õ›ù\›Hò\ôH›]\ H€¬àÀ»Hô^Z\€X]⁄\»XY€õ‹ÿXõHúõ€HHô\‹€úŸH[€ôKÿ[YBàÀ»]\õà\»H^\›[ô»åÀQ]Y][ô⁄[ù»[Ÿ]⁄\ôH[à\»ö[KÇàô]\õàÀöú€€ä¬à\úõ‹éàë[à‹[€à⁄Z[àô\]Y\›òZ[Yàãà›]\Œà⁄Z[îô\Àú›]\Àà^\ûQ]U\ŸYà^\ûQ]Kàõ›öY\ë\úõ‹éà^[ÿY	âà\[Ÿà^[ÿYOOHõÿöôX›Çà»»\úõ‹ï\Nà^[ÿYô\úõ‹ï\Hœ»ù[\úõ‹ê€ŸNà^[ÿYô\úõ‹ê€ŸHœ»ù[\úõ‹ìY\‹ÿYŸNà^[ÿYô\úõ‹ìY\‹ÿYŸHœ»ù[Bààù[àò]‘ô\‹€úŸT€ö\]àò]Àú€XŸJÃ
Kà[ùàëŸ]HôX[›\úô[ùK[\›Y^\ûHúõ€H—Uÿ\KŸ[ãÿ€€ùòX›œ‹ﬁ[Xõ€Hà
»ﬁ[Xõ€
»à
ò[^\öY\◊àöY[
Hò]\à[à›Y\‹⁄[ô»H]KàãàKLäN¬àBÇà€€ú›ÿŒàôX€‹ô›ö[ôÀ»ŸOŒà[ûN»OŒà[ûHOàH^[ÿYô]KõÿŒ¬à€€ú›X]⁄Ÿ^HHÿöôX›öŸ^\ ÿ Kôö[ô

 HOàX]òXú \úŸQõÿ]
 HH›öZŸT\ò[JHåJN¬àYà
[X]⁄Ÿ^JH¬à€€ú›]òZ[XõT›öZŸ\»HÿöôX›öŸ^\ ÿ KõX\

 HOà\úŸQõÿ]
 JKôö[\ä
äHOàSù[Xô\ãö\”òSääJKú€‹ù

KäHOàHHäN¬àô]\õàÀöú€€ä»\úõ‹éà›öZŸH	‹›öZŸT\ò[_Hõ›õ›[ôõ‹à	‹ﬁ[Xõ€H^\ûH	Ÿ^\ûQ]_Kò]òZ[XõT›öZŸ\‘ÿ[\Nà]òZ[XõT›öZŸ\Àú€XŸJå
HK
N¬àBà€€ú›Y»H⁄YHOOHê—Hà»ÿ÷€X]⁄Ÿ^WOÀòŸHàÿ÷€X]⁄Ÿ^WOÀúN¬à€€ú›ŸX›\ö]RYHY»	âà\[ŸàYÀúŸX›\ö]W⁄YOOHõù[Xô\àà»YÀúŸX›\ö]W⁄Yàù[¬àYà
ŸX›\ö]RYOOHù[
H¬àô]\õàÀöú€€ä»\úõ‹éà	‹⁄Y_HY»]›öZŸH	€X]⁄Ÿ^_H\»õ»ŸX›\ö]W⁄Y[à[â‹»ô\‹€úŸH8†%€€ùòX›X^Hõ›^\›õ‹à\»^\ûK‹›öZŸH€€Xö[ò][€ãòK
N¬àBÇàô]\õàÀöú€€ä¬àﬁ[Xõ€⁄YK›öZŸNà\úŸQõÿ]
X]⁄Ÿ^JK^\ûQ]Kà‹[€îŸX›\ö]RYàŸX›\ö]RYà‹›à\[Ÿà^[ÿYô]Kõ\›‹öXŸHOOHõù[Xô\àà»^[ÿYô]Kõ\›‹öXŸHàù[à\›öXŸNà\[ŸàYÀõ\›‹öXŸHOOHõù[Xô\àà»YÀõ\›‹öXŸHàù[àõ›NàëôYY‹[€îŸX›\ö]RY\ôX›H[ù»‘’ÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[àãàôXY€õS[ŸNàùYK‹ô\êXÿŸ\‹’\ŸYàò[ŸKàJN¬àHÿ]⁄
\úäH¬àô]\õàÀöú€€ä»\úõ‹éàîô\€€ôHòZ[Yàà
»
\úà[ú›[òŸ[Ÿà\úõ‹à»\úãõY\‹ÿYŸHà›ö[ô \úäJHKL
N¬àBüJN¬ã äÇà
à—Uÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿ€€ú€€Bà
àH[ûK\[ô[òﬁKYúôYHS\›YŸH
õ‹õH
»ù]€ú Hõ‹àHŸôõ[ôBà
àô\ŸX\ò⁄[Ÿ[K€»]ÿ[àôH^\ò⁄\ŸYúõ€HH€ôK€\‹úõ›‹Ÿ\Çà
à⁄]›]ôYY[ô»‹›X[à‹à]ï€€Ààÿ[YK[‹öY⁄[à
Ÿ\ùôYûH\»ÿ[YBà
à\
KôXY[€õKÿ[»€õHHŸôõ[ôK\ô\ŸX\ò⁄[ô⁄[ù»Xõ›ôH8†%ô]ô\Çà
à›X⁄\»H]ôH\⁄õÿ\ôLLã‹à[Y‹ò[H[\ù]ÀÇà
ã¬õŸôõ[ôTô\ŸX\ò⁄õ›]\ãôŸ]
ãÿ€€ú€€Hã
 HOà¬àô]\õàÀö[
Q–’TH[Çè[ÇèXYÇèY]H⁄\úŸ]Hù]ãNàœÇèY]Hò[YOHùöY]‹‹ùà€€ù[ùHù⁄YY]öXŸK]⁄Y[ö]X[\ÿÿ[OLHàœÇè]OìŸôõ[ôHô\ŸX\ò⁄€€ú€€O›]OÇè›[OÇàõŸH»òX⁄Ÿ‹õ›[ôàÃåLLMN»€€‹éàŸMôMôMé»õ€ùYò[Z[Nàﬁ\›[K]ZKÿ[úÀ\Ÿ\öYé»X^]⁄Yçç»X\ô⁄[éå]]Œ»Y[ôŒåMú»BàH»õ€ù\⁄^ôNåKåúô[N»€€‹éàŸYåÕŒ»Bàà»õ€ù\⁄^ôNåéM\ô[N»€€‹éàŒXXLMé»X\ô⁄[ã]‹åé»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹åMú»BàXô[»\‹^Nòõÿ⁄Œ»õ€ù\⁄^ôNåçÕ\ô[N»€€‹éàŒXXLMé»X\ô⁄[ã]‹åL»Bà[ú]Ÿ[X›»⁄YåL	N»õﬁ\⁄^ö[ôŒòõ‹ô\ãXõﬁ»Y[ôŒé»X\ô⁄[ã]‹ç»òX⁄Ÿ‹õ›[ôàÃXLYåŒ»€€‹éàŸMôMôMé»õ‹ô\éå\€€YÃòLôÃŒ»õ‹ô\ã\òY]\Œçú»õ€ù\⁄^ôNåé\ô[N»Bàù]€à»X\ô⁄[ã]‹åM»Y[ôŒåLMú»òX⁄Ÿ‹õ›[ôàŸYåÕŒ»€€‹éàÃ»õ‹ô\éõõ€ôN»õ‹ô\ã\òY]\Œçú»õ€ù]ŸZY⁄çÃ»›\ú€‹éú⁄[ù\é»⁄YåL	N»õ€ù\⁄^ôNåé\ô[N»Bàù]€éô\ÿXõY»‹X⁄]NåçN»BàôH»òX⁄Ÿ‹õ›[ôàÃXLYåŒ»õ‹ô\éå\€€YÃòLôÃŒ»õ‹ô\ã\òY]\Œçú»Y[ôŒåL»õ€ù\⁄^ôNåçÃúô[N»⁄]K\‹XŸNúôK]‹ò\»€‹ôXúôXZŒòúôXZÀX[»X\ô⁄[ã]‹åL»X^ZZY⁄åÃ»›ô\ôõ›Œò]]Œ»Bàú›]\»»õ€ù\⁄^ôNåçÕ\ô[N»X\ô⁄[ã]‹çú»Bàõ⁄»»€€‹éàÕÿYçL»Hô\úà»€€‹éàŸçÃÕé»Hõ]]Y»€€‹éàŒXXLMé»Bè‹›[OÇè⁄XYÇèõŸOÇàO∏¶®HŸôõ[ôHô\ŸX\ò⁄€€ú€€O⁄OÇà]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçÃúô[N»èîôXY[€õHòX⁄›\›
»‹ôYZ‹»êQ»\›€€àŸ\»õ››X⁄H]ôH\⁄õÿ\ôLLã‹à[Y‹ò[H[\ùÀèŸ]èÇÇàèåKàô\€€ôH€€ùòX›
ö[ô[àŸX›\ö]RY
O⁄èÇàXô[îﬁ[Xõ€€Xô[ÇàŸ[X›YHúîﬁ[Xõ€èè‹[€èìíQïO€‹[€èè‹[€èêêSí”íQïO€‹[€èè‹[€èî—Sî—V€‹[€èè‹[€èëíSìíQïO€‹[€èè‹[€èìRQ‘íQïO€‹[€èè‹Ÿ[X›ÇàXô[î›öZŸO€Xô[Çà[ú]YHúî›öZŸHà\OHõù[Xô\ààXŸZ€\èHôKôÀàçÕLàœÇàXô[ë^\ûH]H
VVVKSSKQ8†%\ŸHÿ\KŸ[ãÿ€€ùòX›œ‹ﬁ[Xõ€Kããà»ö[ôHôX[€ôJO€Xô[Çà[ú]YHúë^\ûHà\OHù^àXŸZ€\èHååçãLLNàœÇàXô[î⁄YO€Xô[ÇàŸ[X›YHúî⁄YHèè‹[€èê—O€‹[€èè‹[€èîO€‹[€èè‹Ÿ[X›Çàù]€à€ò€X⁄œHô‘ô\€€ôJ
Hèîô\€€ôH€€ùòX›ÿù]€èÇà]àYHúî›]\»à€\‹œHú›]\»èèŸ]èÇàôHYHúì›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇàèåãàù[àòX⁄›\›[ôŸ\›
úõ€H[à\›‹ûJO⁄èÇàXô[ì‹[€àŸX›\ö]HQ
]]ÀYö[YYù\àô\€€ôK‹à\H]
O€Xô[Çà[ú]YHöTŸX“Yà\OHù^àœÇàXô[î›öZŸO€Xô[Çà[ú]YHöT›öZŸHà\OHõù[Xô\ààœÇàXô[ë^\ûH]O€Xô[Çà[ú]YHöQ^\ûHà\OHù^àœÇàXô[í\»ÿ[»
—HHY\ÀHHõ O€Xô[ÇàŸ[X›YHöR\–ÿ[èè‹[€àò[YOHùùYHèñY\»
—JO€‹[€èè‹[€àò[YOHôò[ŸHèìõ»
JO€‹[€èè‹Ÿ[X›ÇàXô[ëúõ€H]O€Xô[Çà[ú]YHöQúõ€Hà\OHù^àXŸZ€\èHååçãLÀLMààœÇàXô[ï»]O€Xô[Çà[ú]YHöU»à\OHù^àXŸZ€\èHååçãLLMààœÇàù]€à€ò€X⁄œHô“[ôŸ\›

Hèîù[àòX⁄›\›[ôŸ\›ÿù]€èÇà]àYHöT›]\»à€\‹œHú›]\»èèŸ]èÇàôHYHöS›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇàèåÀà‘à8†%ù[àù[K^YX\àõ€[ô»òX⁄›\›⁄èÇà]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçÃúô[N»èï\Ÿ\»[â‹»õ€[ôÀPUHŸ\öY\»
]]À\õ€»X‹õ‹‹»^\öY\ Kàÿ⁄[XHõ›L	H€€ôö\õYY8†%⁄X⁄»^\’—^\ûH[àHô\›[ﬁX€\»Màÿ[ô[N»Yù\›ë^\ûHŸYZŸ^Hàô[›»[ôôK\ù[àYàõ›èŸ]èÇàù]€à€ò€X⁄œHô‘õÿôS€⁄ÿòX⁄ 
Hà›[OHòòX⁄Ÿ‹õ›[ôàÃòLôÃŒ»€€‹éàŸMôMôMé»X\ô⁄[ã]‹åL»èëö\ú›àö[ô›»ò\àòX⁄»[â‹»]HX›X[H€Ÿ\œÿù]€èÇà]àYHú›]\»à€\‹œHú›]\»èèŸ]èÇàôHYHú›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇàXô[îﬁ[Xõ€€Xô[ÇàŸ[X›YHô‘ﬁ[Xõ€èè‹[€èìíQïO€‹[€èè‹[€èêêSí”íQïO€‹[€èè‹[€èî—Sî—V€‹[€èè‹[€èëíSìíQïO€‹[€èè‹[€èìRQ‘íQïO€‹[€èè‹Ÿ[X›ÇàXô[î⁄YO€Xô[ÇàŸ[X›YHô‘⁄YHèè‹[€èê—O€‹[€èè‹[€èîO€‹[€èè‹Ÿ[X›ÇàXô[ëúõ€H]O€Xô[Çà[ú]YHô—úõ€Hà\OHù^àXŸZ€\èHååçKLLMààœÇàXô[ï»]O€Xô[Çà[ú]YHô’»à\OHù^àXŸZ€\èHååçãLLMààœÇàXô[ë^\ûHŸYZŸ^H
T›[ãOS[€ãèUYKœUŸYUKOQúöKèTÿ]8†%Yò][èUY\Ÿ^JO€Xô[Çà[ú]YHô—^\ûUŸYZŸ^Hà\OHõù[Xô\ààZ[èHåàX^Hçààò[YOHåààœÇàù]€à€ò€X⁄œHô‘õ€[ô“[ôŸ\›

Hèîù[àKVYX\àõ€[ô»òX⁄›\›ÿù]€èÇà]àYHô‘›]\»à€\‹œHú›]\»èèŸ]èÇàôHYHô”›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇàèçàô\›[⁄èÇà]àYHöî›]\»à€\‹œHú›]\»]]Yèìõ»õÿà›\ùYY]èŸ]èÇà]àYHöî›[[X\ûTôXYXõHà›[OHô\‹^Nõõ€ôN»õ€ù\⁄^ôNåéô[N»[ôKZZY⁄åKçé»X\ô⁄[ã]‹åL»èèŸ]èÇà]àYHöì›]ŸŸ€Hà›[OHô\‹^Nõõ€ôN»X\ô⁄[ã]‹é»€€‹éàŸYåÕŒ»õ€ù\⁄^ôNåç‹ô[N»›\ú€‹éú⁄[ù\é»à€ò€X⁄œHò€€ú›œYÿ›[Y[ùôŸ][[Y[ùûRY
	⁄ì›]	 N»Àú›[Kô\‹^HHÀú›[Kô\‹^OOOI€õ€ôI»»	ÿõÿ⁄…»à	€õ€ôIŒ»èî⁄›À⁄YHù[ò]»î””à8•ØèŸ]èÇàôHYHöì›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇàèçãàÿ[ÀQõ‹ùÿ\ôYôöX⁄Y[òﬁH
›ô\ôö][ô»⁄X⁄ O⁄èÇà]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçÃúô[N»èê⁄X⁄‹»⁄]\àH’PìK]úÀU–U“’Sî’PìH]\õàXõ›ôH›[€»€à]HH\›\€â›úŸY[ààY]ûHõ€[ô»HåY^HòZ[ö[ô»⁄[ô›»õ‹ùÿ\ô[ô⁄X⁄⁄[ô»Hô^H^\»XX⁄[YKàôYY»]X\›çH\›[ò›òY[ô»^\»[ôŸ\›Y8†%€X⁄»\»Yù\àHö[ö\⁄YõÿàXõ›ôKèŸ]èÇàù]€à€ò€X⁄œHô’ŸôJ
Hèê⁄X⁄»ÿ[ÀQõ‹ùÿ\ôYôöX⁄Y[òﬁH
\›ö[ö\⁄YõÿäOÿù]€èÇà]àYHù‘›]\»à€\‹œHú›]\»èèŸ]èÇà]àYHù‘ôXYXõHà›[OHô\‹^Nõõ€ôN»õ€ù\⁄^ôNåéô[N»[ôKZZY⁄åKçé»X\ô⁄[ã]‹åL»èèŸ]èÇàôHYHù”›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇàèçKàêQ»8†%ö[ô⁄[Z[\à\›‹öXÿ[^\œ⁄èÇà]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçÃúô[N»èîŸX\ò⁄\»H‹ôYZ‹»]\õú»€€X›YûH]ô\ûHòX⁄›\›õÿàù[àXõ›ôH
[à\»Ÿ\ùô\àŸ\‹⁄[€äHõ‹àH€‹Ÿ\›\›‹öXÿ[[ò[Ÿ‹»»Hù[Xô\ú»[›H[ù\à\ôH8†%KôÀàŸ^I‹»]ôH‹›‹›öZŸK“Uà8†%[ô⁄›‹»⁄]ô\ôX›€›]€€YH‹ŸH⁄[Z[\à^\»YèŸ]èÇàXô[î‹›€Xô[Çà[ú]YHúT‹›à\OHõù[Xô\ààXŸZ€\èHåçLàœÇàXô[î›öZŸO€Xô[Çà[ú]YHúT›öZŸHà\OHõù[Xô\ààXŸZ€\èHåçLàœÇàXô[íUà	O€Xô[Çà[ú]YHúR]àà\OHõù[Xô\ààXŸZ€\èHåLÀçHàœÇàXô[ë^\»»^\ûO€Xô[Çà[ú]YHúQHà\OHõù[Xô\ààXŸZ€\èHåààœÇàXô[í\»ÿ[œ€Xô[ÇàŸ[X›YHúR\–ÿ[èè‹[€àò[YOHùùYHèñY\»
—JO€‹[€èè‹[€àò[YOHôò[ŸHèìõ»
JO€‹[€èè‹Ÿ[X›ÇàXô[í›»X[ûHX]⁄\œœ€Xô[Çà[ú]YHúU‹»à\OHõù[Xô\ààò[YOHçHàZ[èHåHàX^HååàœÇàù]€à€ò€X⁄œHô‘òY‘]Y\ûJ
Hèëö[ô⁄[Z[\à\›‹öXÿ[^\œÿù]€èÇà]àYHúT›]\»à€\‹œHú›]\»èèŸ]èÇà]àYHúTôXYXõHà›[OHô\‹^Nõõ€ôN»õ€ù\⁄^ôNåéô[N»[ôKZZY⁄åKçé»X\ô⁄[ã]‹åL»èèŸ]èÇàôHYHúS›]à›[OHô\‹^Nõõ€ôN»èè‹ôOÇÇèÿ‹ö\Çàù[ò›[€àŸ]›]\ [Y^€ H¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
[Y
N¬à[ù^€€ù[ùH^¬à[ò€\‹”ò[YHH	‹›]\»	»
»
€»	… N¬àBàù[ò›[€à⁄›“ú€€ä[YÿöäH¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
[Y
N¬à[ú›[Kô\‹^HH	ÿõÿ⁄…Œ¬à[ù^€€ù[ùHî””ãú›ö[ô⁄YûJÿöãù[äN¬àBà\ﬁ[ò»ù[ò›[€à‘ô\€€ôJ
H¬àŸ]›]\ 	‹î›]\…À	”ÿY[ôÀããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹ì›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›ﬁ[Xõ€Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹îﬁ[Xõ€	 Kùò[YN¬à€€ú››öZŸHHÿ›[Y[ùôŸ][[Y[ùûRY
	‹î›öZŸI Kùò[YN¬à€€ú›^\ûQ]HHÿ›[Y[ùôŸ][[Y[ùûRY
	‹ë^\ûI Kùò[YKùö[J
N¬à€€ú›⁄YHHÿ›[Y[ùôŸ][[Y[ùûRY
	‹î⁄YI Kùò[YN¬à€€ú›\õH	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹ô\€€ôKŸ[ãX€€ùòX›‹ﬁ[Xõ€I»
»[ò€ŸUTíP€€\€ô[ù
ﬁ[Xõ€
H
¬à	…ú›öZŸOI»
»[ò€ŸUTíP€€\€ô[ù
›öZŸJH
»	…ô^\ûQ]OI»
»[ò€ŸUTíP€€\€ô[ù
^\ûQ]JH
»	…ú⁄YOI»
»[ò€ŸUTíP€€\€ô[ù
⁄YJN¬à€€ú›ô\»H]ÿZ]ô]⁄
\õ
N¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	‹ì›]	À]JN¬àYà
ô\Àõ⁄»	âà]Kõ‹[€îŸX›\ö]RYOHù[
H¬àŸ]›]\ 	‹î›]\…À	—õ›[ôHŸX›\ö]RYH	»
»]Kõ‹[€îŸX›\ö]RY
»	»8†%]]ÀYö[Yô[›ÀâÀ	€⁄… N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄TŸX“Y	 Kùò[YHH]Kõ‹[€îŸX›\ö]RY¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄T›öZŸI Kùò[YHH]Kú›öZŸN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄Q^\ûI Kùò[YHH^\ûQ]N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄R\–ÿ[	 Kùò[YHH⁄YHOOH	–—I»»	›ùYI»à	Ÿò[ŸIŒ¬àH[ŸH¬àŸ]›]\ 	‹î›]\…À	—òZ[Y8†%ŸYH]Z[»ô[›ÀâÀ	Ÿ\úâ N¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	‹î›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBà\ﬁ[ò»ù[ò›[€à“[ôŸ\›

H¬àŸ]›]\ 	⁄T›]\…À	‘›XõZ][ôÀããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄S›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›õŸHH¬àﬁ[Xõ€àÿ›[Y[ùôŸ][[Y[ùûRY
	‹îﬁ[Xõ€	 Kùò[YKà‹[€îŸX›\ö]RYàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	⁄TŸX“Y	 Kùò[YJHÿ›[Y[ùôŸ][[Y[ùûRY
	⁄TŸX“Y	 Kùò[YKà›öZŸNàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	⁄T›öZŸI Kùò[YJKà^\ûQ]Nàÿ›[Y[ùôŸ][[Y[ùûRY
	⁄Q^\ûI Kùò[YKùö[J
Kà\–ÿ[àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄R\–ÿ[	 Kùò[YHOOH	›ùYIÀàúõ€Q]Nàÿ›[Y[ùôŸ][[Y[ùûRY
	⁄Qúõ€I Kùò[YKùö[J
Kà—]Nàÿ›[Y[ùôŸ][[Y[ùûRY
	⁄U… Kùò[YKùö[J
KàN¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄⁄[ôŸ\›Ÿ[ãZ\›‹öXÿ[	À¬àY]Ÿà	‘‘’	ÀXY\úŒà»	–€€ù[ùU\IŒà	ÿ\Xÿ][€ã⁄ú€€â»KõŸNàî””ãú›ö[ô⁄YûJõŸJBàJN¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	⁄S›]	À]JN¬àYà
ô\Àõ⁄»	âà]KöõÿíY
H¬àŸ]›]\ 	⁄T›]\…À	“õÿà›\ùYà	»
»]KöõÿíY
»	»8†%€[ô»õ‹àô\›[ããâÀ	€⁄… N¬à€õÿä]KöõÿíY
N¬àH[ŸH¬àŸ]›]\ 	⁄T›]\…À	—òZ[Y8†%ŸYH]Z[»ô[›ÀâÀ	Ÿ\úâ N¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	⁄T›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBà\ﬁ[ò»ù[ò›[€à‘õÿôS€⁄ÿòX⁄ 
H¬àŸ]›]\ 	‹›]\…À	‘õÿö[ô»Ÿ]ô\ò[\›]Hò[ôŸ\»
ZŸ\»çÀ€ôH[àÿ[]ô\ûHå‹ KããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›ﬁ[Xõ€Hÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ‘ﬁ[Xõ€	 Kùò[YN¬à€€ú›⁄YHHÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ‘⁄YI Kùò[YN¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹õÿôKŸ[ã\õ€[ôÀ[€⁄ÿòX⁄œ‹ﬁ[Xõ€I»
»[ò€ŸUTíP€€\€ô[ù
ﬁ[Xõ€
H
»	…ú⁄YOI»
»[ò€ŸUTíP€€\€ô[ù
⁄YJJN¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	‹›]	À]JN¬àYà
ô\Àõ⁄»	âà]KúôX€€[Y[ôYúõ€Q]JH¬àŸ]›]\ 	‹›]\…À	‘ÿYôH€⁄ÿòX⁄»õ›[ôà	»
»]KúôX€€[Y[ôYÿYôS€⁄ÿòX⁄—^\»
»	»^\»òX⁄»
úõ€H	»
»]KúôX€€[Y[ôYúõ€Q]H
»	 Kà]]ÀYö[Yëúõ€H]Hàô[›ÀâÀ	€⁄… N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ—úõ€I Kùò[YHH]KúôX€€[Y[ôYúõ€Q]N¬àH[ŸH¬àŸ]›]\ 	‹›]\…À	–€›[õ›ö[ôH€‹ö⁄[ô»€⁄ÿòX⁄»8†%ŸYH]Z[»ô[›ÀâÀ	Ÿ\úâ N¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	‹›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBà\ﬁ[ò»ù[ò›[€à‘õ€[ô“[ôŸ\›

H¬àŸ]›]\ 	Ÿ‘›]\…À	‘›XõZ][ô»
\»€ôHÿ[ÿ[àZŸHH]H€ôŸ\äKããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ”›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›õŸHH¬àﬁ[Xõ€àÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ‘ﬁ[Xõ€	 Kùò[YKà⁄YNàÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ‘⁄YI Kùò[YKàúõ€Q]Nàÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ—úõ€I Kùò[YKùö[J
Kà—]Nàÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ’… Kùò[YKùö[J
Kà^\ûUŸYZŸ^Nàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ—^\ûUŸYZŸ^I Kùò[YJKàN¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄⁄[ôŸ\›Ÿ[ã\õ€[ôÀZ\›‹ûIÀ¬àY]Ÿà	‘‘’	ÀXY\úŒà»	–€€ù[ùU\IŒà	ÿ\Xÿ][€ã⁄ú€€â»KõŸNàî””ãú›ö[ô⁄YûJõŸJBàJN¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	Ÿ”›]	À]JN¬àYà
ô\Àõ⁄»	âà]KöõÿíY
H¬àŸ]›]\ 	Ÿ‘›]\…À	“õÿà›\ùYà	»
»]KöõÿíY
»	»
	»
»]KúôX€‹ô“[ôŸ\›Y
»	»^\ H8†%€[ô»õ‹àô\›[ããâÀ	€⁄… N¬à€õÿä]KöõÿíY
N¬àH[ŸH¬àŸ]›]\ 	Ÿ‘›]\…À	—òZ[Y8†%ŸYH]Z[»ô[›»
Yàô\‹€úŸRŸ^\—õ›[ô\»⁄›€ã][»\»[ó	‹»ôX[öY[ò[Y\ KâÀ	Ÿ\úâ N¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	Ÿ‘›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBà]\›€€\]YõÿíYHù[¬à\ﬁ[ò»ù[ò›[€à€õÿäõÿíY
H¬àŸ]›]\ 	⁄î›]\…À	‘€[ô»õÿà	»
»õÿíY
»	ÀããâÀ	€]]Y	 N¬àõ‹à
]HH»Hå»J  H¬à]ÿZ]ô]»õ€Z\ŸJàOàŸ][Y[›]
ãÃ
JN¬àûH¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹›]\À…»
»õÿíY
N¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬àŸ]›]\ 	⁄î›]\…À	‘›]\Œà	»
»]Kú›]\»
»	»
	»
»]KúõÿŸ\‹ŸYôX€‹ô»
»	À…»
»]Kù›[ôX€‹ô»
»	À	»
»]KúõŸ‹ô\‹‘›
»	…JIÀ	€]]Y	 N¬àYà
]Kú›]\»OOH	—”ëI»]Kú›]\»OOH	—êRSQ	 H¬à€€ú›ô\›[ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹ô\›[…»
»õÿíY
N¬à€€ú›ô\›[]HH]ÿZ]ô\›[ô\Àöú€€ä
N¬à⁄›“ú€€ä	⁄ì›]	Àô\›[]JN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	⁄ì›]ŸŸ€I Kú›[Kô\‹^HH	ÿõÿ⁄…Œ¬àŸ]›]\ 	⁄î›]\…À	—ö[ö\⁄Yà	»
»]Kú›]\À]Kú›]\»OOH	—”ëI»»	€⁄…»à	Ÿ\úâ N¬àYà
]Kú›]\»OOH	—”ëI H¬à\›€€\]YõÿíYHõÿíY¬àûH¬à€€ú››[Tô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\›‹›[[X\ûK…»
»õÿíY
N¬à€€ú›»H]ÿZ]›[Tô\Àöú€€ä
N¬àô[ô\î›[[X\ûJ N¬àHÿ]⁄
JH» à›[[X\ûH\»Hõ€ù\»öY]»8†%ô\›[î””àXõ›ôH›[\»]ô\û][ô»
ã»BàBàô]\õé¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	⁄î›]\…À	”ô]€‹ö»\úõ‹à⁄[H€[ôŒà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àô]\õé¬àBàBàŸ]›]\ 	⁄î›]\…À	’[YY›]Yù\à»Z[ù]\»Ÿà€[ô»8†%⁄X⁄»X[ùX[HöXHÿòX⁄›\›‹›]\À…»
»õÿíY	Ÿ\úâ N¬àBà\ﬁ[ò»ù[ò›[€à’ŸôJ
H¬àYà
[\›€€\]YõÿíY
H»Ÿ]›]\ 	›‘›]\…À	”õ»ö[ö\⁄YõÿàY]8†%ù[àHòX⁄›\›Xõ›ôHö\ú›âÀ	Ÿ\úâ N»ô]\õé»BàŸ]›]\ 	›‘›]\…À	–⁄X⁄⁄[ô»ÿ[ÀYõ‹ùÿ\ôYôöX⁄Y[òﬁHõ‹àõÿà	»
»\›€€\]YõÿíY
»	ÀããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	›‘ôXYXõI Kú›[Kô\‹^HH	€õ€ôIŒ¬àÿ›[Y[ùôŸ][[Y[ùûRY
	›”›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ÿòX⁄›\››ŸôK…»
»\›€€\]YõÿíY
N¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	›”›]	À]JN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	›”›]	 Kú›[Kô\‹^HH	ÿõÿ⁄…Œ¬àYà
\ô\Àõ⁄ H»Ÿ]›]\ 	›‘›]\…À	—\úõ‹éà	»
»
]Kô\úõ‹àô\Àú›]\ K	Ÿ\úâ N»ô]\õé»BàŸ]›]\ 	›‘›]\…À	’⁄[ô›‹»€€\]Yà	»
»]Kù⁄[ô›‹–€€\]Y
»	»
\›[ò›òY[ô»^\»]òZ[XõNà	»
»]Kô\›[ò›òY[ô—^\–]òZ[XõH
»	 IÀ	€⁄… N¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	›‘ôXYXõI N¬àYà
]Kù⁄[ô›‹–€€\]YOOH
H¬à[ú›[Kô\‹^HH	ÿõÿ⁄…Œ¬à[ö[õô\íSH	œ]à€\‹œHõ]]Yèâ»
»]Kõõ›H
»	œŸ]èâŒ¬àH[ŸH¬à[ú›[Kô\‹^HH	ÿõÿ⁄…Œ¬à]H	œ]èèèâ»
»]Kõ›ô\ò[ú\‹–€›[ù
»	»T‘À	»
»]Kõ›ô\ò[ôòZ[€›[ù
»	»êRS‘“Q”ó—ìTQ	»
»]Kõ›ô\ò[ö[ú›YôöX⁄Y[ù€›[ù
»	»Sî’QëíP“QSï—UOÿèà
›]Ÿà	»
»]Kù⁄[ô›‹–€€\]Y
»	»õ€[ô»⁄[ô›‹ OŸ]èâŒ¬à]Kù⁄[ô›‹Àôõ‹ëXX⁄
ù[ò›[€ä H¬à€€ú›€€‹àHÀùô\ôX›ú›\ù’⁄]
	‘T‘… H»	»ÕÿYçL	»à
Àùô\ôX›ú›\ù’⁄]
	—êRS	 HÀùô\ôX›ú›\ù’⁄]
	‘“Q”ó—ìTQ	 H»	»ŸçÃÕâ»à	»ŒNNI N¬à
œH	œ]à›[OHõX\ô⁄[ã]‹çú»èí[ã\ÿ[\H	»
»Àö[îÿ[\Q^\÷ÃH
»	»8°§à	»
»Àö[îÿ[\Q^\÷ÃWH
»	À›][Ÿã\ÿ[\H	»
»Àõ›]Ÿîÿ[\Q^\÷ÃH
»	»8°§à	»
»Àõ›]Ÿîÿ[\Q^\÷ÃWH
»	œŸ]èâŒ¬à
œH	œ]èâõòú‹…õòú‹“[ã\ÿ[\HYôôX›à	»
»
Àö[îÿ[\QYôôX›œ»	¯†%	 H
»	»	õòú‹»›][Ÿã\ÿ[\HYôôX›à	»
»
Àõ›]Ÿîÿ[\QYôôX›œ»	¯†%	 H
»
ÀùŸôTò][»OHù[»	»	õòú‹»—ëHò][Œà	»
»ÀùŸôTò][»à	… H
»	œŸ]èâŒ¬à
œH	œ]à›[OHò€€‹éâ»
»€€‹à
»	Œ»èâõòú‹…õòú‹…»
»Àùô\ôX›
»	œŸ]èâŒ¬àJN¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»X\ô⁄[ã]‹çú»èâ»
»]Kõõ›H
»	œŸ]èâŒ¬à[ö[õô\íSH¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	›‘›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBà\ﬁ[ò»ù[ò›[€à‘òY‘]Y\ûJ
H¬àŸ]›]\ 	‹T›]\…À	‘ŸX\ò⁄[ôÀããâÀ	€]]Y	 N¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹TôXYXõI Kú›[Kô\‹^HH	€õ€ôIŒ¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹S›]	 Kú›[Kô\‹^HH	€õ€ôIŒ¬àûH¬à€€ú›õŸHH¬à‹›àù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	‹T‹›	 Kùò[YJKà›öZŸNàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	‹T›öZŸI Kùò[YJKà]î\òŸ[ùàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	‹R]â Kùò[YJKà^\’—^\ûNàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	‹QI Kùò[YJKà\–ÿ[àÿ›[Y[ùôŸ][[Y[ùûRY
	‹R\–ÿ[	 Kùò[YHOOH	›ùYIÀà‹Œàù[Xô\äÿ›[Y[ùôŸ][[Y[ùûRY
	‹U‹… Kùò[YJHKàN¬à€€ú›ô\»H]ÿZ]ô]⁄
	Àÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄‹òYÀ‹]Y\ûIÀ¬àY]Ÿà	‘‘’	ÀXY\úŒà»	–€€ù[ùU\IŒà	ÿ\Xÿ][€ã⁄ú€€â»KõŸNàî””ãú›ö[ô⁄YûJõŸJBàJN¬à€€ú›]HH]ÿZ]ô\Àöú€€ä
N¬à⁄›“ú€€ä	‹S›]	À]JN¬àYà
ô\Àõ⁄»	âà]KõX]⁄\ H¬àŸ]›]\ 	‹T›]\…À	—õ›[ô	»
»]KõX]⁄\Àõ[ô›
»	»⁄[Z[\à\›‹öXÿ[^J KâÀ	€⁄… N¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹TôXYXõI N¬à[ú›[Kô\‹^HH	ÿõÿ⁄…Œ¬à]H	œ]èèèïŸ^W	‹»€€\]Yô\ôX›èÿèà	»
»]Kú]Y\ûKùô\ôX›
»	»
õY‹Œà	»
»
]Kú]Y\ûKôõY‹Àõ[ô›»]Kú]Y\ûKôõY‹Àöõ⁄[ä	Œ»	 Hà	€õ€ôI H
»	 OŸ]èâŒ¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèì[‹›⁄[Z[\à\›‹öXÿ[^\ŒèÿèèŸ]èâŒ¬à]KõX]⁄\Àôõ‹ëXX⁄
ù[ò›[€äJH¬à
œH	œ]à›[OHõX\ô⁄[ã]‹çú»Y[ôŒçú»òX⁄Ÿ‹õ›[ôàÃXLYåŒ»õ‹ô\ã\òY]\Œç»èâŒ¬à
œH	œ]èâ»
»Kù[Y\›[\
»	»8†%⁄[Z[\ö]H	»
»
Kú⁄[Z[\ö]H
àL
Kù—ö^Y
JH
»	…H8†%ô\ôX›à	»
»Kùô\ôX›
»	œŸ]èâŒ¬àYà
Kõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OHù[
H
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»èìô^Y^H^ö[ú⁄X»ò[YH⁄[ôŸNà	»
»Kõô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›
»	…OŸ]èâŒ¬à
œH	œŸ]èâŒ¬àJN¬à[ö[õô\íSH¬àH[ŸH¬àŸ]›]\ 	‹T›]\…À	—òZ[Y8†%ŸYH]Z[»ô[›»
XZŸH›\ôH[›W	›ôHù[à]X\›€ôHòX⁄›\›Xõ›ôHö\ú›[à\»ÿ[YHŸ\ùô\àŸ\‹⁄[€äKâÀ	Ÿ\úâ N¬àBàHÿ]⁄
\úäH¬àŸ]›]\ 	‹T›]\…À	”ô]€‹ö»\úõ‹éà	»
»\úãõY\‹ÿYŸK	Ÿ\úâ N¬àBàBàù[ò›[€àô[ô\î›[[X\ûJ H¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	⁄î›[[X\ûTôXYXõI N¬à[ú›[Kô\‹^HH	ÿõÿ⁄…Œ¬àYà
Àô\úõ‹äH»[ö[õô\íSH	œ]à€\‹œHô\úàèâ»
»Àô\úõ‹à
»	œŸ]èâŒ»ô]\õé»Bà]H	…Œ¬à
œH	œ]èèèï›[^\»õÿŸ\‹ŸYèÿèà	»
»Àù›[^\»
»	»
òZ[Yà	»
»ÀôòZ[Y^\»
»	 OŸ]èâŒ¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèì›ô\ò[ô\ôX›‹]èÿèèŸ]èâŒ¬à
œH	œ]èº'ÁËà’PìNà	»
»Àõ›ô\ò[ú›XõQ^\»
»	»^\»
	»
»Àõ›ô\ò[ú›XõT›
»	…JOŸ]èâŒ¬à
œH	œ]èº'ÁËH–U“à	»
»Àõ›ô\ò[ùÿ]⁄^\»
»	»^\»
	»
»Àõ›ô\ò[ùÿ]⁄›
»	…JOŸ]èâŒ¬à
œH	œ]èº'Â-Sî’PìNà	»
»Àõ›ô\ò[ù[ú›XõQ^\»
»	»^\»
	»
»Àõ›ô\ò[ù[ú›XõT›
»	…JOŸ]èâŒ¬àYà
ÀòûQ^\’—^\ûH	âàÀòûQ^\’—^\ûKú€€YJàOàãô^\»à
JH¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèî‹]ûH^\À]ÀY^\ûH
Ÿ\»]Ÿ]€‹úŸHôX\à^\ûO NèÿèèŸ]èâŒ¬àÀòûQ^\’—^\ûKôõ‹ëXX⁄
ù[ò›[€ääH¬àYà
ãô^\»à
H
œH	œ]èâ»
»ãòùX⁄Ÿ]
»	»
	»
»ãô^\»
»	»^\ Nà<'ÁËâ»
»ãú›XõT›
»	…H<'ÁËI»
»ãùÿ]⁄›
»	…H<'Â-	»
»ãù[ú›XõT›
»	…OŸ]èâŒ¬àJN¬àH[ŸHYà
Àõõ›JH¬à
œH	œ]à€\‹œHõ]]Yà›[OHõX\ô⁄[ã]‹é»èâ»
»Àõõ›H
»	œŸ]èâŒ¬àBàYà
Àõ[‹›€€[[€ëõY‹»	âàÀõ[‹›€€[[€ëõY‹Àõ[ô›
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèì[‹›€€[[€àö\⁄»õY‹ŒèÿèèŸ]èâŒ¬àÀõ[‹›€€[[€ëõY‹Àú€XŸJJKôõ‹ëXX⁄
ù[ò›[€ääH¬à
œH	œ]è∏†(à	»
»ãôõY»
»	»8†%	»
»ãõÿÿ›\úôY€ë^\»
»	»^\»
	»
»ãú›Ÿë^\»
»	…JOŸ]èâŒ¬àJN¬àBàYà
Àô‹ôYZ‹—\›öXù][€äH¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèë‹ôYZ‹»\›öXù][€à
õ‹àô\⁄€ÿ[Xúò][€äNèÿèèŸ]èâŒ¬à€€ú›”Xô[»H»ò[õòNà	’ò[õòH
åçJIÀ⁄\õNà	–⁄\õH
ååäIÀ‹YYà	‘‹YY
ååJIÀõ€[XNà	÷õ€[XH
ååJIÀ€€‹éà	–€€‹à
ååJIÀõ€[XNà	’õ€[XH
çKå
IÀ[[XNà	’[[XH
åKçJI»N¬àÿöôX›öŸ^\ ”Xô[ Kôõ‹ëXX⁄
ù[ò›[€ä H¬à€€ú›HÀô‹ôYZ‹—\›öXù][€ñ⁄◊N¬àYà

H
œH	œ]èâ»
»”Xô[÷⁄◊H
»	ŒàLI»
»úL
»	ÀLI»
»úL
»	ÀMOI»
»úMH
»	ÀX^I»
»õX^
»	œŸ]èâŒ¬àJN¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»X\ô⁄[ã]‹ç»èâ»
»Àô‹ôYZ‹—\›öXù][€ìõ›H
»	œŸ]èâŒ¬àBà€€ú›[ú›HÀö[ú›]][€ò[¬àYà
[ú›
H¬àYà
[ú›õ⁄Qõ›»	âà[ú›õ⁄Qõ›Àô^\’⁄]⁄Q]Hà
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèì“Hõ›»
	»
»[ú›õ⁄Qõ›Àô^\’⁄]⁄Q]H
»	»^\»⁄]]JNèÿèèŸ]èâŒ¬à
œH	œ]èêùZ[\à	»
»[ú›õ⁄Qõ›ÀòùZ[\›
»	…H	õòú‹»[ù⁄[ô[ôŒà	»
»[ú›õ⁄Qõ›Àù[ù⁄[ô[ô‘›
»	…H	õòú‹»õ]à	»
»[ú›õ⁄Qõ›Àôõ]›
»	…OŸ]èâŒ¬àBàYà
[ú›ùõ€][]Tö\⁄‘ô[Z][H	âà[ú›ùõ€][]Tö\⁄‘ô[Z][Kô^\’⁄]ùë]Hà
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèïõ€][]Hö\⁄»ô[Z][H
Uàú»ôX[^ôYõ€
NèÿèèŸ]èâŒ¬à
œH	œ]èê]ô»Uà8¢$àïéà	»
»[ú›ùõ€][]Tö\⁄‘ô[Z][Kò]ô“]ìZ[ù\‘ùî›
»	»»	õòú‹»
UàöX⁄\à[àôX[^ôY€à	»
»[ú›ùõ€][]Tö\⁄‘ô[Z][Kú›^\“]îöX⁄\ï[îùà
»	…HŸà^\ OŸ]èâŒ¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»èâ»
»[ú›ùõ€][]Tö\⁄‘ô[Z][Kö[ù\úô]][€à
»	œŸ]èâŒ¬àBàYà
[ú›ö[\YYú‘ôX[^ôY[›ôH	âà[ú›ö[\YYú‘ôX[^ôY[›ôKô^\’⁄][›ôQ]Hà
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèí[\YYúÀàôX[^ôY[›ôH»^\ûNèÿèèŸ]èâŒ¬à
œH	œ]èê]ô»[›ôHò][Œà	»
»[ú›ö[\YYú‘ôX[^ôY[›ôKò]ô”[›ôTò][»
»	»	õòú‹»
X\öŸ][›ôY[‹ôH[àUà[\YY€à	»
»[ú›ö[\YYú‘ôX[^ôY[›ôKú›^\”X\öŸ][›ôY[‹ôU[í[\YY
»	…HŸà^\ OŸ]èâŒ¬àYà
[ú›ö[\YYú‘ôX[^ôY[›ôKòûUô\ôX›
H¬à[ú›ö[\YYú‘ôX[^ôY[›ôKòûUô\ôX›ôõ‹ëXX⁄
ù[ò›[€äùäH¬àYà
ùãô^\»à
H
œH	œ]èâõòú‹…õòú‹…»
»ùãùô\ôX›
»	»
	»
»ùãô^\»
»	»^\ Nà]ô»[›ôHò][»	»
»ùãò]ô”[›ôTò][»
»	œŸ]èâŒ¬àJN¬àBà
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»èâ»
»[ú›ö[\YYú‘ôX[^ôY[›ôKö[ù\úô]][€à
»	œŸ]èâŒ¬àBàYà
[ú›ôX[\ëŸ^	âà[ú›ôX[\ëŸ^ô^\’⁄]⁄Q]Hà
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹é»èèèí]\ö\›X»X[\à—V
\‹›[\[€ãXò\ŸYŸYHõ›JNèÿèèŸ]èâŒ¬à
œH	œ]èê]ô»[ú⁄Y€ôYÿ[[XH^‹›\ôNà	»
»[ú›ôX[\ëŸ^ò]ô’[ú⁄Y€ôYÿ[[XQ^‹›\ôSõ›[€ò[
»	»	õòú‹»]ô»⁄Y€ôY
]\ö\›X Nà	»
»[ú›ôX[\ëŸ^ò]ô“]\ö\›X‘⁄Y€ôYX[\ëŸ^õ›[€ò[
»	œŸ]èâŒ¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»èâ»
»[ú›ôX[\ëŸ^ö[ù\úô]][€à
»	œŸ]èâŒ¬àBàBàYà
Àõ›]€€YPûUô\ôX›	âàÀõ›]€€YPûUô\ôX›ú€€YJù[ò›[€ä H»ô]\õàÀô^\»à»JJH¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèì›]€€YK]YYàŸ\»Hô\ôX›ôYX›[û][ôœœÿèèŸ]èâŒ¬àÀõ›]€€YPûUô\ôX›ôõ‹ëXX⁄
ù[ò›[€ä H¬àYà
Àô^\»OOH
Hô]\õé¬à
œH	œ]à›[OHõX\ô⁄[ã]‹ç»èâ»
»Àùô\ôX›
»	»
	»
»Àô^\»
»	»^\ NèŸ]èâŒ¬à
œH	œ]èâõòú‹…õòú‹–]ô»^ö[ú⁄X»
[YJHò[YNà	»
»
Àò]ô—^ö[ú⁄X’ò[YHOHù[»Àò]ô—^ö[ú⁄X’ò[YKù—ö^Y
äHà	¯†%	 H
»	»	õòú‹»]ô»[ùö[ú⁄XŒà	»
»
Àò]ô“[ùö[ú⁄X’ò[YHOHù[»Àò]ô“[ùö[ú⁄X’ò[YKù—ö^Y
äHà	¯†%	 H
»	œŸ]èâŒ¬àYà
Àô^\’⁄]ô^ÿúŸ\ùò][€àà
H¬à
œH	œ]èâõòú‹…õòú‹”ô^Y^Hô[Z][H⁄[ôŸNà	»
»Àò]ô”ô^ÿúŸ\ùò][€îô[Z][P⁄[ôŸT›
»	…H	õòú‹»ô^Y^H^ö[ú⁄X»⁄[ôŸNà	»
»Àò]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›
»	…OŸ]èâŒ¬àBàJN¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»X\ô⁄[ã]‹ç»èâ»
»Àõ›]€€YR[ù\úô]][€à
»	œŸ]èâŒ¬àBàYà
ÀôP€€ùõ€Y›]€€YH	âàÀôP€€ùõ€Y›]€€YKõ[ô›
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèëKX€€ùõ€Y€€\\ö\€€à
HöY€‹õ›\»ô\ú⁄[€à8†%ÿ[YH^\À]ÀY^\ûH€õJNèÿèèŸ]èâŒ¬à]›\êùX⁄Ÿ]Hù[¬àÀôP€€ùõ€Y›]€€YKôõ‹ëXX⁄
ù[ò›[€äõ› H¬àYà
õ›ÀôPùX⁄Ÿ]OOH›\êùX⁄Ÿ]
H¬à›\êùX⁄Ÿ]Hõ›ÀôPùX⁄Ÿ]¬à
œH	œ]à›[OHõX\ô⁄[ã]‹çú»€€‹éàŸYåÕŒ»õ€ù\⁄^ôNåçÃúô[N»èâ»
»›\êùX⁄Ÿ]
»	œŸ]èâŒ¬àBà€€ú›ÿ\õàHõ›Àúÿ[\T⁄^ôUÿ\õö[ô»»	»‹[à›[OHò€€‹éàŸçÃÕé»èä	»
»õ›Àúÿ[\T⁄^ôUÿ\õö[ô»
»	 O‹‹[èâ»à	…Œ¬à
œH	œ]èâõòú‹…õòú‹…»
»õ›Àùô\ôX›
»	»
	»
»õ›Àô^\»
»	»^\ Nà]ô»^ö[ú⁄X»	»
»
õ›Àò]ô—^ö[ú⁄X’ò[YHOHù[»õ›Àò]ô—^ö[ú⁄X’ò[YKù—ö^Y
äHà	¯†%	 H
¬à	Àô^Y^H⁄[ôŸH	»
»
õ›Àò]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OHù[»õ›Àò]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›
»	…I»à	¯†%	 H
¬à
õ›Àú›]ìô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OHù[»	»0¨I»
»õ›Àú›]ìô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›
»	…I»à	… H
»ÿ\õà
»	œŸ]èâŒ¬àJN¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»X\ô⁄[ã]‹çú»èâ»
»ÀôP€€ùõ€Y[ù\úô]][€à
»	œŸ]èâŒ¬àBàYà
Àú⁄Y€öYöXÿ[òŸU\›	âàÀú⁄Y€öYöXÿ[òŸU\›õ[ô›
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèî›]\›Xÿ[⁄Y€öYöXÿ[òŸH\›
ôX[⁄Y€ò[‹àù\›õ⁄\ŸO NèÿèèŸ]èâŒ¬àÀú⁄Y€öYöXÿ[òŸU\›ôõ‹ëXX⁄
ù[ò›[€äõ› H¬à€€ú›ê€€‹àHõ›Àùô\ôX›OOH	”R—SW‘ëPS—QëëTëSê—I»»	»ÕÿYçL	»à
õ›Àùô\ôX›OOH	”ì’—T’Së’RT“PìW—îì”W”ì“T—I»»	»ŸçÃÕâ»à	»ŒNNI N¬à
œH	œ]à›[OHõX\ô⁄[ã]‹ç»èâ»
»õ›ÀôPùX⁄Ÿ]
»	Œà’PìHèI»
»õ›Àú›XõTÿ[\T⁄^ôH
»	À–U“
’Sî’PìHèI»
»õ›ÀôõYŸŸYÿ[\T⁄^ôH
¬à
õ›Àù›]OHù[»	À\›]I»
»õ›Àù›]à	… H
¬à	»8†%‹[à›[OHò€€‹éâ»
»ê€€‹à
»	Œ»èâ»
»õ›Àùô\ôX›
»	œ‹‹[èèŸ]èâŒ¬àJN¬à
œH	œ]à€\‹œHõ]]Yà›[OHôõ€ù\⁄^ôNåçéô[N»X\ô⁄[ã]‹çú»èâ»
»Àú⁄Y€öYöXÿ[òŸU\›[ù\úô]][€à
»	œŸ]èâŒ¬àBàYà
ÀòûR[ô]öYX[õY»	âàÀòûR[ô]öYX[õYÀõ[ô›
H¬à
œH	œ]à›[OHõX\ô⁄[ã]‹åLú»õ‹ô\ã]‹å\€€YÃòLôÃŒ»Y[ôÀ]‹é»èèèî\ãYõY»úôXZŸ›€à
⁄X⁄‘P“QíP»õY»ÿ\úöY\»H⁄Y€ò[
NèÿèèŸ]èâŒ¬àÀòûR[ô]öYX[õYÀôõ‹ëXX⁄
ù[ò›[€ääH¬à€€ú›ÿ\õàHãúÿ[\T⁄^ôUÿ\õö[ô»»	»‹[à›[OHò€€‹éàŸçÃÕé»èä	»
»ãúÿ[\T⁄^ôUÿ\õö[ô»
»	 O‹‹[èâ»à	…Œ¬à
œH	œ]à›[OHõX\ô⁄[ã]‹ç»èâ»
»ãôõY»
»	»8†%	»
»ãô^\»
»	»^\…»
»ÿ\õà
»	œŸ]èâŒ¬à
œH	œ]èâõòú‹…õòú‹–]ô»^ö[ú⁄X»ò[YNà	»
»
ãò]ô—^ö[ú⁄X’ò[YHOHù[»ãò]ô—^ö[ú⁄X’ò[YHà	¯†%	 H
¬à	»	õòú‹»]ô»ô^Y^H^ö[ú⁄X»⁄[ôŸNà	»
»
ãò]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›OHù[»ãò]ô”ô^ÿúŸ\ùò][€ë^ö[ú⁄X–⁄[ôŸT›
»	…I»à	¯†%	 H
»	œŸ]èâŒ¬àJN¬àBà[ö[õô\íSH¬àBè‹ÿ‹ö\ÇèÿõŸOÇè⁄[ò
N¬üJN¬ò\úõ›]Jãÿ\K€Ÿôõ[ôK\ô\ŸX\ò⁄ãŸôõ[ôTô\ŸX\ò⁄õ›]\äN¬