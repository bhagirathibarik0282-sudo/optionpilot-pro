# Connection and delivery-age acceptance

6 November 2026. Existing Railway service only. No deployment, broker login,
secret read, admin mutation or trading was performed during this audit.

## Observed boundaries

- Verified service optionpilot-pro-v2 / production / courteous-perception.
  Railway reports deployment f88cf52a-ab8f-46e7-b06c-29d487847fd7 SUCCESS,
  no staged changes, source branch production.
- Production-branch source reviewed at cb58178a35c363258c067311c3ab4c23ef81e357:
  server.ts calls mountResearchRoutes; research-server-hook.ts mounts
  researchRouter under /api/research; research-router.ts mounts the snapshot
  routes. None of those inspected read-route layers requires getSession.
  Mutation endpoints separately require the research admin token.
- Browser Kite session, shared broker feed authority, app access policy and
  Railway connector access are different concepts. Do not add broker/admin
  credentials to the app to solve a read failure.
- Direct credential-free GET /ops/runtime-status returned 200, shouldRun=false,
  running=false, ready=false, hoursIST=08:45–16:15. GET
  /api/research/dashboard-live returned 503 OUTSIDE_OPERATING_HOURS.
  Therefore this observation is scheduled runtime closure, not a 401/403 login
  failure. The runtime was not started to manufacture a live proof.
- The source finding does not prove the deployed route's in-window payload or
  authenticate an account. During-hours access, NIFTY identity and source age
  still require direct acceptance. Private access/release policy remains open.

## Android change for the next candidate

The old reader started its freshness timer only after parsing, without budgeting
network transit or checking whether the entire envelope was old. Version 0.1.2
adds a conservative delivery budget: max(snapshot request+decode duration,
phone-clock minus server-envelope time, floored at zero). It adds that budget
to source age for spot and each option leg, then continues aging with monotonic
time. The 30-second source budget and 5-second local recent-response window
remain unchanged. It rejects an envelope over 30 seconds old or over 5 seconds
in the future against the request-start phone wall clock plus monotonic duration.

This is conservative, not precise exchange-to-phone latency or synchronized-clock
proof. A badly set phone clock can reject valid data; the app explicitly asks
for automatic date/time and a retry. Local saved readings remain historical.
The original raw snapshot is cached only after a usable response passes delivery
checks; rejected envelopes cannot become current quotes.

Candidate tests cover old-envelope replay, clock skew/future envelope, negative
monotonic duration, conservative age estimation, transit expiry and an option leg
that becomes stale while spot remains recent. These tests use synthetic data.
No live feed correctness, authenticated read or network reconnect is claimed.

## Next acceptance

Complete the candidate's CI and inspect APK, reports and offline screenshot.
When the normal runtime is active, GET the existing read-only snapshot without
credentials first; verify trade date, exact NIFTY identity, source/server times
and response age. If 401/403 is actually observed, design scoped mobile access
against that boundary. Do not reuse admin tokens or browser broker cookies.
No broad features or orders before that slice is accepted.
