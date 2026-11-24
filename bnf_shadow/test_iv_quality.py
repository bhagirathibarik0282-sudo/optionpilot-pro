from dataclasses import asdict, replace
from datetime import timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from .bridge import InstrumentMaster, OptionPilotLiveBridge
from .domain import BNFConfig
from .engine import OrderStateMachine
from .iv_quality import PROFILE, price, solve_iv, validate_signal_iv
from .store import TradeStore
from .test_bnf_shadow import NOW, C, sig
from .test_snapshot_source import CSV

EXPIRY=NOW.replace(day=23,hour=15,minute=30)

def fixture():
    baseline=NOW-timedelta(seconds=180)
    years=lambda ts:(EXPIRY-ts).total_seconds()/(365*86400)
    current_px=price('CE',62100,62000,years(NOW),.21)
    baseline_px=price('CE',62100,62000,years(baseline),.20)
    signal=sig(signal_ltp=current_px,ltp_chg_3m=current_px-baseline_px,iv=21,iv_chg_3m=1)
    evidence=dict(profile=PROFILE,instrument_token=C.instrument_token,tradingsymbol=C.tradingsymbol,
        parameters=dict(annual_rate=.10,dividend_yield=0,year_days=365,units='PERCENT_POINTS'),
        expiry_clock_source='INDEX_EXPIRY_CLOCK',expiry_ts=EXPIRY.isoformat())
    for key,ts,premium,iv in [('current',NOW,current_px,21),('baseline',baseline,baseline_px,20)]:
        evidence[key]=dict(asof_ts=ts.isoformat(),quote_ts=ts.isoformat(),spot_ts=ts.isoformat(),premium=premium,spot=62100,iv_percent=iv)
    return signal,evidence


class IVQualityTests(unittest.TestCase):
    def test_valid_pair_has_small_residual_and_allowlisted_receipt(self):
        s,e=fixture();e['secret']='synthetic-secret'
        receipt=validate_signal_iv(s,BNFConfig(),NOW,e)
        self.assertLess(receipt['results']['current']['residual_points'],1e-6)
        self.assertNotIn('synthetic-secret',json.dumps(receipt))
        self.assertEqual(receipt['samples']['baseline']['iv_percent'],20)

    def test_independent_quantlib_144_reference_values(self):
        # Independently evaluated with QuantLib 1.44 blackFormula on 2026-11-18.
        self.assertAlmostEqual(price('CE',42,40,.5,.2),4.759422392871536,places=12)
        self.assertAlmostEqual(price('PE',42,40,.5,.2),0.8085993729000943,places=12)

    def test_malformed_evidence_raises_sanitized_validation_error(self):
        s,e=fixture();del e['current']['quote_ts']
        with self.assertRaisesRegex(ValueError,'IV_EVIDENCE_MALFORMED'):
            validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_solver_recovers_call_and_put_iv(self):
        years=(EXPIRY-NOW).total_seconds()/(365*86400)
        for side in ('CE','PE'):
            premium=price(side,62100,62000,years,.25)
            self.assertAlmostEqual(solve_iv(side,premium,62100,62000,NOW,EXPIRY),25,places=7)

    def test_solver_rejects_arbitrage_invalid_premium(self):
        for premium in (0,-1,100000,float('nan'),True):
            with self.subTest(premium=premium),self.assertRaises(ValueError):solve_iv('CE',premium,62100,62000,NOW,EXPIRY)

    def test_solver_rejects_expired_and_unbracketed_prices(self):
        with self.assertRaisesRegex(ValueError,'EXPIRY'):solve_iv('CE',100,100,100,NOW,NOW)
        with self.assertRaisesRegex(ValueError,'BRACKET'):solve_iv('CE',99.999,100,100,NOW,NOW+timedelta(days=1))

    def test_profile_units_rate_and_identity_must_match(self):
        for key,value in [('profile','OTHER'),('instrument_token',999),('tradingsymbol','OTHER'),('expiry_clock_source','GUESSED')]:
            s,e=fixture();e[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):validate_signal_iv(s,BNFConfig(),NOW,e)
        for key,value in [('annual_rate',.06),('dividend_yield',True),('units','FRACTION'),('year_days',360)]:
            s,e=fixture();e['parameters'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_missing_baseline_cannot_be_reconstructed(self):
        s,e=fixture();del e['baseline']
        with self.assertRaises(ValueError):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_stale_future_or_skewed_inputs_rejected(self):
        for field,delta in [('quote_ts',-6),('spot_ts',1),('spot_ts',-3)]:
            s,e=fixture();e['current'][field]=(NOW+timedelta(seconds=delta)).isoformat()
            with self.subTest(field=field,delta=delta),self.assertRaises(ValueError):validate_signal_iv(s,BNFConfig(),NOW,e)
        s,e=fixture()
        with self.assertRaisesRegex(ValueError,'STALE'):validate_signal_iv(s,BNFConfig(),NOW+timedelta(seconds=6),e)

    def test_model_price_spot_and_reported_iv_must_match_signal(self):
        for field in ('premium','spot','iv_percent'):
            s,e=fixture();e['current'][field]+=1
            with self.subTest(field=field),self.assertRaises(ValueError):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_plausible_positive_iv_with_bad_residual_is_rejected(self):
        s,e=fixture();s=replace(s,iv=22,iv_chg_3m=2);e['current']['iv_percent']=22
        with self.assertRaisesRegex(ValueError,'RESIDUAL'):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_solver_boundary_values_are_not_valid_iv_evidence(self):
        for iv in (.1,500):
            s,e=fixture();s=replace(s,iv=iv,iv_chg_3m=.01);e['current']['iv_percent']=iv;e['baseline']['iv_percent']=iv-.01
            with self.subTest(iv=iv),self.assertRaisesRegex(ValueError,'ENDPOINT'):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_wrong_expiry_and_sample_clock_rejected(self):
        s,e=fixture();e['expiry_ts']=(EXPIRY+timedelta(days=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'EXPIRY'):validate_signal_iv(s,BNFConfig(),NOW,e)
        s,e=fixture();e['baseline']['asof_ts']=NOW.isoformat()
        with self.assertRaisesRegex(ValueError,'CLOCK'):validate_signal_iv(s,BNFConfig(),NOW,e)

    def test_strict_bridge_blocks_missing_evidence_and_journals_valid_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=TradeStore(sqlite3.connect(Path(tmp)/'iv.sqlite'),'iv-bridge',postgres=False)
            try:
                store.migrate();store.acquire();engine=OrderStateMachine(BNFConfig(),store)
                bridge=OptionPilotLiveBridge(engine,InstrumentMaster(CSV,NOW.date()),require_iv_evidence=True)
                s,e=fixture();wire=asdict(s);wire['contract']=C.wire()
                wire['signal_ts']=s.signal_ts.isoformat();wire['baseline_ts']=s.baseline_ts.isoformat()
                event={'type':'signal','signal':wire}
                with self.assertRaises(ValueError):bridge.consume(event,NOW)
                self.assertIsNone(engine.active)
                event['iv_evidence']=e
                self.assertTrue(bridge.consume(event,NOW))
                row=store.connection.execute('SELECT payload FROM bnf_shadow_event_v1 WHERE scope=?',(store.scope,)).fetchone()
                receipt=json.loads(row[0])['details']['iv_quality_receipt']
                self.assertEqual(receipt['profile'],PROFILE)
                self.assertEqual(receipt['instrument_token'],101)
            finally:store.close()


if __name__=='__main__':unittest.main()
