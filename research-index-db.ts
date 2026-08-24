import { dbQuerySafe } from "./db.js";
import { PostgresResearchIndexStore, type SqlClient, type SqlQueryResult } from "./research-index-store.js";

export const safeResearchDbClient: SqlClient = {
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = await dbQuerySafe<T>(sql, params);
    if (!result) throw new Error("RESEARCH_DB_UNAVAILABLE");
    return result;
  },
};

export const researchIndexStore = new PostgresResearchIndexStore(safeResearchDbClient);
