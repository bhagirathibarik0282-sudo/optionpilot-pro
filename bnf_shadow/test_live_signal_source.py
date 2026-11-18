from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .depth_source import KiteDepthSource
from .domain import BNFConfig
from .engine import OrderStateMachine
from .iv_quality import price, validate_signal_iv
from .live_signal_source import LiveSignalProducer
from .store import TradeStore
from .test_bnf_shadow import NOW, C
from .test_snapshot_source import CSV

EXPIRY=NOW.replace(day=23,hour=15,minute=30)
P=replace(C,tradingsymbol='BANKNIFTY_TEST_PE',instrument_token=102,option_type='PE')
BASE=NOW-timedelta(seconds=180)

def event_at(contract,ts,iv=21,premium=None,oi=1000):
    years=(EXPIRY-ts).total_seconds()/(365*86400)
    px=price(contract.option_type,62100,62000,years,iv/100) if premium is None else premium
    empty=[dict(price=0,quantity=0,orders=0) for _ in range(4)]
    return dict(type='kite_depth',tradingsymbol=contract.tradingsymbol,receive_ts=ts.isoformat(),
        signal_source=dict(expiry_clock_source='INDEX_EXPIRY_CLOCK',expiry_ts=EXPIRY.isoformat()),
        packet=dict(mode='full',isIndex=False,instrumentToken=contract.instrument_token,lastPrice=px,oi=oi,
            exchangeTimestamp=ts.isoformat(),marketDepth=dict(buy=[dict(price=px-.05,quantity=30,orders=1)]+deepcopy(empty),sell=[dict(price=px,quantity=30,orders=1)]+deepcopy(empty))),
        market_context=dict(symbol='BANKNIFTY',vwap_basis='NEAR_FUTURES_AVERAGE_PRICE',comparison_policy='LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE',
            spot_ltp=62100,vwap=62000,spot_ts=ts.isoformat(),vwap_ts=ts.isoformat()))

