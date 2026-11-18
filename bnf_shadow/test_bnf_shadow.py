import ast
from dataclasses import asdict, replace
from datetime import date, datetime, timedelta
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from .domain import BNFConfig, ContractSpec, IST, QuadAlignSignal, TickSnapshot
from .engine import OrderStateMachine
from .store import TradeStore, StoreConflict
from .bridge import InstrumentMaster, OptionPilotLiveBridge

NOW=datetime(2026,11,18,10,0,tzinfo=IST)
C=ContractSpec('NFO','BANKNIFTY','BANKNIFTY_TEST_CE',101,date(2026,11,23),62000,'CE',30,0.05)

def sig(**changes):
    values=dict(signal_id='signal-1',contract=C,signal_ts=NOW,baseline_ts=NOW-timedelta(minutes=3),
        opposite_tradingsymbol='BANKNIFTY_TEST_PE',signal_ltp=206,ltp_chg_3m=12,
        spot_ltp=62100,vwap=62000,iv=20,iv_chg_3m=0.5,opp_ltp_chg_3m=-5,opp_oi_chg_3m=-10,max_bar_gap_sec=60)
    return QuadAlignSignal(**{**values,**changes})

def tick(seconds=1, **changes):
    now=NOW+timedelta(seconds=seconds)
    values=dict(event_id=f'tick-{seconds}',instrument_token=101,exchange_ts=now,receive_ts=now,
        ltp=200,best_bid=199.95,best_bid_qty=30,best_ask=200,best_ask_qty=30,spot_ltp=62100,vwap=62000)
    return TickSnapshot(**{**values,**changes})

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'journal.sqlite'
        self.cfg=BNFConfig()
        self.store=self.open_store()
        self.e=OrderStateMachine(self.cfg,self.store)
    def open_store(self):
        s=TradeStore(sqlite3.connect(self.path,check_same_thread=False),'test-account:BNF:SHADOW',postgres=False)
        s.migrate();s.acquire();return s
    def tearDown(self):
        self.store.close();self.tmp.cleanup()
    def send(self,t): self.e.on_tick(t,t.receive_ts)
    def enter(self):
        self.e.on_signal(sig(),NOW);self.send(tick())
    def exit_target(self):
        self.send(tick(2,best_bid=233,best_ask=233.05))
        self.send(tick(3,best_bid=232,best_ask=232.05))

    def test_strict_config_and_mode_isolation(self):
        for kwargs in ({'mode':'LIVE_1LOT'},{'mode':'LIVE_2LOT'},{'lots':True},{'lots':1.0},
            {'contract_lot_size':30.5},{'trail_lock_pts':True},{'trail_lock_pts':-1},
            {'sl_pts':float('nan')},{'target_pts':float('inf')},{'cooldown_sec':0}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError): BNFConfig(**kwargs)
        self.assertEqual(self.cfg.qty,30)
        with self.assertRaises(Exception): self.cfg.lots=2

    def test_contract_and_decimal_floor(self):
        self.assertEqual(C.floor_price(100.049),100)
        for kwargs in ({'instrument_token':0},{'strike':0},{'tick_size':True},{'contract_lot_size':False}):
            with self.assertRaises(ValueError): replace(C,**kwargs)

    def test_signal_qualification_and_clock(self):
        for kwargs in ({'signal_ltp':0},{'max_bar_gap_sec':-1},{'iv':0},{'opp_oi_chg_3m':True},
            {'ltp_chg_3m':11.99},{'signal_ts':NOW-timedelta(seconds=11)},
            {'baseline_ts':NOW-timedelta(seconds=179)},{'spot_ltp':61900}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError): self.e.on_signal(sig(**kwargs),NOW)

    def test_capital_cap_and_cost_reserve(self):
        e=OrderStateMachine(self.cfg,self.store)
        self.assertIsNone(e.on_signal(sig(signal_ltp=1000),NOW))
        self.assertIsNotNone(e.on_signal(sig(signal_ltp=836),NOW))  # 830*30+75 = 24975: inside cap

    def test_one_position_and_signal_id_dedup(self):
        self.assertTrue(self.e.on_signal(sig(),NOW))
        self.assertIsNone(self.e.on_signal(sig(signal_id='another'),NOW))
        self.e.stop(NOW+timedelta(seconds=1))
        later=NOW+timedelta(minutes=20)
        self.assertIsNone(self.e.on_signal(sig(signal_ts=later,baseline_ts=later-timedelta(minutes=3)),later))

    def test_partial_fill_timeout_requires_exit_confirmation(self):
        self.store.scope='partial-entry-two-lot'
        self.e=OrderStateMachine(replace(self.cfg,lots=2,max_capital_inr=45000),self.store)
        self.e.on_signal(sig(),NOW)
        self.send(tick(best_ask_qty=30,best_bid_qty=30))
        self.assertEqual(self.e.active['state'],'PARTIALLY_FILLED')
        self.e.heartbeat(NOW+timedelta(seconds=301))
        self.assertEqual(self.e.active['state'],'EXIT_PENDING')
        self.send(tick(302,best_bid_qty=15))
        self.assertEqual(self.e.active['exited_qty'],0)
        self.send(tick(303,best_bid_qty=30))
        self.assertIsNone(self.e.active)
        result=self.e.snapshot['last_result']
        self.assertEqual(result['filled_qty'],30)
        self.assertAlmostEqual(result['net_pnl_inr_estimated'],-76.5)

    def test_two_lot_exit_can_fill_one_lot_at_a_time(self):
        self.store.scope='partial-exit-two-lot'
        self.e=OrderStateMachine(replace(self.cfg,lots=2,max_capital_inr=45000),self.store)
        self.e.on_signal(sig(),NOW);self.send(tick(best_ask_qty=60))
        self.e.stop(NOW+timedelta(seconds=2))
        self.send(tick(3,best_bid_qty=30))
        self.assertEqual(self.e.active['exited_qty'],30)
        self.send(tick(4,best_bid_qty=30))
        self.assertIsNone(self.e.active)
        self.assertAlmostEqual(self.e.snapshot['last_result']['net_pnl_inr_estimated'],-78)

    def test_target_uses_bid_and_actual_simulated_exit_fills(self):
        self.enter();self.exit_target()
        r=self.e.snapshot['last_result']
        self.assertEqual(r['reason'],'TARGET')
        self.assertEqual(r['net_pnl_inr_estimated'],885)

    def test_zero_depth_does_not_invent_exit(self):
        self.enter();self.e.stop(NOW+timedelta(seconds=2))
        self.send(tick(3,best_bid_qty=0))
        self.assertEqual(self.e.active['state'],'EXIT_PENDING')
        self.assertEqual(self.e.active['exited_qty'],0)

    def test_watchdog_works_without_ticks(self):
        self.enter();self.e.heartbeat(NOW+timedelta(seconds=181))
        self.assertEqual(self.e.active['state'],'EXIT_PENDING')
        self.assertEqual(self.e.active['reason'],'FEED_GAP')

    def test_duplicate_and_older_ticks_do_not_refill(self):
        self.store.scope='duplicate-two-lot'
        self.e=OrderStateMachine(replace(self.cfg,lots=2,max_capital_inr=45000),self.store)
        self.e.on_signal(sig(),NOW)
        t=tick(best_ask_qty=30);self.send(t);self.send(t)
        self.assertEqual(self.e.active['filled_qty'],30)
        self.send(replace(t,event_id='new-id-same-timestamp'))
        self.assertEqual(self.e.active['filled_qty'],30)

    def test_stale_future_crossed_and_wrong_instrument(self):
        self.e.on_signal(sig(),NOW)
        for t in (tick(best_bid=201),tick(best_ask_qty=-1),tick(ltp=float('nan'))):
            with self.assertRaises(ValueError): self.send(t)
        with self.assertRaises(ValueError): self.e.on_tick(tick(),NOW+timedelta(seconds=9))
        self.send(tick(instrument_token=999))
        self.assertEqual(self.e.active['filled_qty'],0)

    def test_entry_timeout_without_fill_is_not_charged(self):
        self.e.on_signal(sig(),NOW);self.e.heartbeat(NOW+timedelta(seconds=301))
        self.assertIsNone(self.e.active)
        self.assertEqual(self.e.snapshot['last_result']['net_pnl_inr_estimated'],0)

    def test_restart_preserves_exposure_and_exits_on_fresh_quote(self):
        self.enter()
        self.store.close();self.store=self.open_store()
        self.e=OrderStateMachine(self.cfg,self.store)
        self.assertEqual(self.e.active['state'],'RECONCILIATION_REQUIRED')
        self.send(tick(2))
        self.assertIsNone(self.e.active)
        self.assertEqual(self.e.snapshot['last_result']['reason'],'RESTART_RECOVERY')

    def test_restart_cancels_unfilled_pending_entry(self):
        self.e.on_signal(sig(),NOW)
        self.e=OrderStateMachine(self.cfg,self.store)
        self.assertIsNone(self.e.active)
        self.assertEqual(self.e.snapshot['last_result']['state'],'CANCELLED')

    def test_database_failure_blocks_further_paper_fills(self):
        self.e.on_signal(sig(),NOW)
        original=self.store.save
        self.store.save=lambda *args,**kwargs: (_ for _ in ()).throw(RuntimeError('test journal failure'))
        with self.assertRaises(RuntimeError): self.send(tick())
        self.assertFalse(self.e.logging_healthy)
        self.assertEqual(self.e.active['filled_qty'],0)
        self.store.save=original
        with self.assertRaises(RuntimeError): self.send(tick(2))

    def test_state_cas_prevents_stale_writer(self):
        other=OrderStateMachine(self.cfg,self.store)
        self.e.on_signal(sig(),NOW)
        with self.assertRaises(StoreConflict): other.on_signal(sig(signal_id='other'),NOW)
        self.assertEqual(self.store.load({})[1]['active']['signal_id'],'signal-1')

    def test_concurrent_signals_create_one_intent(self):
        answers=[]
        def go(i): answers.append(self.e.on_signal(sig(signal_id=f'signal-{i}'),NOW))
        threads=[threading.Thread(target=go,args=(i,)) for i in range(8)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(sum(bool(a) for a in answers),1)

    def test_hold_timeout_and_session_cleanup(self):
        self.enter()
        # Keep quotes fresh so max hold, rather than feed-gap timeout, fires.
        for seconds in range(100,1201,100): self.send(tick(seconds,best_ask=201))
        self.e.heartbeat(NOW+timedelta(seconds=1201))
        self.assertEqual(self.e.active['reason'],'TIME_EXIT')

    def test_day_rollover_keeps_exposure(self):
        self.enter();self.e.heartbeat(NOW+timedelta(days=1))
        self.assertEqual(self.e.active['filled_qty'],30)
        self.assertEqual(self.e.active['reason'],'DAY_ROLLOVER')

    def test_stop_loss_counts_only_after_confirmed_shadow_exit(self):
        self.enter();self.send(tick(2,best_bid=178,best_ask=178.05))
        self.assertEqual(self.e.snapshot['days'].get(NOW.date().isoformat(),{}).get('sl_count',0),0)
        self.send(tick(3,best_bid=177,best_ask=177.05))
        self.assertEqual(self.e.snapshot['days'][NOW.date().isoformat()]['sl_count'],1)

    def test_trail_is_not_claimed_to_be_guaranteed_profit(self):
        self.enter();self.send(tick(2,best_bid=215,best_ask=215.05))
        self.assertTrue(self.e.active['trailed'])
        self.send(tick(3,best_bid=202,best_ask=202.05));self.send(tick(4,best_bid=201,best_ask=201.05))
        self.assertEqual(self.e.snapshot['last_result']['net_pnl_inr_estimated'],-45)

    def test_bridge_requires_exact_instrument_identity(self):
        csv='instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,exchange\n101,BANKNIFTY_TEST_CE,BANKNIFTY,2026-11-23,62000,0.05,30,CE,NFO\n102,BANKNIFTY_TEST_PE,BANKNIFTY,2026-11-23,62000,0.05,30,PE,NFO\n'
        master=InstrumentMaster(csv,NOW.date())
        bridge=OptionPilotLiveBridge(self.e,master)
        s=asdict(sig());s['contract']=C.wire();s['signal_ts']=NOW.isoformat();s['baseline_ts']=(NOW-timedelta(minutes=3)).isoformat()
        s['contract']['instrument_token']=999
        with self.assertRaises(ValueError):bridge.consume({'type':'signal','signal':s},NOW)
        s['contract']=C.wire()
        self.assertTrue(bridge.consume({'type':'signal','signal':s},NOW))

    def test_config_change_requires_explicit_new_review(self):
        with self.assertRaisesRegex(ValueError,'config differs'):
            OrderStateMachine(replace(self.cfg,lots=2),self.store)

    def test_no_fill_before_latency_and_cancel_prevents_future_fill(self):
        self.e.on_signal(sig(),NOW)
        self.send(tick(0))
        self.assertEqual(self.e.active['filled_qty'],0)
        self.e.stop(NOW)
        self.send(tick(1))
        self.assertIsNone(self.e.active)
        self.assertEqual(self.e.snapshot['last_result']['filled_qty'],0)

    def test_market_close_does_not_discard_open_exposure(self):
        self.enter()
        self.e.heartbeat(NOW.replace(hour=15,minute=20))
        self.assertEqual(self.e.active['reason'],'SESSION_CLOSE')
        self.assertEqual(self.e.active['filled_qty'],30)

    def test_expiry_window_and_stale_master(self):
        expiry=replace(C,expiry_date=NOW.date())
        self.assertFalse(self.cfg.entry_window(NOW.replace(hour=13,minute=31),expiry))
        self.assertTrue(self.cfg.entry_window(NOW.replace(hour=13,minute=30),expiry))
        self.assertFalse(self.cfg.entry_window(NOW.replace(hour=12),C))

    def test_daily_sl_counter_survives_restart(self):
        cfg=replace(self.cfg,cooldown_sec=1)
        # A fresh journal scope is used because configuration changes are deliberately blocked.
        self.store.scope='counter-test'
        engine=OrderStateMachine(cfg,self.store)
        for i in range(3):
            base=NOW+timedelta(seconds=10*i)
            engine.on_signal(sig(signal_id=f'sl-{i}',signal_ts=base,baseline_ts=base-timedelta(minutes=3)),base)
            for offset,price in ((1,200),(2,178),(3,177)):
                ts=base+timedelta(seconds=offset)
                t=tick(10*i+offset,best_bid=price,best_ask=price if offset==1 else price+0.05)
                engine.on_tick(t,ts)
        engine=OrderStateMachine(cfg,self.store)
        base=NOW+timedelta(minutes=1)
        self.assertIsNone(engine.on_signal(sig(signal_id='blocked',signal_ts=base,baseline_ts=base-timedelta(minutes=3)),base))
        self.assertEqual(engine.snapshot['days'][NOW.date().isoformat()]['sl_count'],3)

    def test_stop_reason_survives_shutdown_and_restart(self):
        self.enter();self.send(tick(2,best_bid=178,best_ask=178.05))
        self.e.stop(NOW+timedelta(seconds=3))
        self.e=OrderStateMachine(self.cfg,self.store,startup_now=NOW+timedelta(seconds=4))
        self.send(tick(5,best_bid=177,best_ask=177.05))
        self.assertEqual(self.e.snapshot['last_result']['reason'],'STOP_LOSS')
        self.assertEqual(self.e.snapshot['days'][NOW.date().isoformat()]['sl_count'],1)

    def test_replay_runner_end_to_end_without_broker_or_network(self):
        import contextlib
        import io
        import os
        import sys
        from unittest.mock import patch
        from .__main__ import main
        base=Path(__file__).parent/'examples'
        args=['bnf-shadow','--config',str(base/'one_lot.json'),'--replay','--input',str(base/'synthetic_events.jsonl'),'--instrument-master',str(base/'synthetic_master.csv'),'--master-date','2026-11-18']
        output=io.StringIO()
        # Runner closes the supplied test connection; tearDown can close SQLite twice safely.
        with patch.object(sys,'argv',args),patch.dict(os.environ,{'DATABASE_URL':'synthetic-test-only','EXECUTION_MODE':'SHADOW'}),patch.object(TradeStore,'connect',return_value=self.store),contextlib.redirect_stdout(output):
            main()
        result=json.loads(output.getvalue())
        self.assertEqual(result['broker_orders'],0)
        self.assertIsNone(result['snapshot']['active'])
        self.assertEqual(result['snapshot']['last_result']['net_pnl_inr_estimated'],885)

    def test_master_nearest_expiry_and_atm_band(self):
        csv='instrument_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,exchange\n'
        for i,strike in enumerate((62000,62100,62200,62300)):
            csv+=f'{101+i},TEST_{strike},BANKNIFTY,2026-11-23,{strike},0.05,30,CE,NFO\n'
        csv+='201,TEST_NEXT,BANKNIFTY,2026-12-29,62100,0.05,30,CE,NFO\n'
        master=InstrumentMaster(csv,NOW.date())
        master.verify_selection(master.records['TEST_62000'],62100,NOW)
        with self.assertRaisesRegex(ValueError,'ATM'):
            master.verify_selection(master.records['TEST_62300'],62100,NOW)
        with self.assertRaisesRegex(ValueError,'nearest'):
            master.verify_selection(master.records['TEST_NEXT'],62100,NOW)
        with self.assertRaisesRegex(ValueError,'stale'):
            master.verify(master.records['TEST_62000'],NOW+timedelta(days=1))

    def test_package_cannot_submit_real_orders(self):
        for path in Path(__file__).parent.glob('*.py'):
            if path.name.startswith('test_'): continue
            tree=ast.parse(path.read_text())
            calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
            self.assertFalse({'place_order','modify_order','cancel_order'} & set(calls),path.name)


class SessionTests(unittest.TestCase):
    def test_existing_dashboard_aes_gcm_format_and_expiry(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from .session import SessionProvider
        token='synthetic-token-never-a-real-credential'
        secret='synthetic-test-encryption-key-32-bytes'
        iv=bytes(range(12))
        encrypted=AESGCM(hashlib.sha256(secret.encode()).digest()).encrypt(iv,token.encode(),None)
        sealed=f'{iv.hex()}:{encrypted[-16:].hex()}:{encrypted[:-16].hex()}'
        row=[sealed,'session-fingerprint','TESTUSER',NOW+timedelta(hours=1),hashlib.sha256(token.encode()).hexdigest()[:16]]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def execute(self,q,p):
                if not q.startswith('SELECT '):raise AssertionError('auth reader must not write')
            def fetchone(self):return row
        class Connection:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def cursor(self):return Cursor()
            def close(self):pass
        provider=SessionProvider('synthetic-db-url','synthetic-key',secret)
        with patch.dict(sys.modules,{'psycopg2':SimpleNamespace(connect=lambda *a,**kw:Connection())}):
            session=provider.resolve(NOW)
            self.assertEqual(session.token,token)
            self.assertNotIn(token,repr(session))
            with self.assertRaisesRegex(RuntimeError,'RECONNECT'):provider.resolve(NOW+timedelta(hours=2))
            row[0]=sealed[:-2]+'00'
            with self.assertRaisesRegex(RuntimeError,'INTEGRITY'):provider.resolve(NOW)

    def test_read_client_rejects_order_paths(self):
        from .session import SessionProvider,Session
        p=SessionProvider('db','key','x'*32)
        with self.assertRaisesRegex(ValueError,'NOT_ALLOWED'):
            p.get('/orders/regular',Session('test','TESTUSER',NOW+timedelta(days=1)))

if __name__=='__main__': unittest.main()
