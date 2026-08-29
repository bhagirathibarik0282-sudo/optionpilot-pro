export interface BulkPreflightCounters {
  requestedTradingDays: number;
  foundTradingDays: number;
  expectedSymbols: number;
  foundSymbols: number;
  duplicateLogicalKeys: number;
  ceRows: number;
  peRows: number;
  trueRows: number;
  partialRows: number;
  staleRows: number;
  invalidRows: number;
  invalidExpiryRows: number;
  dteMismatchRows: number;
  outsideSessionRows: number;
  lookaheadRows: number;
  runningBlockRows: number;
}

export interface BulkPreflightResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  ruleVersion: "H1_60D_PREFLIGHT_V1";
  semantics: "IMPORT_SAFETY_ONLY";
}

/** Abort-first preflight. It does not import or mutate data. */
export function evaluate60dBulkPreflight(c: BulkPreflightCounters): BulkPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (c.requestedTradingDays <= 0) blockers.push("INVALID_REQUESTED_TRADING_DAYS");
  if (c.foundTradingDays !== c.requestedTradingDays) blockers.push("TRADING_DAY_COUNT_MISMATCH");
  if (c.foundSymbols !== c.expectedSymbols) blockers.push("SYMBOL_COUNT_MISMATCH");
  if (c.duplicateLogicalKeys > 0) blockers.push("DUPLICATE_LOGICAL_KEYS");
  if (c.ceRows !== c.peRows) blockers.push("CE_PE_COUNT_MISMATCH");
  if (c.invalidExpiryRows > 0) blockers.push("INVALID_EXPIRY_ROWS");
  if (c.dteMismatchRows > 0) blockers.push("DTE_DATE_MISMATCH_ROWS");
  if (c.outsideSessionRows > 0) blockers.push("OUTSIDE_SESSION_ROWS");
  if (c.lookaheadRows > 0) blockers.push("LOOKAHEAD_ROWS");
  if (c.runningBlockRows > 0) blockers.push("RUNNING_BLOCK_ROWS");
  if (c.partialRows > 0 || c.staleRows > 0 || c.invalidRows > 0) {
    warnings.push("DIAGNOSTIC_QUALITY_ROWS_PRESENT: they must remain excluded from research queries.");
  }
  if (c.trueRows <= 0) blockers.push("NO_RESEARCH_ELIGIBLE_TRUE_ROWS");

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    ruleVersion: "H1_60D_PREFLIGHT_V1",
    semantics: "IMPORT_SAFETY_ONLY",
  };
}
