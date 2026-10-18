# Standard index expiry clock correction

Prepared 2026-10-18. Local implementation; not a deployed release.

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

## Devil Check and limits

Tests cover all three symbols, effective-date edges, historical knowledge,
announcement-day withholding, IST offset equivalence, invalid calendar dates,
expiry cutoff, and producer/numerical-cross-check consistency after 15:30.

These are **standard-session model clocks**, not contract-master validation,
an exchange holiday calendar, special-session overrides or certified settlement
timestamps. Special-session support remains separate. The global market-open
gate, recorder/replay session window and historical raw rows are not rewritten
by this patch. Their existing 15:30 boundaries remain a separate audit item;
this patch alone does not establish complete 15:30–15:40 recording coverage.

Previously retained IV/Greeks are not silently recomputed. The earlier 92-endpoint
study reproduced the old model convention and is not exchange-clock validation.
No trading thresholds, candidate authority, Telegram sends or broker orders are
enabled by these changes. Corrected model metrics can affect existing consumers
after release, which is why this patch requires review before production.

## Local validation receipt

- Focused clock/actual server CE+PE/Greek adapter/numerical cross-check suite:
  23 passed, 0 failed, 0 skipped.
- Full existing `npm test`: 655 passed, 0 failed, 1 existing skipped test.
- Permanent guardrails and server TypeScript syntax transform passed.
- Test-time wiring scripts generated unrelated Telegram wiring edits; those were
  removed from the deliverable and focused tests/guardrails rerun.
- Production acceptance and special-session/late-recorder coverage remain pending.
