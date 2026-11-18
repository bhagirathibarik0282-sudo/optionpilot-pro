"""Strict validation of declared legacy-model IV evidence; no broker/network calls.

The 10% rate is the audited legacy code convention, not a current market-rate
claim. Expiry instants and synchronized input observations must come from the
trusted producer. This validator cannot authenticate their origin.
"""
import math
from .domain import number, timestamp

PROFILE = 'LEGACY_BS_R10_Q0_ACT365_V1'
RATE = 0.10
SIGMA_LOW, SIGMA_HIGH = 0.001, 5.0


def price(side, spot, strike, years, sigma):
    if side not in ('CE', 'PE'): raise ValueError('IV_OPTION_SIDE_INVALID')
    for name, value in (('spot', spot), ('strike', strike), ('years', years), ('sigma', sigma)):
        number(value, name, positive=True)
    root_t = math.sqrt(years)
    d1 = (math.log(spot/strike)+(RATE+sigma*sigma/2)*years)/(sigma*root_t)
    d2 = d1-sigma*root_t
    cdf = lambda x: (1+math.erf(x/math.sqrt(2)))/2
    discounted_strike = strike*math.exp(-RATE*years)
    value = spot*cdf(d1)-discounted_strike*cdf(d2) if side == 'CE' else discounted_strike*cdf(-d2)-spot*cdf(-d1)
    if not math.isfinite(value): raise ValueError('IV_MODEL_RESULT_INVALID')
    return value


def _inputs(side, premium, spot, strike, asof, expiry):
    premium = number(premium, 'premium', positive=True)
    spot, strike = number(spot, 'spot', positive=True), number(strike, 'strike', positive=True)
    asof, expiry = timestamp(asof), timestamp(expiry)
    years = (expiry-asof).total_seconds()/(365*86400)
    if years <= 0: raise ValueError('IV_EXPIRY_NOT_FUTURE')
    discounted = strike*math.exp(-RATE*years)
    lower, upper = (max(0, spot-discounted), spot) if side == 'CE' else (max(0, discounted-spot), discounted)
    if not lower < premium < upper: raise ValueError('IV_PREMIUM_OUTSIDE_ARBITRAGE_BOUNDS')
    low_px, high_px = price(side, spot, strike, years, SIGMA_LOW), price(side, spot, strike, years, SIGMA_HIGH)
    if not low_px < premium < high_px: raise ValueError('IV_ROOT_NOT_BRACKETED')
    return premium, spot, strike, years


def solve_iv(side, premium, spot, strike, asof, expiry):
    """Return annualized percentage-point IV; reject unbracketed/expired prices."""
    premium, spot, strike, years = _inputs(side, premium, spot, strike, asof, expiry)
    lo, hi = SIGMA_LOW, SIGMA_HIGH
    for _ in range(100):
        mid = (lo+hi)/2
        if price(side, spot, strike, years, mid) > premium: hi = mid
        else: lo = mid
    sigma = (lo+hi)/2
    if not SIGMA_LOW < sigma < SIGMA_HIGH or abs(price(side, spot, strike, years, sigma)-premium) > 1e-6:
        raise ValueError('IV_SOLVER_RESIDUAL_FAILED')
    return sigma*100


