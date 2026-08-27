import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const lines = source.split(/\r?\n/);

function windows(pattern: RegExp, radius = 8) {
  const out: Array<{line:number,text:string[]}> = [];
  for (let i=0;i<lines.length;i++) {
    if (!pattern.test(lines[i])) continue;
    out.push({line:i+1,text:lines.slice(Math.max(0,i-radius),Math.min(lines.length,i+radius+1)).map(x=>x.trim())});
  }
  return out;
}

test("discover exact live option instrument-master universe construction anchors", () => {
  const evidence = {
    fastChainFunction: windows(/function .*OptionChain|async function .*OptionChain|OptionChainStats/,5).slice(0,30),
    optionMap: windows(/const optionMap|optionMap =|allInstruments = Array\.from\(optionMap\.values\(\)\)/,12),
    fastReturn: windows(/fullChainPcr|bandStrikes/,10).filter(x=>x.line>=5100 && x.line<=5400),
    fastAssignments: windows(/\.fullChainPcr|\.oiPcr|\.volumePcr|\.maxPain|baseMetrics\.pcr/,8).filter(x=>x.line>=6200 && x.line<=7100),
    expiryLoop: windows(/Fetching \$\{expiryName\} options/,15),
    snapshotExpiryShape: windows(/expiries:/,6).filter(x=>x.line<1000),
    cePush: windows(/expiry\.ceStrikes\.push\(/,5),
    pePush: windows(/expiry\.peStrikes\.push\(/,5),
  };
  console.log("[Phase46UniverseWiringDiscovery]", JSON.stringify(evidence));
  assert.ok(evidence.optionMap.length > 0, "complete-expiry instrument-master optionMap must exist");
  assert.ok(evidence.cePush.length > 0 && evidence.pePush.length > 0, "live CE/PE snapshot builders must exist");
});
