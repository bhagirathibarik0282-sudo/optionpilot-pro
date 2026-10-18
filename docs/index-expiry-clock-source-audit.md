# Standard index expiry clock correction

Prepared 2026-10-18. Draft PR #715; not a deployed release.

## Primary text actually read

- SEBI circular HO/47/11/11(3)2025-MRD-POD2/I/2765/2026,
  2026-01-16: PDF page 3, para 4.2.3 (equity derivatives to 15:40);
  PDF page 11, para 6.1 (framework effective 2026-08-03).
  [Official page](https://www.sebi.gov.in/legal/circulars/jan-2026/introduction-of-closing-auction-session-cas-in-the-equity-cash-segment-and-certain-modifications-in-the-pre-open-auction-session_99122.html)
  [Official PDF](https://www.sebi.gov.in/sebi_data/attachdocs/jan-2026/1768576287344.pdf)
- SEBI circular HO/47/11/11(3)2025-MRD-POD2/I/23843/2026,
  2026-10-15: PDF page 3, para 4.2.4 (expiring index contracts cease
  at 15:30); PDF page 6, para 6.1 (effective 2026-12-07).
  [Official page](https://www.sebi.gov.in/legal/circulars/oct-2026/review-of-certain-aspects-of-the-closing-auction-session-market-timings-and-settlement-methodology-for-derivatives-contracts_105293.html)
  [Official PDF](https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792079571420.pdf)
- [NSE current market timings](https://www.nseindia.com/static/market-data/market-timings)
  and [CAS page](https://www.nseindia.com/static/products-services/closing-auction-session)
  corroborate 09:15–15:40 for equity derivatives at consultation time.

The two SEBI PDFs were fetched directly and their relevant pages extracted/read.
The framework addresses all recognised exchanges; this is the primary basis for
NIFTY/BANKNIFTY/SENSEX standard-session model clocks. A separately linked BSE
20260731-40 PDF returned 403 and was not read or used as primary evidence.
No public market price data was fetched.

## Scope and point-in-time rules

- One resolver is shared by the existing index quote IV/Greek producer, exact Kite
  Greek producer and numerical Greek cross-check. Commodity behavior is retained.
- Effective dates apply to the contract expiry date. Knowledge is restricted to
  the IST observation date, never today's date when processing old observations.
- Publication times on the two announcement dates are not verified: affected
  future-expiry calculations are withheld for those announcement days. Earlier
  dates retain the previously known clock. This is a conservative knowledge-date
  convention, not proof of historical model expectations before announcement.
- The fallback is explicitly labelled `LEGACY_1530_MODEL_ASSUMPTION`; the two
  circulars do not certify every historical exchange schedule.
- Fractional `remainingCalendarDays` includes nights/weekends. It is not integer
  calendar DTE, trading days or trading minutes.
- Exact expiry/after expiry yields no valid new Greeks. Unresolved index clocks
  preserve quote fields and use the existing nonfinite/missing-value path for
  model metrics, rather than manufacturing zero Greeks.
- Index quote production opts out of the advanced-Greek model's
  `T >= 0.0001 years` floor (52.56 minutes), which disagreed with the actual
  positive expiry time used by Delta/Theta/Vega. Commodity and standalone
  calibration callers retain their existing convention for separate review.
  A five-minute-to-expiry regression checks actual server Gamma against an
  independent second finite difference of option prices. Zero/nonfinite time
  remains unavailable instead of receiving an artificial time floor.

## Devil Check and limits

Tests cover all three symbols, effective-date edges, historical knowledge,
announcement-day withholding, IST offset equivalence, invalid calendar dates,
expiry cutoff, and producer/numerical-cross-check consistency after 15:30.

These are **standard-session model clocks**, not contract-master validation,
an exchange holiday calendar, special-session overrides or certified settlement
timestamps. Special-session support remains separate. The global candidate/
Telegram market-open gate remains at its existing 15:30 boundary. Historical
raw rows are not rewritten. New closing capture is observation-only as below;
future production readback is still required before claiming runtime coverage.

## Closing-session coverage audit and repair

The production `GET /api/research/h1-theory-dates` on 2026-10-18 reads the
existing PostgreSQL H1_TRUTH_MARKER population through
`listH1TheoryRecordedDates` in `h1-theory-history.ts`. Its MIN/MAX query has no
replay time-window predicate. All 21 index-day rows for Oct 8/9/12/13/14/15/16
ended at 15:30 IST. The compact readback is retained in
`closing-observation-coverage-proof.json`. This establishes no later truth
markers in that scope, not the absence of unmarked raw rows. Marker counts
include possible off-grid minutes and are not daily completeness percentages.

Root causes: the existing 3-minute scheduler uses the 15:30 trading gate;
the replay parser capped requests at 15:30; Chapter 6 full-session loading also
requested 15:30. The recorder adapter itself has no additional session cutoff.

The same recorder timer now admits closing-session observation slots, reuses
existing authenticated market refresh and H1 persistence, and returns before
rollover summaries, selector marking, legacy recorder snapshots, journal,
shadow outcomes, event bus and Telegram. The normal market gate is retained.
Shared quote/session caches are refreshed as part of the existing refresh path;
this is a bounded read-and-record operation, not an isolated offline process.

For current standard sessions, the three additional nominal slots are 15:33,
15:36 and 15:39. Actual receipt times remain actual times; no missing grid slot
is backfilled. Replay bounds/defaults and Chapter 6 full-session loading follow
the date's standard observation close. After 2026-12-07 the recording range can
include non-expiring contracts until 15:45, while expiring-contract Greeks still
use 15:30. Quote freshness and exact contract identity checks still apply.

Live closing capture fails closed outside the reviewed 2026 holiday calendar;
weekends, listed holidays and inferred special sessions are not opened. Existing
early-close CAS proxy windows and fixed-window RAG/memory consumers are retained;
this patch does not claim those consumers include the new closing rows. There
is no new database/table/timer or retention exemption. Missing historical tails
remain missing, with explicit replay continuity gaps.

Previously retained IV/Greeks are not silently recomputed. The earlier 92-endpoint
study reproduced the old model convention and is not exchange-clock validation.
No trading thresholds, candidate authority, Telegram sends or broker orders are
enabled by these changes. Corrected model metrics can affect existing consumers
after release, which is why this patch requires review before production.

## Local validation receipt

- Focused clocks/actual CE+PE calculation/actual recorder scheduler and capture/
  replay/market-gate/Greek cross-check suite: 44 passed, 0 failed, 0 skipped.
- Full existing `npm test`: 655 passed, 0 failed, 1 existing skipped test.
- Permanent guardrails and server TypeScript syntax transform passed.
- Test-time wiring scripts generated unrelated Telegram wiring edits; those were
  removed from the deliverable and focused tests/guardrails rerun.
- Production acceptance and special-session/late-recorder runtime proof remain pending.
