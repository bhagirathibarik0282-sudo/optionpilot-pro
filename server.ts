Warning: truncated output (original token count: 485256)
... 892445 bytes omitted ...

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
import { shouldRefreshCandidateSnapshot } from "./candidate-snapshot-freshness.js";
import { startH1ExactShadowLiveService } from "./h1-exact-shadow-live-service.js";

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
  // H1 Contract Metadata Layer — copied from the exact Kite instrument-master
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
  volume: number | null; // Kite's traded quantity for the day — needed for liquidity checks (rule 7)
  vwap: number | null; // Kite's average_price for this option, if provided
  vwapSource: "UNVERIFIED AVERAGE PRICE — NOT VWAP" | "VWAP UNAVAILABLE"; // Kite's average_price meaning has not been verified against provider docs to match a true session VWAP — never silently claim it is VWAP
  quoteTimestamp: string | null; // exchange/provider-side timestamp for THIS quote, distinct from backend receipt time
  atDayHigh: boolean;
  atDayLow: boolean;
  dayOpen: number; // 2026-08-19: today's intraday open (Kite's ohlc.open) -- added specifically to support the "O≈H" (open approx equal to high) rejection-candle detection in the Telegram PDL-Broken caution logic; was not previously captured anywhere on this interface even though Kite's quote response always includes it.
  dayHigh: number; // today's intraday high (Kite's ohlc.high)
  dayLow: number; // today's intraday low (Kite's ohlc.low)
  pdc: number; // previous day close (Kite's ohlc.close)
  pdh: number; // previous trading day's high, for this specific strike's premium
  pdl: number; // previous trading day's low, for this specific strike's premium
  vega: number; // Black-Scholes estimate — NOT from Kite (Kite doesn't publish Greeks)
  theta: number; // Black-Scholes estimate, per-day decay — NOT from Kite
  delta: number; // Black-Scholes estimate — NOT from Kite
  gamma: number; // Black-Scholes estimate (2026-08-17, advanced chain) — NOT from Kite
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

// PHASE62_KITE_RUNTIME_WIRING_V1 — restart-safe authority cache only.
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


// ============================================================================
// V2 MODULE 1 — PREMIUM COMPOSITION HISTORY ENGINE
// Added as an observation-only, additive layer. It derives composition/history
// exclusively from already-recorded 3-minute Recorder snapshots; it does NOT
// fetch Kite, mutate raw Recorder data, call AI, or change runRuleEngine().
//
// Important design boundary:
// - Current expiry / ATM±3 only, because that is what Recorder currently stores.
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
    source: "Recorder 3-minute Truth-gated snapshots; current expiry ATM±3 only",
    scoringImpact: "NONE",
    snapshotCount: eligible.length,
    dataQuality: overallQuality,
    comparisons,
  };
}


// ============================================================================
// V2 MODULE 6 — PREMIUM ATTRIBUTION ENGINE
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
// V2 MODULE 7 — OI POSITIONING EVIDENCE ENGINE
// Observation-only diagnostic built from the Recorder's already-stored
// current-expiry ATM±3 same-strike OI + premium history.
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
    source: "Existing Recorder current-expiry ATM±3 same-strike premium/OI snapshots only; no new market-data request",
    interpretationGuard: "OI expansion/contraction is positioning evidence, not proof of long/short ownership."
  };
}

