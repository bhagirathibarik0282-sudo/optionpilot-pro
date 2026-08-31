import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowContractIdentityPersistenceEnvelope,
  loadShadowContractIdentity,
  persistShadowContractIdentity,
  sameShadowContractIdentity,
  SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT,
  SHADOW_CONTRACT_IDENTITY_HISTORY_MAX_SCAN_LIMIT,
  type ShadowContractIdentityPersistenceEnvelope,
  type ShadowContractIdentityPersistenceIo,
} from "../shadow-contract-identity-persistence.js";

const identity = {
  index: "NIFTY" as const,
  optionType: "CE" as const,
  strike: 25000,
  expiry: "2026-09-03",
  instrumentToken: "NIFTY-25000-CE-20260903",
};

function memoryIo(seed: ShadowContractIdentityPersistenceEnvelope[] = []) {
  const rows = [...seed];
  const requestedLimits: number[] = [];
  const io: ShadowContractIdentityPersistenceIo = {
    async insert(_kind, payload) {
      rows.push(payload as ShadowContractIdentityPersistenceEnvelope);
    },
    async loadRecent<T>(_kind, limit) {
      requestedLimits.push(limit);
      return rows.slice(-limit) as T[];
    },
  };
  return { io, rows, requestedLimits };
}

function row(tradeId: string, ts: string, override = {}) {
  const out = buildShadowContractIdentityPersistenceEnvelope(tradeId, { ...identity, ...override }, ts);
  assert.ok(out);
  return out!;
}

test("builds a fail-closed non-order-authorizing identity envelope", () => {
  const out = row("TRADE-1", "2026-09-01T04:00:00.000Z");
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
  assert.equal(out.placesOrder, false);
  assert.equal(out.shadowOnly, true);
  assert.equal(out.failClosed, true);
});

test("rejects invalid identity envelope input", () => {
  assert.equal(
    buildShadowContractIdentityPersistenceEnvelope(
      "TRADE-2",
      { ...identity, strike: 0 },
      "2026-09-01T04:00:00.000Z",
    ),
    null,
  );
});

test("same identity comparison includes exact option contract and token", () => {
  assert.equal(sameShadowContractIdentity(identity, { ...identity }), true);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, optionType: "PE" }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, strike: 25100 }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, expiry: "2026-09-10" }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, instrumentToken: "DIFFERENT" }), false);
});

test("persists and exactly reads back one contract identity", async () => {
  const { io, rows } = memoryIo();
  assert.equal(await persistShadowContractIdentity("TRADE-3", identity, "2026-09-01T04:00:00.000Z", io), true);
  assert.equal(rows.length, 1);
  assert.deepEqual(await loadShadowContractIdentity("TRADE-3", io), identity);
});

test("identical repeat is idempotent", async () => {
  const { io, rows } = memoryIo();
  assert.equal(await persistShadowContractIdentity("TRADE-4", identity, "2026-09-01T04:00:00.000Z", io), true);
  assert.equal(await persistShadowContractIdentity("TRADE-4", identity, "2026-09-01T04:01:00.000Z", io), true);
  assert.equal(rows.length, 1);
});

test("same trade id with conflicting valid identity fails closed", async () => {
  const { io, rows } = memoryIo();
  assert.equal(await persistShadowContractIdentity("TRADE-5", identity, "2026-09-01T04:00:00.000Z", io), true);
  assert.equal(await persistShadowContractIdentity("TRADE-5", { ...identity, strike: 25100 }, "2026-09-01T04:01:00.000Z", io), false);
  assert.equal(rows.length, 1);
});

test("conflicting durable rows make recovery unavailable", async () => {
  const { io } = memoryIo([
    row("TRADE-6", "2026-09-01T04:00:00.000Z"),
    row("TRADE-6", "2026-09-01T04:01:00.000Z", { optionType: "PE" as const }),
  ]);
  assert.equal(await loadShadowContractIdentity("TRADE-6", io), null);
});

test("valid plus corrupt same-trade row taints recovery", async () => {
  const valid = row("TRADE-TAINT-1", "2026-09-01T04:00:00.000Z");
  const corrupt = { ...valid, failClosed: false } as unknown as ShadowContractIdentityPersistenceEnvelope;
  const { io } = memoryIo([valid, corrupt]);
  assert.equal(await loadShadowContractIdentity("TRADE-TAINT-1", io), null);
});

