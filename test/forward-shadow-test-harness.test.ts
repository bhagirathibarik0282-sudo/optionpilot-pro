import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateForwardShadowTest } from '../forward-shadow-test-harness.js';

const good = {
  marketOpen: true,
  liveDataFresh: true,
  brokerSessionHealthy: true,
  candidateReady: true,
  quantumAugmentationReady: true,
  hardRiskGatePassed: true,
  liquidityGatePassed: true,
  idempotencyPassed: true,
  killSwitchClear: true,
};

test('ready only as shadow and never allows broker order', () => {
  const d = evaluateForwardShadowTest(good);
  assert.equal(d.status, 'READY');
  assert.equal(d.shadowOnly, true);
  assert.equal(d.brokerOrderAllowed, false);
  assert.equal(d.recordDecision, true);
});

test('runner path blocks if index-specific runner is required but not ready', () => {
  const d = evaluateForwardShadowTest({ ...good, runnerLogicRequired: true, indexSpecificRunnerReady: false });
  assert.equal(d.status, 'BLOCKED');
  assert.equal(d.reason, 'INDEX_SPECIFIC_RUNNER_NOT_READY');
  assert.equal(d.brokerOrderAllowed, false);
});

test('runner path is verified only when index-specific runner is ready', () => {
  const d = evaluateForwardShadowTest({ ...good, runnerLogicRequired: true, indexSpecificRunnerReady: true });
  assert.equal(d.status, 'READY');
  assert.equal(d.reason, 'FORWARD_SHADOW_SIGNAL_AND_RUNNER_READY');
  assert.equal(d.runnerPathVerified, true);
  assert.equal(d.brokerOrderAllowed, false);
});

test('market closed blocks run', () => assert.equal(evaluateForwardShadowTest({ ...good, marketOpen: false }).reason, 'MARKET_CLOSED'));
test('stale live data blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, liveDataFresh: false }).reason, 'LIVE_DATA_NOT_FRESH'));
test('broker session unhealthy blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, brokerSessionHealthy: false }).reason, 'BROKER_SESSION_UNHEALTHY'));
test('quantum augmentation unavailable blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, quantumAugmentationReady: false }).reason, 'QUANTUM_AUGMENTATION_UNAVAILABLE'));
test('hard risk failure blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, hardRiskGatePassed: false }).reason, 'HARD_RISK_GATE_BLOCK'));
test('liquidity failure blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, liquidityGatePassed: false }).reason, 'LIQUIDITY_GATE_BLOCK'));
test('idempotency failure blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, idempotencyPassed: false }).reason, 'IDEMPOTENCY_BLOCK'));
test('kill switch blocks', () => assert.equal(evaluateForwardShadowTest({ ...good, killSwitchClear: false }).reason, 'KILL_SWITCH_ACTIVE'));
