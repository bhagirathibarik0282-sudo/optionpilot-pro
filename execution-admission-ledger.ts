import { Pool, PoolClient } from "pg";

export const EXECUTION_ADMISSION_LEDGER_V1 = "EXECUTION_ADMISSION_LEDGER_V1" as const;

export type ExclusiveIndexSymbol = "NIFTY" | "SENSEX";
export type ExecutionSymbol = ExclusiveIndexSymbol | "BANKNIFTY";

export interface LockedExecutionCandidate {
  decisionId: string;
  candidateKey: string;
  packetHash: string;
  symbol: ExecutionSymbol;
}

export type AdmissionResult =
  | { admitted: true; code: "ADMITTED" }
  | { admitted: false; code: "DUPLICATE_DECISION" | "INDEX_EXCLUSIVITY_BLOCK"; blockingDecisionId?: string; blockingSymbol?: ExclusiveIndexSymbol };

export interface ExecutionAdmissionLedger {
  ensureSchema(): Promise<void>;
  admit(candidate: LockedExecutionCandidate): Promise<AdmissionResult>;
  markTerminal(decisionId: string): Promise<void>;
}

const EXCLUSIVITY_LOCK_KEY = "OPTIONPILOT_NIFTY_SENSEX_EXECUTION_EXCLUSIVITY_V1";

function requireText(value: string, name: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`INVALID_${name.toUpperCase()}`);
  return normalized;
}

function isExclusiveIndex(symbol: ExecutionSymbol): symbol is ExclusiveIndexSymbol {
  return symbol === "NIFTY" || symbol === "SENSEX";
}

export class PostgresExecutionAdmissionLedger implements ExecutionAdmissionLedger {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS execution_admission_ledger_v1 (
        decision_id TEXT PRIMARY KEY,
        candidate_key TEXT NOT NULL,
        packet_hash TEXT NOT NULL,
        symbol TEXT NOT NULL CHECK (symbol IN ('NIFTY','SENSEX','BANKNIFTY')),
        lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('ACTIVE','TERMINAL')),
        admitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        terminal_at TIMESTAMPTZ NULL
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS execution_admission_ledger_v1_symbol_state_idx
      ON execution_admission_ledger_v1(symbol, lifecycle_state)
    `);
  }

  async admit(candidate: LockedExecutionCandidate): Promise<AdmissionResult> {
    const decisionId = requireText(candidate.decisionId, "decisionId");
    const candidateKey = requireText(candidate.candidateKey, "candidateKey");
    const packetHash = requireText(candidate.packetHash, "packetHash");
    if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(candidate.symbol)) throw new Error("INVALID_SYMBOL");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.takeTransactionLock(client);

      const duplicate = await client.query(
        `SELECT decision_id FROM execution_admission_ledger_v1 WHERE decision_id = $1 LIMIT 1`,
        [decisionId],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return { admitted: false, code: "DUPLICATE_DECISION" };
      }

      if (isExclusiveIndex(candidate.symbol)) {
        const opposite = candidate.symbol === "NIFTY" ? "SENSEX" : "NIFTY";
        const blocker = await client.query(
          `SELECT decision_id, symbol
             FROM execution_admission_ledger_v1
            WHERE lifecycle_state = 'ACTIVE' AND symbol = $1
            ORDER BY admitted_at ASC
            LIMIT 1`,
          [opposite],
        );
        if (blocker.rowCount) {
          await client.query("ROLLBACK");
          return {
            admitted: false,
            code: "INDEX_EXCLUSIVITY_BLOCK",
            blockingDecisionId: blocker.rows[0].decision_id,
            blockingSymbol: blocker.rows[0].symbol,
          };
        }
      }

      await client.query(
        `INSERT INTO execution_admission_ledger_v1
          (decision_id, candidate_key, packet_hash, symbol, lifecycle_state)
         VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [decisionId, candidateKey, packetHash, candidate.symbol],
      );
      await client.query("COMMIT");
      return { admitted: true, code: "ADMITTED" };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async markTerminal(decisionIdInput: string): Promise<void> {
    const decisionId = requireText(decisionIdInput, "decisionId");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.takeTransactionLock(client);
      await client.query(
        `UPDATE execution_admission_ledger_v1
            SET lifecycle_state = 'TERMINAL', terminal_at = COALESCE(terminal_at, NOW())
          WHERE decision_id = $1 AND lifecycle_state = 'ACTIVE'`,
        [decisionId],
      );
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  private async takeTransactionLock(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [EXCLUSIVITY_LOCK_KEY]);
  }
}

export function createExecutionAdmissionLedgerFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresExecutionAdmissionLedger {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED_FOR_DURABLE_EXECUTION_LEDGER");
  return new PostgresExecutionAdmissionLedger(new Pool({ connectionString }));
}
