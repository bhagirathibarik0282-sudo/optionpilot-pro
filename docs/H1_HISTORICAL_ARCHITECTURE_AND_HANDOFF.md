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

## Premium-pair / execution lifecycle guard
- Track the selected premium and opposite premium together when prior and current observations are available.
- Missing prior premium means relation is `UNAVAILABLE`; never infer a move from one observation.
- Historical lifecycle stores the already-decided live status; it cannot create/promote/downgrade HOLD, CAUTION, EXIT or any other live state.
- Regime-survival count increments only while the thesis is explicitly intact.
- A regime transition may be recorded as DEGRADED without being mislabeled as a reversal.
- A broken thesis records INVALIDATED and cannot gain a survival increment.
- Existing deterministic Outcome Engine remains the authority for observed target/stop/MFE/MAE results; H1 does not create a second outcome calculator.
- Old incomplete ATM-only outcome windows remain incomplete. New ATM ±7 capture may improve future fixed-strike observability but cannot retroactively repair missing evidence.

## History router and analog guard
- Reuse existing seven-index daily research metrics for 5D, 20D, 60D and 252D; do not recompute a second return/relative-strength engine.
- Priority is `LIVE > 5D > 20D > 60D > 1Y`.
- 20D is a computed lens from the same research store, not a separate physical data tier.
- Historical conflict may reduce confidence/context quality but cannot flip an otherwise valid live direction.
- Historical analogs are descriptive only: report regime-matched usable sample size, similarity count and outcome counts.
- Do not convert historical continuation frequency into a current-candidate probability or certainty.
- Low-sample or mismatched-regime analogs remain `INSUFFICIENT` rather than being padded with weak cases.

## Seven-index market story and thesis guard
- Reuse the existing size-regime engine for BROAD_RISK_ON, NARROW_LARGECAP_RALLY, MIDCAP_EXPANSION, SMALLCAP_SPECULATION, EMERGING_LARGECAP_ROTATION, SIZE_ROTATION and BROAD_RISK_OFF.
- Leadership and laggards are descriptive rankings from verified relative-strength metrics, not participant-intent claims.
- Regime strength remains `UNKNOWN` until historical and out-of-sample calibration proves thresholds; the H1 story layer must not invent WEAK/MODERATE/STRONG labels.
- Market story combines the 5D regime path, 20D leadership/rotation lens and 60D context into a historical context object.
- Thesis stores historical bias, base case, alternative case, invalidation and explicit unknowns.
- If historical bias conflicts with live direction, confidence is reduced; historical thesis still cannot flip live direction or execution.
- Small-cap leadership alone is not promoted to broad healthy risk-on.

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
- Never infer premium-pair change without two valid observations.
- Never convert regime transition into reversal without explicit evidence.
- Never reconstruct missing historical fixed-strike outcomes from ATM substitutions.
- Never present descriptive analog frequency as calibrated current-trade probability.
- Never infer market-participant intent from seven-index leadership rankings alone.
- Never invent calibrated regime strength before OOS validation.

## One-shot manual handoff checklist
Complete all safe branch work first. Then perform one manual batch only:
1. Insert the minimal server.ts import for `recordH1Snapshot`.
2. Insert the minimal import/init for `ensureH1DerivedSchema`.
3. Add the post-snapshot, post-Truth fire-and-forget recorder hook. It must not await inside the live verdict path.
4. Initialize derived schema after the existing DB init without changing candidate/verdict behavior.
5. Wire historical intelligence/lifecycle calls only after their source states are already deterministically known; no history module may become a live decision dependency.
6. Verify `DATABASE_URL` and required Railway variables exist without exposing values.
7. Run the repository test suite, including H1 derived/intelligence/candidate-quality/execution-lifecycle/history-router/market-story tests.
8. Start with production-impact disabled / research-only recorder semantics.
9. Run 1-day pilot/replay.
10. Audit timestamps, expiry, DTE, CE/PE identity, ATM offsets, duplicate minute buckets, NULL semantics.
11. Audit Truth eligibility: only TRUE can enter research/training queries by default.
12. Audit multi-horizon candidate-quality guards: FULL alignment must still reject overextended/no-chase/bad-liquidity cases.
13. Audit premium-pair semantics: missing prior observation => UNAVAILABLE; no inferred move.
14. Audit lifecycle semantics: historical layer preserves supplied live status and never promotes/downgrades it.
15. Audit regime survival: transition != automatic reversal; invalidated thesis does not increment survival.
16. Audit history router priority: LIVE always outranks 5D/20D/60D/1Y context.
17. Audit analog output: sample/count disclosure only; no probability claim.
18. Audit seven-index story: leadership/laggards must reflect verified RS metrics; regime strength must remain UNKNOWN while uncalibrated.
19. Audit thesis conflict rule: history may reduce confidence but cannot flip live direction.
20. If PASS, expand to 5 days.
21. Devil-check expiry roll, candidate lifecycle, regime transitions, fixed-strike continuity, size rotation and data gaps.
22. If PASS, bulk import 60 trading days in one controlled batch.
23. Run post-import integrity counters before enabling any historical analog use.
24. Keep research data isolated from production candidate weighting until separate approval.
25. Merge/deploy only after explicit final approval.

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
- candidate fixed-strike coverage window count
- 5D/20D/60D metric availability counts
- seven-index aligned-date coverage count

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
- MFE/MAE remains NULL until the verified outcome process calculates it
- full-alignment historical candidates retain overextension/no-chase/liquidity guard outcomes
- premium-pair relations are UNAVAILABLE where a prior observation is missing
- regime-survival increments occur only on thesis-intact observations
- historical lifecycle state matches the authoritative live state supplied at that timestamp
- 5D/20D/60D windows use trading observations rather than calendar-day assumptions
- analog summaries exclude bad-quality/regime-mismatched cases and disclose sample size
- leadership/laggard rankings are traceable to seven-index RS values on the same aligned date
- uncalibrated size-regime strength remains UNKNOWN
- historical thesis conflict never mutates the live direction

## Acceptance criteria before 60-day import
- 0 duplicate logical minute keys.
- No CE/PE swaps.
- No expiry-date shifts from UTC/IST conversion.
- No research-eligible rows from INVALID/PARTIAL/STALE data.
- No fabricated OI deltas, PCR, MaxPain, Greeks, sentiment or premium-pair changes.
- Closed-timeframe state contains no look-ahead data.
- Every candidate can trace back to snapshotId + ruleVersion.
- DB failure cannot block live decision/Telegram path.
- Multi-horizon alignment cannot bypass entry-quality/risk guards.
- Historical lifecycle cannot alter live execution state.
- Missing old fixed-strike outcome evidence remains explicitly incomplete.
- History cannot override live direction.
- Analog frequency cannot be labeled as current-trade probability.
- Seven-index leadership cannot be presented as verified participant psychology.
- Regime strength remains uncalibrated until OOS validation.

## Deferred until after 60-day validation
- 90-day extension.
- 1-year research library activation beyond context fields already supported by 252D metrics.
- historical analog probability calibration.
- psychology-performance statistics.
- production weighting changes based on historical results.
