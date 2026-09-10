import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("window runtime keeps PPD out of emitted CE premium field and includes 1H/EOD markers",()=>{
  const s=fs.readFileSync("scripts/wire-telegram-window-summary-runtime.mjs","utf8");
  assert.match(s,/'            cePremiumChangePct: null,\\n            pePremiumChangePct: null,'/);
  assert.match(s,/"remove PPD-as-CE mislabel"/);
  assert.match(s,/\[3, 6, 15, 30, 60\]/);
  assert.match(s,/TELEGRAM_WINDOW_SUMMARY/);
  assert.match(s,/TELEGRAM_EOD_BEHAVIOUR/);
  assert.match(s,/istMinuteOfDay >= 931/);
});
