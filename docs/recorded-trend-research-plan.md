# OptionPilot: recorded option / market trend research
Status: proposed design, 24 October 2026. No scanner or Run All deployment is claimed.

## User's objective
Discover which recorded option movements precede or accompany market trends, and which market changes precede premium responses. Manually run one filter or all predefined filters over selected recorded dates. Every match must reveal the other notable changes, its subsequent path, failures and missed moves. A useful catch is a repeatable, testable pattern, not simply a large historical premium move.

## Verified starting point
The production recorded-date index returned 28 dates per index from 2026-08-31 to 2026-10-23. This is an inventory, not proof of complete or usable sessions. On 2026-10-19 recording begins at 09:32 IST, so opening conditions cannot be evaluated from these recordings. Older and newer cadence must be audited separately: never interpolate 3-minute history into invented 1-minute observations.
Existing implementation:
- market-investigation.ts: Events / Market move / Find similar; date range; exact expiry/DTE; fixed or initial-delta tracking; before/after observations; wall, pain and PDH/PDL facts. Its UI limits a run to 20 dates and its ALL choice scans its existing event families, not a new all-filter validation framework.
- h1-direction-response-research-v1.ts: same-interval spot/premium directional agreement and chronological threshold research. Same-interval agreement does not demonstrate advance prediction or trade returns; its current grid is 3 minutes.
- market-agreement.ts: descriptive exact-endpoint comparisons, with missing/unsynchronized states.
- Existing replay/provenance/fixed-contract paths remain the source authority. Reuse them; no new database, market-data provider or execution route.

## One workspace
Location: existing 04 Replay -> Trend Research. Retain the four dashboard chapters.
Four compact views: Setup | Matches | Notable changes | Scorecard.
Setup controls:
- Date from/to; Selected dates / All recorded dates.
- NIFTY / SENSEX / all selected indices; BANKNIFTY monthly observation only.
- Direction: Options -> market / Market -> options.
- Exact expiry: selected / next recorded / all recorded exact expiries; DTE groups shown separately.
- Contract selection: ATM at event / fixed strike / verified initial delta. Freeze chosen identity at event for every return. A rolling ATM chart is context, never one contract's P&L.
- Observation window: 1/3/6/15/30/60 minutes, available only with actual comparable endpoints.
- Outcome horizons: 3/15/30/60 minutes; swing 1/3/5 recorded sessions separately.
- Thresholds with units: option premium points or percent, spot points or percent; separate index/DTE settings. Do not silently pool raw point thresholds.
- Buttons: Run selected filter | Run All filters | Compare selected filters | Cancel | Export.
Run All evaluates the bounded, named preset list independently. It does not enumerate an unrestricted parameter cross-product or require every parameter simultaneously. Combined rules are explicit, versioned AND/OR rules.

## Three separate responsibilities
1. Data eligibility: inspect each required field, identity, original source time, cadence, duplicates, gaps and coverage.
2. Detection: use only facts available by event time t0; state the threshold/window/confirmation rule and the first eligible detection time.
3. Outcomes and context: measure later spot/premium paths and disclose all matching contextual changes. Future outcomes cannot enter detection.

A filter requiring premium prices can run without PCR/Greeks. A PCR filter cannot run without its own PCR proof. Context missingness must not erase an otherwise eligible price event. Nonevaluable records are excluded with reason counts, not marked wins or losses.

## Initial filter registry
| ID | Trigger family | Required evidence | What it tests |
|---|---|---|---|
| F01 | CE strengthening + PE weakening; mirrored PE case | Exact fixed CE/PE returns over the chosen trailing interval | Whether an option-pair pattern precedes a specified later spot move |
| F02 | Market move or level break first | Exact spot return or verified PDH/PDL transition | Which fixed options/expiries respond afterward, and how strongly |
| F03 | Premium PDH/PDL break | Same contract, same level, preceding/current eligible samples | Continuation or failure after the observed crossing interval |
| F04 | Level acceptance / rejection / recovery | Predeclared number of subsequent confirmations, available at t0 | Whether confirmed behavior improves on a first break; outcome clock starts after confirmation |
| F05 | Multi-expiry same-side response | Per-expiry qualifying F01/F03 events with disclosed timing and identities | Whether adding a next-expiry response changes measured outcomes |
| F06 | Premium + OI/volume change | Valid OI and true interval-volume counters at fixed membership/endpoints | Incremental information beyond the price-only baseline |
| F07 | ATM +-7 PCR or independently qualified Full PCR change | Exact scope, all required legs, source clocks and unchanged membership | Incremental information; scopes never substitute for each other |
| F08 | Wall / payout-minimum migration | Qualified strike/OI inventory, tied extrema retained | Positioning context and whether its addition improves the baseline |

F01-F03 are the first implementation tranche; do not build all families at once.
Additional optional context: PDC, verified sampled 15-minute H/L, verified daily Fibonacci references, futures LTP/OI/basis with exact contract identity, heavyweight/sector archived changes, IV/intrinsic/extrinsic and India VIX. Official Open=High requires actual same-session official Open/High; first recorded LTP is not Open. Missing Greeks or source OHLC must remain unavailable.
OI alone does not identify buyer or seller initiation: every open contract has both sides. India VIX is shared NIFTY-options-based 30-calendar-day volatility context, not a direction vote or each expiry's IV. A 15-strike payout minimum is not full-chain max pain.

