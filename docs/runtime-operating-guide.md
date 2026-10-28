# OptionPilot operating window and production release

## Prepared behavior

`npm start` runs a small HTTP supervisor. It launches the main application
from 08:45 inclusive to 16:15 exclusive, Asia/Kolkata, on weekdays excluding
the existing reviewed holiday calendar. It checks the clock every five seconds.
The supervisor stays alive overnight; this is not a zero-compute shutdown.
Its measured RAM must be included in cost estimates. Do not enable Railway
Serverless: sleeping the supervisor would stop its clock and risk missing open.

The public port remains Railway's `PORT` (normally 8080). The child app uses
8081 by default and receives that value as its own PORT, preserving internal
self-requests. The gateway proxies methods, bodies, headers, cookies, SSE and
WebSocket upgrades. It does not cache market data or substitute old values.

Off-hours normal requests return 503 with explicit operating status.
`/ops/runtime-status` reports state. `/health` returns an explicit supervisor
health response off-hours; during an active window it is healthy only after
the real app's `/health` responds successfully. An off-hours successful
deployment therefore proves supervisor readiness, not full market runtime
readiness. Test the runtime via a temporary maintenance window after release.

## Closing and data preservation

At 16:15, new app requests are refused; SSE/WebSocket connections are closed.
Existing ordinary HTTP requests finish before drain is requested. The child
stops interval work, waits for its active recorder capture, session refreshes,
tracked SQL/fetch/async interval work, and three quiet seconds before exiting.
It does not delete recorded rows, files, volumes or backups. The supervisor
does not force a scheduled shutdown timeout: if a task is stuck, data safety
takes precedence over savings and the runtime may remain up for investigation.
Railway's own deployment termination timeout is separate and can still stop
a stuck process during a platform redeployment. In-memory-only state may
reset on a daily restart, as it already does on any redeployment.

The existing closing-observation and trading/freshness rules stay in place.
FII/DII and EOD are separate Railway services and do not use this supervisor.
PostgreSQL stays up. FII/DII remains scheduled for 20:30 IST weekdays with its
existing holiday guard. The EOD job remains at 16:00 IST weekdays. Existing
Drive permission failures are not repaired by this change; no retention
cleanup is allowed on the assumption that those backups are verified.

## Temporary off-hours work

An authorized operator can POST `/ops/runtime-window` with JSON
`{"minutes":30}` and the existing `RESEARCH_ADMIN_TOKEN` as Bearer auth.
Only integer durations 1–60 are accepted. Never place that token in a URL,
commit, chat response or log. There is no unauthenticated start control.
The expiry is stored on the existing volume in a mode-0600 JSON file and
survives deployments. Expired or more-than-one-hour future values are ignored
on startup. The app starts within one supervisor tick plus normal startup.
After expiry it drains again. An override is not needed during normal hours.

## Separate code merge from production deployment

The intended Railway app source is the repository's **production** branch,
while everyday PRs merge into **main**. An operator runs the manual GitHub
Actions workflow **Release OptionPilot production** after observation work.
It validates the chosen commit belongs to main, runs operating-window tests,
then fast-forwards production. Railway deploys that branch. Normal releases
are blocked during 08:45–16:15 IST; the explicit emergency checkbox permits
an intentional interruption for an urgent fix. Do not claim zero recording
gaps when redeploying the live recorder. Separate PR preview environments can
also incur costs and are not required for this plan.

## Rollout checklist

1. Publish this branch, open/review the PR and pass CI. Publishing is currently
   blocked by automatic approval review, pending explicit GitHub permission.
2. Before merging, stop main-based autodeploys for the main app so merging
   cannot interrupt a market session. Preserve both independent cron services.
3. Merge and promote the tested commit to production outside recording hours;
   connect only the main app's Railway source to production. Verify exact
   project/service IDs and no unrelated staged changes before deployment.
4. Observe terminal SUCCESS, then the public health/status responses. Open a
   bounded maintenance window if off-hours and verify real child readiness,
   existing authenticated dashboard, live stream and graceful stop. Do not
   declare production scheduling active before these checks.
5. Verify the next 08:45 startup and next FII/DII cron success. Compare one
   representative trading week of CPU/RAM/egress. $10/month remains a target,
   not a guaranteed invoice. Keep the workspace hard limit unchanged during
   rollout; a $9–$10 workspace cutoff can also stop the FII/DII/database.

Rollback: switch start command to `npm run start:prepare && npm run
start:legacy-runtime`, redeploy the prior known-good production revision and
verify its real `/health`. Do not roll back or remove PostgreSQL data.

## Validation

`npm run test:runtime-window` exercises operating/calendar boundaries,
maintenance authorization and expiry, real child-process start/stop, proxy
POST/cookies, SSE closure, in-flight request draining, next-morning restart,
and SQL/fetch drain counters. `scripts/test-runtime-supervisor-smoke.mjs`
boots the real application without credentials in an isolated worktree and
checks both health and graceful drain. Existing recorder/closing tests remain
part of regression validation.

### Local results, 28 October 2026

- Eight new runtime/authorization/drain tests passed.
- Thirty-five targeted recorder/calendar/closing/feed regression tests passed.
- Full existing npm test: 691 passed, 1 database-dependent test skipped, zero failures.
- The actual main app booted without credentials in an isolated worktree;
  its proxied real /health returned 200 and its graceful drain exited zero.
  This does not establish authenticated broker/database behavior in production.
- Guardrail and whitespace checks passed.
- GitHub push was rejected again by automatic approval review because explicit
  publication permission for this destination was not recognized. No workaround
  was attempted. The new supervisor, production branch routing and release
  workflow are committed locally, not published, merged or deployed.
