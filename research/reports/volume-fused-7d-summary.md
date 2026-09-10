# 7-Day Volume + Deep Fused Engine Backtest

Mode: READ_ONLY_7D_VOLUME_FUSED_ENGINE_BACKTEST_V1
Production impact: NONE
Dates: 2026-09-01, 02, 03, 04, 07, 08, 09
Symbols: NIFTY, SENSEX, BANKNIFTY

## Devil-check method
- 3m/6m/15m/30m/60m windows.
- Volume is NOT direct cumulative-volume percentage. Interval inflow = cumulative volume(t) - cumulative volume(t-w). Volume acceleration compares equal adjacent windows. Negative/reset deltas are unavailable.
- Option fusion is gate-first: 6m+15m controlled premium response, exact-strike multi-DTE alignment, then at least 2 of PCR, wall-OI, wall-migration confirmations.
- No future leakage, no cross-expiry premium subtraction, no nearest-timestamp substitution.
- Forward MFE/MAE measured only after event timestamp.

## Coverage
- NIFTY: 6 days with replay data; explicit sector/heavyweight rows in replay: 0.
- SENSEX: 6 days with replay data; explicit sector/heavyweight rows in replay: 0.
- BANKNIFTY: 6 days with replay data; explicit sector/heavyweight rows in replay: 0.
- Sep-04 replay was empty for these streams.

## Empirical freshness cut-points (research only)
Prior 30m chosen-premium expansion terciles:
- p33 = 2.7218459165%
- p66 = 20.6841182177%

These are NOT production thresholds.

## Bucket performance
### EARLY
- n=6
- avg prior30 premium = -5.9653%
- avg 15m chosen-volume share = 49.7623%
- avg 15m volume acceleration = -15.4711%
- avg 30m MFE = +7.5137%
- avg 30m MAE = -8.3935%
- avg 30m return = -0.6521%
- positive 30m outcomes = 4/6

### DEVELOPED
- n=6
- avg prior30 premium = +14.2082%
- avg 15m chosen-volume share = 62.0654%
- avg 15m volume acceleration = +46.9040%
- avg 30m MFE = +2.3416%
- avg 30m MAE = -9.2465%
- avg 30m return = -5.9157%
- positive 30m outcomes = 1/6

### MATURE
- n=7
- avg prior30 premium = +91.8950%
- avg 15m chosen-volume share = 62.7348%
- avg 15m volume acceleration = +137.5247%
- avg 30m MFE = +9.1561%
- avg 30m MAE = -27.5715%
- avg 30m return = -15.5788%
- positive 30m outcomes = 2/7

### UNAVAILABLE
- n=3
- avg 30m MFE = +1.2790%
- avg 30m MAE = -15.0407%
- avg 30m return = -12.1033%
- positive = 0/3

## By symbol
### NIFTY
- n=20 selected audit events
- avg prior30 premium = +39.0987%
- avg chosen-volume share15 = 57.3690%
- avg volume acceleration15 = +67.3617%
- avg MFE30 = +6.0401%
- avg MAE30 = -16.2085%
- avg return30 = -8.4826%
- positive30 = 6/20

### SENSEX
- n=2 selected audit events
- avg prior30 premium = +14.0223%
- avg chosen-volume share15 = 54.4333%
- avg volume acceleration15 = +3.0604%
- avg MFE30 = +3.1299%
- avg MAE30 = -9.8965%
- avg return30 = -7.5581%
- positive30 = 1/2

### BANKNIFTY
- n=0 events passed the strict option-fusion gates. This is not interpreted as a market result; it is a strict-evidence outcome under this exact setup.

## Important examples
- NIFTY Sep-02 10:03 CE: EARLY; prior30 +2.2585%; MFE30 +10.3681%; MAE30 -1.9939%; return30 +9.1411%.
- NIFTY Sep-03 10:09 PE: EARLY; prior30 -4.0000%; MFE30 +14.0046%; MAE30 0%; return30 +14.0046%.
- NIFTY Sep-08 10:15 CE: MATURE; prior30 +43.2977%; volume acceleration15 +50.5718%; MFE30 0%; MAE30 -39.6523%; return30 -38.5762%.
- NIFTY Sep-09 12:36 CE: MATURE; prior30 +38.3117%; volume acceleration15 +244.4736%; MFE30 +1.7214%; MAE30 -6.5728%; return30 -4.6009%.

## Core finding
High volume acceleration by itself is not bullish/bearish entry quality. In mature signals it can represent climax/chase participation. The engine therefore must fuse volume with premium freshness, PPD persistence, opposite-premium response, PCR/OI/walls, multi-DTE, Greeks/IV/liquidity, and forward-calibrated remaining-opportunity logic.

## Sector / heavyweight blocker
The current H1 FULL replay contains zero explicit sector/heavyweight rows for all three symbols in this seven-date audit. Therefore sector/heavyweight price% + interval-volume% cannot be honestly backtested from this replay and must remain UNAVAILABLE until a constituent/sector time-series source is joined. No proxy or fabricated sector rating is allowed.

## Safety
Read-only research. Does not affect selector, Telegram, execution, Railway, or database schema.
