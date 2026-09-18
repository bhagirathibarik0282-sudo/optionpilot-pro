import json
import math
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE = "https://optionpilot-pro-v2-production.up.railway.app/api/research/h1-replay"
CAL_DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-07"]
OOS_DATES = ["2026-09-08", "2026-09-09", "2026-09-10"]
IST = timezone(timedelta(hours=5, minutes=30))

def fetch(date):
    qs = urllib.parse.urlencode({
        "symbol": "NIFTY",
        "date": date,
        "from": "09:15",
        "to": "15:30",
        "scope": "FULL",
    })
    with urllib.request.urlopen(BASE + "?" + qs, timeout=240) as r:
        data = json.load(r)
    if not data.get("ok"):
        raise RuntimeError(f"replay failed for {date}: {data.get('reason')}")
    return data

def ms(value):
    return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000)

def quantile(values, p):
    xs = sorted(x for x in values if math.isfinite(x))
    if not xs:
        return None
    pos = (len(xs) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return xs[lo]
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)

def date_intervals(date, replay):
    start = int(datetime.fromisoformat(date + "T09:15:00").replace(tzinfo=IST).timestamp() * 1000)
    end = int(datetime.fromisoformat(date + "T15:30:00").replace(tzinfo=IST).timestamp() * 1000)
    expected = set(range(start, end + 1, 180000))

    market = {}
    for row in replay.get("market") or []:
        try:
            t = ms(row.get("minute_bucket"))
            spot = float(row.get("spot_ltp"))
        except (TypeError, ValueError):
            continue
        if t in expected and spot > 0:
            market[t] = spot

    moves = []
    for t in sorted(market):
        nxt = t + 180000
        if nxt not in market:
            continue
        move = ((market[nxt] - market[t]) / market[t]) * 100.0
        if math.isfinite(move) and move != 0:
            moves.append((t, nxt, move))

    contracts = {}
    for row in replay.get("options") or []:
        side = str(row.get("option_type") or "")
        if side not in ("CE", "PE"):
            continue
        try:
            t = ms(row.get("minute_bucket"))
            strike = float(row.get("strike"))
            ltp = float(row.get("ltp"))
        except (TypeError, ValueError):
            continue
        expiry = str(row.get("expiry") or "")
        if not expiry or strike <= 0 or ltp <= 0:
            continue
        key = (expiry, strike, side)
        contracts.setdefault(key, {})[t] = ltp

    interval_side = defaultdict(lambda: {"CE": [], "PE": []})
    move_abs = {}
    for t0, t1, spot_move in moves:
        key = (t0, t1)
        move_abs[key] = abs(spot_move)
        spot_dir = 1 if spot_move > 0 else -1
        for (_, _, side), pts in contracts.items():
            a, b = pts.get(t0), pts.get(t1)
            if a is None or b is None or a <= 0:
                continue
            premium_move = ((b - a) / a) * 100.0
            if not math.isfinite(premium_move) or premium_move == 0:
                continue
            observed = 1 if premium_move > 0 else -1
            expected_dir = spot_dir if side == "CE" else -spot_dir
            interval_side[key][side].append(1.0 if observed == expected_dir else 0.0)

    out = []
    for key, sides in interval_side.items():
        side_rates = []
        for side in ("CE", "PE"):
            vals = sides[side]
            if vals:
                side_rates.append(sum(vals) / len(vals))
        if not side_rates:
            continue
        out.append({
            "tradeDate": date,
            "fromMs": key[0],
            "toMs": key[1],
            "absSpotMovePct": move_abs[key],
            "sideBalancedAgreementShare": sum(side_rates) / len(side_rates),
            "bothSidesPresent": bool(sides["CE"] and sides["PE"]),
        })
    return out

def summarize(rows, threshold):
    selected = [r for r in rows if r["absSpotMovePct"] >= threshold]
    if not selected:
        return {
            "intervalCount": 0,
            "bothSidesPresentIntervalCount": 0,
            "meanSideBalancedAgreementShare": None,
            "strictMajorityIntervalRate": None,
        }
    return {
        "intervalCount": len(selected),
        "bothSidesPresentIntervalCount": sum(1 for r in selected if r["bothSidesPresent"]),
        "meanSideBalancedAgreementShare": sum(r["sideBalancedAgreementShare"] for r in selected) / len(selected),
        "strictMajorityIntervalRate": sum(1 for r in selected if r["sideBalancedAgreementShare"] > 0.5) / len(selected),
    }

cal = []
for d in CAL_DATES:
    cal.extend(date_intervals(d, fetch(d)))
oos = []
for d in OOS_DATES:
    oos.extend(date_intervals(d, fetch(d)))

if not cal or not oos:
    raise RuntimeError("insufficient calibration or OOS intervals")

magnitudes = [r["absSpotMovePct"] for r in cal]
candidates = [
    ("P50", quantile(magnitudes, 0.50)),
    ("P75", quantile(magnitudes, 0.75)),
    ("P90", quantile(magnitudes, 0.90)),
    ("P95", quantile(magnitudes, 0.95)),
]

matrix = []
for label, threshold in candidates:
    matrix.append({
        "label": label,
        "calibrationDerivedThresholdPct": threshold,
        "calibration": summarize(cal, threshold),
        "oos": summarize(oos, threshold),
    })

result = {
    "mode": "READ_ONLY_DIRECTION_QUANTILE_HOLDOUT_MATRIX_V1",
    "semantics": "CALIBRATION_DERIVED_CANDIDATES_EVALUATED_ON_LATER_OOS_NO_SELECTION",
    "productionImpact": "NONE",
    "split": {
        "calibrationDates": CAL_DATES,
        "oosDates": OOS_DATES,
    },
    "baseIntervalCounts": {
        "calibration": len(cal),
        "oos": len(oos),
    },
    "candidateMatrix": matrix,
    "blockers": [
        "DIRECTION_POLICY_THRESHOLD_NOT_SELECTED",
        "DIRECTION_POLICY_SELECTION_RUBRIC_NOT_DEFINED",
    ],
    "safety": {
        "readOnly": True,
        "thresholdSelected": False,
        "thresholdPromoted": False,
        "affectsSelector": False,
        "affectsTelegram": False,
        "affectsVerdict": False,
        "affectsExecution": False,
        "grantsPromotionAuthority": False,
        "failClosed": True,
    },
}

print(json.dumps(result, indent=2))
