#!/usr/bin/env python3
"""One-time, read-only 19-Oct NIFTY observed 1m timeline from existing H1 Replay.
Never sends orders, requests fresh market quotes, writes DB rows, or calculates trading signals.
All timestamps are actual recorded minute buckets, NOT estimated event tick times.
"""
import collections
import datetime as dt
import json
import math
import pathlib
import urllib.parse
import urllib.request

DAY="2026-10-19"
SYMBOL="NIFTY"
EXPIRY="2026-10-19"
IST=dt.timezone(dt.timedelta(hours=5,minutes=30))
URL="https://optionpilot-pro-v2-production.up.railway.app/api/research/h1-replay"
OUT=pathlib.Path("oct19_oct27_spread_volume_observations.json")
def utc(t): return t.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
def dtime(s):
    try:
        x=dt.datetime.fromisoformat(str(s).replace("Z","+00:00"))
        return x if x.tzinfo else None
    except (TypeError,ValueError): return None
def minute(t): return dtime(t).replace(second=0,microsecond=0) if dtime(t) else None
def ist(t): return t.astimezone(IST).strftime("%H:%M")
def n(v):
    if isinstance(v,bool) or v in (None,""):return None
    try:
        r=float(v);return r if math.isfinite(r) else None
    except (TypeError,ValueError):return None
def positive(v):
    x=n(v);return x if x is not None and x>0 else None
def rounded(v):
    return None if v is None else round(v,3)
def unpack(table):
    if not isinstance(table,dict):return []
    names=table.get("columns",[])
    return [dict(zip(names,row)) for row in table.get("rows",[])]
def singular(seq):
    return seq[0] if len(seq)==1 else None
def get_range(start,end):
    qs=urllib.parse.urlencode(dict(symbol=SYMBOL,date=DAY,
        **{"from":ist(start),"to":ist(end)},scope="FULL",format="compact",
        canonical="pcr-provenance"))
    req=urllib.request.Request(URL+"?"+qs,headers={"Accept":"application/json",
        "User-Agent":"OptionPilot-OneTime-Historical-1min-Evidence/1"})
    with urllib.request.urlopen(req,timeout=90) as response:
        if response.status!=200:raise RuntimeError("HTTP_RESPONSE_NOT_200")
        raw=response.read(10_000_001)
        if len(raw)>10_000_000:raise RuntimeError("WINDOW_EXCEEDS_10MB_BOUND")
    data=json.loads(raw)
    if not data.get("ok") or data.get("request",{}).get("tradeDate")!=DAY:
        raise RuntimeError("H1_REPLAY_UNAVAILABLE_OR_WRONG_DATE")
    return data

market=collections.defaultdict(list)
chain=collections.defaultdict(list)
chains_all=collections.defaultdict(list)
options=collections.defaultdict(list)
observed=collections.Counter()
start=dt.datetime(2026,10,19,9,15,tzinfo=IST)
end=dt.datetime(2026,10,19,15,30,tzinfo=IST)
chunk=dt.timedelta(minutes=30)
cursor=start
windows=0
while cursor<=end:
    last=min(end,cursor+chunk-dt.timedelta(minutes=1))
    data=get_range(cursor,last);windows+=1
    m=unpack(data.get("market"));c=unpack(data.get("chain"));o=unpack(data.get("options"))
    for row in m:
        t=minute(row.get("minute_bucket"))
        if t is not None and start<=t<=end:market[t].append(row)
    for row in c:
        t=minute(row.get("minute_bucket"))
        if t is not None and start<=t<=end and str(row.get("expiry",""))[:10] in ("2026-10-19","2026-10-27"):
            chains_all[t].append(row)
        if t is not None and start<=t<=end and str(row.get("expiry",""))[:10]==EXPIRY:
            chain[t].append(row)
    for row in o:
        t=minute(row.get("minute_bucket"))
        if t is not None and start<=t<=end and str(row.get("expiry",""))[:10] in ("2026-10-19","2026-10-27"):
            options[t].append(row)
    observed["rawMarket"]+=len(m);observed["rawChainAllExpiries"]+=len(c)
    observed["rawOptionsAllExpiries"]+=len(o)
    print("WINDOW",ist(cursor),ist(last),"market",len(m),"chain",len(c),"options",len(o),flush=True)
    cursor=last+dt.timedelta(minutes=1)

