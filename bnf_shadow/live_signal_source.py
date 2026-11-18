"""Bounded exact-clock three-minute producer from validated live depth events.

No DB read, interpolation, timestamp relabelling or cached minute-bar IV.
"""
from collections import OrderedDict
from dataclasses import asdict
from datetime import timedelta
import math
from .domain import QuadAlignSignal, integer, timestamp
from .iv_quality import PROFILE, solve_iv


class LiveSignalProducer:
    def __init__(self, cfg, master):
        self.cfg, self.master = cfg, master
        self.history = OrderedDict()
        self.day = None
        self.counts = {'observations': 0, 'signals': 0, 'rejected': 0, 'warmup': 0}
        self.last_reason = 'WARMUP'

    def reset(self):
        self.history.clear(); self.last_reason = 'SOURCE_RESET_WARMUP'

    def status(self):
        return {**self.counts, 'reason': self.last_reason, 'contracts': len(self.history),
                'retained_observations': sum(len(h) for h in self.history.values()),
                'max_contracts': 32, 'max_observations_per_contract': 256}

    def observe(self, event, tick, now):
        now = timestamp(now)
        if self.day != now.date(): self.history.clear(); self.day = now.date()
        try:
            contract = self.master.records[event['tradingsymbol']]
            self.master.verify(contract, now)
            self.master.verify_selection(contract, tick.spot_ltp, now)
            clock = event.get('signal_source')
            if type(clock) is not dict or clock.get('expiry_clock_source') != 'INDEX_EXPIRY_CLOCK':
                raise ValueError('EXPIRY_CLOCK_EVIDENCE_MISSING')
            expiry = timestamp(clock['expiry_ts'])
            if expiry.date() != contract.expiry_date: raise ValueError('EXPIRY_IDENTITY_MISMATCH')
            oi = integer(event['packet'].get('oi'), 'oi', 0)
            asof = tick.exchange_ts
            context = event['market_context']
            spot_ts = timestamp(context['spot_ts'])
            if spot_ts.date() != asof.date() or not 0 <= (asof-spot_ts).total_seconds() <= 2:
                raise ValueError('OPTION_SPOT_NOT_SYNCHRONIZED')
            iv = solve_iv(contract.option_type, tick.ltp, tick.spot_ltp, contract.strike, asof, expiry)
            row = {'asof': asof, 'expiry': expiry, 'premium': tick.ltp, 'spot': tick.spot_ltp,
                   'spot_ts': spot_ts, 'iv': iv, 'oi': oi, 'vwap': tick.vwap}
            # Expire old observations against the actual consumer clock.
            since = now-timedelta(seconds=180+self.cfg.max_quote_age_sec)
            for name in list(self.history):
                h = self.history[name]
                for key in list(h):
                    if key < since: del h[key]
                if not h: del self.history[name]
            h = self.history.get(contract.tradingsymbol)
            if h and asof <= next(reversed(h)):
                self.last_reason = 'DUPLICATE_OR_OUT_OF_ORDER'; return []
            if h and next(reversed(h.values()))['expiry'] != expiry:
                h.clear()  # Changed authoritative expiry instant invalidates IV comparisons.
            if h is None:
                h = OrderedDict(); self.history[contract.tradingsymbol] = h
            h[asof] = row
            while len(h) > 256: h.popitem(last=False)
            self.history.move_to_end(contract.tradingsymbol)
            while len(self.history) > 32: self.history.popitem(last=False)
            self.counts['observations'] += 1
            candidates = [c for c in self.master.records.values() if c.expiry_date == contract.expiry_date and c.strike == contract.strike]
            events = []
            # Evaluate both sides when the pair completes, irrespective of arrival order.
            for selected in candidates:
                result = self._candidate(selected, asof, now)
                if result: events.append(result)
            if events:
                self.counts['signals'] += len(events); self.last_reason = 'SIGNAL_EVIDENCE_READY'
            else:
                self.counts['warmup'] += 1
            return events
        except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
            self.counts['rejected'] += 1; self.last_reason = 'SOURCE_EVIDENCE_REJECTED'
            return []

    def _candidate(self, contract, asof, now):
        baseline = asof-timedelta(seconds=180)
        if baseline.date() != asof.date(): self.last_reason = 'CROSS_SESSION_BASELINE'; return None
        opposites = [c for c in self.master.records.values() if c.expiry_date == contract.expiry_date
                     and c.strike == contract.strike and c.option_type != contract.option_type]
        if len(opposites) != 1: self.last_reason = 'OPPOSITE_CONTRACT_MISSING'; return None
        opposite = opposites[0]
        own, opp = self.history.get(contract.tradingsymbol, {}), self.history.get(opposite.tradingsymbol, {})
        if any(ts not in rows for rows in (own, opp) for ts in (baseline, asof)):
            self.last_reason = 'EXACT_180S_PAIR_WARMUP'; return None
        current, old, other, other_old = own[asof], own[baseline], opp[asof], opp[baseline]
        if len({r['expiry'] for r in (current, old, other, other_old)}) != 1:
            self.last_reason = 'EXPIRY_CLOCK_CHANGED'; return None
        times = [[ts for ts in rows if baseline <= ts <= asof] for rows in (own, opp)]
        gap = max(math.ceil((xs[i]-xs[i-1]).total_seconds()) for xs in times for i in range(1,len(xs)))
        signal = QuadAlignSignal(f'live3m:{contract.instrument_token}:{asof.isoformat()}', contract, asof, baseline,
            opposite.tradingsymbol, current['premium'], current['premium']-old['premium'], current['spot'],
            current['vwap'], current['iv'], current['iv']-old['iv'], other['premium']-other_old['premium'],
            other['oi']-other_old['oi'], gap)
        try: signal.validate(self.cfg, now)
        except ValueError: self.last_reason = 'QUAD_ALIGN_NOT_QUALIFIED'; return None
        def sample(row):
            return {'asof_ts': row['asof'].isoformat(), 'quote_ts': row['asof'].isoformat(),
                    'spot_ts': row['spot_ts'].isoformat(), 'premium': row['premium'], 'spot': row['spot'], 'iv_percent': row['iv']}
        evidence = {'profile': PROFILE, 'instrument_token': contract.instrument_token, 'tradingsymbol': contract.tradingsymbol,
            'parameters': {'annual_rate': .10, 'dividend_yield': 0, 'year_days': 365, 'units': 'PERCENT_POINTS'},
            'expiry_clock_source': 'INDEX_EXPIRY_CLOCK', 'expiry_ts': current['expiry'].isoformat(),
            'current': sample(current), 'baseline': sample(old),
            'opposite': {'tradingsymbol': opposite.tradingsymbol,
                'current': {'quote_ts': asof.isoformat(), 'premium': other['premium'], 'oi': other['oi']},
                'baseline': {'quote_ts': baseline.isoformat(), 'premium': other_old['premium'], 'oi': other_old['oi']}}}
        wire = asdict(signal); wire['contract'] = contract.wire()
        wire['signal_ts'], wire['baseline_ts'] = asof.isoformat(), baseline.isoformat()
        return {'type': 'signal', 'signal': wire, 'iv_evidence': evidence}
