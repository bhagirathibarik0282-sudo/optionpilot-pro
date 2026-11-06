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

## Native navigation usability candidate — 6 November 2026

Each bottom destination now owns an independently saved list position. Reading a
long Live Desk no longer carries its offset into Today, Memory or Project; returning
to a destination restores its own reading position. The strike-ladder header uses
the same weighted columns as its price rows instead of spacing with literal spaces,
so alignment follows available screen width and font sizing.

An instrumented regression covers scrolling Today and Live Desk, opening Memory
at the top, and returning to each prior position. These changes are source-ready;
Android CI/emulator validation is required before delivery. Local Gradle bootstrap
was blocked by unavailable network access to the distribution host. No new APK,
phone smoothness, live-market or production-readiness acceptance is claimed here.


## Navigation candidate accepted in CI — 6 November 2026

Source a0afb809e68693c47ab4229d8c6ae9326e10bf06; run https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42257837554 SUCCESS. Downloaded XML reports: 42 JVM tests plus 21 Android 15 tests, zero failures, errors or skips. Lint: zero errors, 14 warnings. The new test checks independent tab offsets, initial top position, returning to the prior heading and exact Live Desk scroll offset. Earlier attempts failed that same heading check; isolating the list composition and binding content to the captured destination resolved it without removing the assertion.

APK assembly, v2 debug signature verification and offline cold launch passed. The actual offline screenshot was reviewed. Downloaded APK and validation archive SHA-256 matched GitHub artifact digests. APK: 17,858,629 bytes, SHA-256 c2db8555cc9bfbffaae7d48d8cd5f0f6277469e917fba51509165c887c99a967. Signer SHA-256 e98ed6cb54eaa517aa746cdf4ca6b9d8abe634520b1fad6ee8aa4f6dca0d6b4d.

Market_Capsule_0.1.8_Navigation_Test.apk is a debug test candidate, versionCode 9, not a stable upgrade or Play release. Its temporary signer can prevent installing over previous builds; do not remove a working phone installation to force an update. Physical-phone smoothness, stable signing, owner authentication and live-session/reconnect acceptance remain pending. No backend, Railway deployment, broker connection, Telegram sending or order behavior was changed in this navigation milestone.


## Manual foreground lifecycle accepted — Android 0.1.9, 6 November 2026

Source 7771948e61b0d992e0dbd8da580ad52545a4df9c; run https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42260352577 SUCCESS. Backgrounding now cancels manual refresh, withholds the current snapshot/strike panel, clears pending loading and replaces the requesting message with an explicit background state. Last saved data remains historical. Manual requests are rejected while backgrounded, and foreground return requires a new manual read unless ongoing updates were already wanted. A cancellation check precedes applying a returned manual snapshot.

Downloaded XML: 42 JVM tests plus 23 Android 15 tests, zero failures/errors/skips. Two new synthetic-source controller tests cover background request rejection, historical retention, withholding the previous current snapshot after return, cancellation cleanup and successful subsequent refresh. Existing stream/reconnect, scroll and offline activity tests also passed. These are bounded emulator/controller checks, not a new real-phone or live-market acceptance.

Lint: zero errors, 14 warnings. APK v2 signature verified with one debug signer; actual offline screenshot inspected. Both downloaded artifact hashes matched GitHub. APK 17,858,629 bytes, SHA-256 aaff585cb31b2f7b6a28c9e8a6df84dfcb655e0e5f9a5acedda88e2a09cb0da6; debug signer SHA-256 d742b62c4cf52acc94826ca40fa336947a3761b2c445f91e4427552faf641df4. VersionCode 10 / versionName 0.1.9. Delivered as Market_Capsule_0.1.9_Lifecycle_Test.apk. The signer differs from 0.1.8, so a direct upgrade may fail; preserve the working phone installation.

Remaining: owner-controlled stable signing and same-key phone upgrade, owner authentication policy, physical-phone live/reconnect/performance acceptance, qualified PCR/OI and replay/capsules. No production deployment, infrastructure, broker credential, Telegram delivery or order changes occurred in this milestone.


## Phone observation and independent backend check — 7 November 2026 IST

The owner confirmed installation/opening of Market Capsule Stable 0.1.9. The supplied phone screenshot shows Live Desk and SENSEX selected. This proves those visible states only; full navigation, current market data, phone performance and same-key upgrade acceptance are not inferred from a static screenshot.

Read-only Railway identity check verified courteous-perception / production / optionpilot-pro-v2, service 030df1c1-24b3-45ec-b2ba-d0798a91e0bb, deployment 64bb261a-18e9-4f67-af4e-70ba1d8a61bf SUCCESS, no staged changes. Direct app-host reads returned runtime HTTP 200 with tradingDate 2026-11-07, scheduled=false, shouldRun=false, running=false and ready=false, hours 08:45–16:15 IST. Snapshot HTTP 503 explicitly returned OUTSIDE_OPERATING_HOURS. This establishes scheduled closure in this observation, not a fresh market-data failure or an authentication failure. No infrastructure, hours or broker changes were made.

A separate source-confirmed UI defect left the background-pause message visible after manual-mode foreground return. Source 643df208574efad19b713b5ed2eb5ce2c894ba75 clears that message on return, preserves historical-only readings and makes no automatic fetch. A new controller regression covers cold start, background/foreground, repeated return and zero network requests. Run https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42292905793 SUCCESS: unit/lint/package checks and 24 Android emulator tests passed. This is source/CI acceptance; the installed 0.1.9 stable APK has not changed. Include this fix in a future same-key release with an increased versionCode/versionName before any stable publication. No new debug APK was offered as an upgrade to the stable phone app.
