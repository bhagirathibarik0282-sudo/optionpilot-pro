# RAG evidence: strict work checklist

Overall status: PARTIAL. One bounded access defect reproduced and corrected locally. The first code head passed all five CI workflows, including native Chromium minute input. The after-hours access correction still needs new-head CI and corrected production acceptance.

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
- [ ] Pass final-head native Chromium acceptance, including evidence within the recorded dashboard.
- [ ] Verify the tested code tree is deployed successfully.
- [ ] Read the previously rejected 14:31 selection from production and match its exact price and arithmetic.
- [ ] Confirm an EVENT request at 14:31 remains rejected, with no crossing invented.
- [ ] Attach the corrected readback to the audit record; only then close unit 1.

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
