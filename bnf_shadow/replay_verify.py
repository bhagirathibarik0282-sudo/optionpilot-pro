"""Offline verification of a sealed consumer-boundary capture. No DB or network.

Replays the recorded clock, source resets, depth, watchdog and shutdown operations
against the recorded config/master/checkpoint. Economic events and final state must
match. Matching a captured run is never proof of a complete market session.
"""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import threading
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .domain import BNFConfig, timestamp
from .engine import OrderStateMachine
from .replay_capture import VERSION, source_hashes

class MemoryReplayStore:
    def __init__(self, header):
        self.version = header['initialVersion']
        self.snapshot = deepcopy(header['initialSnapshot'])
        self.signals = set(header['seenSignalIds'])
        self.events = []
    def load(self, initial): return self.version, deepcopy(self.snapshot)
    def has_signal(self, signal): return signal in self.signals
    def save(self, version, snapshot, event, signal_id=None):
        if version != self.version: raise ValueError('REPLAY_VERSION_CONFLICT')
        self.version += 1; self.snapshot = deepcopy(snapshot); self.events.append(deepcopy(event))
        if signal_id is not None: self.signals.add(signal_id)
        return self.version

# IDs are generated nonces. Their economic links, sequence, quantities and clocks
# are still tested through complete event order and state, not invented price fills.
NONCES = {'event_id', 'intent_id', 'entry_order_id', 'exit_order_id'}
def normalized(value):
    if isinstance(value, dict): return {k: normalized(v) for k,v in value.items() if k not in NONCES}
    if isinstance(value, list): return [normalized(v) for v in value]
    return value

def replay_capture_file(path):
    path = Path(path)
    if not path.name.endswith('.jsonl.gz') or path.stat().st_size > 256*1024*1024:
        raise ValueError('SEALED_BOUNDED_CAPTURE_REQUIRED')
    total = 0; original_events = []; footer = None; count = 0; previous = None
    with gzip.open(path, 'rt', encoding='utf8') as stream:
        first = stream.readline(4*1024*1024+1)
        total += len(first.encode())
        if len(first.encode()) > 4*1024*1024: raise ValueError('HEADER_LIMIT')
        header = json.loads(first)
        if header.get('kind')!='HEADER' or header.get('version')!=VERSION: raise ValueError('CAPTURE_HEADER_REQUIRED')
        if header.get('codeHashes')!=source_hashes(): raise ValueError('RECORDED_CODE_VERSION_REQUIRED')
        cfg = BNFConfig(**header['config'])
        if len(header['contracts'])>20000 or len(header['seenSignalIds'])>10000: raise ValueError('CAPTURE_SEED_LIMIT')
        text = io.StringIO(); columns = ['instrument_token','tradingsymbol','name','exchange','instrument_type','expiry','strike','lot_size','tick_size']
        writer = csv.DictWriter(text, fieldnames=columns); writer.writeheader()
        for c in header['contracts']:
            writer.writerow(dict(instrument_token=c['instrument_token'],tradingsymbol=c['tradingsymbol'],name=c['symbol'],exchange=c['exchange'],
                                 instrument_type=c['option_type'],expiry=c['expiry_date'],strike=c['strike'],lot_size=c['contract_lot_size'],tick_size=c['tick_size']))
        master = InstrumentMaster(text.getvalue(),header['masterDate'])
        store = MemoryReplayStore(header)
        engine = OrderStateMachine(cfg,store,startup_now=timestamp(header['startupNow']))
        bridge = OptionPilotLiveBridge(engine,master,require_iv_evidence=True,derive_live_signals=True)
        while True:
            line = stream.readline(4*1024*1024+1)
            if not line: break
            total += len(line.encode())
            if len(line.encode())>4*1024*1024 or total>264*1024*1024: raise ValueError('CAPTURE_SIZE_LIMIT')
            row = json.loads(line)
            if row.get('kind')!='FOOTER' and len(line.encode())>32768: raise ValueError('CAPTURE_SIZE_LIMIT')
            if footer is not None: raise ValueError('DATA_AFTER_FOOTER')
            if row.get('kind')=='FOOTER':
                footer=row;continue
            if row.get('kind')=='JOURNAL':
                original_events.append(row['event']);continue
            if row.get('kind')!='OP': raise ValueError('UNKNOWN_CAPTURE_RECORD')
            now=timestamp(row['now'])
            if previous and now<previous: raise ValueError('CONSUMER_CLOCK_MOVED_BACKWARDS')
            previous=now;count+=1
            op=row.get('operation')
            if op=='INPUT':
                try: bridge.consume(row['event'],now)
                except ValueError: pass  # Same input-rejection behavior as the live JSONL worker.
            elif op=='HEARTBEAT': engine.heartbeat(now)
            elif op=='SOURCE_RESET': bridge.producer.reset()
            elif op=='STOP': engine.stop(now,row['reason'])
            else: raise ValueError('UNKNOWN_CAPTURE_OPERATION')
    if not footer or footer.get('complete') is not True or footer.get('finalSnapshot') is None or footer.get('finalSourceStatus') is None:
        raise ValueError('CAPTURE_INCOMPLETE')
    state_matches = normalized(engine.snapshot)==normalized(footer['finalSnapshot'])
    journal_matches = normalized(store.events)==normalized(original_events)
    source_matches = bridge.producer.status()==footer['finalSourceStatus']
    return {'mode':'BNF_SHADOW_OFFLINE_CAPTURE_RECONCILIATION_V1','date':header['date'],
            'runId':header['runId'],'ok':state_matches and journal_matches and source_matches,
            'status':'MATCHES_CAPTURED_RUN' if state_matches and journal_matches and source_matches else 'REPLAY_DIVERGED',
            'operations':count,'recordedJournalEvents':len(original_events),'replayedJournalEvents':len(store.events),
            'finalStateMatches':state_matches,'economicJournalMatches':journal_matches,
            'sourceDecisionCountsMatch':source_matches,
            'brokerOrders':0,'productionWrites':0,'completeSessionVerified':False,
            'note':'This checks the captured run only. It cannot recover an earlier gap or establish complete session coverage.'}

def main():
    parser=argparse.ArgumentParser(description='Offline SHADOW replay verification; no DB or network')
    parser.add_argument('file');args=parser.parse_args()
    try: result=replay_capture_file(args.file)
    except Exception as error:
        allowed={'SEALED_BOUNDED_CAPTURE_REQUIRED','HEADER_LIMIT','CAPTURE_HEADER_REQUIRED','RECORDED_CODE_VERSION_REQUIRED',
                 'CAPTURE_SEED_LIMIT','CAPTURE_SIZE_LIMIT','DATA_AFTER_FOOTER','UNKNOWN_CAPTURE_RECORD',
                 'CONSUMER_CLOCK_MOVED_BACKWARDS','UNKNOWN_CAPTURE_OPERATION','CAPTURE_INCOMPLETE'}
        reason=str(error) if type(error) is ValueError and str(error) in allowed else 'CAPTURE_INVALID_OR_REPLAY_FAILED'
        result={'ok':False,'status':'NOT_VERIFIED','reason':reason,'brokerOrders':0,'productionWrites':0}
    print(json.dumps(result,allow_nan=False))
    return 0 if result['ok'] else 2

if __name__=='__main__': raise SystemExit(main())
