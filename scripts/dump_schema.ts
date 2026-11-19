import {
  EXPECTED_PUBLIC_TABLES,
  SCHEMA_CONTRACT_START,
  SCHEMA_CONTRACT_END,
  readPublicSchemaColumns,
  schemaTableLines,
} from "../schema-contract.js";

async function dumpSchema(): Promise<void> {
  try {
    const columns = await readPublicSchemaColumns();
    const tableLines = schemaTableLines(columns);
    console.log(SCHEMA_CONTRACT_START);
    // Railway preserves these as plain-text log entries, one line per table.
    for (const line of tableLines) process.stdout.write(line + "\n");
    console.log(SCHEMA_CONTRACT_END);
    console.log(`[SCHEMA_DUMP] public_tables=${tableLines.length} columns=${columns.length} expected_tables=${EXPECTED_PUBLIC_TABLES}`);
    if (tableLines.length !== EXPECTED_PUBLIC_TABLES) process.exitCode = 2;
  } catch (error) {
    // Never print a connection string, SQL parameters, or driver stack traces.
    const knownReasons = new Set([
      "DATABASE_URL_MISSING", "INVALID_DATABASE_URL", "REFUSED_NON_PRIVATE_DATABASE_HOST", "NO_PUBLIC_TABLE_COLUMNS",
    ]);
    const raw = error instanceof Error ? error.message : "";
    console.error("[SCHEMA_DUMP] " + (knownReasons.has(raw) ? raw : "DATABASE_QUERY_FAILED"));
    process.exitCode = 1;
  }
}

void dumpSchema();