def accepted(t):
    m=singular(market.get(t,[]));c=singular(chain.get(t,[]))
    if not m or m.get("truth_verdict")!="TRUE" or positive(m.get("spot_ltp")) is None:
        return None
    if not c or c.get("truth_verdict")!="TRUE":
        return None
    # Chain has no market snapshot id; both truth-marked same-minute rows are
    # recorded evidence, but differing calculation versions are independently
    # flagged; NEVER silently treat them as one coherent calculation cycle.
    return m,c
def option(t,strike,side,expiry=EXPIRY):
    v=[o for o in options.get(t,[]) if n(o.get("strike"))==strike and o.get("option_type")==side and str(o.get("expiry",""))[:10]==expiry]
    r=singular(v)
    e=accepted(t)
    if not r or not e or r.get("truth_verdict")!="TRUE" or r.get("snapshot_id")!=e[0].get("snapshot_id"):
        return None
    if r.get("validation_status")!="RESEARCH_ELIGIBLE" or positive(r.get("ltp")) is None:
        return None
    age=n(r.get("quote_age_seconds"))
    q=dtime(r.get("quote_timestamp"))
    if age is None or not (0<=age<=30) or q is None or not (t<=q<t+dt.timedelta(minutes=1)):
        return None
    return r
def leg_change(a,b,side,from_t,to_t):
    if n(a)==None or n(b)==None:return None
    first=option(from_t,n(a),side)
    last=option(to_t,n(b),side)
    return None if first is None or last is None else {"prior":first,"current":last}
def same_leg_change(t,strike,side):
    before=option(t-dt.timedelta(minutes=1),strike,side)
    current=option(t,strike,side)
    if not before or not current:return {"status":"UNAVAILABLE_EXACT_PAIR"}
    oldoi=n(before.get("oi"));new_oi=n(current.get("oi"))
    vol0=n(before.get("volume"));vol1=n(current.get("volume"))
    return {"status":"OBSERVED_EXACT_CONTRACT",
      "strike":int(strike),"side":side,
      "oiBefore":oldoi,"oiNow":new_oi,
      "oiChange":rounded(new_oi-oldoi) if oldoi is not None and new_oi is not None else None,
      "volumeCounterBefore":vol0,"volumeCounterNow":vol1,
      "volumeCounterDifferenceIfCumulative":rounded(vol1-vol0) if vol0 is not None and vol1 is not None and vol1>=vol0 else None,
      "volumeSemantics":"CUMULATIVE_NOT_INDEPENDENTLY_CERTIFIED"}
def event_direction(v):
    return "UP" if v>0 else "DOWN" if v<0 else "UNCHANGED"
def metric_change(t,mins,key="spot_ltp"):
    first=accepted(t-dt.timedelta(minutes=mins));last=accepted(t)
    if not first or not last:return None
    a=n(first[0].get(key));b=n(last[0].get(key))
    return rounded(b-a) if a is not None and b is not None else None
def future_move(t,mins):
    now=accepted(t);later=accepted(t+dt.timedelta(minutes=mins))
    if not now or not later:return None
    a=positive(now[0].get("spot_ltp"));b=positive(later[0].get("spot_ltp"))
    return rounded(b-a) if a is not None and b is not None else None

