# Market Capsule — Android foundation 0.1

Highest-priority OptionPilot project. This is **native Android source**, not the existing dashboard wrapped in a WebView. It is **not a compiled/tested APK** and not a completed super app.

## Implemented in source

- Independently installed Compose screens with Today, Live Desk, Memory and Project navigation.
- NIFTY/SENSEX selection; read-only manual snapshot refresh.
- Existing runtime-status and market snapshot endpoint adapter; no broker/API secrets in the app.
- Explicit no-data, outside-hours, network, authentication-required and viewer-limit handling.
- Exact spot/option identity and timestamp checks; unavailable values remain null.
- Rejection of backwards responses; local elapsed-time expiry of recent-snapshot status.
- Atomic private local snapshot cache; saved readings are shown only as saved, never live.
- Pending features are labelled honestly. No fabricated news, AI answers, probabilities, orders or notifications.

## Not implemented / not accepted

- Mobile account authentication: server-wide auth still needs end-to-end audit. A 401/403 is surfaced; users must not paste admin or broker secrets.
- Continuous SSE, persistent event cursors, reconnect reconciliation and adaptive streaming.
- Full premium ladder, server capsule contract, news/RAG, session replay, AI questions, push/Telegram integration.
- Signing, physical-device acceptance, Play Console setup and Play publishing.
- Manual Buy/Sell is deferred until app/data reliability is established. No order code exists.

## Toolchain

Pinned baseline: JDK 17, Gradle 8.13, Android Gradle Plugin 8.13.2, Kotlin/Compose compiler plugin 2.2.21, Android SDK 36, min Android 8/API 26. This uses pinned previously published versions, not a claim of newest versions.

Import into Android Studio with SDK 36 and configure Gradle 8.13. The standard Gradle 8.13 wrapper is bundled from the official Gradle repository; its JAR and distribution checksums are pinned to Gradle's published checksums.

Build checks required in an Android-capable environment:

- `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`
- Install the signed debug build on a real phone; exercise offline cold start, no cache, runtime closed, expired auth, stale/foreign/duplicate data, refresh timeout and index changes.
- Network fixtures in tests are synthetic and do not certify production freshness.

## Verification actually completed here

- XML resources/manifest parse, Gradle/source layout and endpoint reference inspection.
- Package and manifest identity consistency, bounded network reads, no mutation endpoints or secret configuration.
- Nine JVM test cases are provided but **not executed**.
- Compilation/device tests are **blocked**: this workspace has JDK 17 but no Android SDK or Gradle. Downloading the Gradle distribution was blocked by the current network route. No APK or build success is claimed.

## Integration evidence

The read adapter follows the inspected production sources `dashboard-live-runtime.ts`, `dashboard-live-feed.ts` and `dashboard-live-http.ts` from bhagirathibarik0282-sudo/optionpilot-pro. The app currently performs manual snapshots, not the existing SSE. Freshness checks are conservative and do not modify server policy.

The server may reject private reads until proper mobile authentication is added. Snapshot source timestamps are preserved; end-to-end clock synchronization and latency measurement remain pending. App freshness expiry is a UI observation rule, not a guarantee of feed cadence.

## Next concrete milestone

Compile and execute the supplied tests in an Android toolchain, then prove local launch plus one authenticated production NIFTY snapshot on the user's phone. Do not add broad features or enable trading before that slice works.

## GitHub build

The dedicated Market Capsule Android workflow runs on this feature branch and produces a test APK only after unit tests and lint pass. It has no production deployment or broker/order credentials. A debug APK is for testing and is not a Play release. Ephemeral debug signing may require uninstalling a previous debug build; stable release signing remains a later setup.
