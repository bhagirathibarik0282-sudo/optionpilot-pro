# H1 Historical Architecture and One-Shot Handoff

## Scope
Build historical intelligence safely before any 60-day bulk import. Production behavior must remain unchanged until explicit approval.

## Data tiers
1. 1-day pilot: schema and timestamp validation.
2. 5-day pilot: expiry rollover, regime continuity, candidate lifecycle validation.
3. 60-day library: regime memory and replay research.

## Raw normalized storage
- market_snapshot_1m: index/futures/VIX snapshot per symbol/minute.
- option_snapshot_1m: ATM ±7 CE/PE per expiry/minute.
- chain_state_1m: PCR/±7 PCR/IV/straddle and chain context.
- timeframe_state: confirmed closed-timeframe state only.
- candidate_history: candidate observation history.
- trade_plan_history / trade_event_history: execution lifecycle.

## Derived history
Store separately from raw truth:
- trade mode: SCALP / INTRADAY / SWING / BTST
- direction
- regime and regime maturity
- evidence completeness and conflict count
- candidate age
- no-chase / overextension
- selected-vs-opposite premium pair relation
- multi-horizon alignment
- regime-survival count
- COMB/evidence-family states
- FII/DII context
- outcome attribution including MFE/MAE

## Truth eligibility
- TRUE: research eligible.
- PARTIAL: persist only as diagnostic; exclude from learning by default.
- STALE: diagnostic only.
- INVALID: no normalized row; write rejection audit only.

## Anti-fabrication rules
- Never synthesize OI change without a verified prior contract observation.
- Never reuse aggregate PCR/MaxPain as per-expiry truth unless source semantics guarantee it.
- Never recompute a second version of Greeks inside the recorder.
- Missing values remain NULL with validation status.
- Current live state always outranks historical analogs.

## One-shot manual handoff checklist
Complete all safe branch work first. Then perform one manual batch only:
1. Insert the minimal server.ts import for `recordH1Snapshot`.
2. Insert the minimal import/init for `ensureH1DerivedSchema`.
3. Add the post-snapshot, post-Truth fire-and-forget recorder hook. It must not await inside the live verdict path.
4. Initialize derived schema after the existing DB init without changing candidate/verdict behavior.
5. Verify `DATABASE_URL` and required Railway variables exist without exposing values.
6. Run the repository test suite, including `test/h1-derived-history.test.ts`.
7. Start with production-impact disabled / research-only recorder semantics.
8. Run 1-day pilot/replay.
9. Audit timestamps, expiry, DTE, CE/PE identity, ATM offsets, duplicate minute buckets, NULL semantics.
10. Audit Truth eligibility: only TRUE can enter research/training queries by default.
11. If PASS, expand to 5 days.
12. Devil-check expiry roll, candidate lifecycle, regime transitions and data gaps.
13. If PASS, bulk import 60 trading days in one controlled batch.
14. Run post-import integrity counters before enabling any historical analog use.
15. Keep research data isolated from production candidate weighting until separate approval.
16. Merge/deploy only after explicit final approval.

## Bulk import preflight counters
Before the 60-day import, collect expected counts and abort on structural mismatch:
- trading days requested vs trading days found
- symbols expected vs symbols found
- minute buckets per symbol/day
- option contracts per expiry/minute
- CE count vs PE count
- current/next/monthly expiry coverage
- TRUE/PARTIAL/STALE/INVALID counts
- rejected expiry rows
- NULL IV/Greeks counts
- duplicate logical key count

## Bulk import postflight counters
After import, verify:
- first and last market timestamp per trading day
- no weekend/non-session contamination
- no expiry-date shifts
- no CE/PE swaps
- no duplicate logical keys
- no research-eligible PARTIAL/STALE/INVALID rows
- ATM ±7 coverage within expected contract availability
- candidate rows traceable to snapshotId + ruleVersion
- MFE/MAE remains NULL until a verified outcome process calculates it

## Acceptance criteria before 60-day import
- 0 duplicate logical minute keys.
- No CE/PE swaps.
- No expiry-date shifts from UTC/IST conversion.
- No research-eligible rows from INVALID/PARTIAL/STALE data.
- No fabricated OI deltas, PCR, MaxPain, Greeks, or sentiment.
- Closed-timeframe state contains no look-ahead data.
- Every candidate can trace back to snapshotId + ruleVersion.
- DB failure cannot block live decision/Telegram path.

## Deferred until after 60-day validation
- 90-day extension.
- 1-year research library.
- historical analog probability calibration.
- psychology-performance statistics.
- production weighting changes based on historical results.
