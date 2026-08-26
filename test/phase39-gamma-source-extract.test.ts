import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("extract exact live advanced-Greek implementation window for Phase 39 audit", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const lines = server.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("function calcAdvancedGreeks("));
  assert.ok(start >= 0, "calcAdvancedGreeks must exist in current server");
  const window = lines.slice(start, start + 105).map((text, i) => ({ line:start+i+1, text:text.trim() }));
  console.log(`[Phase39AdvancedGreeksWindow] ${JSON.stringify(window)}`);
  const joined = window.map(x => x.text).join(" ");
  assert.ok(/gamma/i.test(joined));
  assert.ok(joined.includes("Math.max(daysToExpiry / 365, 0.0001)"));
  assert.ok(joined.includes("BS_RISK_FREE_RATE"));
});
