# Market Capsule — owner login and app-first migration

Decision checkpoint: 2026-11-06. Single owner use; future Android app is the primary experience. Preserve the working phone APK, keep the existing web dashboard as a fallback until acceptance is proven. No broker/order permissions at this stage.

## Audit findings, not assumptions

- Current Android `MarketRepository.kt` GET requests and `SnapshotStream.kt` SSE stream use HTTPS but do not attach an owner user-login credential. UI already names the 401/403 `APP_AUTHENTICATION_REQUIRED` state, but a complete native sign-in flow is **not implemented**.
- `research-router.ts` registers `mountDashboardLiveRoutes`. The inspected handlers in `dashboard-live-http.ts` show no route-local owner authentication checks; investigate whether upstream middleware or external proxy protects them before claiming a public exposure. Never assume that a dashboard login is also a broker login or authenticates these routes.
- A server-side Kite session, Kite API key, or research-admin token is **not an Android owner-login key**, and must not be placed in an APK, QR code, deeplink, source code or local app settings.
- Existing app read-only scope is NIFTY/SENSEX live snapshot, one-expiry native strike premium ladder, and local last-snapshot memory. All-in-app recorded replay, full PCR/OI, RAG, order flow remain incomplete.

## Chosen login architecture

One personal **OptionPilot owner identity**, shared between website and Android. The app uses a standard secure system-browser authorization flow (OAuth 2.0 Authorization Code + PKCE if an OAuth provider is selected; otherwise a carefully audited equivalent server-side challenge-response/passkey flow). Never embed login pages or secrets in a WebView. On Android use Credential Manager for passkeys/credential sign-in when available; optional device biometric/PIN unlock after server authentication is **only a local privacy lock**, never a substitute for API access authorization.

The backend must verify every protected HTTP request and SSE session. Use short-lived, scoped access authorization; refresh-session rotation, explicit revoke-all-device option, bounded retry/rate limits, inactivity timeout, and tamper-resistant server-side authorization checks. Tokens/refresh secrets must be stored with Android Keystore-backed encryption where appropriate, never copied into logcat, diagnostics or unencrypted local snapshots. Use TLS. Do not let login failure promote stale market data to LIVE. 401/403 closes the SSE connection, clears sensitive session state and presents **Sign in** (not an endless reconnect loop).

Initial permission is `MARKET_READ` only. Account/profile, broker login handoff, research, Telegram management, and future manual order placement require independent verified scopes and user confirmation. Server-side Kite brokerage credential renewal remains an independent login and must follow broker rules (often daily); OptionPilot owner login cannot automatically renew Kite tokens or grant order execution.

## Strict release sequencing

1. **Access control first**: inventory dashboard's actual login mechanism; confirm whether all live REST/SSE/read-only research paths are protected upstream; design the isolated `/api/mobile/v1` interface. Write server unit/integration tests proving no-auth requests receive 401 without blocking the existing web dashboard. Do **not** enable new protection on live endpoints until authorized migration and rollback is tested.
2. **Owner account**: implement real server auth, recovery and revocation. Preferred lowest-maintenance route is a standards-based identity provider already supported by the stack; avoid building a bespoke password database. Require at least one fallback recovery mechanism before first sign-in. Obtain owner approval for identity provider and identifier.
3. **Mobile login**: native login screen, browser-backed secure sign-in, per-request authorization, SSE auth, token refresh, biometric local re-entry, logout, offline read-only cache with explicit SAVED/NOT LIVE, device/session revoke states.
4. **Acceptance**: automated 401/403/refresh/clock-skew/revocation/account-isolation tests and a real Android phone login/reconnect/logout test. Validate existing dashboard stays functional. No trade/admin permissions or broker key leaves server.
5. **Stable installation**: owner-managed release signing and GitHub/Obtainium update checks. Prove first and second signed APK upgrade without uninstall or local data loss.
6. **App-first feature parity**: priority NIFTY/SENSEX live desk → full PCR & OI ladders → recorded-session replay on the app screen → context/RAG evidence → Telegram & options management. Keep calculations, broker auth and sensitive stores in the existing backend (hosting location can later change independently).
7. **Gradual dashboard retirement**: run web and app in parallel while comparing exact read-only data and all critical flows for several real market sessions. Turn website into emergency/admin fallback only after mobile parity, stable release/update, network outage and security controls pass. Do not delete dashboard or backend prematurely.

## Required security/UX release gates

- One OptionPilot identity; dashboard and Android can sign in, but neither embeds the literal dashboard passphrase/key in the APK.
- Every protected API/SSE returns 401 without a valid owner session; account/rate limiting, token renewal and logout work.
- Compromised/lost phone can be remotely deauthorized, and new phone recovery does not depend on the lost device.
- No app-level owner session grants Kite brokerage rights or automatic orders.
- Current 0.1.5/0.1.7 debug installations unaffected by design-only changes. Permanent stable package continues to use the chosen signing identity.
- Live premiums/PCR are sourced and calculated server side, with the same age/identity verification as desktop. Local offline saved quote is always marked historical.
- CI and emulator success do **not** replace real-phone owner acceptance.
- Explicit approval is required before modifying production login behavior or deprecating web dashboard.

Owner's open decision before coding login service: use an existing verified personal identity provider (Google account/passkey) versus independent owner credential plus recovery. The decision concerns identity provider, **not** the signing key, Kite Connect API key or Play Console status. The app can remain privately distributed without a Play Console.
