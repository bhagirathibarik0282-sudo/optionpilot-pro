# PR846: recorded coverage and parameter lead/lag study

Status: PARTIAL research design and one-window observation; no universal leader ranking, no production publication.

## Verified archive coverage
Inventory read on 4 Nov returned 108 index-days: 36 dates each for NIFTY, SENSEX and BANKNIFTY, ranging 31 Aug to 4 Nov 2026. These are available dates, not every trading day in that range. Current finder scans per-day archived CORE ATM +/-7 contracts; it does not measure overnight/swing changes or guarantee full-chain coverage. The one-hour samples previously scanned are not all-recorded-days acceptance.

## Direct observation from stored rows
NIFTY 23450 CE, expiry 9 Nov (calendar DTE 5), 4 Nov 2026, IST:

| Time | Spot | Futures | CE LTP | Band7 OI PCR |
|---|---:|---:|---:|---:|
| 12:13 | 23760.10 | 23776.10 | 349.40 | 0.7996 |
| 12:16 | 23746.10 | 23761.00 | 335.00 | 0.7781 |
| 12:17 | 23752.90 | 23769.60 | 342.50 | 0.7642 |
| 12:27 | 23807.30 | 23834.80 | 397.15 | 0.6258 |
| 12:29 | 23812.20 | 23847.80 | 401.35 | 0.6356 |

First observed rise >=60 from the sampled trough was 12:27: +62.15 (+18.55%). Spot, futures and option all rose in the first minute after 12:16. Their ordering inside that minute is unproven; market exchange timestamp is missing. Stored spot PDH 23810.85 was reclaimed at 12:29, after the threshold. Spot stayed below stored VWAP at the first hit. Band7 PCR fell rather than rose. Reported full-chain PCR lacks independently established fresh constituent coverage here, so it is not eligible as a confirmed leader. Stored call delta at 12:16 was about 0.9375; this is an ITM example and should not be generalized to ATM/OTM.

Sources: existing GET /api/research/recorded-dashboard/dates and /replay?symbol=NIFTY&date=2026-11-04&from=11:45&to=12:45. Frozen response hashes and window coverage: pr846-current-week-readback-20261104.json. Rows expanded by matching compact columns to row values, then filtered by exact date/symbol/expiry/strike/side and UTC minute; +05:30 for displayed times. Market/chain rows remain stored observations, not proof of exchange ordering or fresh full-chain membership.

## Proposed four sections on the same dashboard
1. FIND: This Week / All Recorded / selected dates, index, contract, CE/PE, expiry, exact calendar DTE, sampled >=60 and separately proposed >=90, plus own-baseline percentage. Available-date coverage stays visible.
2. WHAT MOVED FIRST: event-relative timeline with before 15m/3m, at observation, after 3m/15m. Independently defined parameter events: spot PDH/PDL/VWAP crossings; futures returns/OI/basis events; option opposite-side/PDH/PDL events; exact-expiry PCR and walls; source-valid IV/Greeks; expiry response at common anchors. Label EARLIER / SAME BUCKET / LATER / UNAVAILABLE, with reason and timestamp. Separate early observation from validated predictive leader and from causal attribution.
3. OUTCOME: first observed 60/90 hit, elapsed time, signed sampled MFE/MAE, continuation/reversal and repeat episodes with predefined resets. Separate same-strike from delta-matched cohorts; no retrospective best-window comparisons.
4. EVIDENCE: exact quote and receipt timestamps, missing samples and source scope, eligibility denominator, same-page replay and source-backed explanation.

## Required analysis before any best-parameter claim
- First discover timing descriptively; do not treat a rise before the eventual >=60 completion as proof it predicted the move.
- Define each signal independently of the future option trough/peak. Freeze features at signal time; count every eligible signal, including failures and non-events, over fixed future horizons. Keep insufficient follow-up distinct from failed outcomes.
- Select material-change thresholds on older dates only, with definitions and versions fixed before evaluating later dates. Do not use arbitrary handcrafted thresholds or retrospective full-day extrema as entry signals.
- Group by index, CE/PE, DTE 0-1/2-4/5-9/10+, time of day, moneyness/delta, direction and regime. Absolute >=60 counts cannot rank NIFTY versus SENSEX or ITM versus OTM.
- Prevent overlapping contract/strike/expiry observations from inflating independent sample size; evaluate by day/session clusters and predefined event episodes.
- Compare event probability within 3m/15m/30m after each signal with the corresponding eligible no-signal baseline; report denominator, false-alarm rate, median observed lead time, drawdown and source coverage. These are proposed horizons, not tuned discoveries.
- Use chronological walk-forward evaluation, purge overlapping outcome windows and show uncertainty by session. Statistical association and time order do not establish causality.
- Source admission applies per parameter: missing Greeks, stale quote, incomplete fresh PCR, no exact expiry or insufficient timing resolution stays unavailable. Missing context does not erase an otherwise valid observed premium endpoint.
- Expand bounded reads by selected index/day, cache/reuse existing responses, cancel and paginate. Measure day-sized payload/query cost before broad scans; no background scans, migrations, Telegram or order authority.

## Implementation boundary
PR846 local commit 129f200 adds fixed-first-hit SAME_STRIKE expiry comparison and synthetic browser acceptance. The parameter-leader study, 90-point/swing scan, predictive ranking and four-section extension above are proposed next increments, not already implemented. User authorized GitHub publication with “Yes push” on 4 Nov 2026. Merge/deployment remains outside that authorization.
