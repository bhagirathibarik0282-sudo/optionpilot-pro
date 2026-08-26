import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const lines = source.split(/\r?\n/);

function windows(pattern: RegExp, radius = 4) {
  const out: Array<{line:number;text:string[]}> = [];
  for (let i=0;i<lines.length;i++) {
    if (!pattern.test(lines[i])) continue;
    out.push({line:i+1,text:lines.slice(Math.max(0,i-radius),Math.min(lines.length,i+radius+1)).map(x=>x.trim())});
  }
  return out;
}

test("discover exact live option instrument-master universe construction anchors", () => {
  const evidence = {
    ceInst: windows(/\bceInst\b/),
    peInst: windows(/\bpeInst\b/),
    optionInstruments: windows(/optionInstruments|optionInst|instrumentsByExpiry|expiryInstruments/i),
    cePush: windows(/expiry\.ceStrikes\.push\(/),
    pePush: windows(/expiry\.peStrikes\.push\(/),
    masterFilter: windows(/instrument_type.*CE|instrument_type.*PE|segment.*OPT|name.*NIFTY|tradingsymbol/i,2).slice(0,80),
  };
  console.log("[Phase46UniverseSourceDiscovery]", JSON.stringify(evidence));
  assert.ok(evidence.cePush.length > 0 && evidence.pePush.length > 0, "live CE/PE snapshot builders must exist");
});
