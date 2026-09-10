#!/usr/bin/env python3
import json, math, os, sys
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone

DATES=["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-07","2026-09-08","2026-09-09"]
SYMBOLS=["NIFTY","SENSEX","BANKNIFTY"]
WINDOWS=(3,6,15,30,60)
FORWARD=(15,30,60)

def dt(v):
    if not v:return None
    try:
        x=datetime.fromisoformat(str(v).replace('Z','+00:00'))
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)
    except Exception:return None

def n(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception:return None

def pos(v):
    x=n(v); return x if x is not None and x>0 else None

def pct(a,b): return None if a in (None,0) or b is None else (b/a-1.0)*100.0

def ist(t): return (t+timedelta(hours=5,minutes=30)).strftime('%H:%M')

def get(r,*keys):
    for k in keys:
        if k in r and r.get(k) is not None:return r.get(k)
    return None

def side_state(ce,pe):
    if ce is None or pe is None:return None
    if ce>0 and pe<0:return 'CE'
    if pe>0 and ce<0:return 'PE'
    return None

def q(vals,p):
    xs=sorted(x for x in vals if x is not None and math.isfinite(x))
    if not xs:return None
    i=(len(xs)-1)*p; lo=int(i); hi=min(lo+1,len(xs)-1); f=i-lo
    return xs[lo]*(1-f)+xs[hi]*f

def build_option_maps(rows):
    m=defaultdict(dict)
    fields=Counter()
    for r in rows:
        fields.update(r.keys())
        t=dt(r.get('minute_bucket')); ex=str(r.get('expiry') or ''); st=pos(r.get('strike')); s=str(r.get('option_type') or '')
        if not(t and ex and st and s in ('CE','PE')):continue
        l=pos(r.get('ltp'))
        if l is None:continue
        rank=1 if str(r.get('validation_status'))=='RESEARCH_ELIGIBLE' else 0
        old=m[(t,ex,st)].get(s)
        if old is None or rank>old[1]:m[(t,ex,st)][s]=(r,rank)
    pairs={k:{s:v[0] for s,v in sides.items()} for k,sides in m.items() if 'CE' in sides and 'PE' in sides}
    return pairs,fields

def cumulative_window_inflow(pairs,t,ex,st,side,w):
    a=pairs.get((t-timedelta(minutes=w),ex,st)); b=pairs.get((t,ex,st))
    if not a or not b:return None
    va=n(get(a[side],'volume','day_volume','volume_traded')); vb=n(get(b[side],'volume','day_volume','volume_traded'))
    if va is None or vb is None or vb<va:return None
    return vb-va

def volume_metrics(pairs,t,ex,st,side,w):
    opp='PE' if side=='CE' else 'CE'
    ci=cumulative_window_inflow(pairs,t,ex,st,side,w)
    oi=cumulative_window_inflow(pairs,t,ex,st,opp,w)
    prev_ci=cumulative_window_inflow(pairs,t-timedelta(minutes=w),ex,st,side,w)
    accel=pct(prev_ci,ci) if prev_ci not in (None,0) else None
    share=(ci/(ci+oi)*100.0) if ci is not None and oi is not None and ci+oi>0 else None
    return {'chosenVolumeIn':ci,'oppositeVolumeIn':oi,'chosenVolumeSharePct':share,'chosenVolumeAccelerationPct':accel}

def option_window(pairs,t,ex,st,side,w):
    cur=pairs.get((t,ex,st)); old=pairs.get((t-timedelta(minutes=w),ex,st))
    if not cur or not old:return None
    opp='PE' if side=='CE' else 'CE'
    a=cur[side]; ao=cur[opp]; b=old[side]; bo=old[opp]
    p0,p1=pos(b.get('ltp')),pos(a.get('ltp')); o0,o1=pos(bo.get('ltp')),pos(ao.get('ltp'))
    if None in (p0,p1,o0,o1):return None
    chosen=pct(p0,p1); opposite=pct(o0,o1)
    raw=(pct(pos(old['CE'].get('ltp')),pos(cur['CE'].get('ltp'))) or 0)-(pct(pos(old['PE'].get('ltp')),pos(cur['PE'].get('ltp'))) or 0)
    dir_ppd=raw if side=='CE' else -raw
    oi0,oi1=n(get(b,'oi','open_interest')),n(get(a,'oi','open_interest'))
    iv0,iv1=n(b.get('iv')),n(a.get('iv'))
    d0,d1=n(b.get('delta')),n(a.get('delta')); g0,g1=n(b.get('gamma')),n(a.get('gamma'))
    bid=n(a.get('bid')); ask=n(a.get('ask')); mid=((bid+ask)/2.0) if bid is not None and ask is not None and bid>0 and ask>=bid else None
    spread=((ask-bid)/mid*100.0) if mid else None
    out={'chosenPremiumPct':chosen,'oppositePremiumPct':opposite,'candidatePpdPp':dir_ppd,'oiPct':pct(oi0,oi1),'ivChange':None if iv0 is None or iv1 is None else iv1-iv0,'deltaChange':None if d0 is None or d1 is None else d1-d0,'gammaChange':None if g0 is None or g1 is None else g1-g0,'spreadPct':spread}
    out.update(volume_metrics(pairs,t,ex,st,side,w)); return out

def chain_map(rows):
    out={}; fields=Counter()
    for r in rows:
        fields.update(r.keys()); t=dt(r.get('minute_bucket'))
        if t and str(r.get('expiry_bucket'))=='Current Expiry':out[t]=r
    return out,fields

def chain_window(cmap,t,side,w):
    a=cmap.get(t-timedelta(minutes=w)); b=cmap.get(t)
    if not a or not b:return None
    f0,f1=n(a.get('full_chain_oi_pcr')),n(b.get('full_chain_oi_pcr')); b0,b1=n(a.get('band7_oi_pcr')),n(b.get('band7_oi_pcr'))
    cws0,cws1=n(a.get('call_wall_strike')),n(b.get('call_wall_strike')); pws0,pws1=n(a.get('put_wall_strike')),n(b.get('put_wall_strike'))
    cwo0,cwo1=n(a.get('call_wall_oi')),n(b.get('call_wall_oi')); pwo0,pwo1=n(a.get('put_wall_oi')),n(b.get('put_wall_oi'))
    return {'fullPcrDelta':None if f0 is None or f1 is None else f1-f0,'band7PcrDelta':None if b0 is None or b1 is None else b1-b0,'callWallMigration':None if cws0 is None or cws1 is None else cws1-cws0,'putWallMigration':None if pws0 is None or pws1 is None else pws1-pws0,'callWallOiPct':pct(cwo0,cwo1),'putWallOiPct':pct(pwo0,pwo1)}

def multi_dte(pairs,t,st,side,w):
    states=[]
    for (tt,ex,s),cur in pairs.items():
        if tt!=t or s!=st:continue
        old=pairs.get((t-timedelta(minutes=w),ex,st))
        if not old:continue
        ce=pct(pos(old['CE'].get('ltp')),pos(cur['CE'].get('ltp'))); pe=pct(pos(old['PE'].get('ltp')),pos(cur['PE'].get('ltp')))
        ss=side_state(ce,pe)
        if ss:states.append((ex,ss))
    aligned=sum(1 for _,s in states if s==side); opposite=sum(1 for _,s in states if s!=side)
    return {'usableExpiries':len(states),'alignedExpiries':aligned,'oppositeExpiries':opposite,'aligned':len(states)>=2 and opposite==0}

def forward_outcome(pairs,t,ex,st,side,h):
    idx=0 if side=='CE' else 1; entry=pos(pairs[(t,ex,st)][side].get('ltp'))
    xs=[]
    for (tt,e,s),pp in pairs.items():
        if e==ex and s==st and t<=tt<=t+timedelta(minutes=h):
            px=pos(pp[side].get('ltp'))
            if px:xs.append((tt,px))
    if not xs:return None
    xs.sort(); mx=max(xs,key=lambda x:x[1]); mn=min(xs,key=lambda x:x[1]); last=xs[-1]
    return {'returnPct':pct(entry,last[1]),'mfePct':pct(entry,mx[1]),'maePct':pct(entry,mn[1]),'mfeTime':ist(mx[0]),'maeTime':ist(mn[0])}

def generic_series_metrics(rows):
    # Strict coverage only: never invent constituent/sector semantics.
    keys=Counter();
    for r in rows:keys.update(r.keys())
    return sorted(keys.keys())

def analyze_one(data,symbol,date):
    opts=data.get('options') or []; chain=data.get('chain') or []; market=data.get('market') or []; canonical=data.get('canonical') or []
    pairs,optfields=build_option_maps(opts); cmap,chainfields=chain_map(chain)
    events=[]
    for t,cr in sorted(cmap.items()):
        ex=str(cr.get('expiry') or ''); st=pos(cr.get('atm_strike'))
        if not ex or st is None or (t,ex,st) not in pairs:continue
        # candidate side determined by exact 6m + 15m controlled expansion agreement
        states=[]
        for w in (6,15):
            old=pairs.get((t-timedelta(minutes=w),ex,st)); cur=pairs[(t,ex,st)]
            if not old:states=[];break
            ce=pct(pos(old['CE'].get('ltp')),pos(cur['CE'].get('ltp'))); pe=pct(pos(old['PE'].get('ltp')),pos(cur['PE'].get('ltp')))
            states.append(side_state(ce,pe))
        if len(states)!=2 or states[0] is None or states[0]!=states[1]:continue
        side=states[0]
        windows={}; ok=True
        for w in WINDOWS:
            x=option_window(pairs,t,ex,st,side,w)
            if x:windows[str(w)]=x
        if '6' not in windows or '15' not in windows:continue
        md6=multi_dte(pairs,t,st,side,6); md15=multi_dte(pairs,t,st,side,15)
        cw=chain_window(cmap,t,side,15)
        if not cw:continue
        # Gate-first research eligibility: multi-DTE + at least 2 positioning confirmations, no arbitrary weighted score.
        pcr=(cw['fullPcrDelta'] is not None and cw['band7PcrDelta'] is not None and ((side=='CE' and cw['fullPcrDelta']>0 and cw['band7PcrDelta']>0) or (side=='PE' and cw['fullPcrDelta']<0 and cw['band7PcrDelta']<0)))
        oi=(cw['callWallOiPct'] is not None and cw['putWallOiPct'] is not None and ((side=='CE' and cw['callWallOiPct']<=0 and cw['putWallOiPct']>=0) or (side=='PE' and cw['callWallOiPct']>=0 and cw['putWallOiPct']<=0)))
        wall=(cw['callWallMigration'] is not None and cw['putWallMigration'] is not None and ((side=='CE' and (cw['callWallMigration']>=0 or cw['putWallMigration']>=0)) or (side=='PE' and (cw['callWallMigration']<=0 or cw['putWallMigration']<=0))))
        eligible=md6['aligned'] and md15['aligned'] and sum((pcr,oi,wall))>=2
        if not eligible:continue
        entry=pos(pairs[(t,ex,st)][side].get('ltp'))
        prior30=windows.get('30',{}).get('chosenPremiumPct')
        ev={'symbol':symbol,'date':date,'timeIst':ist(t),'timestamp':t.isoformat(),'side':side,'expiry':ex,'strike':st,'entryPremium':entry,'windows':windows,'multiDte6':md6,'multiDte15':md15,'positioning15':cw,'positioningConfirmations':{'pcr':pcr,'wallOi':oi,'wallMigration':wall},'prior30ChosenPremiumPct':prior30,'forward':{str(h):forward_outcome(pairs,t,ex,st,side,h) for h in FORWARD}}
        events.append(ev)
    # retain first event and strongest 15m candidate PPD each side/day for comparable audit
    selected=[]
    for s in ('CE','PE'):
        xs=[e for e in events if e['side']==s]
        if xs:
            selected.append({'kind':'FIRST','event':xs[0]})
            strongest=max(xs,key=lambda e:e['windows']['15']['candidatePpdPp'])
            if strongest is not xs[0]:selected.append({'kind':'STRONGEST','event':strongest})
    return {'symbol':symbol,'date':date,'ok':bool(data.get('ok')),'sourceCounts':data.get('counts'),'coverage':{'optionFields':sorted(optfields.keys()),'chainFields':sorted(chainfields.keys()),'marketFields':generic_series_metrics(market),'canonicalFields':generic_series_metrics(canonical),'sectorOrHeavyweightExplicitRows':sum(1 for r in canonical if any(k in r for k in ('sector','sector_name','constituent','stock','heavyweight','component')))},'eligibleEventCount':len(events),'selected':selected}

def agg(rows):
    def av(k):
        xs=[r[k] for r in rows if r.get(k) is not None]
        return sum(xs)/len(xs) if xs else None
    return {'n':len(rows),'avgPrior30PremiumPct':av('prior30'),'avgVolumeShare15Pct':av('volShare15'),'avgVolumeAcceleration15Pct':av('volAccel15'),'avgMfe30Pct':av('mfe30'),'avgMae30Pct':av('mae30'),'avgReturn30Pct':av('ret30'),'positive30Count':sum(1 for r in rows if (r.get('ret30') or 0)>0)}

def main():
    base=sys.argv[1]; output=sys.argv[2]
    days=[]; flat=[]
    for sym in SYMBOLS:
        for d in DATES:
            p=os.path.join(base,sym,d+'.json')
            if not os.path.exists(p):days.append({'symbol':sym,'date':d,'ok':False,'reason':'MISSING_FILE'});continue
            x=analyze_one(json.load(open(p)),sym,d); days.append(x)
            for sel in x.get('selected',[]):
                e=sel['event']; w15=e['windows'].get('15',{}); f=e['forward'].get('30') or {}
                flat.append({'symbol':sym,'date':d,'kind':sel['kind'],'side':e['side'],'timeIst':e['timeIst'],'prior30':e.get('prior30ChosenPremiumPct'),'ppd15':w15.get('candidatePpdPp'),'premium15':w15.get('chosenPremiumPct'),'opposite15':w15.get('oppositePremiumPct'),'volumeIn15':w15.get('chosenVolumeIn'),'oppositeVolumeIn15':w15.get('oppositeVolumeIn'),'volShare15':w15.get('chosenVolumeSharePct'),'volAccel15':w15.get('chosenVolumeAccelerationPct'),'oi15':w15.get('oiPct'),'iv15':w15.get('ivChange'),'spreadPct':w15.get('spreadPct'),'mfe30':f.get('mfePct'),'mae30':f.get('maePct'),'ret30':f.get('returnPct')})
    # Dynamic research buckets from observed prior30 premium distribution; no production threshold promotion.
    prior=[r['prior30'] for r in flat if r.get('prior30') is not None]
    p33,p66=q(prior,.33),q(prior,.66)
    for r in flat:
        v=r.get('prior30')
        r['freshnessBucket']='UNAVAILABLE' if v is None else ('EARLY' if v<=p33 else 'DEVELOPED' if v<=p66 else 'MATURE')
    buckets={b:agg([r for r in flat if r['freshnessBucket']==b]) for b in ('EARLY','DEVELOPED','MATURE','UNAVAILABLE')}
    by_symbol={s:agg([r for r in flat if r['symbol']==s]) for s in SYMBOLS}
    coverage={s:{'daysWithData':sum(1 for d in days if d.get('symbol')==s and sum((d.get('sourceCounts') or {}).values())>0 if isinstance(d.get('sourceCounts'),dict)),'explicitSectorHeavyweightRows':sum(d.get('coverage',{}).get('sectorOrHeavyweightExplicitRows',0) for d in days if d.get('symbol')==s)} for s in SYMBOLS}
    report={'ok':True,'mode':'READ_ONLY_7D_VOLUME_FUSED_ENGINE_BACKTEST_V1','productionImpact':'NONE','dates':DATES,'symbols':SYMBOLS,'method':{'windowsMinutes':list(WINDOWS),'volumeRule':'interval inflow = cumulative_volume(t)-cumulative_volume(t-w); volume acceleration compares equal adjacent windows; negative/reset deltas are unavailable','optionFusion':'gate-first: 6m+15m controlled premium response + exact-strike multi-DTE alignment + >=2 of PCR/OI-wall/wall-migration confirmations','freshnessBuckets':'empirical terciles of prior-30m chosen-premium expansion; research only, not production thresholds','noFutureLeakage':True,'crossExpiryPremiumSubtraction':False,'nearestTimestampSubstitution':False},'coverage':coverage,'days':days,'rows':flat,'freshnessCutpointsPrior30Pct':{'p33':p33,'p66':p66},'bucketPerformance':buckets,'symbolPerformance':by_symbol,'safety':{'readOnly':True,'affectsSelector':False,'affectsTelegram':False,'affectsExecution':False,'failClosed':True}}
    json.dump(report,open(output,'w'),indent=2)
    print('ENGINE_SUMMARY',json.dumps({'mode':report['mode'],'coverage':coverage,'cutpoints':report['freshnessCutpointsPrior30Pct'],'bucketPerformance':buckets,'symbolPerformance':by_symbol,'rowCount':len(flat)},separators=(',',':')))
    print('ENGINE_ROWS',json.dumps(flat,separators=(',',':')))
if __name__=='__main__':main()
