export type ChainMetricName =
  | "ATM_STRADDLE"
  | "BAND7_OI_PCR"
  | "FULL_CHAIN_OI_PCR"
  | "VOLUME_PCR"
  | "CALL_WALL"
  | "PUT_WALL"
  | "MAX_PAIN";

export type ChainMetricTruthState = "VALID" | "PARTIAL" | "BLOCKED";

export type ChainConstituent = {
  underlying: string;
  expiry: string | null | undefined;
  strike: number | null | undefined;
  optionType: "CE" | "PE";
  exchange?: string | null;
  segment?: string | null;
  instrumentToken?: string | number | null;
  tradingSymbol?: string | null;
  sourceProvider?: string | null;
  sourceVersion?: string | null;
  quoteTimestamp?: string | null;
  receivedAt?: string | null;
  oi?: number | null;
  volume?: number | null;
  ltp?: number | null;
};

export type ChainUniverseExpectation = {
  expectedCeCount?: number | null;
  expectedPeCount?: number | null;
  expectedStrikes?: number[] | null;
  provenance?: string | null;
};

export type ChainMetricTruth = {
  metric: ChainMetricName;
  state: ChainMetricTruthState;
  usable: boolean;
  reasons: string[];
  constituentCount: number;
  calculationVersion: "CHAIN_CONSTITUENT_PROVENANCE_V1";
};

export type ChainProvenanceAudit = {
  underlying: string;
  expiry: string;
  observedCeCount: number;
  observedPeCount: number;
  exactConstituentCount: number;
  blockedConstituentCount: number;
  universeComplete: boolean;
  band7Complete: boolean;
  atmPairComplete: boolean;
  metrics: Record<ChainMetricName, ChainMetricTruth>;
  reasons: string[];
  auditVersion: "CHAIN_CONSTITUENT_PROVENANCE_V1";
};

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

function sourceProviderIsKite(v: string | null | undefined): boolean {
  const p = String(v ?? "").trim().toUpperCase();
  return p === "KITE" || p === "ZERODHA";
}

function hasLiveMaster(v: string | null | undefined): boolean {
  return String(v ?? "").includes("LIVE_CONTRACT_MASTER");
}

function tradingSymbolShape(row: ChainConstituent): boolean {
  if (!row.tradingSymbol || !row.underlying || !finite(row.strike)) return false;
  const ts = row.tradingSymbol.trim().toUpperCase();
  const under = row.underlying.trim().toUpperCase();
  const strike = Number.isInteger(row.strike) ? String(row.strike) : String(row.strike).replace(".", "");
  return ts.startsWith(under) && ts.endsWith(`${strike}${row.optionType}`);
}

function exactConstituentReasons(
  row: ChainConstituent,
  expectedUnderlying: string,
  expectedExpiry: string,
  nowIso: string,
  freshMaxMs: number | null,
): string[] {
  const reasons: string[] = [];
  if (row.underlying !== expectedUnderlying) reasons.push("UNDERLYING_MISMATCH");
  if (row.expiry !== expectedExpiry) reasons.push("EXPIRY_MISMATCH");
  if (!finite(row.strike)) reasons.push("STRIKE_MISSING");
  if (!row.exchange || !row.segment || row.instrumentToken == null || !row.tradingSymbol) reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
  if (!tradingSymbolShape(row)) reasons.push("TRADING_SYMBOL_SHAPE_MISMATCH");
  if (!sourceProviderIsKite(row.sourceProvider)) reasons.push("SOURCE_PROVIDER_UNVERIFIED");
  if (!hasLiveMaster(row.sourceVersion)) reasons.push("INSTRUMENT_MASTER_PROVENANCE_MISSING");

  const quoteMs = isoMs(row.quoteTimestamp);
  const nowMs = isoMs(nowIso);
  if (quoteMs == null) reasons.push("SOURCE_TS_MISSING_OR_INVALID");
  if (nowMs == null) reasons.push("AUDIT_TIME_INVALID");
  if (freshMaxMs == null || !Number.isFinite(freshMaxMs) || freshMaxMs < 0) {
    reasons.push("FRESHNESS_POLICY_UNCONFIGURED");
  } else if (quoteMs != null && nowMs != null) {
    const age = nowMs - quoteMs;
    if (age < 0) reasons.push("SOURCE_TS_FUTURE");
    else if (age > freshMaxMs) reasons.push("QUOTE_NOT_FRESH");
  }
  return [...new Set(reasons)];
}

function metric(metric: ChainMetricName, usable: boolean, reasons: string[], count: number, partial = false): ChainMetricTruth {
  return {
    metric,
    state: usable ? "VALID" : partial ? "PARTIAL" : "BLOCKED",
    usable,
    reasons: [...new Set(reasons)],
    constituentCount: count,
    calculationVersion: "CHAIN_CONSTITUENT_PROVENANCE_V1",
  };
}

