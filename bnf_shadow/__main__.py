"""Manual worker; intentionally not wired into Railway/npm startup."""
import argparse
from dataclasses import asdict
from datetime import datetime
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .domain import BNFConfig, IST, timestamp
from .engine import OrderStateMachine
from .session import SessionProvider
from .store import TradeStore
from .replay_capture import make_capture

_worker_stage = 'BOOTSTRAP'

def worker_failure_report(error, stage):
    """Fixed diagnostic codes only; never stringify driver/auth/input exceptions."""
    stages = {'BOOTSTRAP', 'SESSION_CHECK', 'JOURNAL_OPEN', 'ENGINE_START',
              'INPUT_CONSUME', 'WATCHDOG', 'SHUTDOWN'}
    stage = stage if stage in stages else 'BOOTSTRAP'
    reason = ('SESSION_CHECK_FAILED' if stage == 'SESSION_CHECK' else
              'JOURNAL_UNAVAILABLE_OR_CONFLICT' if stage in ('JOURNAL_OPEN', 'WATCHDOG') else
              'CONFIGURATION_INVALID' if stage in ('BOOTSTRAP', 'ENGINE_START') else
              'INPUT_OR_STRATEGY_FAILED' if stage == 'INPUT_CONSUME' else
              'WORKER_INTERNAL_ERROR')
    return {'status': 'SHADOW_WORKER_STOPPED', 'broker_orders': 0,
            'stage': stage, 'reason': reason}

def paper_status(engine):
    """Read-only, allowlisted paper fill receipt; never publishes account or order payloads."""
    def leg(value):
        if not isinstance(value, dict):
            return None
        def qty(key):
            val = value.get(key)
            return val if type(val) is int and val >= 0 else None
        return {
            'state': str(value.get('state', 'UNKNOWN'))[:40],
            'requested_qty': qty('requested_qty'),
            'filled_qty': qty('filled_qty'),
            'exited_qty': qty('exited_qty'),
        }
    with engine.lock:
        active = leg(engine.snapshot.get('active'))
        last_result = leg(engine.snapshot.get('last_result'))
    return {'status': 'SHADOW_EXECUTION_STATUS', 'reported_at': datetime.now(IST).isoformat(),
            'active': active, 'last_result': last_result, 'broker_orders': 0,
            'replay_capture': getattr(getattr(engine, 'store', None), 'replay_recorder', None).status()
                if getattr(getattr(engine, 'store', None), 'replay_recorder', None) else None}