events=[]
counts=collections.Counter()
quality=collections.Counter()
prev=None
t=start
while t<=end:
    x=accepted(t)
    if x is None:
        quality["missingOrNontruthMarketChain"]+=1
    else:
        quality["validSameMinuteMarketChain"]+=1
        if prev is not None and t-prev[0]==dt.timedelta(minutes=1):
            prev_t, (pm,pc)=prev
            m,c=x
            fields=[
                ("ATM_SHIFT","atm_strike",False,None),
                ("CE_WALL_MOVE","call_wall_strike",True,"CE"),
                ("PE_WALL_MOVE","put_wall_strike",True,"PE")]
            for kind,col,with_leg,side in fields:
                a=n(pc.get(col));b=n(c.get(col))
                if a is None or b is None or a==b:continue
                e={"timeIst":ist(t),"event":kind,"beforeStrike":int(a),
                   "afterStrike":int(b),"direction":event_direction(b-a),
                   "spotBefore":n(pm.get("spot_ltp")),"spotAt":n(m.get("spot_ltp")),
                   "spotDelta1m":metric_change(t,1),"spotDelta5m":metric_change(t,5),
                   "spotDelta15m":metric_change(t,15),
                   "forwardSpot5mRetrospective":future_move(t,5),
                   "forwardSpot15mRetrospective":future_move(t,15),
                   "pcrBefore":n(pc.get("full_chain_oi_pcr")),
                   "pcrAt":n(c.get("full_chain_oi_pcr")),
                   "futureAt":n(m.get("future_ltp")),
                   "futureOiAt":n(m.get("future_oi")),
                   "vixAt":n(m.get("india_vix")),
                   "source":"ACTUAL_ADJACENT_1MIN_CHAIN_MARKED_TRUE"}
                if with_leg:
                    old=same_leg_change(t,int(a),side)
                    new=same_leg_change(t,int(b),side)
                    e["oldWallContract"]=old
                    e["newWallContract"]=new
                    old_d=old.get("oiChange")
                    new_d=new.get("oiChange")
                    if old_d is not None and new_d is not None:
                        e["wallOiRelation"]="OLD_LOWER_NEW_HIGHER" if old_d<0 and new_d>0 else "RANK_CHANGED_OTHER_OI_PATTERN"
                    else:
                        e["wallOiRelation"]="OI_CHANGE_UNVERIFIED"
                events.append(e);counts[kind]+=1
            pcr0=positive(pc.get("full_chain_oi_pcr"))
            pcr1=positive(c.get("full_chain_oi_pcr"))
            if pcr0 is not None and pcr1 is not None and (pcr0-1)*(pcr1-1)<0:
                events.append({"timeIst":ist(t),"event":"RECORDED_PCR_CROSS_1",
                    "pcrBefore":round(pcr0,4),"pcrAt":round(pcr1,4),
                    "spotAt":n(m.get("spot_ltp")),"spotDelta1m":metric_change(t,1),
                    "forwardSpot15mRetrospective":future_move(t,15),
                    "pcrProvenance":"CHAIN_STATE_RECORDED_FIELD_NOT_INDEPENDENT_FULL_CHAIN_PROOF"})
                counts["RECORDED_PCR_CROSS_1"]+=1
        prev=(t,x)
    t+=dt.timedelta(minutes=1)

# Explicit data-quality transparency: version conflict is NOT zero data.
for label in ["10:33","11:33","12:33","13:33","14:33"]:
    sample=dt.datetime.fromisoformat(DAY+"T"+label+":00+05:30")
    mm=singular(market.get(sample,[]))
    cc=singular(chain.get(sample,[]))
    print("PROVENANCE",label,
        "marketRows",len(market.get(sample,[])),"chainRows",len(chain.get(sample,[])),
        "marketTruth",mm.get("truth_verdict") if mm else None,
        "chainTruth",cc.get("truth_verdict") if cc else None,
        "marketVersion",mm.get("calculation_version") if mm else None,
        "chainVersion",cc.get("calculation_version") if cc else None,flush=True)
