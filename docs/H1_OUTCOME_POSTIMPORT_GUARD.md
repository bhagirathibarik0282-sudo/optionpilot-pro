# H1 Verified Outcome Attribution and Post-Import Integrity

## Outcome authority
- Reuse `outcome-engine.ts`; H1 never recalculates target/stop order, MAE/MFE, or terminal status.
- Preserve `PENDING`, target hits, stop hit, neither hit, and every `INCOMPLETE_*` status exactly.
- Incomplete outcomes remain excluded from calibration.
- Old fixed-strike gaps are never reconstructed from ATM substitutions.

## Attribution semantics
- TARGET_T1/T2/T3_HIT -> WIN
- STOP_HIT -> LOSS
- NEITHER_HIT -> SCRATCH
- INCOMPLETE_NO_ENTRY_DATA -> NO_ENTRY
- other INCOMPLETE_* -> INCOMPLETE
- PENDING -> PENDING
- unknown/unrecognized -> UNKNOWN

Calibration eligibility requires a terminal, non-incomplete, known outcome with real side/strike/entry data.

## Post-import hard blockers
Any of these forces integrity FAIL:
- trading-day mismatch
- symbol coverage mismatch
- duplicate logical keys
- CE/PE structural mismatch
- expiry date shift
- outside-session contamination
- future-data leakage
- running-block leakage
- PARTIAL/STALE/INVALID rows marked research-eligible
- candidate snapshot/rule traceability failure
- insufficient aligned seven-index day coverage

## Calibration readiness
`STRUCTURE_READY` means only:
1. post-import structural integrity passed, and
2. at least 30 calibration-eligible verified outcomes, and
3. at least 30 regime-matched analog cases.

It does **not** mean probability calibration, predictive validity, or production weighting is approved.
Those require a later explicit out-of-sample calibration phase.

## Safety contract
This layer is research-only and cannot affect live verdict, Telegram, or execution.
