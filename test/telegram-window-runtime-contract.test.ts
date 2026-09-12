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

test("exact Z-WATCH targets the post-window 15m pulse gate before legacy fallback",()=>{
  const windowSrc=fs.readFileSync("scripts/wire-telegram-window-summary-runtime.mjs","utf8");
  const zSrc=fs.readFileSync("scripts/wire-telegram-z-watch-exact-runtime-v1.mjs","utf8");
  const pulseAnchor='        if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {';
  const legacyAnchor='        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {';
  assert.equal(windowSrc.includes(pulseAnchor),true);
  assert.equal(zSrc.includes(`const pulseAnchor = '${pulseAnchor}';`),true);
  assert.equal(zSrc.includes(`const legacyAnchor = '${legacyAnchor}';`),true);
  assert.match(zSrc,/src\.includes\(pulseAnchor\) \? pulseAnchor : src\.includes\(legacyAnchor\) \? legacyAnchor : null/);
  assert.match(zSrc,/src = src\.replace\(anchor, block \+ anchor\)/);
});
