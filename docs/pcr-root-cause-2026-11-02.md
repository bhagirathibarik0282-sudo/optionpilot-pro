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
