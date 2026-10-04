# DTE Premium Tracker Reuse Audit

## Mission boundary

Add continuous fixed-contract and DTE analysis without creating a second
candidate authority, Greeks engine, PCR engine, or parallel history store.

## Reuse as-is

- Four live expiry buckets: Current, Next, Next-of-Next, and Monthly.
- Per-strike LTP, bid, ask, spread, volume, OI, IV, Delta, Gamma, Vega, Theta,
  intrinsic value, extrinsic value, expiry, DTE, quote time, and validation.
- `option_snapshot_1m`, `chain_state_1m`, and `market_snapshot_1m` history.
- Existing replay API and contract-time database index.
- Existing PCR, Max Pain, OI wall, ATM IV, and straddle calculations.
- Existing Business Dashboard and canonical selector identity lock.

## Patch existing code

1. Preserve exact canonical candidate/wall contracts when they move outside the
   rolling ATM ±7 persistence band but remain present in the current source
   snapshot.
2. Add a read-only fixed-contract journey query over `option_snapshot_1m`.
3. Add DTE-normalized comparison using the same contract history and the same
   time-of-day/moneyness dimensions.
4. Surface those read-only results in the existing Business Dashboard.

## Create only where no equivalent exists

- A user-selected contract watchlist/registry for contracts that are not the
  canonical candidate or a tracked wall.
- Source subscription retention for watched contracts after they leave the
  live snapshot's strike range.
- A fixed-contract journey panel and cross-expiry DTE comparison panel.

## Explicitly excluded

- No second selector or candidate score.
- No second Greeks, PCR, Max Pain, wall, outcome, or replay engine.
- No trade authority from the new analytics.
- No fabricated history when a contract was absent from the source snapshot.

## Build order

1. Canonical fixed-contract continuity in the existing recorder.
2. Fixed-contract read API with coverage/gap disclosure.
3. User watchlist plus source subscription retention.
4. Dashboard journey and DTE comparison panels.
5. Multi-expiry migration, IV/OI change, compression, and synthesis using the
   same stored history.
