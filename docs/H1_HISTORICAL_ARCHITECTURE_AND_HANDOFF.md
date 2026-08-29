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
1. Insert the minimal server.ts import for recordH1Snapshot.
2. Add the post-snapshot, post-Truth fire-and-forget hook.
3. Verify DATABASE_URL and required Railway variables exist without exposing values.
4. Build/type-check.
5. Run 1-day pilot/replay.
6. Audit timestamps, expiry, DTE, CE/PE identity, ATM offsets, duplicate minute buckets, NULL semantics.
7. If PASS, expand to 5 days.
8. Devil-check again.
9. If PASS, bulk import 60 trading days.
10. Keep research data isolated from production candidate logic until separate approval.
11. Merge/deploy only after explicit final approval.

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
