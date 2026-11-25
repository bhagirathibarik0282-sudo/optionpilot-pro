import test from 'node:test';
import assert from 'node:assert/strict';
import {eventParticipationContext} from '../event-participation-context.js';
const date='2026-11-24',t=(m:number,s=0)=>new Date(Date.parse(date+'T10:00:00+05:30')+m*60000+s*1000).toISOString();
const q=(symbol:string,m:number,p=101)=>({symbol:'NSE:'+symbol,exchangeTimestamp:t(m,-5),price:p,previousClose:100});
const snap=(m:number,p=101)=>({source:'SERVER_BACKGROUND_KITE_QUOTES',tradingDate:date,timestamp:t(m),stocks:{BANKNIFTY:[q('HDFCBANK',m,p),q('ICICIBANK',m,p)],NIFTY:[q('HDFCBANK',m,p),q('RELIANCE',m,p)]},sectors:['NIFTY PSU BANK','NIFTY IT','NIFTY SMLCAP 100','NIFTY MIDCAP 100'].map(s=>q(s,m,p))});
const cash={dailyHistoryState:'VERIFIED_STORED_EOD',dailyHistory:[{date:'2026-11-20',fiiNetCrore:-100,diiNetCrore:120},{date:'2026-11-23',fiiNetCrore:-200,diiNetCrore:300},{date,fiiNetCrore:999,diiNetCrore:999},{date:'2026-11-25',fiiNetCrore:999,diiNetCrore:999}]};
test('priority groups share HDFC without duplicate display; previous cash excludes current and future days',()=>{
 const c=eventParticipationContext(date,'BANKNIFTY',t(0),t(0),t(3),[snap(-3),snap(0,102),snap(3,103),snap(5,105)],cash)!;
 const e=c.checkpoints.find(x=>x.offset===0)!;
 assert.deepEqual(e.moves.slice(0,3).map(x=>x.symbol),['HDFCBANK','ICICIBANK','NIFTY PSU BANK']);
 assert.equal(e.moves.filter(x=>x.symbol==='HDFCBANK').length,1);
 assert.equal(e.banks.state,'ALIGNED_UP');assert.equal(e.broad.state,'ALIGNED_UP');
 assert.equal(e.bankPrimary.required,5);assert.equal(e.bankPrimary.state,'INCOMPLETE');
 assert.equal(e.broadPrimary.required,6);assert.equal(e.broadPrimary.state,'ALIGNED_UP');
 assert.ok(Math.abs(e.moves[0].deltaFromBeforePct!-(102/101-1)*100)<1e-9);
 assert.equal(c.checkpoints.find(x=>x.offset===5)!.status,'FUTURE');
 assert.equal(c.cashWindows[0].fii,-200);assert.equal(c.cashWindows[1].fii,null);
 assert.equal(c.affectsExecution,false);assert.equal(c.officialWeight,null);
 const n=eventParticipationContext(date,'NIFTY',t(0),t(0),t(3),[snap(0)],cash)!;
 assert.deepEqual(n.checkpoints.find(x=>x.offset===0)!.moves.slice(0,5).map(x=>x.symbol),['HDFCBANK','RELIANCE','NIFTY IT','NIFTY SMLCAP 100','NIFTY MIDCAP 100']);
});
test('stale, future, duplicate and unverified evidence is not silently promoted',()=>{
 const stale=snap(0);stale.stocks.BANKNIFTY[0].exchangeTimestamp=t(-1);
 const c=eventParticipationContext(date,'BANKNIFTY',t(0),t(0),t(3),[stale,snap(3)],{...cash,dailyHistoryState:'UNVERIFIED'})!;
 assert.equal(c.checkpoints.find(x=>x.offset===0)!.banks.state,'INCOMPLETE');
 assert.equal(c.checkpoints.find(x=>x.offset===0)!.moves[0].dayPct,null);
 assert.equal(c.cashWindows[0].fii,null);
 const d=eventParticipationContext(date,'BANKNIFTY',t(0),t(0),t(3),[snap(0),snap(0)],cash)!;
 assert.equal(d.checkpoints.find(x=>x.offset===0)!.status,'GAP');
 assert.equal(eventParticipationContext(date,'BANKNIFTY',t(0),t(3),t(1),[],cash),null);
});

test('ten stored cash dates are supported; receipt-qualified totals fail closed without substituting older dates',()=>{
 const history=Array.from({length:11},(_,i)=>{const d='2026-11-'+String(23-i).padStart(2,'0');return {date:d,fiiNetCrore:-100,diiNetCrore:120,fetchedAt:d+'T18:00:00+05:30'};});
 const c=(rows:any[])=>eventParticipationContext(date,'NIFTY',t(0),t(0),t(3),[],{dailyHistoryState:'VERIFIED_STORED_EOD',dailyHistory:rows})!;
 const r=c(history).cashWindows.find(w=>w.sessions===10)!;
 assert.equal(r.available,10);assert.equal(r.fii,-1000);assert.equal(r.receiptFii,-1000);assert.equal(r.receiptDii,1200);
 history[0].fetchedAt=t(1);
 const late=c(history).cashWindows.find(w=>w.sessions===10)!;
 assert.equal(late.fii,-1000);assert.equal(late.receiptQualified,9);assert.equal(late.receiptFii,null);
 assert.equal(c(history.slice(0,9)).cashWindows.find(w=>w.sessions===10)!.fii,null);
});

test('prior participant OI requires all four categories and stored fetch/update clocks',()=>{
 const day=(date:string,long:number)=>({date,complete:true,participants:['FII','DII','PRO','CLIENT'].map(participant=>({participant,fetchedAt:date+'T18:00:00+05:30',updatedAt:date+'T18:01:00+05:30',futureLong:long,futureShort:40,callLong:50,callShort:20,putLong:0,putShort:30}))});
 const days=[day('2026-11-23',100),day('2026-11-20',90),day(date,999)];
 const read=()=>eventParticipationContext(date,'NIFTY',t(0),t(0),t(3),[],{participantOiHistoryState:'STORED_OI_READBACK',participantOiHistory:days})!.participantOi;
 let p=read();assert.equal(p.date,'2026-11-23');assert.equal(p.positions[0]?.futureNet,60);assert.equal(p.positions[0]?.putNet,-30);assert.equal(p.windows[0].changes[0]?.futureLong,10);assert.equal(p.windows[1].changes.length,0);
 days[0].participants[0].updatedAt=t(1);assert.equal(read().positions.length,0);
 days[0].participants[0].updatedAt='2026-11-23T18:01:00+05:30';days[0].participants.pop();assert.equal(read().positions.length,0);
});
