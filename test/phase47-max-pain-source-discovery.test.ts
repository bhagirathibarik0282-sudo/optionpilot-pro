import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const lines = source.split(/\r?\n/);

test("discover exact current Max Pain calculation and call-site semantics", () => {
  const hits: Array<{line:number;text:string[]}> = [];
  for (let i = 0; i < lines.length; i++) {
    if (/maxPain|painAtStrike|totalPain|writerLoss|option pain/i.test(lines[i])) {
      const start = Math.max(0, i - 12);
      const end = Math.min(lines.length, i + 28);
      hits.push({ line: i + 1, text: lines.slice(start, end) });
    }
  }
  console.log("[Phase47MaxPainSource]", JSON.stringify(hits));
  assert.ok(hits.length > 0, "current server must contain Max Pain implementation markers");
  assert.match(source, /maxPain/i);
});