def _validate_signal_iv(signal, cfg, now, evidence):
    """Validate exact current/baseline model inputs; never create missing evidence."""
    if type(evidence) is not dict or evidence.get('profile') != PROFILE:
        raise ValueError('IV_MODEL_PROFILE_REQUIRED')
    signal.validate(cfg, now)
    if type(evidence.get('instrument_token')) is not int or evidence.get('instrument_token') != signal.contract.instrument_token or evidence.get('tradingsymbol') != signal.contract.tradingsymbol:
        raise ValueError('IV_CONTRACT_IDENTITY_MISMATCH')
    params = evidence.get('parameters', {})
    expected = {'annual_rate': RATE, 'dividend_yield': 0, 'year_days': 365, 'units': 'PERCENT_POINTS'}
    if type(params) is not dict or set(params) != set(expected) or any(type(params[k]) is bool or params[k] != v for k,v in expected.items()):
        raise ValueError('IV_MODEL_PARAMETERS_MISMATCH')
    if evidence.get('expiry_clock_source') != 'INDEX_EXPIRY_CLOCK':
        raise ValueError('IV_EXPIRY_CLOCK_SOURCE_REQUIRED')
    expiry = timestamp(evidence['expiry_ts'])
    if expiry.date() != signal.contract.expiry_date:
        raise ValueError('IV_CONTRACT_EXPIRY_MISMATCH')
    now = timestamp(now)
    if now < timestamp(signal.signal_ts): raise ValueError('IV_CURRENT_SAMPLE_IN_FUTURE')
    results = {}
    for key, asof, expected_premium, expected_iv in (
        ('current', signal.signal_ts, signal.signal_ltp, signal.iv),
        ('baseline', signal.baseline_ts, signal.signal_ltp-signal.ltp_chg_3m, signal.iv-signal.iv_chg_3m),
    ):
        row = evidence.get(key)
        if type(row) is not dict: raise ValueError('IV_CURRENT_AND_BASELINE_EVIDENCE_REQUIRED')
        asof = timestamp(asof)
        if timestamp(row['asof_ts']) != asof: raise ValueError('IV_SAMPLE_CLOCK_MISMATCH')
        quote_ts, spot_ts = timestamp(row['quote_ts']), timestamp(row['spot_ts'])
        for ts in (quote_ts, spot_ts):
            if ts.date() != asof.date() or not 0 <= (asof-ts).total_seconds() <= cfg.max_quote_age_sec:
                raise ValueError('IV_INPUT_CLOCK_INVALID')
            if key == 'current' and not 0 <= (now-ts).total_seconds() <= cfg.max_quote_age_sec:
                raise ValueError('IV_INPUT_STALE_AT_ADMISSION')
        if abs((quote_ts-spot_ts).total_seconds()) > 2:
            raise ValueError('IV_INPUT_TIMESTAMP_SKEW')
        premium, spot, strike, years = _inputs(signal.contract.option_type, row['premium'], row['spot'], signal.contract.strike, asof, expiry)
        iv = number(row['iv_percent'], 'iv_percent', positive=True)
        if abs(premium-expected_premium) > 1e-8 or abs(iv-expected_iv) > 1e-8:
            raise ValueError('IV_SIGNAL_EVIDENCE_MISMATCH')
        if key == 'current' and abs(spot-signal.spot_ltp) > 1e-8:
            raise ValueError('IV_SIGNAL_SPOT_MISMATCH')
        sigma = iv/100
        if not SIGMA_LOW < sigma < SIGMA_HIGH: raise ValueError('IV_CLAMPED_ENDPOINT_REJECTED')
        residual = abs(price(signal.contract.option_type, spot, strike, years, sigma)-premium)
        tolerance = min(0.05, signal.contract.tick_size/2)
        if residual > tolerance: raise ValueError('IV_REPRICING_RESIDUAL_FAILED')
        results[key] = {'residual_points': residual, 'iv_percent': iv}
    return {'profile': PROFILE, 'parameters': expected, 'instrument_token': signal.contract.instrument_token,
        'tradingsymbol': signal.contract.tradingsymbol, 'expiry_clock_source': 'INDEX_EXPIRY_CLOCK',
        'expiry_ts': expiry.isoformat(), 'samples': {key: {
            'asof_ts': timestamp(evidence[key]['asof_ts']).isoformat(),
            'quote_ts': timestamp(evidence[key]['quote_ts']).isoformat(),
            'spot_ts': timestamp(evidence[key]['spot_ts']).isoformat(),
            'premium': float(evidence[key]['premium']), 'spot': float(evidence[key]['spot']),
            'iv_percent': float(evidence[key]['iv_percent'])} for key in ('current', 'baseline')},
        'results': results}


def validate_signal_iv(signal, cfg, now, evidence):
    try:
        return _validate_signal_iv(signal, cfg, now, evidence)
    except (KeyError, TypeError, AttributeError, OverflowError):
        raise ValueError('IV_EVIDENCE_MALFORMED') from None
