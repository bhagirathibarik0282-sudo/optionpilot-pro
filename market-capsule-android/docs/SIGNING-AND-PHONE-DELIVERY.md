# Priority P1 — stable APK signing and phone handoff

Checkpoint: 6 November 2026. This is **native Android Market Capsule**, not the web dashboard. Keep backend, broker credentials, orders and production deployment unchanged.

## Already verified (P0; exact 0.1.5 binary)

- Android CI source commit: `e9cef39fc318eb31131e70406618511d2bc5223d`.
- Tested APK SHA-256: `9d124622965fccb33f5a6f35ee63b736b9050120c142552e1b42e1be2bced6f4`.
- Original build: https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42165422354
- Production-network acceptance on **the same APK**, not a new build: https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42168217248
- Android 15 emulator passed current NIFTY snapshot, advancing server time, SENSEX isolation, native multi-expiry card, network-loss withdrawal and automatic recovery. The success evidence is in artifact 13480266960.
- Physical handset, frame smoothness, installation/updating and persistent data on the actual user's phone are **not accepted**. Emulator success is not a phone pass.

## Stable signing requirements

Android releases must use a **single long-lived owner-controlled signing key**. A freshly generated CI debug key is only for temporary testing and cannot update an app installed with a different key.

The app Gradle config reads exactly these environment variables at build time:

- `MC_RELEASE_KEYSTORE_PATH` — absolute path to a private keystore file on the build machine;
- `MC_RELEASE_STORE_PASSWORD` — keystore password;
- `MC_RELEASE_KEY_ALIAS` — key alias;
- `MC_RELEASE_KEY_PASSWORD` — alias password.

If any are missing, an explicit `:app:assembleRelease` or `:app:bundleRelease` fails before packaging; an invalid keystore path also fails. Debug builds do not need these variables. Never put the private key, a password, or a base64-encoded keystore into the repository, APK, a public CI log, an issue, this document or the chat.

The owner must generate/store the signing key securely and make a backed-up, offline copy. For a local signing-capable machine, Android Studio's **Build → Generate Signed App Bundle / APK** is a supported UI path. If integrating into CI later, use encrypted repository/environment secrets and an approved **private distribution method**. This is a public GitHub repository: do **not** upload a signed private-use APK as a public artifact before the distribution policy is chosen. A build with a stable signature alone does not constitute a published private release.

## Release acceptance gates

1. Release signing configured from an owner-controlled key; Gradle release build succeeds **without** checking secrets into version control.
2. `apksigner verify --verbose --print-certs` succeeds on the exact release APK and records the expected signer SHA-256 fingerprint (not the password or key).
3. Same application ID and signer fingerprint are maintained between consecutive versions, with monotonically increasing `versionCode`.
4. APK cannot be debugged and is installable and updateable on a real Android phone without uninstalling or wiping previously saved readings.
5. Actual phone: offline cold launch, local saved-reading chronology, online read, advancing NIFTY updates, SENSEX switch, Live Desk premium card, network withdrawal and recovery, stop updates, back/foreground, font scaling and portrait/landscape.
6. Authentication, production data provenance, smoothness and battery/runtime responsiveness are observed and recorded, not inferred from synthetic fixtures.
7. **No order execution**: manual Buy/Sell and broker credentials are deliberately excluded at this stage.

## Immediate user-visible test APK (not a stable release)

Open the original build's **Artifacts → market-capsule-test-apk-e9cef39fc318eb31131e70406618511d2bc5223d** in GitHub while it is retained; download the ZIP, extract `app-debug.apk` and install on the phone. On Android, permit APK installation for the specific trusted file manager only if you trust this build and revoke that permission afterward. Verify its version and SHA-256 if possible. An existing debug build signed with a **different** temporary certificate cannot be upgraded in place; uninstall would lose app-local cache, so do not do that casually. The artifact is retained only seven days; it is **not** a permanent download link.

**Next work:** obtain the actual handset's install, network-reconnect and same-key-update evidence. Do not mark P1 as delivered until those gates pass. Then prioritize native full CE/PE strike ladder and qualified PCR.
