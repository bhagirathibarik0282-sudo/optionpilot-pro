# Expiry observation workspace: implementation and acceptance

The product stays within Market / Premium / Flow / Replay. Market → Spot + full PCR is the shared expiry investigation surface. Existing Kite recordings remain the source; there is no new database, execution authority or Telegram change.

## Ordered work

1. Reliable replay loading: bounded browser replay reads; one frozen truth-marker lookup per request; explicit indexed timestamp bounds on normalized tables; failures retain timings and show a retryable source error instead of claiming no recordings exist.
2. Expiry evidence: selected and next recorded exact dates, source provenance and coverage, shared chart time axis, aligned comparisons only. Never splice expiries or replace missing next-expiry full PCR with a band value.
3. Wall / max-pain / VIX context: reuse existing stored fields, label legacy estimates, show each exact endpoint and gap. New full-chain calculations require complete strike/OI evidence. India VIX is shared 30-day market-volatility context, not expiry-specific IV.
4. Acceptance: representative production replay, all three indices, source-failure behavior, exact-identity and missing-data regressions, mobile layout, then deployed readback. Methodology correctness is separate from predictive performance. No unvalidated weighted score is labelled the best trading formula.

## Observed replay evidence before loading repair

NIFTY, 2026-10-23, 09:15–10:15 IST, CORE + compact + PCR provenance:

- 59 market / marker / canonical observations, 236 chain observations, 7,080 option rows.
- Server read timings: markers 151.8ms, market 170.4ms, chain 199.3ms, options 3,855.9ms, canonical 10,326.4ms, raw gaps 84.4ms.
- Browser-rendered JSON length: 4,797,906 characters.
- Previous six concurrent replay calls could expand to thirty DB reads competing for the existing five-connection pool. Production proxy logs showed client cancellations near the browser's 20-second deadline.

These observations identify a costly archive read and a contention risk; they are not a database execution-plan diagnosis. Before/after production readback is required before claiming the timeout problem resolved.

## Read architecture

The browser queues replay HTTP work before starting the existing timeout and permits at most two active replay calls. It releases a slot on success or failure; queued baseline reads receive lower priority. Other endpoint behavior stays independent.

For each replay request, the server reads latest truth markers once and passes the frozen marker set to all three normalized queries through a typed JSON recordset. Symbol and time-range predicates remain explicit so existing indexes can be used. TRUE/STALE/UNKNOWN verdicts retain their source meaning. No marker means no authority to expose normalized data as marked observations. Canonical data and missing-marker presence audits remain available.

No market-value cache or synthetic fill is introduced. A failed read returns failure plus completed query timings. Source failure and an actual successful empty recording response are distinct UI states.

## Known source limitations

The legacy recorder persists aggregate full PCR and max pain only for its explicitly current expiry. Next-expiry full PCR/max pain can therefore be missing even when premiums exist. Legacy wall fields may be null. Repainting or refreshing cannot manufacture those missing historical values. Any observed-strike alternative must state its strike coverage and must not be labelled full-chain.
