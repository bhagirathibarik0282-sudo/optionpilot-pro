/** Read-only observation scanner. A 60-point change is a difference between two
 * actual saved eligible option LTPs for the identical date/expiry/strike/side.
 * No OHLC inference, price interpolation, trading authority or broker calls.
 */
export interface RecordedExpiryWindow {
  expiry: string; dte: number; side: 'CE'|'PE';
  status: 'ENDPOINTS_OBSERVED'|'MISSING_ENDPOINT'|'GAPPED';
  fromPrice: number|null; toPrice: number|null; points: number|null; percent: number|null;
  fromQuoteAt: string|null; toQuoteAt: string|null;
  fromReceiptAt: string|null; toReceiptAt: string|null;
}
export interface RecordedSixtyPointMove {
  symbol: string; date: string; expiry: string; strike: number; side: 'CE'|'PE';
  direction: 'RISE'|'FALL'; points: number;
  fromPrice: number; toPrice: number; fromAt: string; toAt: string;
  firstThresholdAt: string; firstThresholdFromAt: string; observations: number;
  expiryWindow: { mode: 'SAME_STRIKE'; fromAt: string; toAt: string;
    comparisons: RecordedExpiryWindow[]; };
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
  const availableExpiries=[...new Set(options.filter(r=>r.symbol===symbol&&
    /^\d{4}-\d{2}-\d{2}$/.test(expiryOf(r))&&expiryOf(r)>=date).map(expiryOf))].sort();
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
        if(!first.RISE)first.RISE={from:low,to:row};
        if(!best.RISE||rise>best.RISE.points)best.RISE={points:rise,from:low,to:row};
      }
      if(fall+1e-8>=threshold){
        if(!first.FALL)first.FALL={from:high,to:row};
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
      const anchor=b.from,firstWindow=first[direction];
      // Freeze the first observed threshold's own endpoints, independent of the
      // later daily maximum. Other expiries never choose a better window.
      const fromAt=firstWindow.from.minute_bucket,toAt=firstWindow.to.minute_bucket;
      const comparisons:RecordedExpiryWindow[]=[];
      for(const expiry of availableExpiries)for(const side of ['CE','PE'] as const){
        const samples=byContract.get([symbol,expiry,anchor.strike,side].join('|'))||[];
        const from=samples.find(r=>r.minute_bucket===fromAt),to=samples.find(r=>r.minute_bucket===toAt);
        const segment=samples.filter(r=>Date.parse(r.minute_bucket)>=Date.parse(fromAt)&&Date.parse(r.minute_bucket)<=Date.parse(toAt));
        const gapped=segment.some((r,i)=>i>0&&(Date.parse(r.minute_bucket)-Date.parse(segment[i-1].minute_bucket))/60000>cadence);
        const complete=!!from&&!!to;
        const receipt=(r:any)=>r?marketByTime.get(r.minute_bucket)![0].backend_timestamp:null;
        comparisons.push({expiry,dte:Math.round((Date.parse(expiry+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000),side,
          status:!complete?'MISSING_ENDPOINT':gapped?'GAPPED':'ENDPOINTS_OBSERVED',
          fromPrice:from?.ltp??null,toPrice:to?.ltp??null,
          points:complete?round2(to.ltp-from.ltp):null,percent:complete?round2((to.ltp-from.ltp)/from.ltp*100):null,
          fromQuoteAt:from?.quote_timestamp??null,toQuoteAt:to?.quote_timestamp??null,
          fromReceiptAt:receipt(from),toReceiptAt:receipt(to)});
      }
      events.push({symbol,date,expiry:expiryOf(anchor),strike:anchor.strike,side:anchor.option_type,
        direction,points:round2(b.points),fromPrice:anchor.ltp,toPrice:b.to.ltp,
        fromAt:anchor.minute_bucket,toAt:b.to.minute_bucket,firstThresholdAt:toAt,firstThresholdFromAt:fromAt,
        expiryWindow:{mode:'SAME_STRIKE',fromAt,toAt,comparisons},
        observations:segment.length,maxGapMinutes:maxGap,gapWarning:maxGap>cadence});
    }
  }
  events.sort((a,b)=>a.toAt.localeCompare(b.toAt)||a.expiry.localeCompare(b.expiry)||a.strike-b.strike);
  return {events,coverage:{optionRows:options.length,eligibleRows:eligible,rejectedRows:rejected,
    conflictedMinutes:conflicted,contractsObserved:byContract.size,
    source:'TRUE marker + exact market snapshot + quote receipt freshness <=30s; sampled ATM +/-7 only'}};
}
