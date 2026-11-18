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

def main():
    parser=argparse.ArgumentParser(description='BANKNIFTY SHADOW only; accepts validated JSONL signals and depth ticks')
    parser.add_argument('--config',required=True,help='JSON BNFConfig file')
    parser.add_argument('--input',help='JSONL file; defaults to stdin')
    parser.add_argument('--replay',action='store_true',help='Use explicit event now timestamps; no real-time assumptions')
    parser.add_argument('--instrument-master',help='Local Kite-format CSV; required for replay')
    parser.add_argument('--master-date',help='YYYY-MM-DD CSV as-of date; required for replay')
    parser.add_argument('--init-schema',action='store_true',help='Apply additive SHADOW schema and exit')
    args=parser.parse_args()
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
        provider=SessionProvider(db_url,os.environ.get('KITE_API_KEY',''),os.environ.get('KITE_SESSION_ENCRYPTION_KEY',''))
        session=provider.resolve(); provider.verify(session)
        account=session.user_id
        master=InstrumentMaster(provider.get('/instruments/NFO',session).decode(),datetime.now(IST).date())
    # One account/strategy/mode owner, regardless of configuration differences.
    store=TradeStore.connect(db_url,f'BNF_V1:{account}:SHADOW')
    try:
        store.acquire()
        if args.init_schema:
            store.migrate(); print(json.dumps({'status':'SHADOW_SCHEMA_READY','broker_orders':0})); return
        startup_now=datetime.now(IST)
        if args.replay:
            with open(args.input) as first_input:
                startup_now=timestamp(json.loads(first_input.readline())['now'])
        engine=OrderStateMachine(cfg,store,startup_now=startup_now)
        bridge=OptionPilotLiveBridge(engine,master)
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
                    try: engine.heartbeat(datetime.now(IST))
                    except Exception:
                        watchdog_errors.append(True); halted.set()
            watcher=threading.Thread(target=watchdog,daemon=True)
            watcher.start()
            while True:
                if watchdog_errors: raise RuntimeError('WATCHDOG_JOURNAL_FAILED')
                now=datetime.now(IST)
                if time.monotonic()-checked>=30:
                    current=provider.resolve(); provider.verify(current)
                    if current.user_id!=account: raise ValueError('session account changed')
                    checked=time.monotonic()
                try: event=events.get(timeout=1)
                except queue.Empty: continue
                if event is done: engine.stop(now,'INPUT_EOF'); break
                if isinstance(event,Exception): raise event
                try: bridge.consume_line(event,datetime.now(IST))
                except ValueError:
                    # Invalid producer evidence never enters the strategy. Do not print payloads.
                    print(json.dumps({'status':'INPUT_REJECTED','mode':'SHADOW'}),file=sys.stderr)
        except BaseException:
            engine.stop(datetime.now(IST),'WORKER_STOPPED')
            raise
        finally:
            if 'halted' in locals():
                halted.set(); watcher.join(timeout=5)
            if args.input: stream.close()
    finally: store.close()

if __name__=='__main__':
    try: main()
    except Exception:
        # Never print raw driver errors, auth responses or input payloads.
        print(json.dumps({'status':'SHADOW_WORKER_STOPPED','broker_orders':0,'action':'Check configuration, input, journal and dashboard session'}),file=sys.stderr)
        sys.exit(1)
