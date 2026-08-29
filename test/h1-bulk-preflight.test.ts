import test from "node:test";
import assert from "node:assert/strict";
import { evaluate60dBulkPreflight } from "../h1-bulk-preflight.js";

const good = {
  requestedTradingDays: 60,
  foundTradingDays: 60,
  expectedSymbols: 3,
  foundSymbols: 3,
  duplicateLogicalKeys: 0,
  ceRows: 1000,
  peRows: 1000,
  trueRows: 2000,
  partialRows: 0,
  staleRows: 0,
  invalidRows: 0,
  invalidExpiryRows: 0,
  dteMismatchRows: 0,
  outsideSessionRows: 0,
  lookaheadRows: 0,
  runningBlockRows: 0,
};

test("clean 60D preflight is allowed", () => {
  assert.equal(evaluate60dBulkPreflight(good).allowed, true);
});

test("lookahead or running blocks abort import", () => {
  const result = evaluate60dBulkPreflight({ ...good, lookaheadRows: 1, runningBlockRows: 2 });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("LOOKAHEAD_ROWS"));
  assert.ok(result.blockers.includes("RUNNING_BLOCK_ROWS"));
});

test("CE/PE mismatch aborts rather than silently accepting incomplete chain coverage", () => {
  const result = evaluate60dBulkPreflight({ ...good, peRows: 999 });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CE_PE_COUNT_MISMATCH"));
});

test("diagnostic rows warn but do not become research evidence", () => {
  const result = evaluate60dBulkPreflight({ ...good, partialRows: 10 });
  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some((x) => x.includes("DIAGNOSTIC_QUALITY_ROWS_PRESENT")));
});
