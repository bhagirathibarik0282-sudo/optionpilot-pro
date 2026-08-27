import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function windows(source: string, needle: string, radius = 35) {
  const lines = source.split(/\r?\n/);
  const out: Array<{ line: number; text: string[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    out.push({ line: i + 1, text: lines.slice(Math.max(0, i-radius), Math.min(lines.length, i+radius+1)).map(s => s.trim()) });
  }
  return out;
}

test("discover whether existing every-poll premium diagnostic path can carry KNOWN_THEN score decomposition", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const evidence = {
    clientPoster: windows(source, "postPremiumDiagnosticSnapshot", 45).slice(0, 10),
    diagnosticRoute: windows(source, "/api/premium-diagnostic", 35).slice(0, 10),
    premiumDiagSnapshot: windows(source, "premium diagnostic", 25).slice(0, 20),
  };
  console.log("[Phase50PremiumDiagnosticPath]", JSON.stringify(evidence));
  assert.ok(evidence.clientPoster.length > 0, "expected existing every-poll premium diagnostic poster");
});
