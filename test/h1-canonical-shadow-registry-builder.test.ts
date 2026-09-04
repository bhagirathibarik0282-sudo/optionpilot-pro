import assert from "node:assert/strict";
import test from "node:test";
import { buildH1CanonicalShadowRegistry } from "../h1-canonical-shadow-registry-builder.js";

test("builds canonical registry only from explicit normalized rows", () => {
  const out = buildH1CanonicalShadowRegistry([
    { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
    { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
    { instrumentToken: 222, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-24000-PE", expiry: "2026-09-08", strike: 24000, optionSide: "PE" },
  ]);
  assert.equal(out.ready, true);
  assert.equal(out.entries.length, 3);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.productionImpact, "NONE");
});

test("duplicate token fails closed with no partial registry", () => {
  const out = buildH1CanonicalShadowRegistry([
    { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "A", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
    { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "B", expiry: "2026-09-15", strike: 24000, optionSide: "CE" },
  ]);
  assert.equal(out.ready, false);
  assert.deepEqual(out.entries, []);
  assert.ok(out.blockers.includes("DUPLICATE_INSTRUMENT_TOKEN"));
});

test("invalid option identity fails closed", () => {
  const out = buildH1CanonicalShadowRegistry([
    { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY", expiry: null, strike: 0, optionSide: null },
  ]);
  assert.equal(out.ready, false);
  assert.deepEqual(out.entries, []);
  assert.ok(out.blockers.includes("INVALID_OPTION_IDENTITY"));
});

test("non-option rows cannot carry option identity fields", () => {
  const out = buildH1CanonicalShadowRegistry([
    { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50", strike: 24000 },
    { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
  ]);
  assert.equal(out.ready, false);
  assert.deepEqual(out.entries, []);
  assert.ok(out.blockers.includes("NON_OPTION_IDENTITY_FIELDS_FORBIDDEN"));
});

test("missing rows and registry without options fail closed", () => {
  assert.equal(buildH1CanonicalShadowRegistry([]).ready, false);
  const out = buildH1CanonicalShadowRegistry([
    { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
  ]);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("NO_CANONICAL_OPTION_ENTRIES"));
});
