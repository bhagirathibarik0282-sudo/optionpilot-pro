import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function extractBalancedFunction(source: string, name: string): string | null {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const start = m.index;
  const lines = source.slice(start).split(/\r?\n/);
  let bodyStarted = false;
  let depth = 0;
  let collected = "";
  for (const line of lines) {
    collected += line + "\n";
    for (const ch of line) {
      if (ch === "{") { depth++; bodyStarted = true; }
      else if (ch === "}" && bodyStarted) depth--;
    }
    // Return-type object braces can close before the actual body. Require a semicolon/return/body marker too.
    if (bodyStarted && depth === 0 && /\breturn\b|\bconst\b|\blet\b/.test(collected)) return collected.trim();
  }
  return null;
}

function compact(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/\s+/g, " ").slice(0, 9000);
}

test("extract exact live IV/Greeks functions and nearby assumptions", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const iv = extractBalancedFunction(source, "calcImpliedVolatility");
  const greeks = extractBalancedFunction(source, "calcGreeks");
  assert.ok(iv, "calcImpliedVolatility must exist");
  assert.ok(greeks, "calcGreeks must exist");

  const allLines = source.split(/\r?\n/);
  const modelWindow = allLines.slice(5670, 5770).map((text, i) => ({ line: 5671 + i, text: text.trim() }));
  const assumptionLines = allLines.map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({text}) => /(risk.?free|interest.?rate|dividend|yield|365|252|DTE|time.?to.?expiry|calcImpliedVolatility\(|calcGreeks\()/i.test(text))
    .filter(({text}) => text.length > 0)
    .slice(0, 120);

  console.log(`[Phase37IVFunction] ${compact(iv)}`);
  console.log(`[Phase37GreeksFunction] ${compact(greeks)}`);
  console.log(`[Phase37ModelWindow] ${JSON.stringify(modelWindow)}`);
  console.log(`[Phase37Assumptions] ${JSON.stringify(assumptionLines)}`);
});
