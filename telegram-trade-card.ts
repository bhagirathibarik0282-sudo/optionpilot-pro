// ============================================================================
// Telegram Trade Card Composer — V1 (2026-08-21)
//
// PURE FORMATTER. Given already-computed OptionPilot fields (score, reasons,
// risk flags, trade-management plan, advanced greeks, OBE-3 output, etc.)
// this module composes the final human-readable Telegram trade card text.
//
// HARD RULES (per BUILD_TELEGRAM_TRADE_CARD_COMPOSER_V1 task spec):
//   - Pure and self-contained. No import from server.ts, no wall-clock
//     access (caller supplies `timestampIst`), no network calls.
//   - NEVER makes a decision. Every value it prints was already decided
//     upstream (calculateBuyProbability, filterForBuyContext, H2/H4/H10
//     gates, computeProvisionalTradeManagementPlan, OBE-3, etc.) — this
//     module only arranges strings.
//   - Only prints fields this codebase has ACTUALLY built and verified.
//     It does NOT fabricate lines for Best Index Selector, Buy Permission,
//     Movement Sufficiency, Premium Response Efficiency, or Entry Timing —
//     none of those exist in server.ts today. If/when they are built, this
//     module can be extended; until then those sections are simply absent,
//     never faked.
//   - missing_field_policy: OMIT. Every optional section/line is emitted
//     only if the corresponding input is present and non-empty. No
//     placeholder text like "N/A" is invented for data that was never
//     computed — the line is dropped instead. (Levels a plan DOES have,
//     e.g. Entry/SL but not T3, still print what's real — see TRADE PLAN.)
//   - blocked_trade_policy: when `blockStatus.blocked === true`, the FINAL
//     ACTION section renders a clear "🚫 BLOCKED" header instead of a
//     BUY/SELL call, the TRADE PLAN section is suppressed entirely (never
//     shows Entry/SL/T1/T2/T3 for a blocked candidate — that would look
//     executable), and the block reasons are surfaced instead.
//   - Respects Telegram's 4096-char single-message limit indirectly: uses
//     the SAME section-separator string server.ts's telegramSplitMessageSafely
//     already splits on ("\n━━━━━━━━━━━━━━━━━━━━\n"), so the existing
//     splitter (unchanged, not duplicated here) can safely chunk this
//     module's output exactly like it already does for the M12b message.
//   - This module does not send or edit Telegram messages itself. Sending/
//     editing (sendTelegramAlert / sendTelegramPremiumOnlyMessage /
//     editTelegramPremiumOnlyMessage) stays exactly as-is in server.ts —
//     this module only supplies the `text` string those functions take.
// ============================================================================

export const TRADE_CARD_SECTION_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━";

export interface TradeCardBlockStatus {
  blocked: boolean;
  // Only meaningful when blocked === true. Pass the REAL block reasons
  // already produced upstream (e.g. h2Gate.gates[].reason, h4Gate.gates[]
  // .reason, h10.hardBlockReasons, buyFilter.reasons) — never invented here.
  reasons?: string[];
}

export interface TradeCardTmPlanOk {
  status: "OK";
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  t3: number;
  rPremium: number;
  atrUnderlying: number;
  deltaUsed: number;
  trailingRule: string;
}
export interface TradeCardTmPlanUnavailable {
  status: "INSUFFICIENT_DATA";
  reason?: string;
}
export type TradeCardTmPlan = TradeCardTmPlanOk | TradeCardTmPlanUnavailable;

export interface TradeCardAdvancedGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  intrinsicValue: number;
  extrinsicValue: number;
}

export interface TradeCardLiveStatus {
  // A status line already decided elsewhere (e.g. server.ts's
  // buildPremiumOnlyMessageText switch — "✅ T1 achieved", "❌ SL hit",
  // "🟡 LIVE — tracking...", etc.). This module never derives it.
  statusLine: string;
  elapsedMin?: number;
}

export interface TradeCardInput {
  symbol: string;
  decision: "BEST_CE" | "BEST_PE";
  // "BUY" = buy a call, "SELL" = buy a put — this codebase's own existing
  // vocabulary (see server.ts M12b comment). Caller supplies it; this
  // module never derives BUY/SELL from decision itself, to avoid two
  // sources of truth for the same label drifting apart.
  label: "BUY" | "SELL";

  strike: number | null;
  moneynessRole: string | null;
  lastPrice: number | null;
  spot: number | null;
  dte: number | null;

  probability: number;
  grade: string;
  confidence: string;

  // Pass prob.reasons already split by the caller (server.ts already does
  // this filtering today) — this module does not re-parse "✅"/"ℹ️" prefixes,
  // it trusts the caller's classification.
  scoreReasons: string[];
  contextNotes: string[];
  riskFlags: string[];

