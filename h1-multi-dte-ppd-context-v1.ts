import type { PpdSide, PpdWindowResult } from "./h1-premium-pair-divergence-v1.js";

export const H1_MULTI_DTE_PPD_CONTEXT_VERSION = "H1_MULTI_DTE_PPD_CONTEXT_V1" as const;

export type DteBucket = "DTE_0_1" | "DTE_2_4" | "DTE_5_9" | "DTE_10_PLUS";
export type MultiDtePpdAlignment = "ALL_CE" | "ALL_PE" | "MIXED" | "NO_CONTROL" | "INSUFFICIENT";

export type MultiDtePpdInput = {
  dte: number;
  result: PpdWindowResult;
};

function bucketForDte(dte: number): DteBucket {
  if (dte <= 1) return "DTE_0_1";
  if (dte <= 4) return "DTE_2_4";
  if (dte <= 9) return "DTE_5_9";
  return "DTE_10_PLUS";
}

export function buildMultiDtePpdContext(inputs: MultiDtePpdInput[]) {
  const valid = inputs
    .filter((x) => Number.isInteger(x.dte) && x.dte >= 0 && x.result.ok)
    .map((x) => {
      const r = x.result;
      if (!r.ok) throw new Error("unreachable");
      const controlled = r.pairState === "CE_CONTROLLED_EXPANSION" || r.pairState === "PE_CONTROLLED_EXPANSION";
      return {
        dte: x.dte,
        bucket: bucketForDte(x.dte),
        expiry: r.expiry,
        strike: r.strike,
        from: r.from,
        to: r.to,
        controllingSide: controlled ? r.controllingSide : null,
        pairState: r.pairState,
        ceReturnPct: r.ceReturnPct,
        peReturnPct: r.peReturnPct,
        rawPpdPp: r.rawPpdPp,
        netPpdSeparationPp: r.candidate.netPpdSeparationPp,
        ppdRatePpPerMinute: r.windowRate.rawPpdPpPerMinute,
        quality: r.quality,
      };
    });

  const indexSymbols = new Set(valid.map((x) => {
    const original = inputs.find((i) => i.dte === x.dte && i.result.ok && i.result.expiry === x.expiry && i.result.strike === x.strike);
    return original && original.result.ok ? original.result.indexSymbol : null;
  }).filter((x): x is string => x !== null));

  if (valid.length === 0 || indexSymbols.size !== 1) {
    return {
      ok: false as const,
      version: H1_MULTI_DTE_PPD_CONTEXT_VERSION,
      productionImpact: "NONE" as const,
      researchOnly: true as const,
      reason: valid.length === 0 ? "NO_VALID_PPD_WINDOWS" as const : "INDEX_MISMATCH" as const,
    };
  }

  const ceCount = valid.filter((x) => x.controllingSide === "CE").length;
  const peCount = valid.filter((x) => x.controllingSide === "PE").length;
  const controlledCount = ceCount + peCount;
  let alignment: MultiDtePpdAlignment;
  if (valid.length < 2) alignment = "INSUFFICIENT";
  else if (controlledCount === 0) alignment = "NO_CONTROL";
  else if (ceCount > 0 && peCount > 0) alignment = "MIXED";
  else if (ceCount === controlledCount) alignment = "ALL_CE";
  else if (peCount === controlledCount) alignment = "ALL_PE";
  else alignment = "MIXED";

  const primary = [...valid].sort((a, b) => a.dte - b.dte)[0];
  const primarySide = primary?.controllingSide ?? null;
  const opposingExpiries = primarySide
    ? valid.filter((x) => x.controllingSide !== null && x.controllingSide !== primarySide).map((x) => ({ dte: x.dte, expiry: x.expiry, side: x.controllingSide }))
    : [];

  return {
    ok: true as const,
    version: H1_MULTI_DTE_PPD_CONTEXT_VERSION,
    productionImpact: "NONE" as const,
    researchOnly: true as const,
    indexSymbol: [...indexSymbols][0],
    alignment,
    controlledCount,
    ceControlledCount: ceCount,
    peControlledCount: peCount,
    primaryDte: primary?.dte ?? null,
    primaryControllingSide: primarySide as PpdSide | null,
    crossDteConflict: opposingExpiries.length > 0,
    opposingExpiries,
    expiries: valid,
    interpretation: {
      sameFormulaAcrossDte: true as const,
      sameThresholdAcrossDte: false as const,
      thresholdPromoted: false as const,
      selectorQualification: "NOT_PROVEN" as const,
    },
    safety: {
      affectsSelector: false as const,
      affectsTelegram: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      brokerCallMade: false as const,
      placesOrder: false as const,
    },
  };
}
