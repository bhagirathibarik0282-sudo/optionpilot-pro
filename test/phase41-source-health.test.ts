import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyOwnerHealth,
  sourceHealthSql,
  reconstructionHealthSql,
  modelHealthSql,
} from "../source-health-api.js";

const base = {
  freshness_state: "FRESH",
  identity_state: "VALID",
  quality_state: "VALID",
  usability: "USABLE",
  row_count: 10,
  usable_count: 10,
  blocked_count: 0,
};

test("healthy source family requires all latest rows usable and exact", () => {
  assert.equal(classifyOwnerHealth(base), "HEALTHY");
});

test("one blocked latest row blocks the owner family instead of averaging it away", () => {
  assert.equal(classifyOwnerHealth({ ...base, blocked_count: 1, usable_count: 9 }), "BLOCKED");
});

test("unknown source truth is UNKNOWN, never neutral", () => {
  assert.equal(classifyOwnerHealth({ ...base, freshness_state: "UNKNOWN", usable_count: 0 }), "UNKNOWN");
});

test("partial or context-only source truth is DEGRADED", () => {
  assert.equal(classifyOwnerHealth({ ...base, identity_state: "PARTIAL", usability: "CONTEXT_ONLY", usable_count: 0 }), "DEGRADED");
});

test("no rows is explicit NO_DATA", () => {
  assert.equal(classifyOwnerHealth({ ...base, row_count: 0, usable_count: 0 }), "NO_DATA");
});

test("source health query evaluates the latest minute per symbol and family", () => {
  const sql = sourceHealthSql();
  assert.match(sql, /MAX\(minute_bucket\)/);
  assert.match(sql, /GROUP BY symbol, record_kind/);
  assert.match(sql, /source_truth_observation_1m/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE st\.usability = 'BLOCKED'\)/);
});

test("health API exposes reconstruction and model truth companion stores", () => {
  assert.match(reconstructionHealthSql(), /derivative_reconstruction_truth_1m/);
  assert.match(reconstructionHealthSql(), /DISTINCT ON \(symbol, metric\)/);
  assert.match(modelHealthSql(), /option_model_truth_1m/);
  assert.match(modelHealthSql(), /greek_permission/);
});

test("source health route remains read-only shadow-only and cannot affect production decisions", () => {
  const source = readFileSync(new URL("../source-health-api.ts", import.meta.url), "utf8");
  assert.match(source, /\/api\/source-truth\/health/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /shadowOnly: true/);
  assert.match(source, /affectsVerdict: false/);
  assert.match(source, /affectsTelegram: false/);
  assert.match(source, /affectsExecution: false/);
  assert.doesNotMatch(source, /sendTelegramAlert\(/);
  assert.doesNotMatch(source, /placeOrder|executeOrder|STRONG BUY CE|STRONG BUY PE/);
});

test("existing storage health mount includes the new owner source-health route", () => {
  const source = readFileSync(new URL("../storage-health.ts", import.meta.url), "utf8");
  assert.match(source, /mountSourceHealthRoutes\(app\)/);
});
