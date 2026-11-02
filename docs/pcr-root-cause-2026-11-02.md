# PCR availability: source contract and consolidated repair

Status: PARTIAL. Code and local regressions verified; deployment, current-session
source observations and deployed browser acceptance remain unproven.

## What repeatedly failed

The production branch is `production`, not `main`. At inspection it was
`34518a7cc1c9bfe4768f5f2e2d72f56330e80176`. Railway's verified service is
`optionpilot-pro-v2`, production environment, deployment
`6082acc5-3f0e-434b-b148-d67c1bcf45be` (SUCCESS).
The live dashboard PCR path still uses Kite, even though Dhan variables exist.
No broker migration was performed by the previous display fixes.

The inspected route is `dashboard-live-runtime.ts` → `DashboardPcrSampler` →
`pcrSnapshot` / SSE → `deriveLiveThreeIndexPcr` → One Stop, Premium and compact
overview. Recorded PCR follows a different archive/provenance path.

The 30-second rule is an application gate over **quote packet timestamps**.
Kite documents `timestamp` as the exchange quote timestamp, not an OI-change
timestamp. A successful HTTP receipt does not establish synchronized exchange
observations. It also does not prove that an unchanged OI is erroneous.

Read-only production log example: 2026-10-30 15:30:09 IST, nearest expiries:

| Index | Expiry | Expected | Fresh packets | Old packets | Missing | Invalid |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| NIFTY | 2026-11-03 | 208 | 179 | 29 | 0 | 0 |
| SENSEX | 2026-11-05 | 348 | 311 | 37 | 0 | 0 |
| BANKNIFTY | 2026-11-23 | 308 | 222 | 86 | 0 | 0 |

All 11 requested batches completed. These are historical observations, not
November 2 live readings. Generic market logs printing a numeric "Full-chain
PCR" come from another calculation path and do not establish freshness for
the dashboard sampler. Do not use those logs to override its coverage gate.

The second, same-session reported-PCR calculation also rejects an entire expiry
if **one** packet predates the regular session. The existing production logs
did not expose its first rejection. Prior-session packet frequency in those
logs is therefore unknown, rather than inferred from the stale count above.

## Why many PRs did not finish this issue

These changes are already present in production history; their successful merge
does not prove current data availability:

| PR | Problem addressed | Remaining boundary |
| --- | --- | --- |
| #676 | Periodic full-expiry observations | Old source packets still fail freshness |
| #744 | Encoded URL size / quote batching | Successful requests can contain old packets |
| #753 | Feed recovery / unavailable diagnostics | Recovery cannot refresh an exchange packet |
| #755 | Expiry completion clock | Unrelated later batches no longer age an earlier expiry |
| #775 | Recorded versus live display | Saved ratios cannot qualify fresh live PCR |
| #781 | Independent complete ATM ±7 | Band PCR is not Full PCR |
| #782 | Complete same-session reported PCR | Earlier-session packets still withhold it |
| #787 | Premium Full/Band, OI/volume, comparison periods | Presentation cannot supply missing source evidence |
| #810 | Compact projection of reported ratio | Projection is empty if source derivation rejected it |
| #826 | Source-backed overview fields | Fresh and reported observations remain separate |
| #834 | First rejected identity / timestamp diagnostics | Consolidated with this repair; no new PCR PR needed |

Replay repairs #720, #778–#779, #788–#791 and #829–#831 address archived
retrieval, cadence and playback. They cannot fix live exchange packet age.

## Implemented source policy

1. **Fresh Full PCR:** preserve the 30-second complete-expiry rule. Additionally
   reject pre-open packets even if they are only two seconds old at 09:15:01.
2. **Same-session reported PCR:** preserve its current regular-session rule.
3. **Last reported, earlier packets:** a distinct `lastReportedPcr` observation
   from all exact contracts in the *same successful collection attempt*.
   Validate identity, uniqueness, matching tokens, finite nonnegative OI,
   nonzero CE denominator and usable non-future timestamps. Disclose prior-session
   and pre-open counts, oldest/newest source **dates and times**, and checked time.
   Current-session OI is explicitly unproven. There is no assertion that an older
   packet's OI is unchanged now.

Only the third observation's display is new. It never enters `fullPcr`, fresh
comparisons/arrows, alignment, walls, charts or recorded truth. Its old volume
is withheld rather than labelled today's volume. Fresh values take priority,
then same-session reported context, then explicitly dated last-reported context.
All consumers use the existing shared browser derivation rather than a new
renderer-specific ratio calculation.

Missing/invalid contracts, failed attempts, disconnect, wrong expiry, wrong
runtime/session, invalid totals and expired collection receipts still revoke
the observation. No missing OI becomes zero; no outer strike is removed to force
completeness; no previous collection is borrowed. One-minute polling, optional
three-minute comparisons, provider requests, recorder, database, schedules,
Telegram and order authority are unchanged.

## Regression and release evidence

- Five new regressions failed against the prior PR #834 implementation, then
  passed with this repair: last-reported derivation, invalidation, pre-open
  exclusion, serialized One Stop display and serialized Premium display.
- 152 focused sampler/consumer/recovery/availability tests passed with zero skips.
- 470 related dashboard regressions passed with zero skips before the final
  source-count refinement; final focused suite repeated afterward.
