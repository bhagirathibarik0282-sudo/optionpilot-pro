import { dbQuerySafe } from "./db.js";
import { deriveTemporalEvidenceState, type TemporalState } from "./temporal-evidence-fusion.js";
import { deriveFamilyStateFusion, type FusionState, type FusionBias } from "./family-state-fusion.js";

export type OneMinuteChangeState =
  | "UP_ACCELERATING"
  | "UP"
  | "FLAT"
  | "DOWN"
  | "DOWN_ACCELERATING"
  | "REVERSAL_WARNING"
  | "INSUFFICIENT_DATA";

export type PromotionState =
  | "EARLY_WARNING_ONLY"
  | "3M_PROMOTED"
  | "15M_CONFIRMED"
  | "30M_STRUCTURAL_SUPPORT"
  | "60M_HIGHER_ORDER_SUPPORT"
  | "BLOCKED_BY_CONFLICT"
  | "INSUFFICIENT_DATA";

type MarketRow = {
  minute_bucket: string | Date;
  spot_ltp: number | null;
  future_ltp: number | null;
  india_vix: number | null;
};

export interface OneMinuteChangeSnapshot {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  currentMinute: string | null;
  previousMinute: string | null;
  observedGapMinutes: number | null;
  spotChangePct: number | null;
  futureChangePct: number | null;
  vixChangePct: number | null;
  state: OneMinuteChangeState;
  warningOnly: true;
  basedOnActualCapturedSnapshots: true;
  reasons: string[];
}

