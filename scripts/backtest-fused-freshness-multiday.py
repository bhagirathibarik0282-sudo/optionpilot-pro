#!/usr/bin/env python3
import json, math, os, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

DATES = ["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-07","2026-09-08","2026-09-09"]
HORIZONS=(15,30,60)


def ts(v):
    if not v: return None
    try:
        d=datetime.fromisoformat(str(v).replace('Z','+00:00'))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception: return None

def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception: return None

def pos(v):
    x=num(v); return x if x is not None and x>0 else None

def pct(a,b): return (b/a-1)*100.0

def ist(d): return (d+timedelta(hours=5,minutes=30)).strftime('%H:%M')

def pair_state(cr,pr):
    if cr>0 and pr<0: return 'CE'
    if pr>0 and cr<0: return 'PE'
    return None


def analyze_day(data, date):
    if not data.get('ok'):
        return {'date':date,'ok':False,'reason':data.get('reason')}
    opts=data.get('options') or []
    chain=data.get('chain') or []

    # exact option pair map
    m=defaultdict(dict)
    for r in opts:
        t=ts(r.get('minute_bucket')); ex=str(r.get('expiry') or ''); st=pos(r.get('strike')); side=str(r.get('option_type') or ''); l=pos(r.get('ltp'))
        if t and ex and st and side in ('CE','PE') and l:
            rank=1 if str(r.get('validation_status'))=='RESEARCH_ELIGIBLE' else 0
            prior=m[(t,ex,st)].get(side)
            if prior is None or rank>prior[1]: m[(t,ex,st)][side]=(r,rank)
    pairs={k:(v['CE'][0],v['PE'][0]) for k,v in m.items() if 'CE' in v and 'PE' in v}

    # chain current-expiry map
    crows={}
    for r in chain:
        t=ts(r.get('minute_bucket'))
        if t and str(r.get('expiry_bucket'))=='Current Expiry': crows[t]=r

    # Build ATM current-expiry PPD 15/30 and multi-DTE alignment
    events=[]
    for t,cr in sorted(crows.items()):
        ex=str(cr.get('expiry') or '')
        strike=pos(cr.get('atm_strike'))
        if not ex or not strike or (t,ex,strike) not in pairs: continue
        cur=pairs[(t,ex,strike)]
        cur_ce,cur_pe=pos(cur[0].get('ltp')),pos(cur[1].get('ltp'))
        w={} ; valid=True
        for mins in (15,30):
            p=pairs.get((t-timedelta(minutes=mins),ex,strike))
            if not p: valid=False; break
            ce0,pe0=pos(p[0].get('ltp')),pos(p[1].get('ltp'))
            if None in (cur_ce,cur_pe,ce0,pe0): valid=False; break
            crtn,prtn=pct(ce0,cur_ce),pct(pe0,cur_pe)
            side=pair_state(crtn,prtn)
            if not side: valid=False; break
            w[mins]={'side':side,'ppd':crtn-prtn,'ceRet':crtn,'peRet':prtn}
        if not valid or w[15]['side']!=w[30]['side']: continue
        side=w[15]['side']

        # multi-DTE alignment on exact ATM strike for same timestamp; require >=2 expiries and no opposite controlled side
        md={15:[],30:[]}
        for mins in (15,30):
            for (tt,e,s),pp in pairs.items():
                if tt!=t or s!=strike: continue
                p0=pairs.get((t-timedelta(minutes=mins),e,strike))
                if not p0: continue
                ce1,pe1=pos(pp[0].get('ltp')),pos(pp[1].get('ltp')); ce0,pe0=pos(p0[0].get('ltp')),pos(p0[1].get('ltp'))
                if None in (ce1,pe1,ce0,pe0): continue
                ss=pair_state(pct(ce0,ce1),pct(pe0,pe1))
                if ss: md[mins].append(ss)
        if any(len(md[x])<2 or any(s!=side for s in md[x]) for x in (15,30)): continue

        prev=crows.get(t-timedelta(minutes=15))
        if not prev: continue
        f0,f1=num(prev.get('full_chain_oi_pcr')),num(cr.get('full_chain_oi_pcr'))
        b0,b1=num(prev.get('band7_oi_pcr')),num(cr.get('band7_oi_pcr'))
        call0,call1=num(prev.get('call_wall_oi')),num(cr.get('call_wall_oi'))
        put0,put1=num(prev.get('put_wall_oi')),num(cr.get('put_wall_oi'))
        cw0,cw1=num(prev.get('call_wall_strike')),num(cr.get('call_wall_strike'))
        pw0,pw1=num(prev.get('put_wall_strike')),num(cr.get('put_wall_strike'))

        pcr_ok=False; oi_ok=False; wall_ok=False
        if None not in (f0,f1,b0,b1):
            pcr_ok=(f1>f0 and b1>b0) if side=='CE' else (f1<f0 and b1<b0)
        if None not in (call0,call1,put0,put1):
            oi_ok=(call1<=call0 and put1>=put0) if side=='CE' else (call1>=call0 and put1<=put0)
        if None not in (cw0,cw1,pw0,pw1):
            wall_ok=(cw1>=cw0 or pw1>=pw0) if side=='CE' else (cw1<=cw0 or pw1<=pw0)
        confirmations=sum([pcr_ok,oi_ok,wall_ok])
        if confirmations<2: continue

        entry=cur_ce if side=='CE' else cur_pe
        # prior 30m chosen premium expansion (chase measure)
        p30=pairs.get((t-timedelta(minutes=30),ex,strike))
        chosen0=pos(p30[0 if side=='CE' else 1].get('ltp')) if p30 else None
        prior30=pct(chosen0,entry) if chosen0 else None

        outcomes={}
        series=[]
        for (tt,e,s),pp in pairs.items():
            if e==ex and s==strike and tt>=t:
                px=pos(pp[0 if side=='CE' else 1].get('ltp'))
                if px: series.append((tt,px))
        series.sort()
        for h in HORIZONS:
            xs=[x for x in series if x[0]<=t+timedelta(minutes=h)]
            if not xs: continue
            mx=max(xs,key=lambda x:x[1]); mn=min(xs,key=lambda x:x[1]); last=xs[-1]
            outcomes[str(h)]={'lastPct':pct(entry,last[1]),'mfePct':pct(entry,mx[1]),'maePct':pct(entry,mn[1]),'mfeTime':ist(mx[0]),'maeTime':ist(mn[0]),'lastPremium':last[1]}
        events.append({'timeIst':ist(t),'side':side,'expiry':ex,'strike':strike,'entryPremium':entry,'ppd15':w[15]['ppd'],'ppd30':w[30]['ppd'],'prior30ChosenPremiumPct':prior30,'pcrOk':pcr_ok,'oiOk':oi_ok,'wallOk':wall_ok,'confirmations':confirmations,'outcomes':outcomes})

    # de-duplicate: first eligible event per side, plus strongest 15m event per side
    selected=[]
    for side in ('CE','PE'):
        xs=[e for e in events if e['side']==side]
        if xs:
            selected.append({'kind':'FIRST','event':xs[0]})
            strongest=max(xs,key=lambda e:abs(e['ppd15']))
            if strongest is not xs[0]: selected.append({'kind':'STRONGEST','event':strongest})
    return {'date':date,'ok':True,'sourceCounts':data.get('counts'),'eligibleEventCount':len(events),'selected':selected}


