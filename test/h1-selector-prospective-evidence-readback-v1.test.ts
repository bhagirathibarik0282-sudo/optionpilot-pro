import test from "node:test";
import assert from "node:assert/strict";
import {
  buildH1ProspectiveDirectionEvidenceV1,
  buildH1ProspectiveGreekEvidenceV1,
} from "../h1-selector-prospective-evidence-readback-v1.js";
import type { H1LiveExactGreekTimingRecord } from "../h1-live-exact-raw-evidence-store.js";
import type { H1KiteGreekMathCrosscheckPersistRecord } from "../h1-kite-greek-math-crosscheck.js";

const START = "2026-09-22T03:45:00.000Z";

function timing(
  token: number,
  minute: string,
  optionAgeMsAtReceive: number,
  underlyingAgeMsAtOptionReceive: number,
  underlyingSkewMs: number,
): H1LiveExactGreekTimingRecord {
  return {
    version: "H1_LIVE_EXACT_GREEK_TIMING_1M_V1",
    logicalKey: `${minute}|${token}`,
    minuteBucket: minute,
    instrumentToken: token,
    symbol: "NIFTY",
    expiry: "2026-09-22",
    strike: 23400,
    optionSide: "CE",
    optionObservedAt: minute,
    optionReceivedAt: minute,
    underlyingInstrumentToken: 256265,
    underlyingObservedAt: minute,
    underlyingReceivedAt: minute,
    optionAgeMsAtReceive,
    underlyingAgeMsAtOptionReceive,
    underlyingSkewMs,
    optionFutureAtReceive: false,
    underlyingFutureAtOptionReceive: false,
    underlyingReceivedAfterOptionReceive: false,
    source: "KITE_WEBSOCKET_FULL",
    provenance: "LIVE_RUNTIME_EXACT",
    thresholdAuthority: "NONE",
    observationalOnly: true,
    affectsSelector: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    createsOrders: false,
  };
}

