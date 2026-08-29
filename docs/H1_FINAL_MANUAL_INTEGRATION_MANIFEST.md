# H1 Final Manual Integration Manifest

## Frozen status
All H1 modules on `h1-recorder-wiring` are research-only. None may change live verdict, Telegram, or execution behavior until a later explicit promotion approval.

## Runtime wiring safety tooling
The branch now includes:
- `h1-runtime-bridge.ts`: structural, fail-closed bridge from the existing runtime snapshot + existing Truth result into `recordH1Snapshot`.
- `scripts/apply-h1-runtime-wiring.mjs`: idempotent/fail-closed patcher. It never defaults missing Truth to TRUE, refuses unknown server anchors, writes a pre-wire backup, and does not deploy.
- `npm run h1:wire:check`: read-only structural scan. It reports DB-init/snapshot anchors and candidate Truth identifiers.
- `npm run h1:wire -- --truth-expr=<VERIFIED_EXISTING_TRUTH_IDENTIFIER>`: guarded write mode. The expression must be a simple existing identifier/property path; executable expressions are rejected.

## Manual batch order — one controlled session
1. Verify branch is clean and based on intended `main` commit.
2. Verify Railway `DATABASE_URL` exists without exposing the value.
3. Run `npm run h1:wire:check`.
4. Verify the reported Truth identifier against the existing deterministic Truth Engine. Do not guess and do not create a fallback TRUE.
5. Run `npm run h1:wire -- --truth-expr=<VERIFIED_EXISTING_TRUTH_IDENTIFIER>`.
6. Confirm `server.ts.h1-prewire.bak` was created and the patcher reports success.
7. The patcher adds `ensureH1DerivedSchema()` after existing DB init and a post-snapshot fire-and-forget H1 bridge call. H1 persistence must remain outside the live candidate/verdict critical path.
8. Run the complete repository test suite immediately: `npm test`.
9. If compile/test fails, restore from the pre-wire backup or revert the wiring commit. Stop. Do not deploy.
10. Confirm H1 is not used as an input to production scoring, Telegram, or execution.
11. Run 1 trading-day pilot/replay with research-only semantics.
12. Run replay/leakage + data-integrity checks.
13. If PASS, run 5-day pilot and repeat the full checks.
14. If PASS, run 60D abort-first preflight.
15. Only if preflight has zero hard blockers, run the 60-trading-day bulk import.
16. Run post-import integrity gate.
17. Keep analogs descriptive only; keep regime strength uncalibrated.
18. Run OOS validation only on an untouched chronological window after rule/feature/threshold freeze.
19. Any tuning after OOS requires a new untouched OOS window.
20. No probability claims or production weighting in H1.
21. Merge/deploy only after a separate explicit approval.

## Frozen modules
- h1-recorder-adapter.ts
- h1-runtime-bridge.ts
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
- scripts/apply-h1-runtime-wiring.mjs

## Hard stop conditions
Stop the manual batch before deploy if any of the following occurs:
- wiring check cannot uniquely find the required structural anchors
- existing deterministic Truth identifier cannot be verified
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
The wiring script preserves the pre-wire source at `server.ts.h1-prewire.bak` on first write. H1 must be removable by restoring/removing its runtime hooks while leaving existing live engine behavior unchanged. Raw/derived historical tables may remain as research data but cannot be consulted by production scoring unless separately promoted.

## Final promotion semantics
Passing H1 means the historical research pipeline is structurally validated. It does NOT mean:
- guaranteed edge
- calibrated win probability
- approved production weighting
- permission to override live structure
- permission to auto-execute trades
