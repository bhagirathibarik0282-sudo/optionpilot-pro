import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecutionKillSwitch } from "../execution-kill-switch.ts";

const clear = {
  manualKillSwitch: false,
  dailyHardLossBreached: false,
  marketDataHealthy: true,
  brokerConnectionHealthy: true,
  orderStateKnown: true,
  riskStateHealthy: true,
  hasOpenPosition: false,
};

test("runs only when every safety state is healthy", () => {
  const r = evaluateExecutionKillSwitch(clear);
  assert.equal(r.decision, "RUN");
  assert.equal(r.newEntriesAllowed, true);
  assert.equal(r.emergencyExitRequired, false);
});

test("manual kill blocks new entries", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, manualKillSwitch: true });
  assert.equal(r.decision, "HALT_NEW_ENTRIES");
  assert.ok(r.reasonCodes.includes("MANUAL_KILL_SWITCH_ACTIVE"));
});

test("daily hard loss breach blocks new entries", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, dailyHardLossBreached: true });
  assert.equal(r.newEntriesAllowed, false);
  assert.ok(r.reasonCodes.includes("DAILY_HARD_LOSS_BREACHED"));
});

test("stale or unhealthy market data triggers emergency exit intent when position is open", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, marketDataHealthy: false, hasOpenPosition: true });
  assert.equal(r.decision, "EMERGENCY_EXIT_INTENT");
  assert.equal(r.emergencyExitRequired, true);
});

test("broker disconnect triggers emergency exit intent when position is open", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, brokerConnectionHealthy: false, hasOpenPosition: true });
  assert.equal(r.decision, "EMERGENCY_EXIT_INTENT");
  assert.ok(r.reasonCodes.includes("BROKER_CONNECTION_UNHEALTHY"));
});

test("unknown order state fails closed", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, orderStateKnown: false });
  assert.equal(r.decision, "HALT_NEW_ENTRIES");
  assert.ok(r.reasonCodes.includes("ORDER_STATE_UNKNOWN"));
});

test("risk state corruption fails closed", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, riskStateHealthy: false });
  assert.equal(r.newEntriesAllowed, false);
});

test("kill switch module never places broker order", () => {
  const r = evaluateExecutionKillSwitch({ ...clear, manualKillSwitch: true, hasOpenPosition: true });
  assert.equal(r.brokerOrderPlaced, false);
});
