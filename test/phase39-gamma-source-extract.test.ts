import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function extractFunction(source: string, name: string): string | null {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

test("extract exact live advanced-Greek function for Phase 39 audit", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const fn = extractFunction(server, "calcAdvancedGreeks");
  assert.ok(fn, "calcAdvancedGreeks must exist in current server");
  console.log(`[Phase39AdvancedGreeksSource] ${fn}`);
  assert.ok(/gamma/i.test(fn!));
  assert.ok(/daysToExpiry/i.test(fn!));
});