// ============================================================================
// V2 MODULE 8 — ROLLOVER / EXPIRY MIGRATION EVIDENCE ENGINE
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
// - Stores only ATM±3 aggregate CE/PE OI + mean premium/IV for first two distinct
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
// V2 MODULE 2 — COMPUTED IV CHANGE + STRIKE SKEW ENGINE
// Observation-only, additive diagnostic built from the Recorder's already-stored
// current-expiry ATM±3 strike IV values. IV here is MODEL-COMPUTED from option
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
    source: "Recorder 3-minute Truth-gated snapshots; current expiry ATM±3; IV is model-computed from option LTP, not supplied by Kite",
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
// V2 MODULE 3 — MULTI-EXPIRY IV TERM STRUCTURE ENGINE
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
// V2 MODULE 9 — MULTI-EXPIRY ALIGNMENT EVIDENCE ENGINE
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
// V2 MODULE 4 — INDIA VIX REGIME ENGINE
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

    // K2 (2026-08-21, FULL_MIGRATION_TO_KITE_ONLY) — Recorder Truth-check and
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
    // db.ts), so a rejected promise here is impossible…212152 tokens truncated…neResearchRouter.get("/backtest/status/:jobId", (c) => {
  try {
    const job = offlineResearchJobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "Unknown jobId." }, 404);
    return c.json({
      jobId: job.id,
      status: job.status,
      totalRecords: job.totalRecords,
      processedRecords: job.processedRecords,
      progressPct: job.totalRecords ? Math.round((job.processedRecords / job.totalRecords) * 1000) / 10 : 0,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    });
  } catch (err) {
    return c.json({ error: "Status lookup failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

/** GET /api/offline-research/backtest/result/:jobId — full row-level results once DONE. */
offlineResearchRouter.get("/backtest/result/:jobId", (c) => {
  try {
    const job = offlineResearchJobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "Unknown jobId." }, 404);
    if (job.status !== "DONE" && job.status !== "FAILED") {
      return c.json({ error: "Job not finished yet.", status: job.status, progressPct: job.totalRecords ? Math.round((job.processedRecords / job.totalRecords) * 1000) / 10 : 0 }, 409);
    }
    const okRows = job.results.filter((r) => r.status === "OK");
    const summary = {
      stable: okRows.filter((r) => r.verdict === "STABLE").length,
      watch: okRows.filter((r) => r.verdict === "WATCH").length,
      unstable: okRows.filter((r) => r.verdict === "UNSTABLE").length,
      failed: job.results.length - okRows.length,
    };
    return c.json({ jobId: job.id, status: job.status, error: job.error, summary, results: job.results });
  } catch (err) {
    return c.json({ error: "Result fetch failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

/**
 * GET /api/offline-research/backtest/summary/:jobId
 * Human-readable aggregate stats, so you never have to manually count a
 * JSON array of daily rows. Computes: overall STABLE/WATCH/UNSTABLE %,
 * the same breakdown split by "days to expiry" bucket (so you can see
 * whether instability clusters near expiry, e.g. charm decay), and average
 * greek magnitudes. Pure read-only aggregation over job.results — does not
 * re-fetch anything or touch any live state.
 */
offlineResearchRouter.get("/backtest/summary/:jobId", (c) => {
  try {
    const job = offlineResearchJobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "Unknown jobId." }, 404);
    if (job.status !== "DONE" && job.status !== "FAILED") {
      return c.json({ error: "Job not finished yet.", status: job.status }, 409);
    }
    const okRows = job.results.filter((r) => r.status === "OK" && r.advancedGreeks);
    const total = job.results.length;
    const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

    const stableCount = okRows.filter((r) => r.verdict === "STABLE").length;
    const watchCount = okRows.filter((r) => r.verdict === "WATCH").length;
    const unstableCount = okRows.filter((r) => r.verdict === "UNSTABLE").length;
    const failedCount = total - okRows.length;

    // Bucket by proximity to expiry — this is the pattern most worth
    // seeing: does instability cluster right before expiry (charm/theta
    // decay effects) or is it spread evenly?
    type Bucket = { label: string; min: number; max: number };
    const buckets: Bucket[] = [
      { label: "0-1 days to expiry", min: 0, max: 1 },
      { label: "2-4 days to expiry", min: 2, max: 4 },
      { label: "5-10 days to expiry", min: 5, max: 10 },
      { label: "11+ days to expiry", min: 11, max: Infinity },
    ];
    // daysToExpiry isn't stored directly on BacktestRowResult, only inside
    // the original record it was computed from — recompute the bucket key
    // from advancedGreeks' own theta/charm sign is unreliable, so instead
    // we bucket using the row's timestamp-vs-nothing is not possible here;
    // instead expose per-row daysToExpiry by carrying it through. See
    // note below: bucketing uses r.daysToExpiryForSummary if present.
    const byBucket = buckets.map((b) => {
      const rows = okRows.filter((r: any) => {
        const dte = r.daysToExpiryForSummary;
        return typeof dte === "number" && dte >= b.min && dte <= b.max;
      });
      const unstable = rows.filter((r) => r.verdict === "UNSTABLE").length;
      const watch = rows.filter((r) => r.verdict === "WATCH").length;
      const stable = rows.filter((r) => r.verdict === "STABLE").length;
      return { bucket: b.label, days: rows.length, stablePct: pct(stable, rows.length), watchPct: pct(watch, rows.length), unstablePct: pct(unstable, rows.length) };
    });

    const avg = (fn: (ag: NonNullable<BacktestRowResult["advancedGreeks"]>) => number) =>
      okRows.length ? Math.round((okRows.reduce((s, r) => s + Math.abs(fn(r.advancedGreeks!)), 0) / okRows.length) * 10000) / 10000 : null;

    // Flag frequency — which specific risk flag fires most often.
    const flagCounts: Record<string, number> = {};
    okRows.forEach((r) => (r.flags || []).forEach((f) => { flagCounts[f] = (flagCounts[f] || 0) + 1; }));

    return c.json({
      jobId: job.id, status: job.status,
      totalDays: total, failedDays: failedCount,
      overall: {
        stablePct: pct(stableCount, okRows.length), watchPct: pct(watchCount, okRows.length), unstablePct: pct(unstableCount, okRows.length),
        stableDays: stableCount, watchDays: watchCount, unstableDays: unstableCount,
      },
      byDaysToExpiry: byBucket,
      averageAbsGreeks: {
        vanna: avg((ag) => ag.vanna), charm: avg((ag) => ag.charm), speed: avg((ag) => ag.speed), zomma: avg((ag) => ag.zomma), color: avg((ag) => ag.color),
        vomma: avg((ag) => ag.vomma), ultima: avg((ag) => ag.ultima),
      },
      mostCommonFlags: Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([flag, count]) => ({ flag, occurredOnDays: count, pctOfDays: pct(count, okRows.length) })),
      // GREEKS DISTRIBUTION — added 2026-08-16 in direct response to a real
      // finding: the vomma/ultima flag thresholds (5.0 / 1.5) were taken
      // as-is from the user's research spec, NOT independently calibrated
      // against this codebase's own gamma/vega scaling convention. A live
      // run showed the ultima flag firing on ~67% of days (not "elevated",
      // just "usual"), which collapsed the STABLE baseline needed for the
      // DTE-controlled/significance comparisons. Rather than guess a new
      // threshold, this exposes the ACTUAL |value| percentile distribution
      // for vanna/charm/speed/zomma/color/vomma/ultima from this job's own
      // data, so a threshold near the 90th/95th percentile (i.e. genuinely
      // unusual, not typical) can be picked empirically next.
      greeksDistribution: (() => {
        function percentileStats(values: number[]) {
          if (!values.length) return null;
          const sorted = [...values].sort((a, b) => a - b);
          const pctile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
          return {
            count: sorted.length,
            min: Math.round(sorted[0] * 1e6) / 1e6,
            p50: Math.round(pctile(50) * 1e6) / 1e6,
            p90: Math.round(pctile(90) * 1e6) / 1e6,
            p95: Math.round(pctile(95) * 1e6) / 1e6,
            p99: Math.round(pctile(99) * 1e6) / 1e6,
            max: Math.round(sorted[sorted.length - 1] * 1e6) / 1e6,
          };
        }
        const fields: (keyof NonNullable<BacktestRowResult["advancedGreeks"]>)[] = ["vanna", "charm", "speed", "zomma", "color", "vomma", "ultima"];
        const out: Record<string, ReturnType<typeof percentileStats>> = {};
        fields.forEach((f) => {
          out[f] = percentileStats(okRows.map((r) => Math.abs(r.advancedGreeks![f])));
        });
        return out;
      })(),
      greeksDistributionNote: "Percentiles of |value| across all days in this job. Current flag thresholds: charm>0.02, vanna>0.5, zomma>0.05 OR color>0.01, speed>0.01, vomma>5.0, ultima>1.5 — compare each threshold against that greek's p90/p95 here. If the threshold sits BELOW p50 (like ultima appears to), it's firing on the majority of days and isn't actually flagging anything unusual; a properly 'elevated' threshold should sit close to p90-p95 of this job's own distribution.",
      institutional: (() => {
        const oiRows = okRows.filter((r) => r.oiState && r.oiState !== "INSUFFICIENT_HISTORY");
        const rvRows = okRows.filter((r) => typeof r.ivMinusRvPct === "number");
        const moveRows = okRows.filter((r) => typeof r.moveRatio === "number");
        const avgOf = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
        // The key predictive cross-tab: on days flagged UNSTABLE, did the
        // market subsequently move MORE relative to what IV implied
        // (moveRatio > 1) more often than on STABLE days? If yes, that's
        // real evidence the greeks-driven verdict is catching something
        // the option's own IV was mispricing — not just a descriptive flag.
        const moveRatioByVerdict = (["STABLE", "WATCH", "UNSTABLE"] as const).map((v) => {
          const rows = moveRows.filter((r) => r.verdict === v);
          return { verdict: v, days: rows.length, avgMoveRatio: avgOf(rows.map((r) => r.moveRatio!)), pctWhereMarketMovedMoreThanImplied: pct(rows.filter((r) => r.moveRatio! > 1).length, rows.length) };
        });
        return {
          oiFlow: {
            daysWithOiData: oiRows.length,
            buildupPct: pct(oiRows.filter((r) => r.oiState === "BUILDUP").length, oiRows.length),
            unwindingPct: pct(oiRows.filter((r) => r.oiState === "UNWINDING").length, oiRows.length),
            flatPct: pct(oiRows.filter((r) => r.oiState === "FLAT").length, oiRows.length),
          },
          volatilityRiskPremium: {
            daysWithRvData: rvRows.length,
            avgIvMinusRvPct: avgOf(rvRows.map((r) => r.ivMinusRvPct!)),
            pctDaysIvRicherThanRv: pct(rvRows.filter((r) => (r.ivMinusRvPct ?? 0) > 0).length, rvRows.length),
            interpretation: "Positive avgIvMinusRvPct = IV was typically richer than the underlying's recent realized moves (classic vol-selling backdrop). Negative = IV was typically cheap relative to realized (classic vol-buying backdrop).",
          },
          impliedVsRealizedMove: {
            daysWithMoveData: moveRows.length,
            avgMoveRatio: avgOf(moveRows.map((r) => r.moveRatio!)),
            pctDaysMarketMovedMoreThanImplied: pct(moveRows.filter((r) => r.moveRatio! > 1).length, moveRows.length),
            byVerdict: moveRatioByVerdict,
            interpretation: "moveRatio > 1 means the underlying actually moved MORE by this contract's expiry than its own IV implied it would (options were cheap in hindsight). Compare byVerdict rows: if UNSTABLE-day moveRatios run higher than STABLE-day moveRatios, that's evidence the verdict is catching real mispricing, not just noise.",
          },
          dealerGex: {
            daysWithOiData: oiRows.length,
            avgUnsignedGammaExposureNotional: avgOf(oiRows.map((r) => r.gammaExposureNotional ?? 0)),
            avgHeuristicSignedDealerGexNotional: avgOf(oiRows.map((r) => r.heuristicDealerGexNotional ?? 0)),
            interpretation: "heuristicDealerGexNotional applies a common industry ASSUMPTION (call OI = dealer short gamma = negative sign; put OI = dealer long gamma = positive sign) — Dhan's data cannot confirm actual dealer positioning, so read this as a widely-used proxy, not a verified fact. A negative average suggests the flagged contracts skewed toward calls (a regime where dealers, under this assumption, would be hedging by buying into rallies/selling into dips — amplifying moves); positive suggests the opposite (dampening moves).",
          },
        };
      })(),
      // OUTCOME-TIED: the direct answer to "does the verdict predict
      // anything, or is it just descriptive" — average next-observation
      // premium/extrinsic-value change, split by the verdict that was
      // showing on the PRIOR day. Also includes raw intrinsic/extrinsic/
      // theoreticalPremium averages by verdict, since extrinsic value
      // (time value) is the direct theta-decay P&L proxy for a
      // hypothetical premium seller.
      outcomeByVerdict: (() => {
        const withOutcome = okRows.filter((r) => typeof r.nextObservationExtrinsicChangePct === "number");
        const avgOf = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
        return (["STABLE", "WATCH", "UNSTABLE"] as const).map((v) => {
          const verdictRows = okRows.filter((r) => r.verdict === v);
          const outcomeRows = withOutcome.filter((r) => r.verdict === v);
          return {
            verdict: v,
            days: verdictRows.length,
            avgIntrinsicValue: avgOf(verdictRows.map((r) => r.advancedGreeks!.intrinsicValue)),
            avgExtrinsicValue: avgOf(verdictRows.map((r) => r.advancedGreeks!.extrinsicValue)),
            avgTheoreticalPremium: avgOf(verdictRows.map((r) => r.advancedGreeks!.theoreticalPremium)),
            daysWithNextObservation: outcomeRows.length,
            avgNextObservationPremiumChangePct: avgOf(outcomeRows.map((r) => r.nextObservationPremiumChangePct!)),
            avgNextObservationExtrinsicChangePct: avgOf(outcomeRows.map((r) => r.nextObservationExtrinsicChangePct!)),
          };
        });
      })(),
      outcomeInterpretation: "Compare avgNextObservationExtrinsicChangePct across the three verdict rows above. If UNSTABLE/WATCH days show a LARGER (more positive, or less negative) next-observation extrinsic change than STABLE days, that's direct evidence the verdict is catching real premium-value events, not just noise — a premium seller would have wanted to avoid/hedge on exactly those flagged days. If the three are roughly equal, the verdict isn't (yet) predicting outcomes on this sample — only describing when 2nd/3rd-order greeks are elevated, which is still useful context but not proof of trading edge. CAVEAT: this comparison is CONFOUNDED by days-to-expiry — WATCH/UNSTABLE days are concentrated near expiry, where extrinsic value is naturally small and %-decay is naturally larger regardless of any flag, so this table alone can't separate 'the flag matters' from 'being near expiry matters'. See dteControlledOutcome below for the properly controlled version of this same question.",
      // DTE-CONTROLLED CROSS-TAB — the rigorous version of outcomeByVerdict
      // above. Splits by (days-to-expiry bucket) x (verdict) so STABLE and
      // WATCH/UNSTABLE are only ever compared against each other WITHIN the
      // same distance-to-expiry, removing the DTE confound. Also reports
      // the standard deviation of the next-day extrinsic change (not just
      // the average) — a flag that doesn't move the average but widens the
      // spread is still meaningfully different (more tail risk), which an
      // average-only comparison would hide. Cells with under 20 days are
      // explicitly flagged LOW_SAMPLE_SIZE rather than silently included —
      // per the "no silent caps" principle, small samples are labeled, not
      // hidden or dropped.
      dteControlledOutcome: (() => {
        const stdDevOf = (arr: number[]) => {
          if (arr.length < 2) return null;
          const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
          const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (arr.length - 1);
          return Math.round(Math.sqrt(variance) * 100) / 100;
        };
        const avgOf2 = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
        const rows: { dteBucket: string; verdict: string; days: number; avgExtrinsicValue: number | null; avgNextObservationExtrinsicChangePct: number | null; stdDevNextObservationExtrinsicChangePct: number | null; sampleSizeWarning: string | null }[] = [];
        for (const b of buckets) {
          for (const v of ["STABLE", "WATCH", "UNSTABLE"] as const) {
            const cellRows = okRows.filter((r: any) => {
              const dte = r.daysToExpiryForSummary;
              return r.verdict === v && typeof dte === "number" && dte >= b.min && dte <= b.max;
            });
            if (cellRows.length === 0) continue; // don't report empty cells — genuinely no data, not a zero result
            const outcomeVals = cellRows.filter((r) => typeof r.nextObservationExtrinsicChangePct === "number").map((r) => r.nextObservationExtrinsicChangePct!);
            rows.push({
              dteBucket: b.label, verdict: v, days: cellRows.length,
              avgExtrinsicValue: avgOf2(cellRows.map((r) => r.advancedGreeks!.extrinsicValue)),
              avgNextObservationExtrinsicChangePct: avgOf2(outcomeVals),
              stdDevNextObservationExtrinsicChangePct: stdDevOf(outcomeVals),
              sampleSizeWarning: cellRows.length < 20 ? "LOW_SAMPLE_SIZE (" + cellRows.length + " days) — treat this cell as anecdotal, not statistically reliable" : null,
            });
          }
        }
        return rows;
      })(),
      dteControlledInterpretation: "Read this table by DTE bucket, comparing verdicts WITHIN the same bucket only (never across buckets — that's the confound this table removes). Within a bucket with adequate sample size (no sampleSizeWarning) on both STABLE and WATCH/UNSTABLE rows: if WATCH/UNSTABLE's avgNextObservationExtrinsicChangePct or stdDev is meaningfully different from STABLE's, that's real evidence the verdict adds information beyond just 'how close to expiry'. If a bucket only has STABLE data (no WATCH/UNSTABLE rows at that DTE), no comparison is possible there yet — needs more ingested history to fill in. See significanceTest below for an objective real-vs-noise read on this same comparison, and byIndividualFlag for which SPECIFIC flag (not the aggregate verdict) carries the signal.",
      // STATISTICAL SIGNIFICANCE TEST — turns "the averages look different" into
      // an objective read. Welch's t-test (unequal variances, doesn't assume
      // STABLE and WATCH/UNSTABLE have the same spread — they usually won't)
      // comparing next-day extrinsic-value change: STABLE vs WATCH+UNSTABLE
      // combined (combined because UNSTABLE alone is usually too small a
      // sample on its own — see its own day count to judge), computed
      // WITHIN each DTE bucket so it inherits the same confound-free
      // comparison as the table above. |t| > ~2 is the standard rule-of-thumb
      // for "probably not noise" at ~95% confidence in reasonably-sized
      // samples — reported as a plain-language verdict, not a raw stat only
      // a statistician would read.
      significanceTest: (() => {
        function welchT(a: number[], b: number[]): { t: number; nA: number; nB: number } | null {
          if (a.length < 5 || b.length < 5) return null; // too small for any t-test to mean anything
          const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
          const variance = (arr: number[], m: number) => arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
          const mA = mean(a), mB = mean(b);
          const vA = variance(a, mA), vB = variance(b, mB);
          const se = Math.sqrt(vA / a.length + vB / b.length);
          if (se === 0) return null;
          return { t: Math.round(((mA - mB) / se) * 100) / 100, nA: a.length, nB: b.length };
        }
        return buckets.map((b) => {
          const stableVals = okRows.filter((r: any) => r.verdict === "STABLE" && typeof r.daysToExpiryForSummary === "number" && r.daysToExpiryForSummary >= b.min && r.daysToExpiryForSummary <= b.max && typeof r.nextObservationExtrinsicChangePct === "number").map((r) => r.nextObservationExtrinsicChangePct!);
          const flaggedVals = okRows.filter((r: any) => (r.verdict === "WATCH" || r.verdict === "UNSTABLE") && typeof r.daysToExpiryForSummary === "number" && r.daysToExpiryForSummary >= b.min && r.daysToExpiryForSummary <= b.max && typeof r.nextObservationExtrinsicChangePct === "number").map((r) => r.nextObservationExtrinsicChangePct!);
          const result = welchT(stableVals, flaggedVals);
          return {
            dteBucket: b.label,
            stableSampleSize: stableVals.length, flaggedSampleSize: flaggedVals.length,
            tStat: result?.t ?? null,
            verdict: !result ? "INSUFFICIENT_DATA (need at least 5 days on both sides)" : Math.abs(result.t) > 2 ? "LIKELY_REAL_DIFFERENCE" : "NOT_DISTINGUISHABLE_FROM_NOISE",
          };
        }).filter((r) => r.stableSampleSize > 0 || r.flaggedSampleSize > 0);
      })(),
      significanceTestInterpretation: "tStat is a Welch's t-statistic comparing STABLE vs (WATCH+UNSTABLE combined) next-day extrinsic-value change, within each DTE bucket. |tStat| > ~2 is read as LIKELY_REAL_DIFFERENCE (probably not just noise, ~95% confidence rule of thumb); otherwise NOT_DISTINGUISHABLE_FROM_NOISE means this sample can't yet tell the flag apart from randomness at that DTE — that is an honest 'we don't know yet', not a 'the flag doesn't work'. More ingested history (bigger sample) is what narrows that down.",
      // PER-FLAG BREAKDOWN — the aggregate STABLE/WATCH/UNSTABLE verdict
      // bundles multiple different risk flags together (charm decay, vanna,
      // zomma/color, speed). They may not carry equal signal — this breaks
      // the outcome analysis down by the SPECIFIC flag text instead, so you
      // can see which individual 2nd/3rd-order greek is actually doing the
      // predictive work, rather than crediting the whole verdict bucket.
      byIndividualFlag: (() => {
        const avgOf3 = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
        const flagSet = new Set<string>();
        okRows.forEach((r) => (r.flags || []).forEach((f) => flagSet.add(f)));
        return Array.from(flagSet).map((flag) => {
          const flaggedRows = okRows.filter((r) => (r.flags || []).includes(flag));
          const outcomeVals = flaggedRows.filter((r) => typeof r.nextObservationExtrinsicChangePct === "number").map((r) => r.nextObservationExtrinsicChangePct!);
          return {
            flag, days: flaggedRows.length,
            avgExtrinsicValue: avgOf3(flaggedRows.map((r) => r.advancedGreeks!.extrinsicValue)),
            avgNextObservationExtrinsicChangePct: avgOf3(outcomeVals),
            sampleSizeWarning: flaggedRows.length < 20 ? "LOW_SAMPLE_SIZE (" + flaggedRows.length + " days)" : null,
          };
        }).sort((a, b) => b.days - a.days);
      })(),
      note: byBucket.every((b) => b.days === 0)
        ? "byDaysToExpiry is empty for this job — that field is only populated for jobs run after this summary feature was added. Re-run /ingest/dhan-historical to get it filled in."
        : undefined,
    });
  } catch (err) {
    return c.json({ error: "Summary failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

/**
 * GET /api/offline-research/backtest/wfe/:jobId
 * Walk-Forward Efficiency (WFE) — added 2026-08-16 per user-supplied
 * research spec (in_sample_days:20, out_of_sample_days:5, ratio 4:1,
 * min_wfe_threshold:0.65). Read-only, in-memory, isolated — same safety
 * contract as every other route in this router.
 *
 * WHY THIS MATTERS: every other summary stat in this module (outcomeByVerdict,
 * dteControlledOutcome, significanceTest) is computed over the WHOLE ingested
 * window at once. That's an in-sample-only measurement — it can't tell you
 * whether the STABLE-vs-WATCH/UNSTABLE effect found in Sept data still shows
 * up in Nov data, or whether it was a fluke of that particular window
 * (classic overfitting risk in any backtest). WFE answers that by rolling a
 * 20-day "train" window forward day by day, each time checking the SAME
 * effect (avg next-day extrinsic-value change: WATCH+UNSTABLE minus STABLE)
 * on the very next 5 "test" days the window hasn't seen yet, then comparing
 * out-of-sample effect size to in-sample effect size.
 *
 * HONEST LIMITATION: this needs at least 25 distinct trading days of
 * ingested history (20 in-sample + 5 out-of-sample) per window. Given
 * Dhan's confirmed short rolling-option lookback (see /probe/dhan-rolling-lookback
 * notes), a fresh ingest may not have enough distinct days yet — in that case
 * this endpoint returns windowsComputed: 0 and says so plainly, rather than
 * fabricating a WFE number from too little data.
 */
offlineResearchRouter.get("/backtest/wfe/:jobId", (c) => {
  try {
    const job = offlineResearchJobs.get(c.req.param("jobId"));
    if (!job) return c.json({ error: "Unknown jobId." }, 404);
    if (job.status !== "DONE" && job.status !== "FAILED") {
      return c.json({ error: "Job not finished yet.", status: job.status }, 409);
    }
    const IN_SAMPLE_DAYS = 20;
    const OUT_OF_SAMPLE_DAYS = 5;
    const MIN_WFE_THRESHOLD = 0.65;

    const okRows = job.results.filter(
      (r) => r.status === "OK" && r.verdict && typeof r.nextObservationExtrinsicChangePct === "number"
    );

    // Group by calendar day (date portion of timestamp only).
    const dayOf = (ts: string) => ts.slice(0, 10);
    const dayMap = new Map<string, BacktestRowResult[]>();
    okRows.forEach((r) => {
      const d = dayOf(r.timestamp);
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d)!.push(r);
    });
    const sortedDays = Array.from(dayMap.keys()).sort();

    // Effect size for one set of rows: avg next-day extrinsic change for
    // WATCH+UNSTABLE minus avg for STABLE (same quantity significanceTest
    // uses, so WFE and significanceTest are directly comparable).
    function effectSize(rows: BacktestRowResult[]): { effect: number | null; nStable: number; nFlagged: number } {
      const stableVals = rows.filter((r) => r.verdict === "STABLE").map((r) => r.nextObservationExtrinsicChangePct!);
      const flaggedVals = rows.filter((r) => r.verdict === "WATCH" || r.verdict === "UNSTABLE").map((r) => r.nextObservationExtrinsicChangePct!);
      if (stableVals.length < 3 || flaggedVals.length < 3) return { effect: null, nStable: stableVals.length, nFlagged: flaggedVals.length };
      const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
      return { effect: mean(flaggedVals) - mean(stableVals), nStable: stableVals.length, nFlagged: flaggedVals.length };
    }

    type WfeWindow = {
      inSampleDays: string[]; outOfSampleDays: string[];
      inSampleEffect: number | null; outOfSampleEffect: number | null;
      wfeRatio: number | null;
      verdict: string;
    };
    const windows: WfeWindow[] = [];

    for (let i = 0; i + IN_SAMPLE_DAYS + OUT_OF_SAMPLE_DAYS <= sortedDays.length; i++) {
      const inDays = sortedDays.slice(i, i + IN_SAMPLE_DAYS);
      const outDays = sortedDays.slice(i + IN_SAMPLE_DAYS, i + IN_SAMPLE_DAYS + OUT_OF_SAMPLE_DAYS);
      const inRows = inDays.flatMap((d) => dayMap.get(d) || []);
      const outRows = outDays.flatMap((d) => dayMap.get(d) || []);
      const inFx = effectSize(inRows);
      const outFx = effectSize(outRows);

      let wfeRatio: number | null = null;
      let verdict: string;
      if (inFx.effect === null || outFx.effect === null) {
        verdict = "INSUFFICIENT_DATA (need at least 3 STABLE and 3 WATCH/UNSTABLE days on both sides)";
      } else if (inFx.effect === 0) {
        verdict = "IN_SAMPLE_EFFECT_ZERO (cannot compute a ratio)";
      } else {
        wfeRatio = Math.round((outFx.effect / inFx.effect) * 100) / 100;
        if (Math.sign(outFx.effect) !== Math.sign(inFx.effect)) {
          verdict = "SIGN_FLIPPED (effect reversed out-of-sample — likely overfit / not a stable pattern yet)";
        } else if (wfeRatio >= MIN_WFE_THRESHOLD) {
          verdict = "PASS (out-of-sample retains >= " + (MIN_WFE_THRESHOLD * 100) + "% of in-sample effect)";
        } else {
          verdict = "FAIL (out-of-sample effect decays below the " + (MIN_WFE_THRESHOLD * 100) + "% threshold — treat in-sample effect with caution)";
        }
      }
      windows.push({
        inSampleDays: [inDays[0], inDays[inDays.length - 1]],
        outOfSampleDays: [outDays[0], outDays[outDays.length - 1]],
        inSampleEffect: inFx.effect != null ? Math.round(inFx.effect * 100) / 100 : null,
        outOfSampleEffect: outFx.effect != null ? Math.round(outFx.effect * 100) / 100 : null,
        wfeRatio,
        verdict,
      });
    }

    const passCount = windows.filter((w) => w.verdict.startsWith("PASS")).length;
    const failCount = windows.filter((w) => w.verdict.startsWith("FAIL") || w.verdict.startsWith("SIGN_FLIPPED")).length;
    const insufficientCount = windows.length - passCount - failCount;

    return c.json({
      jobId: job.id,
      distinctTradingDaysAvailable: sortedDays.length,
      daysRequiredPerWindow: IN_SAMPLE_DAYS + OUT_OF_SAMPLE_DAYS,
      windowsComputed: windows.length,
      windows,
      overall: {
        passCount, failCount, insufficientCount,
      },
      note: windows.length === 0
        ? `Not enough distinct trading days ingested yet — need at least ${IN_SAMPLE_DAYS + OUT_OF_SAMPLE_DAYS} distinct days, this job has ${sortedDays.length}. Ingest more history (or wait for daily accumulation) and re-check this endpoint with the same jobId — no fabricated result is returned in the meantime.`
        : "Read each window left-to-right (oldest first). PASS means the in-sample effect held up out-of-sample that time — the closer to consistently PASS across windows, the more this looks like a real, generalizing pattern rather than an artifact of one lucky stretch of days.",
    });
  } catch (err) {
    return c.json({ error: "WFE failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

/**
 * POST /api/offline-research/rag/query
 * Body: { spot, strike, ivPercent, daysToExpiry, isCall, topK? }
 * Computes 3rd-gen greeks for the given (hypothetical or live-observed)
 * contract shape, then finds the most similar historical rows already
 * ingested via /backtest/run, by cosine similarity over the greeks feature
 * vector. Pure lookup — read-only, no side effects on live state.
 */
offlineResearchRouter.post("/rag/query", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const { spot, strike, ivPercent, daysToExpiry, isCall, topK } = body ?? {};
    if (typeof spot !== "number" || typeof strike !== "number" || typeof ivPercent !== "number" || typeof daysToExpiry !== "number" || typeof isCall !== "boolean") {
      return c.json({ error: "Body must include numeric spot, strike, ivPercent, daysToExpiry and boolean isCall." }, 400);
    }
    if (offlineResearchVectorIndex.length === 0) {
      return c.json({ error: "Vector index is empty — run at least one /backtest/run job first to populate historical analogs." }, 409);
    }
    const ag = calcAdvancedGreeks(spot, strike, ivPercent, daysToExpiry, isCall);
    if (!ag) return c.json({ error: "calcAdvancedGreeks returned null for the given inputs (check spot/strike/ivPercent/daysToExpiry)." }, 400);
    const queryVector = offlineResearchFeatureVector(ag, ivPercent, daysToExpiry);
    const k = Math.min(Math.max(1, Number(topK) || 5), 50);
    const scored = offlineResearchVectorIndex
      .map((entry) => ({ similarity: cosineSimilarity(queryVector, entry.vector), record: entry.record }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    const { verdict, flags } = classifyAdvancedGreeksRow(ag);
    return c.json({
      query: { spot, strike, ivPercent, daysToExpiry, isCall, advancedGreeks: ag, verdict, flags },
      matches: scored.map((s) => ({ similarity: Math.round(s.similarity * 10000) / 10000, ...s.record })),
      note: "Historical similarity only — not a live trade signal. This module never touches the M12 candidate-selection or Telegram alert paths.",
    });
  } catch (err) {
    return c.json({ error: "RAG query failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

/** DELETE /api/offline-research/reset — clears in-memory jobs + vector index (dev convenience, no live-state impact). */
offlineResearchRouter.delete("/reset", (c) => {
  try {
    offlineResearchJobs.clear();
    offlineResearchVectorIndex.length = 0;
    return c.json({ ok: true, note: "Offline-research in-memory state cleared. Live dashboard/M12/Telegram paths were never touched." });
  } catch (err) {
    return c.json({ error: "Reset failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

// ---- Dhan historical data ingestion (read-only) -----------------------------
//
// Fills the /backtest/run pipeline above from REAL Dhan history instead of
// requiring you to hand-build a JSON array yourself. Uses ONLY the Dhan
// endpoint this codebase has already live-verified elsewhere
// (/v2/charts/historical — confirmed PASS with open/high/low/close/volume/
// timestamp arrays by dhanAuditSpotHistory()), called twice: once for the
// underlying index (spot per day) and once for a specific option contract
// (premium per day). It deliberately does NOT use the newer /v2/charts/
// rollingoption endpoint (which this codebase's own V3-D audit comments
// flag as "not a confirmed schema" — its implied_volatility/spot fields
// have never been checked against a live response here), so as not to
// build on an unverified foundation. Instead, IV is implied ourselves via
// bisection against the same calcAdvancedGreeks() pricer already used
// live, so the whole pipeline is self-consistent end to end.
//
// You supply the option contract's own Dhan securityId (get it from your
// existing /api/dhan/contracts or the option-chain endpoints), its strike
// and expiry date — this module does not resolve those on its own, so it
// can never guess wrong about which contract it's pricing.

function offlineResearchDhanTimestampToDateStr(ts: number): string {
  // Mirrors the epoch-seconds-vs-milliseconds heuristic already used by
  // dhanAuditSpotHistory() above (ts > 10,000,000,000 => milliseconds).
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bisection search for the IV that makes calcAdvancedGreeks' theoretical
 *  premium match an observed market premium. Bounded iteration count so a
 *  bad/impossible target (e.g. premium above intrinsic+huge extrinsic)
 *  can never spin forever — it just returns the closest bracket found. */
function offlineResearchImplyIv(
  spot: number, strike: number, daysToExpiry: number, isCall: boolean, targetPremium: number
): number | null {
  let lo = 0.5, hi = 300; // 0.5%..300% IV search band
  const priceAt = (ivPct: number) => calcAdvancedGreeks(spot, strike, ivPct, daysToExpiry, isCall)?.theoreticalPremium;
  const priceLo = priceAt(lo);
  const priceHi = priceAt(hi);
  if (priceLo == null || priceHi == null) return null;
  if (targetPremium <= priceLo) return lo;
  if (targetPremium >= priceHi) return hi;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    const priceMid = priceAt(mid);
    if (priceMid == null) return null;
    if (Math.abs(priceMid - targetPremium) < 0.01) return mid;
    if (priceMid < targetPremium) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface DhanHistoricalCandles {
  open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; timestamp: number[];
  /** Only present/meaningful for option/future legs (requested via
   *  includeOi=true below) — indices carry no OI, so underlying fetches
   *  never request it. */
  oi?: number[];
}

async function offlineResearchFetchDhanHistorical(
  accessToken: string, clientId: string,
  securityId: string, exchangeSegment: string, instrument: string,
  fromDate: string, toDate: string,
  includeOi: boolean = false
): Promise<{ ok: true; candles: DhanHistoricalCandles } | { ok: false; error: string }> {
  try {
    const res = await dhanRateLimitedFetch("https://api.dhan.co/v2/charts/historical", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": accessToken, "client-id": clientId },
      body: JSON.stringify({ securityId, exchangeSegment, instrument, expiryCode: 0, oi: includeOi, fromDate, toDate }),
    });
    const raw = await res.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!res.ok || !payload || typeof payload !== "object") {
      const providerMsg = payload?.errorMessage || `HTTP ${res.status}`;
      return { ok: false, error: "Dhan historical request failed: " + providerMsg };
    }
    const { open, high, low, close, volume, timestamp, oi } = payload;
    if (![open, high, low, close, volume, timestamp].every((a) => Array.isArray(a))) {
      return { ok: false, error: "Dhan historical response missing one or more of open/high/low/close/volume/timestamp arrays." };
    }
    return { ok: true, candles: { open, high, low, close, volume, timestamp, oi: Array.isArray(oi) ? oi : undefined } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * POST /api/offline-research/ingest/dhan-historical
 * Body: {
 *   symbol: "NIFTY"|"BANKNIFTY"|"SENSEX"|"FINNIFTY"|"MIDCPNIFTY",
 *   optionSecurityId: string|number,  // the SPECIFIC contract's Dhan security ID
 *   strike: number,
 *   expiryDate: string,               // "YYYY-MM-DD"
 *   isCall: boolean,
 *   fromDate: string, toDate: string  // "YYYY-MM-DD"
 * }
 * Fetches real Dhan history (read-only), implies IV per day against the
 * live calcAdvancedGreeks pricer, then hands the resulting records to the
 * SAME chunked/non-blocking runOfflineResearchBacktest() job pipeline as
 * /backtest/run — so this is just an alternate, real-data-backed way to
 * populate a job, not a second code path.
 */
offlineResearchRouter.post("/ingest/dhan-historical", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const symbol = String(body?.symbol || "").trim().toUpperCase();
    const optionSecurityId = body?.optionSecurityId;
    const strike = Number(body?.strike);
    const expiryDate = String(body?.expiryDate || "");
    const isCall = !!body?.isCall;
    const fromDate = String(body?.fromDate || "");
    const toDate = String(body?.toDate || "");

    if (!symbol || optionSecurityId == null || !Number.isFinite(strike) || !expiryDate || !fromDate || !toDate) {
      return c.json({ error: "Body must include symbol, optionSecurityId, strike, expiryDate, isCall, fromDate, toDate." }, 400);
    }
    const mapping = DHAN_UNDERLYING_MAP[symbol];
    if (!mapping) {
      return c.json({ error: `Unknown symbol "${symbol}". Supported: ${Object.keys(DHAN_UNDERLYING_MAP).join(", ")}` }, 400);
    }
    const accessToken = (await getValidDhanAccessToken()) || "";
    const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
    if (!accessToken || !clientId) {
      return c.json({ error: "Dhan not configured (DHAN_ACCESS_TOKEN/auto-refresh or DHAN_CLIENT_ID missing)." }, 503);
    }

    // 1. Underlying spot history — the CONFIRMED-working call/shape.
    //    Indices carry no OI, so this fetch never requests it.
    const spotResult = await offlineResearchFetchDhanHistorical(
      accessToken, clientId, String(mapping.underlyingScrip), mapping.underlyingSeg, "INDEX", fromDate, toDate, false
    );
    if (!spotResult.ok) return c.json({ error: "Underlying fetch failed: " + spotResult.error }, 502);

    // 2. This specific option contract's own premium+OI history — same
    //    endpoint/shape, different securityId/segment/instrument. OI is
    //    requested (includeOi=true) so oiState/gamma-exposure can be
    //    computed alongside the greeks, institutional-desk style.
    const optionsSegment = symbol === "SENSEX" ? "BSE_FNO" : "NSE_FNO";
    const optionResult = await offlineResearchFetchDhanHistorical(
      accessToken, clientId, String(optionSecurityId), optionsSegment, "OPTIDX", fromDate, toDate, true
    );
    if (!optionResult.ok) return c.json({ error: "Option contract fetch failed: " + optionResult.error }, 502);

    // Build a date -> spot close/high/low map AND a date-sorted series (the
    // latter needed for the trailing-20-day Parkinson realized-vol window
    // and for looking up "what did spot actually do by expiry"). Read-only
    // lookup, no mutation of any live session/market-data state elsewhere
    // in this file.
    const spotByDate = new Map<string, { close: number; high: number; low: number }>();
    spotResult.candles.timestamp.forEach((ts, i) => {
      spotByDate.set(offlineResearchDhanTimestampToDateStr(ts), {
        close: spotResult.candles.close[i], high: spotResult.candles.high[i], low: spotResult.candles.low[i],
      });
    });
    const spotSeriesSorted = Array.from(spotByDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const spotDateIndex = new Map<string, number>();
    spotSeriesSorted.forEach((row, idx) => spotDateIndex.set(row.date, idx));

    // Trailing-N-day Parkinson realized volatility ending at (and
    // including) the given date, annualized to a percent — directly
    // comparable to ivPercent. Standard estimator: more sample-efficient
    // than close-to-close for the same window because it uses each day's
    // full high-low range, not just the close.
    const PARKINSON_WINDOW = 20;
    function parkinsonRvPctEndingAt(dateStr: string): number | null {
      const idx = spotDateIndex.get(dateStr);
      if (idx == null || idx + 1 < PARKINSON_WINDOW) return null;
      const window = spotSeriesSorted.slice(idx - PARKINSON_WINDOW + 1, idx + 1);
      let sumSq = 0;
      for (const day of window) {
        if (!(day.high > 0) || !(day.low > 0) || day.high < day.low) return null;
        const lnHL = Math.log(day.high / day.low);
        sumSq += lnHL * lnHL;
      }
      const variance = sumSq / (4 * Math.LN2 * PARKINSON_WINDOW);
      if (!Number.isFinite(variance) || variance < 0) return null;
      return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 100 * 100) / 100;
    }

    const expiryMs = new Date(expiryDate + "T00:00:00Z").getTime();
    if (Number.isNaN(expiryMs)) return c.json({ error: `Invalid expiryDate "${expiryDate}" (expected YYYY-MM-DD).` }, 400);
    // Spot on (or nearest trading day at/after) expiry, if that date falls
    // inside the ingested underlying window — used for the implied-vs-
    // realized-move comparison. Left undefined (not guessed) when the
    // window doesn't reach that far.
    const expiryDateOnlyStr = expiryDate;
    const forwardSpotAtExpiry = spotByDate.get(expiryDateOnlyStr)?.close
      ?? spotSeriesSorted.find((row) => row.date >= expiryDateOnlyStr)?.close;

    const records: HistoricalGreeksRecord[] = [];
    let skipped = 0;
    const optCandles = optionResult.candles;
    for (let i = 0; i < optCandles.timestamp.length; i++) {
      try {
        const dateStr = offlineResearchDhanTimestampToDateStr(optCandles.timestamp[i]);
        const spotRow = spotByDate.get(dateStr);
        const premium = optCandles.close[i];
        if (spotRow == null || !Number.isFinite(spotRow.close) || !Number.isFinite(premium) || premium <= 0) { skipped++; continue; }
        const spot = spotRow.close;
        const dayMs = new Date(dateStr + "T00:00:00Z").getTime();
        const daysToExpiry = Math.max(0, Math.round((expiryMs - dayMs) / 86_400_000));
        const impliedIv = offlineResearchImplyIv(spot, strike, daysToExpiry, isCall, premium);
        if (impliedIv == null) { skipped++; continue; }
        const oi = optCandles.oi?.[i];
        const oiPrevDay = i > 0 ? optCandles.oi?.[i - 1] : undefined;
        records.push({
          timestamp: dateStr, symbol, spot, strike, ivPercent: impliedIv, daysToExpiry, isCall,
          oi: typeof oi === "number" ? oi : undefined,
          oiPrevDay: typeof oiPrevDay === "number" ? oiPrevDay : undefined,
          realizedVolPct: parkinsonRvPctEndingAt(dateStr) ?? undefined,
          forwardSpotAtExpiry: dayMs <= expiryMs ? forwardSpotAtExpiry : undefined,
        });
      } catch {
        skipped++;
      }
      if ((i + 1) % OFFLINE_RESEARCH_BATCH_SIZE === 0) await offlineResearchYield();
    }

    if (records.length === 0) {
      return c.json({ error: "No usable records built (spot/premium dates didn't overlap, or IV could not be implied for any day).", skipped }, 422);
    }

    const job: BacktestJob = {
      id: offlineResearchJobId(), status: "QUEUED",
      totalRecords: records.length, processedRecords: 0,
      startedAt: Date.now(), finishedAt: null, error: null, results: [],
    };
    offlineResearchJobs.set(job.id, job);
    void runOfflineResearchBacktest(job, records).catch((err) => {
      job.status = "FAILED";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
    });

    return c.json({
      jobId: job.id, status: job.status,
      recordsIngested: records.length, recordsSkipped: skipped,
      note: "IV was implied locally via bisection against calcAdvancedGreeks — not read directly from Dhan (Dhan's own implied_volatility field, in /v2/charts/rollingoption, is not yet schema-confirmed in this codebase). Each day also carries OI flow, IV-vs-realized-vol spread, and implied-vs-realized move (institutional-style context) where the data allows it. Poll /backtest/status/:jobId next.",
    }, 202);
  } catch (err) {
    return c.json({ error: "Ingestion failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
/**
 * POST /api/offline-research/ingest/dhan-rolling-history
 * Body: { symbol, side: "CE"|"PE", fromDate, toDate, expiryWeekday? }
 *
 * The proper tool for a real MULTI-EXPIRY 1-year backtest. The regular
 * /ingest/dhan-historical above only works for ONE already-identified,
 * still-listed contract — and Dhan's option chain (used to look up a
 * contract's securityId) only exposes CURRENT/FUTURE expiries, never
 * expired ones. So there is no way to walk backward week-by-week and
 * resolve each past week's contract ourselves. Dhan's own
 * /v2/charts/rollingoption endpoint exists to solve exactly this: it
 * returns a continuous "always-nearest-ATM" time series across a date
 * range, rolling from one weekly expiry to the next internally, in ONE
 * call — no per-week resolution needed on our side.
 *
 * HONESTY NOTE (read before trusting the output): this codebase has only
 * ever PROBED /v2/charts/rollingoption once before (in the V3-D audit
 * section above), and that probe's own comment says its exact response
 * schema is "our best-effort read of Dhan's docs, not a confirmed
 * schema". So this handler parses the response DEFENSIVELY — it checks
 * for several plausible field names rather than assuming one — and it
 * makes ONE further assumption it cannot verify from here: which weekday
 * NSE's current weekly expiry falls on (used to estimate daysToExpiry
 * per row, since the rolling series doesn't appear to return each row's
 * exact expiry date). That assumption is a parameter (expiryWeekday,
 * default 2 = Tuesday, NSE's weekly-expiry weekday as of the most recent
 * confirmed information used in this codebase's training) — override it
 * if your first real run's results look wrong (e.g. daysToExpiry never
 * reaching 0, or bunching oddly).
 */
/**
 * GET /api/offline-research/probe/dhan-rolling-lookback?symbol=NIFTY&side=CE
 *
 * Finds Dhan's real historical lookback limit for /v2/charts/rollingoption
 * in ONE call, instead of you manually trying dates one at a time. Probes
 * several small (5-day) windows at increasing distances into the past
 * (7, 15, 30, 45, 60, 90, 120, 150, 180, 270, 365 days back from today) and
 * reports which ones succeeded — the boundary between the last SUCCESS and
 * the first FAILURE is your real usable lookback window for
 * /ingest/dhan-rolling-history. Read-only, small requests only (5 days
 * each), all through the same rate-limited queue as every other Dhan call
 * here.
 */
offlineResearchRouter.get("/probe/dhan-rolling-lookback", async (c) => {
  try {
    const symbol = (c.req.query("symbol") || "NIFTY").trim().toUpperCase();
    const side = (c.req.query("side") || "CE").trim().toUpperCase();
    if (side !== "CE" && side !== "PE") return c.json({ error: "side must be CE or PE." }, 400);
    const mapping = DHAN_UNDERLYING_MAP[symbol];
    if (!mapping) return c.json({ error: `Unknown symbol "${symbol}". Supported: ${Object.keys(DHAN_UNDERLYING_MAP).join(", ")}` }, 400);
    const accessToken = (await getValidDhanAccessToken()) || "";
    const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
    if (!accessToken || !clientId) return c.json({ error: "Dhan not configured." }, 503);

    const optionsSegment = symbol === "SENSEX" ? "BSE_FNO" : "NSE_FNO";
    const todayMs = Date.now();
    const OFFSETS_DAYS = [7, 15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 365];
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    const probeResults: { offsetDays: number; from: string; to: string; ok: boolean; detail: string }[] = [];
    for (const offset of OFFSETS_DAYS) {
      const windowEndMs = todayMs - offset * 86_400_000;
      const windowStartMs = windowEndMs - 4 * 86_400_000; // 5-day probe window
      const from = fmt(windowStartMs);
      const to = fmt(windowEndMs);
      try {
        const rollRes = await dhanRateLimitedFetch("https://api.dhan.co/v2/charts/rollingoption", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": accessToken, "client-id": clientId },
          body: JSON.stringify({
            exchangeSegment: optionsSegment, interval: "1", securityId: String(mapping.underlyingScrip),
            instrument: "OPTIDX", expiryFlag: "WEEK", expiryCode: 1, strike: "ATM",
            drvOptionType: side === "CE" ? "CALL" : "PUT",
            requiredData: ["close", "oi", "implied_volatility", "spot"], fromDate: from, toDate: to,
          }),
        });
        const raw = await rollRes.text();
        let payload: any = null;
        try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
        if (!rollRes.ok || !payload) {
          probeResults.push({ offsetDays: offset, from, to, ok: false, detail: (payload?.errorCode || "") + " " + (payload?.errorMessage || `HTTP ${rollRes.status}`) });
        } else {
          const outer = (payload.data && typeof payload.data === "object") ? payload.data : payload;
          const sideData = outer[side === "CE" ? "ce" : "pe"] || outer;
          const hasData = sideData && typeof sideData === "object" && Object.values(sideData).some((v) => Array.isArray(v) && v.length > 0);
          probeResults.push({ offsetDays: offset, from, to, ok: !!hasData, detail: hasData ? "data present" : "response OK but no non-empty arrays found" });
        }
      } catch (err) {
        probeResults.push({ offsetDays: offset, from, to, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    const lastSuccess = [...probeResults].reverse().find((r) => r.ok);
    const firstFailureAfterSuccess = probeResults.find((r) => lastSuccess && r.offsetDays > lastSuccess.offsetDays && !r.ok);

    return c.json({
      symbol, side, probedAt: fmt(todayMs),
      probeResults,
      recommendedSafeLookbackDays: lastSuccess ? lastSuccess.offsetDays : null,
      recommendedFromDate: lastSuccess ? lastSuccess.from : null,
      boundaryNote: lastSuccess && firstFailureAfterSuccess
        ? `Usable lookback is somewhere between ${lastSuccess.offsetDays} days (worked) and ${firstFailureAfterSuccess.offsetDays} days (failed) back from today. Use recommendedFromDate as a SAFE starting point for /ingest/dhan-rolling-history's fromDate.`
        : lastSuccess ? `All probed offsets up to ${lastSuccess.offsetDays} days succeeded — try /ingest/dhan-rolling-history with fromDate even further back than ${lastSuccess.from} if you want more history.`
        : "No offset succeeded — check Dhan configuration/session, or this endpoint may not be available on your Dhan plan.",
    });
  } catch (err) {
    return c.json({ error: "Probe failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
offlineResearchRouter.post("/ingest/dhan-rolling-history", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const symbol = String(body?.symbol || "").trim().toUpperCase();
    const side = String(body?.side || "").trim().toUpperCase();
    const fromDate = String(body?.fromDate || "");
    const toDate = String(body?.toDate || "");
    const expiryWeekday = Number.isInteger(body?.expiryWeekday) ? body.expiryWeekday : 2; // 0=Sun..6=Sat, default Tuesday

    if (!symbol || (side !== "CE" && side !== "PE") || !fromDate || !toDate) {
      return c.json({ error: "Body must include symbol, side (CE or PE), fromDate, toDate (YYYY-MM-DD)." }, 400);
    }
    const mapping = DHAN_UNDERLYING_MAP[symbol];
    if (!mapping) {
      return c.json({ error: `Unknown symbol "${symbol}". Supported: ${Object.keys(DHAN_UNDERLYING_MAP).join(", ")}` }, 400);
    }
    const accessToken = (await getValidDhanAccessToken()) || "";
    const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
    if (!accessToken || !clientId) {
      return c.json({ error: "Dhan not configured (DHAN_ACCESS_TOKEN/auto-refresh or DHAN_CLIENT_ID missing)." }, 503);
    }

    // 1. Underlying spot history over the full range — the CONFIRMED-working
    //    call/shape, needed for the Parkinson realized-vol window and as a
    //    spot fallback if the rolling response doesn't carry its own spot.
    const spotResult = await offlineResearchFetchDhanHistorical(
      accessToken, clientId, String(mapping.underlyingScrip), mapping.underlyingSeg, "INDEX", fromDate, toDate, false
    );
    if (!spotResult.ok) return c.json({ error: "Underlying fetch failed: " + spotResult.error }, 502);
    const spotByDate = new Map<string, { close: number; high: number; low: number }>();
    spotResult.candles.timestamp.forEach((ts, i) => {
      spotByDate.set(offlineResearchDhanTimestampToDateStr(ts), {
        close: spotResult.candles.close[i], high: spotResult.candles.high[i], low: spotResult.candles.low[i],
      });
    });
    const spotSeriesSorted = Array.from(spotByDate.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const spotDateIndex = new Map<string, number>();
    spotSeriesSorted.forEach((row, idx) => spotDateIndex.set(row.date, idx));
    const PARKINSON_WINDOW = 20;
    function parkinsonRvPctEndingAt(dateStr: string): number | null {
      const idx = spotDateIndex.get(dateStr);
      if (idx == null || idx + 1 < PARKINSON_WINDOW) return null;
      const window = spotSeriesSorted.slice(idx - PARKINSON_WINDOW + 1, idx + 1);
      let sumSq = 0;
      for (const day of window) {
        if (!(day.high > 0) || !(day.low > 0) || day.high < day.low) return null;
        const lnHL = Math.log(day.high / day.low);
        sumSq += lnHL * lnHL;
      }
      const variance = sumSq / (4 * Math.LN2 * PARKINSON_WINDOW);
      if (!Number.isFinite(variance) || variance < 0) return null;
      return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 100 * 100) / 100;
    }

    // 2. The rolling-ATM option series. Dhan caps this endpoint at 90 days
    //    per call (confirmed live 2026-08-16: error DH-905 "Data for Option
    //    Charts can be fetched for 90 days at a time" when a full year was
    //    requested in one shot) — so a 1-year range is walked in <=85-day
    //    chunks (kept a few days under the cap as margin) and stitched
    //    together here. Each chunk still goes through dhanRateLimitedFetch,
    //    so the mandatory inter-request spacing is respected automatically;
    //    this loop does not add any extra manual sleeps.
    const optionsSegment = symbol === "SENSEX" ? "BSE_FNO" : "NSE_FNO";
    const CHUNK_DAYS = 85;
    const rangeStartMs = new Date(fromDate + "T00:00:00Z").getTime();
    const rangeEndMs = new Date(toDate + "T00:00:00Z").getTime();
    if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs < rangeStartMs) {
      return c.json({ error: "Invalid fromDate/toDate (expected YYYY-MM-DD, fromDate <= toDate)." }, 400);
    }
    const chunks: { from: string; to: string }[] = [];
    for (let chunkStart = rangeStartMs; chunkStart <= rangeEndMs; chunkStart += (CHUNK_DAYS + 1) * 86_400_000) {
      const chunkEnd = Math.min(chunkStart + CHUNK_DAYS * 86_400_000, rangeEndMs);
      chunks.push({ from: new Date(chunkStart).toISOString().slice(0, 10), to: new Date(chunkEnd).toISOString().slice(0, 10) });
    }

    const records: HistoricalGreeksRecord[] = [];
    let skipped = 0;
    let ivFieldSeenAnywhere = false;
    let lastResponseKeysFound: string[] = [];
    const chunkErrors: { from: string; to: string; error: string; httpStatus?: number; errorCode?: string; errorType?: string; requestSent?: any; rawSnippet?: string }[] = [];

    for (const chunk of chunks) {
      try {
        const rollBody = {
          exchangeSegment: optionsSegment,
          interval: "1",
          // securityId is a STRING on every other confirmed-working Dhan
          // call in this codebase (offlineResearchFetchDhanHistorical,
          // dhanAuditSpotHistory, etc.) — fixed 2026-08-16 after the first
          // live rollingoption attempt failed with a generic "missing
          // required fields / bad values" error on every chunk, and this
          // was the one param sent as a raw number here instead of String().
          securityId: String(mapping.underlyingScrip),
          instrument: "OPTIDX",
          expiryFlag: "WEEK",
          expiryCode: 1,
          strike: "ATM",
          drvOptionType: side === "CE" ? "CALL" : "PUT",
          requiredData: ["open", "high", "low", "close", "volume", "oi", "implied_volatility", "spot"],
          fromDate: chunk.from, toDate: chunk.to,
        };
        const rollRes = await dhanRateLimitedFetch("https://api.dhan.co/v2/charts/rollingoption", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": accessToken, "client-id": clientId },
          body: JSON.stringify(rollBody),
        });
        const rollRaw = await rollRes.text();
        let rollPayload: any = null;
        try { rollPayload = rollRaw ? JSON.parse(rollRaw) : null; } catch { rollPayload = null; }
        if (!rollRes.ok || !rollPayload || typeof rollPayload !== "object") {
          const msg = (rollPayload && typeof rollPayload === "object" ? rollPayload.errorMessage : null) || `HTTP ${rollRes.status}`;
          chunkErrors.push({
            from: chunk.from, to: chunk.to, error: msg, httpStatus: rollRes.status,
            errorCode: rollPayload?.errorCode, errorType: rollPayload?.errorType,
            requestSent: chunkErrors.length === 0 ? rollBody : undefined, // only echo the request on the FIRST failure, to keep the response small
            rawSnippet: chunkErrors.length === 0 ? rollRaw.slice(0, 300) : undefined,
          });
          continue;
        }

        // Defensive field extraction — several plausible key names/
        // locations, since the exact schema isn't confirmed. CONFIRMED
        // LIVE 2026-08-16: the real top-level shape is { ce: {...}, pe:
        // {...} } — each side's own arrays nested under its own key, not
        // flat at the top level like the earlier probe assumed. Prefer
        // the side matching drvOptionType; fall back to top-level/other
        // side/data-wrapper in case a future response shape differs again.
        const outer = (rollPayload.data && typeof rollPayload.data === "object") ? rollPayload.data : rollPayload;
        const sideKey = side === "CE" ? "ce" : "pe";
        const src = (outer[sideKey] && typeof outer[sideKey] === "object") ? outer[sideKey]
          : (outer.ce || outer.pe) && typeof (outer.ce || outer.pe) === "object" ? (outer.ce || outer.pe)
          : outer;
        lastResponseKeysFound = Object.keys(outer);
        const pick = (...names: string[]) => names.map((n) => src[n]).find((v) => Array.isArray(v));
        const timestamps: number[] | undefined = pick("timestamp", "time", "start_Time");
        const closes: number[] | undefined = pick("close");
        const rollSpots: number[] | undefined = pick("spot", "underlyingSpot", "underlying_spot");
        const ivs: number[] | undefined = pick("implied_volatility", "impliedVolatility", "iv");
        const ois: number[] | undefined = pick("oi", "openInterest");
        if (Array.isArray(ivs)) ivFieldSeenAnywhere = true;

        if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
          chunkErrors.push({ from: chunk.from, to: chunk.to, error: "No usable timestamp/close arrays in this chunk's response (outer keys: " + lastResponseKeysFound.join(",") + "; inner/" + sideKey + " keys: " + Object.keys(src).join(",") + ")." });
          continue;
        }

        for (let i = 0; i < timestamps.length; i++) {
          try {
            const dateStr = offlineResearchDhanTimestampToDateStr(timestamps[i]);
            const premium = closes[i];
            const spot = (Array.isArray(rollSpots) ? rollSpots[i] : undefined) ?? spotByDate.get(dateStr)?.close;
            if (!Number.isFinite(premium) || premium <= 0 || spot == null || !Number.isFinite(spot)) { skipped++; continue; }

            // ASSUMPTION (see handler doc comment): next occurrence of
            // expiryWeekday on/after this date is treated as this row's
            // weekly expiry, since the rolling series doesn't return an
            // explicit per-row expiry date.
            const day = new Date(dateStr + "T00:00:00Z");
            const daysUntilWeekday = (expiryWeekday - day.getUTCDay() + 7) % 7;
            const daysToExpiry = daysUntilWeekday; // 0 if today IS the assumed expiry day
            const strike = Math.round(spot); // ATM approx — Dhan doesn't return the resolved strike itself in this series

            let ivPercent: number | undefined = Array.isArray(ivs) ? ivs[i] : undefined;
            if (typeof ivPercent === "number" && ivPercent > 0 && ivPercent < 5) ivPercent = ivPercent * 100; // normalize 0.xx fraction -> percent, if that's what Dhan sent
            if (typeof ivPercent !== "number" || !(ivPercent > 0)) {
              const implied = offlineResearchImplyIv(spot, strike, daysToExpiry, side === "CE", premium);
              if (implied == null) { skipped++; continue; }
              ivPercent = implied;
            }

            const oi = Array.isArray(ois) ? ois[i] : undefined;
            const oiPrevDay = Array.isArray(ois) && i > 0 ? ois[i - 1] : undefined;

            records.push({
              timestamp: dateStr, symbol, spot, strike, ivPercent, daysToExpiry, isCall: side === "CE",
              oi: typeof oi === "number" ? oi : undefined,
              oiPrevDay: typeof oiPrevDay === "number" ? oiPrevDay : undefined,
              realizedVolPct: parkinsonRvPctEndingAt(dateStr) ?? undefined,
            });
          } catch {
            skipped++;
          }
        }
      } catch (chunkErr) {
        chunkErrors.push({ from: chunk.from, to: chunk.to, error: chunkErr instanceof Error ? chunkErr.message : String(chunkErr) });
      }
      await offlineResearchYield(); // yield between chunks regardless — each chunk can be hundreds of rows
    }

    if (records.length === 0) {
      return c.json({
        error: "No usable records built from any chunk of the rolling series.",
        chunksRequested: chunks.length, chunksFailed: chunkErrors.length, chunkErrors,
        skipped, responseKeysFound: lastResponseKeysFound,
      }, 422);
    }

    const job: BacktestJob = {
      id: offlineResearchJobId(), status: "QUEUED",
      totalRecords: records.length, processedRecords: 0,
      startedAt: Date.now(), finishedAt: null, error: null, results: [],
    };
    offlineResearchJobs.set(job.id, job);
    void runOfflineResearchBacktest(job, records).catch((err) => {
      job.status = "FAILED";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
    });

    return c.json({
      jobId: job.id, status: job.status,
      recordsIngested: records.length, recordsSkipped: skipped,
      chunksRequested: chunks.length, chunksSucceeded: chunks.length - chunkErrors.length,
      chunkErrors: chunkErrors.length ? chunkErrors : undefined,
      ivSource: ivFieldSeenAnywhere ? "DHAN_ROLLINGOPTION_FIELD (fell back to local bisection on any row where it was missing/invalid)" : "LOCAL_BISECTION (rollingoption response had no usable implied_volatility field in any chunk)",
      expiryWeekdayAssumed: expiryWeekday,
      responseKeysFound: lastResponseKeysFound,
      note: "This used the UNCONFIRMED /v2/charts/rollingoption schema and an assumed weekly-expiry weekday — check daysToExpiry values in the result for sanity (should cycle 0-6, never negative or stuck). If they look wrong, re-run with a different expiryWeekday (0=Sun..6=Sat) or send me responseKeysFound + a raw sample and I'll fix the field mapping. Dhan limits this endpoint to 90 days per call, so the requested range was split into " + chunks.length + " chunk(s) and stitched together — if chunksSucceeded is less than chunksRequested, see chunkErrors for which date ranges failed. OBSERVED 2026-08-16: older chunks (further back than ~3 weeks) failed with DH-905 while the most recent chunk succeeded — this may mean Dhan's rollingoption endpoint only serves a limited recent lookback window, not the full requested range. If you need to confirm/find that cutoff, try a small isolated range (e.g. just the last 30 days) and then push the fromDate progressively further back until DH-905 reappears.",
    }, 202);
  } catch (err) {
    return c.json({ error: "Rolling ingestion failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
// Mount the isolated router. app.route() namespaces every path above under
// /api/offline-research/* — it does not register on, wrap, or shadow any
// existing route, and existing routes registered earlier in this file are
// completely unaffected by this call.
/**
 * GET /api/offline-research/resolve/dhan-contract
 *   ?symbol=NIFTY&strike=24500&expiryDate=2026-08-28&side=CE
 *
 * Convenience lookup so you don't have to manually find a contract's Dhan
 * securityId before calling /ingest/dhan-historical. Reuses the SAME
 * official Option Chain API call this codebase already uses elsewhere
 * (/v2/optionchain — see the D2 Security-ID Mapper above, which confirmed
 * live that each strike/side leg carries its own `security_id` field), so
 * this is not a new/unverified lookup path — just this specific strike
 * picked out of the same response shape already proven to work here.
 * Read-only: one GET to Dhan's option chain, nothing written anywhere.
 */
offlineResearchRouter.get("/resolve/dhan-contract", async (c) => {
  try {
    const symbol = (c.req.query("symbol") || "").trim().toUpperCase();
    const strikeParam = Number(c.req.query("strike"));
    const expiryDate = (c.req.query("expiryDate") || "").trim();
    const side = (c.req.query("side") || "").trim().toUpperCase();

    if (!symbol || !Number.isFinite(strikeParam) || !expiryDate || (side !== "CE" && side !== "PE")) {
      return c.json({ error: "Query must include symbol, strike (number), expiryDate (YYYY-MM-DD), side (CE or PE)." }, 400);
    }
    const mapping = DHAN_UNDERLYING_MAP[symbol];
    if (!mapping) {
      return c.json({ error: `Unknown symbol "${symbol}". Supported: ${Object.keys(DHAN_UNDERLYING_MAP).join(", ")}` }, 400);
    }
    // Dhan's option chain only accepts a CURRENTLY-LISTED expiry (a date
    // that still has an active contract series) — an arbitrary or already-
    // expired date (e.g. a past Friday) gets rejected with a bare HTTP 400
    // and no useful body. Catch that here with a clear message instead of
    // passing an obviously-invalid date through to Dhan.
    const expiryMsCheck = new Date(expiryDate + "T00:00:00Z").getTime();
    if (Number.isNaN(expiryMsCheck)) {
      return c.json({ error: `Invalid expiryDate "${expiryDate}" — expected YYYY-MM-DD.` }, 400);
    }
    if (expiryMsCheck < Date.now() - 24 * 60 * 60 * 1000) {
      return c.json({
        error: `expiryDate "${expiryDate}" is in the past — it has already expired, so Dhan will reject it. Get a real, currently-listed expiry first from GET /api/dhan/contracts?symbol=${symbol} (see its "allExpiries" field) and use one of those exact dates.`,
      }, 400);
    }
    const accessToken = (await getValidDhanAccessToken()) || "";
    const clientId = process.env.DHAN_CLIENT_ID?.trim() || "";
    if (!accessToken || !clientId) {
      return c.json({ error: "Dhan not configured (DHAN_ACCESS_TOKEN/auto-refresh or DHAN_CLIENT_ID missing)." }, 503);
    }

    const headers = { "Content-Type": "application/json", "access-token": accessToken, "client-id": clientId };
    const chainRes = await dhanRateLimitedFetch("https://api.dhan.co/v2/optionchain", {
      method: "POST",
      headers,
      body: JSON.stringify({ UnderlyingScrip: mapping.underlyingScrip, UnderlyingSeg: mapping.underlyingSeg, Expiry: expiryDate }),
    });
    const raw = await chainRes.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!chainRes.ok || !payload?.data || typeof payload.data.oc !== "object") {
      // Surface Dhan's actual error body (not just the bare HTTP status) so
      // the next mismatch is diagnosable from the response alone, same
      // pattern as the existing V3-D audit endpoints elsewhere in this file.
      return c.json({
        error: "Dhan option chain request failed.",
        httpStatus: chainRes.status,
        expiryDateUsed: expiryDate,
        providerError: payload && typeof payload === "object"
          ? { errorType: payload.errorType ?? null, errorCode: payload.errorCode ?? null, errorMessage: payload.errorMessage ?? null }
          : null,
        rawResponseSnippet: raw.slice(0, 300),
        hint: "Get a real, currently-listed expiry from GET /api/dhan/contracts?symbol=" + symbol + " (\"allExpiries\" field) rather than guessing a date.",
      }, 502);
    }

    const oc: Record<string, { ce?: any; pe?: any }> = payload.data.oc;
    const matchKey = Object.keys(oc).find((k) => Math.abs(parseFloat(k) - strikeParam) < 0.01);
    if (!matchKey) {
      const availableStrikes = Object.keys(oc).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      return c.json({ error: `Strike ${strikeParam} not found for ${symbol} expiry ${expiryDate}.`, availableStrikesSample: availableStrikes.slice(0, 20) }, 404);
    }
    const leg = side === "CE" ? oc[matchKey]?.ce : oc[matchKey]?.pe;
    const securityId = leg && typeof leg.security_id === "number" ? leg.security_id : null;
    if (securityId === null) {
      return c.json({ error: `${side} leg at strike ${matchKey} has no security_id in Dhan's response — contract may not exist for this expiry/strike combination.` }, 404);
    }

    return c.json({
      symbol, side, strike: parseFloat(matchKey), expiryDate,
      optionSecurityId: securityId,
      spot: typeof payload.data.last_price === "number" ? payload.data.last_price : null,
      lastPrice: typeof leg.last_price === "number" ? leg.last_price : null,
      note: "Feed optionSecurityId directly into POST /api/offline-research/ingest/dhan-historical.",
      readOnlyMode: true, orderAccessUsed: false,
    });
  } catch (err) {
    return c.json({ error: "Resolve failed: " + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});
/**
 * GET /api/offline-research/console
 * A tiny, dependency-free HTML test page (form + buttons) for the offline
 * research module, so it can be exercised from a phone/laptop browser
 * without needing Postman or DevTools. Same-origin (served by this same
 * app), read-only, calls only the offline-research endpoints above — never
 * touches the live dashboard, M12, or Telegram alert paths.
 */
offlineResearchRouter.get("/console", (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offline Research Console</title>
<style>
  body { background:#0f1115; color:#e6e6e6; font-family: system-ui, sans-serif; max-width:640px; margin:0 auto; padding:16px; }
  h1 { font-size:1.2rem; color:#d4af37; }
  h2 { font-size:0.95rem; color:#9aa0a6; margin-top:28px; border-top:1px solid #2a2d33; padding-top:16px; }
  label { display:block; font-size:0.75rem; color:#9aa0a6; margin-top:10px; }
  input, select { width:100%; box-sizing:border-box; padding:8px; margin-top:4px; background:#1a1d23; color:#e6e6e6; border:1px solid #2a2d33; border-radius:6px; font-size:0.9rem; }
  button { margin-top:14px; padding:10px 16px; background:#d4af37; color:#000; border:none; border-radius:6px; font-weight:700; cursor:pointer; width:100%; font-size:0.9rem; }
  button:disabled { opacity:0.5; }
  pre { background:#1a1d23; border:1px solid #2a2d33; border-radius:6px; padding:10px; font-size:0.72rem; white-space:pre-wrap; word-break:break-all; margin-top:10px; max-height:300px; overflow:auto; }
  .status { font-size:0.75rem; margin-top:6px; }
  .ok { color:#4caf50; } .err { color:#f44336; } .muted { color:#9aa0a6; }
</style>
</head>
<body>
  <h1>⚡ Offline Research Console</h1>
  <div class="muted" style="font-size:0.72rem;">Read-only backtest + Greeks RAG test tool. Does not touch the live dashboard, M12, or Telegram alerts.</div>

  <h2>1. Resolve contract (find Dhan securityId)</h2>
  <label>Symbol</label>
  <select id="rSymbol"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option><option>FINNIFTY</option><option>MIDCPNIFTY</option></select>
  <label>Strike</label>
  <input id="rStrike" type="number" placeholder="e.g. 24350" />
  <label>Expiry date (YYYY-MM-DD — use /api/dhan/contracts?symbol=... to find a real one)</label>
  <input id="rExpiry" type="text" placeholder="2026-08-18" />
  <label>Side</label>
  <select id="rSide"><option>CE</option><option>PE</option></select>
  <button onclick="doResolve()">Resolve Contract</button>
  <div id="rStatus" class="status"></div>
  <pre id="rOut" style="display:none;"></pre>

  <h2>2. Run backtest ingest (from Dhan history)</h2>
  <label>Option Security ID (auto-filled after Resolve, or type it)</label>
  <input id="iSecId" type="text" />
  <label>Strike</label>
  <input id="iStrike" type="number" />
  <label>Expiry date</label>
  <input id="iExpiry" type="text" />
  <label>Is Call? (CE = yes, PE = no)</label>
  <select id="iIsCall"><option value="true">Yes (CE)</option><option value="false">No (PE)</option></select>
  <label>From date</label>
  <input id="iFrom" type="text" placeholder="2026-07-16" />
  <label>To date</label>
  <input id="iTo" type="text" placeholder="2026-08-16" />
  <button onclick="doIngest()">Run Backtest Ingest</button>
  <div id="iStatus" class="status"></div>
  <pre id="iOut" style="display:none;"></pre>

  <h2>3. OR — Run full 1-year rolling backtest</h2>
  <div class="muted" style="font-size:0.72rem;">Uses Dhan's rolling-ATM series (auto-rolls across expiries). Schema not 100% confirmed — check daysToExpiry in the result cycles 0-6 sanely; adjust "Expiry weekday" below and re-run if not.</div>
  <button onclick="doProbeLookback()" style="background:#2a2d33; color:#e6e6e6; margin-top:10px;">First: Find how far back Dhan's data actually goes</button>
  <div id="pStatus" class="status"></div>
  <pre id="pOut" style="display:none;"></pre>
  <label>Symbol</label>
  <select id="gSymbol"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option><option>FINNIFTY</option><option>MIDCPNIFTY</option></select>
  <label>Side</label>
  <select id="gSide"><option>CE</option><option>PE</option></select>
  <label>From date</label>
  <input id="gFrom" type="text" placeholder="2025-08-16" />
  <label>To date</label>
  <input id="gTo" type="text" placeholder="2026-08-16" />
  <label>Expiry weekday (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat — default 2=Tuesday)</label>
  <input id="gExpiryWeekday" type="number" min="0" max="6" value="2" />
  <button onclick="doRollingIngest()">Run 1-Year Rolling Backtest</button>
  <div id="gStatus" class="status"></div>
  <pre id="gOut" style="display:none;"></pre>

  <h2>4. Result</h2>
  <div id="jStatus" class="status muted">No job started yet.</div>
  <div id="jSummaryReadable" style="display:none; font-size:0.8rem; line-height:1.6; margin-top:10px;"></div>
  <div id="jOutToggle" style="display:none; margin-top:8px; color:#d4af37; font-size:0.7rem; cursor:pointer;" onclick="const o=document.getElementById('jOut'); o.style.display = o.style.display==='none' ? 'block' : 'none';">Show/hide full raw JSON ▾</div>
  <pre id="jOut" style="display:none;"></pre>

  <h2>4b. Walk-Forward Efficiency (overfitting check)</h2>
  <div class="muted" style="font-size:0.72rem;">Checks whether the STABLE-vs-WATCH/UNSTABLE pattern above still holds on data the test hasn't "seen" yet, by rolling a 20-day training window forward and checking the next 5 days each time. Needs at least 25 distinct trading days ingested — click this after a finished job above.</div>
  <button onclick="doWfe()">Check Walk-Forward Efficiency (last finished job)</button>
  <div id="wStatus" class="status"></div>
  <div id="wReadable" style="display:none; font-size:0.8rem; line-height:1.6; margin-top:10px;"></div>
  <pre id="wOut" style="display:none;"></pre>

  <h2>5. RAG — find similar historical days</h2>
  <div class="muted" style="font-size:0.72rem;">Searches the greeks patterns collected by every backtest job run above (in this server session) for the closest historical analogs to the numbers you enter here — e.g. today's live spot/strike/IV — and shows what verdict/outcome those similar days had.</div>
  <label>Spot</label>
  <input id="qSpot" type="number" placeholder="24500" />
  <label>Strike</label>
  <input id="qStrike" type="number" placeholder="24500" />
  <label>IV %</label>
  <input id="qIv" type="number" placeholder="13.5" />
  <label>Days to expiry</label>
  <input id="qDte" type="number" placeholder="2" />
  <label>Is Call?</label>
  <select id="qIsCall"><option value="true">Yes (CE)</option><option value="false">No (PE)</option></select>
  <label>How many matches?</label>
  <input id="qTopK" type="number" value="5" min="1" max="20" />
  <button onclick="doRagQuery()">Find Similar Historical Days</button>
  <div id="qStatus" class="status"></div>
  <div id="qReadable" style="display:none; font-size:0.8rem; line-height:1.6; margin-top:10px;"></div>
  <pre id="qOut" style="display:none;"></pre>

<script>
  function setStatus(elId, text, cls) {
    const el = document.getElementById(elId);
    el.textContent = text;
    el.className = 'status ' + (cls || '');
  }
  function showJson(elId, obj) {
    const el = document.getElementById(elId);
    el.style.display = 'block';
    el.textContent = JSON.stringify(obj, null, 2);
  }
  async function doResolve() {
    setStatus('rStatus', 'Loading...', 'muted');
    document.getElementById('rOut').style.display = 'none';
    try {
      const symbol = document.getElementById('rSymbol').value;
      const strike = document.getElementById('rStrike').value;
      const expiryDate = document.getElementById('rExpiry').value.trim();
      const side = document.getElementById('rSide').value;
      const url = '/api/offline-research/resolve/dhan-contract?symbol=' + encodeURIComponent(symbol) +
        '&strike=' + encodeURIComponent(strike) + '&expiryDate=' + encodeURIComponent(expiryDate) + '&side=' + encodeURIComponent(side);
      const res = await fetch(url);
      const data = await res.json();
      showJson('rOut', data);
      if (res.ok && data.optionSecurityId != null) {
        setStatus('rStatus', 'Found! securityId = ' + data.optionSecurityId + ' — auto-filled below.', 'ok');
        document.getElementById('iSecId').value = data.optionSecurityId;
        document.getElementById('iStrike').value = data.strike;
        document.getElementById('iExpiry').value = expiryDate;
        document.getElementById('iIsCall').value = side === 'CE' ? 'true' : 'false';
      } else {
        setStatus('rStatus', 'Failed — see details below.', 'err');
      }
    } catch (err) {
      setStatus('rStatus', 'Network error: ' + err.message, 'err');
    }
  }
  async function doIngest() {
    setStatus('iStatus', 'Submitting...', 'muted');
    document.getElementById('iOut').style.display = 'none';
    try {
      const body = {
        symbol: document.getElementById('rSymbol').value,
        optionSecurityId: Number(document.getElementById('iSecId').value) || document.getElementById('iSecId').value,
        strike: Number(document.getElementById('iStrike').value),
        expiryDate: document.getElementById('iExpiry').value.trim(),
        isCall: document.getElementById('iIsCall').value === 'true',
        fromDate: document.getElementById('iFrom').value.trim(),
        toDate: document.getElementById('iTo').value.trim(),
      };
      const res = await fetch('/api/offline-research/ingest/dhan-historical', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json();
      showJson('iOut', data);
      if (res.ok && data.jobId) {
        setStatus('iStatus', 'Job started: ' + data.jobId + ' — polling for result...', 'ok');
        pollJob(data.jobId);
      } else {
        setStatus('iStatus', 'Failed — see details below.', 'err');
      }
    } catch (err) {
      setStatus('iStatus', 'Network error: ' + err.message, 'err');
    }
  }
  async function doProbeLookback() {
    setStatus('pStatus', 'Probing several past date ranges (takes ~40s, one Dhan call every ~3s)...', 'muted');
    document.getElementById('pOut').style.display = 'none';
    try {
      const symbol = document.getElementById('gSymbol').value;
      const side = document.getElementById('gSide').value;
      const res = await fetch('/api/offline-research/probe/dhan-rolling-lookback?symbol=' + encodeURIComponent(symbol) + '&side=' + encodeURIComponent(side));
      const data = await res.json();
      showJson('pOut', data);
      if (res.ok && data.recommendedFromDate) {
        setStatus('pStatus', 'Safe lookback found: ' + data.recommendedSafeLookbackDays + ' days back (from ' + data.recommendedFromDate + '). Auto-filled "From date" below.', 'ok');
        document.getElementById('gFrom').value = data.recommendedFromDate;
      } else {
        setStatus('pStatus', 'Could not find a working lookback — see details below.', 'err');
      }
    } catch (err) {
      setStatus('pStatus', 'Network error: ' + err.message, 'err');
    }
  }
  async function doRollingIngest() {
    setStatus('gStatus', 'Submitting (this one call can take a little longer)...', 'muted');
    document.getElementById('gOut').style.display = 'none';
    try {
      const body = {
        symbol: document.getElementById('gSymbol').value,
        side: document.getElementById('gSide').value,
        fromDate: document.getElementById('gFrom').value.trim(),
        toDate: document.getElementById('gTo').value.trim(),
        expiryWeekday: Number(document.getElementById('gExpiryWeekday').value),
      };
      const res = await fetch('/api/offline-research/ingest/dhan-rolling-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json();
      showJson('gOut', data);
      if (res.ok && data.jobId) {
        setStatus('gStatus', 'Job started: ' + data.jobId + ' (' + data.recordsIngested + ' days) — polling for result...', 'ok');
        pollJob(data.jobId);
      } else {
        setStatus('gStatus', 'Failed — see details below (if responseKeysFound is shown, that tells us Dhan\\'s real field names).', 'err');
      }
    } catch (err) {
      setStatus('gStatus', 'Network error: ' + err.message, 'err');
    }
  }
  let lastCompletedJobId = null;
  async function pollJob(jobId) {
    setStatus('jStatus', 'Polling job ' + jobId + '...', 'muted');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch('/api/offline-research/backtest/status/' + jobId);
        const data = await res.json();
        setStatus('jStatus', 'Status: ' + data.status + ' (' + data.processedRecords + '/' + data.totalRecords + ', ' + data.progressPct + '%)', 'muted');
        if (data.status === 'DONE' || data.status === 'FAILED') {
          const resultRes = await fetch('/api/offline-research/backtest/result/' + jobId);
          const resultData = await resultRes.json();
          showJson('jOut', resultData);
          document.getElementById('jOutToggle').style.display = 'block';
          setStatus('jStatus', 'Finished: ' + data.status, data.status === 'DONE' ? 'ok' : 'err');
          if (data.status === 'DONE') {
            lastCompletedJobId = jobId;
            try {
              const sumRes = await fetch('/api/offline-research/backtest/summary/' + jobId);
              const s = await sumRes.json();
              renderSummary(s);
            } catch (e) { /* summary is a bonus view — result JSON above still has everything */ }
          }
          return;
        }
      } catch (err) {
        setStatus('jStatus', 'Network error while polling: ' + err.message, 'err');
        return;
      }
    }
    setStatus('jStatus', 'Timed out after 3 minutes of polling — check manually via /backtest/status/' + jobId, 'err');
  }
  async function doWfe() {
    if (!lastCompletedJobId) { setStatus('wStatus', 'No finished job yet — run a backtest above first.', 'err'); return; }
    setStatus('wStatus', 'Checking walk-forward efficiency for job ' + lastCompletedJobId + '...', 'muted');
    document.getElementById('wReadable').style.display = 'none';
    document.getElementById('wOut').style.display = 'none';
    try {
      const res = await fetch('/api/offline-research/backtest/wfe/' + lastCompletedJobId);
      const data = await res.json();
      showJson('wOut', data);
      document.getElementById('wOut').style.display = 'block';
      if (!res.ok) { setStatus('wStatus', 'Error: ' + (data.error || res.status), 'err'); return; }
      setStatus('wStatus', 'Windows computed: ' + data.windowsComputed + ' (distinct trading days available: ' + data.distinctTradingDaysAvailable + ')', 'ok');
      const el = document.getElementById('wReadable');
      if (data.windowsComputed === 0) {
        el.style.display = 'block';
        el.innerHTML = '<div class="muted">' + data.note + '</div>';
      } else {
        el.style.display = 'block';
        let h = '<div><b>' + data.overall.passCount + ' PASS, ' + data.overall.failCount + ' FAIL/SIGN_FLIPPED, ' + data.overall.insufficientCount + ' INSUFFICIENT_DATA</b> (out of ' + data.windowsComputed + ' rolling windows)</div>';
        data.windows.forEach(function(w) {
          const color = w.verdict.startsWith('PASS') ? '#4caf50' : (w.verdict.startsWith('FAIL') || w.verdict.startsWith('SIGN_FLIPPED') ? '#f44336' : '#999');
          h += '<div style="margin-top:6px;">In-sample ' + w.inSampleDays[0] + ' → ' + w.inSampleDays[1] + ', Out-of-sample ' + w.outOfSampleDays[0] + ' → ' + w.outOfSampleDays[1] + '</div>';
          h += '<div>&nbsp;&nbsp;In-sample effect: ' + (w.inSampleEffect ?? '—') + ' &nbsp; Out-of-sample effect: ' + (w.outOfSampleEffect ?? '—') + (w.wfeRatio != null ? ' &nbsp; WFE ratio: ' + w.wfeRatio : '') + '</div>';
          h += '<div style="color:' + color + ';">&nbsp;&nbsp;' + w.verdict + '</div>';
        });
        h += '<div class="muted" style="font-size:0.68rem; margin-top:6px;">' + data.note + '</div>';
        el.innerHTML = h;
      }
    } catch (err) {
      setStatus('wStatus', 'Network error: ' + err.message, 'err');
    }
  }
  async function doRagQuery() {
    setStatus('qStatus', 'Searching...', 'muted');
    document.getElementById('qReadable').style.display = 'none';
    document.getElementById('qOut').style.display = 'none';
    try {
      const body = {
        spot: Number(document.getElementById('qSpot').value),
        strike: Number(document.getElementById('qStrike').value),
        ivPercent: Number(document.getElementById('qIv').value),
        daysToExpiry: Number(document.getElementById('qDte').value),
        isCall: document.getElementById('qIsCall').value === 'true',
        topK: Number(document.getElementById('qTopK').value) || 5,
      };
      const res = await fetch('/api/offline-research/rag/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json();
      showJson('qOut', data);
      if (res.ok && data.matches) {
        setStatus('qStatus', 'Found ' + data.matches.length + ' similar historical day(s).', 'ok');
        const el = document.getElementById('qReadable');
        el.style.display = 'block';
        let h = '<div><b>Today\\'s computed verdict:</b> ' + data.query.verdict + ' (flags: ' + (data.query.flags.length ? data.query.flags.join('; ') : 'none') + ')</div>';
        h += '<div style="margin-top:8px;"><b>Most similar historical days:</b></div>';
        data.matches.forEach(function(m) {
          h += '<div style="margin-top:6px; padding:6px; background:#1a1d23; border-radius:4px;">';
          h += '<div>' + m.timestamp + ' — similarity ' + (m.similarity * 100).toFixed(1) + '% — verdict: ' + m.verdict + '</div>';
          if (m.nextObservationExtrinsicChangePct != null) h += '<div class="muted" style="font-size:0.68rem;">Next-day extrinsic value change: ' + m.nextObservationExtrinsicChangePct + '%</div>';
          h += '</div>';
        });
        el.innerHTML = h;
      } else {
        setStatus('qStatus', 'Failed — see details below (make sure you\\'ve run at least one backtest above first, in this same server session).', 'err');
      }
    } catch (err) {
      setStatus('qStatus', 'Network error: ' + err.message, 'err');
    }
  }
  function renderSummary(s) {
    const el = document.getElementById('jSummaryReadable');
    el.style.display = 'block';
    if (s.error) { el.innerHTML = '<div class="err">' + s.error + '</div>'; return; }
    let h = '';
    h += '<div><b>Total days processed:</b> ' + s.totalDays + ' (failed: ' + s.failedDays + ')</div>';
    h += '<div style="margin-top:8px;"><b>Overall verdict split:</b></div>';
    h += '<div>🟢 STABLE: ' + s.overall.stableDays + ' days (' + s.overall.stablePct + '%)</div>';
    h += '<div>🟡 WATCH: ' + s.overall.watchDays + ' days (' + s.overall.watchPct + '%)</div>';
    h += '<div>🔴 UNSTABLE: ' + s.overall.unstableDays + ' days (' + s.overall.unstablePct + '%)</div>';
    if (s.byDaysToExpiry && s.byDaysToExpiry.some(b => b.days > 0)) {
      h += '<div style="margin-top:8px;"><b>Split by days-to-expiry (does it get worse near expiry?):</b></div>';
      s.byDaysToExpiry.forEach(function(b) {
        if (b.days > 0) h += '<div>' + b.bucket + ' (' + b.days + ' days): 🟢' + b.stablePct + '% 🟡' + b.watchPct + '% 🔴' + b.unstablePct + '%</div>';
      });
    } else if (s.note) {
      h += '<div class="muted" style="margin-top:8px;">' + s.note + '</div>';
    }
    if (s.mostCommonFlags && s.mostCommonFlags.length) {
      h += '<div style="margin-top:8px;"><b>Most common risk flags:</b></div>';
      s.mostCommonFlags.slice(0, 5).forEach(function(f) {
        h += '<div>• ' + f.flag + ' — ' + f.occurredOnDays + ' days (' + f.pctOfDays + '%)</div>';
      });
    }
    if (s.greeksDistribution) {
      h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>Greeks distribution (for threshold calibration):</b></div>';
      const gLabels = { vanna: 'Vanna (>0.5)', charm: 'Charm (>0.02)', speed: 'Speed (>0.01)', zomma: 'Zomma (>0.05)', color: 'Color (>0.01)', vomma: 'Vomma (>5.0)', ultima: 'Ultima (>1.5)' };
      Object.keys(gLabels).forEach(function(k) {
        const d = s.greeksDistribution[k];
        if (d) h += '<div>' + gLabels[k] + ': p50=' + d.p50 + ', p90=' + d.p90 + ', p95=' + d.p95 + ', max=' + d.max + '</div>';
      });
      h += '<div class="muted" style="font-size:0.68rem; margin-top:4px;">' + s.greeksDistributionNote + '</div>';
    }
    const inst = s.institutional;
    if (inst) {
      if (inst.oiFlow && inst.oiFlow.daysWithOiData > 0) {
        h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>OI flow (' + inst.oiFlow.daysWithOiData + ' days with data):</b></div>';
        h += '<div>Buildup: ' + inst.oiFlow.buildupPct + '% &nbsp; Unwinding: ' + inst.oiFlow.unwindingPct + '% &nbsp; Flat: ' + inst.oiFlow.flatPct + '%</div>';
      }
      if (inst.volatilityRiskPremium && inst.volatilityRiskPremium.daysWithRvData > 0) {
        h += '<div style="margin-top:8px;"><b>Volatility risk premium (IV vs realized vol):</b></div>';
        h += '<div>Avg IV − RV: ' + inst.volatilityRiskPremium.avgIvMinusRvPct + ' pts &nbsp; (IV richer than realized on ' + inst.volatilityRiskPremium.pctDaysIvRicherThanRv + '% of days)</div>';
        h += '<div class="muted" style="font-size:0.68rem;">' + inst.volatilityRiskPremium.interpretation + '</div>';
      }
      if (inst.impliedVsRealizedMove && inst.impliedVsRealizedMove.daysWithMoveData > 0) {
        h += '<div style="margin-top:8px;"><b>Implied vs. realized move to expiry:</b></div>';
        h += '<div>Avg move ratio: ' + inst.impliedVsRealizedMove.avgMoveRatio + ' &nbsp; (market moved more than IV implied on ' + inst.impliedVsRealizedMove.pctDaysMarketMovedMoreThanImplied + '% of days)</div>';
        if (inst.impliedVsRealizedMove.byVerdict) {
          inst.impliedVsRealizedMove.byVerdict.forEach(function(bv) {
            if (bv.days > 0) h += '<div>&nbsp;&nbsp;' + bv.verdict + ' (' + bv.days + ' days): avg move ratio ' + bv.avgMoveRatio + '</div>';
          });
        }
        h += '<div class="muted" style="font-size:0.68rem;">' + inst.impliedVsRealizedMove.interpretation + '</div>';
      }
      if (inst.dealerGex && inst.dealerGex.daysWithOiData > 0) {
        h += '<div style="margin-top:8px;"><b>Heuristic dealer GEX (assumption-based, see note):</b></div>';
        h += '<div>Avg unsigned gamma exposure: ' + inst.dealerGex.avgUnsignedGammaExposureNotional + ' &nbsp; Avg signed (heuristic): ' + inst.dealerGex.avgHeuristicSignedDealerGexNotional + '</div>';
        h += '<div class="muted" style="font-size:0.68rem;">' + inst.dealerGex.interpretation + '</div>';
      }
    }
    if (s.outcomeByVerdict && s.outcomeByVerdict.some(function(o) { return o.days > 0; })) {
      h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>Outcome-tied: does the verdict predict anything?</b></div>';
      s.outcomeByVerdict.forEach(function(o) {
        if (o.days === 0) return;
        h += '<div style="margin-top:4px;">' + o.verdict + ' (' + o.days + ' days):</div>';
        h += '<div>&nbsp;&nbsp;Avg extrinsic (time) value: ' + (o.avgExtrinsicValue != null ? o.avgExtrinsicValue.toFixed(2) : '—') + ' &nbsp; Avg intrinsic: ' + (o.avgIntrinsicValue != null ? o.avgIntrinsicValue.toFixed(2) : '—') + '</div>';
        if (o.daysWithNextObservation > 0) {
          h += '<div>&nbsp;&nbsp;Next-day premium change: ' + o.avgNextObservationPremiumChangePct + '% &nbsp; Next-day extrinsic change: ' + o.avgNextObservationExtrinsicChangePct + '%</div>';
        }
      });
      h += '<div class="muted" style="font-size:0.68rem; margin-top:4px;">' + s.outcomeInterpretation + '</div>';
    }
    if (s.dteControlledOutcome && s.dteControlledOutcome.length) {
      h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>DTE-controlled comparison (the rigorous version — same days-to-expiry only):</b></div>';
      let curBucket = null;
      s.dteControlledOutcome.forEach(function(row) {
        if (row.dteBucket !== curBucket) {
          curBucket = row.dteBucket;
          h += '<div style="margin-top:6px; color:#d4af37; font-size:0.72rem;">' + curBucket + '</div>';
        }
        const warn = row.sampleSizeWarning ? ' <span style="color:#f44336;">(' + row.sampleSizeWarning + ')</span>' : '';
        h += '<div>&nbsp;&nbsp;' + row.verdict + ' (' + row.days + ' days): avg extrinsic ' + (row.avgExtrinsicValue != null ? row.avgExtrinsicValue.toFixed(2) : '—') +
          ', next-day change ' + (row.avgNextObservationExtrinsicChangePct != null ? row.avgNextObservationExtrinsicChangePct + '%' : '—') +
          (row.stdDevNextObservationExtrinsicChangePct != null ? ' ±' + row.stdDevNextObservationExtrinsicChangePct + '%' : '') + warn + '</div>';
      });
      h += '<div class="muted" style="font-size:0.68rem; margin-top:6px;">' + s.dteControlledInterpretation + '</div>';
    }
    if (s.significanceTest && s.significanceTest.length) {
      h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>Statistical significance test (real signal, or just noise?):</b></div>';
      s.significanceTest.forEach(function(row) {
        const vColor = row.verdict === 'LIKELY_REAL_DIFFERENCE' ? '#4caf50' : (row.verdict === 'NOT_DISTINGUISHABLE_FROM_NOISE' ? '#f44336' : '#999');
        h += '<div style="margin-top:4px;">' + row.dteBucket + ': STABLE n=' + row.stableSampleSize + ', WATCH+UNSTABLE n=' + row.flaggedSampleSize +
          (row.tStat != null ? ', t-stat=' + row.tStat : '') +
          ' — <span style="color:' + vColor + ';">' + row.verdict + '</span></div>';
      });
      h += '<div class="muted" style="font-size:0.68rem; margin-top:6px;">' + s.significanceTestInterpretation + '</div>';
    }
    if (s.byIndividualFlag && s.byIndividualFlag.length) {
      h += '<div style="margin-top:12px; border-top:1px solid #2a2d33; padding-top:8px;"><b>Per-flag breakdown (which SPECIFIC flag carries the signal):</b></div>';
      s.byIndividualFlag.forEach(function(f) {
        const warn = f.sampleSizeWarning ? ' <span style="color:#f44336;">(' + f.sampleSizeWarning + ')</span>' : '';
        h += '<div style="margin-top:4px;">' + f.flag + ' — ' + f.days + ' days' + warn + '</div>';
        h += '<div>&nbsp;&nbsp;Avg extrinsic value: ' + (f.avgExtrinsicValue != null ? f.avgExtrinsicValue : '—') +
          ' &nbsp; Avg next-day extrinsic change: ' + (f.avgNextObservationExtrinsicChangePct != null ? f.avgNextObservationExtrinsicChangePct + '%' : '—') + '</div>';
      });
    }
    el.innerHTML = h;
  }
</script>
</body>
</html>`);
});
app.route("/api/offline-research", offlineResearchRouter);
