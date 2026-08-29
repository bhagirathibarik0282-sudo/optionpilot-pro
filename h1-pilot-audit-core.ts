export type PilotStatus = "PASS" | "FAIL" | "NO_DATA";

export interface H1PilotAuditSummary {
  tradeDate: string | null;
  marketRowsBySymbol: Record<string, number>;
  optionRowsBySymbol: Record<string, number>;
  chainRowsBySymbol: Record<string, number>;
  researchEligibleCount: number;
  diagnosticCount: number;
  duplicateLogicalKeys: number;
  futureTimestampRows: number;
  expiryOrDteMismatchRows: number;
  cePeCountMismatch: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  pilotStatus: PilotStatus;
  blockers: string[];
}

export function rowsToCountMap(rows: Array<{ symbol: string; count: string | number }>): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.symbol, Number(r.count) || 0]));
}

export function decideH1PilotStatus(input: Omit<H1PilotAuditSummary, "pilotStatus" | "blockers">): Pick<H1PilotAuditSummary, "pilotStatus" | "blockers"> {
  const blockers: string[] = [];
  const totalMarket = Object.values(input.marketRowsBySymbol).reduce((a, b) => a + b, 0);
  const totalOptions = Object.values(input.optionRowsBySymbol).reduce((a, b) => a + b, 0);
  const totalChain = Object.values(input.chainRowsBySymbol).reduce((a, b) => a + b, 0);

  if (!input.tradeDate || totalMarket === 0) return { pilotStatus: "NO_DATA", blockers: ["NO_MARKET_SNAPSHOT_ROWS"] };
  if (totalOptions === 0) blockers.push("NO_OPTION_SNAPSHOT_ROWS");
  if (totalChain === 0) blockers.push("NO_CHAIN_STATE_ROWS");
  if (input.duplicateLogicalKeys > 0) blockers.push("DUPLICATE_LOGICAL_KEYS");
  if (input.futureTimestampRows > 0) blockers.push("FUTURE_TIMESTAMP_ROWS");
  if (input.expiryOrDteMismatchRows > 0) blockers.push("EXPIRY_OR_DTE_MISMATCH");
  if (input.cePeCountMismatch > 0) blockers.push("CE_PE_COUNT_MISMATCH");
  if (input.researchEligibleCount === 0) blockers.push("NO_RESEARCH_ELIGIBLE_OPTION_ROWS");

  return { pilotStatus: blockers.length === 0 ? "PASS" : "FAIL", blockers };
}
