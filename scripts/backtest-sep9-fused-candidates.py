#!/usr/bin/env python3
import json, sys, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

def ts(v):
    if not v: return None
    s=str(v).replace('Z','+00:00')
    d=datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

def f(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except: return None

def pct(entry, value): return (value/entry-1)*100

def ist(d): return (d+timedelta(hours=5,minutes=30)).strftime('%H:%M')

src=sys.argv[1]
out=sys.argv[2] if len(sys.argv)>2 else '/tmp/sep9-fused-backtest.json'
d=json.load(open(src))
rows=d.get('options') or []
series=defaultdict(list)
for r in rows:
    t=ts(r.get('minute_bucket')); ex=str(r.get('expiry') or ''); side=str(r.get('option_type') or '')
    strike=f(r.get('strike')); ltp=f(r.get('ltp'))
    if t and ex and side in ('CE','PE') and strike and ltp and ltp>0:
        series[(ex,strike,side)].append((t,ltp,r))
for k in series: series[k].sort(key=lambda x:x[0])

trades=[
 {'name':'PE_10_00','entryIst':'10:00','entryUtc':'2026-09-09T04:30:00+00:00','expiry':'2026-09-15T00:00:00.000Z','strike':23500.0,'side':'PE'},
 {'name':'CE_12_36','entryIst':'12:36','entryUtc':'2026-09-09T07:06:00+00:00','expiry':'2026-09-15T00:00:00.000Z','strike':23550.0,'side':'CE'},
]
horizons=[3,6,15,30,60]
results=[]
for tr in trades:
    key=(tr['expiry'],tr['strike'],tr['side']); arr=series.get(key,[]); entry_t=ts(tr['entryUtc'])
    exact=[x for x in arr if x[0]==entry_t]
    if not exact: raise SystemExit(f"missing entry {tr['name']}")
    entry=exact[0][1]
    rec={**tr,'entryPremium':entry,'horizons':{}}
    for h in horizons:
        end=entry_t+timedelta(minutes=h)
        pts=[x for x in arr if entry_t <= x[0] <= end]
        if not pts: continue
        hi=max(pts,key=lambda x:x[1]); lo=min(pts,key=lambda x:x[1]); last=max(pts,key=lambda x:x[0])
        rec['horizons'][str(h)]={
          'lastTimeIst':ist(last[0]),'lastPremium':last[1],'returnPct':pct(entry,last[1]),
          'mfePremium':hi[1],'mfeTimeIst':ist(hi[0]),'mfePct':pct(entry,hi[1]),
          'maePremium':lo[1],'maeTimeIst':ist(lo[0]),'maePct':pct(entry,lo[1]),'sampleCount':len(pts)}
    pts=[x for x in arr if x[0]>=entry_t]
    hi=max(pts,key=lambda x:x[1]); lo=min(pts,key=lambda x:x[1]); last=max(pts,key=lambda x:x[0])
    rec['eod']={'lastTimeIst':ist(last[0]),'lastPremium':last[1],'returnPct':pct(entry,last[1]),
                'mfePremium':hi[1],'mfeTimeIst':ist(hi[0]),'mfePct':pct(entry,hi[1]),
                'maePremium':lo[1],'maeTimeIst':ist(lo[0]),'maePct':pct(entry,lo[1]),'sampleCount':len(pts)}
    results.append(rec)
report={'ok':True,'mode':'READ_ONLY_SEP9_FUSED_CANDIDATE_OUTCOME_BACKTEST_V1','sourceCounts':d.get('counts'),'tradeCount':len(results),'trades':results,
        'notes':['Retrospective candidate set from prior fused analysis; not unbiased walk-forward discovery.','LTP replay only; excludes slippage, brokerage, taxes and fill uncertainty.','MFE/MAE computed from recorded minute_bucket LTP observations after entry.'],
        'safety':{'readOnly':True,'affectsSelector':False,'affectsTelegram':False,'affectsExecution':False}}
json.dump(report,open(out,'w'),indent=2)
print('BACKTEST_REPORT',json.dumps(report,separators=(',',':')))
