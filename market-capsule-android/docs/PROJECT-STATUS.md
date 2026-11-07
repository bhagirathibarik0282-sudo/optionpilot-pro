# Locked development sequence — 7 November 2026 IST

This checkpoint supersedes older candidate, signing and delivery statements below; historical entries remain intact. The owner wants incremental parameter implementation with a double-check at every step and a combined milestone APK, not a scheduled development task or an APK per parameter.

## Verified released baseline

- Stable 0.1.10 / versionCode 11, package `com.marketcapsule.app.stable`.
- Published source: `3bf9a406439a16d7d52bda6e7c3a4c77bf4bb1e1`; release run [42321096322](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42321096322) succeeded, including unit/lint/build, 26 Android 15 tests, exact package/version/signer verification and publication.
- Native source run 42295462800 independently supplied 56 JVM +26 Android test reports; lint had zero errors and 14 warnings. These do not establish physical-device/live acceptance.
- Released APK SHA256: `e8e01909b27ba2c07ba94c0b74bed8fb1bf8e89032821ed84be9ec8b3e4e2826`, 12,288,517 bytes; downloaded bytes and ZIP integrity verified.
- Owner certificate SHA256: `ba06069dd7406c612913e712542525aa545bdabd7c8743b56a42564014971516`; no private signing material is stored here.
- The owner reports opening the app on the phone. Exact displayed version, upgrade retention, real-feed correctness/reconnect and device performance still need acceptance.
- Daily "Market Capsule App Development" task is disabled at the owner's request. Existing market briefings/PCR audit/research tasks are separate and unchanged.

## Locked capability register and order

"Implemented" means released source exists; it does not mean every live source or device scenario is accepted.

| Order | Parameter family / deliverable | Current boundary | Next double-check |
| --- | --- | --- | --- |
| 0 | Native shell, NIFTY/SENSEX, cache, refresh, foreground stream/reconnect | Implemented; saved data is historical | Offline/foreground/restart, index isolation, cancellation, actual source access and reconnect |
| 0 | Multi-expiry ATM CE/PE, expiry filter, vertical strike ladder | Implemented; strike ladder is loaded explicitly, not continuously updated | Exact index/expiry/strike/side, independent leg age, missing ATM/legs, selection and stale withdrawal |
| 0 | Full/band/reported PCR and CE/PE OI totals | Implemented; full is subscribed inventory; mixed timestamps explicitly labelled | Coverage and arithmetic, source chronology, separate family eligibility; ATM expiry selector does not change PCR expiry |
| 1 | Connection and mobile access audit | Not accepted end to end | Distinguish broker login from app authorization, runtime closure from outage; inspect existing access boundaries without bypassing them |
| 2 | First deterministic Today capsule | Not integrated | Evidence-backed what changed, comparison baseline/time, facts versus inference, contradictions and two supported watch conditions; unknown cause stays unknown |
| 3 | Spot/futures/reference context: previous close/open, PDH/PDL, VWAP and supported pivots | Additional source/consumer mapping required | Source fields and units, reference session, futures identity/roll, basis and VWAP methodology; no invented reference values |
| 4 | VIX and BANKNIFTY context | Not integrated in app; BANKNIFTY research/context only | Separate volatility from direction; independent symbol/session/source eligibility |
| 5 | Sectors/heavyweights and dated FII/DII | Not integrated in app | Returned subset and coverage; verified weights before point contributions; cash/derivative scope, publication/trading date and revisions |
| 6 | Advanced options: OI rank/walls/migration, premium/PCR view controls, expiry scope | Pending beyond released baseline | Fixed-contract/time comparisons, real before/after inventory, ranking/coverage and no full/band substitution |
| 7 | Recorded-session Memory/replay, multi-DTE outcomes and comparable episodes | Saved cache exists; session replay/RAG are not integrated | Available-at cutoff, shared cursor, exact contracts, real candle coverage, gaps/counterexamples and no future leakage |
| 8 | News/history explanations, previous/current/next-session plans | Not integrated | Source publication times, attribution versus inference, supported outcome horizons and actual data coverage |
| 9 | Existing Telegram/push and easier distribution | Future integration, not silently enabled | Shared capsule identity, routing/dedup/recovery; phone notification permissions and distribution setup separately established |

