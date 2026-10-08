# Deployed DATA process audit — 2026-10-08

Verdict: deployed source corrections work in the inspected sample; the whole process is not fully cleared. Three presentation ambiguities, graph disclosure continuity and source-coverage limitations remain. This is a read-only audit, not a trade/candidate or profitability assessment.

## Scope and evidence

- Main and Railway SUCCESS deployment both identify `40d552338d156577fdcf777072b671d3871f6c9e` (PR 624).
- Production DATA HTML contains the reading checklist, Full PCR resolver, selected-expiry coverage and timestamp-kind explanation.
- Production replay sample: 2026-10-08 11:45–12:03 IST, CORE compact, all three indices. This is not a full-day completeness audit.
- Prior NIFTY replay: 2026-10-07 14:12–15:30 IST. Contract inspected: NIFTY / 2026-10-13 / 22200 CE, the displayed UI selection, not a candidate recommendation.
- Existing recorded-date index and existing NIFTY EOD descriptive summary were read. The date index is sourced from H1_TRUTH_MARKER records; it does not prove absence of every other database record.
- Browser verified Current, 3m, 15m, From Open, exact overview expiry selection, separate spot/PCR graphs, SWING, MEMORY and loaded EOD summary. Browser click timeouts were followed by observed state confirming that the tab changes did occur.
- 30 focused dashboard tests re-run: all pass. Previous exact-head CI: 36 successful checks, including Devil Gate. No backend, recorder, auth, database or production configuration was changed by this audit.

## Bounded sample profile

| Index | Market buckets | Option rows | Chain rows | Duplicate keys | Current-expiry full PCR/archive mismatches |
| --- | ---: | ---: | ---: | ---: | ---: |
| NIFTY | 7/7 | 630 | 21 | 0 | 0 |
| SENSEX | 7/7 | 840 | 28 | 0 | 0 |
| BANKNIFTY | 7/7 | 546 | 21 | 0 | 0 |

All sampled market buckets are exactly 3 minutes apart; truth values are TRUE. Inspected option LTP/OI/IV/PDH/PDL/bid/ask/volume/source timestamp/source age fields are populated. No bid greater than ask occurred in the sample. Field presence and truth markers do not establish executable liquidity or quote-packet freshness.

At 12:03 IST, source-backed current-expiry full PCR:

| Index | Exact expiry | Full PCR | Provenance |
| --- | --- | ---: | --- |
| NIFTY | 2026-10-13 | 0.6290677456436667 | STORAGE_V3_PHASE1; archive agrees |
| SENSEX | 2026-10-08 | 0.7432495999219182 | Exact canonical archive; legacy band label excluded |
| BANKNIFTY | 2026-10-27 | 0.893352895594951 | Exact canonical archive; legacy band label excluded |

Other sampled expiries have no usable Full PCR; none is filled from another expiry. SENSEX and BANKNIFTY call/put wall values are absent for all 7 sampled buckets. NIFTY current and next expiry walls are present for 7/7; monthly walls for 4/7. Market exchange timestamps are absent in all sampled market rows.

## Findings and next repairs, in order

