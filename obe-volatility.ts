// ============================================================================
// Option Buyer Edge Layer — OBE-3: Volatility Purchase Condition (2026-08-21)
//
// Purpose: classify whether current implied-volatility pricing looks
// favorable (CHEAP_VOL), fair (FAIR_VOL), unfavorable (EXPENSIVE_VOL), or
// dangerous (IV_CRUSH_RISK) for an option BUYER, using only evidence this
// codebase already computes and already trusts elsewhere.
//
// HARD RULES (mirrors outcome-engine.ts's isolation discipline):
//   - Pure and self-contained. No import from server.ts, no wall-clock
//     access, no network calls. Deterministic given its inputs.
//   - scoringImpact is ALWAYS "NONE". This module returns a label +
//     explanation only — it must never be used to change
//     calculateBuyProbability's score, CE/PE direction, filterForBuyContext's
//     PASS/BLOCKED verdict, or M12B candidate selection. Enforcing that is
//     the CALLER's responsibility (server.ts must only ever push this
//     module's output into a `reasons[]`/evidence array, never read it back
//     into `score`); this module cannot enforce it by itself, but it also
//     never RETURNS anything shaped like a score delta, to make misuse
//     structurally awkward.
//   - Never classifies from a single evidence source. High IV alone must
//     never mean EXPENSIVE_VOL; low IV alone must never mean CHEAP_VOL.
//     The base label always comes from m5 (Realized-vs-Implied, which is
//     ALREADY a relative/contextual measure, not raw IV) — the optional
//     IV/VIX ratio can only ever corroborate or CONTRADICT that base label
//     (demoting a confident label to FAIR_VOL on contradiction), never set
//     a confident label by itself.
//   - Every threshold reused here (IV/VIX 0.9 / 1.3) is the SAME threshold
//     already used in server.ts's calculateBuyProbability (Rule 2, IV
//     score) and v2ClassifyIvVsRv (0.90 / 1.10 relative band) — no new,
//     unvalidated threshold is invented by this module.
//   - Provenance: m3/m5 in this codebase are BOTH stamped
//     `ivSource: "MODEL_COMPUTED_FROM_OPTION_LTP_NOT_KITE_PUBLISHED_IV"` at
//     their source (server.ts buildV2IvTermStructure / buildV2RealizedVsImplied)
//     — i.e. Black-Scholes model-derived from live Kite quotes, NOT Dhan's
//     native option-chain Greeks/IV field (which is a real, separate,
//     provider-native data class that exists elsewhere in this codebase's
//     diagnostic/comparison endpoints, but is not what feeds M3/M5 today).
//     This module's `provenance` field reflects that precisely and must
//     never be presented as if it were Dhan-native.
// ============================================================================

export type M5RvIvState = "IV_PREMIUM_TO_REALIZED" | "IV_NEAR_REALIZED" | "REALIZED_ABOVE_IV" | "INSUFFICIENT_DATA";
export type M3TermStructureState = "FRONT_LOADED_IV" | "BACK_LOADED_IV" | "MIXED_TERM_STRUCTURE" | "FLAT_EXACT" | "INSUFFICIENT_DATA";

export type Obe3State = "CHEAP_VOL" | "FAIR_VOL" | "EXPENSIVE_VOL" | "IV_CRUSH_RISK" | "INSUFFICIENT_DATA";
export type Obe3DataQuality = "OK" | "PARTIAL" | "INSUFFICIENT";

export interface Obe3Input {
  // M3 IV Term Structure state (server.ts: buildV2IvTermStructure / v2ClassifyTermStructure).
  m3State: M3TermStructureState | null | undefined;
  // M5 Realized-vs-Implied state (server.ts: buildV2RealizedVsImplied / v2ClassifyIvVsRv).
  m5State: M5RvIvState | null | undefined;
  // Optional — the SAME iv/vix ratio already computed inline in
  // calculateBuyProbability (candidate.iv / marketSnapshot.vix). Pass null
  // if unavailable (e.g. vix <= 0) rather than fabricating a value; this
  // input is corroboration-only and the classifier degrades gracefully
  // (PARTIAL dataQuality) without it.
  ivVixRatio: number | null | undefined;
}

export interface Obe3Output {
  state: Obe3State;
  reason: string;
  dataQuality: Obe3DataQuality;
  scoringImpact: "NONE";
  provenance: "DERIVED_FROM_EXISTING_M3_M5_VOL_CONTEXT";
}

// Same thresholds already used in server.ts's calculateBuyProbability
// (IV SCORE rule) — reused verbatim, not reinvented.
const IV_VIX_CHEAP_THRESHOLD = 0.9;
const IV_VIX_EXPENSIVE_THRESHOLD = 1.3;

function ivVixSignal(ivVixRatio: number | null | undefined): "cheap-leaning" | "expensive-leaning" | "neutral" | "unavailable" {
  if (ivVixRatio == null || !Number.isFinite(ivVixRatio) || ivVixRatio <= 0) return "unavailable";
  if (ivVixRatio < IV_VIX_CHEAP_THRESHOLD) return "cheap-leaning";
  if (ivVixRatio > IV_VIX_EXPENSIVE_THRESHOLD) return "expensive-leaning";
  return "neutral";
}

