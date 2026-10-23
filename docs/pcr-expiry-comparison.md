# Expiry PCR comparison: staged implementation

## Step 1 — recorded graphs

Reuse the existing Spot × Full PCR chart in the Market chapter’s Spot + full PCR view. For each index, stack the selected exact expiry above the next later **recorded** expiry. Both actual-unit charts share one time domain. Coral is PCR (ratio); cyan is spot (points). Each chart retains its own vertical scale. A visible crossing has no statistical meaning.

The catalogue comes only from TRUE chain rows for the selected index and session. It is not a full exchange instrument inventory. Therefore “next recorded expiry” does not certify “next weekly expiry”. BANKNIFTY remains monthly observation only. Chain-only observations can render without inventing premium contracts. Missing next expiry stays explicitly unavailable.

The existing recording cadence is retained (typically 3m). This step does not introduce 1m history, increase broker requests, or alter the separate live 1m/3m Full/Band PCR panel. Intraday gaps over 3m remain disconnected. Swing points retain each exact expiry; expiry rollover is never stitched into one series.

Compare PCR levels only at matching buckets. Compare changes only if both expiries have the same baseline and endpoint and usable Spot/PCR values. Display:

- spread(t) = PCR_next(t) − PCR_selected(t), in ratio points;
- change spread = [PCR_next(t) − PCR_next(t0)] − [PCR_selected(t) − PCR_selected(t0)].

These are descriptive definitions chosen for this dashboard, not predictive formulas established by an exchange. Matching recording buckets do not prove matching exchange-source timestamps or complete full-chain coverage. The existing provenance disclosures remain available beneath each chart. No accuracy percentage, trading direction, or profit probability is assigned.

## Step 2 — walls and max pain (pending)

For each exact expiry and synchronized complete chain:

- CE wall set = argmax over strikes of CE OI; PE wall set = argmax of PE OI. Retain all tied maxima. This is our descriptive definition of an OI wall, not verified support/resistance.
- Wall migration = current wall strike minus prior wall strike, in points, only for an unambiguous wall at each endpoint. A switched wall’s OI cannot be presented as same-contract OI change.
- Payout(x) = sum_K [CE_OI(K) × max(x−K,0) + PE_OI(K) × max(K−x,0)]. Evaluate listed strike candidates; retain tied minimizers. Max pain = argmin Payout(x). OI units must be consistent; apply lot size only when OI is expressed in lots. A constant lot factor across one expiry does not alter the minimizer.

This payout definition excludes premiums and does not establish buyers’ actual P&L or a guaranteed settlement target. Never calculate “full max pain” from an ATM±7 subset. Missing full strike/OI inventory blocks verified calculation; legacy recorded values require their own provenance.

## Step 3 — India VIX context (pending)

Show the actual Kite-recorded India VIX and its exact-time change beneath the expiry charts. India VIX is NIFTY-options-based annualized implied volatility with a 30-calendar-day horizon, not each weekly expiry’s ATM IV. It can supply shared market volatility context for SENSEX/BANKNIFTY, but must not be labelled their own volatility index or used to calculate their expiry-specific expected range. Changes alone do not establish market direction.

## Step 4 — treatment and validation (pending)

Use same-expiry, same-time PCR / wall / max-pain movement with spot response; show VIX separately as context. First require valid identities, coverage, nonnegative OI, positive PCR denominator, known source times and disclosed freshness/skew thresholds. Refreshing every minute cannot repair stale broker quotes.

No “best” weighted composite has been established. Before selecting a predictive formula: define its target and horizon, keep whole sessions chronological in train/validation/test splits, freeze thresholds before the holdout, retain missing-data/expiry-day regimes, account for option spreads/slippage/costs if assessing trades, and compare out-of-sample performance against simpler baselines. Do not choose weights from this chart’s visual overlap.

## Verified primary documentation

- [Zerodha Varsity: Max pain & PCR](https://zerodha.com/varsity/chapter/max-pain-pcr-ratio/) — defines total put OI / call OI and the hypothetical-expiry payout method. Describes max-pain theory; does not validate our joint signal.
- [Zerodha Varsity: Open interest](https://zerodha.com/varsity/chapter/open-interest/) — OI tracks outstanding contracts, each with a long and a short side; it does not reveal trade intent by itself.
- [NSE: India VIX](https://www.nseindia.com/static/products-services/indices-indiavix-index) — annualized NIFTY-options-based expected volatility over 30 calendar days.
- [Kite Connect: market quotes](https://kite.trade/docs/connect/v3/market-quotes/) — quote timestamp, OI, volume and missing-instrument response semantics. Use broker data for market values; these public pages supply methodology only.

Documentation checked 2026-10-23. Steps 2–4 describe subsequent work, not completed functionality.
