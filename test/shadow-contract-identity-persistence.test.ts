import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowContractIdentityPersistenceEnvelope,
  loadShadowContractIdentity,
  persistShadowContractIdentity,
  sameShadowContractIdentity,
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
  const io: ShadowContractIdentityPersistenceIo = {
    async insert(_kind, payload) {
      rows.push(payload as ShadowContractIdentityPersistenceEnvelope);
    },
    async loadRecent<T>(_kind, limit) {
      return rows.slice(-limit) as T[];
    },
  };
  return { io, rows };
}

test("builds a fail-closed non-order-authorizing identity envelope", () => {
  const row = buildShadowContractIdentityPersistenceEnvelope(
    "TRADE-1",
    identity,
    "2026-09-01T04:00:00.000Z",
  );
  assert.ok(row);
  assert.equal(row?.tradeId, "TRADE-1");
  assert.equal(row?.authorizesOrder, false);
  assert.equal(row?.brokerOrderAllowed, false);
  assert.equal(row?.placesOrder, false);
  assert.equal(row?.shadowOnly, true);
  assert.equal(row?.failClosed, true);
});

test("rejects invalid identity envelope input", () => {
  const bad = buildShadowContractIdentityPersistenceEnvelope(
    "TRADE-2",
    { ...identity, strike: 0 },
    "2026-09-01T04:00:00.000Z",
  );
  assert.equal(bad, null);
});

test("same identity comparison includes exact option contract and instrument token", () => {
  assert.equal(sameShadowContractIdentity(identity, { ...identity }), true);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, optionType: "PE" }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, strike: 25100 }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, expiry: "2026-09-10" }), false);
  assert.equal(sameShadowContractIdentity(identity, { ...identity, instrumentToken: "DIFFERENT" }), false);
});

test("persists and exactly reads back one contract identity", async () => {
  const { io, rows } = memoryIo();
  const ok = await persistShadowContractIdentity(
    "TRADE-3",
    identity,
    "2026-09-01T04:00:00.000Z",
    io,
  );
  assert.equal(ok, true);
  assert.equal(rows.length, 1);
  const loaded = await loadShadowContractIdentity("TRADE-3", io);
  assert.deepEqual(loaded, identity);
});

test("identical repeat is idempotent and does not create another row", async () => {
  const { io, rows } = memoryIo();
  assert.equal(await persistShadowContractIdentity("TRADE-4", identity, "2026-09-01T04:00:00.000Z", io), true);
  assert.equal(await persistShadowContractIdentity("TRADE-4", identity, "2026-09-01T04:01:00.000Z", io), true);
  assert.equal(rows.length, 1);
});

test("same trade id with conflicting contract identity fails closed", async () => {
  const { io, rows } = memoryIo();
  assert.equal(await persistShadowContractIdentity("TRADE-5", identity, "2026-09-01T04:00:00.000Z", io), true);
  const conflict = { ...identity, strike: 25100 };
  assert.equal(await persistShadowContractIdentity("TRADE-5", conflict, "2026-09-01T04:01:00.000Z", io), false);
  assert.equal(rows.length, 1);
  assert.deepEqual(await loadShadowContractIdentity("TRADE-5", io), identity);
});

test("conflicting durable rows make recovery identity unavailable", async () => {
  const first = buildShadowContractIdentityPersistenceEnvelope("TRADE-6", identity, "2026-09-01T04:00:00.000Z");
  const second = buildShadowContractIdentityPersistenceEnvelope("TRADE-6", { ...identity, optionType: "PE" }, "2026-09-01T04:01:00.000Z");
  assert.ok(first && second);
  const { io } = memoryIo([first!, second!]);
  assert.equal(await loadShadowContractIdentity("TRADE-6", io), null);
});

test("valid row plus corrupt same-trade row taints recovery", async () => {
  const valid = buildShadowContractIdentityPersistenceEnvelope("TRADE-TAINT-1", identity, "2026-09-01T04:00:00.000Z");
  assert.ok(valid);
  const corrupt = { ...valid!, failClosed: false } as unknown as ShadowContractIdentityPersistenceEnvelope;
  const { io } = memoryIo([valid!, corrupt]);
  assert.equal(await loadShadowContractIdentity("TRADE-TAINT-1", io), null);
});

test("corrupt same-trade row blocks idempotent persistence reuse", async () => {
  const valid = buildShadowContractIdentityPersistenceEnvelope("TRADE-TAINT-2", identity, "2026-09-01T04:00:00.000Z");
  assert.ok(valid);
  const corrupt = { ...valid!, persistedAt: "not-a-date" } as ShadowContractIdentityPersistenceEnvelope;
  const { io, rows } = memoryIo([valid!, corrupt]);
  const ok = await persistShadowContractIdentity(
    "TRADE-TAINT-2",
    identity,
    "2026-09-01T04:02:00.000Z",
    io,
  );
  assert.equal(ok, false);
  assert.equal(rows.length, 2);
});

test("invalid row for another trade does not taint target identity", async () => {
  const valid = buildShadowContractIdentityPersistenceEnvelope("TRADE-CLEAN", identity, "2026-09-01T04:00:00.000Z");
  assert.ok(valid);
  const unrelatedCorrupt = { ...valid!, tradeId: "OTHER-TRADE", shadowOnly: false } as unknown as ShadowContractIdentityPersistenceEnvelope;
  const { io } = memoryIo([valid!, unrelatedCorrupt]);
  assert.deepEqual(await loadShadowContractIdentity("TRADE-CLEAN", io), identity);
});

test("persistence IO failure returns false/null instead of guessing", async () => {
  const io: ShadowContractIdentityPersistenceIo = {
    async insert() { throw new Error("db down"); },
    async loadRecent<T>() { throw new Error("db down"); },
  };
  assert.equal(await persistShadowContractIdentity("TRADE-7", identity, "2026-09-01T04:00:00.000Z", io), false);
  assert.equal(await loadShadowContractIdentity("TRADE-7", io), null);
});
