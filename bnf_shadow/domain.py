from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_FLOOR
import math

IST = timezone(timedelta(hours=5, minutes=30))
TERMINAL = frozenset({'CANCELLED', 'REJECTED', 'CLOSED'})
STATES = TERMINAL | {'ENTRY_PENDING', 'PARTIALLY_FILLED', 'OPEN', 'EXIT_PENDING', 'RECONCILIATION_REQUIRED'}

def integer(value, name, minimum=1):
    if type(value) is not int or value < minimum:
        raise ValueError(f'{name}: integer >= {minimum} required')
    return value

def number(value, name, minimum=0, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f'{name}: finite number required')
    if value < minimum or (positive and value == minimum):
        raise ValueError(f'{name}: invalid range')
    return float(value)

def aware(value):
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError('timezone-aware timestamp required')
    return value.astimezone(IST)

def timestamp(value):
    # The existing TypeScript decoder emits ISO UTC with Z; normalize for Python 3.10.
    if isinstance(value, str):
        value = value[:-1]+'+00:00' if value.endswith('Z') else value
        return aware(datetime.fromisoformat(value))
    return aware(value)

def text(value, name, maximum=120):
    if type(value) is not str or not value.strip() or len(value) > maximum:
        raise ValueError(f'{name}: nonempty bounded string required')
    return value

@dataclass(frozen=True)
class ContractSpec:
    exchange: str
    symbol: str
    tradingsymbol: str
    instrument_token: int
    expiry_date: date
    strike: float
    option_type: str
    contract_lot_size: int
    tick_size: float

    def __post_init__(self):
        if self.exchange != 'NFO' or self.symbol != 'BANKNIFTY' or self.option_type not in ('CE', 'PE'):
            raise ValueError('BANKNIFTY NFO option required')
        text(self.tradingsymbol, 'tradingsymbol', 60)
        integer(self.instrument_token, 'instrument_token')
        integer(self.contract_lot_size, 'contract_lot_size')
        number(self.tick_size, 'tick_size', positive=True)
        number(self.strike, 'strike', positive=True)
        if type(self.expiry_date) is not date:
            raise ValueError('expiry_date must be date')

    def floor_price(self, price):
        value = Decimal(str(number(price, 'price', positive=True)))
        tick = Decimal(str(self.tick_size))
        return float((value / tick).to_integral_value(rounding=ROUND_FLOOR) * tick)

    def wire(self):
        return {**asdict(self), 'expiry_date': self.expiry_date.isoformat()}

    @classmethod
    def from_wire(cls, value):
        data = dict(value)
        data['expiry_date'] = date.fromisoformat(data['expiry_date'])
        return cls(**data)

@dataclass(frozen=True)
class BNFConfig:
    mode: str = 'SHADOW'
    lots: int = 1
    contract_lot_size: int = 30
    max_capital_inr: float = 25000
    cost_reserve_per_trade_inr: float = 75
    pullback_pts: float = 6
    sl_pts: float = 22
    trail_trigger_pts: float = 15
    trail_lock_pts: float = 2
    target_pts: float = 32
    pending_timeout_sec: int = 300
    max_hold_sec: int = 1200
    cooldown_sec: int = 900
    feed_gap_lock_sec: int = 180
    max_daily_sls: int = 3
    max_quote_age_sec: int = 5
    max_signal_age_sec: int = 10
    min_fill_latency_ms: int = 250
    flatten_at_ist: str = '15:20'

    def __post_init__(self):
        if self.mode != 'SHADOW':
            raise ValueError('LIVE_DISABLED: this implementation supports SHADOW only')
        if integer(self.lots, 'lots') not in (1, 2):
            raise ValueError('lots must be 1 or 2')
        integer(self.contract_lot_size, 'contract_lot_size')
        for key in ('max_capital_inr', 'pullback_pts', 'sl_pts', 'trail_trigger_pts', 'target_pts'):
            number(getattr(self, key), key, positive=True)
        number(self.cost_reserve_per_trade_inr, 'cost_reserve_per_trade_inr')
        number(self.trail_lock_pts, 'trail_lock_pts')
        if not self.trail_lock_pts < self.trail_trigger_pts < self.target_pts:
            raise ValueError('require trail_lock < trail_trigger < target')
        for key in ('pending_timeout_sec', 'max_hold_sec', 'cooldown_sec', 'feed_gap_lock_sec', 'max_daily_sls', 'max_quote_age_sec', 'max_signal_age_sec'):
            integer(getattr(self, key), key)
        integer(self.min_fill_latency_ms, 'min_fill_latency_ms', 0)
        cutoff = time.fromisoformat(self.flatten_at_ist)
        if not time(14, 45) < cutoff < time(15, 30):
            raise ValueError('flatten_at_ist must be between 14:45 and 15:30')

    @property
    def qty(self):
        return self.lots * self.contract_lot_size

    @property
    def is_live(self):
        return False

    def entry_window(self, now, contract):
        now = aware(now)
        if now.weekday() >= 5 or now.date() > contract.expiry_date:
            return False
        end = time(13, 30) if now.date() == contract.expiry_date else time(14, 45)
        return time(9, 20) <= now.time() <= time(11, 30) or time(13) <= now.time() <= end

