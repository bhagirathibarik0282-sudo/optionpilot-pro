import fs from "node:fs";

const path = "telegram-live-status-v2.ts";
let src = fs.readFileSync(path, "utf8");
const marker = "PHASE75_TELEGRAM_EMOJI_INSIGHT_V1";
if (src.includes(marker)) {
  console.log("Phase75 already present");
  process.exit(0);
}

const oldVerdict = `function verdictEmoji(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("BULL") || v.includes("BEST_CE") || v.includes("BUY CE")) return "📈🟢";
  if (v.includes("BEAR") || v.includes("BEST_PE") || v.includes("BUY PE")) return "📉🔴";
  if (v.includes("BLOCK") || v.includes("UNAVAILABLE")) return "⛔";
  if (v.includes("NO TRADE") || v.includes("NEUTRAL") || v.includes("WAIT")) return "⏸️";
  return "🧭";
}`;

const newVerdict = `// PHASE75_TELEGRAM_EMOJI_INSIGHT_V1
function verdictEmoji(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("SIDEWAYS") || v.includes("RANGE") || v.includes("FLAT")) return "🐢";
  if (v.includes("READY TO WATCH") || v.includes("READY_TO_WATCH") || v.includes("SETUP FORMING") || v.includes("WATCH")) return "👁️";
  if (v.includes("TRANSITION") || v.includes("REVERSING") || v.includes("REVERSAL")) return "🔄";
  if (v.includes("CONFLICT")) return "⚔️";
  if (v.includes("CONFIRMED") || v.includes("CONFIRM")) return "✅";
  if (v.includes("BULL") || v.includes("BEST_CE") || v.includes("BUY CE")) return "📈🟢";
  if (v.includes("BEAR") || v.includes("BEST_PE") || v.includes("BUY PE")) return "📉🔴";
  if (v.includes("BLOCK") || v.includes("UNAVAILABLE")) return "⛔";
  if (v.includes("NO TRADE") || v.includes("NEUTRAL") || v.includes("WAIT")) return "⏸️";
  return "🧭";
}

const PHASE75_TRADING_INSIGHTS = [
  "No clean setup is also a valid trading decision.",
  "Protect capital first; opportunity can be reassessed on the next clean setup.",
  "Sideways conditions reward patience more than prediction.",
  "A setup becomes useful only when evidence and risk are both acceptable.",
  "Follow the confirmed process, not a single noisy candle.",
  "When evidence conflicts, reducing conviction is information—not weakness.",
] as const;

function phase75TradingInsight(status: Phase74CanonicalStatus): string {
  const day = status.observedAt.slice(0, 10);
  const seed = [...(status.symbol + day)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return PHASE75_TRADING_INSIGHTS[seed % PHASE75_TRADING_INSIGHTS.length];
}`;

if ((src.split(oldVerdict).length - 1) !== 1) throw new Error("Phase75 blocker: verdictEmoji anchor drift");
src = src.replace(oldVerdict, newVerdict);

const oldFooter = `    \`<b>QUALIFICATION:</b> 🧪 LIVE EVIDENCE OBSERVING • no auto-promotion\`,
  ].join("\\n");`;
const newFooter = `    \`<b>QUALIFICATION:</b> 🧪 LIVE EVIDENCE OBSERVING • no auto-promotion\`,
    \`<b>📚 Trading Insight:</b> \${esc(phase75TradingInsight(status))}\`,
  ].join("\\n");`;
if ((src.split(oldFooter).length - 1) !== 1) throw new Error("Phase75 blocker: render footer anchor drift");
src = src.replace(oldFooter, newFooter);

for (const required of [marker, 'return "🐢"', 'return "👁️"', 'return "🔄"', 'return "⚔️"', '📚 Trading Insight', 'phase75TradingInsight(status)']) {
  if (!src.includes(required)) throw new Error(`Phase75 verification missing ${required}`);
}

// Display-only safety: no changes to decision authority or transport behavior.
const inserted = src.slice(src.indexOf(marker), src.indexOf("export function buildPhase74CanonicalStatus"));
for (const forbidden of ["runRuleEngine", "validateDataServer", "telegramApi(", "fetch(", "placeOrder", "executeTrade", "score =", "verdict ="]) {
  if (inserted.includes(forbidden)) throw new Error(`Phase75 P0: display block contains forbidden behavior ${forbidden}`);
}

fs.writeFileSync(path, src);
console.log("Phase75 Telegram emoji + insight display patch applied safely");