quality["calculationVersionMismatchMinutes"]=sum(
    1 for mm,cc in (pair for t in market for pair in [accepted(t)] if pair is not None)
    if mm.get("calculation_version")!=cc.get("calculation_version"))

# Four-hour fixed-contract price and OI/volume journey, never switch identities.
fixed=[{"timeIst":hm} for hm in ["10:33","11:33","12:33","13:33","14:33"]]
for obj in fixed:
    t=dt.datetime.fromisoformat(DAY+"T"+obj["timeIst"]+":00+05:30")
    cur=accepted(t)
    obj["spot"]=n(cur[0].get("spot_ltp")) if cur else None
    for side,strike in [("CE",23200),("PE",22950)]:
        q=option(t,strike,side)
        obj[side]={"strike":strike,"premium":n(q.get("ltp")) if q else None,
                   "delta":n(q.get("delta")) if q else None,
                   "oi":n(q.get("oi")) if q else None,
                   "volumeCounter":n(q.get("volume")) if q else None}
summary={
 "date":DAY,"symbol":SYMBOL,"expiry":EXPIRY,"cadence":"EXACT_1M_NO_INTERPOLATION",
 "readOnly":True,"writesPerformed":False,"brokerRequests":False,"createsOrders":False,
 "windows":windows,"observed":dict(observed),"quality":dict(quality),"counts":dict(counts),
 "eventCount":len(events),
 "cautions":["All event times are recorded minute bucket timestamps, not individual order/trade times",
    "All wall changes represent change of top OI rank, NOT proven transfer of positions",
    "Recorded PCR source not independently certified as full chain",
    "Volume is archived contract counter; interval difference is valid only when cumulative units/source verified",
    "Outcome fields are RETROSPECTIVE, not predictive proof",
    "No synthetic missing buckets, no timestamp interpolation or cross-contract return stitching",
    "Market/chain calculation-version mismatches are counted separately; source coherency NOT independently proven"],
 "fixedStartMatchedDelta025PairJourney":fixed,
 "events":events,
}
OUT.write_text(json.dumps(summary,indent=2),encoding="utf-8")


# Same-Delta-at-start fixed identities, never roll the strikes or expiry.
# Exact 1m volumes are inferred ONLY when monotone recorded contract counters
# have qualified exact previous-minute observations; this does not certify
# the provider's exchange-volume semantics.
import statistics
PAIRS={
 "2026-10-19": {"CE":23200,"PE":22950,"anchorIst":"10:33"},
 "2026-10-27": {"CE":23400,"PE":22800,"anchorIst":"10:33"}
}
def qpair(t,expiry):
    ms=market.get(t,[])
    cs=[c for c in chains_all.get(t,[]) if str(c.get("expiry",""))[:10]==expiry]
    m=singular(ms);c=singular(cs)
    if m is None or c is None or m.get("truth_verdict")!="TRUE" or c.get("truth_verdict")!="TRUE":
        return None
    if positive(m.get("spot_ltp")) is None:
        return None
    identity=PAIRS[expiry]
    rows={}
    for side in ("CE","PE"):
        ss=[q for q in options.get(t,[]) if str(q.get("expiry",""))[:10]==expiry and q.get("option_type")==side and n(q.get("strike"))==identity[side]]
        r=singular(ss)
        if r is None or r.get("truth_verdict")!="TRUE" or r.get("snapshot_id")!=m.get("snapshot_id"):
            return None
        if r.get("validation_status")!="RESEARCH_ELIGIBLE" or positive(r.get("ltp")) is None:
            return None
        at=dtime(r.get("quote_timestamp"))
        age=n(r.get("quote_age_seconds"))
        if at is None or not (t<=at<t+dt.timedelta(minutes=1)) or age is None or not 0<=age<=30:
            return None
        rows[side]=r
    return m,c,rows
def percentile(vals,p):
    z=sorted(vals)
    if not z:return None
    idx=(len(z)-1)*p
    j=int(idx); k=min(j+1,len(z)-1)
    return z[j]+(z[k]-z[j])*(idx-j)
