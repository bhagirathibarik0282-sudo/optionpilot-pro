## P2.2 candidate — source-verified read-only strike ladder (0.1.7)

The separate native strike panel uses existing GET `/api/research/dashboard-live/premiums?view=ladder&nearby=7&symbol=<NIFTY|SENSEX>&expiries=<selected-date>`. The backend reads already subscribed Kite FULL in-memory tokens, not new Kite API calls or subscriptions. The user explicitly taps **Load strikes** for one expiry; no automatic polling, no extra stream, no persistence and no backend change.

Each response is required to match exact index, expiry, OPTION side, current India trading date and market runtime; duplicates, oversized answers or cross-index/expiry rows fail closed. The selection is CE | Strike | PE in a vertical panel with ±3/±5/±7 widths. A missing actual ATM strike makes the panel unavailable instead of shifting to an invented anchor. Quote/receipt and phone elapsed age gates revoke stale premiums; missing legs display — and never imply an executable trade. NIFTY/SENSEX selection and feed/runtime disconnection revoke the displayed panel.

No OI, PCR, wall, Greeks, replay or manual order authority is added by this phase. Unit/UI tests and real-phone installation remain release gates. The previously working 0.1.5 phone install remains untouched, and this candidate is not a Play release.

## Candidate — 0.1.6 expiry selection (unreleased)

One native Live Desk feature only: an All (up to three source-reported ATM expiries) / exact-expiry selector in a two-column, vertically stacked chip grid. This uses only existing validated `atmExpiryLadder` pairs; no extra broker/backend requests and no guessed neighbouring strikes. Changing NIFTY/SENSEX resets the chosen expiry; invalidated expiries fall back to All. Independent premium freshness checks remain unchanged.

Source change requires GitHub Android CI (unit, lint, emulator UI and package) before acceptance. The user's installed 0.1.5 debug APK remains the known-good phone build. A new ephemeral debug signer may prevent in-place installation; do not uninstall the working version for this candidate. Stable private release signing and same-signer upgrade still require owner-controlled key and phone proof. No production deployment, trade authority or broker mutation.

# Market Capsule delivery ledger

## Current checkpoint — 0.1.5, 6 November 2026

This supersedes the historical pending live-contract/cache notes below. APK audit
0.1.4 passed 29 unit +15 Android tests with actual persisted-cache force-stop /
restart, offline network verification, landscape and 150% font captures.

0.1.5 source e9cef39fc318eb31131e70406618511d2bc5223d adds native vertical
multi-expiry ATM CE/PE cards to Live Desk. Run 42165422354 SUCCESS: 35 unit +17
Android 15 tests, zero failures/errors/skips. Signature and archive digests checked;
actual empty offline screenshot reviewed. Lint: 0 errors, 13 warnings.

APK SHA-256: 9d124622965fccb33f5a6f35ee63b736b9050120c142552e1b42e1be2bced6f4.
The actual production SSE contract was accessible in a bounded read at 10:27 IST,
with increasing sequences and three primary-index expiry rows. Actual APK phone
live/reconnect acceptance remains pending, along with stable signing/private access,
full strike ladders, PCR, replay and news/RAG/capsules/notification integration.
See THOROUGH-AUDIT-AND-LADDER.md for scope and evidence.

Priority: P0. Independent native Android app inside the existing OptionPilot project.
Easy, smooth UI first. No new Railway infrastructure. Manual trading is deferred.

| Stage | Evidence | Status |
|---|---|---|
| First debug APK | GitHub run 42081701401: 9 unit tests, lint and packaging passed | Complete for 0.1 foundation |
| Offline Android acceptance | Run 42143672310: 6 instrumented tests, 0 failures/errors/skips on Android 15 | Tests passed; 0.1.1 follow-up 42144918320 now fully green |
| Device performance | Physical phone, font scale, orientation and measured frame timing | Pending |
| Live slice | Existing source inspected; mobile authentication and current-session observation | Pending |
| Continuous stream/recovery | Opt-in foreground SSE/reconnect implemented and fixture-tested in 0.1.3 | Real production session pending |
| Full capsules, ladder, replay, RAG and notifications | Mobile integration | Pending |
| Play release | Release signing, privacy, mobile sign-in, acceptance | Pending |

The emulator suite covers actual activity launch with Wi-Fi/mobile data disabled,
manual refresh completion without a qualified quote, tab restoration after recreation,
all navigation tabs, index identity isolation, saved-data labels, expiry of eligibility,
UI state recovery and refresh disabling while a request is pending.

Synthetic UI fixtures are confined to androidTest. They do not demonstrate network
reconnection, persisted cache across process death, market-data correctness, measured
latency or smoothness on the user's phone. The actual activity test uses the real app
with no fixture data and no credentials. The workflow leaves the backend unchanged.

Official implementation references:
- https://developer.android.com/develop/ui/compose/testing
- https://developer.android.com/studio/run/emulator-commandline

## Accepted evidence — 6 November 2026

Source commit: `a6fb80452791898b9477b668b821962c0209e9c5`.
Run: https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42143672310
JUnit XML: 9 JVM tests and 6 device tests; zero failures, errors or skipped tests.
The device suite completed in 29.072 seconds; this is test duration, not app startup latency.

The whole workflow failed **after** the successful suite because connected Android
instrumentation removed the app and the subsequent screenshot step attempted to clear
an uninstalled package. Commit `1d096dc897d24df273e00955ee9ab7a28277e59c`
reinstalls the APK before capturing. Its run 42144918320 is queued at this checkpoint.
No new 0.1.1 APK or screenshot is accepted for delivery yet. The previously delivered
0.1 APK remains the last delivered installable build. Do not mark the latest delivery
pipeline green until the queued run completes and its artifact is inspected.

CI startup fixes also made platform-tools explicit, shared the AVD directory between
SDK tools and emulator, and bounded diagnostics. No runtime backend changes occurred.

## Delivery-age candidate accepted — 6 November 2026

Source e4defc4bf5ea4c1f5837b6320c876cd7552c8774, version 0.1.2-delivery-age,
versionCode 3. Full run 42146441214 SUCCESS, including offline capture and APK upload.
JUnit XML: 15 unit tests and 7 Android 15 tests; zero failures/errors/skips.
Lint: zero errors, 12 warnings; release-readiness is not certified.
APK and evidence ZIP SHA-256 match GitHub artifact digests. APK archive integrity,
manifest and DEX presence checked; actual offline screenshot visually inspected.

The new reader budgets transit/decode time and envelope age before qualifying spot
and premium values. Six new unit cases and one Android leg-aging case passed.
Connection audit is in CONNECTION-ACCEPTANCE.md: inspected read mounts do not require
browser Kite login; live credential-free observation was scheduled closure, not a
401/403. During-hours current NIFTY data, private app access policy, stable release
signing, physical-phone performance and persistent-cache restart remain pending.
No Railway deployment, PR, merge, new infrastructure, login bypass or order change.

## Foreground updates accepted in tests — 0.1.3

Full workflow 42148706936 SUCCESS for source 68ea29b4dd482e39b1510fd844fcfc62a7ab20cd. 23 unit + 12 Android tests passed, zero failures/errors/skips; APK/offline capture verified. Details and bounds are in UPDATES-ACCEPTANCE.md. Production runtime remained outside hours. Start updates is OFF by default; real-feed/phone acceptance remains pending. No PR, merge, Railway infrastructure/deployment or order changes.