Volume PCR, Greeks/IV and extra history views may be added only when their actual source contract and usefulness are verified; they must not silently broaden an implementation step. Ten-year daily, intraday, option and constituent history are distinct coverage claims, none established by this register.

## Step locking and double-check protocol

1. Read the current source and evidence; identify the smallest missing feature or real defect. Reuse released components.
2. Implement it on the existing Android feature branch. Preserve prior working functionality and persisted-data compatibility; keep the installed 0.1.10 unchanged during engineering.
3. Check source identity, units/calculations, session/expiry/contract and observation chronology. Exercise valid, missing, stale, conflicting and foreign-identity cases where relevant.
4. Run meaningful model/UI regression checks for the changed behavior, including existing navigation/cache/stream functionality. Record the source commit, commands/run IDs and exact results.
5. Re-read the final diff and test evidence independently of the implementation claim. Mark source/test acceptance separately from runtime/phone acceptance. A failed check is unresolved work, not a pass.
6. Continue to the next dependency only after resolving the affected code/test gate. If market/phone evidence cannot be obtained, record it explicitly; do independent reversible work without claiming the blocked gate passed.

The next engineering step is the existing data-flow/access audit (order 1), followed by a small deterministic Today capsule. Do not start by adding every context panel or rebuilding the released ladder.

## Combined APK gate

Development commits are not user releases. No new download is needed for this ledger update. Keep the deliberate release-marker workflow for a bounded, coherent milestone only; never release every parameter or ordinary commit. Before publication, review the cumulative diff, run required unit/lint/emulator checks, verify monotonic versionCode and unchanged package/owner signer, and verify the release checksum. Preserve the previous working release on failure. Do not claim zero risk, silent phone installation or phone/live correctness from CI.

Existing Railway backend, services, database, broker socket, execution authority and Telegram transport remain unchanged. Backend contract gaps require a separately scoped justified change, not an automatic production mutation. No new scheduled task is authorized by this checkpoint.

---

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


## Native PCR/OI candidate — Android 0.1.10, 7 November 2026 IST

Source 1a7be7354bc1fadeddeb54f851943c84298527a5; versionCode 11, versionName 0.1.10. Run https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42295462800 SUCCESS. Downloaded XML reports confirm 56 JVM and 26 Android 15 tests, zero failures/errors/skips; lint zero errors, 14 warnings. Validation archive SHA-256 3463b1d03db012490656a2f8c623da6c589522dc9665540f615f4b5422808ef3 matched GitHub. Existing foreground-message correction is included in this source lineage.

Live Desk now projects the existing pcrSnapshot contract for NIFTY/SENSEX, separately showing verified full-expiry snapshot PCR, ATM +/-7 listed-strike band PCR and current-session latest-reported mixed-timestamp PCR. Each has its own CE/PE OI totals. Zero PE OI remains numeric zero; missing/invalid values remain unavailable. Full refers to the server's subscribed expiry inventory, not an independently proven complete exchange universe. The displayed PCR expiry follows the server-selected index row; the ATM-card expiry filter does not change it. No new HTTP request, broker subscription, order authority or production deployment was added.

Validation checks source identity, exact parent expiry/session, coverage, totals/ratio arithmetic, source chronology and independent family eligibility. Full snapshot source spread/age at measurement is at most 30 seconds and collection duration at most 60 seconds. The existing server sampler's 90-second completed-snapshot window is budgeted with delivery and monotonic phone age; it is separate from the spot-price clock. Latest-reported PCR can retain older same-session OI only under its explicit mixed-timestamp label, never as fresh/synchronized PCR. A valid band does not substitute for incomplete full inventory. Disagreeing totals from the same full/reported attempt are withheld. Saved snapshots and disconnections cannot promote PCR to current, and malformed optional PCR cannot remove a good spot quote.

