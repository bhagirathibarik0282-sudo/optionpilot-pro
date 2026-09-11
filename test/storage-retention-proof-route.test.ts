import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { mountStorageHealthRoutes } from "../storage-health.js";

test("retention proof route mounts and fails closed read-only without DB", async () => {
  const previousDb = process.env.DATABASE_URL;
  const previousApply = process.env.EOD_RETENTION_APPLY;
  delete process.env.DATABASE_URL;
  process.env.EOD_RETENTION_APPLY = "true";
  try {
    const app = new Hono();
    mountStorageHealthRoutes(app);
    const response = await app.request("/api/storage/retention-proof");
    assert.equal(response.status, 503);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.mode, "READ_ONLY_EOD_RETENTION_PROOF_V1");
    assert.equal(body.productionImpact, "NONE");
    assert.equal(body.deletedTotal, 0);
    assert.equal(body.reason, "DATABASE_URL_NOT_CONFIGURED");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
    if (previousApply === undefined) delete process.env.EOD_RETENTION_APPLY;
    else process.env.EOD_RETENTION_APPLY = previousApply;
  }
});

test("retention proof endpoint source contains no destructive or apply-mode path", () => {
  const source = readFileSync(new URL("../storage-health.ts", import.meta.url), "utf8");
  const marker = 'app.get("/api/storage/retention-proof"';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const routeSource = source.slice(start);
  assert.doesNotMatch(routeSource, /\bDELETE\b/i);
  assert.doesNotMatch(routeSource, /EOD_RETENTION_APPLY/);
  assert.match(routeSource, /deletedTotal:\s*0/);
  assert.match(routeSource, /productionImpact:\s*"NONE"/);
});