test("corrupt same-trade row blocks idempotent persistence reuse", async () => {
  const valid = row("TRADE-TAINT-2", "2026-09-01T04:00:00.000Z");
  const corrupt = { ...valid, persistedAt: "not-a-date" } as ShadowContractIdentityPersistenceEnvelope;
  const { io, rows } = memoryIo([valid, corrupt]);
  assert.equal(await persistShadowContractIdentity("TRADE-TAINT-2", identity, "2026-09-01T04:02:00.000Z", io), false);
  assert.equal(rows.length, 2);
});

test("invalid row for another trade does not taint target", async () => {
  const valid = row("TRADE-CLEAN", "2026-09-01T04:00:00.000Z");
  const unrelated = { ...valid, tradeId: "OTHER-TRADE", shadowOnly: false } as unknown as ShadowContractIdentityPersistenceEnvelope;
  const { io } = memoryIo([valid, unrelated]);
  assert.deepEqual(await loadShadowContractIdentity("TRADE-CLEAN", io), identity);
});

test("base scan saturation adaptively widens and still recovers exact identity", async () => {
  const rows: ShadowContractIdentityPersistenceEnvelope[] = [];
  for (let i = 0; i < SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT - 1; i += 1) {
    rows.push(row(`OTHER-${i}`, new Date(Date.UTC(2026, 8, 1, 4, 0, i % 60)).toISOString()));
  }
  rows.push(row("TRADE-ADAPTIVE", "2026-09-01T05:00:00.000Z"));
  const { io, requestedLimits } = memoryIo(rows);
  assert.deepEqual(await loadShadowContractIdentity("TRADE-ADAPTIVE", io), identity);
  assert.deepEqual(requestedLimits.slice(0, 2), [1000, 2000]);
});

test("base scan saturation adaptively widens and permits safe idempotent reuse", async () => {
  const rows: ShadowContractIdentityPersistenceEnvelope[] = [];
  for (let i = 0; i < SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT - 1; i += 1) {
    rows.push(row(`OTHER-PERSIST-${i}`, new Date(Date.UTC(2026, 8, 1, 6, 0, i % 60)).toISOString()));
  }
  rows.push(row("TRADE-ADAPTIVE-PERSIST", "2026-09-01T07:00:00.000Z"));
  const { io, rows: stored, requestedLimits } = memoryIo(rows);
  assert.equal(
    await persistShadowContractIdentity("TRADE-ADAPTIVE-PERSIST", identity, "2026-09-01T07:01:00.000Z", io),
    true,
  );
  assert.equal(stored.length, SHADOW_CONTRACT_IDENTITY_HISTORY_SCAN_LIMIT);
  assert.deepEqual(requestedLimits.slice(0, 2), [1000, 2000]);
});

test("adaptive scan still fails closed when maximum safety ceiling is saturated", async () => {
  const rows: ShadowContractIdentityPersistenceEnvelope[] = [];
  for (let i = 0; i < SHADOW_CONTRACT_IDENTITY_HISTORY_MAX_SCAN_LIMIT - 1; i += 1) {
    rows.push(row(`MAX-${i}`, new Date(Date.UTC(2026, 8, 1, 8, 0, i % 60)).toISOString()));
  }
  rows.push(row("TRADE-MAX-SATURATED", "2026-09-01T09:00:00.000Z"));
  const { io, requestedLimits } = memoryIo(rows);
  assert.equal(await loadShadowContractIdentity("TRADE-MAX-SATURATED", io), null);
  assert.deepEqual(requestedLimits, [1000, 2000, 4000]);
});

test("persistence IO failure returns false/null instead of guessing", async () => {
  const io: ShadowContractIdentityPersistenceIo = {
    async insert() { throw new Error("db down"); },
    async loadRecent<T>() { throw new Error("db down"); },
  };
  assert.equal(await persistShadowContractIdentity("TRADE-7", identity, "2026-09-01T04:00:00.000Z", io), false);
  assert.equal(await loadShadowContractIdentity("TRADE-7", io), null);
});
