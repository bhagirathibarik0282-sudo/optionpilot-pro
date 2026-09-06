import assert from "node:assert/strict";
import test from "node:test";
import { prepareCanonicalSelectionStartupBridge } from "../canonical-selection-startup-bridge.js";
import type { CanonicalHeavyweightSectorSelectionResult } from "../canonical-heavyweight-sector-selection-policy.js";

const rows = [
  { instrument_token: 101, tradingsymbol: "HDFCBANK", name: "HDFC BANK", segment: "NSE" },
  { instrument_token: 102, tradingsymbol: "RELIANCE", name: "RELIANCE INDUSTRIES", segment: "NSE" },
];

function selection(): CanonicalHeavyweightSectorSelectionResult {
  return {
    version: "CANONICAL_HEAVYWEIGHT_SECTOR_SELECTION_POLICY_V1",
    ready: true,
    sourceManifestHash: "a".repeat(64),
    requests: [
      { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "FINANCIAL_SERVICES", weight: 12 },
      { parentSymbol: "BANKNIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 28 },
      { parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "OIL_GAS", weight: 9 },
    ],
    scopes: [],
    blockers: [],
    heavyweightMethod: "TOP_K_OFFICIAL_WEIGHT_DESC_SYMBOL_ASC",
    sectorMethod: "ALL_OFFICIAL_CONSTITUENTS",
    readOnly: true,
    deterministic: true,
    infersMembership: false,
    activatesRuntime: false,
    affectsDirection: false,
    affectsVerdict: false,
    grantsCandidateAuthority: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

test("bridges verified selection directly into exact Kite registry", () => {
  const out = prepareCanonicalSelectionStartupBridge(rows, selection());
  assert.equal(out.ready, true);
  assert.equal(out.sourceManifestHash, "a".repeat(64));
  assert.equal(out.requestCount, 3);
  assert.equal(out.registry.length, 3);
  assert.deepEqual(out.registry.filter((entry) => entry.instrumentToken === 101).map((entry) => entry.parentSymbol).sort(), ["BANKNIFTY", "NIFTY"]);
  assert.equal(out.readOnly, true);
  assert.equal(out.shadowOnly, true);
  assert.equal(out.bypassesOwnerJson, true);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.grantsCandidateAuthority, false);
  assert.equal(out.failClosed, true);
});

test("fails closed when deterministic selection is not ready", () => {
  const input = selection();
  input.ready = false;
  input.sourceManifestHash = null;
  input.requests = [];
  const out = prepareCanonicalSelectionStartupBridge(rows, input);
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.deepEqual(out.blockers, ["CANONICAL_SELECTION_STARTUP_SELECTION_NOT_READY"]);
});

test("fails closed if upstream authority boundary is tampered", () => {
  const input = selection();
  Object.assign(input, { affectsTelegram: true });
  const out = prepareCanonicalSelectionStartupBridge(rows, input);
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.deepEqual(out.blockers, ["CANONICAL_SELECTION_STARTUP_AUTHORITY_BOUNDARY_INVALID"]);
});

test("delegates exact Kite identity absence and ambiguity fail-closed", () => {
  const missing = prepareCanonicalSelectionStartupBridge(rows.filter((row) => row.tradingsymbol !== "RELIANCE"), selection());
  assert.equal(missing.ready, false);
  assert.match(missing.blockers[0], /CANONICAL_CONSTITUENT_NOT_UNIQUE:RELIANCE:0/);

  const ambiguousRows = [...rows, { instrument_token: 999, tradingsymbol: "HDFCBANK", name: "DUP", segment: "NSE" }];
  const ambiguous = prepareCanonicalSelectionStartupBridge(ambiguousRows, selection());
  assert.equal(ambiguous.ready, false);
  assert.match(ambiguous.blockers[0], /CANONICAL_CONSTITUENT_NOT_UNIQUE:HDFCBANK:2/);
});