function crosscheck(
  token: number,
  minute: string,
  deltaError: number,
  gammaError: number,
  ivError: number,
  maxAgeMs = 5_000,
): H1KiteGreekMathCrosscheckPersistRecord {
  return {
    version: "H1_KITE_GREEK_MATH_CROSSCHECK_1M_V2",
    logicalKey: `${minute}|${token}`,
    minuteBucket: minute,
    instrumentToken: token,
    snapshot: {} as H1KiteGreekMathCrosscheckPersistRecord["snapshot"],
    underlying: {} as H1KiteGreekMathCrosscheckPersistRecord["underlying"],
    selectorDirectionAtCapture: null,
    expectedPremiumDirectionAtCapture: null,
    directionSourceId: null,
    policyIdentity: {
      version: "H1_KITE_GREEK_EVIDENCE_POLICY_IDENTITY_V1",
      greekPolicy: {
        annualRiskFreeRate: 0.05,
        annualDividendYield: 0,
        maxAgeMs,
        maxUnderlyingSkewMs: 2_000,
      },
      directionSourcePolicy: null,
      greekPolicySemantics: "SHADOW_CALIBRATION_ONLY",
      directionSourcePolicySemantics: null,
      referenceImplementationVersion: "H1_KITE_GREEK_MATH_CROSSCHECK_V2",
      prospectiveP75Bound: false,
      productionPolicyBound: false,
    },
    evidence: {
      version: "H1_KITE_GREEK_MATH_CROSSCHECK_V2",
      ready: true,
      symbol: "NIFTY",
      expiryDate: "2026-09-22",
      strike: 23400,
      side: "CE",
      observedAt: minute,
      underlyingObservedAt: minute,
      underlyingSkewMs: 500,
      absoluteDeltaError: deltaError,
      absoluteGammaError: gammaError,
      absoluteIvErrorPctPoints: ivError,
      numericalDelta: 0.5,
      numericalGamma: 0.001,
      independentIvPct: 12,
      blockers: [],
      source: "KITE_WEBSOCKET_FULL_PLUS_INTERNAL_MATH_CROSSCHECK",
      productionImpact: "NONE",
      thresholdAuthority: "NONE",
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
    productionImpact: "NONE",
    thresholdAuthority: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

test("builds frozen-label direction evidence and positive degradation only", () => {
  const out = buildH1ProspectiveDirectionEvidenceV1({
    untouchedTradingDates: 10,
    candidateLabel: "P75",
    calibrationStrictMajorityIntervalRate: 0.9,
    oosRetentionRate: 0.3,
    oosStrictMajorityIntervalRate: 0.8,
    oosMeanSideBalancedAgreementShare: 0.75,
  });
  assert.ok(out.evidence);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.evidence.candidateLabel, "P75");
  assert.ok(Math.abs(out.evidence.calibrationToOosStrictMajorityDrop - 0.1) < 1e-12);

  const improved = buildH1ProspectiveDirectionEvidenceV1({
    untouchedTradingDates: 10,
    candidateLabel: "P75",
    calibrationStrictMajorityIntervalRate: 0.8,
    oosRetentionRate: 0.3,
    oosStrictMajorityIntervalRate: 0.9,
    oosMeanSideBalancedAgreementShare: 0.75,
  });
  assert.equal(improved.evidence?.calibrationToOosStrictMajorityDrop, 0);
});

test("fails closed when direction candidate label is not frozen P75", () => {
  const out = buildH1ProspectiveDirectionEvidenceV1({
    untouchedTradingDates: 10,
    candidateLabel: "P50",
    calibrationStrictMajorityIntervalRate: 0.9,
    oosRetentionRate: 0.3,
    oosStrictMajorityIntervalRate: 0.8,
    oosMeanSideBalancedAgreementShare: 0.75,
  });
  assert.equal(out.evidence, null);
  assert.ok(out.blockers.includes("DIRECTION_P75_CANDIDATE_REQUIRED"));
});

test("assembles raw timing and policy-identified Greek math as separate untouched streams", () => {
  const rows = [
    timing(1, "2026-09-22T06:31:00.000Z", 1_000, 1_200, 500),
    timing(2, "2026-09-22T06:32:00.000Z", 6_000, 1_000, 3_000),
  ];
  const cross = [
    crosscheck(1, "2026-09-22T06:31:00.000Z", 0.01, 0.0001, 0.5),
    crosscheck(2, "2026-09-22T06:32:00.000Z", 0.015, 0.0002, 0.75),
    { ...crosscheck(3, "2026-09-22T06:33:00.000Z", 0.01, 0.0001, 0.5), policyIdentity: undefined } as unknown as H1KiteGreekMathCrosscheckPersistRecord,
  ];

  const out = buildH1ProspectiveGreekEvidenceV1(rows, cross, START);
  assert.ok(out.evidence);
  assert.equal(out.timingRowCount, 2);
  assert.equal(out.policyIdentifiedCrosscheckCount, 2);
  assert.equal(out.legacyOrUnidentifiedCrosscheckCount, 1);
  assert.equal(out.evidence.untouchedContractObservations, 2);
  assert.equal(out.evidence.timingPassRate, 0.5);
  assert.equal(out.evidence.underlyingSkewPassRate, 0.5);
  assert.equal(out.evidence.deltaModelPassRate, 1);
  assert.equal(out.evidence.gammaModelPassRate, 1);
  assert.equal(out.evidence.ivModelPassRate, 1);
  assert.equal(out.evidence.maximumAbsoluteDeltaErrorObserved, 0.015);
  assert.equal(out.evidence.maximumAbsoluteGammaErrorObserved, 0.0002);
  assert.equal(out.evidence.maximumAbsoluteIvErrorObserved, 0.75);
  assert.ok(out.worstGammaObservation);
  assert.equal(out.worstGammaObservation.instrumentToken, 2);
  assert.equal(out.worstGammaObservation.minuteBucket, "2026-09-22T06:32:00.000Z");
  assert.equal(out.worstGammaObservation.absoluteGammaError, 0.0002);
  assert.equal(out.worstGammaObservation.referenceImplementationVersion, "H1_KITE_GREEK_MATH_CROSSCHECK_V2");
});

test("fails closed on mixed Greek policy identity", () => {
  const rows = [timing(1, "2026-09-22T06:31:00.000Z", 1_000, 1_000, 500)];
  const cross = [
    crosscheck(1, "2026-09-22T06:31:00.000Z", 0.01, 0.0001, 0.5),
    crosscheck(2, "2026-09-22T06:32:00.000Z", 0.01, 0.0001, 0.5, 4_000),
  ];
  const out = buildH1ProspectiveGreekEvidenceV1(rows, cross, START);
  assert.ok(out.blockers.includes("MIXED_GREEK_POLICY_IDENTITY_FORBIDDEN"));
  assert.ok(out.blockers.includes("GREEK_POLICY_TIMING_LIMIT_IDENTITY_MISMATCH"));
});
