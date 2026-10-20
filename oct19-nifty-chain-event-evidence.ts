import { runH1ReplayHttp, type H1ReplayHttpResult } from "./h1-replay-http.js";

/** Five small on-demand reads of existing H1 snapshots. No writes, provider requests,
 * new DB, candidate/verdict/Telegram/execution output or automated recurring work.
 * All Delta-weighted figures are observed-strike PROXIES; NEVER full-chain DEX/PCR.
 */
const DATE = "2026-10-19";
const SYMBOL = "NIFTY";
const TIMES = ["10:33", "11:33", "12:33", "13:33", "14:33"] as const;
const EXPIRY = "2026-10-19";
const SAFETY = { readOnly:true, writesPerformed:false, brokerRequests:false,
  affectsSelector:false, affectsVerdict:false, affectsTelegram:false,
  affectsExecution:false, createsOrders:false } as const;
type Row = Record<string, unknown>;
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const pos = (v: unknown) => {const x=num(v);return x!==null&&x>0?x:null;};
const round = (x: number) => Number(x.toFixed(3));
const stamp = (v: unknown) => Date.parse(String(v ?? ""));
const iso = (t: number) => new Date(t).toISOString();
const bucketAt = (hm:string) => new Date(DATE+"T"+hm+":00+05:30").getTime();
function identity(r: Row) {return [r.strike,r.option_type].join("|");}
function quoteOk(q:Row,market:Row,t:number):boolean {
  const at=stamp(q.quote_timestamp),age=num(q.quote_age_seconds),delta=num(q.delta);
  return q.truth_verdict==="TRUE" && market.truth_verdict==="TRUE" &&
    market.snapshot_id!=null && q.snapshot_id===market.snapshot_id &&
    q.validation_status==="RESEARCH_ELIGIBLE" && pos(q.ltp)!==null &&
    Number.isFinite(at) && at>=t && at<t+60_000 && age!==null && age>=0 && age<=30 &&
    delta!==null && Math.abs(delta)>0 && Math.abs(delta)<=1 &&
    (q.option_type==="CE"?delta>0:q.option_type==="PE"&&delta<0);
}
function eligible(rows:Row[],market:Row,t:number) {
  // Different expiries can reuse the same strike/side. Count ambiguity
  // only within the selected expiry, never across unrelated DTEs.
  const scoped=rows.filter(r=>String(r.expiry).slice(0,10)===EXPIRY);
  const eligibleRows:Row[]=[];
  const seen=new Map<string,number>();
  for(const r of scoped) seen.set(identity(r),(seen.get(identity(r))??0)+1);
  for(const r of scoped){
    if(seen.get(identity(r))!==1||!quoteOk(r,market,t))continue;
    eligibleRows.push(r);
  }
  return eligibleRows;
}
function choose(rows:Row[],target:number) {
  const calls=rows.filter(r=>r.option_type==="CE"&&Math.abs(Number(r.delta)-target)<=0.05);
  const puts=rows.filter(r=>r.option_type==="PE"&&Math.abs(-Number(r.delta)-target)<=0.05);
  let best:{ce:Row;pe:Row;score:number}|null=null;
  for(const ce of calls)for(const pe of puts){
    const skew=Math.abs(stamp(ce.quote_timestamp)-stamp(pe.quote_timestamp));
    const drift=Math.abs(Number(ce.delta)+Number(pe.delta));
    if(!Number.isFinite(skew)||skew>5000||drift>0.02)continue;
    const score=Math.abs(Number(ce.delta)-target)+Math.abs(-Number(pe.delta)-target);
    if(!best||score<best.score)best={ce,pe,score};
  }
  return best;
}
function atRows<T extends Row>(rows:T[]|undefined,t:number):T[] {
  return (rows??[]).filter(r=>stamp(r.minute_bucket)===t);
}
function one<T extends Row>(rows:T[]|undefined,t:number):T|null {
  const found=atRows(rows,t);return found.length===1?found[0]:null;
}
const shifted = (a:unknown,b:unknown) => a!=null && b!=null && a!==b ?
  { from:Number(a),to:Number(b) }:null;
