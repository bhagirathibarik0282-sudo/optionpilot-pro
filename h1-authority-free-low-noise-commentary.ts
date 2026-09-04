import type { H1ShadowDirectionAssessmentResult } from "./h1-shadow-direction-assessment.js";
import type { H1ExactOptionPremiumMoveEvidence } from "./h1-exact-option-premium-move-evidence.js";
import type { H1LowNoiseMinuteCommentary } from "./h1-shadow-telegram-message-contract.js";

export interface H1AuthorityFreeLowNoiseCommentary {
  version: "H1_AUTHORITY_FREE_LOW_NOISE_COMMENTARY_V1";
  ready: boolean;
  renderable: boolean;
  text: string;
  semanticKey: string;
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
  semantics: "DIRECTION_PLUS_EXACT_PREMIUM_TEXT_ONLY_NO_CAUSAL_MAPPING_NO_TRANSPORT";
}

const TF_ORDER = ["1m", "3m", "6m", "15m", "30m"] as const;

function assessmentUnsafe(input: H1ShadowDirectionAssessmentResult | null): boolean {
  return !input || input.productionImpact !== "NONE" || !input.readOnly || input.forwardsDownstream ||
    input.affectsVerdict || input.affectsExecution || input.affectsTelegram ||
    input.grantsPromotionAuthority || !input.failClosed;
}

function premiumUnsafe(input: H1ExactOptionPremiumMoveEvidence): boolean {
  return input.productionImpact !== "NONE" || !input.readOnly || input.forwardsDownstream ||
    input.affectsVerdict || input.affectsExecution || input.affectsTelegram ||
    input.grantsPromotionAuthority || !input.failClosed;
}

function validCommentary(value: H1LowNoiseMinuteCommentary | null): value is H1LowNoiseMinuteCommentary {
  if (!value || !Number.isFinite(Date.parse(value.observedAt))) return false;
  const seen = new Set(value.timeframeViews.map((x) => x.timeframe));
  return TF_ORDER.every((tf) => seen.has(tf));
}

