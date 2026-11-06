# Market Capsule delivery ledger

Priority: P0. Independent native Android app inside the existing OptionPilot project.
Easy, smooth UI first. No new Railway infrastructure. Manual trading is deferred.

| Stage | Evidence | Status |
|---|---|---|
| First debug APK | GitHub run 42081701401: 9 unit tests, lint and packaging passed | Complete for 0.1 foundation |
| Offline Android acceptance | Six instrumented tests added; Android 15 emulator workflow | Running; results not yet accepted |
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
