export type ReplayQuality = "TRUE" | "PARTIAL" | "STALE" | "INVALID";

export interface ReplayObservation {
  logicalKey: string;
  observedAt: string;
  decisionAt: string;
  blockEnd?: string | null;
  blockClosed?: boolean | null;
  quality: ReplayQuality;
  expiry?: string | null;
  dte?: number | null;
  tradingDate?: string | null;
  sessionEligible?: boolean | null;
}

export interface ReplayGuardResult {
  eligible: boolean;
  errors: string[];
  warnings: string[];
  semantics: "HISTORICAL_RESEARCH_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  ruleVersion: "H1_REPLAY_GUARD_V1";
}

const DAY_MS = 86_400_000;

function isoMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function dateOnlyMs(v: string | null | undefined): number | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Deterministic research-only replay gate. No future observation may influence a decision-time state. */
export function validateReplayObservation(row: ReplayObservation): ReplayGuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const observed = isoMs(row.observedAt);
  const decision = isoMs(row.decisionAt);

  if (observed == null || decision == null) errors.push("INVALID_TIMESTAMP");
  else if (observed > decision) errors.push("LOOKAHEAD_FUTURE_OBSERVATION");

  if (row.blockEnd) {
    const blockEnd = isoMs(row.blockEnd);
    if (blockEnd == null) errors.push("INVALID_BLOCK_END");
    else if (decision != null && blockEnd > decision) errors.push("LOOKAHEAD_RUNNING_BLOCK");
  }
  if (row.blockClosed === false) errors.push("UNCONFIRMED_RUNNING_BLOCK");

  if (row.quality !== "TRUE") errors.push(`NON_RESEARCH_QUALITY_${row.quality}`);
  if (row.sessionEligible === false) errors.push("OUTSIDE_ELIGIBLE_SESSION");

  if (row.expiry && row.tradingDate && row.dte != null) {
    const expiry = dateOnlyMs(row.expiry);
    const trade = dateOnlyMs(row.tradingDate);
    if (expiry == null || trade == null) errors.push("INVALID_EXPIRY_OR_TRADE_DATE");
    else {
      const expected = Math.max(0, Math.round((expiry - trade) / DAY_MS));
      if (expected !== row.dte) errors.push("DTE_DATE_MISMATCH");
    }
  } else if (row.expiry || row.dte != null) {
    warnings.push("DTE_CROSSCHECK_INCOMPLETE");
  }

  return {
    eligible: errors.length === 0,
    errors,
    warnings,
    semantics: "HISTORICAL_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ruleVersion: "H1_REPLAY_GUARD_V1",
  };
}

export function validateReplayBatch(rows: ReplayObservation[]): ReplayGuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const r = validateReplayObservation(row);
    errors.push(...r.errors.map((e) => `${row.logicalKey}:${e}`));
    warnings.push(...r.warnings.map((w) => `${row.logicalKey}:${w}`));
    if (seen.has(row.logicalKey)) errors.push(`${row.logicalKey}:DUPLICATE_LOGICAL_KEY`);
    seen.add(row.logicalKey);
  }
  return {
    eligible: errors.length === 0,
    errors,
    warnings,
    semantics: "HISTORICAL_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ruleVersion: "H1_REPLAY_GUARD_V1",
  };
}
