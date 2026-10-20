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
OUT=pathlib.Path("oct19_nifty_observed_timeline.json")
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
        if t is not None and start<=t<=end and str(row.get("expiry",""))[:10]==EXPIRY:
            chain[t].append(row)
    for row in o:
        t=minute(row.get("minute_bucket"))
        if t is not None and start<=t<=end and str(row.get("expiry",""))[:10]==EXPIRY:
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
def option(t,strike,side):
    v=[o for o in options.get(t,[]) if n(o.get("strike"))==strike and o.get("option_type")==side]
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
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k not in ("events","fixedStartMatchedDelta025PairJourney")},separators=(",",":")),flush=True)
print("FIXED_JOURNEY",json.dumps(fixed,separators=(",",":")),flush=True)
for event in events[:85]:
    e={k:v for k,v in event.items() if k not in ("oldWallContract","newWallContract")}
    if "oldWallContract" in event:
        e["oldWallOiChange1m"]=event["oldWallContract"].get("oiChange")
        e["newWallOiChange1m"]=event["newWallContract"].get("oiChange")
        e["oldWallVolumeCounterDelta1m"]=event["oldWallContract"].get("volumeCounterDifferenceIfCumulative")
        e["newWallVolumeCounterDelta1m"]=event["newWallContract"].get("volumeCounterDifferenceIfCumulative")
    print("EVENT",json.dumps(e,separators=(",",":")),flush=True)
if len(events)>85: print("OUTPUT_TRUNCATED_EVENTS",len(events)-85,flush=True)