def main():
    base=sys.argv[1]
    out=[]
    for d in DATES:
        p=os.path.join(base,f'{d}.json')
        if not os.path.exists(p):
            out.append({'date':d,'ok':False,'reason':'MISSING_FILE'}); continue
        out.append(analyze_day(json.load(open(p)),d))
    flat=[s for day in out if day.get('ok') for s in day.get('selected',[])]
    rows=[]
    for s in flat:
        e=s['event']; o=e['outcomes'].get('30') or {}
        rows.append({'date':next(day['date'] for day in out if s in day.get('selected',[])),'kind':s['kind'],'side':e['side'],'timeIst':e['timeIst'],'prior30':e['prior30ChosenPremiumPct'],'mfe30':o.get('mfePct'),'mae30':o.get('maePct'),'ret30':o.get('lastPct')})
    # relationship: mature if prior30 >= 15%; fresh otherwise
    mature=[r for r in rows if r['prior30'] is not None and r['prior30']>=15]
    fresh=[r for r in rows if r['prior30'] is not None and r['prior30']<15]
    def agg(xs):
        if not xs:return {'n':0}
        av=lambda k: sum(x[k] for x in xs if x[k] is not None)/max(1,sum(1 for x in xs if x[k] is not None))
        return {'n':len(xs),'avgMfe30':av('mfe30'),'avgMae30':av('mae30'),'avgRet30':av('ret30'),'positive30Count':sum(1 for x in xs if (x['ret30'] or 0)>0)}
    report={'ok':True,'mode':'READ_ONLY_FUSED_FRESHNESS_MULTIDAY_BACKTEST_V1','days':out,'rows':rows,'maturePrior30Ge15':agg(mature),'freshPrior30Lt15':agg(fresh),'notes':['Objective retrospective rule: 15m+30m same-side controlled PPD, multi-DTE aligned, >=2 of PCR/OI/wall confirmations.','First and strongest eligible event per side/day are reported; no production authority.','LTP replay only; excludes slippage, brokerage, taxes and fill uncertainty.']}
    print('MULTIDAY_BACKTEST',json.dumps(report,separators=(',',':')))
    json.dump(report,open(sys.argv[2],'w'),indent=2)

if __name__=='__main__': main()
