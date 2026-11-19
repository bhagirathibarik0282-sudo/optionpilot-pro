import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_PUBLIC_TABLES,
  SCHEMA_CONTRACT_END,
  SCHEMA_CONTRACT_START,
  schemaTableLines,
  type SchemaColumn,
} from "../schema-contract.js";
import { createSchemaContractDebugApp } from "../schema-contract-debug-http.js";

// Synthetic metadata only; CI must never connect to production PostgreSQL.
const rows: SchemaColumn[] = [
  { table_name: "sample_alpha", column_name: "id", data_type: "bigint", is_nullable: "NO" },
  { table_name: "sample_alpha", column_name: "note", data_type: "text", is_nullable: "YES" },
  { table_name: "sample_beta", column_name: "observed_at", data_type: "timestamp with time zone", is_nullable: "NO" },
];

test("TBL format contains one complete uncollapsed line per table, in query order", () => {
  assert.deepEqual(schemaTableLines(rows), [
    "TBL|sample_alpha|id:bigint:NO,note:text:YES",
    "TBL|sample_beta|observed_at:timestamp with time zone:NO",
  ]);
  assert.equal(EXPECTED_PUBLIC_TABLES, 22);
});

test("debug route is disabled without an admin secret and rejects incorrect credentials", async () => {
  let queries = 0;
  const read = async () => { queries++; return rows; };
  const disabled = createSchemaContractDebugApp({}, read);
  const unavailable = await disabled.request("http://localhost/api/debug/schema-contract");
  assert.equal(unavailable.status, 503);

  const app = createSchemaContractDebugApp({ RESEARCH_ADMIN_TOKEN: "test-admin-token" }, read);
  const denied = await app.request("http://localhost/api/debug/schema-contract", {
    headers: { Authorization: "Bearer incorrect" },
  });
  assert.equal(denied.status, 401);
  assert.equal(queries, 0);
  assert.equal(denied.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("authorized Hono GET returns all exact column keys and plain-text alternative", async () => {
  const app = createSchemaContractDebugApp(
    { RESEARCH_ADMIN_TOKEN: "test-admin-token", DATABASE_URL: "mock-private-connection" },
    async (url) => { assert.equal(url, "mock-private-connection"); return rows; },
  );
  const headers = { Authorization: "Bearer test-admin-token" };
  const response = await app.request("http://localhost/api/debug/schema-contract", { headers });
  assert.equal(response.status, 200);
  const json = await response.json() as { columns: SchemaColumn[]; tableCount: number; columnCount: number };
  assert.deepEqual(json.columns, rows);
  assert.equal(json.tableCount, 2);
  assert.equal(json.columnCount, 3);

  const textResponse = await app.request("http://localhost/api/debug/schema-contract?format=text", { headers });
  assert.equal(textResponse.status, 200);
  assert.match(textResponse.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(await textResponse.text(), [
    SCHEMA_CONTRACT_START,
    "TBL|sample_alpha|id:bigint:NO,note:text:YES",
    "TBL|sample_beta|observed_at:timestamp with time zone:NO",
    SCHEMA_CONTRACT_END,
    "",
  ].join("\n"));
});
