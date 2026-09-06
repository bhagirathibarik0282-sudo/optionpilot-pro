import { CANONICAL_SEVEN_INDEX_SCOPE } from "./canonical-seven-index-intelligence-freeze.ts";
import {
  CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1,
  type SevenIndexMarketValueResult,
} from "./canonical-seven-index-market-value-parser.ts";

export const CANONICAL_MARKET_DNA_CONTEXT_V1 = "CANONICAL_MARKET_DNA_CONTEXT_V1" as const;

export type MarketDnaRegime =
  | "BROAD_RISK_ON"
  | "NARROW_LARGECAP"
  | "MID_SMALL_ROTATION"
  | "DEFENSIVE_LARGECAP"
  | "BROAD_RISK_OFF"
  | "TRANSITION"
  | "MIXED";

export type RotationState = "LARGE_CAP_LEAD" | "MID_SMALL_LEAD" | "BROAD_SYNCHRONY" | "MIXED";
export type DivergenceState = "NONE" | "LARGECAP_VS_BROAD" | "BROAD_VS_MID_SMALL" | "INTERNAL_MIXED";

export interface MarketDnaContext {
  version: typeof CANONICAL_MARKET_DNA_CONTEXT_V1;
  ready: boolean;
  regime: MarketDnaRegime | null;
  rotationState: RotationState | null;
  divergenceState: DivergenceState | null;
  participationBreadthPct: number | null;
  largeCapReturnPct: number | null;
  broadMarketReturnPct: number | null;
  midSmallReturnPct: number | null;
  largeCapConcentrationSpreadPct: number | null;
  sizeRotationSpreadPct: number | null;
  advancingIndexCount: number;
  decliningIndexCount: number;
  flatIndexCount: number;
  weightedConstituentBreadthReady: false;
  weightedConstituentBreadthPct: null;
  contextOnly: true;
  duplicateVoteForbidden: true;
  mayConfirmContext: true;
  mayDowngradeConfidence: true;
  mayFlagDivergence: true;
  grantsDirectionalSupport: false;
  affectsVerdictDirectly: false;
  affectsCandidateDirectly: false;
  affectsTelegramDirectly: false;
  affectsExecution: false;
  repairsMissingEvidence: false;
  failClosed: true;
  blockers: string[];
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function empty(blockers: string[]): MarketDnaContext {
  return {
    version: CANONICAL_MARKET_DNA_CONTEXT_V1,
    ready: false,
    regime: null,
    rotationState: null,
    divergenceState: null,
    participationBreadthPct: null,
    largeCapReturnPct: null,
    broadMarketReturnPct: null,
    midSmallReturnPct: null,
    largeCapConcentrationSpreadPct: null,
    sizeRotationSpreadPct: null,
    advancingIndexCount: 0,
    decliningIndexCount: 0,
    flatIndexCount: 0,
    weightedConstituentBreadthReady: false,
    weightedConstituentBreadthPct: null,
    contextOnly: true,
    duplicateVoteForbidden: true,
    mayConfirmContext: true,
    mayDowngradeConfidence: true,
    mayFlagDivergence: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    repairsMissingEvidence: false,
    failClosed: true,
    blockers: [...new Set(blockers)],
  };
}

export function buildMarketDnaContext(input: SevenIndexMarketValueResult): MarketDnaContext {
  const blockers: string[] = [];
  if (input.version !== CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1) blockers.push("MARKET_DNA_SOURCE_VERSION_INVALID");
  if (!input.ready || input.blockers.length > 0) blockers.push("MARKET_DNA_SOURCE_NOT_READY");
  if (!input.readOnly || !input.contextOnly || input.grantsDirectionalSupport || input.affectsVerdict || input.affectsCandidate || input.affectsTelegram || input.affectsExecution) {
    blockers.push("MARKET_DNA_SOURCE_AUTHORITY_TAMPERED");
  }
  if (input.rows.length !== CANONICAL_SEVEN_INDEX_SCOPE.length) blockers.push("MARKET_DNA_EXACT_SEVEN_ROWS_REQUIRED");
  const byId = new Map(input.rows.map((row) => [row.indexId, row]));
  for (const indexId of CANONICAL_SEVEN_INDEX_SCOPE) if (!byId.has(indexId)) blockers.push(`MARKET_DNA_INDEX_MISSING:${indexId}`);
  if (blockers.length) return empty(blockers);

  const returns = CANONICAL_SEVEN_INDEX_SCOPE.map((id) => byId.get(id)!.changePct);
  if (!returns.every(Number.isFinite)) return empty(["MARKET_DNA_RETURN_INVALID"]);

  const largeCap = avg([
    byId.get("NIFTY_50")!.changePct,
    byId.get("NIFTY_NEXT_50")!.changePct,
    byId.get("NIFTY_100")!.changePct,
  ]);
  const broad = avg([
    byId.get("NIFTY_200")!.changePct,
    byId.get("NIFTY_500")!.changePct,
  ]);
  const midSmall = avg([
    byId.get("NIFTY_MIDCAP_150")!.changePct,
    byId.get("NIFTY_SMALLCAP_250")!.changePct,
  ]);

  const advancing = returns.filter((value) => value > 0.05).length;
  const declining = returns.filter((value) => value < -0.05).length;
  const flat = returns.length - advancing - declining;
  const participationBreadthPct = ((advancing - declining) / returns.length) * 100;
  const largeCapConcentrationSpread = largeCap - broad;
  const sizeRotationSpread = midSmall - largeCap;

  let rotationState: RotationState = "MIXED";
  if (Math.abs(sizeRotationSpread) <= 0.12 && Math.abs(largeCapConcentrationSpread) <= 0.12) rotationState = "BROAD_SYNCHRONY";
  else if (sizeRotationSpread >= 0.2) rotationState = "MID_SMALL_LEAD";
  else if (sizeRotationSpread <= -0.2 || largeCapConcentrationSpread >= 0.2) rotationState = "LARGE_CAP_LEAD";

  let divergenceState: DivergenceState = "NONE";
  if ((largeCap > 0.15 && broad < -0.05) || (largeCap < -0.15 && broad > 0.05)) divergenceState = "LARGECAP_VS_BROAD";
  else if ((broad > 0.15 && midSmall < -0.05) || (broad < -0.15 && midSmall > 0.05)) divergenceState = "BROAD_VS_MID_SMALL";
  else if ((advancing > 0 && declining > 0) && Math.max(...returns) - Math.min(...returns) >= 0.8) divergenceState = "INTERNAL_MIXED";

  // Specific structural regimes take precedence over generic all-green/all-red breadth.
  // This prevents strong size rotation or large-cap concentration from being hidden inside
  // a broad-risk label merely because six or seven indices share the same sign.
  let regime: MarketDnaRegime = "MIXED";
  if (largeCap > 0.15 && largeCapConcentrationSpread >= 0.2 && midSmall <= largeCap - 0.25) regime = "NARROW_LARGECAP";
  else if (midSmall > 0.15 && sizeRotationSpread >= 0.2) regime = "MID_SMALL_ROTATION";
  else if (largeCap >= -0.05 && broad < -0.15 && midSmall < -0.2) regime = "DEFENSIVE_LARGECAP";
  else if (
    advancing >= 6 &&
    largeCap > 0 && broad > 0 && midSmall > 0 &&
    Math.abs(largeCapConcentrationSpread) <= 0.2 &&
    Math.abs(sizeRotationSpread) <= 0.2
  ) regime = "BROAD_RISK_ON";
  else if (
    declining >= 6 &&
    largeCap < 0 && broad < 0 && midSmall < 0 &&
    Math.abs(largeCapConcentrationSpread) <= 0.2 &&
    Math.abs(sizeRotationSpread) <= 0.2
  ) regime = "BROAD_RISK_OFF";
  else if (divergenceState !== "NONE" || Math.abs(participationBreadthPct) <= 14.3) regime = "TRANSITION";

  return {
    version: CANONICAL_MARKET_DNA_CONTEXT_V1,
    ready: true,
    regime,
    rotationState,
    divergenceState,
    participationBreadthPct: round(participationBreadthPct, 2),
    largeCapReturnPct: round(largeCap),
    broadMarketReturnPct: round(broad),
    midSmallReturnPct: round(midSmall),
    largeCapConcentrationSpreadPct: round(largeCapConcentrationSpread),
    sizeRotationSpreadPct: round(sizeRotationSpread),
    advancingIndexCount: advancing,
    decliningIndexCount: declining,
    flatIndexCount: flat,
    weightedConstituentBreadthReady: false,
    weightedConstituentBreadthPct: null,
    contextOnly: true,
    duplicateVoteForbidden: true,
    mayConfirmContext: true,
    mayDowngradeConfidence: true,
    mayFlagDivergence: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    repairsMissingEvidence: false,
    failClosed: true,
    blockers: [],
  };
}
