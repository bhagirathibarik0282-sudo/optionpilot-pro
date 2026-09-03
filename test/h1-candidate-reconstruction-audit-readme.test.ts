import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("reconstruction audit documentation states no selector inference", () => {
  const text = readFileSync("README.h1-candidate-reconstruction-audit.md", "utf8");
  assert.match(text, /must not infer execution-selector qualification/i);
  assert.match(text, /No verdict, Telegram, execution, order, AI, profit, or edge authority/i);
});