| Priority | Finding | Evidence / impact | Smallest follow-up |
| --- | --- | --- | --- |
| High | SWING session count is a recorded-date count, not verified consecutive trading-session context | UI 1-session: 22 Sept → 7 Oct; 3-session: 18 Sept → 7 Oct; 5-session: 16 Sept → 7 Oct. The marker date index has no entries between 22 Sept and 7 Oct. Do not infer holidays or missing values. | Say “recorded-session comparison”, show coverage dates and continuity unverified; do not present it as consecutive 1/3/5 trading sessions without calendar/recording proof. |
| Medium | Yesterday bridge hides per-field sampled endpoint times | Same exact 22200 CE baseline last recorded at 7 Oct 14:15; PCR baseline 15:30. At 8 Oct 12:03, premium change -171.05 and PCR change -0.2113667032262777 use those distinct baseline times. The compact bridge currently prints dates/deltas only. | Expose both timestamps and “sampled last observation” beside bridge fields, and mark endpoint mismatch; never manufacture an EOD option close. |
| Medium | Tiny nonzero PCR delta rounds to negative zero | 11:48→12:03 PCR delta -0.00018620025074622681 rendered as -0 in 15m headline. | Preserve meaningful PCR precision or scientific notation without a new significance threshold; keep raw value inspectable. |
| Medium | Overview chart disclosure state resets | Opening NIFTY spot/PCR graphs then selecting 2026-10-19 closes the disclosure. renderAllIndexGraphs replaces the entire HTML without restoring open details; normal render refresh uses this same path. | Preserve disclosure state per index across expiry changes and refresh; add one meaningful DOM regression test. |
| High, source limitation | Missing wall/expiry/source-time evidence limits what can be concluded | SENSEX/BANKNIFTY walls absent; non-current-expiry PCR absent; packet timestamp unavailable. | Continue explicit unavailable/coverage labels. Reuse existing evidence only; no inference or recorder rewrite in this UI scope. |
| Unverified | Stock/sector authenticated data and mobile rendering | Read-only requests without the user's session return HTTP 401 “Kite not connected”. This does not establish the user's phone login state. Browser viewport is desktop; no supported mobile resizing capability is exposed. | Verify with the user's actual signed-in phone view; do not claim mobile or authenticated breadth has passed. |

## What passed

- Exact archived PCR correction in all populated current-expiry sample rows; no band PCR substitution.
- Exact same option identity in the inspected current/prior-day bridge; no different-strike or expiry substitute.
- Exact 3m and 15m sampled endpoints; Current displays values rather than invented deltas; From Open describes the 09:15 sample.
- Graphs use separate scales for spot and PCR; unavailable next-expiry PCR displays unavailable. Source line-chart code breaks at nulls and gaps over 3 minutes.
- EOD MEMORY reuses the existing descriptive summary: spot sampled last 22,603.05 at 7 Oct 15:30 IST, source high 22,717.65 / low 22,546.3. It labels this as a sampled endpoint, not an official close.
- PDH/PDL first-outside records remain distinct from observed crossings. Wall events carry interval timestamps. OI changes do not claim buyer/seller identity.

## REUSE / PATCH / NEW for the follow-up

| Treatment | Work |
| --- | --- |
| REUSE | Existing replay, canonical archive, recorded-date index, previous-day memory, EOD summary and chart renderer |
| PATCH | Recorded-session wording/coverage, bridge timestamp display, PCR delta precision, graph open-state preservation |
| NEW | Focused presentation tests and this audit evidence; no engine, database, score, threshold or candidate authority |

Next step is one bounded UI-only patch for the four presentation findings above, followed by focused tests and the existing gates. Missing source data, full-day completeness, actual mobile usability and human paper-validation outcomes remain unverified.

## Follow-up implementation checkpoint

Prepared on branch `ui/data-presentation-evidence`, based on main `40d552338d156577fdcf777072b671d3871f6c9e`; not merged or deployed at this checkpoint.

- SWING now explicitly says 1/3/5 recorded-session comparison, shows requested recorded dates and unloaded matching dates, and says consecutive trading-session continuity is unverified. Endpoint selection/calculations remain unchanged.
- Yesterday bridge displays each field's earlier/current timestamps and sampled-last-observation semantics. Different source endpoint timestamps produce an alignment warning; equivalent timestamps and missing endpoints do not fabricate a mismatch.
- Existing signed delta formatter uses scientific notation when a nonzero value would round to zero at the requested display precision. True zero and negative zero display as 0; null stays unavailable. DATA delta spans retain the raw recorded change in the title attribute. No significance threshold or score is introduced.
- Overview graph disclosures retain each index's open/closed state across render refresh and expiry changes. A user's explicit closure remains closed; indices do not share disclosure state.
- Browser VM regressions exercise expiry/refresh/closure state, tiny positive/negative changes, zero/negative-zero/null, sparse historical-date labels, bridge timestamps/mismatch/missing endpoints and raw delta inspection.
- 30 focused dashboard tests pass. All local Devil Gate steps pass, including the 570-test full regression suite. Generated backend wiring changes were restored and excluded. Remote CI is pending at this checkpoint.

Known source limitations and actual signed-in mobile verification remain open. This patch does not create missing PCR/wall/packet data or certify consecutive trading-session coverage.
