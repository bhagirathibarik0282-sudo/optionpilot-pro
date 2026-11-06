# Market Capsule — permanent installation and low-friction updates

Decision checkpoint: 2026-11-06. Project: native Kotlin/Compose Market Capsule in `market-capsule-android/`, not the web dashboard. The user has reported the APK working on their phone, and does **not** want a new download/reinstall for every code commit.

## User-facing contract

- **One permanent installation, future updates through Google Play** is the primary delivery design. Ship to a Play Console **internal testing** track first, not a public listing.
- A GitHub PR, CI build, or feature branch commit is **not** a user release. Keep the installed version working. Publish milestone updates only after all gates pass.
- Play Store auto-updates are controlled by the phone's app-update preferences and network availability. They are not instant or forced. In-app Play Core flexible update prompt is an optional later enhancement, not a prerequisite for automatic Play Store updates.
- Live quote values, expiry lists, state labels and eligible source-backed market data already refresh through the read-only backend; they do **not** require a new APK. Native Compose code, new screens, permissions and dependencies **do** require a new app version, but the Play Store delivers it.
- Never claim that direct GitHub APK downloads can install silently. Any non-Play self-updater requires Android installation approval and reliable same-key signing.

## Root cause of current update friction

Current workflow `.github/workflows/market-capsule-android.yml` generates `app-debug.apk` on ephemeral CI runners. Debug signing certificates can differ across builds. Android won't install a replacement with the same application ID unless signing identities are compatible. Current Gradle config has a separate, fail-closed owner-key **release** signing path, but there is no Play Console enrollment, Play-distribution workflow, or confirmed stable release key in the repository. Do **not** use debug CI artifacts as the permanent distribution channel.

## Strict priority implementation

1. **Hold existing phone APK unchanged**: do not uninstall it, wipe its saved readings, or require test downloads per feature. Retain GitHub debug artifacts for engineering QA only.
2. **Choose permanent Play package ID once** before first upload. Because the existing test APK is debug-signed, prefer a distinct permanent app ID for the Play distribution if parallel installation is desired: both old and new apps can coexist while the user verifies the new one. If the original ID is kept, a one-time remove/reinstall is generally required when the signing key differs; old local app data is lost (the current manifest has `allowBackup=false`). Never claim an automatic in-place migration.
3. **Owner-controlled Play Console**: owner must register/access Google Play Console and create a private/internal test track; authorized tester Google account opts in. This requires the owner's action; not yet complete.
4. **Stable signing**: use Google Play App Signing for distributed installs. Create and back up an **upload key**, keep it outside GitHub source/chat, configure it privately for controlled AAB release builds. Never store an unrestricted signing secret or signed private APK as a public GitHub artifact.
5. **Separate engineering CI from release**: debug build/unit/emulator tests on commits; manually approved, milestone-only release workflow signs AAB and sends to the internal track only when the owner supplies credentials and all acceptance gates pass. No automatic shipping of every commit; no direct Play production rollout.
6. **Release acceptance**: monotonic `versionCode`, static app ID, matching Play signing certificate, compile/unit/lint/emulator success, real phone install/reconnect/smoothness test, preservation of new installed app's data across a Play-delivered update. Confirm Play Store auto-update preference and no forced reinstall.
7. **Only then P3** PCR/OI ranking and other new native features. Prefer server-validated read-only data contracts and reuse of existing Compose components. Keep broker credentials, trading authority, Telegram and Railway production untouched.

## Open, owner-only dependencies

- Does the owner have a Google Play Console developer account?
- Is parallel side-by-side migration preferred, or one-time replace with old debug cache reset?
- Owner-secured signing/upload key and Play Console app configuration; these have NOT been provisioned.
- Real-device confirmation of two successive Play-delivered versions.

## Forbidden shortcuts

- Do **not** promise silent self-installation from GitHub, change the signer for each new release, expose signing keys/Play credentials, or tell the user to uninstall a working app just for code review.
- Do **not** automatically install remote executable code or treat server-driven market content as a substitute for Android runtime permission/release reviews.
- Do **not** market a successful CI APK test as Play auto-update acceptance.
