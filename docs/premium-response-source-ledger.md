# Recorded premium response: source ledger and first checkpoint

Status: implementation and local validation only. No production release in this checkpoint.
Scope: the existing RAG evidence card and Chapter 8 Ask RAG entry point. This is the
shared calculation foundation, not all-chapter RAG or historical same-DTE matching.

## Actual text consulted on 2026-10-18

These are public educational/API texts read directly. Book publisher descriptions
and contents used earlier are not a claim that the full books were read or audited.

| Primary source | Text consulted | Supported use and boundary |
| --- | --- | --- |
| [OIC Options Pricing](https://prd-web.optionseducation.org/optionsoverview/options-pricing) | Intrinsic Value (Calls/Puts), Time Value, Major Factors Influencing Options Premium | Premium comprises intrinsic and time/extrinsic components. For this archive, calculate and label **spot intrinsic proxy** and **spot remainder**; do not claim a causal contribution. |
| [OIC Delta](https://prd-web.optionseducation.org/advancedconcepts/delta) | Definition, examples, effects of time and volatility, changing Delta | Delta is a theoretical sensitivity with other inputs held constant. Observed premium change divided by spot change is explicitly not Delta. |
| [OIC Gamma](https://prd-web.optionseducation.org/advancedconcepts/gamma) | Definition, In other examples, ATM/expiry dependence | Explains why DTE and moneyness matter. No Gamma estimate is produced in this checkpoint. |
| [OIC Theta](https://prd-web.optionseducation.org/advancedconcepts/theta) | Definition, nonlinear decay and weekend treatment | A change in the remainder does not isolate Theta. No Theta-loss attribution is produced. |
| [Kite market quotes](https://kite.trade/docs/connect/v3/market-quotes/) | Instrument identity note and full-quote response attributes | Exchange packet time and last-trade time are distinct; numeric tokens can be reused after expiry. Existing archive lacks instrument token/tradingsymbol and verified last-trade timestamp semantics, so these are disclosed limitations. |

These sources establish definitions. They do not validate an empirical relation,
forecast, profit rate or candidate in the user's Indian index recordings.

## Measured calculations

For each exact index/date/expiry/strike/side and requested interval:

- `price change = P1 - P0`; percentage uses the exact positive P0.
- `spot change = S1 - S0` from the matched recorded market snapshots.
- CE spot intrinsic proxy: `max(S - K, 0)`; PE: `max(K - S, 0)`.
- Spot remainder: `P - spot intrinsic proxy`. It is an arithmetic decomposition
  using recorded spot, not model-verified extrinsic value for European index options.
- A negative remainder remains visible. It can require timing/carry/model context;
  it is neither clamped to zero nor labelled a guaranteed pricing error.
- Observed premium-per-spot-point ratio is withheld for a zero spot move and is not
  a theoretical Greek. Nonfinite calculated values remain unavailable.
- Calendar DTE is recomputed from date and expiry. Conflicting stored DTE blocks
  the affected endpoint. No expiry hour is invented from date-only metadata;
  minutes-to-expiry and trading-minutes-to-expiry remain unimplemented.
- Verified Greek model/unit provenance is not established, so model attribution
  remains unavailable even if raw rows contain Greek-looking numbers.

## Identity, point-in-time and freshness checks

The shared reader only projects the existing replay response. It performs no
network requests, database writes, timers, broker calls or model calls.

Exact bucket and contract are required; no nearest timestamp/strike/expiry lookup.
Current and baseline records must each be TRUE and tied to their own market
snapshot. Receipt must be within [0, 60] seconds of the nominal bucket. The option
quote must be on the same IST date, within [-5, 30] seconds of receipt, and both
receipt and quote must be at or before the selected cutoff. The five-second
forward-skew tolerance is an inherited, disclosed convention, not exchange proof.
A response needs distinct snapshot IDs and forward-moving option quote times.

Equivalent relative-expiry aliases are deduplicated on relevant fields. Conflicting
price, quote, OI, DTE or bid/ask fields quarantine the endpoint. Missing baseline
withholds deltas; missing spot preserves an accepted option quote but withholds
spot-based calculations. Present stale/future market exchange timestamps withhold
spot values. Absent spot exchange timestamps remain explicitly unverified.

Source SHA256 covers the selected normalized identity, cutoff, endpoints and
calculations. It is not a hash of a raw exchange message or proof of a live fill.
Bid/ask spread is only recorded quote context; crossed/incomplete books do not
produce a valid spread or execution-profit claim.

## First user-visible checkpoint

Existing exact-event and snapshot GET responses gain `premiumResponse`.
The current evidence card renders compact measured changes plus collapsed source,
proxy decomposition and timestamp details. Existing answers, reference resolution,
optional outcomes and multi-DTE retrieval retain their contracts. No automatic
retrieval is added. Selection changes still invalidate old results.

No new database, candidate authority, Telegram send, seller execution or broker
order path is introduced. Same-DTE historical matching, exact expiry clocks,
Greek attribution and all-chapter integration remain later checkpoints.

## Devil Check

Run the dedicated RAG CI command, new shared-reader tests, dashboard regressions
and permanent guardrails. Set `RAG_RAW_FIXTURES` to the existing retained raw archive
to enable actual-recording tests; ordinary CI cannot access that private scratch
archive and marks those tests skipped. The separate recorded proof JSON identifies
its raw-file hashes and attempted cases, including withheld cases.

Reproduce the archive report (read-only):

```sh
RAG_RAW_FIXTURES=/path/to/retained/raw node --import tsx scripts/check-premium-response-recordings.ts > /tmp/premium-response-proof.json
```

## Validation receipt

- Dedicated RAG suite: 162 passed, 0 failed, 0 skipped with retained raw fixtures enabled.
- Dashboard regression suite: 252 passed, 0 failed.
- Full `npm test` and permanent guardrails passed.
- Archive proof: 74 attempted contract cases over 8/9/12/13 October, all three indices;
  46 measured and 28 withheld by quote freshness/cutoff checks. These are data
  acceptance counts, not trading performance or independent exchange validation.
- Production baseline GET for 13 October NIFTY 22300 PE, expiry 13 October,
  09:36 IST, snapshot kind, cutoff 09:36:59 IST returned the same exact
  12.25 -> 11.20 pair as the retained archive. This verifies existing source parity,
  not deployment of the new response feature.
- The serialized evidence UI has behavior/escaping tests. Visual browser acceptance
  of this new UI and post-release HTTP acceptance remain pending.
