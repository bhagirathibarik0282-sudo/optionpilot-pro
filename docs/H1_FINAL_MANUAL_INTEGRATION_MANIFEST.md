# H1 Final Manual Integration Manifest

## Frozen status
All H1 modules on `h1-recorder-wiring` are research-only. None may change live verdict, Telegram, or execution behavior until a later explicit promotion approval.

## Manual batch order — one controlled session
1. Verify branch is clean and based on intended `main` commit.
2. Verify Railway `DATABASE_URL` exists without exposing the value.
3. Add the minimal `server.ts` imports for `recordH1Snapshot` and `ensureH1DerivedSchema`.
4. Call `ensureH1DerivedSchema()` after existing DB initialization. Failure must be fail-open for live behavior and clearly logged.
5. Add one post-snapshot/post-Truth fire-and-forget call to `recordH1Snapshot(...)`.
6. Do not await recorder persistence inside the live candidate/verdict critical path.
7. Do not add H1 history output as an input to production scoring/Telegram/execution in this integration session.
8. Run the complete repository test suite.
9. If compile/test fails, stop. Do not deploy.
10. Run 1 trading-day pilot/replay with research-only semantics.
11. Run replay/leakage + data-integrity checks.
12. If PASS, run 5-day pilot and repeat the full checks.
13. If PASS, run 60D abort-first preflight.
14. Only if preflight has zero hard blockers, run the 60-trading-day bulk import.
15. Run post-import integrity gate.
16. Keep analogs descriptive only; keep regime strength uncalibrated.
17. Run OOS validation only on an untouched chronological window after rule/feature/threshold freeze.
18. Any tuning after OOS requires a new untouched OOS window.
19. No probability claims or production weighting in H1.
20. Merge/deploy only after a separate explicit approval.

## Frozen modules
- h1-recorder-adapter.ts
- h1-derived-db.ts
- h1-derived-history.ts
- h1-intelligence-bridge.ts
- h1-candidate-quality.ts
- h1-execution-lifecycle.ts
- h1-history-router.ts
- h1-market-story-thesis.ts
- h1-replay-guard.ts
- h1-bulk-preflight.ts
- h1-outcome-attribution.ts
- h1-post-import-integrity.ts
- h1-oos-calibration.ts
- h1-governance-freeze.ts

## Hard stop conditions
Stop the manual batch before deploy if any of the following occurs:
- test/compile failure
- future-data or unclosed-block leakage
- duplicate logical keys
- expiry/date/DTE shift
- CE/PE structural mismatch
- non-TRUE row accepted as research evidence
- candidate traceability break
- 7-index aligned-date break
- DB hook blocks or mutates live decision flow
- H1 changes live verdict, Telegram, or execution behavior
- OOS overlap, leakage, threshold tuning after OOS, or unacceptable OOS degradation

## Rollback
H1 must be removable by disabling/removing its runtime hooks while leaving existing live engine behavior unchanged. Raw/derived historical tables may remain as research data but cannot be consulted by production scoring unless separately promoted.

## Final promotion semantics
Passing H1 means the historical research pipeline is structurally validated. It does NOT mean:
- guaranteed edge
- calibrated win probability
- approved production weighting
- permission to override live structure
- permission to auto-execute trades
