"""Consumer capture and offline restore tests. SQLite fixtures only; no network."""
from copy import deepcopy
from datetime import timedelta
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .domain import BNFConfig,timestamp
from .engine import OrderStateMachine
from .replay_capture import ReplayCapture,make_capture,clean_input
from .replay_verify import replay_capture_file
from .store import TradeStore
from .test_bnf_shadow import NOW,C,sig
from .test_live_signal_source import event_at,P,BASE
from .test_snapshot_source import CSV

REFERENCE={'spotToken':1,'nearFutureToken':2,'nearFutureLabel':'BANKNIFTY_TEST_FUT',
           'nearFutureExpiry':'2026-11-23','masterDate':'2026-11-18',
           'vwapBasis':'NEAR_FUTURES_AVERAGE_PRICE','comparisonPolicy':'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE'}
def packet(contract,ts,**kw):
    event=event_at(contract,ts,**kw)
    event['market_context']['reference_identity']=dict(REFERENCE)
    return event

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.master=InstrumentMaster(CSV,NOW.date())
        self.cfg=BNFConfig(lots=2,max_capital_inr=45000)
    def tearDown(self):self.tmp.cleanup()
    def scenario(self,capture_options=None):
        store=TradeStore(sqlite3.connect(self.root/'journal.sqlite'),'PRIVATE_ACCOUNT',postgres=False)
        store.migrate();store.acquire()
        recorder=ReplayCapture(self.cfg,self.master,self.root/'capture',**(capture_options or {}))
        recorder.startup_now=BASE;store.replay_recorder=recorder
        engine=OrderStateMachine(self.cfg,store,startup_now=BASE)
        bridge=OptionPilotLiveBridge(engine,self.master,require_iv_evidence=True,derive_live_signals=True)
        def send(event):
            now=timestamp(event['receive_ts'])
            with engine.lock:
                recorder.operation('INPUT',now,event);bridge.consume(event,now)
        for event in [packet(C,BASE,iv=20),packet(P,BASE,premium=600,oi=1100),
                      packet(C,NOW,iv=21),packet(P,NOW,premium=580,oi=1000)]:send(event)
        self.assertIsNotNone(engine.active)
        entry=engine.active['limit_price']
        send(packet(C,NOW+timedelta(seconds=1),premium=entry))
        send(packet(C,NOW+timedelta(seconds=2),premium=entry))
        self.assertEqual(engine.active['filled_qty'],60)
        send(packet(C,NOW+timedelta(seconds=3),premium=entry+33))
        send(packet(C,NOW+timedelta(seconds=4),premium=entry+32))
        send(packet(C,NOW+timedelta(seconds=5),premium=entry+32))
        self.assertIsNone(engine.active)
        recorder.operation('HEARTBEAT',NOW+timedelta(seconds=6));engine.heartbeat(NOW+timedelta(seconds=6))
        recorder.operation('STOP',NOW+timedelta(seconds=7),reason='INPUT_EOF');engine.stop(NOW+timedelta(seconds=7),'INPUT_EOF')
        recorder.close(engine.snapshot,bridge.producer.status());store.close()
        return recorder,engine
    def test_captured_two_lot_partial_fills_restore_exact_economic_journal(self):
        recorder,engine=self.scenario()
        self.assertEqual(recorder.status()['state'],'SEALED')
        result=replay_capture_file(recorder.sealed)
        self.assertTrue(result['ok']);self.assertTrue(result['economicJournalMatches']);self.assertTrue(result['finalStateMatches'])
        self.assertFalse(result['completeSessionVerified']);self.assertEqual(result['brokerOrders'],0)
        with gzip.open(recorder.sealed,'rt') as stream:rows=[json.loads(s) for s in stream]
        text=json.dumps(rows)
        self.assertNotIn('PRIVATE_ACCOUNT',text)
        header=rows[0];self.assertEqual(header['config']['lots'],2)
        self.assertEqual(header['contracts'][0]['contract_lot_size'],30)
        ticks=[r['event'] for r in rows if r.get('operation')=='INPUT']
        self.assertEqual(ticks[0]['packet']['marketDepth']['buy'][0]['quantity'],30)
        self.assertEqual(ticks[0]['market_context']['reference_identity'],REFERENCE)
        self.assertEqual(sum(r.get('kind')=='JOURNAL' and r['event']['kind']=='ENTRY_FILL' for r in rows),2)
        self.assertEqual(sum(r.get('kind')=='JOURNAL' and r['event']['kind']=='EXIT_FILL' for r in rows),2)
        meta=json.loads(recorder.meta.read_text());self.assertEqual(meta['sha256'],hashlib.sha256(recorder.sealed.read_bytes()).hexdigest())
    def test_capture_limit_does_not_change_the_paper_result_but_blocks_replay(self):
        recorder,engine=self.scenario({'max_bytes':100})
        self.assertEqual(engine.snapshot['last_result']['state'],'CLOSED')
        self.assertEqual(recorder.status()['state'],'INCOMPLETE')
        self.assertGreater(recorder.status()['recordsDropped'],0)
        with self.assertRaisesRegex(ValueError,'INCOMPLETE'):replay_capture_file(recorder.sealed)
    def test_unknown_fields_are_not_serialized(self):
        event=packet(C,NOW)
        event['token']='SECRET';event['packet']['account']='SECRET';event['market_context']['reference_identity']['auth']='SECRET'
        self.assertNotIn('SECRET',json.dumps(clean_input(event)))
    def test_tampered_state_or_code_fails_verification(self):
        recorder,_=self.scenario()
        with gzip.open(recorder.sealed,'rt') as stream:rows=[json.loads(s) for s in stream]
        rows[-1]['finalSnapshot']['days'][str(NOW.date())]['realized_estimated']+=1
        with gzip.open(recorder.sealed,'wt') as stream:
            for row in rows:stream.write(json.dumps(row)+'\n')
        self.assertFalse(replay_capture_file(recorder.sealed)['ok'])
        rows[0]['codeHashes']['engine.py']='wrong'
        with gzip.open(recorder.sealed,'wt') as stream:
            for row in rows:stream.write(json.dumps(row)+'\n')
        with self.assertRaisesRegex(ValueError,'CODE_VERSION'):replay_capture_file(recorder.sealed)
    def test_disabled_is_default_and_write_failure_is_observational_only(self):
        self.assertIsNone(make_capture(self.cfg,self.master,{}))
        bad=self.root/'not-a-directory';bad.write_text('keep')
        recorder=ReplayCapture(self.cfg,self.master,bad)
        recorder.start(0,{},[]);self.assertEqual(recorder.status()['state'],'INCOMPLETE')
        self.assertEqual(bad.read_text(),'keep')

    def test_existing_pending_journal_recovery_and_deduplication_seed_are_restored(self):
        store=TradeStore(sqlite3.connect(self.root/'restart.sqlite'),'PRIVATE_ACCOUNT',postgres=False)
        store.migrate();store.acquire()
        old=OrderStateMachine(self.cfg,store,startup_now=BASE);old.on_signal(sig(),NOW)
        recorder=ReplayCapture(self.cfg,self.master,self.root/'capture');recorder.startup_now=NOW+timedelta(seconds=1)
        store.replay_recorder=recorder
        engine=OrderStateMachine(self.cfg,store,startup_now=recorder.startup_now)
        bridge=OptionPilotLiveBridge(engine,self.master,require_iv_evidence=True,derive_live_signals=True)
        self.assertEqual(engine.snapshot['last_result']['state'],'CANCELLED')
        recorder.close(engine.snapshot,bridge.producer.status());store.close()
        self.assertTrue(replay_capture_file(recorder.sealed)['ok'])
        with gzip.open(recorder.sealed,'rt') as stream:header=json.loads(stream.readline())
        self.assertEqual(header['seenSignalIds'],['signal-1'])

    def test_queue_overflow_is_explicit_and_bounded(self):
        recorder=ReplayCapture(self.cfg,self.master,self.root/'capture',queue_size=1)
        release=threading.Event();original=ReplayCapture._write
        def delayed(instance,header):
            release.wait(2);original(instance,header)
        with patch.object(ReplayCapture,'_write',delayed):
            recorder.start(0,{},[])
            recorder.operation('HEARTBEAT',NOW)
            recorder.operation('HEARTBEAT',NOW+timedelta(seconds=1))
            self.assertEqual(recorder.status()['state'],'INCOMPLETE')
            self.assertLessEqual(recorder.queue.qsize(),1)
            release.set();recorder.close({}, {})
        self.assertGreater(recorder.status()['recordsDropped'],0)

    def test_source_reset_is_part_of_the_replayed_clock(self):
        store=TradeStore(sqlite3.connect(self.root/'reset.sqlite'),'PRIVATE_ACCOUNT',postgres=False)
        store.migrate();store.acquire()
        recorder=ReplayCapture(self.cfg,self.master,self.root/'capture');recorder.startup_now=BASE
        store.replay_recorder=recorder;engine=OrderStateMachine(self.cfg,store,startup_now=BASE)
        bridge=OptionPilotLiveBridge(engine,self.master,require_iv_evidence=True,derive_live_signals=True)
        for e in [packet(C,BASE,iv=20),packet(P,BASE,premium=600,oi=1100)]:
            recorder.operation('INPUT',BASE,e);bridge.consume(e,BASE)
        recorder.operation('SOURCE_RESET',BASE+timedelta(seconds=1));bridge.producer.reset()
        for e in [packet(C,NOW,iv=21),packet(P,NOW,premium=580,oi=1000)]:
            recorder.operation('INPUT',NOW,e);bridge.consume(e,NOW)
        self.assertIsNone(engine.active)
        recorder.close(engine.snapshot,bridge.producer.status());store.close()
        result=replay_capture_file(recorder.sealed)
        self.assertTrue(result['ok']);self.assertTrue(result['sourceDecisionCountsMatch'])

if __name__=='__main__':unittest.main()
