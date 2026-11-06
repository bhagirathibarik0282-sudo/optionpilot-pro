# Free Android updates — signed release pipeline + Obtainium

**Decision:** No Play Console account and no pay-per-build service. Native Android Market Capsule remains the app. Free GitHub Releases + Obtainium are preferred to inventing a risky in-app APK installer.

## Why the existing debug APK cannot just take new releases

Previous CI APKs were signed by ephemeral debug certificates. Android enforces matching package ID and signer (or validated key rotation) for updates. The old signing *private key* is not recoverable from an APK. We must not promise an in-place update of these debug builds.

**One-time safe migration:** Build a permanent, owner-key signed release using package ID \`com.marketcapsule.app.stable\`. It installs **alongside** the earlier debug ID \`com.marketcapsule.app\`; leave the working debug app installed until the new version passes real-phone checks. Saved data is separate between the two apps, not migrated automatically; the debug app has \`allowBackup=false\`. Once stable is trusted, remove the old one only if the owner chooses.

The release label is **Market Capsule Stable**, to distinguish it from the existing debug icon. Its \`versionCode\` must increase for every subsequent stable version. The same signing keystore must be reused forever, backed up privately.

## Architecture / experience

- GitHub feature-branch development → existing unit/lint/emulator CI (no phone rollout per commit).
- Owner explicitly dispatches **Market Capsule Stable APK (owner-approved)**, entering an exact tag and optional publish=true.
- Job checks tests, Android emulator, release package ID, non-debuggable APK, exact version, \`apksigner\` and the expected stable signing certificate fingerprint. If any fail, **nothing is published**.
- Owner-approved **public** GitHub Release publishes a single deterministic \`Market-Capsule-Stable.apk\` plus SHA-256 checksum. Public GitHub Release assets are public; do not use this flow for private/customer-sensitive binaries.
- On Android install **Obtainium** once from its official source, add repository \`https://github.com/bhagirathibarik0282-sudo/optionpilot-pro\`, and configure GitHub release tag filter \`capsule-v\` / asset name filter \`Market-Capsule-Stable.apk\`. Download the **first stable app via Obtainium**, not the old Actions debug artifact, so it can track future releases.
- Obtainium can monitor releases and install updates. Silent/background installation is **conditional** (Android version, package target, origin installer, user settings and one APK match), not a guarantee. The Android installer may still require approval; never claim an arbitrary APK can silently replace an existing package.
- The app continues receiving current market quotes from the existing read-only service without APK updates; only genuine native-code release milestones get a new APK.

## Owner-only signing steps (no private keys or passwords in chat)

1. Generate one **release** keystore with Android Studio on an owner-controlled machine: Build → Generate Signed Bundle/APK → Create new. Back it up offline with its passwords. Do not add it to Git.
2. In GitHub repository Settings → Environments create \`market-capsule-stable-release\` and require reviewer approval if available. Restrict permitted branches. GitHub Actions runs need the owner's explicit approval and should never run on untrusted pull requests.
3. Set environment secrets \`MC_RELEASE_KEYSTORE_B64\` (base64-encoded bytes of the private keystore), \`MC_RELEASE_STORE_PASSWORD\`, \`MC_RELEASE_KEY_ALIAS\`, \`MC_RELEASE_KEY_PASSWORD\`. Base64 is **not encryption**; use GitHub **secrets**, not repository files or public variables. NEVER send them in ChatGPT, a PR, issue, or Actions logs.
4. Set environment **variable** \`MC_RELEASE_CERT_SHA256\` to the exact owner public signing certificate SHA-256 fingerprint (retrieved from Android Studio/keytool). The workflow fails closed if missing or mismatched.
5. Open GitHub Actions → **Market Capsule Stable APK (owner-approved)** → Run workflow; select \`feature/market-capsule-android\`; enter matching \`capsule-vX.Y.Z\`. Run with \`publish=false\` to validate. Publish a public release only after permission/owner decision and successful checks.
6. Install first stable APK via Obtainium from the GitHub release. Confirm it launches alongside current app and supports source-backed updates, NIFTY/SENSEX switch, manual strike load, reconnect, stale suppression, and smooth on-device UI. Only afterward consider uninstalling old debug APK.
7. Publish a later stable APK with a higher \`versionCode\` but the **same key** and confirm Obtainium's upgrade preserves installed app data. This is the final release-update acceptance gate.

### Security and safety

- This repo is public. GitHub Releases will expose the APK to anyone. APK must not contain private broker credentials or runtime secrets.
- This workflow is **manual only**; mere GitHub commits do not publish apps. It is mirrored on default \`main\` only to make GitHub's manual Run workflow available, while the job will run **only** for branch \`feature/market-capsule-android\`.
- The repository already has fail-closed \`assembleRelease\` signing. This pipeline does not create, know, or recover the owner's private key and cannot produce a signed stable APK until the owner configures the protected signing secrets.
- Keep production Railway, broker tokens, order execution, dashboard and existing phone APK unchanged throughout preparation.
- From 2027, Android developer verification expands globally; consider the **free Android Developer Console limited-distribution registration for up to 20 devices** if it suits the user's own-device use, independently of Play Console. Check current Google requirements before rollout.
