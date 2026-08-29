import test from "node:test";
import assert from "node:assert/strict";
import { decideH1PilotStatus, rowsToCountMap } from "../h1-pilot-audit-core.js";

const good = {
  tradeDate: "2026-08-28",
  marketRowsBySymbol: { NIFTY: 10 },
  optionRowsBySymbol: { NIFTY: 100 },
  chainRowsBySymbol: { NIFTY: 10 },
  researchEligibleCount: 100,
  diagnosticCount: 0,
  duplicateLogicalKeys: 0,
  futureTimestampRows: 0,
  expiryOrDteMismatchRows: 0,
  cePeCountMismatch: 0,
  firstTimestamp: "2026-08-28T03:45:00.000Z",
  lastTimestamp: "2026-08-28T10:00:00.000Z",
};

test("clean one-day pilot passes", () => {
  assert.deepEqual(decideH1PilotStatus(good), { pilotStatus: "PASS", blockers: [] });
});

test("no market data is explicitly NO_DATA", () => {
  assert.deepEqual(decideH1PilotStatus({ ...good, tradeDate: null, marketRowsBySymbol: {} }), {
    pilotStatus: "NO_DATA",
    blockers: ["NO_MARKET_SNAPSHOT_ROWS"],
  });
});

test("structural faults fail closed", () => {
  const result = decideH1PilotStatus({
    ...good,
    duplicateLogicalKeys: 1,
    futureTimestampRows: 2,
    expiryOrDteMismatchRows: 3,
    cePeCountMismatch: 4,
  });
  assert.equal(result.pilotStatus, "FAIL");
  assert.deepEqual(result.blockers, [
    "DUPLICATE_LOGICAL_KEYS",
    "FUTURE_TIMESTAMP_ROWS",
    "EXPIRY_OR_DTE_MISMATCH",
    "CE_PE_COUNT_MISMATCH",
  ]);
});

test("missing normalized option/chain or TRUE rows fails", () => {
  const result = decideH1PilotStatus({
    ...good,
    optionRowsBySymbol: {},
    chainRowsBySymbol: {},
    researchEligibleCount: 0,
  });
  assert.equal(result.pilotStatus, "FAIL");
  assert.deepEqual(result.blockers, ["NO_OPTION_SNAPSHOT_ROWS", "NO_CHAIN_STATE_ROWS", "NO_RESEARCH_ELIGIBLE_OPTION_ROWS"]);
});

test("count map normalizes numeric strings", () => {
  assert.deepEqual(rowsToCountMap([{ symbol: "NIFTY", count: "12" }, { symbol: "SENSEX", count: 3 }]), { NIFTY: 12, SENSEX: 3 });
});
