import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessCalibrationGate } from "../business-calibration-gate-v1.js";

test("calibration gate fails closed without historical/forward proof", () => {
  const out = buildBusinessCalibrationGate({});
  assert.equal(out.ready, false);
  assert.equal(out.state, "WAIT");
  assert.ok(out.blockers.includes("FORWARD_KPI_PROOF_REQUIRED"));
  assert.ok(out.blockers.includes("OOS_CALIBRATION_REQUIRED"));
  assert.equal(out.productionWeightingAllowed, false);
  assert.equal(out.affectsStars, false);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsExecution, false);
});

test("calibration gate exposes proof but never promotes weights or probabilities", () => {
  const out = buildBusinessCalibrationGate({
    forwardKpis: {
      version:"BUSINESS_FORWARD_KPI_V1",ready:true,sampleCandidateCount:3,completedWindowCount:4,terminalWindow:"T_PLUS_30M",
      candidateKpis:[],bestCandidateKeyByTerminalReturn:"A",bestTerminalReturnPct:12,selectedCandidateKey:"B",
      selectedTerminalReturnPct:8,selectedRank:2,selectedRankPercentile:50,selectionRegretPct:4,blockers:[],
      semantics:"POST_T0_FORWARD_EVIDENCE_ANALYTICS_ONLY",affectsVerdict:false,affectsStars:false,affectsCandidateAuthority:false,
      affectsTelegram:false,affectsExecution:false,createsOrders:false,failClosed:true,
    },
    oos: {
      status:"REGIME_STRENGTH_UNLOCKED",blockers:[],warnings:[],inSampleWinRate:62,outOfSampleWinRate:59,
      degradationPctPoints:3,regimeStrengthMayBeCalibrated:true,probabilityClaimAllowed:false,productionWeightingAllowed:false,
      semantics:"HISTORICAL_OOS_VALIDATION_ONLY",ruleVersion:"H1_OOS_CALIBRATION_GUARD_V1",
    },
  });
  assert.equal(out.ready, true);
  assert.equal(out.state, "CALIBRATED");
  assert.equal(out.forward.selectedTerminalReturnPct, 8);
  assert.equal(out.forward.selectionRegretPct, 4);
  assert.equal(out.oos.outOfSampleWinRate, 59);
  assert.equal(out.probabilityClaimAllowed, false);
  assert.equal(out.productionWeightingAllowed, false);
});
