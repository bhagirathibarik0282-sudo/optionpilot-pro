import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function windows(source: string, needle: string, radius = 55) {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((line, i) => line.includes(needle) ? [{
    line: i + 1,
    text: lines.slice(Math.max(0, i-radius), Math.min(lines.length, i+radius+1)).map(s => s.trim()),
  }] : []);
}

test("extract exact premium diagnostic route implementation before Phase 50 persistence wiring", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const route = windows(source, 'app.post("/api/v2/premium-diagnostic-snapshot"', 70);
  const routeSingle = windows(source, "app.post('/api/v2/premium-diagnostic-snapshot'", 70);
  const evidence = route.concat(routeSingle);
  console.log("[Phase50PremiumDiagnosticRouteAudit]", JSON.stringify(evidence));
  assert.equal(evidence.length, 1, `expected exactly one premium diagnostic POST route, saw ${evidence.length}`);
});
