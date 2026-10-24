/**
 * Read-only research audit of the LEGACY 1-minute CE-PE spread export.
 * This is NOT an H1 snapshot adapter and must NEVER be used as event-time
 * trusted features for the Recorder/RAG ladder.
 */
type Row={minute?:unknown;timeIst?:unknown;status?:unknown;ceLtp?:unknown;peLtp?:unknown;
 gap?:unknown;ceQuoteTime?:unknown;peQuoteTime?:unknown;ceValidation?:unknown;peValidation?:unknown};
type SpreadFile={ok?:unknown;mode?:unknown;request?:any;cadence?:unknown;source?:unknown;
 safety?:any;rows?:unknown;counts?:Record<string,number>};
const numbers=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const clock=(m:number)=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const local=(ms:number)=>new Date(ms+19800000).toISOString().slice(0,10)+' '+new Date(ms+19800000).toISOString().slice(11,16);
type StrictRow={time:string;at:number;ce:number;pe:number;gap:number;ceQuoteAt:string;peQuoteAt:string};
const blocking=['MISSING_RECORDED_MARKET_RECEIPT_AT',
 'MISSING_EXACT_H1_SNAPSHOT_ID',
 'MISSING_TRUE_MARKET_SNAPSHOT_JOIN',
 'NO_SPOT_FUTURES_PCR_SECTOR_WEIGHT_OR_OFFICIAL_FII_CONTEXT'] as const;
