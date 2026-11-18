"""Strict JSON-event boundary; never manufactures IV or opposite-contract evidence."""
import csv
from dataclasses import fields
from datetime import date
import io
import json
from .domain import ContractSpec, QuadAlignSignal, TickSnapshot, timestamp
from .depth_source import KiteDepthSource
from .iv_quality import validate_signal_iv

class InstrumentMaster:
    def __init__(self, csv_text, asof):
        self.asof = date.fromisoformat(asof) if isinstance(asof,str) else asof
        self.records = {}
        for row in csv.DictReader(io.StringIO(csv_text)):
            if row.get('name')!='BANKNIFTY' or row.get('instrument_type') not in ('CE','PE') or row.get('exchange')!='NFO': continue
            contract = ContractSpec('NFO','BANKNIFTY',row['tradingsymbol'],int(row['instrument_token']),
                date.fromisoformat(row['expiry']),float(row['strike']),row['instrument_type'],int(row['lot_size']),float(row['tick_size']))
            if contract.tradingsymbol in self.records: raise ValueError('duplicate master symbol')
            self.records[contract.tradingsymbol] = contract
        if not self.records: raise ValueError('no BANKNIFTY options in instrument master')

    def verify(self, contract, now):
        if self.asof != timestamp(now).date() or self.records.get(contract.tradingsymbol) != contract:
            raise ValueError('instrument master stale or contract identity mismatch')

    def verify_selection(self, contract, spot, now):
        today=timestamp(now).date()
        expiries=[c.expiry_date for c in self.records.values() if c.expiry_date>=today]
        if not expiries or contract.expiry_date!=min(expiries):
            raise ValueError('nearest unexpired expiry required')
        strikes=sorted({c.strike for c in self.records.values() if c.expiry_date==contract.expiry_date})
        # On an exact midpoint, choose the higher strike consistently.
        atm=min(strikes,key=lambda strike:(abs(strike-spot),-strike))
        if abs(strikes.index(contract.strike)-strikes.index(atm))>1:
            raise ValueError('selected strike must be ATM plus/minus one available strike')

class OptionPilotLiveBridge:
    """A real-time event consumer for SHADOW execution, not a broker order bridge.

    Producer must supply synchronized IV/spot/VWAP/opposite-contract evidence.
    This module does not claim to derive those values from Kite quote packets.
    """
    def __init__(self, engine, master, require_iv_evidence=False):
        self.engine,self.master=engine,master
        self.require_iv_evidence=require_iv_evidence

    def consume(self, event, now):
        kind = event.get('type')
        if kind == 'signal':
            raw = dict(event['signal'])
            raw['contract'] = ContractSpec.from_wire(raw['contract'])
            raw['signal_ts'],raw['baseline_ts'] = timestamp(raw['signal_ts']),timestamp(raw['baseline_ts'])
            signal = QuadAlignSignal(**raw)
            signal.validate(self.engine.cfg,now)
            iv_receipt = None
            if self.require_iv_evidence:
                iv_receipt = validate_signal_iv(signal,self.engine.cfg,now,event.get("iv_evidence"))
            self.master.verify(signal.contract,now)
            self.master.verify_selection(signal.contract,signal.spot_ltp,now)
            opposite = self.master.records.get(signal.opposite_tradingsymbol)
            if not opposite or opposite.option_type == signal.contract.option_type or opposite.expiry_date != signal.contract.expiry_date or opposite.strike != signal.contract.strike:
                raise ValueError('opposite contract must be same strike/expiry and other option type')
            if self.require_iv_evidence:
                return self.engine.on_signal(signal,now,iv_quality_receipt=iv_receipt)
            return self.engine.on_signal(signal,now)
        if kind == 'kite_depth':
            tick = KiteDepthSource(self.engine.cfg, self.master).to_tick(event, now)
            return self.engine.on_tick(tick, now)
        if kind == 'tick':
            raw = dict(event['tick'])
            raw['exchange_ts'],raw['receive_ts'] = timestamp(raw['exchange_ts']),timestamp(raw['receive_ts'])
            return self.engine.on_tick(TickSnapshot(**raw),now)
        if kind == 'heartbeat': return self.engine.heartbeat(now)
        raise ValueError('unknown event type')

    def consume_line(self, line, now):
        if len(line.encode()) > 32768: raise ValueError('event exceeds 32 KiB')
        return self.consume(json.loads(line),now)
