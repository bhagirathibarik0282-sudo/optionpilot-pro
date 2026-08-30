import assert from "node:assert/strict";
import { buildAdaptiveDailyRiskPolicy } from "../adaptive-daily-risk-policy.js";

function run() {
  const strong = buildAdaptiveDailyRiskPolicy({ accountEquity: 50000, baseRiskPct: 2, minRiskPct: 0.5, maxRiskPct: 2, absoluteEmergencyCeiling: 1200, regime: "STRONG", quantumUncertainty: 0.1, recentLossStreak: 0, estimatedDayCosts: 50 });
  assert.equal(strong.valid, true);
  assert.ok(strong.dynamicDailyLoss > 0);
  assert.ok(strong.dynamicDailyLoss <= 1200);

  const uncertain = buildAdaptiveDailyRiskPolicy({ accountEquity: 50000, baseRiskPct: 2, minRiskPct: 0.5, maxRiskPct: 2, absoluteEmergencyCeiling: 1200, regime: "UNCERTAIN", quantumUncertainty: 0.7, recentLossStreak: 1, estimatedDayCosts: 50 });
  assert.equal(uncertain.valid, true);
  assert.ok(uncertain.dynamicDailyLoss < strong.dynamicDailyLoss);

  const stressed = buildAdaptiveDailyRiskPolicy({ accountEquity: 50000, baseRiskPct: 2, minRiskPct: 0.5, maxRiskPct: 2, absoluteEmergencyCeiling: 1200, regime: "STRESSED", quantumUncertainty: 1, recentLossStreak: 4, estimatedDayCosts: 50 });
  assert.equal(stressed.valid, true);
  assert.ok(stressed.dynamicDailyLoss <= uncertain.dynamicDailyLoss);

  const ceiling = buildAdaptiveDailyRiskPolicy({ accountEquity: 500000, baseRiskPct: 2, minRiskPct: 0.5, maxRiskPct: 2, absoluteEmergencyCeiling: 1500, regime: "STRONG", quantumUncertainty: 0, recentLossStreak: 0, estimatedDayCosts: 0 });
  assert.equal(ceiling.dynamicDailyLoss, 1500);

  const invalid = buildAdaptiveDailyRiskPolicy({ accountEquity: -1, baseRiskPct: 2, minRiskPct: 0.5, maxRiskPct: 2, absoluteEmergencyCeiling: 1200, regime: "NORMAL", quantumUncertainty: 0.2, recentLossStreak: 0, estimatedDayCosts: 0 });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.dynamicDailyLoss, 0);

  console.log("adaptive daily risk policy devil tests passed");
}

run();