export function summarizeOct19Evidence(r:H1ReplayHttpResult,hm:string) {
  const t=bucketAt(hm),prev=t-60000;
  const cur=one(r.market,t),earlier=one(r.market,prev);
  if(!r.ok) return {timeIst:hm,status:"H1_READ_UNAVAILABLE",reason:r.reason??"UNKNOWN"};
  if(!cur||cur.truth_verdict!=="TRUE"||!pos(cur.spot_ltp))
    return {timeIst:hm,status:"MARKET_TRUTH_NOT_PROVEN",marketRows:atRows(r.market,t).length};
  const chainAt=(t0:number)=>{
    const set=atRows(r.chain,t0).filter(q=>String(q.expiry).slice(0,10)===EXPIRY&&q.truth_verdict==="TRUE");
    return set.length===1?set[0]:null;
  };
  const chain=chainAt(t),pc=chainAt(prev);
  const opts=eligible(atRows(r.options,t),cur,t);
  const previous=earlier?eligible(atRows(r.options,prev),earlier,prev):[];
  const weights=(type:"CE"|"PE")=>opts.filter(q=>q.option_type===type).reduce((sum,q)=>{
    const oi=num(q.oi);return sum+(oi!==null&&oi>=0?oi*Math.abs(Number(q.delta)):0);},0);
  const ceW=weights("CE"),peW=weights("PE");
  const deltaPcr=ceW>0&&peW>0?round(peW/ceW):null;
  const previousBy=new Map(previous.map(x=>[identity(x),x]));
  const pairs=[0.25,0.40,0.50].map(target=>{
    const p=choose(opts,target);
    if(!p)return {target,status:"NO_VERIFIED_PAIR"};
    const ce=p.ce,pe=p.pe,gap=Number(ce.ltp)-Number(pe.ltp);
    const cePrev=previousBy.get(identity(ce)),pePrev=previousBy.get(identity(pe));
    const comparable=cePrev&&pePrev&&earlier&&pos(earlier.spot_ltp)!==null;
    const previousGap=comparable?Number(cePrev.ltp)-Number(pePrev.ltp):null;
    const spotMove=comparable?Number(cur.spot_ltp)-Number(earlier!.spot_ltp):null;
    const gapMove=previousGap!==null?gap-previousGap:null;
    const hedgeBeta=comparable?Number(cePrev!.delta)-Number(pePrev!.delta):null;
    const change=(now:unknown,prior:unknown,monotonic=false)=>{
      const a=num(now),b=num(prior);
      return comparable&&a!==null&&b!==null&&a>=0&&b>=0&&(!monotonic||a>=b)?a-b:null;
    };
    return { target, status:"VERIFIED_RECORDED_PAIR",
      ceOi:num(ce.oi),peOi:num(pe.oi),
      ceRecordedVolume:num(ce.volume),peRecordedVolume:num(pe.volume),
      ceOneMinuteOiChange:change(ce.oi,cePrev?.oi),
      peOneMinuteOiChange:change(pe.oi,pePrev?.oi),
      ceOneMinuteVolumeChangeIfCumulative:change(ce.volume,cePrev?.volume,true),
      peOneMinuteVolumeChangeIfCumulative:change(pe.volume,pePrev?.volume,true),
      volumeWarning:"Interval volume only if archived field is cumulative in matching units",
      ceStrike:Number(ce.strike),peStrike:Number(pe.strike),
      ceDelta:Number(ce.delta),peDelta:Number(pe.delta),
      ceLtp:Number(ce.ltp),peLtp:Number(pe.ltp),
      ceQuoteAt:ce.quote_timestamp,peQuoteAt:pe.quote_timestamp,
      ceMinusPe:round(gap),sameContractsPreviousMinute:!!comparable,
      oneMinuteSpreadChange:gapMove===null?null:round(gapMove),
      oneMinuteSpotChange:spotMove===null?null:round(spotMove),
      oneMinuteDeltaAdjustedResidual:gapMove===null||spotMove===null||hedgeBeta===null
        ?null:round(gapMove-hedgeBeta*spotMove),
      note:"One-minute same-identity comparison, not rolled return or verified directional edge" };
  });
  const known = (rows:Row[],side:"CE"|"PE")=> rows.filter(q=>q.option_type===side).length;
  return {
    timeIst:hm,status:"RECORDED_MARKET_READ",
    spot:Number(cur.spot_ltp),spotPriorEligible:earlier?.truth_verdict==="TRUE"?num(earlier.spot_ltp):null,
    future:pos(cur.future_ltp),futureOi:num(cur.future_oi),
    indiaVix:pos(cur.india_vix),
    expiry:EXPIRY,
    atmStrike:num(chain?.atm_strike),
    atmMovedOneMinute:chain&&pc?shifted(pc.atm_strike,chain.atm_strike):null,
    ceWallStrike:num(chain?.call_wall_strike),peWallStrike:num(chain?.put_wall_strike),
    ceWallMovedOneMinute:chain&&pc?shifted(pc.call_wall_strike,chain.call_wall_strike):null,
    peWallMovedOneMinute:chain&&pc?shifted(pc.put_wall_strike,chain.put_wall_strike):null,
    reportedFullChainPcr:num(chain?.full_chain_oi_pcr),
    fullChainPcrProvenance:"CHAIN_STATE_FIELD_ONLY_NOT_INDEPENDENTLY_PROVEN",
    deltaWeightedOiObservedOnly:{ratioPeOverCe:deltaPcr,ceDeltaWeightedOi:round(ceW),
      peDeltaWeightedOi:round(peW),qualifiedCE:known(opts,"CE"),
      qualifiedPE:known(opts,"PE"),fullChain:false,
      note:"OBSERVED VALID RECORDED STRIKES ONLY; NOT TRUE FULL-CHAIN PCR/DEX/DEALER POSITIONING"},
    sameDeltaPairs:pairs,
    quality:{marketSnapshotId:cur.snapshot_id,
      selectedExpiryChainRowPresent:!!chain,
      validOptionRows:opts.length,allRecordedOptionsAtMinute:atRows(r.options,t).length,
      missingGreeksOrQuotesPreventFullChainClaim:true,
      previousMarketPresent:!!earlier},
  };
}
export async function runOct19Evidence() {
  const observations=[];
  for(const hm of TIMES){
    const t=bucketAt(hm);
    const p=iso(t-60000);
    const localPrevious=new Date(Date.parse(p)+19800000).toISOString().slice(11,16);
    // Reuse the existing read-only H1 replay authority; narrow 2-minute reads.
    const r=await runH1ReplayHttp({symbol:SYMBOL,tradeDate:DATE,
      fromTime:localPrevious,toTime:hm,scope:"FULL"});
    observations.push(summarizeOct19Evidence(r,hm));
  }
  return {ok:true,mode:"READ_ONLY_OCT19_NIFTY_CHAIN_EVENT_EVIDENCE_V1",
    date:DATE,symbol:SYMBOL,source:"EXISTING_H1_REPLAY_FULL_TWO_MINUTE_WINDOWS",
    observationTimesIst:[...TIMES],
    coverageWarning:"Per-minute recorded option strikes cannot be assumed complete full exchange chain",
    limitations:["No actual dealer-position net sign","No inferred OI transfer between wall strikes",
      "Quote age and source timestamps required","Not a predictive backtest or win rate",
      "No contract roll returns","PCR source unverified by independent canonical provenance"],
    safety:SAFETY,observations};
}
