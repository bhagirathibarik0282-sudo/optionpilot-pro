import test from "node:test";
import assert from "node:assert/strict";
import {
  claimShadowContractIdentityAtomic,
  loadShadowContractIdentityAtomic,
  type ShadowContractIdentityAtomicSqlPort,
} from "../shadow-contract-identity-claim-store.js";
import {
  buildShadowContractIdentityPersistenceEnvelope,
  persistShadowContractIdentity,
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

function memorySql() {
  const rows = new Map<string, unknown>();
  const port: ShadowContractIdentityAtomicSqlPort = {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      if (sql.includes("CREATE TABLE")) return { rows: [] as T[], rowCount: 0 };
      if (sql.includes("INSERT INTO shadow_contract_identity_claim")) {
        const tradeId = String(params[0]);
        if (!rows.has(tradeId)) rows.set(tradeId, JSON.parse(String(params[1])));
        return { rows: [] as T[], rowCount: 1 };
      }
      if (sql.includes("SELECT payload FROM shadow_contract_identity_claim")) {
        const tradeId = String(params[0]);
        const payload = rows.get(tradeId);
        return {
          rows: (payload === undefined ? [] : [{ payload }]) as T[],
          rowCount: payload === undefined ? 0 : 1,
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { port, rows };
}

function envelope(
  tradeId: string,
  override: Partial<typeof identity> = {},
  persistedAt = "2026-09-01T04:00:00.000Z",
) {
  const built = buildShadowContractIdentityPersistenceEnvelope(
    tradeId,
    { ...identity, ...override },
    persistedAt,
  );
  assert.ok(built);
  return built!;
}

test("atomic store keeps the first exact tradeId claim and never overwrites it", async () => {
  const { port, rows } = memorySql();
  const first = envelope("ATOMIC-1");
  const conflict = envelope("ATOMIC-1", { strike: 25100 }, "2026-09-01T04:01:00.000Z");

  const firstResult = await claimShadowContractIdentityAtomic(first, port);
  assert.equal(firstResult.status, "FOUND");
  assert.deepEqual(firstResult.payload, first);

  const conflictResult = await claimShadowContractIdentityAtomic(conflict, port);
  assert.equal(conflictResult.status, "FOUND");
  assert.deepEqual(conflictResult.payload, first);
  assert.equal(rows.size, 1);
});

test("identical repeat reads the original durable winner", async () => {
  const { port } = memorySql();
  const first = envelope("ATOMIC-2");
  const repeat = envelope("ATOMIC-2", {}, "2026-09-01T04:05:00.000Z");

  assert.equal((await claimShadowContractIdentityAtomic(first, port)).status, "FOUND");
  const repeated = await claimShadowContractIdentityAtomic(repeat, port);
  assert.equal(repeated.status, "FOUND");
  assert.deepEqual(repeated.payload, first);
  assert.deepEqual((await loadShadowContractIdentityAtomic("ATOMIC-2", port)).payload, first);
});

test("SQL failure returns UNAVAILABLE instead of inventing identity truth", async () => {
  const failing: ShadowContractIdentityAtomicSqlPort = {
    async query<T>() {
      throw new Error("db unavailable");
    },
  };
  const result = await claimShadowContractIdentityAtomic(envelope("ATOMIC-FAIL"), failing);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.payload, null);
});

test("persistence adapter accepts only the atomic winner for a tradeId", async () => {
  const { port, rows } = memorySql();
  const io: ShadowContractIdentityPersistenceIo = {
    async insert() {
      throw new Error("legacy insert must not be used when atomic claim exists");
    },
    async loadRecent<T>() {
      return [] as T[];
    },
    async atomicClaim(value: ShadowContractIdentityPersistenceEnvelope) {
      return claimShadowContractIdentityAtomic(value, port);
    },
    async atomicLoad(tradeId: string) {
      return loadShadowContractIdentityAtomic(tradeId, port);
    },
  };

  assert.equal(
    await persistShadowContractIdentity("ATOMIC-3", identity, "2026-09-01T04:00:00.000Z", io),
    true,
  );
  assert.equal(
    await persistShadowContractIdentity(
      "ATOMIC-3",
      { ...identity, optionType: "PE" },
      "2026-09-01T04:01:00.000Z",
      io,
    ),
    false,
  );
  assert.equal(rows.size, 1);
});

test("concurrent conflicting claims leave exactly one durable winner", async () => {
  const { port, rows } = memorySql();
  const left = envelope("ATOMIC-RACE", { optionType: "CE" });
  const right = envelope("ATOMIC-RACE", { optionType: "PE" }, "2026-09-01T04:00:01.000Z");

  const [a, b] = await Promise.all([
    claimShadowContractIdentityAtomic(left, port),
    claimShadowContractIdentityAtomic(right, port),
  ]);

  assert.equal(a.status, "FOUND");
  assert.equal(b.status, "FOUND");
  assert.equal(rows.size, 1);
  assert.deepEqual(a.payload, b.payload);
  assert.ok(
    JSON.stringify(a.payload) === JSON.stringify(left) ||
      JSON.stringify(a.payload) === JSON.stringify(right),
  );
});
