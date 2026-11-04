# RAG evidence: strict work checklist

Overall status: PARTIAL. Unit 1 is verified for the sampled exact-minute read and off-hours route; wider usability and all-index coverage remain later work. Accepted production commit: a85fd3fbcf09ea0880e177ea0c6fac416f0d4e56.

## Fixed objective

Use existing PostgreSQL-backed records to find evidence, compare it and replay it within the dashboard. Complete each numbered unit with source evidence, a reproduced cause, the smallest correction, negative checks and actual readback before starting the next unit. Test counts, merges and deployments alone do not establish runtime usability.

No new database, embedding service, model, recorder, broker call, trading authority or invented missing value is part of unit 1.

## Unit 1: exact recorded minute access

- [x] Verify production project/environment/service/repository branch using the existing authorized Railway connection.
- [x] Preserve the production commit identity: 6e3aa627da463828c697520b246e2ddf08a15767 at baseline readback.
- [x] Read an existing source minute, without writing database data or calling the broker.
- [x] Compare the same exact selection against the RAG endpoint.
- [x] Read an adjacent accepted control to distinguish source absence from request rejection.
- [x] Check quote/receipt times, TRUE status and matching source snapshot IDs for the exact selected source record.
- [x] Reproduce the rejection in tests before changing code.
- [x] Trace every layer involved: native form input step, shared request parser and premium-response calculator.
- [x] Correct snapshot minute access; preserve explicit 3m EVENT and same-DTE HISTORY contracts.
- [x] Verify exact price/percentage arithmetic using a frozen, documented subset of actual production records.
- [x] Verify missing minute, wrong contract and as-of cutoff cannot acquire nearby or future evidence.
- [x] Run the existing RAG/read/replay/UI regression suite and permanent guardrail checker.
- [x] Pass first-head real Chromium mobile native-form acceptance.
- [x] Reproduce the after-hours production blocker (HTTP 503 OUTSIDE_OPERATING_HOURS, running=false, maintenance=false).
- [x] Route existing GET-only RAG readers through the existing archive handler when the market runtime is off.
- [x] Verify locally that archive RAG access cannot start the market child, authorize maintenance or expose unlisted routes.
- [x] Embed the existing evidence card in the recorded dashboard.
- [x] Pass final-head native Chromium acceptance, including evidence within the recorded dashboard.
- [x] Verify the tested code tree is deployed successfully.
- [x] Read the previously rejected 14:31 selection from production and match its exact price and arithmetic.
- [x] Confirm an EVENT request at 14:31 remains rejected, with no crossing invented.
- [x] Attach the corrected readback to the audit record; only then close unit 1.

### Baseline evidence

Read-only production API evidence is in `docs/audits/rag-step1-production-20261104.json`.

Selection: NIFTY, session 2026-11-04, expiry 2026-11-09, strike 23900 CE.

- FULL compact replay at 14:31 IST returns HTTP 200, one market row, 94 option rows and a TRUE exact quote at 162.65. Quote time 14:31:27.000 IST and market receipt 14:31:27.268 IST share snapshot ID NIFTY-1793782887268-e60ad346.
- The same RAG SNAPSHOT selection returns HTTP 400, EVENT_REQUIRES_REGULAR_3M_PAIR.
- The adjacent 14:30 SNAPSHOT returns HTTP 200 and the correct selected quote at 165.55, with missing previous-session reference disclosed rather than suppressing that answer.

This proves an access/validation mismatch for the sampled selection. It is not proof that every recorded date, contract or field is usable. End-to-end HTTP elapsed times include network/application overhead and are not database query timings.

### Cause and bounded correction

The generic snapshot reader inherited the event reader's regular 3m-grid condition. The same restriction also existed in the native time input and the exact premium-response calculator. A default snapshot question at a real 1m recorded timestamp could therefore be stopped before retrieving existing evidence.

SNAPSHOT now accepts exact regular-session minute selections, still requiring an actual exact record. It never snaps to the nearest 3m bucket or interpolates a baseline. EVENT and same-DTE HISTORY keep their audited regular 3m requirements; the history reader now enforces its own requirement before database reads. Quote age, receipt, snapshot identity, duplicates, session, cutoff and trade authority checks are unchanged.

The production-source subset fixture retains all four market rows and the eight exact 23900 CE/PE quotes from 14:28–14:31. It intentionally omits other contracts and full-chain context; no complete inventory claim is made. The original full compact response SHA256 and counts are retained in its provenance.

Local result: 246 tests, 244 passed, two optional historical-fixture tests skipped, zero failures. The new normal-suite production-recorded fixture test ran and passed. Browser acceptance is tracked separately.

## Next units, in order

2. Selection usability: inspect where the existing dashboard cursor is lost or not forwarded. A row should supply its actual identity/time without requiring six manual fields. Do not infer an ambiguous contract.
3. Search and partial evidence: catalogue which failures belong to browsing versus individual calculations; expose available evidence and reasons at field level. Do not silently relax calculation eligibility.
4. Historical comparisons: audit same-DTE/event source coverage, exact-versus-comparable identity and before/event/after time boundaries. Show failed examples and differences.
5. In-dashboard replay: preserve selection and source provenance when moving between evidence and the recorded cursor. Verify real mobile interactions.
6. Database performance/cost: obtain actual bounded query-plan/catalog evidence before changing indexes, caching, retention or query structure. Compare measured latency and resource usage on the same requests.

