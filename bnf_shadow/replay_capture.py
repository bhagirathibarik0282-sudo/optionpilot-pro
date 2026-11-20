"""Bounded opt-in recording of the SHADOW consumer boundary, never broker packets/auth.

The producer/engine still decide trades. A capture failure never interrupts them;
its file and status become INCOMPLETE and cannot qualify as replay proof.
"""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import sys
import threading
import time
import uuid
from .domain import IST, timestamp

VERSION = 'BNF_SHADOW_REPLAY_V1'
CODE_FILES = ('domain.py', 'engine.py', 'bridge.py', 'depth_source.py',
              'live_signal_source.py', 'iv_quality.py')

def source_hashes():
    base = Path(__file__).parent
    return {name: hashlib.sha256((base/name).read_bytes()).hexdigest() for name in CODE_FILES}

def _json(value):
    return json.dumps(value, allow_nan=False, separators=(',', ':'), sort_keys=True)

def clean_input(event):
    """Only the existing same-feed relay's explicit contract; no arbitrary fields."""
    if type(event) is not dict or event.get('type') != 'kite_depth':
        raise ValueError('UNSUPPORTED_CAPTURE_INPUT')
    packet, context = event['packet'], event['market_context']
    depth = packet['marketDepth']
    def levels(side):
        values = depth[side]
        if type(values) is not list or len(values) != 5:
            raise ValueError('DEPTH_SHAPE_INVALID')
        return [{k: row[k] for k in ('price', 'quantity', 'orders')} for row in values]
    source = event.get('signal_source')
    reference = context['reference_identity']
    return {'type': 'kite_depth', 'tradingsymbol': event['tradingsymbol'], 'receive_ts': event['receive_ts'],
            'signal_source': {k: source[k] for k in ('expiry_clock_source', 'expiry_ts')} if source else None,
            'packet': {**{k: packet[k] for k in ('mode', 'isIndex', 'instrumentToken', 'lastPrice', 'exchangeTimestamp')},
                       **({'oi': packet['oi']} if 'oi' in packet else {}),
                       'marketDepth': {'buy': levels('buy'), 'sell': levels('sell')}},
            'market_context': {**{k: context[k] for k in ('symbol', 'vwap_basis', 'comparison_policy',
                                                       'spot_ltp', 'vwap', 'spot_ts', 'vwap_ts')},
                               'reference_identity': {k: reference[k] for k in ('spotToken','nearFutureToken','nearFutureLabel',
                                                                                'nearFutureExpiry','masterDate','vwapBasis','comparisonPolicy')}}}

