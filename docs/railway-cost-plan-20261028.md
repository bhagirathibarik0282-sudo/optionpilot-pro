# Railway cost plan — 28 October 2026

## Scope and evidence

Workspace: Bhagirathi Barik's Projects. Production project: courteous-perception.
Evidence: Railway connector metrics for the last 168 hours sampled every 3600
seconds (169 samples), service configuration and bounded runtime logs.
The screenshot shows $15.10 consumed against a $15 compute limit. This is
cycle-to-date usage, not a known full-month invoice or a monthly forecast.

| Service | Average RAM, GB | Average CPU, vCPU | 24/7-equivalent RAM + CPU/month |
| --- | ---: | ---: | ---: |
| optionpilot-pro-v2 | 0.5571 | 0.01622 | $5.90 |
| Postgres | 0.4408 | 0.04055 | $5.22 |

Formula: `RAM_GB * 10 + CPU_vCPU * 20`.
The two primary services total **$11.12/month equivalent**, before storage,
network egress, cron jobs, diagnostic executions and taxes. One sampled week
does not establish a representative monthly average, particularly during a
usage-limit pause or redeployment.

Cron/diagnostic memory samples are sparse and may describe only running
periods. Do not multiply their nonzero averages by a whole month or claim
they run continuously. FII/DII logs show successful jobs finishing in seconds.
EOD logs show Drive authentication/scope errors after about 30–40 seconds.

Official pricing checked on 28 October 2026:
https://docs.railway.com/pricing/plans
RAM $10/GB-month; CPU $20/vCPU-month; egress $0.05/GB;
volume storage $0.15/GB-month. Hobby minimum $5, included toward usage;
Pro minimum $20. The active subscription tier was not retrieved, so the
sub-$20 total-bill estimate below is conditional on Hobby.

## Implementation status

Code is committed locally on `fix/railway-background-cost-20261028` and tested.
Automatic approval review blocked the GitHub push; the new code has not been
published, merged or deployed. Railway cron settings have been saved and
read back; they apply on the services' next deployment. Two old diagnostic
services with one-hour sleeps have a saved immediate no-query exit command
with restart NEVER. Redeploys reached SUCCESS but logs still showed old audit
commands; runtime application of the new command is NOT verified, and no
realized diagnostic saving is claimed. The connector rejects zero replicas.
No database volumes were mounted on either diagnostic service. Existing production app/database recovered to
online during this work through a pre-existing deployment, not this code.

## Prepared code and saved configuration changes

1. Automatic Dhan M1 and multi-expiry refresh cycles run only during the
   existing market-open or closing-observation windows. Each cycle skips
   overlapping invocations and releases its lock on errors. Existing holiday
   rules are reused. Closing observations through 15:40 IST in October remain
   enabled. The existing date-aware December closing extension is preserved.
2. The session background scheduler still expires sessions at all times,
   while automatic upstream market refreshes use the same observation window.
   Explicit requests and their original freshness checks remain available.
3. Replace the three tsx CLI launchers in npm start with `node --import tsx`.
   This avoids extra CLI supervisor processes; actual RAM savings require
   measurement after deployment.
4. EOD Railway schedule changed from daily to weekdays, at the existing
   10:30 UTC / 16:00 IST time. Its command uses direct Node + tsx import;
   restart policy stays NEVER. FII/DII uses the same direct launcher while
   preserving its existing holiday guard and 20:30 IST weekday schedule.

With 22 trading days and a 09:15–15:40 observation window, these automatic
loops are active for about 141.2 of 720 hours in a 30-day month: roughly 80%
fewer scheduled polling opportunities compared with 24/7 operation. This is
**not an 80% reduction in the total bill**: the API and database remain up,
holding RAM, and explicit reads can still fetch data.

## Budget scenarios, not guaranteed savings

| Component | Working monthly allowance | Assumptions |
| --- | ---: | --- |
| Main app | $4.2–$5.9 | Average RAM 0.40–0.557 GB, CPU 0.01–0.0162 |
| PostgreSQL | $4.4–$5.3 | Average RAM 0.36–0.441 GB, CPU 0.04–0.045 |
| Storage | $0.7–$2.3 | Retain existing volumes; no deletion-based saving booked |
| Egress + jobs/diagnostics | $0.7–$2.5 | Planning allowance, not invoice-derived usage |
| Total | **about $10–$16** | Rounded; Hobby, excluding tax and external API bills |

Double-check correction: use **$12–$16/month** as a conservative planning
range on Hobby until a representative week of optimized operation is measured.
The earlier **$10–$14** figure is an aspirational target, not a verified forecast.
Polling guards do not directly free retained RAM, and PostgreSQL has not been
retuned. A $15 hard limit can therefore still pause the app near the upper end.
Reaching $10–$14 is conditional on lower observed memory/network use.
If consumption stays at the old averages, the lower target may not be met.
Do not claim realized savings until a representative trading week has run.
On Pro the subscription floor remains $20 even if resource usage falls below it.
Anthropic/OpenRouter/broker charges are outside this Railway estimate.

## Data preservation and deferred work

Keep one production app replica and one Postgres replica. Do not enable
Serverless on the recorder/database: automatic wake-up for market opening is
not guaranteed by an HTTP-driven sleep toggle.
Do not lower the app RAM limit below its observed 2.56 GB peak to force a bill
target; that risks a crash rather than fixing retained memory.

The detached 5 GB volume in invigorating-purpose is retained until ownership,
backup and restore viability are verified. Its reported capacity is not proof
of actual used bytes, so no deletion saving is included.

EOD Drive uploads have failed with invalid_grant/insufficient authentication
scopes. Repair and verify archival before considering any retention cleanup.
No stored market rows, database volumes or backups are deleted in this change.

## Verification and rollback

Tests execute real Dhan scheduler bodies with mock fetches, verify zero closed
market calls, open-market resumption, overlap suppression, failure recovery,
and expired-session cleanup. Existing recorder/closing/calendar suites verify
that market data capture and closing observations remain intact.

After deployment, verify terminal SUCCESS and /health. Compare another
representative 7-day window and the Railway Usage breakdown. Suggested alert
$12, hard limit $15; do not raise or reset a workspace spending limit as part
of code optimization. A hard-limit pause requires a billing-limit change or
the next billing cycle; configuration changes do not erase consumed charges.

Rollback code by reverting this commit. Railway rollback values: EOD cron
`30 10 * * *`, EOD start `npm run eod:archive`; FII/DII launcher prefix
`./node_modules/.bin/tsx -e` with its existing inline holiday guard.

## Second verification

On 28 October, all 19 targeted calendar/closing/recorder/scheduler tests passed
again. Production app and PostgreSQL are online. Both diagnostic audit
services still report one running replica despite the saved no-query exit
commands: shutdown is not complete. Cron services report Ready with no
running replicas, consistent with scheduled execution. Saved settings alone
do not prove that an existing container uses the new command. No extra
publishing or deployment was attempted during this read-only second check.
