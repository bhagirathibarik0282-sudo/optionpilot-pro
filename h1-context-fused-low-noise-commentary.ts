import type { H1AuthorityFreeLowNoiseCommentary } from "./h1-authority-free-low-noise-commentary.js";
import type { H1PositioningChangeEvidence } from "./h1-positioning-change-evidence.js";
import type { H1VolatilityContextEvidence } from "./h1-volatility-context-evidence.js";
import type { H1CrossIndexBreadthEvidence } from "./h1-cross-index-breadth-state.js";
import type { H1TimeLagResponseLadder } from "./h1-time-lag-response-ladder.js";

export interface H1ContextFusedLowNoiseCommentary {
  version: "H1_CONTEXT_FUSED_LOW_NOISE_COMMENTARY_V1";
  ready: boolean;
  renderable: true;
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
  semantics: "VERIFIED_CONTEXT_ENRICHMENT_ONLY_NO_DIRECTION_OPTION_MAPPING_NO_TRANSPORT";
}

function baseUnsafe(x: H1AuthorityFreeLowNoiseCommentary | null): boolean {
  return !x || x.productionImpact !== "NONE" || x.telegramSendAllowed || x.affectsTelegram ||
    x.affectsVerdict || x.affectsExecution || x.grantsPromotionAuthority || !x.failClosed;
}

function contextUnsafe(x: { productionImpact: "NONE"; readOnly: true; forwardsDownstream: false; affectsVerdict: false; affectsExecution: false; affectsTelegram: false; grantsPromotionAuthority: false; failClosed: true }): boolean {
  return x.productionImpact !== "NONE" || !x.readOnly || x.forwardsDownstream || x.affectsVerdict ||
    x.affectsExecution || x.affectsTelegram || x.grantsPromotionAuthority || !x.failClosed;
}

