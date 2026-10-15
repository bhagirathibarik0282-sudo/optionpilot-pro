import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openingGapPercent } from "../market-snapshot-semantics.js";

test("opening gap is not the current price's day change", () => {
  assert.ok(Math.abs(openingGapPercent(22671.3, 22622.7)! - 0.21482846875040795) < 1e-10);
  assert.notEqual(openingGapPercent(22671.3, 22622.7), openingGapPercent(22903.8, 22622.7));
  assert.equal(openingGapPercent(100, 100), 0);
  assert.equal(openingGapPercent(99, 100), -1);
});

test("missing/nonfinite/nonpositive opening baselines fail closed", () => {
  for (const bad of [null, undefined, NaN, Infinity, 0, -1]) {
    assert.equal(openingGapPercent(bad, 100), null);
    assert.equal(openingGapPercent(100, bad), null);
  }
});

test("both production adapters use opening gap and Storage does not invent truth", () => {
  for (const file of ["storage-v3-adapter.ts", "h1-recorder-adapter.ts"]) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.match(source, /gapPercent: openingGapPercent\(market.dayOpen, (?:pdc|market.pdcClose)\)/);
  }
  assert.match(readFileSync(new URL("../storage-v3-adapter.ts", import.meta.url), "utf8"), /freshnessStatus: null/);
});
