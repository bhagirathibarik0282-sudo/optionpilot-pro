export type MeaningfulCardDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MeaningfulCardInput {
  symbol: string;
  at: string;
  direction: MeaningfulCardDirection;
  state: string;
  spotPrevious: number;
  spotCurrent: number;
  futurePrevious?: number | null;
  futureCurrent?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  candidateStrike: number;
  candidateSide: "CE" | "PE";
  candidatePrevious: number;
  candidateCurrent: number;
  candidateDte?: number | null;
  oppositeStrike?: number | null;
  oppositeSide?: "CE" | "PE" | null;
  oppositePrevious?: number | null;
  oppositeCurrent?: number | null;
  pcrPrevious?: number | null;
  pcrCurrent?: number | null;
  callWallStrike?: number | null;
  callWallOiPrevious?: number | null;
  callWallOiCurrent?: number | null;
  putWallStrike?: number | null;
  putWallOiPrevious?: number | null;
  putWallOiCurrent?: number | null;
  nextDtePrevious?: number | null;
  nextDteCurrent?: number | null;
  meaningfulChanges?: string[];
  blocker?: string | null;
}

function arrow(previous: number, current: number): string {
  return current > previous ? "↑" : current < previous ? "↓" : "→";
}

function pct(previous: number, current: number): string {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return "";
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const sign = change > 0 ? "+" : "";
  return ` (${sign}${change.toFixed(1)}%)`;
}

function money(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function lakh(value: number): string {
  return `${(value / 100000).toFixed(2)}L`;
}

function stateEmoji(direction: MeaningfulCardDirection): string {
  if (direction === "BULLISH") return "🟢";
  if (direction === "BEARISH") return "🔴";
  return "🟡";
}

export function buildMeaningfulTelegramCardV2(input: MeaningfulCardInput): string {
  const lines: string[] = [];
  const titleState = input.state.replaceAll("_", " ");
  lines.push(`${stateEmoji(input.direction)} ${input.symbol} | ${input.at} | ${titleState}`);
  lines.push("");

  lines.push(`📍 Spot: ${input.spotPrevious.toFixed(2)} → ${input.spotCurrent.toFixed(2)} ${arrow(input.spotPrevious, input.spotCurrent)}`);
  if (input.futurePrevious != null && input.futureCurrent != null) {
    lines.push(`📉 Futures: ${input.futurePrevious.toFixed(2)} → ${input.futureCurrent.toFixed(2)} ${arrow(input.futurePrevious, input.futureCurrent)}`);
  }
  if (input.pdh != null || input.pdl != null) {
    const levels: string[] = [];
    if (input.pdh != null) levels.push(`PDH ${input.pdh.toFixed(2)}`);
    if (input.pdl != null) levels.push(`PDL ${input.pdl.toFixed(2)}`);
    lines.push(`📏 ${levels.join(" | ")}`);
  }

  lines.push("");
  const dte = input.candidateDte != null ? ` | DTE${input.candidateDte}` : "";
  lines.push(`🎯 Candidate: ${input.candidateStrike} ${input.candidateSide}${dte}`);
  lines.push(`💰 Premium: ${money(input.candidatePrevious)} → ${money(input.candidateCurrent)} ${arrow(input.candidatePrevious, input.candidateCurrent)}${pct(input.candidatePrevious, input.candidateCurrent)}`);

  if (
    input.oppositeStrike != null && input.oppositeSide &&
    input.oppositePrevious != null && input.oppositeCurrent != null
  ) {
    lines.push(`↔️ Opposite: ${input.oppositeStrike} ${input.oppositeSide} ${money(input.oppositePrevious)} → ${money(input.oppositeCurrent)} ${arrow(input.oppositePrevious, input.oppositeCurrent)}${pct(input.oppositePrevious, input.oppositeCurrent)}`);
  }

  const wallLines: string[] = [];
  if (input.callWallStrike != null && input.callWallOiPrevious != null && input.callWallOiCurrent != null) {
    wallLines.push(`🧱 CE Wall ${input.callWallStrike}: ${lakh(input.callWallOiPrevious)} → ${lakh(input.callWallOiCurrent)} ${arrow(input.callWallOiPrevious, input.callWallOiCurrent)}`);
  }
  if (input.putWallStrike != null && input.putWallOiPrevious != null && input.putWallOiCurrent != null) {
    wallLines.push(`🧱 PE Wall ${input.putWallStrike}: ${lakh(input.putWallOiPrevious)} → ${lakh(input.putWallOiCurrent)} ${arrow(input.putWallOiPrevious, input.putWallOiCurrent)}`);
  }
  if (wallLines.length) {
    lines.push("");
    lines.push(...wallLines);
  }

  if (input.pcrPrevious != null && input.pcrCurrent != null) {
    lines.push(`📊 PCR: ${input.pcrPrevious.toFixed(3)} → ${input.pcrCurrent.toFixed(3)} ${arrow(input.pcrPrevious, input.pcrCurrent)}`);
  }

  if (input.nextDtePrevious != null && input.nextDteCurrent != null) {
    lines.push(`⏳ Next-DTE: ${money(input.nextDtePrevious)} → ${money(input.nextDteCurrent)} ${arrow(input.nextDtePrevious, input.nextDteCurrent)}`);
  }

  if (input.meaningfulChanges?.length) {
    lines.push("");
    lines.push(`⚡ CHANGE: ${input.meaningfulChanges.slice(0, 3).join(" | ")}`);
  }

  lines.push(`🧠 STATUS: ${titleState}`);
  lines.push(`🛒 CART: ${input.candidateStrike} ${input.candidateSide} — WATCH ONLY`);

  if (input.blocker) lines.push(`⚠️ Blocker: ${input.blocker}`);

  return lines.join("\n");
}