def pearson(a,b):
    if len(a)<3 or len(a)!=len(b):return None
    ma=statistics.mean(a);mb=statistics.mean(b)
    va=sum((x-ma)**2 for x in a);vb=sum((x-mb)**2 for x in b)
    return round(sum((x-ma)*(y-mb) for x,y in zip(a,b))/(va*vb)**0.5,4) if va>0 and vb>0 else None
def simple(s):
    return round(s,4) if s is not None else None

results={}
all_pair_points={}
for expiry in PAIRS:
    points={}
    curr=dt.datetime.fromisoformat(DAY+"T"+PAIRS[expiry]["anchorIst"]+":00+05:30")
    rejected=collections.Counter()
    rawVolumeCounterFound=collections.Counter()
    while curr<=end:
        x=qpair(curr,expiry)
        if x:
            m,c,rs=x
            ce,pe=rs["CE"],rs["PE"]
            vol_ce=n(ce.get("volume"));vol_pe=n(pe.get("volume"))
            if vol_ce is not None and vol_ce>=0:rawVolumeCounterFound["CE"]+=1
            if vol_pe is not None and vol_pe>=0:rawVolumeCounterFound["PE"]+=1
            points[curr]={
               "timeIst":ist(curr),"spot":n(m.get("spot_ltp")),
               "spread":round(n(ce.get("ltp"))-n(pe.get("ltp")),4),
               "cePrice":n(ce.get("ltp")),"pePrice":n(pe.get("ltp")),
               "ceVolumeCounter":vol_ce if vol_ce is not None and vol_ce>=0 else None,
               "peVolumeCounter":vol_pe if vol_pe is not None and vol_pe>=0 else None,
               "callWall":c.get("call_wall_strike"),"putWall":c.get("put_wall_strike"),
               "pcr":n(c.get("full_chain_oi_pcr")),
               "ceOi":n(ce.get("oi")),"peOi":n(pe.get("oi")),
               "ceDelta":n(ce.get("delta")),"peDelta":n(pe.get("delta")),
               "ceGamma":n(ce.get("gamma")),"peGamma":n(pe.get("gamma")),
               "marketExchangeTimestamp":m.get("exchange_timestamp"),
               "marketFreshnessStatus":m.get("freshness_status"),
               "snapshotId":m.get("snapshot_id"),
               "marketVersion":m.get("calculation_version"),
               "chainVersion":c.get("calculation_version")
            }
        else:rejected["missingQualification"]+=1
        curr+=dt.timedelta(minutes=1)
    all_pair_points[expiry]=points
    increments=[];validPointPairs=[];volumeNegatives=collections.Counter()
    for t,p in points.items():
        prev=points.get(t-dt.timedelta(minutes=1))
        if not prev:
            continue
        dSpread=round(p["spread"]-prev["spread"],4)
        dSpot=round(p["spot"]-prev["spot"],4)
        it={"timeIst":ist(t),"expiry":expiry,"spread":p["spread"],"dSpread1m":dSpread,
            "spot":p["spot"],"dSpot1m":dSpot,"callWall":p["callWall"],"putWall":p["putWall"],
            "pcr":p["pcr"],"ceVolumeCounter":p["ceVolumeCounter"],"peVolumeCounter":p["peVolumeCounter"]}
        for side in ("ce","pe"):
            a=p.get(side+"VolumeCounter");b=prev.get(side+"VolumeCounter")
            if a is None or b is None:
                it[side+"VolumeIncrement"]=None
                rejected[side+"MissingVolumeCounter"]+=1
            elif a<b:
                it[side+"VolumeIncrement"]=None
                volumeNegatives[side]+=1
            else:it[side+"VolumeIncrement"]=a-b
        cv,pv=it["ceVolumeIncrement"],it["peVolumeIncrement"]
        if cv is not None and pv is not None:
            it["totalVolumeIncrement"]=cv+pv
            it["peVolumeShare"]=round(pv/(cv+pv),4) if cv+pv>0 else None
            it["directionAgreesWithVolumeDominance"]=(
                (dSpread<0 and pv>cv) or (dSpread>0 and cv>pv))
            increments.append(it)
        else:it["totalVolumeIncrement"]=None
        validPointPairs.append(it)
    active=[x for x in increments if x["totalVolumeIncrement"]>0]
    highSpread=percentile([abs(x["dSpread1m"]) for x in active],0.75)
    highVol=percentile([x["totalVolumeIncrement"] for x in active],0.75)
    meets=[x for x in active if len(active)>=20 and highSpread>0 and highVol>0 and
           abs(x["dSpread1m"])>=highSpread and x["totalVolumeIncrement"]>=highVol]
    def project(x):
        return {"timeIst":x["timeIst"],"spot":x["spot"],"dSpot1m":x["dSpot1m"],
                "spread":x["spread"],"dSpread1m":x["dSpread1m"],
                "CEvolumeIncrement":x["ceVolumeIncrement"],"PEvolumeIncrement":x["peVolumeIncrement"],
                "totalVolumeIncrement":x["totalVolumeIncrement"],"peVolumeShare":x["peVolumeShare"],
                "directionMatchesVolumeDominance":x["directionAgreesWithVolumeDominance"],
                "callWall":x["callWall"],"putWall":x["putWall"],"pcr":x["pcr"]}
    dSpreadHourly={p["timeIst"]:{"spread":p["spread"],"CEpremium":p["cePrice"],"PEpremium":p["pePrice"],
                                    "CEvolumeCounter":p["ceVolumeCounter"],"PEvolumeCounter":p["peVolumeCounter"],
                                    "spot":p["spot"]}
                   for t,p in points.items() if p["timeIst"] in ("10:33","11:33","12:33","13:33","14:33")}
    comparison={
      "expiry":expiry,"fixedPair":{"CE":PAIRS[expiry]["CE"],"PE":PAIRS[expiry]["PE"]},
      "rawCounterCoverageQualified":dict(rawVolumeCounterFound),
      "qualifiedMinutePricePairs":len(points),"adjacentQualifiedPricePairs":len(validPointPairs),
      "adjacentQualifiedVolumePairs":len(increments),"activePositiveCounterDifferences":len(active),
      "counterDecreases":dict(volumeNegatives),
      "missingOrNonqualifyingMinuteCount":rejected["missingQualification"],
      "missingVolumePairsByLeg":{"CE":rejected["ceMissingVolumeCounter"],"PE":rejected["peMissingVolumeCounter"]},
      "priceVolumeCorrelationConditional":pearson([x["totalVolumeIncrement"] for x in active],
                                                [abs(x["dSpread1m"]) for x in active]),
      "directionalVolumeDominanceMatches":sum(x["directionAgreesWithVolumeDominance"] for x in active if x["dSpread1m"]!=0),
      "directionalVolumeDominanceEligible":sum(x["dSpread1m"]!=0 for x in active),
      "thresholdAbsSpreadChangeP75":simple(highSpread),"thresholdVolumeIncrementP75":simple(highVol),
      "meetingMinutes":len(meets),
      "meetingDirectionalMatches":sum(x["directionAgreesWithVolumeDominance"] for x in meets),
      "meetingExamples":[project(x) for x in sorted(meets,key=lambda r:abs(r["dSpread1m"]),reverse=True)[:12]],
      "largestAbsSpread1mExamples":[project(x) for x in sorted(active,key=lambda r:abs(r["dSpread1m"]),reverse=True)[:10]],
      "hourlyCheckpoints":dSpreadHourly,
      "reasonIfNoMeaningfulComparison":(
        "MISSING_VOLUME_COUNTERS_OR_QUALIFIED_CONSECUTIVE_MINUTES" if len(active)<20
        else "DESCRIPTIVE_COINCIDENCE_ONLY_NO_CAUSAL_CLAIM")
    }
    results[expiry]=comparison
    print("VOLUME_SPREAD_RESULT",json.dumps(comparison,separators=(",",":"),default=str),flush=True)
