from dataclasses import asdict
from datetime import timedelta, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .depth_source import KiteDepthSource
from .domain import BNFConfig
from .engine import OrderStateMachine
from .store import TradeStore
from .test_bnf_shadow import C, NOW, sig
from .test_snapshot_source import CSV


def depth_event(seconds=1):
    ts = NOW+timedelta(seconds=seconds)
    def levels(first, increment):
        return [dict(price=round(first+i*increment, 2), quantity=30, orders=1) for i in range(5)]
    return dict(type='kite_depth', tradingsymbol=C.tradingsymbol, receive_ts=ts.isoformat(),
        packet=dict(mode='full', isIndex=False, instrumentToken=101, lastPrice=200,
            exchangeTimestamp=ts.isoformat(), marketDepth=dict(buy=levels(199.95, -.05), sell=levels(200, .05))),
        market_context=dict(symbol='BANKNIFTY', spot_ltp=62100, vwap=62000, spot_ts=ts.isoformat(), vwap_ts=ts.isoformat()))


class DepthSourceTests(unittest.TestCase):
    def setUp(self):
        self.master = InstrumentMaster(CSV, NOW.date())
        self.source = KiteDepthSource(BNFConfig(), self.master)
        self.event = depth_event()
        self.now = NOW+timedelta(seconds=1)

    def test_real_field_names_and_best_level_quantities(self):
        self.event['packet']['marketDepth']['sell'][0]['quantity'] = 15
        tick = self.source.to_tick(self.event, self.now)
        self.assertEqual((tick.best_ask, tick.best_ask_qty), (200, 15))
        self.assertEqual((tick.best_bid, tick.best_bid_qty), (199.95, 30))

    def test_typescript_decoder_utc_z_format(self):
        utc = self.now.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        self.event['packet']['exchangeTimestamp'] = utc
        self.event['receive_ts'] = utc
        self.assertEqual(self.source.to_tick(self.event, self.now).exchange_ts, self.now)

    def test_receipt_retry_has_stable_identity(self):
        first = self.source.to_tick(self.event, self.now)
        self.event['receive_ts'] = (self.now+timedelta(seconds=1)).isoformat()
        second = self.source.to_tick(self.event, self.now+timedelta(seconds=1))
        self.assertEqual(first.event_id, second.event_id)

    def test_missing_quantities_never_replaced_with_total_quantity(self):
        del self.event['packet']['marketDepth']['buy'][0]['quantity']
        self.event['packet']['totalBuyQuantity'] = 999999
        with self.assertRaises((KeyError, ValueError)): self.source.to_tick(self.event, self.now)

    def test_wrong_token_and_nonfull_packets_rejected(self):
        for key, value in (('instrumentToken', 102), ('instrumentToken', True), ('mode', 'quote'), ('isIndex', True)):
            event = depth_event(); event['packet'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.source.to_tick(event, self.now)

    def test_stale_future_and_naive_exchange_timestamps_rejected(self):
        for ts in (NOW-timedelta(seconds=6), NOW+timedelta(seconds=2), NOW.replace(tzinfo=None)):
            self.event['packet']['exchangeTimestamp'] = ts.isoformat()
            with self.subTest(ts=ts), self.assertRaises(ValueError): self.source.to_tick(self.event, self.now)

    def test_market_context_must_be_fresh_and_same_index(self):
        for key, value in (('symbol', 'NIFTY'), ('spot_ts', (NOW-timedelta(seconds=5)).isoformat()),
                           ('vwap_ts', (NOW-timedelta(minutes=1)).isoformat()), ('vwap_ts', None)):
            event = depth_event(); event['market_context'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.source.to_tick(event, self.now)

    def test_missing_zero_and_invalid_depth_not_invented(self):
        for change in ('missing', 'empty', 'negative', 'boolean', 'unsorted', 'duplicate', 'crossed', 'nan'):
            event = depth_event(); buy = event['packet']['marketDepth']['buy']
            if change == 'missing': buy.pop()
            if change == 'empty': buy[:] = [dict(price=0, quantity=0, orders=0)]*5
            if change == 'negative': buy[0]['quantity'] = -1
            if change == 'boolean': buy[0]['quantity'] = True
            if change == 'unsorted': buy.reverse()
            if change == 'duplicate': buy[1]['price'] = buy[0]['price']
            if change == 'crossed': buy[0]['price'] = 201
            if change == 'nan': buy[0]['price'] = float('nan')
            with self.subTest(change=change), self.assertRaises(ValueError): self.source.to_tick(event, self.now)

    def test_zero_best_quantity_does_not_borrow_other_levels(self):
        self.event['packet']['marketDepth']['sell'][0]['quantity'] = 0
        self.assertEqual(self.source.to_tick(self.event, self.now).best_ask_qty, 0)

    def test_bridge_packet_to_durable_paper_fill(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = TradeStore(sqlite3.connect(Path(tmp)/'test.sqlite'), 'depth-integration', postgres=False)
            try:
                store.migrate(); store.acquire()
                engine = OrderStateMachine(BNFConfig(), store)
                bridge = OptionPilotLiveBridge(engine, self.master)
                signal = asdict(sig()); signal['contract'] = C.wire()
                signal['signal_ts'], signal['baseline_ts'] = NOW.isoformat(), (NOW-timedelta(minutes=3)).isoformat()
                bridge.consume({'type': 'signal', 'signal': signal}, NOW)
                bridge.consume_line(json.dumps(depth_event()), self.now)
                self.assertEqual(engine.active['filled_qty'], 30)
                self.assertEqual(engine.active['state'], 'OPEN')
                version, snapshot = store.load({})
                self.assertEqual(snapshot['active']['filled_qty'], 30)
                self.assertEqual(version, engine.version)
            finally: store.close()

    def test_wrong_master_day_rejected(self):
        with self.assertRaises(ValueError): self.source.to_tick(self.event, self.now+timedelta(days=1))


if __name__ == '__main__': unittest.main()
