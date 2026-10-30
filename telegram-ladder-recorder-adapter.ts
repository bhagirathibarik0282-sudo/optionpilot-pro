/** Read-only adapter for existing H1 replay rows. Does not upgrade inherited archive truth. */
import {premiumRecordStatus} from './h1-premium-record-quality.js';
import {SYMBOLS,missing,numeric,value,type Value,type MinuteFrame,type IndexFrame,type Expiry,type Participation} from './telegram-ladder-v4.js';
const arr=(x:unknown):any[]=>Array.isArray(x)?x:[];
function time(x:unknown):number|null {if(x instanceof Date)return Number.isFinite(x.getTime())?x.getTime():null;if(typeof x!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(x))return null;const n=Date.parse(x);return Number.isFinite(n)?n:null;}
function exp(x:unknown):string {
  // pg parses SQL DATE as local midnight; UTC conversion can change its calendar date.
  if(x instanceof Date){if(!Number.isFinite(x.getTime())||x.getHours()||x.getMinutes()||x.getSeconds()||x.getMilliseconds())throw Error('EXPIRY_INVALID');x=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;}
  if(typeof x!=='string')throw Error('EXPIRY_MISSING');const d=x.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('EXPIRY_INVALID');return d;
}
function positive(v:unknown,quality:'VERIFIED'|'UNVERIFIED'|'STALE',source:string):Value {const n=numeric(v);return n!==null&&n>0?value(n,quality,source):missing(source);}
function rowValue(v:unknown,source:string):Value {return value(v,'UNVERIFIED',source);}
/** Input must be full-scope, unchanged recorder exports; duplicate identities fail visibly. */
export function framesFromH1(replays:readonly any[],participation:readonly any[]=[]):MinuteFrame[] {
  const frames=new Map<string,MinuteFrame>();
  const frame=(bucket:string)=>{const n=time(bucket);if(n===null||n%60_000)throw Error('INVALID_MINUTE');const key=new Date(n).toISOString();if(!frames.has(key))frames.set(key,{minute:key,indices:[],participation:[]});return frames.get(key)!;};
  for(const replay of replays) {
    const allMarket=[...arr(replay.market)],allChain=arr(replay.chain),allOptions=arr(replay.options);
    // A missing spot row must not discard existing chain/premium observations.
    const marketKeys=new Set(allMarket.map(r=>`${r.symbol}|${time(r.minute_bucket)}`));
    for(const r of [...allChain,...allOptions]) {
      if(!SYMBOLS.includes(r.symbol))throw Error('UNSUPPORTED_SYMBOL');
      const t=time(r.minute_bucket);if(t===null||t%60_000)throw Error('INVALID_MINUTE');
      const key=`${r.symbol}|${t}`;
      if(!marketKeys.has(key)){allMarket.push({symbol:r.symbol,minute_bucket:r.minute_bucket});marketKeys.add(key);}
    }
    for(const row of allMarket) {
      if(!SYMBOLS.includes(row.symbol))throw Error('UNSUPPORTED_SYMBOL');
      const f=frame(row.minute_bucket);if(f.indices.some(i=>i.symbol===row.symbol))throw Error('DUPLICATE_MARKET_IDENTITY');
      const capture=time(row.backend_timestamp),spotTime=time(row.exchange_timestamp);
      const bucket=time(row.minute_bucket)!;
      const contextValid=capture!==null&&capture>=bucket&&capture<bucket+60_000;
      const fresh=contextValid&&spotTime!==null&&capture!==null&&Math.abs(spotTime-capture)<=60_000&&new Date(spotTime+19_800_000).toISOString().slice(0,10)===new Date(capture+19_800_000).toISOString().slice(0,10)&&row.freshness_status==='TRUE'&&row.truth_verdict==='TRUE';
      const i:IndexFrame={symbol:row.symbol,spot:positive(row.spot_ltp,fresh?'VERIFIED':'UNVERIFIED',fresh?'H1_EXCHANGE_TIMESTAMP':'H1_BACKEND_TIME_ONLY'),pdh:positive(row.pdh,'UNVERIFIED','H1_PREVIOUS_SESSION_NOT_INDEPENDENTLY_VERIFIED'),pdl:positive(row.pdl,'UNVERIFIED','H1_PREVIOUS_SESSION_NOT_INDEPENDENTLY_VERIFIED'),expiries:[]};
      const chains=allChain.filter(c=>c.symbol===row.symbol&&time(c.minute_bucket)===time(row.minute_bucket));
      const options=allOptions.filter(c=>c.symbol===row.symbol&&time(c.minute_bucket)===time(row.minute_bucket));
      const expiries=[...new Set([...chains,...options].map(c=>exp(c.expiry)))].sort();
      for(const expiry of expiries) {
        const cs=chains.filter(c=>exp(c.expiry)===expiry);if(cs.length>1)throw Error('DUPLICATE_CHAIN_IDENTITY');const c=cs[0];
        const source='H1_CHAIN_ARCHIVE_FRESH_COVERAGE_UNPROVEN';
        const e:Expiry={expiry,pcr:{full:rowValue(c?.full_chain_oi_pcr,source),band7:rowValue(c?.band7_oi_pcr,source),volume:rowValue(c?.volume_pcr,'H1_CHAIN_VOLUME_UNIVERSE_UNPROVEN')},volumeScope:'ARCHIVED_UNSPECIFIED',ceWall:{strike:numeric(c?.call_wall_strike),oi:rowValue(c?.call_wall_oi,source)},peWall:{strike:numeric(c?.put_wall_strike),oi:rowValue(c?.put_wall_oi,source)},contracts:[]};
        const seen=new Set<string>();
        for(const o of options.filter(o=>exp(o.expiry)===expiry)) {
          const strike=numeric(o.strike),side=o.option_type;
          if(strike===null||strike<=0||!['CE','PE'].includes(side))throw Error('INVALID_CONTRACT_IDENTITY');
          const key=`${strike}|${side}`;if(seen.has(key))throw Error('DUPLICATE_CONTRACT_IDENTITY');seen.add(key);
          const quoteTime=time(o.quote_timestamp);
          const status=!contextValid||capture===null?'CAPTURE_CONTEXT_MISSING':premiumRecordStatus({verdict:o.truth_verdict,quoteTimestamp:quoteTime===null?null:new Date(quoteTime).toISOString(),now:new Date(capture),expiry,legExpiry:expiry,strike,ltp:numeric(o.ltp)??NaN});
          const eligible=status==='RESEARCH_ELIGIBLE'&&o.validation_status==='RESEARCH_ELIGIBLE'&&typeof row.snapshot_id==='string'&&row.snapshot_id===o.snapshot_id;
          const quality=eligible?'VERIFIED':status.includes('STALE')||status.includes('OTHER_SESSION')?'STALE':'UNVERIFIED';
          e.contracts.push({strike,side,ltp:positive(o.ltp,quality,'H1_EXACT_CONTRACT_QUOTE'),pdh:positive(o.pdh,'UNVERIFIED','H1_PREVIOUS_SESSION_NOT_INDEPENDENTLY_VERIFIED'),pdl:positive(o.pdl,'UNVERIFIED','H1_PREVIOUS_SESSION_NOT_INDEPENDENTLY_VERIFIED')});
        }
        i.expiries.push(e);
      }
      f.indices.push(i);
    }
  }
  for(const p of participation) {
    const f=frame(p.minuteBucket);if(f.participation.length)throw Error('DUPLICATE_PARTICIPATION_MINUTE');
    f.participation=arr(p.rows).map((q):Participation=>({key:`${q.role}|${q.token}`,label:q.label,role:q.role,
      price:positive(q.price,q.state==='LIVE'?'VERIFIED':'STALE','PARTICIPATION_MINUTE'),dayChange:value(q.changePct,q.state==='LIVE'?'VERIFIED':'STALE','PREVIOUS_CLOSE'),weight:missing('INDEX_WEIGHT_NOT_RECORDED')}));
  }
  return [...frames.values()].sort((a,b)=>a.minute.localeCompare(b.minute));
}
