import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowBrokerRecoveryFactsEnvelope,
  loadShadowBrokerRecoveryFacts,
  persistShadowBrokerRecoveryFacts,
  type ShadowBrokerRecoveryFactsEnvelope,
  type ShadowBrokerRecoveryFactsIo,
} from "../shadow-broker-recovery-facts-persistence.js";

function memoryIo(seed: ShadowBrokerRecoveryFactsEnvelope[] = []) {
  const rows = [...seed];
  const io: ShadowBrokerRecoveryFactsIo = {
    async insert(_kind, payload) { rows.push(payload as ShadowBrokerRecoveryFactsEnvelope); },
    async loadRecent<T>(_kind, limit) { return rows.slice(-limit) as T[]; },
  };
  return { io, rows };
}

const facts = {
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1" as const,
  state: "ACKNOWLEDGED" as const,
  filledQuantity: 0,
  totalQuantity: 1,
  cancelled: false,
  exactContractBound: true as const,
};

test("builds non-order-authorizing durable broker recovery facts", () => {
  const row = buildShadowBrokerRecoveryFactsEnvelope("EXEC-1", facts, "2026-08-31T08:00:00.000Z");
  assert.ok(row);
  assert.equal(row?.authorizesOrder, false);
  assert.equal(row?.brokerOrderAllowed, false);
  assert.equal(row?.placesOrder, false);
  assert.equal(row?.shadowOnly, true);
  assert.equal(row?.failClosed, true);
});

test("persists and loads exact fresh recovery facts", async () => {
  const { io } = memoryIo();
  assert.equal(await persistShadowBrokerRecoveryFacts("EXEC-2", facts, "2026-08-31T08:00:00.000Z", io), true);
  const loaded = await loadShadowBrokerRecoveryFacts("EXEC-2", "2026-08-31T08:04:00.000Z", 300000, io);
  assert.ok(loaded);
  assert.equal(loaded?.state, "ACKNOWLEDGED");
  assert.equal(loaded?.stateFactsFresh, true);
  assert.equal(loaded?.placesOrder, false);
});

test("stale durable facts are returned explicitly stale instead of fabricated fresh", async () => {
  const { io } = memoryIo();
  assert.equal(await persistShadowBrokerRecoveryFacts("EXEC-3", facts, "2026-08-31T08:00:00.000Z", io), true);
  const loaded = await loadShadowBrokerRecoveryFacts("EXEC-3", "2026-08-31T08:10:00.000Z", 300000, io);
  assert.ok(loaded);
  assert.equal(loaded?.stateFactsFresh, false);
});

test("missing facts never assume zero position", async () => {
  const { io } = memoryIo();
  assert.equal(await loadShadowBrokerRecoveryFacts("MISSING", "2026-08-31T08:00:00.000Z", 300000, io), null);
});

test("partial-fill cancelled facts preserve residual quantities", async () => {
  const { io } = memoryIo();
  const partialCancelled = { ...facts, state: "CANCELLED" as const, filledQuantity: 1, totalQuantity: 3, cancelled: true };
  assert.equal(await persistShadowBrokerRecoveryFacts("EXEC-4", partialCancelled, "2026-08-31T08:00:00.000Z", io), true);
  const loaded = await loadShadowBrokerRecoveryFacts("EXEC-4", "2026-08-31T08:01:00.000Z", 300000, io);
  assert.equal(loaded?.filledQuantity, 1);
  assert.equal(loaded?.totalQuantity, 3);
  assert.equal(loaded?.cancelled, true);
});

test("conflicting same execution facts fail closed and do not overwrite", async () => {
  const first = buildShadowBrokerRecoveryFactsEnvelope("EXEC-5", facts, "2026-08-31T08:00:00.000Z");
  const second = buildShadowBrokerRecoveryFactsEnvelope("EXEC-5", { ...facts, state: "FILLED", filledQuantity: 1 }, "2026-08-31T08:01:00.000Z");
  assert.ok(first && second);
  const { io, rows } = memoryIo([first!]);
  assert.equal(await persistShadowBrokerRecoveryFacts("EXEC-5", { ...facts, state: "FILLED", filledQuantity: 1 }, "2026-08-31T08:01:00.000Z", io), false);
  assert.equal(rows.length, 1);
  const conflicted = memoryIo([first!, second!]);
  assert.equal(await loadShadowBrokerRecoveryFacts("EXEC-5", "2026-08-31T08:02:00.000Z", 300000, conflicted.io), null);
});

test("corrupt same execution claim taints recovery", async () => {
  const valid = buildShadowBrokerRecoveryFactsEnvelope("EXEC-6", facts, "2026-08-31T08:00:00.000Z");
  assert.ok(valid);
  const corrupt = { ...valid!, placesOrder: true } as unknown as ShadowBrokerRecoveryFactsEnvelope;
  const { io } = memoryIo([valid!, corrupt]);
  assert.equal(await loadShadowBrokerRecoveryFacts("EXEC-6", "2026-08-31T08:01:00.000Z", 300000, io), null);
});

test("IO failures fail closed", async () => {
  const io: ShadowBrokerRecoveryFactsIo = {
    async insert() { throw new Error("db down"); },
    async loadRecent<T>() { throw new Error("db down"); },
  };
  assert.equal(await persistShadowBrokerRecoveryFacts("EXEC-7", facts, "2026-08-31T08:00:00.000Z", io), false);
  assert.equal(await loadShadowBrokerRecoveryFacts("EXEC-7", "2026-08-31T08:00:00.000Z", 300000, io), null);
});