  blockStatus?: TradeCardBlockStatus | null;
  tmPlan?: TradeCardTmPlan | null;
  advancedGreeks?: TradeCardAdvancedGreeks | null;
  futuresOiBuildup?: string | null;
  marketRegime?: string | null;
  liveStatus?: TradeCardLiveStatus | null;

  // Caller-supplied wall-clock string (e.g. istTime()) — this module has
  // no clock access of its own, per its pure/self-contained hard rule.
  timestampIst: string;
}

function isBlocked(input: TradeCardInput): boolean {
  return input.blockStatus?.blocked === true;
}

function buildFinalActionSection(input: TradeCardInput): string {
  if (isBlocked(input)) {
    return (
      `🚫 <b>BLOCKED — ${input.symbol}</b>\n` +
      `This candidate did NOT clear the pre-trade gates. No executable plan below.`
    );
  }
  const emoji = input.probability >= 85 ? "🟢" : input.probability >= 75 ? "🟡" : "🟠";
  const sideLabel = input.decision === "BEST_CE" ? "Buy CE" : "Buy PE";
  return (
    `${emoji} <b>${input.label} SIGNAL — ${input.symbol}</b> (${sideLabel})\n` +
    `📈 Score: <b>${input.probability}%</b> | Grade: <b>${input.grade}</b> | Confidence: <b>${input.confidence}</b>`
  );
}

function buildExactContractSection(input: TradeCardInput): string {
  const lines: string[] = [];
  const strikePart = input.strike != null ? `${input.strike}` : "—";
  const rolePart = input.moneynessRole ? ` (${input.moneynessRole})` : "";
  lines.push(`📊 Strike: <b>${strikePart}</b>${rolePart}`);
  const premiumPart = input.lastPrice != null ? `₹${input.lastPrice}` : "—";
  const spotPart = input.spot != null ? input.spot.toFixed(2) : "—";
  lines.push(`💰 Premium: <b>${premiumPart}</b> | Spot: <b>${spotPart}</b>`);
  if (input.dte != null) lines.push(`🕒 DTE: <b>${input.dte}</b>`);
  return lines.join("\n");
}

function buildOptionBuyerEdgeSection(input: TradeCardInput): string | null {
  // Only ever prints what's ALREADY in contextNotes (which includes the
  // OBE-3 "ℹ️ OBE-3 Volatility Purchase Condition: ..." line when present,
  // because server.ts's existing reasons[]/contextNotes wiring already
  // carries it — see obe-volatility.ts integration). Deliberately does NOT
  // add placeholder lines for OBE-1/2/4/5 (Best Index Selector, Buy
  // Permission, Movement Sufficiency, Premium Response Efficiency, Entry
  // Timing) since none of those are built yet.
  const obeLines = input.contextNotes.filter((n) => n.includes("OBE-"));
  if (obeLines.length === 0) return null;
  return `🧭 <b>Option Buyer Edge:</b>\n${obeLines.join("\n")}`;
}

function buildMarketScienceSection(input: TradeCardInput): string | null {
  const lines: string[] = [];
  const nonObeContext = input.contextNotes.filter((n) => !n.includes("OBE-"));
  if (nonObeContext.length > 0) lines.push(...nonObeContext);
  if (input.marketRegime) lines.push(`ℹ️ Market regime: ${input.marketRegime}`);
  if (input.futuresOiBuildup && input.futuresOiBuildup !== "INSUFFICIENT_DATA") {
    lines.push(`ℹ️ Futures OI buildup: ${input.futuresOiBuildup}`);
  }
  if (input.advancedGreeks) {
    const g = input.advancedGreeks;
    lines.push(
      `ℹ️ Greeks: Δ ${g.delta.toFixed(3)} | Γ ${g.gamma.toFixed(4)} | Θ ${g.theta.toFixed(2)} | V ${g.vega.toFixed(2)}`
    );
    lines.push(`ℹ️ Intrinsic ₹${g.intrinsicValue.toFixed(2)} | Extrinsic ₹${g.extrinsicValue.toFixed(2)}`);
  }
  if (lines.length === 0) return null;
  return `🔬 <b>Market Science:</b>\n${lines.join("\n")}`;
}

function buildDevilCheckSection(input: TradeCardInput): string | null {
  const lines: string[] = [];
  if (isBlocked(input)) {
    const reasons = input.blockStatus?.reasons ?? [];
    if (reasons.length > 0) {
      lines.push(...reasons.map((r) => `• ${r}`));
    } else {
      lines.push("• Blocked by a pre-trade gate (no itemized reason supplied).");
    }
  }
  if (input.riskFlags.length > 0) {
    lines.push(...input.riskFlags.map((r) => `• ${r}`));
  }
  if (lines.length === 0) return null;
  return `😈 <b>Devil Check (${lines.length}):</b>\n${lines.join("\n")}`;
}

function buildTradePlanSection(input: TradeCardInput): string | null {
  // Hard rule: a blocked trade NEVER shows an executable-looking plan,
  // even if a tmPlan happened to be computed upstream — suppress entirely.
  if