## Trend and lead/lag definitions
First distinguish bullish pair response, bearish pair response, both premiums expanding, both compressing and mixed/flat. Premium expansion/compression alone does not identify spot direction because price, time and volatility sensitivities coexist.
Trend outcome must be independent from the trigger: for example, a predeclared forward spot-return threshold over horizon H, optionally with a separately reported maximum adverse excursion. Show unclassified/range outcomes explicitly. All configurable thresholds are research choices until validated.
Lead/lag uses observation intervals and original source clocks. Classify option-first, market-first, same recording interval or unresolvable. A 1-minute recording cannot establish second-level causality. Same-minute correlation is not advance prediction.

## Each match and its notable-change report
Collapsed row: date/time IST, index, exact expiry/DTE/strike/side, filter, observed direction, coverage status and forward outcome.
Expanded record:
- Why matched: exact rule values, threshold, baseline -> event timestamps and confirmation time.
- Before: configurable -15m / -3m context.
- Event t0: all required measurements and their source times.
- After: +3m / +15m / +30m / +60m exact checkpoints.
- Other changes: spot/futures levels, CE/PE prices, OI addition/shedding, interval volume, PCR scope/change, walls/ties, pain estimate/scope, VIX, next-expiry behavior, sectors/heavyweights if genuinely archived.
- Each contextual field says Changed / Unchanged / Unavailable / Unsynchronized. Rank noteworthy changes by explicit level transitions, wall identity changes or a user-defined threshold; do not call every tiny fluctuation significant.
- Failures/recoveries and adverse path are as visible as favorable movement. Report sampled extrema and coverage; never claim unseen tick highs/lows.
- Rule, provenance, run ID and parameters travel with an exported result.
Narrative generation may summarize these deterministic records but cannot invent a missing cause or upgrade source quality.

## Measure the catch and the missed fish
Build two independent catalogues: trigger episodes and objective qualifying market-move episodes. Match them by predeclared lead window and direction with one-to-one episode attribution.
Scorecard:
- Eligible sessions, valid comparison time and excluded/incomplete counts with reasons.
- Number of independent trigger episodes and number of sessions contributing them.
- Correct subsequent-direction outcomes / eligible trigger outcomes.
- False alarms, flat outcomes and invalid/censored outcomes separately.
- Qualified market-move episodes caught / all eligible qualified market-move episodes.
- Missed moves and a clickable timeline showing which required condition failed or was missing.
- Median forward spot and fixed-premium returns; adverse/favorable sampled excursion; detection delay/lead in recorded intervals.
- Results by index, exact expiry/DTE, time of day and session; avoid pooling far-DTE and expiry-day behavior.
- Compare a rule to a price-only/simple baseline on the SAME eligible observations. Show all-data coverage separately so missing optional fields cannot create a favorable selection bias.
A burst of ten adjacent matches is one market episode under a rule fixed before testing; do not pick its best historical entry afterward.

## Research is not a trade backtest
Observed agreement, a positive endpoint return or a later premium high is not realized profit. Trade mode additionally needs a locked entry/confirmation delay, side, entry quote, exit/stop/target/time rules, lot size, fees and slippage. Buy at an eligible ask and exit at an eligible bid where those archived quotes are trustworthy. If executable quotes or bar path are insufficient, label the result indicative/ambiguous rather than verified net P&L. No automatic order or Telegram action is introduced.
A final incomplete horizon is censored, not a losing trade. Intraday and swing rules are separate; no cross-expiry return stitching.

## Run All without increasing storage or query fan-out
Read one selected index/session via the existing bounded replay loader, derive eligible event data once and evaluate the preset list against it. Process dates in bounded batches with the current request queue. Discard older raw session payloads after extracting bounded event summaries; retain only required context, source IDs and run metadata. Cancel/resume must identify completed and incomplete dates and never mix configurations. All recorded dates are traversed in batches rather than raising the existing 20-date limit into one unbounded request. Export small results on request; no new Postgres event table or persistent raw copies.

## Validation and safe delivery
- Show coverage inventory first; field-level readiness is separate from date presence.
- Freeze trigger/outcome definitions before measurement. Validate exact identities, timestamp ordering, gaps, duplicates, membership changes and per-field missingness.
- Separate older calibration dates from newer untouched validation dates. Purge outcomes crossing the split; account for clustered/overlapping events and the number of filters/thresholds tried. A small number of recorded sessions supports exploration, not a proven stable edge.
- Add one optional context filter at a time and compare against the same baseline/cohort. Display negative and inconclusive findings.
- Phase 1: coverage matrix + F01/F02/F03 manual runs and complete event explanations.
- Phase 2: Run All + independent move catalogue + catch/miss/false-alarm scorecard.
- Phase 3: selected OI/PCR/expiry/VIX context comparisons; test whether each actually adds value.
- Phase 4: chronological validation and separately configured cost-aware trade simulation.
Acceptance: a reproducible event record, honest exclusion reasons, identical results between one-filter and Run All paths, correct missed-move accounting, and no production authority change.

## Primary methodology sources
- Zerodha option sensitivities: https://zerodha.com/z-connect/general/application-of-option-greeks
- Zerodha open interest: https://zerodha.com/varsity/chapter/open-interest/
- NSE India VIX: https://www.nseindia.com/static/products-services/indices-indiavix-index
- Bailey et al., The Probability of Backtest Overfitting: https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf
These support definitions and research safeguards, not profitability of this proposed scanner.