Fourteen new JVM tests cover calculations, zero/invalid/missing inputs, optional-panel isolation, identity/date, source/receipt age, contradictory totals, reported context and band membership. Two new synthetic Android UI tests cover separate labels, no reported-to-verified substitution, expiry withdrawal, index isolation and saved-cache non-promotion. Production source contract was inspected, including its separate lastReportedPcr field; prior-session last-reported context, volume PCR, BANKNIFTY app context, PCR expiry controls, OI rankings/walls and historical PCR charts are not part of this increment.

Acceptance boundary: this is compiled source/emulator acceptance using synthetic PCR states. Current phone/live-session PCR and smoothness remain unverified. The installed public stable 0.1.9 is unchanged. Do not install an ephemeral debug CI APK over it. The next owner-signed stable workflow will derive capsule-v0.1.10 automatically; use the existing protected key and verify the same certificate/package before publication and a phone upgrade/data-retention check.


## Data-flow/access audit checkpoint — 7 November 2026 IST

Bounded audit completed against released Android source 3bf9a406439a16d7d52bda6e7c3a4c77bf4bb1e1 and Railway deployment metadata-confirmed backend source b60d136524259cc1970b1f1d05d808a3cb0192cf. See [DATA-FLOW-ACCESS-AUDIT-2026-11-07.md](DATA-FLOW-ACCESS-AUDIT-2026-11-07.md) for the route/parser/state map, exact observations and limits.

Source identity/time/expiry, independent PCR clocks, saved-state withholding, explicit ladder loading and bounded foreground reconnect controls were inspected. No new reproducible Android defect was established, so no speculative code patch or APK was made. Three credential-free GETs around07:05 IST returned runtime200 with shouldRun=false and snapshot/premium503 OUTSIDE_OPERATING_HOURS. This is closed-runtime evidence, not live feed acceptance.

Concrete access gap: inspected GET mounts have no owner-specific mobile session enforcement; Kite browser broker login does not supply that boundary. Owner-only access, current live phone data/reconnect and device performance remain unresolved. Production was not changed. Next independent implementation: deterministic Today capsule on already validated read-only observations, preserving these acceptance limits and no unsupported causes.


## Deterministic Today capsule — engineering candidate, 7 November 2026 IST

A native Today projection now reuses existing spot/PCR family eligibility. Day change is explicitly versus broker previous close, never movement since the last refresh or a cause. Verified full, ATM +/-7 band and latest-reported mixed-time PCR retain separate labels and exact PCR expiry. Two deterministic watch conditions are observations, not signals; unknown cause/news/history remain explicit. Source observation/check/interval evidence is expandable. Missing/stale/disconnected/cached/foreign-index data cannot become current facts, and eligible PCR does not depend on the shorter spot clock.

Ten new JVM tests and two synthetic Android UI tests accompany the candidate. Compilation/lint/unit/emulator acceptance is pending the source-triggered Android workflow at this checkpoint; no new live/phone acceptance is claimed. Existing refresh, stream, ladder, other tabs, backend, signing and app version are untouched. No release marker or user APK publication is requested for this engineering increment.


## Today capsule accepted in source/CI — 7 November 2026 IST

Accepted source `17d78e3115aad87527fcb0a8f6610759f0281577`; [Android run 42326201897](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42326201897) completed SUCCESS. Downloaded XML reports independently confirm 66 JVM +28 Android15 tests, zero failures/errors/skips. Lint: zero errors,14 warnings. Validation artifact13555471233 SHA256 `6e240d65e2648382ea17a0710d69527714f3ddc086a7a084ff489b34c21dbcc0` matched downloaded bytes.