export interface ClosedBlockPromotionSnapshot {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  promotion: PromotionState;
  fusionState: FusionState;
  fusionBias: FusionBias;
  tf3m: TemporalState;
  tf15m: TemporalState;
  tf30m: TemporalState;
  tf60m: TemporalState;
  reasons: string[];
  oneMinute: OneMinuteChangeSnapshot;
  ruleVersion: "TEF_CHANGE_PROMOTION_V1";
  semantics: "FORWARD_TESTING_EVIDENCE_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function pct(previous: number | null, current: number | null): number | null {
  if (!finite(previous) || !finite(current) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function classify1m(spot: number | null, future: number | null): { state: OneMinuteChangeState; reasons: string[] } {
  if (spot == null) return { state: "INSUFFICIENT_DATA", reasons: ["Two actual captured spot snapshots are required."] };
  const reasons: string[] = [];
  if (future != null && Math.sign(spot) !== 0 && Math.sign(future) !== 0 && Math.sign(spot) !== Math.sign(future)) {
    reasons.push("Spot and futures changes disagree; treat as reversal/conflict warning only.");
    return { state: "REVERSAL_WARNING", reasons };
  }
  if (spot > 0.08) return { state: "UP_ACCELERATING", reasons: ["Observed spot change between captured snapshots is strongly positive."] };
  if (spot > 0.015) return { state: "UP", reasons: ["Observed spot change between captured snapshots is positive."] };
  if (spot < -0.08) return { state: "DOWN_ACCELERATING", reasons: ["Observed spot change between captured snapshots is strongly negative."] };
  if (spot < -0.015) return { state: "DOWN", reasons: ["Observed spot change between captured snapshots is negative."] };
  return { state: "FLAT", reasons: ["Observed spot change between captured snapshots is small."] };
}

export async function deriveOneMinuteChange(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
): Promise<OneMinuteChangeSnapshot> {
  const q = await dbQuerySafe<MarketRow>(`
    SELECT minute_bucket, spot_ltp, future_ltp, india_vix
    FROM market_snapshot_1m
    WHERE symbol = $1
    ORDER BY minute_bucket DESC
    LIMIT 2
  `, [symbol]);
  const rows = q?.rows ?? [];
  if (rows.length < 2) {
    return {
      symbol,
      currentMinute: rows[0] ? new Date(rows[0].minute_bucket).toISOString() : null,
      previousMinute: null,
      observedGapMinutes: null,
      spotChangePct: null,
      futureChangePct: null,
      vixChangePct: null,
      state: "INSUFFICIENT_DATA",
      warningOnly: true,
      basedOnActualCapturedSnapshots: true,
      reasons: ["Two actual captured market snapshots are not yet available."],
    };
  }

  const current = rows[0];
  const previous = rows[1];
  const currentMs = new Date(current.minute_bucket).getTime();
  const previousMs = new Date(previous.minute_bucket).getTime();
  const observedGapMinutes = Math.round((currentMs - previousMs) / 60000);
  const spotChangePct = pct(previous.spot_ltp, current.spot_ltp);
  const futureChangePct = pct(previous.future_ltp, current.future_ltp);
  const vixChangePct = pct(previous.india_vix, current.india_vix);
  const classified = classify1m(spotChangePct, futureChangePct);
  const reasons = [...classified.reasons];
  if (observedGapMinutes !== 1) {
    reasons.push(`Snapshots are ${observedGapMinutes} minutes apart; this is an observed-snapshot change, not a fabricated exact 1-minute bar.`);
  }

  return {
    symbol,
    currentMinute: new Date(current.minute_bucket).toISOString(),
    previousMinute: new Date(previous.minute_bucket).toISOString(),
    observedGapMinutes,
    spotChangePct,
    futureChangePct,
    vixChangePct,
    state: classified.state,
    warningOnly: true,
    basedOnActualCapturedSnapshots: true,
    reasons,
  };
}

function supportive(state: TemporalState): boolean {
  return state === "STRENGTHENING" || state === "STABLE";
}

function bad(state: TemporalState): boolean {
  return state === "REVERSING" || state === "CONFLICTING";
}

export async function deriveClosedBlockPromotion(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
): Promise<ClosedBlockPromotionSnapshot> {
  const [oneMinute, fusion, tf3m, tf15m, tf30m, tf60m] = await Promise.all([
    deriveOneMinuteChange(symbol),
    deriveFamilyStateFusion(symbol),
    deriveTemporalEvidenceState(symbol, "3M"),
    deriveTemporalEvidenceState(symbol, "15M"),
    deriveTemporalEvidenceState(symbol, "30M"),
    deriveTemporalEvidenceState(symbol, "60M"),
  ]);

  const reasons: string[] = [];
  let promotion: PromotionState = "EARLY_WARNING_ONLY";

  if (fusion.state === "INSUFFICIENT_DATA" || tf3m.state === "INSUFFICIENT_DATA") {
    promotion = "INSUFFICIENT_DATA";
    reasons.push("Fusion and a usable closed 3M block are required before promotion.");
  } else if (fusion.state === "CONFLICTING" || bad(tf3m.state)) {
    promotion = "BLOCKED_BY_CONFLICT";
    reasons.push("Core/family fusion or closed 3M temporal evidence is conflicting/reversing.");
  } else if (fusion.state === "SUPPORTIVE" && supportive(tf3m.state)) {
    promotion = "3M_PROMOTED";
    reasons.push("Family fusion is supportive and the closed 3M block is stable/strengthening.");

    if (supportive(tf15m.state) && !bad(tf15m.state)) {
      promotion = "15M_CONFIRMED";
      reasons.push("Closed 15M block confirms the promoted 3M evidence.");
    }
    if (promotion === "15M_CONFIRMED" && supportive(tf30m.state) && !bad(tf30m.state)) {
      promotion = "30M_STRUCTURAL_SUPPORT";
      reasons.push("Closed 30M block adds structural support.");
    }
    if (promotion === "30M_STRUCTURAL_SUPPORT" && supportive(tf60m.state) && !bad(tf60m.state)) {
      promotion = "60M_HIGHER_ORDER_SUPPORT";
      reasons.push("Closed 60M block adds higher-order support.");
    }
  } else {
    reasons.push("1M remains warning-only until supportive family fusion and a closed 3M block align.");
  }

  return {
    symbol,
    promotion,
    fusionState: fusion.state,
    fusionBias: fusion.bias,
    tf3m: tf3m.state,
    tf15m: tf15m.state,
    tf30m: tf30m.state,
    tf60m: tf60m.state,
    reasons,
    oneMinute,
    ruleVersion: "TEF_CHANGE_PROMOTION_V1",
    semantics: "FORWARD_TESTING_EVIDENCE_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