# Both expiries at exact same qualified minute; never splice fixed pair identities.
a={p["timeIst"]:p for p in []}
def _timeline_for_expiry(e):
    out={}
    for t in sorted(market):
        x=qpair(t,e)
        if x:
            m,c,rows=x
            out[ist(t)]={"timeIst":ist(t),"spread":round(n(rows["CE"].get("ltp"))-n(rows["PE"].get("ltp")),4),
                         "spot":n(m.get("spot_ltp"))}
    return out
T19=_timeline_for_expiry("2026-10-19")
T27=_timeline_for_expiry("2026-10-27")
overlap=sorted(set(T19)&set(T27))
print("CROSS_DTE_SPREAD_OVERLAP",json.dumps({"matchedExactMinuteCount":len(overlap),
   "first":overlap[0] if overlap else None,"last":overlap[-1] if overlap else None,
   "checkpoints":[{"timeIst":t,"spread19":T19[t]["spread"],"spread27":T27[t]["spread"]}
       for t in ("10:33","11:33","12:33","13:33","14:33") if t in T19 and t in T27]},separators=(",",":")),flush=True)
summary["premiumVolumeCoMovement"]=results
summary["studyScope"]="RESEARCH_ONLY; recorded contract cumulative volume counter increments CONDITIONAL ON SOURCE SEMANTICS; not actual broker dealer gamma/volume or predictive effect"
summary["recorderExpiryList"]=list(PAIRS)
summary["sameMinuteCrossExpirySpotSpreadOverlap"]=len(overlap)
OUT.write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8")
print("AUDIT_COMPLETE",OUT,flush=True)