export function auditRecordedSpreadForRag(source:unknown,selectedTimeIst:string){
 const fail=(reason:string)=>({ok:false,mode:'READ_ONLY_SPREAD_VS_RAG_SOURCE_AUDIT_V1',reason,
  bridgeReady:false,safety:{readOnly:true,noDbWrites:true,noBrokerCalls:true,
   affectsSelector:false,affectsTelegram:false,affectsExecution:false}});
 if(!source||typeof source!=='object')return fail('INVALID_ARCHIVE');
 const raw=source as SpreadFile,request=raw.request??{};
 if(raw.ok!==true||raw.mode!=='READ_ONLY_PREMIUM_SPREAD_COMPARISON_V1'||
   raw.cadence!=='EXACT_1M_NO_INTERPOLATION'||raw.source!=='EXISTING_H1_FIXED_CONTRACT_JOURNEY'||
   raw.safety?.readOnly!==true||!Array.isArray(raw.rows)||raw.rows.length>10000||
   !['NIFTY','SENSEX','BANKNIFTY'].includes(request.symbol)||
   !/^\d{4}-\d\d-\d\d$/.test(request.date??'')||
   !/^\d{4}-\d\d-\d\d$/.test(request.expiry??'')||
   !Number.isInteger(request.ce)||!Number.isInteger(request.pe)||request.ce<=0||request.pe<=0)
   return fail('INCOMPATIBLE_SOURCE_OR_CONTRACT');
 if(!/^(?:09|1[0-5]):[0-5]\d$/.test(selectedTimeIst)||selectedTimeIst<'09:15'||selectedTimeIst>'15:30')
   return fail('INVALID_SELECTED_TIME');
 const base=Date.parse(request.date+'T09:15:00+05:30');
 const rowMap=new Map<number,StrictRow|null>(),counts:Record<string,number>={};
 let rejected=0,duplicates=0;
 for(const r of raw.rows as Row[]){
   const name=String(r.status??'UNKNOWN');counts[name]=(counts[name]??0)+1;
   if(typeof r.minute!=='string'||typeof r.timeIst!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(r.minute)){
     rejected++;continue;
   }
   const at=Date.parse(r.minute),index=(at-base)/60000;
   if(!Number.isInteger(index)||index<0||index>375||r.timeIst!==local(at).slice(11)){
     rejected++;continue;
   }
   if(rowMap.has(index)){rowMap.set(index,null);duplicates++;continue;}
   const ce=numbers(r.ceLtp),pe=numbers(r.peLtp),gap=numbers(r.gap);
   const qt=(value:unknown)=>{
     if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(value))return null;
     const t=Date.parse(value);return Number.isFinite(t)&&t>=at&&t<at+60000?value:null;
   };
   const ceAt=qt(r.ceQuoteTime),peAt=qt(r.peQuoteTime);
   if(name!=='TRUE_ELIGIBLE_BOTH'||r.ceValidation!=='RESEARCH_ELIGIBLE'||
      r.peValidation!=='RESEARCH_ELIGIBLE'||ce===null||pe===null||
      ce<=0||pe<=0||gap===null||Math.abs(ce-pe-gap)>0.011||!ceAt||!peAt){
     rowMap.set(index,null);continue;
   }
   rowMap.set(index,{time:r.timeIst,at,ce,pe,gap,ceQuoteAt:ceAt,peQuoteAt:peAt});
 }
 const at=Date.parse(request.date+'T'+selectedTimeIst+':00+05:30');
 const anchor=(at-base)/60000;
 const strictTriplets=[] as {timeIst:string;before:StrictRow;event:StrictRow;after:StrictRow}[];
 for(let i=3;i+3<=375;i+=3) {
   const before=rowMap.get(i-3),event=rowMap.get(i),after=rowMap.get(i+3);
   if(before&&event&&after)strictTriplets.push({timeIst:clock(555+i),before,event,after});
 }
 const selected=strictTriplets.find(x=>x.timeIst===selectedTimeIst)??null;
 const rowAtAnchor=Number.isInteger(anchor)?rowMap.get(anchor):null;
 return {ok:true,mode:'READ_ONLY_SPREAD_VS_RAG_SOURCE_AUDIT_V1',
  sourceScope:{symbol:request.symbol,date:request.date,expiry:request.expiry,
   ceStrike:request.ce,peStrike:request.pe,cadence:'EXACT_1M_NO_INTERPOLATION'},
  totalRows:raw.rows.length,counts,rejected,duplicates,
  strictThreeMinuteTriplets:strictTriplets.length,
  selectedTimeIst,selected: selected?{
    before:{timeIst:selected.before.time,ceLtp:selected.before.ce,peLtp:selected.before.pe,gap:selected.before.gap,
      ceQuoteAt:selected.before.ceQuoteAt,peQuoteAt:selected.before.peQuoteAt},
    event:{timeIst:selected.event.time,ceLtp:selected.event.ce,peLtp:selected.event.pe,gap:selected.event.gap,
      ceQuoteAt:selected.event.ceQuoteAt,peQuoteAt:selected.event.peQuoteAt},
    after:{timeIst:selected.after.time,ceLtp:selected.after.ce,peLtp:selected.after.pe,gap:selected.after.gap,
      ceQuoteAt:selected.after.ceQuoteAt,peQuoteAt:selected.after.peQuoteAt},
    beforeToEvent:{ceChange:Number((selected.event.ce-selected.before.ce).toFixed(2)),
      peChange:Number((selected.event.pe-selected.before.pe).toFixed(2)),
      gapChange:Number((selected.event.gap-selected.before.gap).toFixed(2))}
   }:null,
  // This legacy export alone cannot prove the RECEIPT and snapshot join of
  // the existing RAG endpoint, even when its one-minute quote times are valid.
  selectedStrictQualified:!!selected,
  anchorStrictQualified:!!rowAtAnchor,bridgeReady:false,blockers:[...blocking],
  safety:{readOnly:true,noDbWrites:true,noBrokerCalls:true,
   affectsSelector:false,affectsTelegram:false,affectsExecution:false},
  limitations:['Exported quote time is NOT verified backend receipt time.',
   'Exact option spread is not spot, futures, full PCR, sector or heavyweight context.',
   'Three-point spread eligibility is separate from H1 RAG event receipt and snapshot identity.',
   'Retrospective after-event rows are outcomes, never event-time features.']};
}
