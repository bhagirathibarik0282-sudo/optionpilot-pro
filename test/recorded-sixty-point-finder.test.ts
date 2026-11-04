import test from 'node:test';
import assert from 'node:assert/strict';
import {scanRecordedSixtyPointMoves} from '../recorded-sixty-point-finder.js';

const base='2026-11-04',expiry='2026-11-09',symbol='NIFTY';
const at=(time:string)=>base+'T'+time+':00+05:30';
function session(prices:Array<[string,number]>,changes:any={}){
 const market=prices.map(([time],i)=>({symbol,minute_bucket:at(time),truth_verdict:'TRUE',
  snapshot_id:'s'+i,backend_timestamp:base+'T'+time+':24+05:30'}));
 const options=prices.map(([time,ltp],i)=>({symbol,minute_bucket:at(time),truth_verdict:'TRUE',
  expiry,strike:23900,option_type:'CE',ltp,snapshot_id:'s'+i,quote_timestamp:base+'T'+time+':10+05:30'}));
 return {symbol,date:base,cadenceMinutes:1,market,options,...changes};
}
test('exact same contract saved LTPs report observed rises and falls, not candle highs',()=>{
 const result=scanRecordedSixtyPointMoves(session([['09:15',110],['09:16',175],['09:17',90],['09:18',160]]));
 assert.equal(result.events.length,2);
 const rise=result.events.find(e=>e.direction==='RISE')!;
 assert.equal(rise.points,70);assert.equal(rise.fromPrice,90);assert.equal(rise.toPrice,160);
 assert.equal(rise.firstThresholdAt,at('09:16'));
 const fall=result.events.find(e=>e.direction==='FALL')!;
 assert.equal(fall.points,85);assert.equal(fall.fromAt,at('09:16'));assert.equal(fall.toAt,at('09:17'));
});
test('no fabricated moves from missing market receipt, stale quote or mismatched snapshot',()=>{
 const s=session([['09:15',100],['09:16',180]]);
 s.options[1].snapshot_id='not-the-same';
 assert.equal(scanRecordedSixtyPointMoves(s).events.length,0);
 s.options[1].snapshot_id='s1';s.options[1].quote_timestamp=base+'T09:15:01+05:30';
 assert.equal(scanRecordedSixtyPointMoves(s).events.length,0);
 s.options[1].quote_timestamp=at('09:16');
 assert.equal(scanRecordedSixtyPointMoves(s).events.length,1);
});
test('different days, expiries, strikes and sides are never stitched into 60-point moves',()=>{
 const s=session([['09:15',100],['09:16',170]]);
 s.options[1].option_type='PE';assert.equal(scanRecordedSixtyPointMoves(s).events.length,0);
 s.options[1].option_type='CE';s.options[1].strike=24000;assert.equal(scanRecordedSixtyPointMoves(s).events.length,0);
 s.options[1].strike=23900;s.options[1].expiry='2026-11-16';assert.equal(scanRecordedSixtyPointMoves(s).events.length,0);
});
test('conflicting duplicate recorded contract minutes are rejected, not arbitrarily chosen',()=>{
 const s=session([['09:15',100],['09:16',180]]);
 s.options.push({...s.options[1],ltp:181});
 const r=scanRecordedSixtyPointMoves(s);
 assert.equal(r.events.length,0);assert.equal(r.coverage.conflictedMinutes,1);
});
test('sample gaps are exposed; 60-point scanner does not invent crossing minute',()=>{
 const r=scanRecordedSixtyPointMoves(session([['09:15',100],['09:20',170]]));
 assert.equal(r.events[0].gapWarning,true);
 assert.equal(r.events[0].maxGapMinutes,5);
 assert.equal(r.events[0].firstThresholdAt,at('09:20'));
});
test('invalid threshold and one positive price do not create a move',()=>{
 assert.throws(()=>scanRecordedSixtyPointMoves(session([['09:15',100]]),0),/INVALID_MOVEMENT_THRESHOLD/);
 assert.deepEqual(scanRecordedSixtyPointMoves(session([['09:15',100]])).events,[]);
});

test('Multi-DTE freezes first-hit window even when the daily maximum starts later',()=>{
 const s=session([['09:15',110],['09:16',175],['09:17',90],['09:18',200]]);
 for(const row of [...s.options])s.options.push({...row,expiry:'2026-11-16',ltp:row.minute_bucket===at('09:15')?200:row.minute_bucket===at('09:16')?180:400});
 const rise=scanRecordedSixtyPointMoves(s).events.find(e=>e.direction==='RISE'&&e.expiry===expiry)!;
 assert.equal(rise.fromAt,at('09:17'));assert.equal(rise.points,110);
 assert.equal(rise.expiryWindow.fromAt,at('09:15'));assert.equal(rise.expiryWindow.toAt,at('09:16'));
 const other=rise.expiryWindow.comparisons.find(r=>r.expiry==='2026-11-16'&&r.side==='CE')!;
 assert.equal(other.points,-20);assert.equal(other.percent,-10);assert.equal(other.dte,12);
 assert.equal(other.status,'ENDPOINTS_OBSERVED');assert.equal(other.fromQuoteAt,base+'T09:15:10+05:30');
 assert.equal(other.toReceiptAt,base+'T09:16:24+05:30');
});
test('Multi-DTE preserves missing, stale, conflicting and opposite-side evidence separately',()=>{
 const s=session([['09:15',100],['09:16',170]]);
 s.options.push({...s.options[0],expiry:'2026-11-16',ltp:200});
 s.options.push({...s.options[1],expiry:'2026-11-16',ltp:280,quote_timestamp:at('09:15')});
 for(const row of [...s.options].filter(r=>r.expiry===expiry))s.options.push({...row,option_type:'PE',ltp:row.ltp===100?150:80});
 const window=scanRecordedSixtyPointMoves(s).events.find(e=>e.direction==='RISE')!.expiryWindow;
 const missing=window.comparisons.find(r=>r.expiry==='2026-11-16'&&r.side==='CE')!;
 assert.equal(missing.status,'MISSING_ENDPOINT');assert.equal(missing.points,null);assert.equal(missing.toPrice,null);
 assert.equal(window.comparisons.find(r=>r.expiry===expiry&&r.side==='PE')!.points,-70);
 s.options.push({...s.options[0],expiry:'2026-11-16',ltp:201});
 assert.equal(scanRecordedSixtyPointMoves(s).events.find(e=>e.direction==='RISE')!.expiryWindow.comparisons.find(r=>r.expiry==='2026-11-16'&&r.side==='CE')!.fromPrice,null);
});
test('Multi-DTE exposes gaps within frozen endpoints without claiming continuity',()=>{
 const s=session([['09:15',100],['09:20',170]]);
 const window=scanRecordedSixtyPointMoves(s).events[0].expiryWindow;
 assert.equal(window.comparisons.find(r=>r.side==='CE')!.status,'GAPPED');
 assert.equal(window.comparisons.find(r=>r.side==='PE')!.status,'MISSING_ENDPOINT');
 assert.equal(window.mode,'SAME_STRIKE');
});
test('an archived expiry without the selected strike stays explicit as missing',()=>{
 const s=session([['09:15',100],['09:16',170]]);
 s.options.push({...s.options[0],expiry:'2026-11-23',strike:24000});
 const rows=scanRecordedSixtyPointMoves(s).events[0].expiryWindow.comparisons.filter(r=>r.expiry==='2026-11-23');
 assert.equal(rows.length,2);assert(rows.every(r=>r.status==='MISSING_ENDPOINT'&&r.points===null));
});
