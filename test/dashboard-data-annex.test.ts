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

test("ONE STOP is the only floating launcher; Theory Lab and Intelligence are accessible from the compact Tools menu", () => {
  const start=source.indexOf("const shortcut = `"),end=source.indexOf("`;",start);
  const shell=source.slice(start,end);
  assert(start>=0&&end>start);
  assert.equal((shell.match(/position:fixed/g)||[]).length,2,"single floating ONE STOP button plus full-screen dialog");
  assert.equal((shell.match(/data-optionpilot-data-annex="true"/g)||[]).length,1);
  assert.match(shell,/⚡ ONE STOP/);
  assert.match(shell,/id="optionpilot-tools-menu"/);
  assert.match(shell,/<nav aria-label="OptionPilot research tools"/);
  assert.match(shell,/data-optionpilot-theory-lab-shortcut="true"/);
  assert.match(shell,/data-optionpilot-intelligence-shortcut="true"/);
  assert.match(shell,/min-height:48px/);
  assert.match(shell,/safe-area-inset-bottom/);
  assert.match(shell,/aria-modal="true"/);
  assert.match(shell,/aria-expanded="false"/);
  assert.match(shell,/if \(tools && tools.open\) tools.open = false/);
});
test("DATA iframe route cannot acquire nested ONE STOP launcher or duplicated navigation",()=>{
 assert.match(source,/c\.req\.path === "\/api\/research\/business-dashboard\/view"/);
 assert.match(source,/html\.includes\("id=\\\"optionpilot-data-annex-open\\\""/);
 assert.match(source,/src="\$\{BUSINESS_DATA_HREF\}"/);
 assert.doesNotMatch(source,/setInterval\(.*optionpilot-data-annex/);
});
