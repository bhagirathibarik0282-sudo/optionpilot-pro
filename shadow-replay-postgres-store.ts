import { dbQuerySafe } from "./db.js";
import type {
  ShadowReplayDurableRecord,
  ShadowReplayDurableStore,
} from "./shadow-replay-persistence-adapter.js";

type QueryResult<T> = { rows: T[] };

export type ShadowReplayDbQuery = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<QueryResult<T> | null>;

interface DurableReplayDbRow {
  stable_replay_key: string;
  snapshot_version: string;
  harness_version: string;
  action_state: string;
  final_target: string;
  result_fingerprint: string;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertRecord(record: ShadowReplayDurableRecord): void {
  if (
    !record ||
    !validText(record.stableReplayKey) ||
    record.snapshotVersion !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1" ||
    record.harnessVersion !== "SHADOW_EXECUTION_E2E_HARNESS_V1" ||
    !validText(record.actionState) ||
    !validText(record.finalTarget) ||
    !validText(record.resultFingerprint)
  ) {
    throw new Error("INVALID_SHADOW_REPLAY_DURABLE_RECORD");
  }
}

function normalizeRow(row: DurableReplayDbRow): ShadowReplayDurableRecord {
  if (
    !row ||
    !validText(row.stable_replay_key) ||
    row.snapshot_version !== "EXECUTION_CONSISTENCY_SNAPSHOT_V1" ||
    row.harness_version !== "SHADOW_EXECUTION_E2E_HARNESS_V1" ||
    !validText(row.action_state) ||
    !validText(row.final_target) ||
    !validText(row.result_fingerprint)
  ) {
    throw new Error("INVALID_SHADOW_REPLAY_DURABLE_READBACK");
  }

  return {
    stableReplayKey: row.stable_replay_key,
    snapshotVersion: row.snapshot_version,
    harnessVersion: row.harness_version,
    actionState: row.action_state,
    finalTarget: row.final_target,
    resultFingerprint: row.result_fingerprint,
  };
}

export class PostgresShadowReplayDurableStore implements ShadowReplayDurableStore {
  private schemaReady = false;

  constructor(private readonly query: ShadowReplayDbQuery = dbQuerySafe) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const result = await this.query(`
      CREATE TABLE IF NOT EXISTS shadow_replay_durable_v1 (
        stable_replay_key TEXT PRIMARY KEY,
        snapshot_version TEXT NOT NULL,
        harness_version TEXT NOT NULL,
        action_state TEXT NOT NULL,
        final_target TEXT NOT NULL,
        result_fingerprint TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    if (!result) {
      throw new Error("SHADOW_REPLAY_DURABLE_SCHEMA_UNAVAILABLE");
    }

    this.schemaReady = true;
  }

  async write(record: ShadowReplayDurableRecord): Promise<void> {
    assertRecord(record);
    await this.ensureSchema();

    // Immutable first-write semantics are intentional. A later replay with the
    // same key but changed semantics must NOT overwrite the original evidence;
    // Mission 5B exact read-back will detect the mismatch and fail closed.
    const result = await this.query(
      `
        INSERT INTO shadow_replay_durable_v1 (
          stable_replay_key,
          snapshot_version,
          harness_version,
          action_state,
          final_target,
          result_fingerprint
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (stable_replay_key) DO NOTHING
      `,
      [
        record.stableReplayKey,
        record.snapshotVersion,
        record.harnessVersion,
        record.actionState,
        record.finalTarget,
        record.resultFingerprint,
      ],
    );

    if (!result) {
      throw new Error("SHADOW_REPLAY_DURABLE_WRITE_FAILED");
    }
  }

  async read(stableReplayKey: string): Promise<ShadowReplayDurableRecord | null> {
    if (!validText(stableReplayKey)) {
      throw new Error("INVALID_SHADOW_REPLAY_DURABLE_KEY");
    }

    await this.ensureSchema();

    const result = await this.query<DurableReplayDbRow>(
      `
        SELECT
          stable_replay_key,
          snapshot_version,
          harness_version,
          action_state,
          final_target,
          result_fingerprint
        FROM shadow_replay_durable_v1
        WHERE stable_replay_key = $1
        LIMIT 1
      `,
      [stableReplayKey],
    );

    if (!result) {
      throw new Error("SHADOW_REPLAY_DURABLE_READ_FAILED");
    }

    if (result.rows.length === 0) return null;
    return normalizeRow(result.rows[0]);
  }
}

export function createPostgresShadowReplayDurableStore(
  query: ShadowReplayDbQuery = dbQuerySafe,
): ShadowReplayDurableStore {
  return new PostgresShadowReplayDurableStore(query);
}