The earlier run42325472307 passed all66 JVM tests and26 existing Android tests but failed the2 new UI assertions. Downloaded failure XML showed the complete expected text was present; assertions used assertTextContains without substring matching. The correction asserts each complete label with assertTextEquals; app behavior and assertions about stale withdrawal/index isolation were retained. The final full suite passed. Do not hide the failed attempt or treat the correction as a new market-data repair.

This accepts the deterministic Today projection and its bounded synthetic/emulator behavior only. It does not establish actual news/causality, change since last refresh, live phone correctness, owner authentication or physical smoothness. Current stable0.1.10 remains installed unchanged; no release marker, version/signing change, public APK publication, production mutation or additional download was made. Include this increment in a future combined milestone APK after the remaining relevant checks.

Next source work: inspect the existing spot/futures/reference contracts for previous close/open, PDH/PDL and VWAP provenance before selecting the next small app-context increment. Keep missing references explicit; do not derive VWAP from an unverified average-price field or duplicate an existing indicator.


## Spot/futures reference candidate — 7 November 2026 IST

The deployed-source snapshot contract at b60d136524259cc1970b1f1d05d808a3cb0192cf supplies spot/future price, pdc, current-day OHLC, source/receipt times, exact future identity and timestamp-aligned futuresBasis. No PDH/PDL or verified VWAP field exists in this read contract; these remain unavailable rather than being inferred from today's range or average price.

An optional native references projection/card now uses that existing payload without a new endpoint, subscription or fetch. It shows broker previous close, today's open/high/low, exact futures label/expiry, price and source-verified future-minus-spot basis in index points. It validates session/date, role/symbol, real non-past future expiry/token/label, positive finite values, observation/receipt chronology and delivery/elapsed age. Basis requires both eligible legs, source time spread<=5s and agreement with future.price minus spot.price; zero basis is valid and missing/conflicting basis is not reconstructed. Futures can remain eligible when spot is unavailable. Contradictory OHLC is withheld without removing valid price/PDC; malformed optional futures cannot invalidate the existing core spot/PCR path. Saved/disconnected/foreign-index references cannot become current.

Twelve JVM and two synthetic Android UI cases are supplied; full compile/lint/unit/emulator acceptance is pending the source-triggered run. Existing Today capsule, Live Desk, backend, app version, signing and stable phone install remain unchanged. This is an engineering increment for a combined milestone, not a request to publish another APK. No runtime/live-phone acceptance is claimed.


## Spot/futures references accepted in source/CI — 7 November 2026 IST

Accepted source `a3df49b9756548e0c0c1374449d837e8954d0646`; [Android run 42328043423](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/42328043423) completed SUCCESS. Downloaded XML reports independently confirm 78 JVM +30 Android15 tests, zero failures/errors/skips. Lint: zero errors,14 warnings. Validation artifact13556382587 SHA256 `1c08a5e027bebabdb831d84bb754c57931314f1e763054a1bc134ab54a87d337` matched downloaded bytes.

The twelve new model tests and two UI tests passed with the existing Today/navigation/ladder/cache/lifecycle suite. New cases cover source identities, optional numbers, contradictory OHLC, future contract/expiry, wrong date and duplicate index, stale/impossible receipt, independently fresh pre-open rejection, zero/missing/conflicting basis, source-time skew, delivery/elapsed/index/cache withdrawal and an extreme malformed optional future that must not erase the valid core spot. The references family does not depend on spot-price UI status, so a valid future can remain visible when the spot family is unavailable.

Accepted scope is the optional broker previous close/current-session OHLC and exact futures/basis projection, with bounded synthetic/emulator verification only. PDH/PDL and verified VWAP are absent from this snapshot contract and remain unavailable. Actual phone/live readings, owner access enforcement, physical performance and combined-release acceptance remain open. Installed stable0.1.10, version/signing and production were not changed; no APK release or user download was requested. Next: inspect dated historical-reference and VIX contracts for the next small supported context increment; never substitute today's range for previous-day levels or an unverified average-price field for VWAP.
