import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("existing Telegram window wiring invokes business watch wiring on runtime start", () => {
  const s = fs.readFileSync("scripts/wire-telegram-window-summary-runtime.mjs", "utf8");
  assert.match(s, /await import\("\.\/wire-telegram-business-watch-v1\.mjs"\)/);
});
