export type MaxPainSide = "CE" | "PE";

export interface MaxPainOiRow {
  strike: number;
  side: MaxPainSide;
  oi: number | null;
}

export interface MaxPainAuditResult {
  state: "VALID" | "BLOCKED";
  maxPain: number | null;
  minimumPayout: number | null;
  tieStrikes: number[];
  reasons: string[];
  calculationVersion: typeof MAX_PAIN_CALCULATION_VERSION;
  interpretationGuard: typeof MAX_PAIN_INTERPRETATION_GUARD;
}

export const MAX_PAIN_CALCULATION_VERSION = "MAX_PAIN_SETTLEMENT_OI_MIN_PAYOUT_V1" as const;
export const MAX_PAIN_INTERPRETATION_GUARD =
  "Contextual expiry-equilibrium reference only; not a seller target, directional forecast, support/resistance promise, or trade trigger." as const;

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Canonical expiry max-pain calculation.
 * For each listed settlement strike S, sum intrinsic settlement payout across
 * all CE/PE open interest. The max-pain strike is the listed strike with the
 * minimum total payout. Ties are deterministic: the lowest strike wins,
 * matching the current live implementation's sorted-strike + strict-< rule.
 */
export function calculateCanonicalMaxPain(rows: MaxPainOiRow[]): MaxPainAuditResult {
  const reasons: string[] = [];
  if (!Array.isArray(rows) || rows.length === 0) reasons.push("MAX_PAIN_INPUT_UNIVERSE_EMPTY");

  const keys = new Set<string>();
  for (const row of rows ?? []) {
    if (!(typeof row.strike === "number" && Number.isFinite(row.strike) && row.strike > 0)) {
      reasons.push("MAX_PAIN_STRIKE_INVALID");
      continue;
    }
    if (row.side !== "CE" && row.side !== "PE") reasons.push("MAX_PAIN_SIDE_INVALID");
    if (!finiteNonNegative(row.oi)) reasons.push("MAX_PAIN_OI_FIELD_INCOMPLETE");
    const key = `${row.strike}_${row.side}`;
    if (keys.has(key)) reasons.push("MAX_PAIN_DUPLICATE_CONTRACT_KEY");
    keys.add(key);
  }

  if (reasons.length) {
    return {
      state: "BLOCKED", maxPain: null, minimumPayout: null, tieStrikes: [],
      reasons: [...new Set(reasons)], calculationVersion: MAX_PAIN_CALCULATION_VERSION,
      interpretationGuard: MAX_PAIN_INTERPRETATION_GUARD,
    };
  }

  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a,b) => a-b);
  let minimumPayout = Number.POSITIVE_INFINITY;
  const payoutByStrike = new Map<number, number>();

  for (const settlement of strikes) {
    let payout = 0;
    for (const row of rows) {
      const intrinsic = row.side === "CE"
        ? Math.max(0, settlement - row.strike)
        : Math.max(0, row.strike - settlement);
      payout += intrinsic * (row.oi as number);
    }
    payoutByStrike.set(settlement, payout);
    if (payout < minimumPayout) minimumPayout = payout;
  }

  const tieStrikes = strikes.filter((s) => payoutByStrike.get(s) === minimumPayout);
  const maxPain = tieStrikes.length ? tieStrikes[0] : null;
  return {
    state: maxPain == null ? "BLOCKED" : "VALID",
    maxPain,
    minimumPayout: Number.isFinite(minimumPayout) ? minimumPayout : null,
    tieStrikes,
    reasons: maxPain == null ? ["MAX_PAIN_NOT_RESOLVED"] : [],
    calculationVersion: MAX_PAIN_CALCULATION_VERSION,
    interpretationGuard: MAX_PAIN_INTERPRETATION_GUARD,
  };
}

export function phase47MaxPainPromotionReasons(args: {
  universeComplete: boolean;
  allOiPresent: boolean;
  numericValue: number | null;
}): string[] {
  const reasons: string[] = [];
  if (!args.universeComplete) reasons.push("MAX_PAIN_FULL_UNIVERSE_INCOMPLETE");
  if (!args.allOiPresent) reasons.push("MAX_PAIN_OI_FIELD_COVERAGE_INCOMPLETE");
  if (!(typeof args.numericValue === "number" && Number.isFinite(args.numericValue) && args.numericValue > 0)) {
    reasons.push("MAX_PAIN_VALUE_UNAVAILABLE");
  }
  return reasons;
}

export const PHASE47_MAX_PAIN_SAFETY = Object.freeze({
  readOnlyForTrading: true,
  shadowOnly: true,
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
  interpretation: "CONTEXTUAL_EXPIRY_EQUILIBRIUM_REFERENCE_ONLY",
});
