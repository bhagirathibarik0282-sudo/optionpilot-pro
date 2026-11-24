# Contract-level PCR arithmetic audit

Status: PARTIAL. Existing production data inspected; audit endpoint and independent
reducer tested locally. No merge or Railway deployment performed.

## Observed production behaviour

Verified Railway service `optionpilot-pro-v2`, production environment, repository
branch `production`. Inspected commit: `2f38f331d925f0d402520674c9d70f3a9d13eef7`.
Railway's latest deployment at inspection was
`a192ef1a-a2f4-4f09-b2e0-21829fac7dbd`, SUCCESS. Deployment status alone is not
data correctness evidence.

The existing public snapshot was read during the November 4 market session.
At server time 11:57:54 IST, all three nearest-expiry reported observations
were available. Snapshot collection times were 11:57:37–11:57:41 IST.

| Index | Expiry | Contracts | Missing | Invalid | Packets older than 30s | Reported PCR |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| NIFTY | 2026-11-09 | 246 | 0 | 0 | 8 | 0.9142328903277325 |
| SENSEX | 2026-11-05 | 364 | 0 | 0 | 10 | 0.9506371461277109 |
| BANKNIFTY | 2026-11-23 | 308 | 0 | 0 | 34 | 0.9588072043139908 |

See `docs/audits/pcr-live-availability-20261104.json` for reported CE/PE totals.
Independent division of those totals matches each reported ratio. That is not
independent summation of broker contract rows or a broker-terminal comparison.
All fresh Full PCR fields remained unavailable under the existing 30-second
eligibility policy. The existing reported-PCR display fallback is already in
production; this change does not pretend to implement it again.

Kite describes `timestamp` as the exchange quote timestamp, separately from
`last_trade_time`. It is not documented as an OI-change timestamp. Its official
forum also describes lower packet frequency for illiquid instruments. These
facts support investigating quote-age eligibility separately from arithmetic;
they do not establish that an older packet's OI is unchanged now.

Sources:
- https://kite.trade/docs/connect/v3/market-quotes/
- https://kite.trade/forum/discussion/11070/live-nifty-options-data

## Evidence gap and bounded implementation

The sampler only exposed full `strikeRows` when the strict fresh-expiry gate
passed. The inspected payloads therefore had empty rows despite complete
reported CE/PE totals. Per-contract independent arithmetic could not be audited
through the existing HTTP response.

The collector now retains one allowlisted OI evidence set per inventory expiry
from the current REST attempt. It contains expected identity/token, returned
token, OI and original source timestamp only. It contains no credentials, headers,
depth, positions or account data. It is replaced every attempt and revoked on
failed attempts, expired receipts and session changes. Runtime also blocks it on
disconnect, feed disablement and market close. Read-back returns copies.

`GET /api/research/dashboard-live/pcr-audit?symbol=NIFTY&expiry=2026-11-09`
reads this cache only. It makes no additional broker call, performs no DB write,
and returns `Cache-Control: no-store`. Audit rows are deliberately absent from
the existing snapshot and frequent SSE stream. Storage remains bounded by the
existing instrument inventory; there is no historical accumulation.

The separate command validates row identity, token/key uniqueness, exact expiry,
OI, receipt age, nonzero CE denominator and source timestamps; independently sums
all CE/PE rows and compares both totals and the ratio with the collector claim:

```sh
node --import tsx scripts/check-pcr-contract-arithmetic.ts \
  https://optionpilot-pro-v2-production.up.railway.app NIFTY 2026-11-09
```

Use the actual expiry from the current snapshot, never a hardcoded date for
future sessions. A hash identifies the normalized audit payload, not raw HTTP
bytes. An arithmetic pass does not establish instrument-master universe
completeness, exchange truth, source synchronization, fresh trade eligibility
or actual browser/mobile rendering. Earlier-packet observations remain labelled.

No source freshness gate, PCR display policy, contract selection, polling cadence,
broker credentials, recorder, database, Telegram or execution authority changes.

## Validation

- Four new audit tests failed on the previous production code (missing evidence
  reader/route), then passed with the implementation.
- 184 related tests passed, zero failures/skips, including sampler, historical
  parity, actual serialized display projections, HTTP routes and reconnect logic.
- Permanent guardrail checker and `git diff --check` passed.
- Existing production availability command remains correctly non-green for
  fresh Full PCR while reporting all three complete reported ratios separately.

## Remaining acceptance

After explicitly approved release, read each exact index/expiry audit endpoint
and run the independent reducer during the live session. Compare the same
cycle's totals with the existing snapshot and actual mobile display. Check
expiry inventory against the instrument master separately. Record disconnect,
failed-attempt and expiry/session invalidation results. Do not call the overall
PCR issue solved from local tests or aggregate-only division.