function fmtPct(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "MISSING" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function stableSemanticState(
  assessment: H1ShadowDirectionAssessmentResult | null,
  premiumEvidence: H1ExactOptionPremiumMoveEvidence[],
  commentary: H1LowNoiseMinuteCommentary | null,
  blockers: string[],
): string {
  return JSON.stringify({
    directions: [...(assessment?.rows ?? [])]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((x) => ({ symbol: x.symbol, state: x.state, direction: x.direction, blockers: [...x.blockers].sort() })),
    premiums: premiumEvidence
      .map((x) => ({
        ready: x.ready, symbol: x.symbol, token: x.instrumentToken, expiry: x.expiry,
        strike: x.strike, side: x.side, move: x.premiumMovePct == null ? null : Number(x.premiumMovePct.toFixed(6)),
        blockers: [...x.blockers].sort(),
      }))
      .sort((a, b) => `${a.symbol}:${a.token}`.localeCompare(`${b.symbol}:${b.token}`)),
    timeframes: validCommentary(commentary)
      ? commentary.timeframeViews.map((x) => ({ timeframe: x.timeframe, side: x.side, state: x.state }))
      : null,
    selectedCandle: validCommentary(commentary) ? commentary.selectedCandle : null,
    marketMode: validCommentary(commentary) ? commentary.marketMode : null,
    blockers: [...blockers].sort(),
  });
}

/**
 * Human-readable research-shadow commentary only. Direction and CE/PE premium
 * movement stay independent evidence streams; this module never maps UP/DOWN
 * into CE/PE, BUY/SELL, candidate selection, verdict, execution, publishing,
 * or Telegram transport.
 */
export function buildH1AuthorityFreeLowNoiseCommentary(
  assessment: H1ShadowDirectionAssessmentResult | null,
  premiumEvidence: H1ExactOptionPremiumMoveEvidence[],
  commentary: H1LowNoiseMinuteCommentary | null,
  observedAtIso: string,
): H1AuthorityFreeLowNoiseCommentary {
  const blockers: string[] = [];
  if (!Number.isFinite(Date.parse(observedAtIso))) blockers.push("INVALID_COMMENTARY_TIME");
  if (assessmentUnsafe(assessment)) blockers.push("DIRECTION_ASSESSMENT_SAFETY_CONTRACT_INVALID");
  if (!Array.isArray(premiumEvidence)) blockers.push("MISSING_PREMIUM_EVIDENCE_ARRAY");
  for (const row of premiumEvidence ?? []) {
    if (premiumUnsafe(row)) blockers.push("PREMIUM_EVIDENCE_SAFETY_CONTRACT_INVALID");
  }
  if (!validCommentary(commentary)) blockers.push("LOW_NOISE_TIMEFRAME_COMMENTARY_MISSING");

  const directionReady = assessment?.rows.some((x) => x.state !== "BLOCKED" && (x.direction === "UP" || x.direction === "DOWN")) ?? false;
  if (!directionReady) blockers.push("NO_VERIFIED_DIRECTION_READY");
  const premiumReady = (premiumEvidence ?? []).some((x) => x.ready && x.side != null && x.premiumMovePct != null);
  if (!premiumReady) blockers.push("NO_EXACT_PREMIUM_MOVE_READY");

  const lines = ["H1 LOW-NOISE SHADOW COMMENTARY", `Observed: ${observedAtIso}`];
  if (assessment && !assessmentUnsafe(assessment)) {
    for (const row of assessment.rows) {
      lines.push(row.state === "BLOCKED"
        ? `${row.symbol}: BLOCKED | ${row.blockers.join(", ") || "NO_VERIFIED_DIRECTION"}`
        : `${row.symbol}: ${row.state} | direction ${row.direction}`);
    }
  } else {
    lines.push("Direction: MISSING/BLOCKED");
  }

  const readyPremiums = (premiumEvidence ?? []).filter((x) => x.ready && !premiumUnsafe(x));
  if (readyPremiums.length === 0) lines.push("Exact CE/PE premium move: MISSING/BLOCKED");
  for (const row of readyPremiums) {
    lines.push(`${row.symbol} ${row.side} ${row.strike} ${row.expiry} token=${row.instrumentToken}: premium ${fmtPct(row.premiumMovePct)}`);
  }

  if (validCommentary(commentary)) {
    const tf = TF_ORDER.map((name) => {
      const row = commentary.timeframeViews.find((x) => x.timeframe === name)!;
      return `${name} ${row.side} ${row.state}`;
    });
    lines.push(`Mode: ${commentary.marketMode} | Selected candle: ${commentary.selectedCandle}`);
    lines.push(`Timeframes: ${tf.join(" | ")}`);
    if (commentary.sameSide) lines.push(`Observed side ${commentary.sameSide.side}: ${commentary.sameSide.activeCount}/${commentary.sameSide.observedCount} active | premium ${fmtPct(commentary.sameSide.premiumChangePct)}`);
    if (commentary.oppositeSide) lines.push(`Opposite observed side ${commentary.oppositeSide.side}: ${commentary.oppositeSide.activeCount}/${commentary.oppositeSide.observedCount} active | premium ${fmtPct(commentary.oppositeSide.premiumChangePct)}`);
  } else {
    lines.push("3m/6m/15m/30m context: MISSING/BLOCKED");
  }

  lines.push("Direction→CE/PE inference: OFF", "BUY/SELL inference: OFF", "Trade authority: OFF", "Telegram transport: OFF");
  const uniqueBlockers = [...new Set(blockers)];
  const semanticKey = stableSemanticState(assessment, premiumEvidence ?? [], commentary, uniqueBlockers);

  return {
    version: "H1_AUTHORITY_FREE_LOW_NOISE_COMMENTARY_V1",
    ready: uniqueBlockers.length === 0,
    renderable: true,
    text: lines.join("\n"),
    semanticKey,
    blockers: uniqueBlockers,
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "DIRECTION_PLUS_EXACT_PREMIUM_TEXT_ONLY_NO_CAUSAL_MAPPING_NO_TRANSPORT",
  };
}
