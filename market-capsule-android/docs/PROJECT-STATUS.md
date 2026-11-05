# Priority and delivery ledger

Priority: P0 / Market Capsule first.
Scope: independent Android app using existing OptionPilot backend; no new Railway service, database or broker socket.
User accepts small clearly disclosed delay in extreme cases, not false live data.

| Stage | Evidence | Status |
|---|---|---|
| Production interface inspection | Runtime status, snapshot identity/quality, exact option pair and existing SSE routes read | Bounded source inspection complete; payload/auth live acceptance pending |
| Native foundation | Local screens, cache, manual read adapter and model tests written | Source prepared |
| Build | Android SDK/Gradle unavailable; distribution acquisition blocked | Not compiled |
| Device acceptance | No APK generated | Pending |
| Full capsule/news/history/AI | Existing evidence modules identified; mobile integration not complete | Pending |
| Continuous stream/recovery | Existing SSE route identified | Pending |
| Telegram/push | Existing sender exists; capsule delivery integration not verified | Pending |
| Manual trading | User requested future feature | Deferred; no execution enabled |

Next step: obtain an Android-capable build execution environment, run the supplied tests/build/lint, then audit mobile authentication and verify the first data screen on-device. Never label source preparation as a completed app.

## UI source review follow-up

Three source-level issues were corrected after easy/smooth UI became the explicit priority:

- Runtime/snapshot JSON parsing now runs on Dispatchers.Default instead of resuming CPU parsing on the UI thread.
- The local age timer starts/stops with the visible lifecycle, with immediate age reconciliation on return.
- The selected navigation tab uses rememberSaveable for activity recreation.

These are uncompiled source corrections, not measured performance results. Continuous streaming, stable full-ladder behavior, complete state restoration and real-device performance remain pending.