function sameStrikePair(exactRows: ChainConstituent[], atmStrike: number): ChainConstituent[] {
  return exactRows.filter((r) => r.strike === atmStrike && (r.optionType === "CE" || r.optionType === "PE"));
}

export function auditChainConstituentProvenance(args: {
  underlying: string;
  expiry: string;
  atmStrike: number;
  ceRows: ChainConstituent[];
  peRows: ChainConstituent[];
  nowIso: string;
  freshMaxMs: number | null;
  universeExpectation?: ChainUniverseExpectation | null;
  bandRadius?: number;
}): ChainProvenanceAudit {
  const bandRadius = Number.isInteger(args.bandRadius) && (args.bandRadius as number) >= 0 ? args.bandRadius as number : 7;
  const rows = [...args.ceRows, ...args.peRows];
  const rowReasons = new Map<ChainConstituent, string[]>();
  for (const row of rows) rowReasons.set(row, exactConstituentReasons(row, args.underlying, args.expiry, args.nowIso, args.freshMaxMs));
  const exact = rows.filter((r) => (rowReasons.get(r)?.length ?? 0) === 0);

  const duplicateContractKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const duplicateTokens = new Set<string>();
  const seenTokens = new Set<string>();
  for (const r of exact) {
    const key = `${r.optionType}:${r.strike}`;
    if (seenKeys.has(key)) duplicateContractKeys.add(key); else seenKeys.add(key);
    const tok = String(r.instrumentToken);
    if (seenTokens.has(tok)) duplicateTokens.add(tok); else seenTokens.add(tok);
  }
  const duplicateReasons = [
    ...(duplicateContractKeys.size ? ["DUPLICATE_SIDE_STRIKE"] : []),
    ...(duplicateTokens.size ? ["DUPLICATE_INSTRUMENT_TOKEN"] : []),
  ];

  const expected = args.universeExpectation ?? null;
  const countProof = !!expected && Number.isInteger(expected.expectedCeCount) && Number.isInteger(expected.expectedPeCount) &&
    expected.expectedCeCount === args.ceRows.length && expected.expectedPeCount === args.peRows.length &&
    !!expected.provenance;
  const strikeProof = !!expected?.expectedStrikes?.length && expected.expectedStrikes.every((s) =>
    exact.some((r) => r.strike === s && r.optionType === "CE") && exact.some((r) => r.strike === s && r.optionType === "PE")
  );
  const allExact = exact.length === rows.length && rows.length > 0 && duplicateReasons.length === 0;
  const universeComplete = allExact && countProof && strikeProof;

  const uniqueStrikes = [...new Set(rows.map((r) => r.strike).filter(finite))].sort((a,b) => a-b);
  const atmIndex = uniqueStrikes.indexOf(args.atmStrike);
  const bandStrikes = atmIndex >= 0
    ? uniqueStrikes.slice(Math.max(0, atmIndex-bandRadius), Math.min(uniqueStrikes.length, atmIndex+bandRadius+1))
    : [];
  const expectedBandSize = bandRadius * 2 + 1;
  const band7Complete = bandStrikes.length === expectedBandSize && bandStrikes.every((s) =>
    exact.some((r) => r.strike === s && r.optionType === "CE") && exact.some((r) => r.strike === s && r.optionType === "PE")
  ) && duplicateReasons.length === 0;

  const atmPair = sameStrikePair(exact, args.atmStrike);
  const atmPairComplete = atmPair.some((r) => r.optionType === "CE") && atmPair.some((r) => r.optionType === "PE") &&
    atmPair.filter((r) => r.optionType === "CE").length === 1 && atmPair.filter((r) => r.optionType === "PE").length === 1;

  const commonBlocked = [...new Set([...rows.flatMap((r) => rowReasons.get(r) ?? []), ...duplicateReasons])];
  const universeReasons = universeComplete ? [] : [...commonBlocked,
    ...(countProof ? [] : ["CHAIN_UNIVERSE_COUNT_UNPROVEN"]),
    ...(strikeProof ? [] : ["CHAIN_UNIVERSE_STRIKE_COVERAGE_UNPROVEN"]),
  ];
  const bandReasons = band7Complete ? [] : [...commonBlocked, "ATM_BAND_CONSTITUENT_COVERAGE_INCOMPLETE"];
  const atmReasons = atmPairComplete ? [] : [...commonBlocked, "ATM_CE_PE_PAIR_NOT_EXACT"];

  const metrics: Record<ChainMetricName, ChainMetricTruth> = {
    ATM_STRADDLE: metric("ATM_STRADDLE", atmPairComplete, atmReasons, atmPair.length),
    BAND7_OI_PCR: metric("BAND7_OI_PCR", band7Complete, bandReasons, bandStrikes.length * 2),
    FULL_CHAIN_OI_PCR: metric("FULL_CHAIN_OI_PCR", universeComplete, universeReasons, rows.length),
    VOLUME_PCR: metric("VOLUME_PCR", universeComplete, universeReasons, rows.length),
    CALL_WALL: metric("CALL_WALL", universeComplete, universeReasons, args.ceRows.length),
    PUT_WALL: metric("PUT_WALL", universeComplete, universeReasons, args.peRows.length),
    MAX_PAIN: metric("MAX_PAIN", false, ["MAX_PAIN_CALCULATION_PROVENANCE_NOT_AUDITED"], rows.length),
  };

  const reasons = [...new Set(Object.values(metrics).flatMap((m) => m.reasons))];
  return {
    underlying: args.underlying,
    expiry: args.expiry,
    observedCeCount: args.ceRows.length,
    observedPeCount: args.peRows.length,
    exactConstituentCount: exact.length,
    blockedConstituentCount: rows.length - exact.length,
    universeComplete,
    band7Complete,
    atmPairComplete,
    metrics,
    reasons,
    auditVersion: "CHAIN_CONSTITUENT_PROVENANCE_V1",
  };
}

