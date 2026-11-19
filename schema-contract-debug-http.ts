import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  EXPECTED_PUBLIC_TABLES,
  SCHEMA_CONTRACT_END,
  SCHEMA_CONTRACT_START,
  readPublicSchemaColumns,
  schemaTableLines,
  type SchemaColumn,
} from "./schema-contract.js";

type DebugEnvironment = { DATABASE_URL?: string; RESEARCH_ADMIN_TOKEN?: string };
type SchemaReader = (connectionString?: string) => Promise<SchemaColumn[]>;

// Hono route is mounted on the always-on supervisor, including outside market hours.
// Bearer authorization uses the existing Railway RESEARCH_ADMIN_TOKEN; no new secret.
export function createSchemaContractDebugApp(
  env: DebugEnvironment = process.env,
  reader: SchemaReader = readPublicSchemaColumns,
): Hono {
  const app = new Hono();
  app.get("/api/debug/schema-contract", async (c) => {
    c.header("Cache-Control", "private, no-store, max-age=0");
    c.header("X-Content-Type-Options", "nosniff");
    const secret = env.RESEARCH_ADMIN_TOKEN?.trim();
    if (!secret) return c.json({ ok: false, reason: "SCHEMA_DEBUG_DISABLED" }, 503);

    const expected = Buffer.from("Bearer " + secret);
    const provided = Buffer.from(c.req.header("authorization") ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json({ ok: false, reason: "UNAUTHORIZED" }, 401);
    }

    try {
      const columns = await reader(env.DATABASE_URL);
      if (!columns.length) throw new Error("EMPTY_SCHEMA");
      const lines = schemaTableLines(columns);
      if (c.req.query("format") === "text") {
        c.header("Content-Type", "text/plain; charset=utf-8");
        return c.body([SCHEMA_CONTRACT_START, ...lines, SCHEMA_CONTRACT_END].join("\n") + "\n");
      }
      return c.json({
        ok: true,
        schema: "public",
        tableCount: lines.length,
        columnCount: columns.length,
        expectedTables: EXPECTED_PUBLIC_TABLES,
        countMatchesExpected: lines.length === EXPECTED_PUBLIC_TABLES,
        columns,
      });
    } catch {
      return c.json({ ok: false, reason: "SCHEMA_QUERY_FAILED" }, 503);
    }
  });
  return app;
}
