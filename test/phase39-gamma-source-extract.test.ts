import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("extract exact live advanced-Greek implementation window for Phase 39 audit", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const lines = server.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("function calcAdvancedGreeks("));
  assert.ok(start >= 0, "calcAdvancedGreeks must exist in current server");
  const window = lines.slice(start, start + 105).map((text, i) => ({ line:start+i+1, text:text.trim() }));
  const joined = window.map(x => x.text).join(" ");
  assert.ok(joined.includes("const gamma = nd1 / (spot * sigma * sqrtT)"));
  assert.ok(joined.includes("Math.max(daysToExpiry / 365, 0.0001)"));
  assert.ok(joined.includes("const { vega, theta, delta } = calcGreeks(spot, strike, ivPercent, daysToExpiry, isCall)"));
  assert.ok(joined.includes("BS_RISK_FREE_RATE"));
  console.log(`[Phase39GammaSourceAudit] ${JSON.stringify({startLine:start+1,gammaFormula:true,timeFloor:true,basicGreeksReuse:true})}`);
});

test("current live source has explicit zero-DTE semantic conflict between basic and advanced Greeks", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.ok(server.includes("daysToExpiry <= 0) return { vega: 0, theta: 0, delta: 0 }"));
  assert.ok(server.includes("Math.max(daysToExpiry / 365, 0.0001)"));
});

test("audit current advanced-Greek live call sites without assuming persistence provenance", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const lines = server.split(/\r?\n/);
  const sites = lines.flatMap((line, i) => line.includes("calcAdvancedGreeks(") && !line.includes("function calcAdvancedGreeks(")
    ? [{line:i+1, context:lines.slice(Math.max(0,i-3), Math.min(lines.length,i+5)).map(x=>x.trim())}]
    : []);
  console.log(`[Phase39AdvancedGreekCallSites] ${JSON.stringify(sites)}`);
  assert.ok(sites.length >= 1);
});
