import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../h1-replay-intelligence.ts", import.meta.url), "utf8");

test("replay intelligence is read-only and anti-lookahead by contract", () => {
  assert.match(src, /READ_ONLY_H1_REPLAY_INTELLIGENCE_V1/);
  assert.match(src, /productionImpact:\s*"NONE"/);
  assert.match(src, /affectsVerdict:\s*false/);
  assert.match(src, /affectsTelegram:\s*false/);
  assert.match(src, /affectsExecution:\s*false/);
  assert.match(src, /aiMayOverride:\s*false/);
  assert.match(src, /WHERE trade_date <= \$1::date/);
  assert.match(src, /LOOKAHEAD_REPLAY_ROW_DETECTED/);
  assert.match(src, /LOOKAHEAD_INSTITUTIONAL_ROW_DETECTED/);
});