function sum(rows: ChainConstituent[], field: "oi" | "volume"): number | null {
  const values = rows.map((r) => r[field]).filter(finite);
  if (!values.length) return null;
  return values.reduce((a,b) => a+b, 0);
}

function ratio(pe: number | null, ce: number | null): number | null {
  if (pe == null || ce == null || ce <= 0) return null;
  return pe / ce;
}

export function deriveChainMetricsFromVerifiedConstituents(args: {
  audit: ChainProvenanceAudit;
  atmStrike: number;
  ceRows: ChainConstituent[];
  peRows: ChainConstituent[];
  bandRadius?: number;
}) {
  const bandRadius = Number.isInteger(args.bandRadius) && (args.bandRadius as number) >= 0 ? args.bandRadius as number : 7;
  const strikes = [...new Set([...args.ceRows, ...args.peRows].map((r) => r.strike).filter(finite))].sort((a,b) => a-b);
  const atmIndex = strikes.indexOf(args.atmStrike);
  const band = atmIndex >= 0 ? new Set(strikes.slice(Math.max(0, atmIndex-bandRadius), Math.min(strikes.length, atmIndex+bandRadius+1))) : new Set<number>();
  const bandCe = args.ceRows.filter((r) => finite(r.strike) && band.has(r.strike));
  const bandPe = args.peRows.filter((r) => finite(r.strike) && band.has(r.strike));
  const atmCe = args.ceRows.find((r) => r.strike === args.atmStrike);
  const atmPe = args.peRows.find((r) => r.strike === args.atmStrike);

  const wall = (rows: ChainConstituent[]) => {
    const valid = rows.filter((r) => finite(r.strike) && finite(r.oi) && (r.oi as number) >= 0) as Array<ChainConstituent & {strike:number;oi:number}>;
    if (!valid.length) return null;
    return valid.reduce((a,b) => b.oi > a.oi ? b : a).strike;
  };

  return {
    atmStraddleLtp: args.audit.metrics.ATM_STRADDLE.usable && finite(atmCe?.ltp) && finite(atmPe?.ltp) ? (atmCe!.ltp as number) + (atmPe!.ltp as number) : null,
    band7OiPcr: args.audit.metrics.BAND7_OI_PCR.usable ? ratio(sum(bandPe,"oi"), sum(bandCe,"oi")) : null,
    fullChainOiPcr: args.audit.metrics.FULL_CHAIN_OI_PCR.usable ? ratio(sum(args.peRows,"oi"), sum(args.ceRows,"oi")) : null,
    volumePcr: args.audit.metrics.VOLUME_PCR.usable ? ratio(sum(args.peRows,"volume"), sum(args.ceRows,"volume")) : null,
    callWallStrike: args.audit.metrics.CALL_WALL.usable ? wall(args.ceRows) : null,
    putWallStrike: args.audit.metrics.PUT_WALL.usable ? wall(args.peRows) : null,
    maxPain: null,
    calculationVersion: "CHAIN_CONSTITUENT_PROVENANCE_V1" as const,
  };
}

export function chainConstituentSafetyContract() {
  return {
    fullChainLabelRequiresUniverseCompletenessProof: true,
    wallsRequireUniverseCompletenessProof: true,
    atmStraddleRequiresExactFreshAtmPair: true,
    band7PcrRequiresExactFreshBandPairCoverage: true,
    maxPainRemainsBlockedUntilCalculationAudit: true,
    missingConstituentNeverTreatedAsZero: true,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    version: "CHAIN_CONSTITUENT_PROVENANCE_V1",
  } as const;
}
