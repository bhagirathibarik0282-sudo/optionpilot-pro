# Missing front dashboard evidence

Status: PARTIAL. Local projection regressions pass; new-head Chromium and deployed readback pending.

Read-only production audit on 4 November 2026:

- The live envelope returned connected=true, OPEN, with all three index spot quotes LIVE.
- NIFTY FULL compact replay for 14:30–14:40 IST returned 11 market rows and 1,034 option rows. Every returned option row had PDH, PDL, LTP and OI fields. This is availability evidence, not blanket freshness admission: 91 rows were DIAGNOSTIC_STALE_PREMIUM and 27 DIAGNOSTIC_FUTURE_SOURCE_TIME. Those rows cannot supply change baselines.
- The recorded-date index advertised today's first marker at 11:43 IST. A complete 09:15–09:30 opening sample range is not proven by this archive. The 14:30–14:40 replay also correctly derived no complete opening range.
- The front live premium renderer hardcoded PDH, PDL and OI change to missing. Its 1/3/15m changes depended entirely on browser-local history even when eligible exact-contract recorded endpoints were already loaded.
- Futures references still lack a verified same-contract previous-session high/low source. Market-level recorded futures do not establish expiry continuity; spot levels must not fill these fields.
- Strict full-chain OI walls / changes retain their existing freshness requirements. Reported mixed-time totals do not establish fresh wall alignment. No PCR collector changes are included here.

Changes:

1. Live premium PDH/PDL reuse the existing exact-contract reference resolver already used by the ATM ladder. References require the same trading session, index, expiry, strike and CE/PE side, TRUE rows not later than the live quote, and consistent positive levels. Conflicting levels remain missing.
2. Existing live endpoints remain preferred for price and OI comparisons. A missing local baseline may use already-loaded recorder history with an explicit saved source clock. Only TRUE non-diagnostic rows with same-session quote timestamps, source age 0–30 seconds, bounded bucket/quote alignment, and a quote at or before the target by at most 15 seconds qualify. No future or nearest-anywhere substitution is used. Duplicate source timestamps must agree for the requested field. OI accepts safe nonnegative integers, including zero.
3. Live premium OI change uses the selected existing window and the same exact contract. Its baseline clock and saved/live source are exposed alongside the existing LIVE price status. This is a current live price/quantity versus a labelled historical endpoint, not a synchronized full-chain OI snapshot or trading signal.
4. Spot reference rows can project directly from consistent same-session TRUE recorded market rows while derived book models are still loading.
5. The front retains reference/baseline provenance beside the source without changing price-pair admission.

No extra browser polling, broker requests, tables, processes, retention or trading authority is added. Browser-local charts and Multi-DTE comparison semantics are unchanged. Missing saved endpoints, opening coverage, verified futures references and historical matches remain missing.

Validation: 194 related data/display/PCR regressions pass, zero failures/skips. Tests cover immediate saved-baseline projection, exact identity/session, stale/future sources, conflicting duplicates/references, zero OI, disconnect revocation, delayed model availability and front provenance retention.

## Receipt-clock follow-up from deployed acceptance

The deployed front showed NIFTY 23,900 CE for 9 November with PDH 82.3,
PDL 35 and Above PDH. At 15:07:23 IST its live price 177.60 minus the
eligible 14:52:09 saved price 180.75 matched the displayed 15m change -3.15.
For 23 November CE, saved OI 2,111,135 at 15:04:09 versus live 2,110,550
matched the displayed 3m OI change -585. These exact saved endpoints were
independently read from compact CORE replay. The December expiry had no admitted
recorded references and stayed missing.

Live 1m history still disappeared during acceptance. Source inspection and a
failing regression reproduced the cause: sample() treated a different value
at the same second-resolution exchange timestamp as contradictory, even when
a later packet receipt timestamp identified a separate newer tick. Repeated
valid updates consequently erased older baseline history.

Samples now retain the latest validated receipt in each exchange second.
Older receipts cannot overwrite newer ones. Different values with identical
exchange AND receipt clocks still invalidate history; freshness, gaps, contract
identity, runtime reset and PCR comparison gates remain intact. No timestamps
are shifted and no baseline is interpolated. The follow-up adds positive and
negative packet-clock regressions; all 196 related tests pass locally.

## Transient transport reset root cause

The live-view watchdog publishes a missing envelope after four seconds without
an update. Acceptance encountered browser read timeouts and minute deltas remained
unavailable even after the receipt-clock correction. The one-shot update path
converted any missing envelope to an empty runtime key, then cleared all history.
A regression reproducing intermittent missing frames failed before correction.

A missing envelope still revokes all current values immediately. Valid historical
points now survive that display-only outage until a new valid runtime/session
identity proves a reset. Existing 35-second observation-gap resets, endpoint
age/tolerance and exact contract checks remain. A replacement runtime still
clears all history. This does not retain stale current values or bridge arbitrary
long recording gaps. All 197 related tests pass, including revocation and reset.
