#!/usr/bin/env python3
"""One-time 19-Oct-2026 H1 evidence: 3 futures reactions and real expiry premiums.
Read-only existing H1 replay only. Never infer missing futures-specific PDH.
"""
import collections,datetime as dt,json,math,urllib.parse,urllib.request
DAY="2026-10-19"
SYMBOLS=("NIFTY","BANKNIFTY","SENSEX")
IST=dt.timezone(dt.timedelta(hours=5,minutes=30))
API="https://optionpilot-pro-v2-production.up.railway.app/api/research/h1-replay"
ANCHOR="10:33"
def n(v):
    try:
        if v is None or v=="" or isinstance(v,bool):return None
        x=float(v)
        return x if math.isfinite(x) else None
    except(TypeError,ValueError):return None
def date(v):return str(v or "")[:10]
def instant(v):
    try:
        s=dt.datetime.fromisoformat(str(v).replace("Z","+00:00"))
        return s if s.tzinfo else None
    except(TypeError,ValueError):return None
def minute(v):
    d=instant(v)
    return d.replace(second=0,microsecond=0) if d else None
def timestamp(s):return dt.datetime.fromisoformat(DAY+"T"+s+":00+05:30")
def clock(t):return t.astimezone(IST).strftime("%H:%M")
def unpack(r,k):
    x=r.get(k,{})
    if not isinstance(x,dict):return x if isinstance(x,list) else []
    cols=x.get("columns",[])
    return [dict(zip(cols,row)) for row in x.get("rows",[])]
def fetch(symbol,st,en):
    q=urllib.parse.urlencode({"symbol":symbol,"date":DAY,"from":clock(st),"to":clock(en),"scope":"FULL","format":"compact"})
    with urllib.request.urlopen(urllib.request.Request(API+"?"+q,headers={"Accept":"application/json","User-Agent":"OptionPilot-ThreeFuturePDH-HistoricalReadOnly/1"}),timeout=90) as response:
        raw=response.read(10000001)
    if len(raw)>10000000:raise RuntimeError("OVER_10MB_WINDOW")
    obj=json.loads(raw)
    if not obj.get("ok") or obj.get("request",{}).get("tradeDate")!=DAY:raise RuntimeError("WRONG_DATE_OR_REPLAY_UNAVAILABLE_"+str(obj.get("reason")))
    return obj
raw={sym:{"m":collections.defaultdict(list),"c":collections.defaultdict(list),"o":collections.defaultdict(list)} for sym in SYMBOLS}
start=timestamp("09:15");end=timestamp("15:30")
for sym in SYMBOLS:
    t=start; k=0
    while t<=end:
        hi=min(end,t+dt.timedelta(minutes=29))
        r=fetch(sym,t,hi);k+=1
        for key,alias in (("market","m"),("chain","c"),("options","o")):
            for row in unpack(r,key):
                bt=minute(row.get("minute_bucket"))
                if bt and start<=bt<=end: raw[sym][alias][bt].append(row)
        t=hi+dt.timedelta(minutes=1)
    print("SOURCE",json.dumps({"symbol":sym,"windows":k,"marketBuckets":len(raw[sym]["m"]),"chainBuckets":len(raw[sym]["c"]),"optionBuckets":len(raw[sym]["o"])},separators=(",",":")),flush=True)
def unique(rs):return rs[0] if len(rs)==1 else None
def market(sym,t):
    m=unique(raw[sym]["m"].get(t,[]))
    return m if m and m.get("truth_verdict")=="TRUE" and (n(m.get("spot_ltp")) or 0)>0 else None
def chain(sym,t,expiry):
    rows=[r for r in raw[sym]["c"].get(t,[]) if date(r.get("expiry"))==expiry]
    c=unique(rows)
    return c if c and c.get("truth_verdict")=="TRUE" else None
def opt(sym,t,expiry,side,strike):
    m=market(sym,t)
    rows=[r for r in raw[sym]["o"].get(t,[]) if date(r.get("expiry"))==expiry and r.get("option_type")==side and n(r.get("strike"))==strike]
    r=unique(rows)
    if not (r and m and r.get("truth_verdict")=="TRUE" and r.get("snapshot_id")==m.get("snapshot_id")
        and r.get("validation_status")=="RESEARCH_ELIGIBLE" and (n(r.get("ltp")) or 0)>0):return None
    q=instant(r.get("quote_timestamp"));age=n(r.get("quote_age_seconds"))
    if q is None or not(t<=q<t+dt.timedelta(minutes=1)) or age is None or not 0<=age<=30:return None
    return r
