import pg from "pg";

type SchemaColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};

const START = "=== SCHEMA_CONTRACT_SECTION_3_START ===";
const END = "=== SCHEMA_CONTRACT_SECTION_3_END ===";

async function dumpSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("[SCHEMA_DUMP] DATABASE_URL_MISSING");
    process.exitCode = 1;
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    console.error("[SCHEMA_DUMP] INVALID_DATABASE_URL");
    process.exitCode = 1;
    return;
  }

  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!loopback && !hostname.endsWith(".railway.internal")) {
    console.error("[SCHEMA_DUMP] REFUSED_NON_PRIVATE_DATABASE_HOST");
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    ssl: loopback ? undefined : { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(
      "SELECT c.table_name, c.column_name, c.data_type, c.is_nullable " +
      "FROM information_schema.columns AS c " +
      "JOIN information_schema.tables AS t " +
      "ON t.table_catalog = c.table_catalog " +
      "AND t.table_schema = c.table_schema " +
      "AND t.table_name = c.table_name " +
      "WHERE c.table_schema = 'public' " +
      "AND t.table_type = 'BASE TABLE' " +
      "ORDER BY c.table_name, c.ordinal_position"
    );
    const rows = result.rows as SchemaColumn[];
    if (rows.length === 0) throw new Error("NO_PUBLIC_TABLE_COLUMNS");

    const tableCount = new Set(rows.map((row) => row.table_name)).size;
    console.log(START);
    for (const row of rows) {
      console.log(JSON.stringify({
        table_name: row.table_name,
        column_name: row.column_name,
        data_type: row.data_type,
        is_nullable: row.is_nullable,
      }));
    }
    console.log(END);
    console.log("[SCHEMA_DUMP] public_tables=" + tableCount +
      " columns=" + rows.length + " expected_tables=22");
    if (tableCount !== 22) process.exitCode = 2;
  } catch (error) {
    // Do not log connection strings, SQL parameters, or driver stack traces.
    const reason = error instanceof Error && error.message === "NO_PUBLIC_TABLE_COLUMNS"
      ? "NO_PUBLIC_TABLE_COLUMNS" : "DATABASE_QUERY_FAILED";
    console.error("[SCHEMA_DUMP] " + reason);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

void dumpSchema();
