import pg from "pg";

export type SchemaColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};

export const SCHEMA_CONTRACT_START = "=== SCHEMA_CONTRACT_SECTION_3_START ===";
export const SCHEMA_CONTRACT_END = "=== SCHEMA_CONTRACT_SECTION_3_END ===";
export const EXPECTED_PUBLIC_TABLES = 22;

// SELECT-only; no table creation, migrations, or writes.
const SCHEMA_QUERY = `
  SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
  FROM information_schema.columns AS c
  JOIN information_schema.tables AS t
    ON t.table_catalog = c.table_catalog
   AND t.table_schema = c.table_schema
   AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position
`;

export function schemaTableLines(columns: readonly SchemaColumn[]): string[] {
  const tables = new Map<string, string[]>();
  for (const row of columns) {
    const list = tables.get(row.table_name) ?? [];
    list.push(`${row.column_name}:${row.data_type}:${row.is_nullable}`);
    tables.set(row.table_name, list);
  }
  return [...tables].map(([table, cols]) => `TBL|${table}|${cols.join(",")}`);
}

export async function readPublicSchemaColumns(
  connectionString: string | undefined = process.env.DATABASE_URL,
): Promise<SchemaColumn[]> {
  if (!connectionString?.trim()) throw new Error("DATABASE_URL_MISSING");

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new Error("INVALID_DATABASE_URL");
  }
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!loopback && !hostname.endsWith(".railway.internal")) {
    throw new Error("REFUSED_NON_PRIVATE_DATABASE_HOST");
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    ssl: loopback ? undefined : { rejectUnauthorized: false },
  });
  try {
    const result = await pool.query(SCHEMA_QUERY);
    const rows = result.rows as SchemaColumn[];
    if (!rows.length) throw new Error("NO_PUBLIC_TABLE_COLUMNS");
    return rows;
  } finally {
    await pool.end().catch(() => {});
  }
}
