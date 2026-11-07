# Market Capsule 0.1.10 — data-flow and access audit

Checked 7 November 2026 IST. Scope: released Android source, deployed backend source, platform identity and bounded credential-free GET observations. No code fix, backend change, new APK or new live acceptance is claimed.

## Exact evidence anchors

- Android release source: `3bf9a406439a16d7d52bda6e7c3a4c77bf4bb1e1`. [Release run 42321096322](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42321096322) was re-read and remains completed/success at that SHA.
- Railway courteous-perception / production / optionpilot-pro-v2: service `030df1c1-24b3-45ec-b2ba-d0798a91e0bb`, deployment `64bb261a-18e9-4f67-af4e-70ba1d8a61bf`, SUCCESS, no staged changes.
- Deployment metadata explicitly identifies production source `b60d136524259cc1970b1f1d05d808a3cb0192cf`; it matches the inspected production ref. This is deployment metadata, not an independently attested running-container filesystem.
- Backend files inspected at that SHA: server.ts, research-server-hook.ts, research-router.ts, dashboard-live-http.ts and dashboard-live-runtime.ts. Downloaded server.ts was independently checked against its Git blob SHA `1b2b4e65138b0e28f514b379ebd78f9a718b378c`.
- Android files inspected at the release SHA: MarketRepository.kt, MarketModel.kt, MarketViewModel.kt, SnapshotStream.kt, StrikeLadder.kt and PcrReadings.kt.

## Source-to-screen map and double-check

| Family | Actual path and behavior | Checks found | Boundary |
| --- | --- | --- | --- |
| Manual snapshot | ensureRuntime -> GET /api/research/dashboard-live -> SnapshotParser -> applySnapshot -> native state | Expected root source, runtime ID/sequence, duplicate index rejection, exact spot/option identity and valid expiry, observation/receipt chronology, delivery plus monotonic aging and order watermark | Source checks found; current live phone response not observed |
| Foreground updates | Runtime preflight -> GET /api/research/dashboard-live/stream -> complete named snapshot events -> same parser/state path | Bounded framing, required SSE content type, conflated latest complete state, background cancellation, previous stream cancellation/join, bounded retry with jitter, explicit fatal/auth/off-hours handling | No durable replay cursor or proof of physical-network recovery |
| Exact strike ladder | Explicit Load strikes -> runtime preflight -> GET premiums?view=ladder&nearby=7&symbol=...&expiries=... | Index/expiry/side/role, real same-day date, duplicate contracts, response bounds, observation/receipt ages, runtime match and source-present ATM reference | Manual reload, no continuous ladder refresh; depends on eligible current selected-index spot; no invented missing legs |
| PCR/OI | Existing snapshot.pcrSnapshot -> independent PcrReadingParser -> native full/band/reported fields | Same session/expiry, source/fetch state, coverage, finite nonnegative totals, PE/CE arithmetic, chronology, frozen 15-strike band membership, conflicting totals withheld, delivery/elapsed budget | PCR can remain eligible independently of spot; 90-second completed-snapshot window differs from per-measurement OI age |
| Saved Memory | Private atomic snapshot file -> saved state | Bounded read, invalid cache ignored, historical labels; disconnected/saved state cannot become current | Cache is not recorded-session replay; not a full history database |
| Backend mount | server.ts -> mountResearchRoutes -> /api/research router -> live GET routes | Live routes are read projections; app sends GET requests without broker/admin secrets; mutation-token checks are separate in research router | GET market reads are not owner-authenticated by the inspected mount chain |

Full PCR means the backend's subscribed expiry inventory, not independently verified full exchange coverage. A complete band or mixed-timestamp reported value does not replace unavailable synchronized full PCR. The ATM-card expiry filter does not select PCR expiry.

## Runtime observations

Three unauthenticated read-only requests were made with no cookies or broker/admin headers. The expiry below is a syntactically valid probe selection, not an assertion that it is a listed exchange expiry.

| IST time | Route | Observation |
| --- | --- | --- |
| 07:05:25 | /ops/runtime-status | HTTP200; tradingDate 2026-11-07, shouldRun=false, running=false, ready=false; hours08:45–16:15 |
| 07:05:32 | /api/research/dashboard-live | HTTP503 OUTSIDE_OPERATING_HOURS with the same runtime flags |
| 07:05:40 | /api/research/dashboard-live/premiums?view=ladder&nearby=7&symbol=NIFTY&expiries=2026-11-10 | HTTP503 OUTSIDE_OPERATING_HOURS with the same runtime flags |

The observed failure is an explicit scheduled-closure response, not a proven broker outage, bad expiry, authentication failure or feed defect. No stream slot was opened outside hours, and no process was started to manufacture live evidence. Session-calendar correctness and current-session coverage were not independently established by these closed-runtime reads.

## Access finding

The released Android client has no owner sign-in token/cookie and deliberately refuses redirects. A 401/403 is displayed as authentication required; it does not prompt for broker/admin secrets. The inspected deployed-source GET mount chain does not enforce an owner-specific mobile session. Browser Kite login is a broker connection flow and does not establish owner authentication for these GET routes.

Status: owner-only app access is NOT implemented/accepted by the inspected path. The outside-hours runtime responses alone do not prove what an authenticated or unauthenticated market-hours payload contains. No access policy was bypassed or silently changed. If owner-only reads are required, scoped backend verification and Android sign-in must be designed together; hard-coding a shared private token into the APK is not a repair. Auth-sensitive features and private account data must not be added on the assumption that existing market reads are owner protected.

## Acceptance and next implementation

- Source audit: completed for the paths above; no additional reproducible Android defect was established in this bounded inspection. Existing limitations are recorded, not relabelled as new bugs.
- Release evidence: existing successful run revalidated. No new JVM/emulator run was needed or claimed for this documentation-only audit; prior 56 JVM/26 Android evidence retains its original synthetic/emulator scope.
- Runtime: explicit closed state observed, not live accepted.
- Access: owner-only gap remains open. Real phone version/upgrade retention, current quotes/PCR/ladder, reconnect and performance remain open.
- Next independent reversible work: a small deterministic Today capsule using only already validated read-only market observations, exact comparison baselines and honest partial/unavailable states. Do not require unavailable news/RAG to render supported facts, infer a market cause from day change, or block all engineering on a closed session.
- Preserve the installed stable app. Build/verify engineering increments without a user APK per parameter; publish only a bounded combined milestone after relevant checks, with unresolved phone/live/access gates stated accurately.

No production deployment/restart/configuration, database writes, new infrastructure/broker socket, trade authority or Telegram sends occurred.
