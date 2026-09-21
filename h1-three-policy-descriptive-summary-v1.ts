export interface H1ThreePolicyDescriptiveRow {
  publishedAt?: string | null;
  identity?: { observedAt?: string | null } | null;
  gates?: {
    premiumResponseConfirmed?: { value?: boolean | null } | null;
    deltaGammaResponseConfirmed?: { value?: boolean | null } | null;
    thetaIvBurdenAcceptable?: { value?: boolean | null } | null;
    multiExpiryConflictAbsent?: { value?: boolean | null } | null;
    capitalFit?: { value?: boolean | null } | null;
    liquidityOk?: { value?: boolean | null } | null;
    spreadOk?: { value?: boolean | null } | null;
    currentOrNearExpiryUsable?: { value?: boolean | null } | null;
    higherDteUsable?: { value?: boolean | null } | null;
    fallbackDteApproved?: { value?: boolean | null } | null;
  } | null;
}

type PolicySummary = {
  observationCount: number;
  passCount: number;
  failCount: number;
  passRate: number | null;
  uniqueTradingDates: number;
  malformedCount: number;
};

export interface H1ThreePolicyDescriptiveSummary {
  version: "H1_THREE_POLICY_DESCRIPTIVE_SUMMARY_V1";
  rowCount: number;
  premiumDeltaGamma: PolicySummary;
  thetaIvMultiExpiry: PolicySummary;
  capitalLiquidityDte: PolicySummary;
  validationDecision: null;
  acceptanceCriteriaApplied: false;
  productionPromotionEligible: false;
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
  semantics: "DESCRIPTIVE_ONLY_NO_THRESHOLD_NO_VALIDATION_AUTHORITY";
}

function tradingDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const istMs = ms + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function summarize(
  rows: ReadonlyArray<H1ThreePolicyDescriptiveRow | null | undefined>,
  evaluate: (row: H1ThreePolicyDescriptiveRow) => boolean | null,
): PolicySummary {
  let observationCount = 0;
  let passCount = 0;
  let failCount = 0;
  let malformedCount = 0;
  const dates = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      malformedCount += 1;
      continue;
    }
    const result = evaluate(row);
    const date = tradingDate(row.identity?.observedAt ?? row.publishedAt ?? null);
    if (result === null || !date) {
      malformedCount += 1;
      continue;
    }
    observationCount += 1;
    dates.add(date);
    if (result) passCount += 1;
    else failCount += 1;
  }

  return {
    observationCount,
    passCount,
    failCount,
    passRate: observationCount > 0 ? passCount / observationCount : null,
    uniqueTradingDates: dates.size,
    malformedCount,
  };
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function buildH1ThreePolicyDescriptiveSummary(
  rows: ReadonlyArray<H1ThreePolicyDescriptiveRow | null | undefined>,
): H1ThreePolicyDescriptiveSummary {
  const safeRows = Array.isArray(rows) ? rows : [];

  const premiumDeltaGamma = summarize(safeRows, (row) => {
    const premium = bool(row.gates?.premiumResponseConfirmed?.value);
    const deltaGamma = bool(row.gates?.deltaGammaResponseConfirmed?.value);
    if (premium === null || deltaGamma === null) return null;
    return premium && deltaGamma;
  });

  const thetaIvMultiExpiry = summarize(safeRows, (row) => {
    const thetaIv = bool(row.gates?.thetaIvBurdenAcceptable?.value);
    const conflictAbsent = bool(row.gates?.multiExpiryConflictAbsent?.value);
    if (thetaIv === null || conflictAbsent === null) return null;
    return thetaIv && conflictAbsent;
  });

  const capitalLiquidityDte = summarize(safeRows, (row) => {
    const capital = bool(row.gates?.capitalFit?.value);
    const liquidity = bool(row.gates?.liquidityOk?.value);
    const spread = bool(row.gates?.spreadOk?.value);
    const current = bool(row.gates?.currentOrNearExpiryUsable?.value);
    const higher = bool(row.gates?.higherDteUsable?.value);
    const fallback = bool(row.gates?.fallbackDteApproved?.value);
    if (capital === null || liquidity === null || spread === null) return null;
    const dteUsable = current === true || higher === true || fallback === true;
    if (current === null && higher === null && fallback === null) return null;
    return capital && liquidity && spread && dteUsable;
  });

  return {
    version: "H1_THREE_POLICY_DESCRIPTIVE_SUMMARY_V1",
    rowCount: safeRows.length,
    premiumDeltaGamma,
    thetaIvMultiExpiry,
    capitalLiquidityDte,
    validationDecision: null,
    acceptanceCriteriaApplied: false,
    productionPromotionEligible: false,
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
    semantics: "DESCRIPTIVE_ONLY_NO_THRESHOLD_NO_VALIDATION_AUTHORITY",
  };
}