export function buildObe3VolatilityPurchaseCondition(input: Obe3Input): Obe3Output {
  const { m3State, m5State, ivVixRatio } = input;

  if (m5State == null || m5State === "INSUFFICIENT_DATA") {
    return {
      state: "INSUFFICIENT_DATA",
      reason: "M5 Realized-vs-Implied state is unavailable — cannot assess volatility purchase condition without it.",
      dataQuality: "INSUFFICIENT",
      scoringImpact: "NONE",
      provenance: "DERIVED_FROM_EXISTING_M3_M5_VOL_CONTEXT",
    };
  }
  if (m3State == null || m3State === "INSUFFICIENT_DATA") {
    return {
      state: "INSUFFICIENT_DATA",
      reason: "M3 IV Term Structure state is unavailable — cannot assess volatility purchase condition without it.",
      dataQuality: "INSUFFICIENT",
      scoringImpact: "NONE",
      provenance: "DERIVED_FROM_EXISTING_M3_M5_VOL_CONTEXT",
    };
  }

  // Base label comes from M5 alone -- M5 is already a RELATIVE measure
  // (implied vs realized), never raw/absolute IV, so this does not violate
  // "high/low IV alone must never decide the label".
  let state: Obe3State;
  let baseReason: string;
  if (m5State === "REALIZED_ABOVE_IV") {
    state = "CHEAP_VOL";
    baseReason = "Realized volatility has been running above implied volatility (M5) — options priced relatively cheap versus recent real movement.";
  } else if (m5State === "IV_PREMIUM_TO_REALIZED") {
    state = "EXPENSIVE_VOL";
    baseReason = "Implied volatility is priced at a premium to realized volatility (M5) — options relatively expensive versus recent real movement.";
  } else {
    state = "FAIR_VOL";
    baseReason = "Implied volatility is near realized volatility (M5) — no clear cheap/expensive skew.";
  }

  // Crush-risk upgrade: ONLY when M5 already says "expensive" AND M3's
  // term structure independently confirms a front-loaded (near-dated
  // richer than far-dated) shape -- a documented crush-risk pattern, not
  // an invented threshold. Two independent existing evidence sources
  // agreeing is required; M3 alone or M5 alone is never enough.
  if (state === "EXPENSIVE_VOL" && m3State === "FRONT_LOADED_IV") {
    state = "IV_CRUSH_RISK";
    baseReason += " Term structure is front-loaded (M3: near-dated IV richer than far-dated) — classic pre-event/crush-risk shape.";
  }

  const signal = ivVixSignal(ivVixRatio);
  let reason = baseReason;
  let dataQuality: Obe3DataQuality = signal === "unavailable" ? "PARTIAL" : "OK";

  // Contradiction check: the IV/VIX ratio can only ever CONTRADICT (and
  // thereby soften to FAIR_VOL) a confident CHEAP/EXPENSIVE/CRUSH label —
  // it can never independently create one. This is what guarantees "high
  // IV alone never means EXPENSIVE_VOL" and "low IV alone never means
  // CHEAP_VOL": the ratio is read here, but only ever as a demotion check.
  if (signal === "expensive-leaning" && state === "CHEAP_VOL") {
    state = "FAIR_VOL";
    reason = `${baseReason} However, IV/VIX ratio (${ivVixRatio!.toFixed(2)}) leans expensive — contradicts the M5 cheap read, so this is reported as FAIR_VOL rather than a confident CHEAP_VOL.`;
  } else if (signal === "cheap-leaning" && (state === "EXPENSIVE_VOL" || state === "IV_CRUSH_RISK")) {
    const preContradictionLabel = state === "IV_CRUSH_RISK" ? "IV_CRUSH_RISK" : "EXPENSIVE_VOL";
    state = "FAIR_VOL";
    reason = `${baseReason} However, IV/VIX ratio (${ivVixRatio!.toFixed(2)}) leans cheap — contradicts the M5/M3 expensive read, so this is reported as FAIR_VOL rather than a confident ${preContradictionLabel}.`;
  } else if (signal === "cheap-leaning" && state === "CHEAP_VOL") {
    reason = `${baseReason} IV/VIX ratio (${ivVixRatio!.toFixed(2)}) corroborates the cheap read.`;
  } else if (signal === "expensive-leaning" && (state === "EXPENSIVE_VOL" || state === "IV_CRUSH_RISK")) {
    reason = `${baseReason} IV/VIX ratio (${ivVixRatio!.toFixed(2)}) corroborates the expensive read.`;
  } else if (signal === "unavailable") {
    reason = `${baseReason} (IV/VIX ratio unavailable for corroboration — classification rests on M3/M5 alone.)`;
  }

  return {
    state,
    reason,
    dataQuality,
    scoringImpact: "NONE",
    provenance: "DERIVED_FROM_EXISTING_M3_M5_VOL_CONTEXT",
  };
}
