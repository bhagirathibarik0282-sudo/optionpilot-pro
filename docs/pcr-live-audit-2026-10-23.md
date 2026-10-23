# Full PCR availability audit — 23 October 2026

## Finding

Two different failures explain the missing live PCR: the whole-expiry 30-second
quote-age rule frequently withholds synchronized Full PCR, and the compact
Premium renderer ignores the separately validated `reportedPcr` value added in
PR #782. A successful deployment does not establish live PCR availability.

## Production evidence

Read-only Railway deploy logs were queried for `DASHBOARD_LIVE_PCR_DIAGNOSTIC`
over 09:15–15:30 IST. Four bounded queries returned 371 unique logged checks,
from 09:15:23 to 15:28:55 IST. These are logged sampler outcomes, not continuous
browser uptime or a complete recording of every exchange update.

| Nearest expiry | Logged checks | Complete fresh snapshot | Stale timestamp block | Failed REST attempt |
| --- | ---: | ---: | ---: | ---: |
| NIFTY 2026-10-27 | 371 | 94 | 275 | 2 |
| SENSEX 2026-10-29 | 371 | 1 | 368 | 2 |
| BANKNIFTY 2026-10-27 | 371 | 0 | 369 | 2 |

Expected contract counts were 288, 430 and 314 respectively. Maximum logged
missing-count and invalid-count were zero for these expiries. Two attempts at
10:11:31 and 10:32:15 IST reported `UPSTREAM_UNAVAILABLE`; their partial results
were withheld. The other incomplete outcomes were source-time failures, not
missing OI. These logs do not record why `measureReportedPcr` returned null, so
they cannot establish how often the reported fallback would have been available.

## Code evidence

- `dashboard-pcr-sampler.ts`: `measurePcrSnapshot` requires every expected quote
  timestamp to be within 30 seconds; one outer strike can withhold the full ratio.
- `measureReportedPcr` separately requires complete unique identities, matching
  tokens, valid nonnegative OI, a positive CE denominator, and current regular
  session quote timestamps. It does not require every quote to be younger than
  30 seconds. A previous-session, pre-open or invalid timestamp still rejects it.
  Previous-session rejection is a code fact, not a proven cause for every logged
  unavailable result today.
- `live-three-index-pcr.ts` validates that reported result again, including its
  arithmetic, selected expiry, source ranges, complete coverage, successful
  attempt, active context and maximum receipt age.
- `one-shot-live-card.ts` and `renderLiveThreeIndexPcr` already render reported
  context. `premium-workspace-view.ts` rendered only `r.value`, omitting the
  validated `r.reportedPcr` object. The new regression failed on the deployed
  baseline (zero displayed ratios instead of three) and passed after the fix.
- Whole expiries are admitted or omitted in `buildDashboardLiveInventory`; do
  not replace an omitted full expiry with an ATM subset or silently combine DTEs.

## Broker semantics

Kite documents `timestamp` as the exchange timestamp of the quote packet and
`last_trade_time` as the last trade timestamp. It does not expose a separate
last-OI-change timestamp in that response. Therefore packet freshness is not
proof that OI changed recently, and a recent REST receipt cannot be relabelled
as a recent exchange observation. Illiquid instruments can update infrequently.

- https://kite.trade/docs/connect/v3/market-quotes/
- https://kite.trade/docs/connect/v3/websocket/
- https://kite.trade/forum/discussion/11070/live-nifty-options-data
- https://kite.trade/forum/discussion/3841/quote-api-returns-old-data

The older forum discussions explain cache/illiquidity behavior; they are not a
current guarantee of a fixed OI refresh interval. Do not implement a universal
three-minute exchange OI schedule from them.

## Smallest verified repair

Render the existing validated reported ratio in the Premium strip when fresh
Full PCR is unavailable. Show `Reported · mixed times` and checked time next to
the number, and coverage, older-than-30-second count and source-time range in
Sources. Preserve real zero PE OI. Fresh readings take priority. Reported values
do not create fresh arrows, blinking or synchronized alignment. Failed,
expired, mismatched and disconnected payloads revoke the display.

This changes presentation only. It introduces no broker calls, provider,
database, recorder, selector, Telegram or execution changes. It does not repair
upstream old quotes or promise that complete same-session reported data will
always exist.

## Remaining work and acceptance

1. Add bounded reported-result diagnostics: the first rejecting identity and
   reason, current-session versus prior-session count, oldest source time and
   successful batch counts. Log no credentials or raw broker bodies; reuse the
   existing throttled diagnostic sink. Today's logs cannot answer this fully.
2. During the next live session, check the exact selected expiry, expected
   inventory, summed CE OI, summed PE OI and ratio across NIFTY, SENSEX and monthly
   BANKNIFTY. Distinguish complete synchronized, complete mixed-time, and truly
   unavailable outcomes in the observed results.
3. Preserve the existing one-minute collection and optional three-minute
   comparison. Compare only the same expiry and inventory; gaps or membership
   changes invalidate deltas. Do not claim a synthetic common exchange instant.
4. If nonzero-OI contracts remain on prior-session packets throughout the day,
   prepare exact identity/time examples for broker investigation. Cached
   previous-session OI cannot establish current synchronized Full PCR. Never
   turn missing data into zero, exclude inactive strikes to force completeness,
   or widen the fresh threshold solely to make the display green.

The outcome can be an honestly labelled complete broker-reported Full PCR with
source ages; continuously synchronized fresh Full PCR for every illiquid strike
cannot be guaranteed from the available evidence.