function pct(x: number | null): string {
  return x == null || !Number.isFinite(x) ? "MISSING" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function num(x: number | null): string {
  return x == null || !Number.isFinite(x) ? "MISSING" : `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
}

export function buildH1ContextFusedLowNoiseCommentary(
  base: H1AuthorityFreeLowNoiseCommentary | null,
  positioning: H1PositioningChangeEvidence[],
  volatility: H1VolatilityContextEvidence[],
  breadth: H1CrossIndexBreadthEvidence | null,
  ladders: H1TimeLagResponseLadder[],
): H1ContextFusedLowNoiseCommentary {
  const blockers: string[] = [];
  if (baseUnsafe(base)) blockers.push("BASE_COMMENTARY_SAFETY_CONTRACT_INVALID");
  if (!Array.isArray(positioning)) blockers.push("MISSING_POSITIONING_CONTEXT_ARRAY");
  if (!Array.isArray(volatility)) blockers.push("MISSING_VOLATILITY_CONTEXT_ARRAY");
  if (!Array.isArray(ladders)) blockers.push("MISSING_RESPONSE_LADDER_ARRAY");
  for (const x of positioning ?? []) if (contextUnsafe(x)) blockers.push("POSITIONING_CONTEXT_SAFETY_CONTRACT_INVALID");
  for (const x of volatility ?? []) if (contextUnsafe(x)) blockers.push("VOLATILITY_CONTEXT_SAFETY_CONTRACT_INVALID");
  for (const x of ladders ?? []) if (contextUnsafe(x)) blockers.push("RESPONSE_LADDER_SAFETY_CONTRACT_INVALID");
  if (!breadth || contextUnsafe(breadth)) blockers.push("BREADTH_CONTEXT_SAFETY_CONTRACT_INVALID");

  const pReady = (positioning ?? []).filter((x) => x.ready && !contextUnsafe(x));
  const vReady = (volatility ?? []).filter((x) => x.ready && !contextUnsafe(x));
  const lReady = (ladders ?? []).filter((x) => x.ready && !contextUnsafe(x));
  if (pReady.length === 0) blockers.push("NO_POSITIONING_CONTEXT_READY");
  if (vReady.length === 0) blockers.push("NO_VOLATILITY_CONTEXT_READY");
  if (!breadth?.ready) blockers.push("BREADTH_CONTEXT_NOT_READY");
  if (lReady.length === 0) blockers.push("NO_RESPONSE_LADDER_READY");
  if (!base?.ready) blockers.push("BASE_COMMENTARY_NOT_READY");

  const lines = [base?.text ?? "H1 LOW-NOISE SHADOW COMMENTARY\nBase commentary: BLOCKED", "", "POSITIONING CONTEXT"];
  if (pReady.length === 0) lines.push("Positioning: MISSING/BLOCKED");
  for (const x of pReady) {
    lines.push(`${x.symbol} ${x.expiry}: PCR Δ full=${num(x.fullChainOiPcrDelta)} | ±7=${num(x.band7OiPcrDelta)} | volume=${num(x.volumePcrDelta)}`);
    lines.push(`${x.symbol}: CE wall migration ${num(x.callWallMigration)} | ${x.callWallState} ${pct(x.callWallStrengthChangePct)}; PE wall migration ${num(x.putWallMigration)} | ${x.putWallState} ${pct(x.putWallStrengthChangePct)}`);
  }

  lines.push("", "VOLATILITY CONTEXT");
  if (vReady.length === 0) lines.push("Volatility: MISSING/BLOCKED");
  for (const x of vReady) {
    lines.push(`${x.symbol}: VIX ${x.currentVix?.toFixed(2) ?? "MISSING"} | ${x.vixState ?? "MISSING"} ${pct(x.vixChangePct)} | IV ${x.ivAvailable ? `${x.atmIv?.toFixed(2)} (${x.ivStatus})` : `UNAVAILABLE (${x.ivStatus})`}`);
  }

  lines.push("", "CROSS-INDEX BREADTH");
  if (!breadth?.ready) lines.push("Breadth: MISSING/BLOCKED");
  else {
    lines.push(`15m consensus: ${breadth.consensusDirection} | usable indices ${breadth.usableIndexCount}/3`);
    for (const x of breadth.rows) lines.push(`${x.symbol}: ${x.state} | ${x.direction} | ${x.temporalState}`);
    lines.push(`Heavyweight detail: ${breadth.heavyweightDetailStatus} | Sector detail: ${breadth.sectorDetailStatus}`);
  }

  lines.push("", "RESPONSE LADDER");
  if (lReady.length === 0) lines.push("3m/6m/15m/30m response: MISSING/BLOCKED");
  for (const x of lReady) {
    lines.push(`${x.symbol}: anchor ${x.anchorDirection} | highest ${x.highestConfirmedStage ?? "NONE"} | causal lag: UNAVAILABLE`);
    lines.push(x.stages.map((s) => `${s.timeframe} ${s.confirmed ? "CONFIRMED" : "PENDING"} ${s.direction}`).join(" | "));
  }

  lines.push("", "Direction→CE/PE inference: OFF", "BUY/SELL inference: OFF", "Trade authority: OFF", "Telegram transport: OFF");
  const uniqueBlockers = [...new Set(blockers)];
  const semanticKey = JSON.stringify({
    base: base?.semanticKey ?? null,
    positioning: pReady.map((x) => [x.symbol, x.expiry, x.fullChainOiPcrDelta, x.band7OiPcrDelta, x.volumePcrDelta, x.callWallMigration, x.putWallMigration, x.callWallStrengthChangePct, x.putWallStrengthChangePct, x.callWallState, x.putWallState]).sort(),
    volatility: vReady.map((x) => [x.symbol, x.currentVix, x.vixChangePct, x.vixState, x.ivAvailable, x.atmIv, x.ivStatus]).sort(),
    breadth: breadth?.ready ? [breadth.consensusDirection, ...breadth.rows.map((x) => `${x.symbol}:${x.state}:${x.direction}:${x.temporalState}`).sort(), breadth.heavyweightDetailStatus, breadth.sectorDetailStatus] : null,
    ladders: lReady.map((x) => [x.symbol, x.anchorDirection, x.highestConfirmedStage, ...x.stages.map((s) => `${s.timeframe}:${s.confirmed}:${s.direction}`)]).sort(),
    blockers: uniqueBlockers.slice().sort(),
  });

  return {
    version: "H1_CONTEXT_FUSED_LOW_NOISE_COMMENTARY_V1",
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
    semantics: "VERIFIED_CONTEXT_ENRICHMENT_ONLY_NO_DIRECTION_OPTION_MAPPING_NO_TRANSPORT",
  };
}