class LiveSignalTests(unittest.TestCase):
    def setUp(self):
        self.cfg=BNFConfig();self.master=InstrumentMaster(CSV,NOW.date())
        self.producer=LiveSignalProducer(self.cfg,self.master)
        self.depth=KiteDepthSource(self.cfg,self.master)
    def send(self,event,now=None):
        from .domain import timestamp
        now=now or timestamp(event['receive_ts'])
        return self.producer.observe(event,self.depth.to_tick(event,now),now)
    def seed(self):
        self.send(event_at(C,BASE,iv=20));self.send(event_at(P,BASE,premium=600,oi=1100))
    def complete(self,reverse=False):
        events=[event_at(C,NOW,iv=21),event_at(P,NOW,premium=580,oi=1000)]
        result=[]
        for e in (reversed(events) if reverse else events): result+=self.send(e)
        return result

    def test_exact_pair_generates_computed_iv_and_raw_opposite_receipt(self):
        self.seed();events=self.complete()
        self.assertEqual(len(events),1)
        from .domain import ContractSpec,QuadAlignSignal,timestamp
        raw=events[0]['signal'];raw['contract']=ContractSpec.from_wire(raw['contract'])
        for key in ('signal_ts','baseline_ts'):raw[key]=timestamp(raw[key])
        receipt=validate_signal_iv(QuadAlignSignal(**raw),self.cfg,NOW,events[0]['iv_evidence'])
        self.assertAlmostEqual(receipt['samples']['current']['iv_percent'],21)
        self.assertEqual(receipt['opposite_evidence']['current']['oi'],1000)
        self.assertEqual(receipt['opposite_evidence']['baseline']['oi'],1100)

    def test_arrival_order_cannot_lose_qualified_side(self):
        self.seed();self.assertEqual(len(self.complete(reverse=True)),1)

    def test_nearby_baseline_is_not_interpolated(self):
        self.send(event_at(C,BASE+timedelta(seconds=1),iv=20))
        self.send(event_at(P,BASE+timedelta(seconds=1),premium=600,oi=1100))
        self.assertEqual(self.complete(),[])
        self.assertEqual(self.producer.last_reason,'EXACT_180S_PAIR_WARMUP')

    def test_missing_oi_or_expiry_does_not_create_observation(self):
        for key in ('oi','signal_source'):
            e=event_at(C,NOW)
            if key=='oi':del e['packet']['oi']
            else:del e[key]
            self.assertEqual(self.send(e),[])
        self.assertEqual(self.producer.status()['retained_observations'],0)

    def test_future_spot_at_option_clock_cannot_create_iv(self):
        e=event_at(C,NOW);e['receive_ts']=(NOW+timedelta(seconds=1)).isoformat()
        e['market_context']['spot_ts']=e['receive_ts']
        self.assertEqual(self.send(e,NOW+timedelta(seconds=1)),[])
        self.assertEqual(self.producer.status()['retained_observations'],0)

    def test_duplicate_or_out_of_order_quote_cannot_replace_first_observation(self):
        self.send(event_at(C,NOW,oi=1000));self.send(event_at(C,NOW,oi=999))
        self.send(event_at(C,NOW-timedelta(seconds=1),oi=998))
        self.assertEqual(self.producer.history[C.tradingsymbol][NOW]['oi'],1000)
        self.assertEqual(self.producer.status()['observations'],1)

    def test_day_change_clears_history_even_if_old_master_rejects(self):
        self.seed();e=event_at(C,NOW+timedelta(days=1))
        # Depth boundary already rejects an old master; directly verify cache cleanup.
        tick=self.depth.to_tick(event_at(C,NOW),NOW)
        self.producer.observe(e,tick,NOW+timedelta(days=1))
        self.assertEqual(self.producer.status()['retained_observations'],0)

    def test_expiry_clock_change_drops_prior_iv_baseline(self):
        self.seed();e=event_at(C,NOW);e['signal_source']['expiry_ts']=(EXPIRY-timedelta(minutes=1)).isoformat()
        self.send(e)
        self.assertNotIn(BASE,self.producer.history[C.tradingsymbol])

    def test_history_has_hard_per_contract_bound(self):
        for i in range(270):self.send(event_at(C,NOW+timedelta(milliseconds=i)))
        self.assertLessEqual(self.producer.status()['retained_observations'],256)

    def test_increasing_opposite_oi_does_not_qualify(self):
        self.seed();self.send(event_at(C,NOW))
        self.assertEqual(self.send(event_at(P,NOW,premium=580,oi=1200)),[])

    def test_strict_bridge_derives_entry_and_later_depth_fills_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=TradeStore(sqlite3.connect(Path(tmp)/'live.sqlite'),'live-producer',postgres=False)
            try:
                store.migrate();store.acquire();engine=OrderStateMachine(self.cfg,store)
                bridge=OptionPilotLiveBridge(engine,self.master,require_iv_evidence=True,derive_live_signals=True)
                for e in [event_at(C,BASE,iv=20),event_at(P,BASE,premium=600,oi=1100),event_at(C,NOW),event_at(P,NOW,premium=580,oi=1000)]:
                    from .domain import timestamp
                    bridge.consume(e,timestamp(e['receive_ts']))
                self.assertEqual(engine.active['state'],'ENTRY_PENDING')
                entry_px=engine.active['limit_price']
                bridge.consume(event_at(C,NOW+timedelta(seconds=1),premium=entry_px),NOW+timedelta(seconds=1))
                self.assertEqual(engine.active['state'],'OPEN');self.assertEqual(engine.active['filled_qty'],30)
                rows=store.connection.execute('SELECT payload FROM bnf_shadow_event_v1 WHERE scope=?',(store.scope,)).fetchall()
                intents=[json.loads(r[0]) for r in rows if json.loads(r[0])['kind']=='ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED']
                self.assertEqual(intents[0]['details']['iv_quality_receipt']['opposite_evidence']['current']['oi'],1000)
            finally:store.close()

    def test_source_reset_restarts_warmup_without_inventing_history(self):
        self.seed();self.producer.reset();self.assertEqual(self.complete(),[])
        self.assertEqual(self.producer.status()['retained_observations'],2)

    def test_opposite_raw_evidence_mismatch_rejected_by_iv_gate(self):
        self.seed();event=self.complete()[0]
        from .domain import ContractSpec,QuadAlignSignal,timestamp
        raw=event['signal'];raw['contract']=ContractSpec.from_wire(raw['contract'])
        for key in ('signal_ts','baseline_ts'):raw[key]=timestamp(raw[key])
        event['iv_evidence']['opposite']['current']['oi']+=1
        with self.assertRaisesRegex(ValueError,'OPPOSITE_SIGNAL'):
            validate_signal_iv(QuadAlignSignal(**raw),self.cfg,NOW,event['iv_evidence'])

    def test_live_derivation_cannot_disable_iv_quality_gate(self):
        class Engine:cfg=BNFConfig()
        with self.assertRaises(ValueError):OptionPilotLiveBridge(Engine(),self.master,derive_live_signals=True)

if __name__=='__main__':unittest.main()
