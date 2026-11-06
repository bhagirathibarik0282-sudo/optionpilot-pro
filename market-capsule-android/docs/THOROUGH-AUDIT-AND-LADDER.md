# Audit and native expiry ladder checkpoint — 6 November 2026

## Accepted 0.1.4 audit

Source: 23d3237ac416c2e3a3a1b33bfd82a3deb6d0f0b7.
Run: https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42154680495

29 unit +15 Android tests passed. Six regression assertions fail on the original
parser and pass after correction: receipt aging/chronology, real non-past expiry
dates and duplicate index detection. Original 0.1.3 binary hash and signer were
checked; it launched on an offline Android 15 emulator. Actual cache force-stop /
restart, corrupt/oversized cache, landscape and 150% font captures were checked.
No active default network at seven audit stages. Lint: 0 errors, 13 warnings.

APK SHA-256: 93e38063b2ccc9781c06ee80bcc24db8f1aaea55ea3e459c0e6e261ee3ddbb5b.
Debug signing keys differ across builds; stable signing remains unresolved.
Debuggable/test-host manifest is not Play ready. Phone smoothness is unmeasured.

Earlier outside-hours/outage statements in the historical ledger are superseded:
the existing endpoint supplied current broker snapshots during the session on
6 November, and an eight-second SSE observation at 10:27 IST yielded three
complete connected frames with increasing sequences and three expiry rows for
each primary index. This is contract reachability, not Android live acceptance.

## 0.1.5 native ladder candidate

Source: e9cef39fc318eb31131e70406618511d2bc5223d.
Run: https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42165422354

Live Desk now shows up to three vertical ATM expiry cards with CE/PE cells,
premium, previous-close percentage, eligibility and observation time. The optional
parser validates role/index/side/strike/expiry and independent source/receipt age.
Delivery and monotonic elapsed time revoke old values. Duplicate groups or expiry
rows withhold that panel; a bad panel does not drop valid spot data. The server's
ATM choice can move; cross-snapshot fixed-contract returns are not inferred.

The run above completed SUCCESS: 35 JVM and 17 Android 15 tests, zero failures,
errors or skips. Lint: zero errors, 13 warnings. APK signature verified, archive
digests matched GitHub, offline-launch screenshot reviewed. Three network stages
showed no active default network. Cold launch: 3,089 ms on the emulator only.
APK SHA-256: 9d124622965fccb33f5a6f35ee63b736b9050120c142552e1b42e1be2bced6f4.
The ladder UI is tested with synthetic fixtures; real-phone live acceptance remains
open. No backend deployment,
PR, merge, new infrastructure, Telegram send or trade execution.

Next: physical-phone live/reconnect acceptance and stable signing, then full strike
ladder/expiry picker, freshness-aware PCR and same-app replay. RAG/news/capsules and
existing Telegram integration still need end-to-end evidence.