class ReplayCapture:
    def __init__(self, cfg, master, directory, max_bytes=256*1024*1024,
                 max_total_bytes=1024*1024*1024, queue_size=2048):
        self.cfg, self.master, self.root = cfg, master, Path(directory)
        self.max_bytes, self.max_total_bytes = max_bytes, max_total_bytes
        self.run_id = uuid.uuid4().hex
        self.day = str(master.asof)
        self.queue = queue.Queue(maxsize=queue_size)
        self.thread = None
        self.state, self.fault = 'NOT_STARTED', None
        self.accepted = self.written = self.dropped = self.bytes = 0
        self.lock = threading.Lock()
        self.done = object()
        self.closed = False
        self.startup_now = None
        self.stem = f'bnf-shadow-replay-{self.day}-{self.run_id}'
        self.part = self.root/(self.stem+'.jsonl.gz.part')
        self.sealed = self.root/(self.stem+'.jsonl.gz')
        self.meta = self.root/(self.stem+'.meta.json')

    def fail(self, reason):
        with self.lock:
            self.fault = self.fault or reason

    def status(self):
        with self.lock:
            return {'mode': VERSION, 'date': self.day, 'runId': self.run_id,
                    'updatedAt': datetime.now(IST).isoformat(),
                    'state': 'INCOMPLETE' if self.fault else self.state,
                    'fault': self.fault, 'recordsWritten': self.written,
                    'recordsDropped': self.dropped, 'uncompressedBytes': self.bytes,
                    'completeSessionVerified': False}

    def _metadata(self, final=False):
        value = self.status()
        value['sealed'] = final
        if final:
            value['fileName'] = self.sealed.name
            value['compressedBytes'] = self.sealed.stat().st_size
            digest = hashlib.sha256()
            with self.sealed.open('rb') as source:
                for chunk in iter(lambda: source.read(1024*1024), b''): digest.update(chunk)
            value['sha256'] = digest.hexdigest()
        tmp = self.meta.with_suffix('.tmp')
        tmp.write_text(_json(value))
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.meta)

    def start(self, version, snapshot, signal_ids):
        try:
            if self.thread or self.closed: raise ValueError('CAPTURE_ALREADY_STARTED')
            if len(signal_ids) > 10000: raise ValueError('SIGNAL_SEED_LIMIT')
            self.root.mkdir(parents=True, exist_ok=True)
            used = sum(p.stat().st_size for p in self.root.iterdir() if p.is_file())
            if used + self.max_bytes > self.max_total_bytes: raise ValueError('CAPTURE_STORAGE_LIMIT')
            if shutil.disk_usage(self.root).free < self.max_bytes+64*1024*1024: raise ValueError('CAPTURE_FREE_SPACE_REQUIRED')
            header = {'kind': 'HEADER', 'version': VERSION, 'date': self.day, 'runId': self.run_id,
                      'startedAt': datetime.now(IST).isoformat(), 'config': asdict(self.cfg),
                      'startupNow': timestamp(self.startup_now or datetime.now(IST)).isoformat(),
                      'codeHashes': source_hashes(), 'pythonVersion': sys.version.split()[0],
                      'sourceCommit': os.environ.get('RAILWAY_GIT_COMMIT_SHA') if len(os.environ.get('RAILWAY_GIT_COMMIT_SHA',''))==40 and all(c in 'abcdef0123456789' for c in os.environ['RAILWAY_GIT_COMMIT_SHA']) else None,
                      'initialVersion': version, 'initialSnapshot': deepcopy(snapshot),
                      'seenSignalIds': list(signal_ids),
                      'masterDate': str(self.master.asof),
                      'contracts': [c.wire() for c in self.master.records.values()],
                      'containsRawBrokerFrames': False, 'completeSessionVerified': False}
            if len(_json(header).encode()) > 4*1024*1024: raise ValueError('HEADER_LIMIT')
            self.state = 'RECORDING'
            self.thread = threading.Thread(target=self._write, args=(header,), daemon=True)
            self.thread.start()
        except Exception:
            self.fail('CAPTURE_START_FAILED')

    def record(self, value):
        try:
            if self.fault or self.closed or not self.thread:
                with self.lock: self.dropped += 1
                return
            data = _json(value)+'\n'
            if len(data.encode()) > 32768: raise ValueError('CAPTURE_EVENT_LIMIT')
            self.queue.put_nowait(data)
            with self.lock: self.accepted += 1
        except Exception:
            with self.lock: self.dropped += 1
            self.fail('CAPTURE_QUEUE_OR_EVENT_LIMIT')

    def operation(self, kind, now, event=None, reason=None):
        try:
            value = {'kind': 'OP', 'operation': kind, 'now': timestamp(now).isoformat()}
            if kind == 'INPUT': value['event'] = clean_input(event)
            elif kind == 'STOP':
                if reason not in ('INPUT_EOF', 'WORKER_STOPPED'): raise ValueError('STOP_REASON_INVALID')
                value['reason'] = reason
            elif kind not in ('HEARTBEAT', 'SOURCE_RESET'): raise ValueError('OP_INVALID')
            self.record(value)
        except Exception:
            self.fail('CAPTURE_INPUT_UNSUPPORTED')

    def journal(self, event):
        # Engine-generated event object; not broker responses or account/session scope.
        self.record({'kind': 'JOURNAL', 'event': event})

    def close(self, snapshot=None, source_status=None):
        if self.closed: return
        self.closed = True
        if not self.thread: return
        if snapshot is None or source_status is None: self.fail('CAPTURE_FINAL_CHECKPOINT_MISSING')
        try:
            self.queue.put({'kind': 'FOOTER', 'finalSnapshot': deepcopy(snapshot),
                            'finalSourceStatus': deepcopy(source_status),
                            'complete': self.fault is None, 'completeSessionVerified': False}, timeout=2)
            self.queue.put(self.done, timeout=2)
            self.thread.join(timeout=10)
            if self.thread.is_alive(): self.fail('CAPTURE_CLOSE_TIMEOUT')
        except Exception: self.fail('CAPTURE_CLOSE_FAILED')

    def _write(self, header):
        last_sync = time.monotonic()
        try:
            fd = os.open(self.part, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as raw:
                with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as stream:
                    stream.write((_json(header)+'\n').encode())
                    while True:
                        item = self.queue.get()
                        if item is self.done: break
                        if isinstance(item, dict):
                            item['complete'] = item['complete'] and not self.fault
                            data = _json(item)+'\n'
                        else: data = item
                        size = len(data.encode())
                        if self.bytes + size > self.max_bytes:
                            self.fail('CAPTURE_SIZE_LIMIT')
                            if not isinstance(item, dict):
                                with self.lock: self.dropped += 1
                                continue
                        stream.write(data.encode())
                        with self.lock:
                            self.written += 1
                            self.bytes += size
                        if time.monotonic()-last_sync >= 5:
                            stream.flush(); raw.flush(); os.fsync(raw.fileno())
                            self._metadata(); last_sync = time.monotonic()
                raw.flush(); os.fsync(raw.fileno())
            os.replace(self.part, self.sealed)
            self.state = 'SEALED'
            self._metadata(final=True)
        except Exception:
            self.fail('CAPTURE_WRITE_FAILED')


def make_capture(cfg, master, env=None):
    env = os.environ if env is None else env
    if env.get('BNF_SHADOW_REPLAY_CAPTURE_ENABLED') != 'true': return None
    root = Path(env.get('RAILWAY_VOLUME_MOUNT_PATH') or '/app/data')/'bnf-shadow-replay'
    return ReplayCapture(cfg, master, root)
