#!/usr/bin/env python3
import argparse, json, math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

WINDOWS = (3, 6, 15, 30)
TARGET_IST = {"10:00", "10:12", "12:36", "12:42"}


def parse_ts(value):
    if not value:
        return None
    s = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def finite_pos(value):
    try:
        x = float(value)
        return x if math.isfinite(x) and x > 0 else None
    except (TypeError, ValueError):
        return None


def pct(a, b):
    return (b / a - 1.0) * 100.0


def pair_state(ce_ret, pe_ret):
    if ce_ret > 0 and pe_ret < 0:
        return "CE_CONTROLLED_EXPANSION"
    if pe_ret > 0 and ce_ret < 0:
        return "PE_CONTROLLED_EXPANSION"
    if ce_ret > 0 and pe_ret > 0:
        return "BOTH_UP"
    if ce_ret < 0 and pe_ret < 0:
        return "BOTH_DECAY"
    return "NEUTRAL"


def ist(dt):
    return (dt + timedelta(hours=5, minutes=30)).strftime("%H:%M")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--output", default="ppd-replay-analysis.json")
    args = ap.parse_args()
    data = json.load(open(args.input, encoding="utf-8"))
    if not data.get("ok"):
        raise SystemExit(f"replay not ok: {data.get('reason')}")
    rows = data.get("options") or []

    by_key = defaultdict(dict)
    expiries = set()
    for r in rows:
        ts = parse_ts(r.get("minute_bucket"))
        expiry = str(r.get("expiry") or "")
        strike = finite_pos(r.get("strike"))
        side = str(r.get("option_type") or "")
        ltp = finite_pos(r.get("ltp"))
        if ts is None or not expiry or strike is None or side not in ("CE", "PE") or ltp is None:
            continue
        key = (ts, expiry, strike)
        prior = by_key[key].get(side)
        rank = 1 if str(r.get("validation_status")) == "RESEARCH_ELIGIBLE" else 0
        if prior is None or rank > prior[1]:
            by_key[key][side] = (r, rank)
        expiries.add(expiry)

    pairs = {}
    for k, sides in by_key.items():
        if "CE" in sides and "PE" in sides:
            pairs[k] = (sides["CE"][0], sides["PE"][0])

    endpoints = []
    for (ts, expiry, strike), (ce, pe) in pairs.items():
        try:
            is_atm = float(ce.get("atm_offset")) == 0 or float(pe.get("atm_offset")) == 0
        except (TypeError, ValueError):
            is_atm = False
        if is_atm:
            endpoints.append((ts, expiry, strike, ce, pe))
    endpoints.sort(key=lambda x: (x[0], x[1]))

    results = {w: [] for w in WINDOWS}
    for ts, expiry, strike, ce_to, pe_to in endpoints:
        ce_to_px, pe_to_px = finite_pos(ce_to.get("ltp")), finite_pos(pe_to.get("ltp"))
        for w in WINDOWS:
            frm = ts - timedelta(minutes=w)
            prior = pairs.get((frm, expiry, strike))
            if not prior:
                continue
            ce_from, pe_from = prior
            ce_from_px, pe_from_px = finite_pos(ce_from.get("ltp")), finite_pos(pe_from.get("ltp"))
            if None in (ce_to_px, pe_to_px, ce_from_px, pe_from_px):
                continue
            ce_ret = pct(ce_from_px, ce_to_px)
            pe_ret = pct(pe_from_px, pe_to_px)
            ppd = ce_ret - pe_ret
            results[w].append({
                "timestamp": ts.isoformat(), "timeIst": ist(ts), "expiry": expiry,
                "strike": strike, "ceFrom": ce_from_px, "ceTo": ce_to_px,
                "peFrom": pe_from_px, "peTo": pe_to_px,
                "ceReturnPct": ce_ret, "peReturnPct": pe_ret,
                "rawPpdPp": ppd, "controllingSide": "CE" if ppd > 0 else "PE" if ppd < 0 else None,
                "pairState": pair_state(ce_ret, pe_ret),
                "toValidation": {"CE": ce_to.get("validation_status"), "PE": pe_to.get("validation_status")},
                "toQuoteAgeSeconds": {"CE": ce_to.get("quote_age_seconds"), "PE": pe_to.get("quote_age_seconds")},
            })

    summaries = {}
    for w, rr in results.items():
        ctrl = Counter(x["controllingSide"] or "NEUTRAL" for x in rr)
        states = Counter(x["pairState"] for x in rr)
        top = sorted(rr, key=lambda x: abs(x["rawPpdPp"]), reverse=True)[:12]
        summaries[str(w)] = {"windowMinutes": w, "sampleCount": len(rr), "controlCounts": dict(ctrl), "pairStateCounts": dict(states), "topAbsolutePpd": top}

    multi = {}
    for w, rr in results.items():
        grouped = defaultdict(list)
        for x in rr:
            grouped[x["timestamp"]].append(x)
        aligned, conflicted = [], []
        for ts_s, xs in sorted(grouped.items()):
            usable = [x for x in xs if x["controllingSide"]]
            sides = {x["controllingSide"] for x in usable}
            if len(usable) >= 2 and len(sides) == 1:
                aligned.append({"timestamp": ts_s, "timeIst": usable[0]["timeIst"], "side": next(iter(sides)), "expiries": [x["expiry"] for x in usable], "ppd": {x["expiry"]: x["rawPpdPp"] for x in usable}})
            elif len(usable) >= 2 and len(sides) > 1:
                conflicted.append({"timestamp": ts_s, "timeIst": usable[0]["timeIst"], "expiries": [x["expiry"] for x in usable], "sides": {x["expiry"]: x["controllingSide"] for x in usable}, "ppd": {x["expiry"]: x["rawPpdPp"] for x in usable}})
        multi[str(w)] = {"alignedCount": len(aligned), "conflictCount": len(conflicted), "firstAligned": aligned[:10], "firstConflicts": conflicted[:10]}

    timeline = []
    all_ts = sorted({x["timestamp"] for rr in results.values() for x in rr})
    if all_ts:
        start = parse_ts(all_ts[0]).replace(second=0, microsecond=0)
        end = parse_ts(all_ts[-1]).replace(second=0, microsecond=0)
        cursor = start.replace(minute=(start.minute // 15) * 15)
        if cursor < start:
            cursor += timedelta(minutes=15)
        while cursor <= end:
            point = {"timeIst": ist(cursor), "timestamp": cursor.isoformat(), "windows": {}}
            for w in WINDOWS:
                candidates = [x for x in results[w] if abs((parse_ts(x["timestamp"]) - cursor).total_seconds()) <= 120]
                point["windows"][str(w)] = [{k: x[k] for k in ("expiry","strike","ceReturnPct","peReturnPct","rawPpdPp","controllingSide","pairState")} for x in candidates]
            timeline.append(point)
            cursor += timedelta(minutes=15)

    target_events = {}
    for t in sorted(TARGET_IST):
        target_events[t] = {}
        for w in WINDOWS:
            target_events[t][str(w)] = [x for x in results[w] if x["timeIst"] == t]

    out = {
        "ok": True, "mode": "READ_ONLY_H1_PPD_REPLAY_AUDIT_V1", "productionImpact": "NONE",
        "request": data.get("request"), "sourceCounts": data.get("counts"), "sourceContinuity": data.get("continuity"),
        "method": {"windowsMinutes": list(WINDOWS), "identity": "EXACT_TIMESTAMP_SAME_EXPIRY_SAME_STRIKE_CE_PE", "endpoint": "ATM_OFFSET_ZERO", "price": "LTP_REPLAY", "formula": "rawPpdPp = CE_return_pct - PE_return_pct", "crossExpiryPremiumSubtraction": False, "nearestTimestampSubstitution": False},
        "pairCount": len(pairs), "atmEndpointCount": len(endpoints), "expiriesObserved": sorted(expiries),
        "summaries": summaries, "multiDte": multi, "timeline15m": timeline, "targetEvents": target_events,
        "safety": {"readOnly": True, "affectsSelector": False, "affectsTelegram": False, "affectsExecution": False, "failClosed": True},
    }
    json.dump(out, open(args.output, "w", encoding="utf-8"), indent=2)
    print('TARGET_EVENTS', json.dumps(target_events, separators=(",", ":")))
    print(json.dumps({"ok": True, "mode": out["mode"], "pairCount": out["pairCount"], "atmEndpointCount": out["atmEndpointCount"], "summaries": {w: {"sampleCount": s["sampleCount"], "controlCounts": s["controlCounts"], "pairStateCounts": s["pairStateCounts"], "topAbsolutePpd": s["topAbsolutePpd"][:5]} for w, s in summaries.items()}, "multiDte": multi}, separators=(",", ":")))

if __name__ == "__main__":
    main()
