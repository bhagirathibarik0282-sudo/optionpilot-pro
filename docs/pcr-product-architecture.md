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

The browser queues replay HTTP work before starting its network timeout and permits at most two active replay calls. It releases a slot on success or failure; queued baseline reads receive lower priority. Other endpoint behavior stays independent.

For each replay request, the server reads latest truth markers once and passes the frozen marker set to all three normalized queries through a typed JSON recordset. Symbol and time-range predicates remain explicit so existing indexes can be used. TRUE/STALE/UNKNOWN verdicts retain their source meaning. No marker means no authority to expose normalized data as marked observations. Canonical data and missing-marker presence audits remain available.

No market-value cache or synthetic fill is introduced. A failed read returns failure plus completed query timings. Source failure and an actual successful empty recording response are distinct UI states.

## Known source limitations

The legacy recorder persists aggregate full PCR and max pain only for its explicitly current expiry. Next-expiry full PCR/max pain can therefore be missing even when premiums exist. Legacy wall fields may be null. Repainting or refreshing cannot manufacture those missing historical values. Any observed-strike alternative must state its strike coverage and must not be labelled full-chain.


## Expiry positioning context

Each selected/next recorded expiry has a collapsible Wall migration / pain context beneath its existing Full PCR chart. Stacked scope buttons choose Recorded fields or ATM ±7 calculation for the index; the two expiry panels use the same scope. One India VIX context appears per index, shared by its two expiries. The shared window selector includes 1m and 3m; missing exact endpoints remain unavailable.

Recorded fields are displayed as coverage/freshness-unverified estimates. They are not retroactively promoted to verified full-chain calculations. The separate ATM ±7 path requires all 15 ordered strike offsets (−7…+7), CE and PE at every offset, valid nonnegative integer OI, matching snapshot identity when available, quote timestamps from the recorded session, source age ≤30s, skew ≤30s and clock-future tolerance ≤5s relative to the recorded capture timestamp. It rejects ambiguous duplicates. Identical repeated rows can be deduplicated. Missing capture timestamps block this calculation.

Within that **15-strike scope**: PCR is total PE OI / positive total CE OI; walls are all maximum-OI strikes for each side; payout-minimum candidates minimize Σ[CE OI × max(x−K,0) + PE OI × max(K−x,0)]. Zero-OI sides have no dominant wall. Tied maxima/minima remain explicit, and no arbitrary single line is drawn for a tied level. This is a band payout minimum, not full max pain and not actual buyer P&L.

Changes require exact requested endpoints and unchanged strike membership. Membership changes, source gaps and stale quotes reset/withhold comparisons. Migration rows show the observed interval, level shift, spot response and band-PCR response. Intraday plotted links stop at invalid values, changed band membership or gaps >3m; swing endpoints remain disconnected. No signal or predictive strength is inferred from agreement.

Implementation is lazy: the positioning model is computed only in the Spot + full PCR view, reuses already loaded rows and does not fetch additional broker quotes. Figures and source disclosures are visible in the same chapter. SQL projection of canonical archive data is checked against the original JS projection in PostgreSQL 16 CI before deployment.

Methodology references: [Zerodha payout/PCR](https://zerodha.com/varsity/chapter/max-pain-pcr-ratio/) and [NSE India VIX](https://www.nseindia.com/static/products-services/indices-indiavix-index). These support definitions, not a validated composite trading edge.


## Progressive replay and SQL extraction

Replay requests have a 60-second network deadline, one existing bounded retry, and at most two active HTTP calls. Other endpoints keep their 20-second deadline. Current-session history loads newest hourly window first and publishes actual returned rows after each completed window. The dashboard says PARTIAL HISTORY while the requested archive is incomplete. It retains successfully returned partial observations if an older interval fails, exposes the error and offers retry. A different date never inherits the previous date’s rows or history. Current/full source coverage is not inferred from a partial chart.

The first SQL JSON projection preserved values in PostgreSQL CI but a production request took 38.6 seconds, so speed was not accepted as fixed. The revised query extracts `payload->market` in a statement-local MATERIALIZED CTE before projecting the small provenance structure. This creates no persistent database object or stored copy. PostgreSQL CI checks both direct and materialized forms against the JS reference. Production latency must still be measured after deployment.

Canonical archive evidence keeps distinct rows and repeated identical evidence within a window. Overlapping chunk copies are merged by full row and occurrence count rather than minute alone; conflicting snapshots in the same minute remain available to provenance validation. Normalized rows retain their existing observation identity merge.
