from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
import unittest
from .bridge import InstrumentMaster
from .domain import BNFConfig
from .snapshot_source import SnapshotSignalSource, EvidenceRejected
from .test_bnf_shadow import NOW, C

CSV = ('instrument_token,tradingsymbol,name,expiry,strike,instrument_type,lot_size,tick_size,exchange\n'
       '101,BANKNIFTY_TEST_CE,BANKNIFTY,2026-11-23,62000,CE,30,0.05,NFO\n'
       '102,BANKNIFTY_TEST_PE,BANKNIFTY,2026-11-23,62000,PE,30,0.05,NFO\n')


def evidence():
    rows = []
    for offset in (3, 2, 1, 0):
        bucket = NOW-timedelta(minutes=offset)
        for side in ('CE', 'PE'):
            rows.append(dict(symbol='BANKNIFTY', minute_bucket=bucket, snapshot_id=f'snap-{offset}',
                expiry=C.expiry_date, strike=Decimal('62000'), option_type=side,
                ltp=Decimal(str(206-offset*4 if side == 'CE' else 200+offset*2)),
                oi=1000+offset*10, iv=Decimal(str(20-offset*.1)), quote_timestamp=bucket+timedelta(seconds=1),
                quote_age_seconds=1, validation_status='RESEARCH_ELIGIBLE', calculation_version='verified-test-v1'))
    market = [dict(symbol='BANKNIFTY', minute_bucket=NOW, snapshot_id='snap-0', exchange_timestamp=NOW+timedelta(seconds=1),
                   freshness_status='TRUE', spot_ltp=Decimal('62100'), vwap=Decimal('62000'))]
    return rows, market


class SnapshotSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = SnapshotSignalSource(BNFConfig(), InstrumentMaster(CSV, NOW.date()), ['verified-test-v1'])
        self.rows, self.market = evidence()
        self.now = NOW+timedelta(seconds=2)

    def run_source(self): return self.source.produce(self.rows, self.market, self.now)

    def test_exact_evidence_emits_signal_never_depth(self):
        events, report = self.run_source()
        self.assertEqual(len(events), 1)
        signal = events[0]['signal']
        self.assertEqual(signal['contract']['instrument_token'], 101)
        self.assertEqual(signal['ltp_chg_3m'], 12)
        self.assertEqual(signal['opp_oi_chg_3m'], -30)
        self.assertEqual(signal['signal_ts'], NOW.isoformat())
        self.assertEqual(signal['baseline_ts'], (NOW-timedelta(minutes=3)).isoformat())
        self.assertEqual(report['depth_ticks'], 0)
        self.assertEqual({e['type'] for e in events}, {'signal'})

    def test_real_observed_write_delay_does_not_relabel_signal(self):
        self.now = NOW+timedelta(seconds=13)
        events, report = self.run_source()
        self.assertEqual(events, [])
        self.assertEqual(report['reason_counts'], {'SIGNAL_BUCKET_STALE_OR_FUTURE': 1})
        self.assertEqual(report['bucket'], NOW.isoformat())

    def test_old_quote_in_new_bucket_rejected(self):
        self.rows[-2]['quote_timestamp'] = NOW-timedelta(days=6)
        events, report = self.run_source()
        self.assertFalse(events)
        self.assertIn('QUOTE_OUTSIDE_ITS_MINUTE_BUCKET', report['reason_counts'])

    def test_missing_intermediate_bar_rejected(self):
        self.rows = [r for r in self.rows if r['minute_bucket'] != NOW-timedelta(minutes=1)]
        events, report = self.run_source()
        self.assertFalse(events)
        self.assertIn('MISSING_EXACT_FOUR_BAR_EVIDENCE', report['reason_counts'])

    def test_invalid_lineage_iv_oi_age_and_status_rejected(self):
        for key, value in (('iv', None), ('iv', 0), ('iv', float('nan')), ('oi', True),
                           ('quote_age_seconds', 999), ('validation_status', 'UNKNOWN'),
                           ('calculation_version', None), ('calculation_version', 'other-version')):
            with self.subTest(key=key, value=value):
                self.rows, self.market = evidence()
                # Opposite OI validation uses PE; all other values affect CE baseline.
                self.rows[1 if key == 'oi' else 0][key] = value
                self.assertFalse(self.run_source()[0])

    def test_snapshot_mix_rejected(self):
        self.market[0]['snapshot_id'] = 'unrelated-snapshot'
        self.assertFalse(self.run_source()[0])

    def test_missing_or_future_market_clock_rejected(self):
        for value in (None, NOW.replace(tzinfo=None), NOW+timedelta(seconds=3)):
            self.market[0]['exchange_timestamp'] = value
            with self.subTest(value=value), self.assertRaises(EvidenceRejected): self.run_source()

    def test_market_freshness_and_vwap_not_filled_from_futures(self):
        self.market[0]['vwap'] = None
        self.market[0]['future_vwap'] = 62000
        with self.assertRaises(EvidenceRejected): self.run_source()
        self.rows, self.market = evidence()
        self.market[0]['freshness_status'] = 'FALSE'
        with self.assertRaises(EvidenceRejected): self.run_source()

    def test_duplicate_contract_bucket_rejected(self):
        self.rows.append(deepcopy(self.rows[0]))
        with self.assertRaises(EvidenceRejected): self.run_source()

    def test_stale_quote_with_fresh_bucket_rejected(self):
        self.now = NOW+timedelta(seconds=8)
        with self.assertRaises(EvidenceRejected): self.run_source()

    def test_source_is_read_only_and_no_broker_execution_import(self):
        import inspect
        from . import snapshot_source
        source = inspect.getsource(snapshot_source)
        for token in ('place_order', 'cancel_order', 'DELETE FROM', 'INSERT INTO', 'CREATE TABLE'):
            self.assertNotIn(token, source)

    def test_opaque_iv_version_not_approved_by_default(self):
        source = SnapshotSignalSource(BNFConfig(), InstrumentMaster(CSV, NOW.date()))
        events, report = source.produce(self.rows, self.market, self.now)
        self.assertFalse(events)
        self.assertIn('IV_CALCULATION_VERSION_NOT_APPROVED', report['reason_counts'])

    def test_empty_rows_blocked(self):
        events, report = self.source.produce([], [], self.now)
        self.assertFalse(events)
        self.assertEqual(report['status'], 'SOURCE_BLOCKED')


if __name__ == '__main__': unittest.main()
