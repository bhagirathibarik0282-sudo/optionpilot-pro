import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEventContextLadder,type ContextObservation} from '../rag-event-context-ladder.js';
import {renderEventContextLadder,EVENT_CONTEXT_LADDER_CSS} from '../rag-event-context-ladder-view.js';
const at=(s:string)=>new Date('2026-10-19T'+s+':00+05:30').toISOString();
const o=(family:ContextObservation['family'],entity:string,metric:string,value:number,clock='09:36'):ContextObservation=>({
 index:'NIFTY',family,entity,metric,value,bucketAt:at(clock),sourceAt:at(clock),
 availableAt:new Date(Date.parse(at(clock))+3000).toISOString(),
 verified:true,source:'EXISTING_RECORDED',provenance:'exact recorded hash',expiry:'2026-10-19',strike:23150,side:'PE'
});
const event={index:'NIFTY' as const,date:'2026-10-19',timeIst:'09:36',kind:'PDL_RECOVERY',expiry:'2026-10-19',strike:23150,side:'PE' as const};
test('compact mobile ladder renders each family separately and preserves event time',()=>{
 const r=buildEventContextLadder({event,asOf:at('09:40'),includeOutcomes:true,observations:[
  o('SPOT','NIFTY','PDH',23100),o('PREMIUM','23150 PE','LTP',200,'09:33'),
  o('PREMIUM','23150 PE','LTP',210),o('PREMIUM','23150 PE','LTP',220,'09:39'),
  o('HEAVYWEIGHT','HDFCBANK','CHANGE_PCT',-0.3),
  o('PCR_OI','FULL PCR','RATIO',1.1)
 ]});
 assert.equal(r.ok,true);const html=renderEventContextLadder(r);
 for(const word of ['Spot • PDH/PDL/PDC','CE/PE • exact contract','Full/Band PCR','Heavyweights','Sectors','FII/DII','Before -3m','After +3m','09:36','23150'])assert.ok(html.includes(word),word);
 assert.match(html,/rcl-pdh/);
 assert.match(html,/No verified recorded observations for this event and family/);
 assert.match(html,/Each family is separate/);
 assert.match(EVENT_CONTEXT_LADDER_CSS,/overflow-x:auto/);
});
test('source and entity HTML are escaped, not injected',()=>{
 const row=o('HEAVYWEIGHT','<img src=x onerror=alert(1)>','CHANGE_PCT',1);
 row.provenance='<script>alert(1)</script>';
 const html=renderEventContextLadder(buildEventContextLadder({event,asOf:at('09:40'),observations:[row]}));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img '));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('&lt;img'));
});
test('blocked data remains unavailable rather than being zero or neutral',()=>{
 const r=buildEventContextLadder({event,asOf:at('09:40'),observations:[o('SPOT','NIFTY','LTP',100,'09:35')]});
 assert.equal(r.ok,true);
 const html=renderEventContextLadder(r);
 assert.match(html,/No verified recorded observations/);
 assert.match(html,/Not neutral or zero/);
});
test('error rendering does not fabricate a market result',()=>{
 const html=renderEventContextLadder(buildEventContextLadder({event,asOf:'bad',observations:[]}));
 assert.match(html,/Evidence unavailable/);
 assert.ok(!html.includes('▼'));
});
