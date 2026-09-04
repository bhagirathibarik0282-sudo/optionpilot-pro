export type H1ReadOnlyShadowDecisionDirection = "UP" | "DOWN";

export interface H1ReadOnlyShadowInputLike {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  ready: boolean;
  direction: H1ReadOnlyShadowDecisionDirection | null;
  evidenceTokenCount: number;
  blockers: string[];
}

export interface H1ReadOnlyShadowDecisionInputRow {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  ready: boolean;
  direction: H1ReadOnlyShadowDecisionDirection | null;
  evidenceTokenCount: number;
  blockers: string[];
}

export interface H1ReadOnlyShadowDecisionInputBoundaryResult {
  version: "H1_READONLY_SHADOW_DECISION_INPUT_BOUNDARY_V1";
  readySymbolCount: number;
  rows: H1ReadOnlyShadowDecisionInputRow[];
  semantics: "VERIFIED_DIRECTION_CONTEXT_ONLY_NO_SELECTOR_DECISION";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

const SYMBOLS = ["NIFTY", "SENSEX", "BANKNIFTY"] as const;

/**
 * Pure authority-free boundary between already verified shadow-input readiness
 * and a future shadow-only decision stage. It never converts UP/DOWN into CE/PE,
 * never SELECTs/BLOCKs a candidate, and grants no verdict/execution authority.
 */
export function buildH1ReadOnlyShadowDecisionInputBoundary(
  input: readonly H1ReadOnlyShadowInputLike[] | null | undefined,
): H1ReadOnlyShadowDecisionInputBoundaryResult {
  const bySymbol = new Map((input ?? []).map((row) => [row.symbol, row]));
  const rows: H1ReadOnlyShadowDecisionInputRow[] = SYMBOLS.map((symbol) => {
    const source = bySymbol.get(symbol);
    const blockers = new Set<string>();
    if (!source) blockers.add("SHADOW_INPUT_MISSING");
    if (source && !source.ready) blockers.add("SHADOW_INPUT_NOT_READY");
    if (source && source.direction !== "UP" && source.direction !== "DOWN") blockers.add("VERIFIED_DIRECTION_UNAVAILABLE");
    if (source && (!Number.isInteger(source.evidenceTokenCount) || source.evidenceTokenCount !== 5)) blockers.add(`EXACT_EVIDENCE_BUNDLE_INVALID:${source.evidenceTokenCount}/5`);
    for (const blocker of source?.blockers ?? []) blockers.add(blocker);

    const ready = blockers.size === 0;
    return {
      symbol,
      ready,
      direction: ready ? source!.direction : null,
      evidenceTokenCount: source?.evidenceTokenCount ?? 0,
      blockers: [...blockers],
    };
  });

  return {
    version: "H1_READONLY_SHADOW_DECISION_INPUT_BOUNDARY_V1",
    readySymbolCount: rows.filter((row) => row.ready).length,
    rows,
    semantics: "VERIFIED_DIRECTION_CONTEXT_ONLY_NO_SELECTOR_DECISION",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
