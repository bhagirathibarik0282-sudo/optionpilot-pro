// Unit tests for fii-dii-import.ts — run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { parseFiiDiiPasteServerSide, normalizeFiiDiiBias } from "../fii-dii-import.js";

test("parses a full well-formed paste block", () => {
  const text = [
    "Date: 2026-08-20",
    "FII Cash: 277.48",
    "DII Cash: 2260.37",
    "Index Futures OI: 13499",
    "Index Futures Bias: Short Covering",
    "Stock Futures OI: -820",
    "Stock Futures Bias: Long Unwinding",
    "Index Options Call OI: 5000",
    "Index Options Call Bias: Long Buildup",
    "Index Options Put OI: -3000",
    "Index Options Put Bias: Short Buildup",
  ].join("\n");

  const result = parseFiiDiiPasteServerSide(text);
  assert.ok(result);
  assert.equal(result.date, "2026-08-20");
  assert.equal(result.fiiCashCr, 277.48);
  assert.equal(result.diiCashCr, 2260.37);
  assert.equal(result.derivatives.length, 4);
  assert.equal(result.derivatives[0].category, "Index Futures");
  assert.equal(result.derivatives[0].oiChange, 13499);
  assert.equal(result.derivatives[0].bias, "Short Covering");
  assert.equal(result.derivatives[1].bias, "Long Unwinding");
});

test("missing Date: line -> date comes back null (caller supplies the fallback, not this pure module)", () => {
  const text = "FII Cash: 100\nDII Cash: 200";
  const result = parseFiiDiiPasteServerSide(text);
  assert.ok(result);
  assert.equal(result.date, null);
});

test("only FII Cash present (no DII Cash) is still recognized -- 'at least one' cash figure, not both required", () => {
  const result = parseFiiDiiPasteServerSide("FII Cash: 50");
  assert.ok(result);
  assert.equal(result.fiiCashCr, 50);
  assert.equal(result.diiCashCr, 0);
});

test("unrecognizable text (no cash figures at all) returns null -- never fabricates a partial entry", () => {
  const result = parseFiiDiiPasteServerSide("Some unrelated Drive file.\nJust random: text");
  assert.equal(result, null);
});

test("empty string returns null", () => {
  assert.equal(parseFiiDiiPasteServerSide(""), null);
});

test("derivative bias missing/unrecognized falls back to Long Buildup, same as the client-side default", () => {
  const text = "FII Cash: 10\nIndex Futures OI: 5\nIndex Futures Bias: garbage";
  const result = parseFiiDiiPasteServerSide(text);
  assert.ok(result);
  assert.equal(result.derivatives[0].bias, "Long Buildup");
});

test("derivative OI missing defaults to 0, not NaN", () => {
  const result = parseFiiDiiPasteServerSide("FII Cash: 10");
  assert.ok(result);
  result.derivatives.forEach((d) => assert.equal(d.oiChange, 0));
});

test("label matching is exact and case-sensitive, mirroring the client-side map -- stray lines are ignored, not guessed at", () => {
  const text = "fii cash: 999\nFII Cash: 10";
  const result = parseFiiDiiPasteServerSide(text);
  assert.ok(result);
  assert.equal(result.fiiCashCr, 10); // only the exact-case label matched
});

test("normalizeFiiDiiBias: recognizes all four canonical values plus short aliases", () => {
  assert.equal(normalizeFiiDiiBias("Long"), "Long Buildup");
  assert.equal(normalizeFiiDiiBias("Short"), "Short Buildup");
  assert.equal(normalizeFiiDiiBias("Long Unwinding"), "Long Unwinding");
  assert.equal(normalizeFiiDiiBias("short covering"), "Short Covering");
  assert.equal(normalizeFiiDiiBias(undefined), null);
  assert.equal(normalizeFiiDiiBias("nonsense"), null);
});

test("all four derivative categories always present in order, even if none were in the pasted text", () => {
  const result = parseFiiDiiPasteServerSide("DII Cash: 1");
  assert.ok(result);
  assert.deepEqual(
    result.derivatives.map((d) => d.category),
    ["Index Futures", "Stock Futures", "Index Options (Call)", "Index Options (Put)"]
  );
});
