import assert from "node:assert/strict";
import test from "node:test";
import { PostgresExecutionAdmissionLedger } from "../execution-admission-ledger.ts";

type Row = { decision_id: string; candidate_key: string; packet_hash: string; symbol: string; lifecycle_state: "ACTIVE" | "TERMINAL"; admitted_at: number; terminal_at?: number };

class SharedDb {
  rows: Row[] = [];
  private gate: Promise<void> = Promise.resolve();
  private releaseGate: (() => void) | null = null;

  async lock(): Promise<void> {
    const previous = this.gate;
    this.gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
    await previous;
  }

  unlock(): void {
    this.releaseGate?.();
    this.releaseGate = null;
  }
}

class FakeClient {
  private locked = false;
  constructor(private readonly db: SharedDb) {}

  async query(sql: string, params: unknown[] = []): Promise<any> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "BEGIN") return { rowCount: 0, rows: [] };
    if (normalized === "COMMIT" || normalized === "ROLLBACK") {
      if (this.locked) { this.db.unlock(); this.locked = false; }
      return { rowCount: 0, rows: [] };
    }
    if (normalized.includes("pg_advisory_xact_lock")) {
      await this.db.lock(); this.locked = true; return { rowCount: 1, rows: [{}] };
    }
    if (normalized.startsWith("SELECT decision_id FROM execution_admission_ledger_v1 WHERE decision_id")) {
      const row = this.db.rows.find((r) => r.decision_id === params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (normalized.includes("WHERE lifecycle_state = 'ACTIVE' AND symbol = $1")) {
      const row = this.db.rows.find((r) => r.lifecycle_state === "ACTIVE" && r.symbol === params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (normalized.startsWith("INSERT INTO execution_admission_ledger_v1")) {
      if (this.db.rows.some((r) => r.decision_id === params[0])) throw new Error("duplicate key");
      this.db.rows.push({ decision_id: String(params[0]), candidate_key: String(params[1]), packet_hash: String(params[2]), symbol: String(params[3]), lifecycle_state: "ACTIVE", admitted_at: Date.now() });
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith("UPDATE execution_admission_ledger_v1")) {
      const row = this.db.rows.find((r) => r.decision_id === params[0] && r.lifecycle_state === "ACTIVE");
      if (row) { row.lifecycle_state = "TERMINAL"; row.terminal_at = Date.now(); }
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) return { rowCount: 0, rows: [] };
    throw new Error(`Unhandled SQL: ${normalized}`);
  }

  release(): void {}
}

class FakePool {
  constructor(readonly db = new SharedDb()) {}
  async connect(): Promise<any> { return new FakeClient(this.db); }
  async query(sql: string, params?: unknown[]): Promise<any> { const client = new FakeClient(this.db); return client.query(sql, params); }
}

const candidate = (decisionId: string, symbol: "NIFTY" | "SENSEX") => ({ decisionId, candidateKey: `${symbol}-ATM-CE`, packetHash: `hash-${decisionId}`, symbol });

test("same decision is rejected after ledger object restart", async () => {
  const pool = new FakePool();
  const first = new PostgresExecutionAdmissionLedger(pool as any);
  assert.deepEqual(await first.admit(candidate("d1", "NIFTY")), { admitted: true, code: "ADMITTED" });

  const restarted = new PostgresExecutionAdmissionLedger(pool as any);
  assert.deepEqual(await restarted.admit(candidate("d1", "NIFTY")), { admitted: false, code: "DUPLICATE_DECISION" });
  assert.equal(pool.db.rows.length, 1);
});

test("simultaneous NIFTY and SENSEX admission has exactly one winner", async () => {
  const pool = new FakePool();
  const ledgerA = new PostgresExecutionAdmissionLedger(pool as any);
  const ledgerB = new PostgresExecutionAdmissionLedger(pool as any);
  const [nifty, sensex] = await Promise.all([
    ledgerA.admit(candidate("n1", "NIFTY")),
    ledgerB.admit(candidate("s1", "SENSEX")),
  ]);
  assert.equal([nifty, sensex].filter((x) => x.admitted).length, 1);
  assert.equal([nifty, sensex].filter((x) => !x.admitted && x.code === "INDEX_EXCLUSIVITY_BLOCK").length, 1);
  assert.equal(pool.db.rows.filter((r) => r.lifecycle_state === "ACTIVE").length, 1);
});

test("blocked opposite candidate creates no claim and can enter only after terminal release", async () => {
  const pool = new FakePool();
  const ledger = new PostgresExecutionAdmissionLedger(pool as any);
  assert.equal((await ledger.admit(candidate("n1", "NIFTY"))).admitted, true);
  const blocked = await ledger.admit(candidate("s1", "SENSEX"));
  assert.equal(blocked.admitted, false);
  assert.equal(pool.db.rows.some((r) => r.decision_id === "s1"), false);

  await ledger.markTerminal("n1");
  assert.deepEqual(await ledger.admit(candidate("s1", "SENSEX")), { admitted: true, code: "ADMITTED" });
});