- Repository `npm test`: 691 passed, zero failed, one existing skip.
- Permanent guardrails and whitespace checks passed.
- Expanded production-branch PCR CI to cover source calculation and all affected
  consumer tests. Extended existing mobile/desktop smoke to assert that the
  earlier-session date survives compact projection and revocation.
- Local Chromium launch was unavailable; downloading the browser returned a
  truncated archive. Real browser acceptance must pass in the existing GitHub
  workflow; VM rendering is not represented as browser proof.

## Deployment acceptance (not yet claimed)

Use the same PR #834. Require final-head PCR, evidence-identity, guardrail and
mobile-browser workflows to succeed. Release only with the repository's explicit
production approval, retaining the previous deployment as rollback.

The repeatable read-only acceptance command is:

```sh
node --import tsx scripts/check-full-pcr-availability.ts
```

It exits nonzero unless all three fresh Full PCRs validate. Complete last-reported
ratios are reported separately and cannot turn that check green. It reads the
existing HTTP snapshot, without adding broker requests.

During an actual open session, inspect `/api/research/dashboard-live` and the
deployed display for all three exact nearest expiries. Compare raw CE/PE sums
with each displayed ratio and verify complete contract counts. Record separate
availability for fresh, same-session reported, earlier-packet reported and truly
missing results; inspect the new first-rejection reasons. Do not call the issue
fully solved from a green build, a historical replay or a premarket HTTP response.

If the broker omits a contract or returns invalid OI, a complete ratio remains
unavailable. A broker investigation or separately verified source change is
needed for continuously synchronized fresh values. No code patch can guarantee
future upstream availability.

Primary API semantics: https://kite.trade/docs/connect/v3/market-quotes/


## Follow-up: the user's previously working PCR was verified, not dismissed

November 2 read-only production replay checks returned all three previously
recorded Full PCRs in both the October 15 and October 30 closing windows:

| Session / 15:30 IST | NIFTY | SENSEX | BANKNIFTY |
| --- | ---: | ---: | ---: |
| 2026-10-15 | 1.6343079305675476 | 1.417644515230187 | 1.091960422322238 |
| 2026-10-30 | 1.5233870583380815 | 1.6745298031311096 | 0.9552855696782534 |

These are actual recorded values, with `Normalized full-chain source` and TRUE
row verdicts, not fresh live quotes or independent full-leg timestamp proof.
See `docs/audits/pcr-before-after-replay-20261102.json`. The current source
has not simply stopped producing all three ratios.

The historical collector in `server.ts` still sums available OI and is archived
through the legacy market/chain path. PR #676 on October 16 introduced a separate
one-minute display sampler, and switched that live view from tick PCR to its
30-second complete-packet eligibility. Thus there is a real code/source-contract
change, not merely a broker-outage explanation. The older tick view also had a
30-second packet gate; October 16 is the sampler introduction, not a proven
first date of the user's visible problem.

On October 30 around 09:34 IST, production logs show legacy requests for 208,
348 and 308 option symbols succeeding, while the dashboard sampler reports the
same nearest-expiry expected counts. This supports the eligibility-path finding;
matching counts do not prove identical payloads or identical capture instants.
No October 19 Railway logs were returned by the available historical lookup, so
absence of those logs was not interpreted as absence of market data.

An exact copy of `fetchOptionChainStats` from pre-live-dashboard commit
`3dd1b4e67134f7756e5e3881829a6f0681992d14` is retained as a test-only fixture.
Its SHA-256 is `3ab2d1bc91e482484af39c9badf6f2affcc90091febcdf6c15e180af3da171f4`.
Historical and current calculations were executed against identical offline
responses. Complete fresh OI and real zero PE OI agree. A same-session old packet
leaves reported arithmetic unchanged but withholds fresh eligibility. Removing
one nonzero CE leg makes the historical calculation return 4 instead of 2 because
missing OI becomes zero; the current calculation correctly withholds it. These
numbers are explicitly test fixtures, not production prices or ratios.

The final UI repair puts the complete validated reported ratio in the **primary
Full OI PCR number**, rather than displaying a large fresh-only dash and burying
the ratio in a second block. It applies to One Stop, the three-index strip and
live detail; Premium already selected that number. The compact overview reads
that primary reported value without filling its separate Fresh column. Sources,
checked time and any earlier-session dates remain explicit. Fresh charts,
arrows, walls and alignment still receive only fresh eligible observations.

Epoch-zero/unknown timestamps were found in the October 29 archive audit on
some later-expiry contracts. They are not treated as genuine 1970 observations
for last-reported provenance. The unmerged earlier-packet path now rejects that
sentinel, with a dedicated regression. No current production code was changed
by this hardening before release.

After hours, the supervisor deliberately serves a selected-index recorded
viewer while the market process is stopped. An outside-hours live API response
is therefore a separate operating-mode condition, not evidence of a failed PCR
calculation. The replay viewer is not silently relabelled live.


Final follow-up validation: 158 focused tests and 478 related dashboard tests
passed with zero failures or skips. The three primary-display regressions fail
on the previous #834 head and pass after the repair. Repository `npm test` was
repeated after the production-file changes; generated Telegram wiring is not
included in this patch. The real Chromium smoke now explicitly tests the new
single primary reported number, checks that it does not fill the Fresh column,
and saves clearly named offline reported-PCR fixture screenshots for review.
