"""Deterministic long-option paper engine. Deliberately contains no broker adapter."""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, time
import hashlib
import json
import threading
import uuid
from .domain import BNFConfig, ContractSpec, IST, TERMINAL, aware, timestamp

class OrderStateMachine:
    def __init__(self, cfg, store, startup_now=None):
        if type(cfg) is not BNFConfig or cfg.mode != 'SHADOW':
            raise ValueError('SHADOW config required')
        self.cfg, self.store, self.lock = cfg, store, threading.RLock()
        self.logging_healthy = True
        self.fault = None
        self.last_ticks = {}
        signature = hashlib.sha256(json.dumps(asdict(cfg), sort_keys=True).encode()).hexdigest()
        self.version, self.snapshot = store.load({'schema':1,'config_hash':signature,'active':None,
            'days':{},'cooldowns':{},'last_result':None})
        if self.snapshot.get('config_hash') != signature:
            raise ValueError('config differs from persisted scope; use a new scope or restore original config')
        # Never silently resume a pending entry or assume a pre-restart quote is executable.
        if self.active:
            recovery_now = aware(startup_now or datetime.now(IST))
            candidate = deepcopy(self.snapshot)
            od = candidate['active']
            if od['filled_qty'] > od['exited_qty']:
                od['state'] = 'RECONCILIATION_REQUIRED'
                od['reason'] = 'RESTART_RECOVERY'
                od['entry_cancelled'] = True
            else:
                self._finish(candidate, 'CANCELLED', 'RESTART_CANCEL_PENDING', recovery_now)
            self._commit(candidate, 'RESTART_RECOVERY', recovery_now)

    @property
    def active(self): return self.snapshot['active']

    def _event(self, candidate, kind, now, details=None):
        od = candidate['active'] or candidate['last_result']
        return {'event_id':uuid.uuid4().hex,'intent_id':od['intent_id'],
            'occurred_at':aware(now).isoformat(),'kind':kind,'details':details or {},'trade':deepcopy(od)}

    def _commit(self, candidate, kind, now, signal_id=None, details=None):
        try:
            version = self.store.save(self.version, candidate, self._event(candidate,kind,now,details), signal_id)
        except Exception:
            self.logging_healthy = False
            self.fault = 'JOURNAL_UNAVAILABLE_OR_CONFLICT'
            # No external execution exists. Keep the last durable paper snapshot, block all new fills.
            raise
        self.version, self.snapshot = version, candidate

    def _finish(self, snapshot, state, reason, now):
        od = snapshot['active']
        if od['filled_qty'] != od['exited_qty']:
            raise ValueError('cannot terminate a trade with remaining paper exposure')
        od['state'], od['reason'] = state, reason
        cost = self.cfg.cost_reserve_per_trade_inr if od['filled_qty'] else 0
        od['estimated_cost_inr'] = cost
        od['net_pnl_inr_estimated'] = round(od['exit_notional'] - od['entry_notional'] - cost, 2)
        # Exits are attributed to their actual IST date, including a later recovery day.
        day = aware(now).date().isoformat()
        stats = snapshot['days'].setdefault(day, {'sl_count':0,'realized_estimated':0.0})
        # Each exit fill books its P&L on its own execution date. Only final rounding
        # correction is booked here, rather than attributing earlier fills to today.
        correction = od['net_pnl_inr_estimated'] - od.get('realized_booked',0.0)
        stats['realized_estimated'] = round(stats['realized_estimated'] + correction, 2)
        if reason == 'STOP_LOSS': stats['sl_count'] += 1
        od['closed_at'] = aware(now).isoformat()
        snapshot['last_result'], snapshot['active'] = od, None

    def _request_exit(self, od, reason):
        od['entry_cancelled'] = True
        reason = od.get('exit_reason') or reason
        od['exit_reason'] = reason
        od['state'], od['reason'] = 'EXIT_PENDING', reason
        od.setdefault('exit_order_id', 'SHD_EXIT_'+od['intent_id'])

    def _cancel_remainder(self, snapshot, reason, now):
        od = snapshot['active']
        od['entry_cancelled'] = True
        if od['filled_qty'] > od['exited_qty']:
            self._request_exit(od, reason)
        else:
            self._finish(snapshot, 'CANCELLED', reason, now)

    def on_signal(self, signal, now):
        with self.lock:
            if not self.logging_healthy: raise RuntimeError(self.fault)
            now = aware(now)
            signal.validate(self.cfg, now)
            if self.active or not self.cfg.entry_window(now, signal.contract): return None
            if self.store.has_signal(signal.signal_id): return None
            day = now.date().isoformat()
            if self.snapshot['days'].get(day, {}).get('sl_count',0) >= self.cfg.max_daily_sls: return None
            key = signal.contract.tradingsymbol
            previous = self.snapshot['cooldowns'].get(key)
            if previous and (now-timestamp(previous)).total_seconds() < self.cfg.cooldown_sec: return None
            price = signal.contract.floor_price(signal.signal_ltp-self.cfg.pullback_pts)
            if price <= 5: return None
            reserve = price*self.cfg.qty+self.cfg.cost_reserve_per_trade_inr
            if reserve > self.cfg.max_capital_inr: return None
            candidate = deepcopy(self.snapshot)
            intent = uuid.uuid4().hex
            candidate['cooldowns'][key] = now.isoformat()
            # Limit retained metadata to a recent session horizon, without deleting journal evidence.
            candidate['cooldowns'] = {k:v for k,v in candidate['cooldowns'].items() if (now-timestamp(v)).total_seconds() < 86400}
            candidate['active'] = {'intent_id':intent,'signal_id':signal.signal_id,'mode':'SHADOW',
                'contract':signal.contract.wire(),'state':'ENTRY_PENDING','requested_qty':self.cfg.qty,
                'filled_qty':0,'exited_qty':0,'entry_notional':0.0,'exit_notional':0.0,
                'entry_order_id':'SHD_ENTRY_'+intent,'limit_price':price,'capital_reserved_inr':reserve,
                'signal_ts':aware(signal.signal_ts).isoformat(),'entry_ts':None,'last_quote_ts':None,
                'last_receive_ts':None,'entry_cancelled':False,'trailed':False,
                'sl_pts':-self.cfg.sl_pts,'reason':None}
            self._commit(candidate,'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED',now,signal.signal_id,
                {'baseline_ts':aware(signal.baseline_ts).isoformat(),'signal':{k:v for k,v in asdict(signal).items() if k not in ('contract','signal_ts','baseline_ts')}})
            return intent

    def heartbeat(self, now):
        """Called every second even if no ticks arrive. Never invents an exit fill."""
        with self.lock:
            now = aware(now)
            if not self.logging_healthy or not self.active: return
            candidate = deepcopy(self.snapshot)
            od = candidate['active']
            if od['state'] in ('EXIT_PENDING','RECONCILIATION_REQUIRED'): return
            latest = timestamp(od['last_receive_ts'] or od['signal_ts'])
            reason = None
            if now.date() != timestamp(od['signal_ts']).date(): reason = 'DAY_ROLLOVER'
            elif now.time() >= time.fromisoformat(self.cfg.flatten_at_ist): reason = 'SESSION_CLOSE'
            elif (now-latest).total_seconds() >= self.cfg.feed_gap_lock_sec: reason = 'FEED_GAP'
            elif od['entry_ts'] and (now-timestamp(od['entry_ts'])).total_seconds() >= self.cfg.max_hold_sec: reason = 'TIME_EXIT'
            elif not od['entry_cancelled'] and od['filled_qty'] < od['requested_qty'] and (now-timestamp(od['signal_ts'])).total_seconds() >= self.cfg.pending_timeout_sec: reason = 'ENTRY_TIMEOUT'
            if reason:
                self._cancel_remainder(candidate,reason,now)
                self._commit(candidate,reason,now)

    def on_tick(self, tick, now):
        with self.lock:
            if not self.logging_healthy: raise RuntimeError(self.fault)
            tick.validate(self.cfg, now)
            now, ex = aware(now), aware(tick.exchange_ts)
            if not self.active: return
            od = self.active
            if tick.instrument_token != od['contract']['instrument_token']: return
            previous = self.last_ticks.get(tick.instrument_token)
            durable_ts = timestamp(od['last_quote_ts']) if od['last_quote_ts'] else None
            if (previous and (ex <= previous[0] or tick.event_id == previous[1])) or (durable_ts and ex <= durable_ts): return
            # Apply deadlines before considering any newly arriving quote executable.
            self.heartbeat(now)
            if not self.active: return
            candidate = deepcopy(self.snapshot)
            od = candidate['active']
            self.last_ticks[tick.instrument_token] = (ex,tick.event_id)
            od['last_quote_ts'], od['last_receive_ts'] = ex.isoformat(), aware(tick.receive_ts).isoformat()
            if od['state'] == 'RECONCILIATION_REQUIRED': self._request_exit(od,'RESTART_RECOVERY')
            kind = None
            if od['state'] == 'EXIT_PENDING':
                lot = od['contract']['contract_lot_size']
                amount = min(od['filled_qty']-od['exited_qty'],tick.best_bid_qty) // lot * lot
                if amount:
                    od['exited_qty'] += amount
                    od['exit_notional'] += amount*tick.best_bid
                    day = now.date().isoformat()
                    stats = candidate['days'].setdefault(day, {'sl_count':0,'realized_estimated':0.0})
                    realized = round((tick.best_bid-od['entry_notional']/od['filled_qty'])*amount - self.cfg.cost_reserve_per_trade_inr*amount/od['filled_qty'],2)
                    stats['realized_estimated'] = round(stats['realized_estimated']+realized,2)
                    od['realized_booked'] = round(od.get('realized_booked',0.0)+realized,2)
                    kind = 'EXIT_FILL'
                    if od['filled_qty'] == od['exited_qty']:
                        self._finish(candidate,'CLOSED',od['reason'],now)
                if kind: self._commit(candidate,kind,now,details={'source_event_id':tick.event_id,'qty':amount,'price':tick.best_bid})
                else: self.snapshot = candidate  # Only quote timestamps changed.
                return
            aligned = tick.spot_ltp > tick.vwap if od['contract']['option_type'] == 'CE' else tick.spot_ltp < tick.vwap
            if not aligned and not od['entry_cancelled']:
                self._cancel_remainder(candidate,'VWAP_INVALIDATED',now)
                self._commit(candidate,'VWAP_INVALIDATED',now)
                return  # Never reuse this quote for both entry and exit fills.
            # Protect already filled exposure before adding any further entry quantity.
            if od['filled_qty']:
                pnl_points = tick.best_bid - od['entry_notional']/od['filled_qty']
                if pnl_points >= self.cfg.trail_trigger_pts and not od['trailed']:
                    od['trailed'], od['sl_pts'] = True,self.cfg.trail_lock_pts
                    kind = 'TRAIL_ACTIVATED'
                reason = 'TARGET' if pnl_points >= self.cfg.target_pts else ('TRAIL_STOP' if od['trailed'] else 'STOP_LOSS') if pnl_points <= od['sl_pts'] else None
                if reason:
                    self._request_exit(od,reason)
                    self._commit(candidate,'EXIT_REQUESTED',now)
                    return  # A later fresh depth event must confirm the simulated exit.
            latency_ms = (aware(tick.receive_ts)-timestamp(od['signal_ts'])).total_seconds()*1000
            if not od['entry_cancelled'] and latency_ms >= self.cfg.min_fill_latency_ms and tick.best_ask <= od['limit_price']:
                lot = od['contract']['contract_lot_size']
                amount = min(od['requested_qty']-od['filled_qty'],tick.best_ask_qty) // lot * lot
                if amount:
                    od['filled_qty'] += amount
                    od['entry_notional'] += amount*tick.best_ask
                    od['entry_ts'] = od['entry_ts'] or aware(tick.receive_ts).isoformat()
                    od['state'] = 'OPEN' if od['filled_qty']==od['requested_qty'] else 'PARTIALLY_FILLED'
                    kind = 'ENTRY_FILL'
            if kind: self._commit(candidate,kind,now,details={'source_event_id':tick.event_id})
            else: self.snapshot = candidate

    def stop(self, now, reason='SHUTDOWN'):
        with self.lock:
            if not self.logging_healthy or not self.active: return
            candidate = deepcopy(self.snapshot)
            self._cancel_remainder(candidate,reason,aware(now))
            self._commit(candidate,reason,now)

OptionPilotBNFEngine = OrderStateMachine
