import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { listH1TheoryRecordedDates } from "./h1-theory-history.js";
import { runH1ReplayHttp, type H1ReplayHttpResult } from "./h1-replay-http.js";
import { buildH1DirectionResponseResearch } from "./h1-direction-response-research-v1.js";
import {
  H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1,
} from "./h1-selector-independent-prospective-policy-v1.js";
import {
  evaluateH1SelectorProspectiveValidation,
  type H1DirectionProspectiveEvidence,
  type H1GreekProspectiveEvidence,
  type H1SelectorProspectiveValidationEvaluation,
  type H1SelectorProspectiveValidationEvidence,
} from "./h1-selector-prospective-validation-evaluator.js";
import type { H1SelectorProspectiveValidationProtocolInput } from "./h1-selector-prospective-validation-protocol.js";
import {
  H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND,
  type H1LiveExactGreekTimingRecord,
} from "./h1-live-exact-raw-evidence-store.js";
import {
  H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND,
  type H1KiteGreekMathCrosscheckPersistRecord,
} from "./h1-kite-greek-math-crosscheck.js";

const VERSION = "H1_SELECTOR_PROSPECTIVE_EVIDENCE_READBACK_V1" as const;
const POLICY = H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1;

function finiteProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function ms(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function rate(pass: number, total: number): number | null {
  return total > 0 ? pass / total : null;
}

function maxFinite(values: unknown[]): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

export interface H1ProspectiveEvidenceBuild<T> {
  evidence: T | null;
  blockers: string[];
}

export function buildH1ProspectiveDirectionEvidenceV1(input: {
  untouchedTradingDates: number;
  candidateLabel: string | null;
  calibrationStrictMajorityIntervalRate: number | null;
  oosRetentionRate: number | null;
  oosStrictMajorityIntervalRate: number | null;
  oosMeanSideBalancedAgreementShare: number | null;
}): H1ProspectiveEvidenceBuild<H1DirectionProspectiveEvidence> {
  const blockers: string[] = [];
  if (input.candidateLabel !== POLICY.direction.candidateLabel) blockers.push("DIRECTION_P75_CANDIDATE_REQUIRED");
  if (!Number.isInteger(input.untouchedTradingDates) || input.untouchedTradingDates < 0) {
    blockers.push("DIRECTION_UNTOUCHED_TRADING_DATE_COUNT_INVALID");
  }
  if (!finiteProbability(input.calibrationStrictMajorityIntervalRate)) blockers.push("DIRECTION_CALIBRATION_MAJORITY_RATE_REQUIRED");
  if (!finiteProbability(input.oosRetentionRate)) blockers.push("DIRECTION_OOS_RETENTION_RATE_REQUIRED");
  if (!finiteProbability(input.oosStrictMajorityIntervalRate)) blockers.push("DIRECTION_OOS_STRICT_MAJORITY_RATE_REQUIRED");
  if (!finiteProbability(input.oosMeanSideBalancedAgreementShare)) blockers.push("DIRECTION_OOS_BALANCE_RATE_REQUIRED");
  if (blockers.length) return { evidence: null, blockers };

  return {
    evidence: {
      candidateLabel: POLICY.direction.candidateLabel,
      untouchedTradingDates: input.untouchedTradingDates,
      oosRetentionRate: input.oosRetentionRate!,
      oosStrictMajorityIntervalRate: input.oosStrictMajorityIntervalRate!,
      oosMeanSideBalancedAgreementShare: input.oosMeanSideBalancedAgreementShare!,
      calibrationToOosStrictMajorityDrop: Math.max(
        0,
        input.calibrationStrictMajorityIntervalRate! - input.oosStrictMajorityIntervalRate!,
      ),
    },
    blockers: [],
  };
}

export function buildH1ProspectiveGreekEvidenceV1(
  timingRowsInput: H1LiveExactGreekTimingRecord[],
  crosscheckRowsInput: H1KiteGreekMathCrosscheckPersistRecord[],
  evidenceWindowStartsAt: string,
): H1ProspectiveEvidenceBuild<H1GreekProspectiveEvidence> & {
  timingRowCount: number;
  policyIdentifiedCrosscheckCount: number;
  legacyOrUnidentifiedCrosscheckCount: number;
  uniqueGreekPolicyCount: number;
} {
  const start = ms(evidenceWindowStartsAt);
  const blockers: string[] = [];
  if (start == null) {
    return {
      evidence: null,
      blockers: ["VALID_EVIDENCE_WINDOW_START_REQUIRED"],
      timingRowCount: 0,
      policyIdentifiedCrosscheckCount: 0,
      legacyOrUnidentifiedCrosscheckCount: 0,
      uniqueGreekPolicyCount: 0,
    };
  }

  const timingRows = (timingRowsInput ?? []).filter((row) => {
    const observed = ms(row.minuteBucket);
    return observed != null && observed >= start && row.provenance === "LIVE_RUNTIME_EXACT";
  });

  const allWindowCrosschecks = (crosscheckRowsInput ?? []).filter((row) => {
    const observed = ms(row.minuteBucket);
    return observed != null && observed >= start;
  });

  const crosscheckRows = allWindowCrosschecks.filter((row) =>
    row.version === "H1_KITE_GREEK_MATH_CROSSCHECK_1M_V2" &&
    row.policyIdentity?.version === "H1_KITE_GREEK_EVIDENCE_POLICY_IDENTITY_V1" &&
    row.policyIdentity.referenceImplementationVersion === "H1_KITE_GREEK_MATH_CROSSCHECK_V2" &&
    row.policyIdentity.greekPolicySemantics === "SHADOW_CALIBRATION_ONLY" &&
    row.policyIdentity.productionPolicyBound === false &&
    row.evidence?.ready === true,
  );

  const legacyOrUnidentifiedCrosscheckCount = allWindowCrosschecks.length - crosscheckRows.length;
  const uniqueGreekPolicies = new Set(crosscheckRows.map((row) => JSON.stringify(row.policyIdentity.greekPolicy)));

  if (!timingRows.length) blockers.push("GREEK_TIMING_EVIDENCE_UNAVAILABLE");
  if (!crosscheckRows.length) blockers.push("POLICY_IDENTIFIED_GREEK_CROSSCHECK_EVIDENCE_UNAVAILABLE");
  if (uniqueGreekPolicies.size > 1) blockers.push("MIXED_GREEK_POLICY_IDENTITY_FORBIDDEN");

  const timingPolicyMismatch = crosscheckRows.some((row) =>
    row.policyIdentity.greekPolicy.maxAgeMs !== POLICY.greeks.maximumObservationAgeMs ||
    row.policyIdentity.greekPolicy.maxUnderlyingSkewMs !== POLICY.greeks.maximumUnderlyingSkewMs
  );
  if (timingPolicyMismatch) blockers.push("GREEK_POLICY_TIMING_LIMIT_IDENTITY_MISMATCH");

  const timingPass = timingRows.filter((row) =>
    Number.isFinite(row.optionAgeMsAtReceive) &&
    row.optionAgeMsAtReceive >= 0 &&
    row.optionAgeMsAtReceive <= POLICY.greeks.maximumObservationAgeMs &&
    Number.isFinite(row.underlyingAgeMsAtOptionReceive) &&
    row.underlyingAgeMsAtOptionReceive >= 0 &&
    row.underlyingAgeMsAtOptionReceive <= POLICY.greeks.maximumObservationAgeMs &&
    row.optionFutureAtReceive === false &&
    row.underlyingFutureAtOptionReceive === false &&
    row.underlyingReceivedAfterOptionReceive === false
  ).length;

  const skewPass = timingRows.filter((row) =>
    Number.isFinite(row.underlyingSkewMs) &&
    row.underlyingSkewMs >= 0 &&
    row.underlyingSkewMs <= POLICY.greeks.maximumUnderlyingSkewMs &&
    row.optionFutureAtReceive === false &&
    row.underlyingFutureAtOptionReceive === false
  ).length;

  const deltaErrors = crosscheckRows.map((row) => row.evidence.absoluteDeltaError);
  const gammaErrors = crosscheckRows.map((row) => row.evidence.absoluteGammaError);
  const ivErrors = crosscheckRows.map((row) => row.evidence.absoluteIvErrorPctPoints);
  const maxDelta = maxFinite(deltaErrors);
  const maxGamma = maxFinite(gammaErrors);
  const maxIv = maxFinite(ivErrors);

  if (crosscheckRows.some((row) =>
    !Number.isFinite(row.evidence.absoluteDeltaError) ||
    !Number.isFinite(row.evidence.absoluteGammaError) ||
    !Number.isFinite(row.evidence.absoluteIvErrorPctPoints)
  )) {
    blockers.push("GREEK_MODEL_ERROR_FIELDS_INCOMPLETE");
  }

  const timingPassRate = rate(timingPass, timingRows.length);
  const skewPassRate = rate(skewPass, timingRows.length);
  const deltaPassRate = rate(
    crosscheckRows.filter((row) => Number(row.evidence.absoluteDeltaError) <= POLICY.greeks.maximumAbsoluteDeltaError).length,
    crosscheckRows.length,
  );
  const gammaPassRate = rate(
    crosscheckRows.filter((row) => Number(row.evidence.absoluteGammaError) <= POLICY.greeks.maximumAbsoluteGammaError).length,
    crosscheckRows.length,
  );
  const ivPassRate = rate(
    crosscheckRows.filter((row) => Number(row.evidence.absoluteIvErrorPctPoints) <= POLICY.greeks.maximumAbsoluteIvError).length,
    crosscheckRows.length,
  );

  if (
    timingPassRate == null || skewPassRate == null ||
    deltaPassRate == null || gammaPassRate == null || ivPassRate == null ||
    maxDelta == null || maxGamma == null || maxIv == null
  ) {
    return {
      evidence: null,
      blockers: [...new Set(blockers)],
      timingRowCount: timingRows.length,
      policyIdentifiedCrosscheckCount: crosscheckRows.length,
      legacyOrUnidentifiedCrosscheckCount,
      uniqueGreekPolicyCount: uniqueGreekPolicies.size,
    };
  }

  return {
    evidence: {
      untouchedContractObservations: crosscheckRows.length,
      timingPassRate,
      underlyingSkewPassRate: skewPassRate,
      maximumAbsoluteDeltaErrorObserved: maxDelta,
      maximumAbsoluteGammaErrorObserved: maxGamma,
      maximumAbsoluteIvErrorObserved: maxIv,
      deltaModelPassRate: deltaPassRate,
      gammaModelPassRate: gammaPassRate,
      ivModelPassRate: ivPassRate,
    },
    blockers: [...new Set(blockers)],
    timingRowCount: timingRows.length,
    policyIdentifiedCrosscheckCount: crosscheckRows.length,
    legacyOrUnidentifiedCrosscheckCount,
    uniqueGreekPolicyCount: uniqueGreekPolicies.size,
  };
}

async function loadPayloadsSince<T>(kind: string, startIso: string): Promise<T[] | null> {
  const result = await dbQuerySafe<{ payload: T }>(`
    SELECT payload
    FROM app_state_log
    WHERE kind = $1
      AND payload->>'minuteBucket' IS NOT NULL
      AND payload->>'minuteBucket' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      AND (payload->>'minuteBucket')::timestamptz >= $2::timestamptz
    ORDER BY (payload->>'minuteBucket')::timestamptz ASC, id ASC
  `, [kind, startIso]);
  return result ? result.rows.map((row) => row.payload) : null;
}

export async function runH1SelectorProspectiveEvidenceReadbackV1(): Promise<{
  ok: boolean;
  version: typeof VERSION;
  mode: "READ_ONLY";
  productionImpact: "NONE";
  evidenceWindowStartsAt: string;
  evidenceWindowEndsAt: string;
  direction: {
    recordedDates: string[];
    completeTradingDates: string[];
    incompleteTradingDates: string[];
    p75ThresholdPct: number | null;
    evidence: H1DirectionProspectiveEvidence | null;
    blockers: string[];
  };
  greeks: {
    timingRowCount: number;
    policyIdentifiedCrosscheckCount: number;
    legacyOrUnidentifiedCrosscheckCount: number;
    uniqueGreekPolicyCount: number;
    evidence: H1GreekProspectiveEvidence | null;
    blockers: string[];
  };
  evaluation: H1SelectorProspectiveValidationEvaluation | null;
  blockers: string[];
  safety: {
    readOnly: true;
    productionPromotionEligible: false;
    affectsSelector: false;
    affectsBusinessCard: false;
    affectsTelegram: false;
    affectsExecution: false;
    createsOrders: false;
    failClosed: true;
  };
}> {
  const evidenceWindowStartsAt = POLICY.untouchedEvidenceStartsAt;
  const evidenceWindowEndsAt = new Date().toISOString();
  const emptyDirection = {
    recordedDates: [] as string[],
    completeTradingDates: [] as string[],
    incompleteTradingDates: [] as string[],
    p75ThresholdPct: null,
    evidence: null,
    blockers: [] as string[],
  };
  const emptyGreeks = {
    timingRowCount: 0,
    policyIdentifiedCrosscheckCount: 0,
    legacyOrUnidentifiedCrosscheckCount: 0,
    uniqueGreekPolicyCount: 0,
    evidence: null,
    blockers: [] as string[],
  };
  const safety = {
    readOnly: true as const,
    productionPromotionEligible: false as const,
    affectsSelector: false as const,
    affectsBusinessCard: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    createsOrders: false as const,
    failClosed: true as const,
  };

  if (!dbIsConfigured()) {
    return {
      ok: false,
      version: VERSION,
      mode: "READ_ONLY",
      productionImpact: "NONE",
      evidenceWindowStartsAt,
      evidenceWindowEndsAt,
      direction: { ...emptyDirection, blockers: ["DATABASE_URL_NOT_CONFIGURED"] },
      greeks: { ...emptyGreeks, blockers: ["DATABASE_URL_NOT_CONFIGURED"] },
      evaluation: null,
      blockers: ["DATABASE_URL_NOT_CONFIGURED"],
      safety,
    };
  }

  const blockers: string[] = [];
  const startDate = localDate(evidenceWindowStartsAt);
  const dateIndex = await listH1TheoryRecordedDates();
  const recordedDates = dateIndex.ok
    ? [...new Set(dateIndex.dates
      .filter((row) => row.symbol === "NIFTY" && row.tradeDate >= startDate)
      .map((row) => row.tradeDate))]
      .sort()
    : [];

  if (!dateIndex.ok) blockers.push(dateIndex.reason ?? "DIRECTION_DATE_INDEX_UNAVAILABLE");

  const completeInputs: Array<{ tradeDate: string; replay: H1ReplayHttpResult }> = [];
  const incompleteTradingDates: string[] = [];
  for (const tradeDate of recordedDates) {
    const replay = await runH1ReplayHttp({
      symbol: "NIFTY",
      tradeDate,
      fromTime: "09:15",
      toTime: "15:30",
      scope: "FULL",
    });
    if (replay.ok && replay.continuity?.complete === true) {
      completeInputs.push({ tradeDate, replay });
    } else {
      incompleteTradingDates.push(tradeDate);
    }
  }

  const directionBlockers: string[] = [];
  if (completeInputs.length < POLICY.direction.minimumUntouchedTradingDates) {
    directionBlockers.push("DIRECTION_UNTOUCHED_TRADING_DATES_INSUFFICIENT");
  }

  let directionEvidence: H1DirectionProspectiveEvidence | null = null;
  let p75ThresholdPct: number | null = null;
  if (completeInputs.length >= 2) {
    const research = buildH1DirectionResponseResearch(completeInputs);
    const p75 = research.thresholdOos.candidates.find((candidate) => candidate.label === POLICY.direction.candidateLabel) ?? null;
    p75ThresholdPct = p75?.thresholdPct ?? null;
    if (!research.thresholdOos.evidenceQuality.allIncludedDatesComplete) {
      directionBlockers.push("DIRECTION_REPLAY_QUALITY_INCOMPLETE");
    }
    if (!p75) {
      directionBlockers.push("DIRECTION_P75_OOS_EVIDENCE_UNAVAILABLE");
    } else {
      const built = buildH1ProspectiveDirectionEvidenceV1({
        untouchedTradingDates: completeInputs.length,
        candidateLabel: p75.label,
        calibrationStrictMajorityIntervalRate: p75.calibration.strictMajorityIntervalRate,
        oosRetentionRate: p75.oos.retentionRate,
        oosStrictMajorityIntervalRate: p75.oos.strictMajorityIntervalRate,
        oosMeanSideBalancedAgreementShare: p75.oos.meanSideBalancedAgreementShare,
      });
      directionEvidence = built.evidence;
      directionBlockers.push(...built.blockers);
    }
  } else {
    directionBlockers.push("DIRECTION_P75_OOS_EVIDENCE_UNAVAILABLE");
  }

  const [timingRows, crosscheckRows] = await Promise.all([
    loadPayloadsSince<H1LiveExactGreekTimingRecord>(H1_LIVE_EXACT_GREEK_TIMING_PERSIST_KIND, evidenceWindowStartsAt),
    loadPayloadsSince<H1KiteGreekMathCrosscheckPersistRecord>(H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND, evidenceWindowStartsAt),
  ]);

  if (!timingRows) blockers.push("GREEK_TIMING_DB_READ_FAILED");
  if (!crosscheckRows) blockers.push("GREEK_CROSSCHECK_DB_READ_FAILED");

  const greekBuild = buildH1ProspectiveGreekEvidenceV1(
    timingRows ?? [],
    crosscheckRows ?? [],
    evidenceWindowStartsAt,
  );
  const greekBlockers = [...greekBuild.blockers];
  if (greekBuild.policyIdentifiedCrosscheckCount < POLICY.greeks.minimumUntouchedContractObservations) {
    greekBlockers.push("GREEK_UNTOUCHED_OBSERVATIONS_INSUFFICIENT");
  }

  const direction = {
    recordedDates,
    completeTradingDates: completeInputs.map((row) => row.tradeDate),
    incompleteTradingDates,
    p75ThresholdPct,
    evidence: directionEvidence,
    blockers: [...new Set(directionBlockers)],
  };
  const greeks = {
    timingRowCount: greekBuild.timingRowCount,
    policyIdentifiedCrosscheckCount: greekBuild.policyIdentifiedCrosscheckCount,
    legacyOrUnidentifiedCrosscheckCount: greekBuild.legacyOrUnidentifiedCrosscheckCount,
    uniqueGreekPolicyCount: greekBuild.uniqueGreekPolicyCount,
    evidence: greekBuild.evidence,
    blockers: [...new Set(greekBlockers)],
  };

  let evaluation: H1SelectorProspectiveValidationEvaluation | null = null;
  if (directionEvidence && greekBuild.evidence) {
    const evidence: H1SelectorProspectiveValidationEvidence = {
      evidenceWindowStartsAt,
      evidenceWindowEndsAt,
      direction: directionEvidence,
      greeks: greekBuild.evidence,
    };
    evaluation = evaluateH1SelectorProspectiveValidation(
      POLICY as unknown as H1SelectorProspectiveValidationProtocolInput,
      evidence,
    );
  }

  const allBlockers = [...new Set([
    ...blockers,
    ...direction.blockers,
    ...greeks.blockers,
    ...(evaluation?.blockers ?? []),
  ])];

  return {
    ok: blockers.length === 0,
    version: VERSION,
    mode: "READ_ONLY",
    productionImpact: "NONE",
    evidenceWindowStartsAt,
    evidenceWindowEndsAt,
    direction,
    greeks,
    evaluation,
    blockers: allBlockers,
    safety,
  };
}