@dataclass(frozen=True)
class QuadAlignSignal:
    signal_id: str
    contract: ContractSpec
    signal_ts: datetime
    baseline_ts: datetime
    opposite_tradingsymbol: str
    signal_ltp: float
    ltp_chg_3m: float
    spot_ltp: float
    vwap: float
    iv: float
    iv_chg_3m: float
    opp_ltp_chg_3m: float
    opp_oi_chg_3m: int
    max_bar_gap_sec: int

    def validate(self, cfg, now):
        text(self.signal_id, 'signal_id')
        text(self.opposite_tradingsymbol, 'opposite_tradingsymbol', 60)
        if self.opposite_tradingsymbol == self.contract.tradingsymbol:
            raise ValueError('opposite contract must differ')
        ts, baseline, now = aware(self.signal_ts), aware(self.baseline_ts), aware(now)
        if (ts - baseline).total_seconds() != 180 or ts.date() != baseline.date():
            raise ValueError('exact same-session three-minute baseline required')
        if not 0 <= (now - ts).total_seconds() <= cfg.max_signal_age_sec:
            raise ValueError('signal stale or future dated')
        if self.contract.contract_lot_size != cfg.contract_lot_size or now.date() > self.contract.expiry_date:
            raise ValueError('lot size mismatch or expired contract')
        gap = integer(self.max_bar_gap_sec, 'max_bar_gap_sec', 0)
        if gap > cfg.feed_gap_lock_sec:
            raise ValueError('signal feed gap')
        for key in ('signal_ltp', 'spot_ltp', 'vwap', 'iv'):
            number(getattr(self, key), key, positive=True)
        if number(self.ltp_chg_3m, 'ltp_chg_3m', minimum=-1e12) < 12:
            raise ValueError('premium increase must be >= 12 points')
        if number(self.iv_chg_3m, 'iv_chg_3m', minimum=-1e12) <= 0:
            raise ValueError('IV must increase')
        if number(self.opp_ltp_chg_3m, 'opp_ltp_chg_3m', minimum=-1e12) >= 0:
            raise ValueError('opposite premium must decrease')
        if type(self.opp_oi_chg_3m) is not int or self.opp_oi_chg_3m >= 0:
            raise ValueError('opposite OI must decrease')
        if not (self.spot_ltp > self.vwap if self.contract.option_type == 'CE' else self.spot_ltp < self.vwap):
            raise ValueError('spot/VWAP misalignment')

@dataclass(frozen=True)
class TickSnapshot:
    event_id: str
    instrument_token: int
    exchange_ts: datetime
    receive_ts: datetime
    ltp: float
    best_bid: float
    best_bid_qty: int
    best_ask: float
    best_ask_qty: int
    spot_ltp: float
    vwap: float

    def validate(self, cfg, now):
        text(self.event_id, 'event_id')
        integer(self.instrument_token, 'instrument_token')
        exchange, received, now = aware(self.exchange_ts), aware(self.receive_ts), aware(now)
        if not 0 <= (received - exchange).total_seconds() <= cfg.max_quote_age_sec:
            raise ValueError('quote timestamp invalid')
        if not 0 <= (now - exchange).total_seconds() <= cfg.max_quote_age_sec:
            raise ValueError('exchange quote stale')
        if not 0 <= (now - received).total_seconds() <= cfg.max_quote_age_sec:
            raise ValueError('quote stale or future dated')
        for key in ('ltp', 'best_bid', 'best_ask', 'spot_ltp', 'vwap'):
            number(getattr(self, key), key, positive=True)
        for key in ('best_bid_qty', 'best_ask_qty'):
            integer(getattr(self, key), key, 0)
        if self.best_bid > self.best_ask:
            raise ValueError('crossed book')
