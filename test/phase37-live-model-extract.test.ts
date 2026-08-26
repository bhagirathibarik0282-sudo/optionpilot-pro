import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function extractBalancedFunction(source: string, name: string): string | null {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const start = m.index;
  const brace = source.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function compact(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/\s+/g, " ").slice(0, 6000);
}

test("extract exact live IV/Greeks functions and nearby assumptions", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const iv = extractBalancedFunction(source, "calcImpliedVolatility");
  const greeks = extractBalancedFunction(source, "calcGreeks");
  assert.ok(iv, "calcImpliedVolatility must exist");
  assert.ok(greeks, "calcGreeks must exist");

  const assumptionLines = source.split(/\r?\n/).map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({text}) => /(risk.?free|interest.?rate|dividend|yield|365|252|DTE|time.?to.?expiry|calcImpliedVolatility\(|calcGreeks\()/i.test(text))
    .filter(({text}) => text.length > 0)
    .slice(0, 100);

  console.log(`[Phase37IVFunction] ${compact(iv)}`);
  console.log(`[Phase37GreeksFunction] ${compact(greeks)}`);
  console.log(`[Phase37Assumptions] ${JSON.stringify(assumptionLines)}`);
});
