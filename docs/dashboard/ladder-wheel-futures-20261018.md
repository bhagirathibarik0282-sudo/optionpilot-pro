# Ladder references, participation wheel and Futures switches

Status: PARTIAL — local dashboard checks pass; production acceptance pending.

## Changes

1. Propagate the existing exact-contract PDC into the premium display model.
   PDH / PDC / PDL are available in the ladder, table, cards and selected chart.
   Daily FIB reuses the existing nearest R3–S3 result. Green/red/gold describe
   ABOVE/BELOW/AT that reference, not a confirmed HOLD or trade direction.
2. Wheel has Option OI / Heavyweights / Sectors switches. Participation uses
   the existing chapter live projection and its freshness/identity checks.
   Rings count up/down/unchanged/unavailable quotes against previous close;
   they do not invent index weights or combine quote counts with option OI.
   Shared quote universe and source times remain explicit. Participation is
   independent of complete option-chain availability. Recorded replay stays
   on its existing source and cannot borrow these live values.
3. Futures live context has All / LTP / OI / Volume / Basis buttons using the
   same existing live renderer. Source expiry remains visible in the LTP/OI
   cards. Recorded Futures content and contract-continuity limits remain.

## Devil Check

- Full Business Dashboard V1 CI command locally: 281 tests passed, 0 failed.
- Added checks cover PDC absence/staleness, same-contract FIB separation,
  missing participation remaining unavailable, wheel switching without a
  qualified OI chain, disconnect revocation, and serialized Futures clicks.
- Serialized production scripts parse and execute in the dashboard harness.
- No provider requests, polling, candidate, Telegram, execution or database
  changes. No merge, manual deployment or production configuration change.
- Desktop/mobile visual acceptance and market-open source verification are
  NOT_PROVEN by these local tests.