Direct SQL schema/catalog/size/index audit, broad archival coverage, semantic retrieval quality, all-index production acceptance and cost benchmarking have NOT been performed in unit 1. Platform access and successful replay reads are not substitutes for those checks.

## Additional access cause: after-hours runtime coupling

After the first readback, the previously successful 14:30 query returned HTTP 503 OUTSIDE_OPERATING_HOURS, scheduled=false, running=false, maintenance=false after 16:15 IST. Supervisor source confirmed that historical RAG routes were absent from its exact read-only archive allowlist. This is a separate route-availability cause, not absent PostgreSQL records.

The correction reuses the existing archive handler and existing RAG/evidence/history functions. Only the three exact existing GET endpoints (evidence, its view, same-DTE history) are allowed through that facade outside operating hours. The market child's schedule, startup, authorization and live-session routing are unchanged. RAG shares the archive handler's two-active-read cap and rejects writes. The recorded dashboard embeds the same evidence card; it makes no automatic RAG request.

Before this correction, new facade, embedded-card and supervisor availability tests failed. Afterward, all 38 existing/new archive, playback, operating-window and supervisor tests pass with zero skips. Final-head CI and a successful recorded-minute read with the production market worker still stopped are required before closure.

## Unit 1 acceptance closure

PR #843 deployed successfully as a85fd3fbcf09ea0880e177ea0c6fac416f0d4e56 (Railway deployment 3a5673fe-3907-45f1-8adf-ccd294d1b2aa). All eight final-head CI workflows passed, including 390px native minute input and evidence submission inside the recorded dashboard.

Corrected production readback after operating hours:
- 14:31 SNAPSHOT: HTTP 200, RECORDED_READ_ONLY, source EXISTING_POSTGRES_H1_REPLAY; selected 162.65, exact 14:28 baseline 172.85, price delta -10.20 and percent -5.901070292160826.
- Missing previous-session reference remains explicitly PARTIAL; it no longer prevents these eligible snapshot values.
- 14:31 EVENT: HTTP 400 EVENT_REQUIRES_REGULAR_3M_PAIR; no event-grid weakening.
- As-of 14:31:00: HTTP 422 EXACT_SNAPSHOT_UNAVAILABLE_AT_CUTOFF; later-received data remains excluded.
- Original dashboard URL: HTTP 200 with exactly one embedded RAG evidence card.
- Health before and after reads: market runtime running=false, maintenance=false, scheduled=false. No temporary market window was opened.

The source receipts are recorded in the accompanying audit JSON; the merged PR description also retains this closure. This closes only the sampled access defect. Manual field burden, broad search, similar-event ranking, query plans/cost and full end-to-end mobile data quality remain separately unproven.


## Unit 2: complete the recorded evidence interaction

Changes prepared against production a85fd3f (rollback revision):

- Recorded replay ladder: each actual positive-price row has an Evidence action. Clicking derives identity again from the current exact frame, rejects absent/ambiguous rows, pauses playback, and forwards date/index/expiry/strike/side/minute. No nearest-time or inferred-expiry search.
- Main reference dashboard recorded premium table: retains the same source identity in its Evidence button and opens the existing RAG card inside the existing dashboard modal. Price/status column positions and exact coverage statuses remain intact.
- Card actions: before → selected time, explicitly requested later observations, and same-DTE historical comparison. The chosen identity stays visible. Advanced manual fields remain available.
- Cursor/date/index/contract/source changes abort and invalidate an old request, discard its result, and clear its identity. A quick action cannot silently reuse the previous contract.
- History uses an exact three-minute interval ending at any recorded minute, e.g. 14:28 → 14:31. Both exact endpoints, source identity, duplicate checks, receipt/quote age, session and cutoff still have to pass. No rounding/interpolation. Verified crossing EVENT remains on its regular three-minute grid.
- Snapshot context with missing baseline/reference stays explicitly partial; an invalid selected quote still cannot enter calculations. Same-DTE examples remain descriptive, one closest recorded moneyness contract per supplied day, maximum six earlier days. No similarity score, win rate, causal claim or trade authority is added.
- No schema migration, new service, embedding/model request, broker request, database write, retention change, credential change or schedule change. Existing shared two-active archive-read limit remains.

Acceptance checklist:
- [x] Source identity propagation, pause, absent-contract rejection and cursor invalidation regression tests.
- [x] Race suppression, explicit outcome opt-in and invalidated-identity action tests.
- [x] Exact non-grid history endpoints accepted; absent/nearby endpoints and pre-receipt cutoff rejected.
- [ ] Final-head real Chromium 360px/390px frozen-production-source workflow, including front dashboard modal.
- [ ] Final-head CI and deployed revision identity.
- [ ] Actual production exact-minute arithmetic, cutoff/event negative controls, history endpoint and runtime-off state.

The browser fixture projects the already documented production 23900 CE/PE records; it is isolated acceptance evidence, not a current live-data or full-chain coverage claim. SQL catalog/query-plan audit, cost benchmarking, semantic retrieval ranking, all-date coverage and live-market acceptance remain unproven. This release completes the recorded row-to-evidence interaction; it does not manufacture absent records or certify the wider research system.
