import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";

const asOfMs = Date.parse("2026-09-05T10:30:00.000Z");
const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

function verifiedComponents(): CanonicalMarketComponent[] {
  return families.map((family) => ({
    family,
    status: "VERIFIED" as const,
    observedAtMs: asOfMs - 5_000,
    source: `verified:${family}`,
    payload: { family },
  }));
}

test("all required verified families share one roof and become filter-ready", () => {
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "NIFTY-20260905-103000",
    symbol: "NIFTY",
    asOfMs,
    minuteClosed: false,
    components: verifiedComponents(),
  });
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, true);
  assert.equal(result.userFacingState, "READY_FOR_BUYER_SELLER_FILTER");
  assert.equal(result.internalBlockers.length, 0);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.aiMayOverride, false);
});

test("heavyweight family is mandatory for strict filtering but observation remains recordable", () => {
  const components = verifiedComponents().filter((x) => x.family !== "HEAVYWEIGHTS");
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "BANKNIFTY-20260905-103000",
    symbol: "BANKNIFTY",
    asOfMs,
    minuteClosed: false,
    components,
  });
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.userFacingState, "WAIT_FOR_CONFIRMATION");
  assert.ok(result.internalBlockers.includes("HEAVYWEIGHTS:MISSING"));
});

test("closed minute becomes immutable record", () => {
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "SENSEX-20260905-103000-CLOSE",
    symbol: "SENSEX",
    asOfMs,
    minuteClosed: true,
    components: verifiedComponents(),
  });
  assert.equal(result.recordable, true);
  assert.equal(result.immutableRecord, true);
});

test("pending or devil-flagged family blocks filtering without erasing the snapshot", () => {
  const components = verifiedComponents();
  components[2] = { ...components[2], status: "PENDING" };
  components[6] = { ...components[6], devilFlags: ["constituent timestamp skew"] };
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "NIFTY-20260905-103001",
    symbol: "NIFTY",
    asOfMs,
    minuteClosed: false,
    components,
  });
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("OPTION_PREMIUMS:NOT_VERIFIED"));
  assert.ok(result.internalBlockers.includes("HEAVYWEIGHTS:DEVIL_CHECK_BLOCKED"));
});

test("component outside allowed snapshot window cannot influence strict filter", () => {
  const components = verifiedComponents();
  components[0] = { ...components[0], observedAtMs: asOfMs - 120_000 };
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "NIFTY-20260905-103002",
    symbol: "NIFTY",
    asOfMs,
    minuteClosed: false,
    maxComponentAgeMs: 90_000,
    components,
  });
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("MARKET_STRUCTURE:OUTSIDE_SNAPSHOT_WINDOW"));
});

test("invalid root identity is not recordable and never filter-ready", () => {
  const result = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "",
    symbol: "NIFTY",
    asOfMs: Number.NaN,
    minuteClosed: true,
    components: verifiedComponents(),
  });
  assert.equal(result.recordable, false);
  assert.equal(result.immutableRecord, false);
  assert.equal(result.readyForStrictFiltering, false);
});
