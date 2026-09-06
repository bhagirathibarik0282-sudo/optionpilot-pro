import test from "node:test";
import assert from "node:assert/strict";
import { buildPracticalFiiDiiContextV2, fetchOfficialFiiDiiApi, mergeFiiDiiHistory, parseOfficialFiiDiiApiPayload } from "../canonical-fii-dii-practical-ingest-v2.ts";
import type { FiiDiiDailyRow } from "../canonical-fii-dii-official-context.ts";

const officialShape = [
  { category:"DII", date:"21-Aug-2026", buyValue:"13209.23", sellValue:"11599.76", netValue:"1609.47" },
  { category:"FII/FPI", date:"21-Aug-2026", buyValue:"11634.11", sellValue:"11769.68", netValue:"-135.57" },
];

test("parses exact official NSE daily API shape without inventing values", () => {
  const r = parseOfficialFiiDiiApiPayload(officialShape);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows.find(x=>x.category==="FII_FPI")?.netCrore, -135.57);
  assert.equal(r.rows.find(x=>x.category==="DII")?.netCrore, 1609.47);
});

test("rejects malformed, incomplete, duplicate and net-mismatch payloads", () => {
  assert.ok(parseOfficialFiiDiiApiPayload([{category:"DII",date:"21-Aug-2026",buyValue:"10",sellValue:"2",netValue:"99"}]).blockers.some(x=>x.includes("NET_MISMATCH")));
  assert.ok(parseOfficialFiiDiiApiPayload([officialShape[0]]).blockers.some(x=>x.includes("INCOMPLETE_SESSION")));
  assert.ok(parseOfficialFiiDiiApiPayload([officialShape[0],officialShape[0],officialShape[1]]).blockers.some(x=>x.includes("DUPLICATE")));
});

test("performs homepage session bootstrap before official API and forwards cookie", async () => {
  const calls: Array<{url:string; init?:RequestInit}> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input); calls.push({url,init});
    if (url.endsWith("nseindia.com/")) return new Response("ok", { status:200, headers:{"set-cookie":"nse_session=abc123; Path=/; HttpOnly"} });
    return new Response(JSON.stringify(officialShape), { status:200, headers:{"content-type":"application/json"} });
  };
  const r = await fetchOfficialFiiDiiApi({retryCount:0}, fakeFetch as typeof fetch);
  assert.equal(r.ok, true); assert.equal(r.rows.length,2); assert.equal(calls.length,2);
  const headers = new Headers(calls[1].init?.headers);
  assert.match(headers.get("cookie") ?? "", /nse_session=abc123/);
  assert.equal(headers.get("referer"), "https://www.nseindia.com/");
});

test("retries full NSE session handshake after rejection and never fabricates", async () => {
  let call = 0;
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    call++;
    if (call === 1) return new Response("blocked", {status:403});
    if (String(input).endsWith("nseindia.com/")) return new Response("ok", {status:200, headers:{"set-cookie":"s=2; Path=/"}});
    return new Response(JSON.stringify(officialShape), {status:200, headers:{"content-type":"application/json"}});
  };
  const r = await fetchOfficialFiiDiiApi({retryCount:1}, fakeFetch as typeof fetch);
  assert.equal(r.ok,true); assert.equal(r.attempts,2); assert.equal(r.rows.length,2);
});

function history(sessions:number): FiiDiiDailyRow[] {
  const rows:FiiDiiDailyRow[]=[];
  for (let i=0;i<sessions;i++) {
    const date=`2026-08-${String(i+1).padStart(2,"0")}`;
    rows.push({date,category:"FII_FPI",buyCrore:100+i,sellCrore:90+i,netCrore:10});
    rows.push({date,category:"DII",buyCrore:200+i,sellCrore:195+i,netCrore:5});
  }
  return rows;
}

test("1D works immediately while 3D/5D/20D remain explicitly not-ready", () => {
  const r=buildPracticalFiiDiiContextV2({history:history(1),asOfDate:"2026-08-01",maxStaleCalendarDays:0});
  assert.equal(r.ready,true);
  assert.equal(r.windows.find(x=>x.window==="1D")?.ready,true);
  assert.equal(r.windows.find(x=>x.window==="20D")?.ready,false);
  assert.ok(r.warnings.some(x=>x.startsWith("FII_DII_WINDOW_NOT_READY:20D")));
  assert.equal(r.estimatesMissingValues,false); assert.equal(r.affectsVerdict,false); assert.equal(r.affectsTelegram,false);
});

test("20D becomes ready only with 20 complete stored sessions", () => {
  const r=buildPracticalFiiDiiContextV2({history:history(20),asOfDate:"2026-08-20",maxStaleCalendarDays:0});
  assert.equal(r.ready,true); assert.equal(r.windows.every(x=>x.ready),true);
  assert.equal(r.windows.find(x=>x.window==="20D")?.fiiNetCrore,200);
  assert.equal(r.windows.find(x=>x.window==="20D")?.diiNetCrore,100);
});

test("history merge is idempotent and conflicting same-session values fail closed", () => {
  const base=history(2); const same=mergeFiiDiiHistory(base,[...base],60);
  assert.deepEqual(same.blockers,[]); assert.equal(same.rows.length,4);
  const changed={...base[0],netCrore:999};
  const bad=mergeFiiDiiHistory(base,[changed],60);
  assert.ok(bad.blockers.some(x=>x.startsWith("FII_DII_HISTORY_CONFLICT"))); assert.equal(bad.rows.length,0);
});

test("future and stale latest sessions fail closed", () => {
  assert.ok(buildPracticalFiiDiiContextV2({history:history(1),asOfDate:"2026-07-31",maxStaleCalendarDays:10}).blockers.includes("FII_DII_FUTURE_SESSION"));
  assert.ok(buildPracticalFiiDiiContextV2({history:history(1),asOfDate:"2026-08-10",maxStaleCalendarDays:2}).blockers.includes("FII_DII_SOURCE_STALE"));
});