# Devil Check 2: ONLY after 10:33 Delta anchor, BEFORE late-session
# repeatedly stamped Spot. Retrospective decomposition, never a trade rule.
strict={}
for expiry,pts in all_pair_points.items():
    rows=[]
    exclusions=collections.Counter()
    for t,p in sorted(pts.items()):
        prev=pts.get(t-dt.timedelta(minutes=1))
        if not prev: continue
        if ist(t)>"15:00":
            exclusions["AFTER_15_00_LATE_SPOT_SOURCE_REPEATS_NOT_CHECKED"]+=1
            continue
        ex0=dtime(prev.get("marketExchangeTimestamp"));ex1=dtime(p.get("marketExchangeTimestamp"))
        if ex0 is None or ex1 is None:
            exclusions["SPOT_SOURCE_TIMESTAMP_MISSING"]+=1
            continue
        if not ex1>ex0:
            exclusions["SPOT_SOURCE_TIMESTAMP_NOT_ADVANCING"]+=1
            continue
        cv0=prev.get("ceVolumeCounter");pv0=prev.get("peVolumeCounter")
        cv1=p.get("ceVolumeCounter");pv1=p.get("peVolumeCounter")
        if None in (cv0,pv0,cv1,pv1):
            exclusions["VOLUME_COUNTER_MISSING"]+=1
            continue
        if cv1<cv0 or pv1<pv0:
            exclusions["VOLUME_COUNTER_DECREASE"]+=1
            continue
        if None in (prev.get("ceDelta"),prev.get("peDelta")):
            exclusions["ARCHIVED_DELTA_MISSING"]+=1
            continue
        dSpot=p["spot"]-prev["spot"];dSpread=p["spread"]-prev["spread"]
        beta=prev["ceDelta"]-prev["peDelta"]
        residue=dSpread-beta*dSpot
        gammaCe=prev.get("ceGamma");gammaPe=prev.get("peGamma")
        gammaResidual=(residue-0.5*(gammaCe-gammaPe)*dSpot*dSpot
                       if gammaCe is not None and gammaPe is not None else None)
        ceVolume=cv1-cv0;peVolume=pv1-pv0
        if ceVolume+peVolume<=0:
            exclusions["NO_RECORDED_INCREMENT"]+=1
            continue
        row={"timeIst":ist(t),"spot":p["spot"],"dSpot":round(dSpot,3),
             "spread":p["spread"],"dSpread":round(dSpread,3),
             "ceVolInc":round(ceVolume,3),"peVolInc":round(peVolume,3),
             "totalVolInc":round(ceVolume+peVolume,3),
             "peVolShare":round(peVolume/(ceVolume+peVolume),4),
             "rawDeltaAdjustedResidual":round(residue,4),
             "gammaDeltaAdjustedResidual":round(gammaResidual,4) if gammaResidual is not None else None,
             "betaFromPriorGreeks":round(beta,4),
             "sourceTimeBefore":prev["marketExchangeTimestamp"],
             "sourceTimeAt":p["marketExchangeTimestamp"],
             "sourceFreshnessAt":p["marketFreshnessStatus"],
             "rawDirectionMatchesVolumeSide":(
                (dSpread<0 and peVolume>ceVolume) or (dSpread>0 and ceVolume>peVolume)),
             "residualDirectionMatchesVolumeSide":(
                (residue<0 and peVolume>ceVolume) or (residue>0 and ceVolume>peVolume))}
        rows.append(row)
    if len(rows)>=20:
        changeThreshold=percentile([abs(r["dSpread"]) for r in rows],0.75)
        volumeThreshold=percentile([r["totalVolInc"] for r in rows],0.75)
        joint=[r for r in rows if abs(r["dSpread"])>=changeThreshold and r["totalVolInc"]>=volumeThreshold]
    else:
        changeThreshold=volumeThreshold=None
        joint=[]
    summaryStrict={
      "expiry":expiry,"fixedPair":PAIRS[expiry],"fullPriceMinuteCoverage":results[expiry]["qualifiedMinutePricePairs"],
      "strictSourceFreshExactMinuteVolumePairsAfter1033Before1500":len(rows),
      "exclusions":dict(exclusions),
      "thresholdAbsSpreadP75":simple(changeThreshold),
      "thresholdVolumeIncrementP75":simple(volumeThreshold),
      "rawSpreadAbsVsVolumeCorrelation":pearson([r["totalVolInc"] for r in rows],[abs(r["dSpread"]) for r in rows]),
      "residualAbsVsVolumeCorrelation":pearson([r["totalVolInc"] for r in rows],[abs(r["rawDeltaAdjustedResidual"]) for r in rows]),
      "rawSpreadVsSpotCorrelation":pearson([r["dSpot"] for r in rows],[r["dSpread"] for r in rows]),
      "retrospectiveHighVolumeHighSpreadCoincidences":len(joint),
      "dominantVolumeDirectionMatchesRaw":sum(r["rawDirectionMatchesVolumeSide"] for r in joint),
      "dominantVolumeDirectionMatchesDeltaResidual":sum(r["residualDirectionMatchesVolumeSide"] for r in joint),
      "topVerifiedJointEvents":sorted(joint,key=lambda r:abs(r["dSpread"]),reverse=True)[:15],
      "largestDeltaAdjustedOutliersWithVolume":sorted(rows,key=lambda r:abs(r["rawDeltaAdjustedResidual"]),reverse=True)[:10],
      "quality":"NO_STATISTICAL_EDGE_OR_CAUSALITY; COUNTER_UNIT_SEMANTICS_UNVERIFIED"}
    strict[expiry]=summaryStrict
    print("STRICT_POST_ANCHOR_RESULT",json.dumps(summaryStrict,separators=(",",":"),allow_nan=False),flush=True)
summary["strictPostAnchorSpotSourceVerified"]=strict
OUT.write_text(json.dumps(summary,indent=2,default=str),encoding="utf-8")