def main():
    global _worker_stage
    parser=argparse.ArgumentParser(description='BANKNIFTY SHADOW only; accepts validated JSONL signals and depth ticks')
    parser.add_argument('--config',required=True,help='JSON BNFConfig file')
    parser.add_argument('--input',help='JSONL file; defaults to stdin')
    parser.add_argument('--replay',action='store_true',help='Use explicit event now timestamps; no real-time assumptions')
    parser.add_argument('--instrument-master',help='Local Kite-format CSV; required for replay')
    parser.add_argument('--master-date',help='YYYY-MM-DD CSV as-of date; required for replay')
    parser.add_argument('--preflight',action='store_true',help='Check runtime/auth/master/journal read-only and exit')
    parser.add_argument('--init-schema',action='store_true',help='Apply additive SHADOW schema and exit')
    args=parser.parse_args()
    if args.preflight and (args.replay or args.init_schema or args.input): raise ValueError('preflight is a separate read-only mode')
    cfg=BNFConfig(**json.loads(Path(args.config).read_text()))
    if os.environ.get('EXECUTION_MODE','SHADOW').strip().upper()!='SHADOW':
        raise ValueError('LIVE_DISABLED')
    db_url=os.environ.get('DATABASE_URL','')
    if not db_url: raise ValueError('DATABASE_URL required')
    provider=None
    if args.replay:
        if not args.input or not args.instrument_master or not args.master_date:
            raise ValueError('replay requires input, instrument-master and master-date')
        account='REPLAY'
        master=InstrumentMaster(Path(args.instrument_master).read_text(),args.master_date)
    else:
        _worker_stage = 'SESSION_CHECK'
        provider=SessionProvider(db_url,os.environ.get('KITE_API_KEY',''),os.environ.get('KITE_SESSION_ENCRYPTION_KEY',''))
        session=provider.resolve(); provider.verify(session)
        account=session.user_id
        master=InstrumentMaster(provider.get('/instruments/NFO',session).decode(),datetime.now(IST).date())
    if args.preflight:
        from .runtime_preflight import check_journal
        nearest=min((c.expiry_date for c in master.records.values() if c.expiry_date>=datetime.now(IST).date()),default=None)
        if nearest is None or any(c.contract_lot_size!=cfg.contract_lot_size for c in master.records.values() if c.expiry_date==nearest):
            print(json.dumps({'status':'CONTRACT_LOT_CONFIG_MISMATCH','ready':False,'broker_orders':0,'journal_writes':0}),flush=True)
            raise SystemExit(2)
        report=check_journal(db_url); print(json.dumps(report),flush=True)
        if not report['ready']: raise SystemExit(2)
        return
    # One account/strategy/mode owner, regardless of configuration differences.
    _worker_stage = 'JOURNAL_OPEN'
    store=TradeStore.connect(db_url,f'BNF_V1:{account}:SHADOW')
    capture = make_capture(cfg, master) if not args.replay and not args.init_schema else None
    store.replay_recorder = capture
    try:
        store.acquire()
        if args.init_schema:
            store.migrate(); print(json.dumps({'status':'SHADOW_SCHEMA_READY','broker_orders':0})); return
        startup_now=datetime.now(IST)
        if args.replay:
            with open(args.input) as first_input:
                startup_now=timestamp(json.loads(first_input.readline())['now'])
        _worker_stage = 'ENGINE_START'
        if capture: capture.startup_now = startup_now
        engine=OrderStateMachine(cfg,store,startup_now=startup_now)
        bridge=OptionPilotLiveBridge(engine,master,require_iv_evidence=not args.replay,derive_live_signals=not args.replay)
        if not args.replay: print(json.dumps({'status':'SHADOW_WORKER_READY','mode':'SHADOW','broker_orders':0}),flush=True)
        if not args.replay: print(json.dumps(paper_status(engine)),flush=True)
        stream=open(args.input) if args.input else sys.stdin
        try:
            if args.replay:
                last=None
                for line in stream:
                    event=json.loads(line)
                    now=timestamp(event['now'])
                    if last and now<last: raise ValueError('replay clock moved backwards')
                    last=now; bridge.consume_line(line,now)
                # EOF is not an invented fill. Unresolved paper exposure remains durable.
                print(json.dumps({'mode':'SHADOW_REPLAY','broker_orders':0,'snapshot':engine.snapshot},allow_nan=False))
                return
            events=queue.Queue(maxsize=500)
            done=object()
            def read_input():
                try:
                    while True:
                        line=stream.readline(32770)
                        if not line: break
                        if len(line)>32768: events.put(ValueError('oversized event')); break
                        events.put(line)
                finally: events.put(done)
            threading.Thread(target=read_input,daemon=True).start()
            checked=time.monotonic()
            halted=threading.Event()
            watchdog_errors=[]
            def watchdog():
                while not halted.wait(1):
                    try:
                        with engine.lock:
                            beat_now = datetime.now(IST)
                            if capture: capture.operation('HEARTBEAT', beat_now)
                            engine.heartbeat(beat_now)
                    except Exception:
                        watchdog_errors.append(True); halted.set()
            watcher=threading.Thread(target=watchdog,daemon=True)
            watcher.start()
            while True:
                if watchdog_errors:
                    _worker_stage = 'WATCHDOG'
                    raise RuntimeError('WATCHDOG_JOURNAL_FAILED')
                now=datetime.now(IST)
                if time.monotonic()-checked>=30:
                    # Report observed decisions before a session read can fail.
                    if bridge.producer: print(json.dumps({"status":"SHADOW_SOURCE_STATUS",**bridge.producer.status()}),file=sys.stderr,flush=True)
                    print(json.dumps(paper_status(engine)),flush=True)
                    _worker_stage = 'SESSION_CHECK'
                    current=provider.resolve(); provider.verify(current)
                    if current.user_id!=account: raise ValueError('session account changed')
                    if current.token!=session.token and bridge.producer:
                        with engine.lock:
                            if capture: capture.operation('SOURCE_RESET', datetime.now(IST))
                            bridge.producer.reset()
                    session=current
                    checked=time.monotonic()
                _worker_stage = 'INPUT_CONSUME'
                try: event=events.get(timeout=1)
                except queue.Empty: continue
                if event is done:
                    _worker_stage = 'SHUTDOWN'
                    with engine.lock:
                        end_now = datetime.now(IST)
                        if capture: capture.operation('STOP', end_now, reason='INPUT_EOF')
                        engine.stop(end_now,'INPUT_EOF')
                    break
                if isinstance(event,Exception): raise event
                try:
                    with engine.lock:
                        consume_now = datetime.now(IST)
                        if capture:
                            try: capture.operation('INPUT', consume_now, json.loads(event))
                            except Exception: capture.fail('CAPTURE_INPUT_UNSUPPORTED')
                        bridge.consume_line(event, consume_now)
                except ValueError:
                    # Invalid producer evidence never enters the strategy. Do not print payloads.
                    print(json.dumps({'status':'INPUT_REJECTED','mode':'SHADOW'}),file=sys.stderr)
        except BaseException:
            if not args.replay and bridge.producer:
                print(json.dumps({"status":"SHADOW_SOURCE_STATUS",**bridge.producer.status()}),file=sys.stderr,flush=True)
            with engine.lock:
                stop_now = datetime.now(IST)
                if capture: capture.operation('STOP', stop_now, reason='WORKER_STOPPED')
                engine.stop(stop_now,'WORKER_STOPPED')
            raise
        finally:
            if 'halted' in locals():
                halted.set(); watcher.join(timeout=5)
            if args.input: stream.close()
    finally:
        if capture:
            capture.close(engine.snapshot if 'engine' in locals() else None,
                          bridge.producer.status() if 'bridge' in locals() and bridge.producer else None)
            if 'engine' in locals(): print(json.dumps(paper_status(engine)),flush=True)
        store.close()

if __name__=='__main__':
    try: main()
    except Exception as error:
        # Never print raw driver errors, auth responses or input payloads.
        print(json.dumps(worker_failure_report(error, _worker_stage)),file=sys.stderr,flush=True)
        sys.exit(1)
