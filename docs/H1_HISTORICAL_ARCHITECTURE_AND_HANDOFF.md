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

## Historical candidate-quality guard
- Reuse closed temporal evidence and existing family fusion; never create a second live scoring engine.
- FULL multi-horizon alignment is not an automatic trade approval.
- Overextension, no-chase, poor liquidity, family-fusion conflict or low evidence completeness may still classify the historical candidate as REJECT.
- A+ historical quality requires full three-horizon alignment, supportive family fusion, high completeness and acceptable liquidity.
- This classifier remains `HISTORICAL_RESEARCH_ONLY` and cannot affect live verdict, Telegram or execution until a separately approved future phase.

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
6. Run the repository test suite, including H1 derived/intelligence/candidate-quality tests.
7. Start with production-impact disabled / research-only recorder semantics.
8. Run 1-day pilot/replay.
9. Audit timestamps, expiry, DTE, CE/PE identity, ATM offsets, duplicate minute buckets, NULL semantics.
10. Audit Truth eligibility: only TRUE can enter research/training queries by default.
11. Audit multi-horizon candidate-quality guards: FULL alignment must still reject overextended/no-chase/bad-liquidity cases.
12. If PASS, expand to 5 days.
13. Devil-check expiry roll, candidate lifecycle, regime transitions and data gaps.
14. If PASS, bulk import 60 trading days in one controlled batch.
15. Run post-import integrity counters before enabling any historical analog use.
16. Keep research data isolated from production candidate weighting until separate approval.
17. Merge/deploy only after explicit final approval.

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
- full-alignment historical candidates retain overextension/no-chase/liquidity guard outcomes

## Acceptance criteria before 60-day import
- 0 duplicate logical minute keys.
- No CE/PE swaps.
- No expiry-date shifts from UTC/IST conversion.
- No research-eligible rows from INVALID/PARTIAL/STALE data.
- No fabricated OI deltas, PCR, MaxPain, Greeks, or sentiment.
- Closed-timeframe state contains no look-ahead data.
- Every candidate can trace back to snapshotId + ruleVersion.
- DB failure cannot block live decision/Telegram path.
- Multi-horizon alignment cannot bypass entry-quality/risk guards.

## Deferred until after 60-day validation
- 90-day extension.
- 1-year research library.
- historical analog probability calibration.
- psychology-performance statistics.
- production weighting changes based on historical results.
