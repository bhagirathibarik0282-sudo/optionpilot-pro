"""Read-only snapshot signal producer/preflight. Never emits execution depth.

Minute buckets remain the signal clock. Quote timestamps prove freshness; they
never replace the bucket or move an old observation to the current time.
"""
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal
import json
import math
from .domain import IST, QuadAlignSignal, timestamp


class EvidenceRejected(ValueError):
    pass


def reject(code):
    raise EvidenceRejected(code)


def numeric(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        reject('INVALID_NUMERIC_EVIDENCE')
    value = float(value)
    if not math.isfinite(value): reject('INVALID_NUMERIC_EVIDENCE')
    return value


def clock(value):
    try: return timestamp(value)
    except (ValueError, TypeError, AttributeError): reject('MISSING_OR_NAIVE_TIMESTAMP')


class SnapshotSignalSource:
    def __init__(self, cfg, master, approved_calculation_versions=()):
        self.cfg, self.master = cfg, master
        # A matching opaque version alone does not establish IV units/method.
        self.approved_versions = frozenset(approved_calculation_versions)

    def produce(self, option_rows, market_rows, now):
        now = clock(now)
        counts = Counter()
        if not option_rows:
            return [], {'status': 'SOURCE_BLOCKED', 'reason_counts': {'NO_OPTION_ROWS': 1}, 'signals': 0, 'depth_ticks': 0}
        buckets = [clock(r['minute_bucket']) for r in option_rows]
        bucket = max(buckets)
        if bucket.second or bucket.microsecond: reject('INVALID_MINUTE_BUCKET')
        # No fallback to an older bucket, and no relabelling delayed rows as now.
        age = (now-bucket).total_seconds()
        if not 0 <= age <= self.cfg.max_signal_age_sec:
            return [], {'status': 'SOURCE_BLOCKED', 'reason_counts': {'SIGNAL_BUCKET_STALE_OR_FUTURE': 1},
                        'bucket': bucket.isoformat(), 'bucket_age_sec': age, 'signals': 0, 'depth_ticks': 0}
        index = {}
        for row in option_rows:
            key = (clock(row['minute_bucket']), str(row['expiry']), numeric(row['strike']), row['option_type'])
            if key in index: reject('DUPLICATE_CONTRACT_BUCKET')
            index[key] = row
        markets = [r for r in market_rows if clock(r['minute_bucket']) == bucket and r['symbol'] == 'BANKNIFTY']
        if len(markets) != 1: reject('MISSING_OR_DUPLICATE_MARKET_BUCKET')
        market = markets[0]
        if market.get('freshness_status') not in (True, 'TRUE'): reject('MARKET_NOT_FRESH')
        self._row_clock(market, bucket, now, 'exchange_timestamp', current=True)
        if not market.get('snapshot_id'): reject('MISSING_SNAPSHOT_ID')
        spot, vwap = numeric(market['spot_ltp']), numeric(market['vwap'])
        if spot <= 0 or vwap <= 0: reject('MISSING_SPOT_OR_VWAP')
        events = []
        current = [r for r in option_rows if clock(r['minute_bucket']) == bucket]
        for row in current:
            try:
                if row['symbol'] != 'BANKNIFTY': reject('WRONG_SYMBOL')
                contract_matches = [c for c in self.master.records.values() if
                    str(c.expiry_date) == str(row['expiry']) and c.strike == numeric(row['strike']) and c.option_type == row['option_type']]
                if len(contract_matches) != 1: reject('MASTER_CONTRACT_MISSING_OR_AMBIGUOUS')
                contract = contract_matches[0]
                self.master.verify(contract, now)
                self.master.verify_selection(contract, spot, now)
                opposite_type = 'PE' if contract.option_type == 'CE' else 'CE'
                opposite_matches = [c for c in self.master.records.values() if c.expiry_date == contract.expiry_date
                    and c.strike == contract.strike and c.option_type == opposite_type]
                if len(opposite_matches) != 1: reject('OPPOSITE_MASTER_CONTRACT_MISSING_OR_AMBIGUOUS')
                bars, opposite_bars = [], []
                for offset in (3, 2, 1, 0):
                    b = bucket-timedelta(minutes=offset)
                    if b.date() != bucket.date(): reject('CROSS_SESSION_BASELINE')
                    for side, dest in ((contract.option_type, bars), (opposite_type, opposite_bars)):
                        evidence = index.get((b, str(contract.expiry_date), contract.strike, side))
                        if evidence is None: reject('MISSING_EXACT_FOUR_BAR_EVIDENCE')
                        if evidence['symbol'] != 'BANKNIFTY': reject('WRONG_SYMBOL')
                        if evidence.get('validation_status') != 'RESEARCH_ELIGIBLE': reject('OPTION_NOT_RESEARCH_ELIGIBLE')
                        self._row_clock(evidence, b, now, 'quote_timestamp', current=(offset == 0))
                        if numeric(evidence['ltp']) <= 0: reject('INVALID_PREMIUM')
                        dest.append(evidence)
                versions = {r.get('calculation_version') for r in bars+opposite_bars}
                if len(versions) != 1 or not next(iter(versions)): reject('OPTION_CALCULATION_LINEAGE_MISMATCH')
                if not versions <= self.approved_versions: reject('IV_CALCULATION_VERSION_NOT_APPROVED')
                if any(r.get('snapshot_id') != market['snapshot_id'] for r in (bars[-1], opposite_bars[-1])):
                    reject('CURRENT_SNAPSHOT_ID_MISMATCH')
                for r in bars:
                    if numeric(r['iv']) <= 0: reject('MISSING_OR_NONPOSITIVE_IV')
                for r in opposite_bars:
                    if type(r.get('oi')) is not int or r['oi'] < 0: reject('INVALID_OPPOSITE_OI')
                gaps = [int(math.ceil((clock(seq[i]['quote_timestamp'])-clock(seq[i-1]['quote_timestamp'])).total_seconds()))
                        for seq in (bars, opposite_bars) for i in range(1, 4)]
                if min(gaps) <= 0: reject('NONMONOTONIC_QUOTES')
                signal = QuadAlignSignal(
                    signal_id=f'db1m:{contract.instrument_token}:{bucket.isoformat()}', contract=contract,
                    signal_ts=bucket, baseline_ts=bucket-timedelta(minutes=3),
                    opposite_tradingsymbol=opposite_matches[0].tradingsymbol,
                    signal_ltp=numeric(bars[-1]['ltp']), ltp_chg_3m=numeric(bars[-1]['ltp'])-numeric(bars[0]['ltp']),
                    spot_ltp=spot, vwap=vwap, iv=numeric(bars[-1]['iv']),
                    iv_chg_3m=numeric(bars[-1]['iv'])-numeric(bars[0]['iv']),
                    opp_ltp_chg_3m=numeric(opposite_bars[-1]['ltp'])-numeric(opposite_bars[0]['ltp']),
                    opp_oi_chg_3m=opposite_bars[-1]['oi']-opposite_bars[0]['oi'], max_bar_gap_sec=max(gaps))
                signal.validate(self.cfg, now)
                from dataclasses import asdict
                wire = asdict(signal)
                wire['contract'] = contract.wire()
                wire['signal_ts'], wire['baseline_ts'] = signal.signal_ts.isoformat(), signal.baseline_ts.isoformat()
                events.append({'type': 'signal', 'signal': wire})
            except EvidenceRejected as exc: counts[str(exc)] += 1
            except (ValueError, TypeError, KeyError): counts['STRATEGY_OR_CONTRACT_QUALIFICATION_REJECTED'] += 1
        return events, {'status': 'SIGNALS_AVAILABLE' if events else 'SOURCE_BLOCKED', 'bucket': bucket.isoformat(),
            'bucket_age_sec': age, 'signals': len(events), 'depth_ticks': 0, 'reason_counts': dict(counts)}

    def _row_clock(self, row, bucket, now, column, current):
        quote = clock(row.get(column))
        if not bucket <= quote < bucket+timedelta(minutes=1): reject('QUOTE_OUTSIDE_ITS_MINUTE_BUCKET')
        if quote > now: reject('FUTURE_QUOTE')
        if current and (now-quote).total_seconds() > self.cfg.max_quote_age_sec: reject('CURRENT_QUOTE_STALE')
        if column == 'quote_timestamp':
            age = numeric(row.get('quote_age_seconds'))
            if not 0 <= age <= self.cfg.max_quote_age_sec: reject('RECORDED_QUOTE_STALE')


def read_snapshot_evidence(db_url, now):
    """Bounded consistent read. No DDL, DELETE, session credential reads or writes."""
    import psycopg2
    from psycopg2.extras import RealDictCursor
    now = clock(now)
    since = now.replace(second=0, microsecond=0)-timedelta(minutes=4)
    conn = psycopg2.connect(db_url, connect_timeout=5,
        options='-c default_transaction_read_only=on -c statement_timeout=3000')
    try:
        conn.set_session(isolation_level='REPEATABLE READ', readonly=True)
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""SELECT symbol, minute_bucket, snapshot_id, expiry, strike, option_type, ltp, oi, iv,
                quote_timestamp, quote_age_seconds, validation_status, calculation_version
                FROM public.option_snapshot_1m WHERE symbol='BANKNIFTY' AND minute_bucket >= %s
                AND minute_bucket <= %s ORDER BY minute_bucket DESC, expiry, strike, option_type LIMIT 2001""", (since, now))
            options = [dict(r) for r in cur.fetchall()]
            if len(options) > 2000: reject('SOURCE_ROW_LIMIT_EXCEEDED')
            cur.execute("""SELECT symbol, minute_bucket, snapshot_id, exchange_timestamp, freshness_status, spot_ltp, vwap
                FROM public.market_snapshot_1m WHERE symbol='BANKNIFTY' AND minute_bucket >= %s
                AND minute_bucket <= %s ORDER BY minute_bucket DESC LIMIT 7""", (since, now))
            markets = [dict(r) for r in cur.fetchall()]
        return options, markets
    finally: conn.close()


def main():
    """One-shot preflight only: no trade store, engine, depth fill, or schema mutation."""
    import argparse
    import os
    from pathlib import Path
    from .bridge import InstrumentMaster
    from .domain import BNFConfig
    from .session import SessionProvider
    parser = argparse.ArgumentParser(description='Read-only BANKNIFTY source preflight; no paper or real orders')
    parser.add_argument('--config', required=True)
    parser.add_argument('--approved-calculation-version', action='append', default=[],
        help='Only after independently checking IV units/method and input lineage; default approves none')
    args = parser.parse_args()
    cfg = BNFConfig(**json.loads(Path(args.config).read_text()))
    db = os.environ.get('DATABASE_URL', '')
    provider = SessionProvider(db, os.environ.get('KITE_API_KEY', ''), os.environ.get('KITE_SESSION_ENCRYPTION_KEY', ''))
    session = provider.resolve(); provider.verify(session)
    master = InstrumentMaster(provider.get('/instruments/NFO', session).decode(), datetime.now(IST).date())
    now = datetime.now(IST)
    options, markets = read_snapshot_evidence(db, now)
    _, report = SnapshotSignalSource(cfg, master, args.approved_calculation_version).produce(options, markets, datetime.now(IST))
    report.update(broker_orders=0, journal_writes=0, note='Signals only; fresh depth producer still required for execution')
    print(json.dumps(report, allow_nan=False))


if __name__ == '__main__':
    try: main()
    except Exception:
        print(json.dumps({'status': 'SOURCE_PREFLIGHT_FAILED', 'broker_orders': 0, 'journal_writes': 0}))
        raise SystemExit(1)
