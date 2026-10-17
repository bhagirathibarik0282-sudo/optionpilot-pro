/**
 * Read-only, pure comparison of already verified exact-contract RAG snapshots.
 * Never joins a nearby timestamp, strike, or expiry. No trading authority.
 */
export type DteEvidencePoint = {
  symbol:string; date:string; expiry:string; strike:number; side:'CE'|'PE';
  timeIst:string; price:number|null; previousPrice:number|null;
  quoteAt:string|null; receiptAt:string|null; snapshotId:string|null;
  previousQuoteAt:string|null; previousReceiptAt:string|null; previousSnapshotId:string|null;
};
const finitePositive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function alignRagDteEvidence(points:DteEvidencePoint[],selection:{symbol:string;date:string;strike:number;side:'CE'|'PE';timeIst:string},asOf=Infinity) {
  const accepted:{expiry:string;dte:number;price:number;previousPrice:number;changePercent:number;quoteAt:string;receiptAt:string;snapshotId:string}[]=[];
  const blocked:{expiry:string;reason:string}[]=[];
  const matching=points.filter(p=>p.symbol===selection.symbol&&p.date===selection.date&&p.strike===selection.strike&&p.side===selection.side&&p.timeIst===selection.timeIst);
  const groups=new Map<string,DteEvidencePoint[]>();
  for(const p of matching)groups.set(p.expiry,[...(groups.get(p.expiry)??[]),p]);
  for(const [expiry,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const deny=(reason:string)=>blocked.push({expiry,reason});
    if(rows.length!==1){deny('AMBIGUOUS_EXACT_CONTRACT');continue;}
    const p=rows[0],qt=Date.parse(p.quoteAt??''),rt=Date.parse(p.receiptAt??'');
    const bqt=Date.parse(p.previousQuoteAt??''),brt=Date.parse(p.previousReceiptAt??'');
    if(!validDay(expiry)||!validDay(selection.date)||expiry<selection.date){deny('INVALID_DTE');continue;}
    if(!finitePositive(p.price)||!finitePositive(p.previousPrice)){deny('MISSING_EXACT_PRICE_PAIR');continue;}
    if(!p.snapshotId||!p.previousSnapshotId||!Number.isFinite(qt)||!Number.isFinite(rt)||!Number.isFinite(bqt)||!Number.isFinite(brt)||qt>asOf||rt>asOf||bqt>asOf||brt>asOf){deny('UNVERIFIED_OR_AFTER_CUTOFF');continue;}
    const eventMs=Date.parse(selection.date+'T'+selection.timeIst+':00+05:30');
    if(!Number.isFinite(eventMs)||qt<eventMs-30000||qt>rt+5000||rt<eventMs||rt-eventMs>60000||
      bqt<eventMs-210000||bqt>eventMs-180000+30000||bqt>brt+5000||brt<eventMs-180000||brt>eventMs-120000||
      p.previousSnapshotId===p.snapshotId){deny('TIMESTAMP_MISMATCH');continue;}
    accepted.push({expiry,dte:Math.round((Date.parse(expiry)-Date.parse(selection.date))/86400000),price:p.price,previousPrice:p.previousPrice,changePercent:(p.price/p.previousPrice-1)*100,quoteAt:p.quoteAt!,receiptAt:p.receiptAt!,snapshotId:p.snapshotId});
  }
  const rising=accepted.filter(p=>p.changePercent>0).length,falling=accepted.filter(p=>p.changePercent<0).length,flat=accepted.length-rising-falling;
  return {mode:'READ_ONLY_RAG_DTE_ALIGNMENT_V1',status:accepted.length?'PARTIAL':'UNAVAILABLE',identity:selection,accepted,blocked,coverage:{observedExpiries:groups.size,verifiedExpiries:accepted.length},direction:{rising,falling,flat,agreement:accepted.length>=2&&Math.max(rising,falling)===accepted.length?'ALL_VERIFIED_SAME_DIRECTION':'NOT_ESTABLISHED'},limitations:['Only supplied verified snapshots; no database access or expiry discovery.','No interpolated prices, inferred missing DTE or causal/trading claims.']};
}
