/** Read-only observation scanner. A 60-point change is a difference between two
 * actual saved eligible option LTPs for the identical date/expiry/strike/side.
 * No OHLC inference, price interpolation, trading authority or broker calls.
 */
export interface RecordedSixtyPointMove {
  symbol: string; date: string; expiry: string; strike: number; side: 'CE'|'PE';
  direction: 'RISE'|'FALL'; points: number;
  fromPrice: number; toPrice: number; fromAt: string; toAt: string;
  firstThresholdAt: string; observations: number;
  maxGapMinutes: number; gapWarning: boolean;
}
export interface RecordedSixtyPointScan {
  events: RecordedSixtyPointMove[];
  coverage: { optionRows: number; eligibleRows: number; rejectedRows: number;
    conflictedMinutes: number; contractsObserved: number; source: string; };
}
/** A TRUE marker is necessary but insufficient: require the exact contemporaneous
 * recorded market receipt and snapshot plus the existing RAG 30s freshness rule. */
export function scanRecordedSixtyPointMoves(session:any,threshold=60):RecordedSixtyPointScan {
  const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
  const ms=(value:unknown)=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
  const day=(time:number)=>new Date(time+19800000).toISOString().slice(0,10);
  const expiryOf=(row:any)=>String(row?.expiry||'').slice(0,10);
  const keyOf=(row:any)=>[row.symbol,expiryOf(row),row.strike,row.option_type].join('|');
  const signature=(row:any)=>JSON.stringify([row.ltp,row.snapshot_id,row.quote_timestamp,row.truth_verdict,row.expiry,row.strike,row.option_type]);
  if(!Number.isFinite(threshold)||threshold<=0)throw new Error('INVALID_MOVEMENT_THRESHOLD');
  const options:any[]=Array.isArray(session?.options)?session.options:[],market:any[]=Array.isArray(session?.market)?session.market:[];
  const symbol=String(session?.symbol||''),date=String(session?.date||'');
  const marketByTime=new Map<string,any[]>();
  for(const m of market)if(m.symbol===symbol&&m.truth_verdict==='TRUE'&&ms(m.minute_bucket)!==null){
    const k=m.minute_bucket;if(!marketByTime.has(k))marketByTime.set(k,[]);marketByTime.get(k)!.push(m);
  }
  const buckets=new Map<string,any[]>();
  let rejected=0,conflicted=0,eligible=0;
  for(const row of options){
    const time=ms(row.minute_bucket);
    if(row.symbol!==symbol||row.truth_verdict!=='TRUE'||time===null||day(time)!==date||
      !['CE','PE'].includes(row.option_type)||!Number.isFinite(row.strike)||row.strike<=0||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiryOf(row))||expiryOf(row)<date||
      !Number.isFinite(row.ltp)||row.ltp<=0){rejected++;continue;}
    const identity=keyOf(row)+'|'+row.minute_bucket;
    if(!buckets.has(identity))buckets.set(identity,[]);
    buckets.get(identity)!.push(row);
  }
  const byContract=new Map<string,any[]>();
  for(const rows of buckets.values()){
    const unique=new Map<string,any>();
    for(const row of rows)unique.set(signature(row),row);
    if(unique.size!==1){conflicted++;rejected+=rows.length;continue;}
    const row=[...unique.values()][0],marketRows=marketByTime.get(row.minute_bucket)||[];
    if(marketRows.length!==1||!marketRows[0].snapshot_id||row.snapshot_id!==marketRows[0].snapshot_id){
      rejected+=rows.length;continue;
    }
    const receipt=ms(marketRows[0].backend_timestamp),quote=ms(row.quote_timestamp);
    if(receipt===null||quote===null||day(quote)!==date||(receipt-quote)/1000>30||(receipt-quote)/1000< -5){
      rejected+=rows.length;continue;
    }
    const k=keyOf(row);if(!byContract.has(k))byContract.set(k,[]);
    byContract.get(k)!.push(row);eligible++;
  }
  const events:RecordedSixtyPointMove[]=[];
  const cadence=Number(session?.cadenceMinutes)===1?1:3;
  for(const rows of byContract.values()){
    rows.sort((a,b)=>Date.parse(a.minute_bucket)-Date.parse(b.minute_bucket));
    if(rows.length<2)continue;
    let low=rows[0],high=rows[0];
    const best:any={RISE:null,FALL:null};
    const first:any={RISE:null,FALL:null};
    for(const row of rows.slice(1)){
      const rise=row.ltp-low.ltp,fall=high.ltp-row.ltp;
      if(rise+1e-8>=threshold){
        if(!first.RISE)first.RISE=row.minute_bucket;
        if(!best.RISE||rise>best.RISE.points)best.RISE={points:rise,from:low,to:row};
      }
      if(fall+1e-8>=threshold){
        if(!first.FALL)first.FALL=row.minute_bucket;
        if(!best.FALL||fall>best.FALL.points)best.FALL={points:fall,from:high,to:row};
      }
      if(row.ltp<low.ltp)low=row;
      if(row.ltp>high.ltp)high=row;
    }
    for(const direction of ['RISE','FALL'] as const){
      const b=best[direction];if(!b)continue;
      const segment=rows.filter(row=>row.minute_bucket>=b.from.minute_bucket&&row.minute_bucket<=b.to.minute_bucket);
      let maxGap=0;
      for(let i=1;i<segment.length;i++)maxGap=Math.max(maxGap,(Date.parse(segment[i].minute_bucket)-Date.parse(segment[i-1].minute_bucket))/60000);
      const anchor=b.from;
      events.push({symbol,date,expiry:expiryOf(anchor),strike:anchor.strike,side:anchor.option_type,
        direction,points:round2(b.points),fromPrice:anchor.ltp,toPrice:b.to.ltp,
        fromAt:anchor.minute_bucket,toAt:b.to.minute_bucket,firstThresholdAt:first[direction],
        observations:segment.length,maxGapMinutes:maxGap,gapWarning:maxGap>cadence});
    }
  }
  events.sort((a,b)=>a.toAt.localeCompare(b.toAt)||a.expiry.localeCompare(b.expiry)||a.strike-b.strike);
  return {events,coverage:{optionRows:options.length,eligibleRows:eligible,rejectedRows:rejected,
    conflictedMinutes:conflicted,contractsObserved:byContract.size,
    source:'TRUE marker + exact market snapshot + quote receipt freshness <=30s; sampled ATM +/-7 only'}};
}
