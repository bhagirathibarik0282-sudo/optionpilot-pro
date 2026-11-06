# Market Capsule delivery ledger

Priority: P0. Independent native Android app inside the existing OptionPilot project.
Easy, smooth UI first. No new Railway infrastructure. Manual trading is deferred.

| Stage | Evidence | Status |
|---|---|---|
| First debug APK | GitHub run 42081701401: 9 unit tests, lint and packaging passed | Complete for 0.1 foundation |
| Offline Android acceptance | Run 42143672310: 6 instrumented tests, 0 failures/errors/skips on Android 15 | Tests passed; 0.1.1 follow-up 42144918320 now fully green |
| Device performance | Physical phone, font scale, orientation and measured frame timing | Pending |
| Live slice | Existing source inspected; mobile authentication and current-session observation | Pending |
| Continuous stream/recovery | Existing SSE identified; current app uses manual refresh | Pending |
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
