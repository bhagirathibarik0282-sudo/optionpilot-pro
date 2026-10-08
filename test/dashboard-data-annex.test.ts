import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../research-server-hook.ts", import.meta.url), "utf8");

test("same-page DATA annex reuses the existing read-only observation terminal", () => {
  assert.match(source, /OPTIONPILOT_DATA_ANNEX_V1/);
  assert.match(source, /const BUSINESS_DATA_HREF = "\/api\/research\/business-dashboard\/view\?symbol=NIFTY";/);
  assert.match(source, /id="optionpilot-data-annex-open"/);
  assert.match(source, /id="optionpilot-data-annex-shell"/);
  assert.match(source, /id="optionpilot-data-annex-frame"/);
  assert.match(source, /src="\$\{BUSINESS_DATA_HREF\}"/);
  assert.match(source, /id="optionpilot-data-annex-close"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("annex preserves the existing research shortcuts and adds no new data authority", () => {
  assert.match(source, /data-optionpilot-theory-lab-shortcut="true"/);
  assert.match(source, /data-optionpilot-intelligence-shortcut="true"/);
  assert.doesNotMatch(source, /optionpilot-data-annex[^\n]*(POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /DATA_ANNEX_(SELECTOR|ORDER|TELEGRAM|DATABASE)/);
});