def future(sym,t):
    m=market(sym,t)
    return n(m.get("future_ltp")) if m and (n(m.get("future_ltp")) or 0)>0 else None
def future_move(sym,t):
    prior=future(sym,t-dt.timedelta(minutes=1));now=future(sym,t)
    if prior is None or now is None:return None
    return round(now-prior,4)
def side_move(sym,t,expiry,side,strike):
    a=opt(sym,t-dt.timedelta(minutes=1),expiry,side,strike)
    b=opt(sym,t,expiry,side,strike)
    return round(n(b["ltp"])-n(a["ltp"]),4) if a and b else None
def sign(v):return "UP" if v>0 else "DOWN" if v<0 else "FLAT"
def med(xs):return round(sorted(xs)[len(xs)//2],3) if xs else None
selected={}; inventory={}
for sym in SYMBOLS:
    expiries=sorted({date(r.get("expiry")) for t,rr in raw[sym]["o"].items() for r in rr if date(r.get("expiry"))>=DAY})
    counts={e:sum(1 for t,rr in raw[sym]["o"].items() for r in rr if date(r.get("expiry"))==e) for e in expiries}
    optionsAtAnchor={e:sum(1 for r in raw[sym]["o"].get(timestamp(ANCHOR),[]) if date(r.get("expiry"))==e) for e in expiries}
    requested={e:counts.get(e,0) for e in ("2026-10-19","2026-10-27")}
    inventory[sym]={"recordedExpiries":expiries,"totalOptionRowsByExpiry":counts,"rowsAt1033":optionsAtAnchor,"requested":requested}
    chosen={}
    for expiry in expiries[:2]:
        anchor=timestamp(ANCHOR)
        # If exact first clock missing, scan up to 11:00 and disclose chosen start.
        best=None
        while anchor<=timestamp("11:00") and best is None:
            if chain(sym,anchor,expiry):
                sides={}
                for side in ("CE","PE"):
                    potential=[]
                    for r in raw[sym]["o"].get(anchor,[]):
                        strike=n(r.get("strike"));delta=n(r.get("delta"))
                        if strike is None or delta is None or date(r.get("expiry"))!=expiry or r.get("option_type")!=side:continue
                        if not(0.2<=delta<=0.8 if side=="CE" else -0.8<=delta<=-0.2):continue
                        match=opt(sym,anchor,expiry,side,strike)
                        if match:potential.append((abs(abs(delta)-.5),strike,delta))
                    if potential:
                        possible=sorted(potential,key=lambda x:(x[0],x[1]))[0]
                        sides[side]={"strike":possible[1],"anchorDelta":round(possible[2],5)}
                if "CE" in sides and "PE" in sides:
                    best={"expiry":expiry,"anchorIst":clock(anchor),"CE":sides["CE"],"PE":sides["PE"]}
            anchor+=dt.timedelta(minutes=1)
        chosen[expiry]=best
    selected[sym]=chosen
    print("INVENTORY",json.dumps({"symbol":sym,**inventory[sym],"matchedHalfDeltaPairs":chosen},separators=(",",":")),flush=True)
anchor=start
perSymbol={}
minuteResult={}
for sym in SYMBOLS:
    spotPdh={}
    freshFuture=0
    pdhEvents=[]
    nearPdh=[]
    for t in sorted(raw[sym]["m"]):
        m=market(sym,t)
        if not m:continue
        f=future(sym,t)
        if f is not None:freshFuture+=1
        pdh=n(m.get("pdh"));spot=n(m.get("spot_ltp"))
        if pdh is not None and pdh>0: spotPdh[pdh]=spotPdh.get(pdh,0)+1
        if not(pdh is not None and pdh>0 and spot is not None and f is not None):continue
        prev=market(sym,t-dt.timedelta(minutes=1))
        if not prev or n(prev.get("pdh"))!=pdh or future_move(sym,t) is None:continue
        pspot=n(prev.get("spot_ltp"))
        kind=("SPOT_PDH_BREAK" if pspot<pdh<=spot else
              "SPOT_PDH_LOST" if pspot>=pdh>spot else None)
        nearby=abs(spot-pdh)/pdh<=0.0015
        if kind or nearby:
            z={"at":clock(t),"spot":spot,"spotPdh":pdh,"spotPrev":pspot,
               "future":f,"futureDelta1m":future_move(sym,t),
               "spotPDHEvent":kind or "SPOT_WITHIN_0.15PCT_OF_PDH",
               "futurePDHLevel":"UNAVAILABLE"}
            if kind:pdhEvents.append(z)
            if nearby:nearPdh.append(z)
    perSymbol[sym]={"qualifiedMarketMinutes":sum(bool(market(sym,t)) for t in raw[sym]["m"]),
                     "positiveFutureMinutes":freshFuture,
                     "spotPdhValuesObserved":sorted(({"level":v,"observations":cnt} for v,cnt in spotPdh.items()),key=lambda x:-x["observations"])[:5],
                     "futurePDHStatus":"NOT_RECORDED_CONTRACT_SPECIFIC_PRIOR_HIGH",
                     "spotPdhCrossingCount":len(pdhEvents),
                     "spotPdhCrossings":pdhEvents[:15],
                     "nearSpotPDHCount":len(nearPdh),
                     "nearSpotPDHFirst":nearPdh[:8]}
    print("PDH",json.dumps({"symbol":sym,**perSymbol[sym]},separators=(",",":")),flush=True)
synchronous=[]
supported=collections.Counter();optionConcord=collections.Counter()
for k in range(0,376):
    t=start+dt.timedelta(minutes=k)
    futures={sym:future_move(sym,t) for sym in SYMBOLS}
    if any(v is None for v in futures.values()):continue
    supported["tripleFutures1m"]+=1
    futDirections={sym:sign(v) for sym,v in futures.items()}
    same= len(set(futDirections.values()))==1 and "FLAT" not in futDirections.values()
    if same: supported["allSameFutureSign"]+=1
    expiryResponse={}
    for sym in SYMBOLS:
        expiryResponse[sym]={}
        for e,pair in selected[sym].items():
            if pair is None or t<=timestamp(pair["anchorIst"]):continue
            ce=side_move(sym,t,e,"CE",pair["CE"]["strike"])
            pe=side_move(sym,t,e,"PE",pair["PE"]["strike"])
            if ce is not None and pe is not None:
                observed="CE_UP_PE_DOWN" if ce>0 and pe<0 else "CE_DOWN_PE_UP" if ce<0 and pe>0 else "MIXED_OR_FLAT"
                expected=("CE_UP_PE_DOWN" if futures[sym]>0 else "CE_DOWN_PE_UP" if futures[sym]<0 else "NEUTRAL")
                follows=observed==expected
                expiryResponse[sym][e]={"ceChange1m":ce,"peChange1m":pe,"relation":observed,
                                          "futuresDirectionAligned":follows}
                optionConcord[sym+"|"+e+"|samples"]+=1
                if follows:optionConcord[sym+"|"+e+"|agree"]+=1
    allSymbolsCovered=all(expiryResponse[s] for s in SYMBOLS)
    allAvailableAlign=all(v["futuresDirectionAligned"] for q in expiryResponse.values() for v in q.values()) if allSymbolsCovered else False
    crossExpiryCovered=all(len(expiryResponse[s])>=min(2,len(selected[s])) for s in SYMBOLS)
    if same and allSymbolsCovered:supported["sameFutures3PremiumSymbolsCovered"]+=1
    if same and allSymbolsCovered and allAvailableAlign:supported["sameFuturesAllAvailablePremiumAlign"]+=1
    if same and crossExpiryCovered:supported["sameFuturesAllExpectedExpiriesAvailable"]+=1
    if same and allAvailableAlign:supported["sameFuturesCompleteAligned"]+=1
    if same:
        magnitude=sum(abs(futures[s])/future(s,t-dt.timedelta(minutes=1)) for s in SYMBOLS)
        spotPDHNear={s: bool(market(s,t) and n(market(s,t).get("pdh")) and abs(n(market(s,t).get("spot_ltp"))-n(market(s,t).get("pdh")))/n(market(s,t).get("pdh"))<=.0015) for s in SYMBOLS}
        synchronous.append({"at":clock(t),"direction":futDirections["NIFTY"],"futuresChange":futures,
                            "meanFractionalMove":round(magnitude/3,6),
                            "spotPdhNear":spotPDHNear,
                            "premium":expiryResponse,
                            "threeSymbolsHaveValidPremiums":allSymbolsCovered,
                            "allAvailablePremiumsAlign":allAvailableAlign,
                            "allExpectedExpiriesCovered":crossExpiryCovered})
    if same and allSymbolsCovered and allAvailableAlign and len(minuteResult)<30:
        minuteResult[clock(t)]=expiryResponse
syncExamples=sorted(synchronous,key=lambda x:-x["meanFractionalMove"])[:12]
result={"ok":True,"readOnly":True,"date":DAY,
        "levelPolicy":"FUTURES_PDH_UNAVAILABLE; ONLY SPOT_PDH_LEVEL_EVENTS_AND_EXACT_BUCKET_FUTURES_MOVEMENT",
        "expiryPolicy":"EACH_INDEX_REAL_RECORDED_EXPIRIES; NO_SYNTHETIC_OCT19_OCT27_FOR_SENSEX_BANKNIFTY",
        "snapshotSemantics":"H1 truth-marked 1m minute bucket; future source tick identity/timestamp not certified",
        "premiumSemantics":"fixed closest abs Delta 0.5 pair selected at 10:33-11:00; strict same-minute quote/snapshot checks",
        "data":perSymbol,"inventory":inventory,"pairs":selected,
        "tripleFutureCounts":dict(supported),
        "perExpiryPremiumFutureAgreement":dict(optionConcord),
        "topSynchronousFutureMinutes":syncExamples,
        "fullTripleFutureAlignedExamples":minuteResult,
        "jointNearSpotPdhExamples":[x for x in synchronous if sum(x["spotPdhNear"].values())>=2][:12]}
print("SUMMARY",json.dumps({k:v for k,v in result.items() if k not in ("topSynchronousFutureMinutes","fullTripleFutureAlignedExamples","jointNearSpotPdhExamples")},separators=(",",":")),flush=True)
print("SYNC",json.dumps({"top":syncExamples,"aligned":minuteResult,"near":result["jointNearSpotPdhExamples"]},separators=(",",":")),flush=True)

# Independently anchor BEFORE the 09:38 Spot PDH event; do not back-project
# 10:33-selected contracts onto earlier prices.
opening={}
for sym in SYMBOLS:
    opening[sym]={}
    for expiry in inventory[sym]["recordedExpiries"][:2]:
        match=None
        for t in (timestamp("09:35"),timestamp("09:36")):
            if match or not chain(sym,t,expiry):continue
            legs={}
            for side in ("CE","PE"):
                possible=[]
                for row in raw[sym]["o"].get(t,[]):
                    d=n(row.get("delta"));strike=n(row.get("strike"))
                    if date(row.get("expiry"))!=expiry or row.get("option_type")!=side or d is None or strike is None:continue
                    if not(0.2<=d<=0.8 if side=="CE" else -0.8<=d<=-0.2):continue
                    if opt(sym,t,expiry,side,strike): possible.append((abs(abs(d)-.5),strike,d))
                if possible:
                    _,k,d=sorted(possible,key=lambda q:(q[0],q[1]))[0]
                    legs[side]={"strike":k,"anchorDelta":round(d,5)}
            if len(legs)==2:match={"anchor":clock(t),"pairs":legs}
        timeline=[]
        if match:
            for clockString in ("09:36","09:37","09:38","09:39","09:40","09:41","09:42"):
                t=timestamp(clockString)
                mm=market(sym,t)
                levels={}
                for side in ("CE","PE"):
                    strike=match["pairs"][side]["strike"]
                    p=opt(sym,t,expiry,side,strike)
                    prev=opt(sym,t-dt.timedelta(minutes=1),expiry,side,strike)
                    ltp=n(p.get("ltp")) if p else None
                    pdh=n(p.get("pdh")) if p else None
                    levels[side]={"strike":strike,"ltp":ltp,
                                  "ownPremiumPdh":pdh,
                                  "vsOwnPremiumPdh":("AT_OR_ABOVE" if ltp>=pdh else "BELOW") if ltp is not None and pdh is not None and pdh>0 else None,
                                  "dPremium1m":round(ltp-n(prev.get("ltp")),4) if ltp is not None and prev else None}
                ft=future_move(sym,t)
                relation=("CE_UP_PE_DOWN" if levels["CE"]["dPremium1m"] is not None and levels["PE"]["dPremium1m"] is not None and
                          levels["CE"]["dPremium1m"]>0 and levels["PE"]["dPremium1m"]<0
                          else "CE_DOWN_PE_UP" if levels["CE"]["dPremium1m"] is not None and levels["PE"]["dPremium1m"] is not None and
                          levels["CE"]["dPremium1m"]<0 and levels["PE"]["dPremium1m"]>0 else "UNVERIFIABLE_OR_MIXED")
                timeline.append({"at":clockString,"spot":n(mm.get("spot_ltp")) if mm else None,
                                 "spotPdh":n(mm.get("pdh")) if mm else None,
                                 "futureMove1m":ft,"legs":levels,"premiumMoveRelation":relation})
        opening[sym][expiry]={"selectedPriorToPDH":match,"timeline":timeline}
print("OPENING_PDH_PREMIUM",json.dumps(opening,separators=(",",":")),flush=True)
result["openingPriorToEventFixedPremiums"]=opening

with open("oct19_three_index_futures_spot_pdh_premium.json","w") as f:json.dump(result,f,indent=2)
