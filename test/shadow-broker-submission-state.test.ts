import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShadowBrokerSubmission } from '../shadow-broker-submission-state.ts';

const base = {
  authorizationDecision: 'AUTHORIZE_SIMULATION' as const,
  simulatedSubmissionAccepted: true,
  brokerAcknowledged: true,
  brokerRejected: false,
  filledQuantity: 0,
  totalQuantity: 50,
  cancelled: false,
};

test('blocks when simulation is not authorized', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, authorizationDecision: 'BLOCK' });
  assert.equal(r.state, 'BLOCKED');
});

test('fails closed on invalid total quantity', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, totalQuantity: 0 });
  assert.equal(r.state, 'BLOCKED');
});

test('fails closed when filled exceeds total', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, filledQuantity: 51 });
  assert.equal(r.state, 'BLOCKED');
});

test('fails closed on conflicting acknowledgement and rejection', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, brokerRejected: true });
  assert.equal(r.state, 'BLOCKED');
});

test('tracks awaiting submission', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, simulatedSubmissionAccepted: false, brokerAcknowledged: false });
  assert.equal(r.state, 'AUTHORIZED');
});

test('tracks simulated submission awaiting acknowledgement', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, brokerAcknowledged: false });
  assert.equal(r.state, 'SUBMISSION_SIMULATED');
});

test('tracks acknowledged state', () => {
  const r = evaluateShadowBrokerSubmission(base);
  assert.equal(r.state, 'ACKNOWLEDGED');
});

test('tracks partial fill', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, filledQuantity: 10 });
  assert.equal(r.state, 'PARTIALLY_FILLED');
});

test('tracks full fill', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, filledQuantity: 50 });
  assert.equal(r.state, 'FILLED');
});

test('tracks rejection without acknowledgement conflict', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, brokerAcknowledged: false, brokerRejected: true });
  assert.equal(r.state, 'REJECTED');
});

test('tracks cancellation', () => {
  const r = evaluateShadowBrokerSubmission({ ...base, brokerAcknowledged: false, cancelled: true });
  assert.equal(r.state, 'CANCELLED');
});

test('never places an order', () => {
  const r = evaluateShadowBrokerSubmission(base);
  assert.equal(r.placesOrder, false);
  assert.equal(r.shadowOnly, true);
});
