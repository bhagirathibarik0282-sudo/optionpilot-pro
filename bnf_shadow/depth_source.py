"""Normalize existing KiteDecodedPacket full-depth events. No network or orders."""
import hashlib
import json
from .domain import TickSnapshot, integer, number, timestamp


class KiteDepthSource:
    def __init__(self, cfg, master):
        self.cfg, self.master = cfg, master

    def to_tick(self, event, now):
        packet, context = event['packet'], event['market_context']
        now, received = timestamp(now), timestamp(event['receive_ts'])
        if packet.get('mode') != 'full' or packet.get('isIndex') is not False:
            raise ValueError('full tradable option packet required')
        contract = self.master.records.get(event['tradingsymbol'])
        if contract is None: raise ValueError('unknown contract')
        self.master.verify(contract, now)
        token = integer(packet['instrumentToken'], 'instrumentToken')
        if token != contract.instrument_token: raise ValueError('token/contract mismatch')
        # Do not impose ATM selection on existing positions; the signal bridge does that.
        exchange = timestamp(packet['exchangeTimestamp'])
        if context.get('symbol') != 'BANKNIFTY': raise ValueError('wrong market context')
        if context.get('vwap_basis') != 'NEAR_FUTURES_AVERAGE_PRICE' or context.get('comparison_policy') != 'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE':
            raise ValueError('explicit legacy futures-reference provenance required')
        for name in ('spot_ts', 'vwap_ts'):
            ts = timestamp(context[name])
            if ts.date() != now.date() or not 0 <= (received-ts).total_seconds() <= self.cfg.max_quote_age_sec:
                raise ValueError('stale or future market context')
            if not 0 <= (now-ts).total_seconds() <= self.cfg.max_quote_age_sec:
                raise ValueError('stale market context at consumption')
        depth = packet['marketDepth']
        bid, bid_qty = self._best(depth['buy'], reverse=True)
        ask, ask_qty = self._best(depth['sell'], reverse=False)
        # Stable across receipt retries. Last-trade time and totalBuy/SellQuantity
        # are not substitutes for exchange time or displayed best-level quantity.
        identity = {'token': token, 'exchange': exchange.isoformat(), 'depth': depth, 'ltp': packet['lastPrice']}
        event_id = 'kd1:'+hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        tick = TickSnapshot(event_id, token, exchange, received, packet['lastPrice'], bid, bid_qty, ask, ask_qty,
                            context['spot_ltp'], context['vwap'])
        tick.validate(self.cfg, now)
        return tick

    @staticmethod
    def _best(levels, reverse):
        if not isinstance(levels, list) or len(levels) != 5:
            raise ValueError('five explicit depth levels required')
        priced = []
        empty_seen = False
        for level in levels:
            price = number(level['price'], 'depth.price')
            qty = integer(level['quantity'], 'depth.quantity', 0)
            integer(level['orders'], 'depth.orders', 0)
            if price == 0:
                if qty != 0: raise ValueError('quantity without price')
                empty_seen = True
            else:
                if empty_seen: raise ValueError('nonempty level after empty depth')
                priced.append((price, qty))
        if not priced: raise ValueError('no priced depth')
        prices = [p for p, _ in priced]
        if prices != sorted(prices, reverse=reverse) or len(prices) != len(set(prices)):
            raise ValueError('unsorted or duplicate price levels')
        return priced[0]
