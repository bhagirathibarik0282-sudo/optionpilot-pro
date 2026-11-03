# Telegram ladder integration preparation — 30 October 2026

This branch builds on draft recorder PR #814 (`92aea5f`). No production settings, startup scripts, timer cadence, legacy sender files, broker connections or Telegram destinations are changed. No Telegram messages have been sent by this work.

The saved 29 October V4 formatter/outbox is now repository code. The source reader requests FULL replay for NIFTY, SENSEX and BANKNIFTY in ranges of at most 15 minute buckets, using existing interfaces and the existing participation archive. Individual source failures preserve healthy sources. A missing spot record no longer discards existing premiums/PCR for the same minute. Missing inputs remain explicit; archived evidence is not upgraded to current live quality.

The callable runtime defaults to SHADOW. It loads at most 15 buckets per pass into a one-session cache, rejects overlapping ticks, plans only closed-minute windows after an explicit activation boundary, and plans EOD at 16:00 IST. It uses the existing reviewed 2026 calendar and the saved engine's explicit 09:15–15:30 report scope. Missing buckets are not forward-filled. A failed read throws and can retry the same minute; returned partial source failures remain recorded gaps for this pass. A source returning incomplete-but-successful rows is not automatically repaired.

The injected transport supports text and UTF-8 TXT documents. It verifies concrete chat identity and a positive message ID before acknowledging, honors Telegram's retry-after, and classifies timeout/proxy/malformed outcomes as UNKNOWN. The durable outbox never automatically resends UNKNOWN deliveries. Pending reads are scoped by destination/session, ordered by creation and bounded to 25 jobs; up to three jobs are delivered per runtime pass, stopping on the first non-ACKED result. Importing any module sends nothing.

Validation locally after double-check: 33 ladder/source/transport/runtime tests pass. Existing `npm test` passes 691 tests with one pre-existing skip. PostgreSQL integration tests and a dedicated CI workflow are added for 20 concurrent creates/claims, immutable job identity, receipt/restart/resume, explicit failure retry, ambiguous/abandoned suppression, and actual rollback/retry. Native PostgreSQL was unavailable locally; its CI result must be checked separately.

Still required before activation:

- Deploy the default-OFF shadow binding, explicitly enable TELEGRAM_LADDER_SHADOW_ENABLED only for acceptance, and observe actual source completeness and resource use. The existing five-second timer now invokes the host; the host bounds planning to once per minute. It reads through the existing database interfaces and cannot construct an outbox or a Telegram transport. No delivery-mode pool binding is activated.
- Independently verify live PCR coverage/universe and prior-session premium levels. The archive source deliberately keeps their values unverified where provenance is absent.
- Reconcile the report engine's saved 15:30 boundary with any later observation session configured in the repository; no later buckets are included by this patch.
- Complete native PostgreSQL CI and authorized real text/document destination acceptance; local HTTP tests use stubs.
- Observe a complete session, restart and EOD; assess backlog throughput before enabling delivery.
- Apply the earlier minimum cutover repair only with an accepted running replacement, inventorying all active senders. Legacy messages are still enabled.

This is a draft integration step, not a live release or proof of complete market-data availability.

## Double-check corrections

Two regression cases reproduced defects before repair. In the ideal-delivery full-session simulation, the old one-job-per-minute loop queued 547 reports but acknowledged only 405 by 16:00 IST, leaving 142 pending. The bounded three-job loop acknowledges all 547 by that point in the same simulation. This proves planner throughput with a stub transport, not production delivery capacity under Telegram rate limits or source outages. A second regression showed that a large EOD report used a truncated first-five-lines preface rather than the three-index summary. EOD now explicitly uses the compact summary. A third check confirms draining stops immediately after RETRYABLE or UNKNOWN.

## Shadow timer binding

The existing dashboard runtime timer now invokes `tickTelegramLadderShadow`. `TELEGRAM_LADDER_SHADOW_ENABLED` defaults OFF. Enabled operation logs report counts, attachment sizes and source failures without logging payloads or credentials. There is no real destination: the internal -1 namespace is never connected to a sender. Runtime reads/formatting failures are contained, and overlapping ticks are suppressed. No new interval or broker socket was added. Disabling the flag prevents further source work.

Validation after binding: 39 ladder tests plus 4 dashboard recovery tests passed (43 total); the separate native PostgreSQL suite was skipped because its dedicated test database was unavailable. Recorder repair: 15 passed. Shared-authority checks: 5 passed. Full repository npm test: 691 passed, 1 pre-existing skip. The captured-data test projects the existing canonical NIFTY fixture through the actual recorder code with stub storage, retaining 8 premiums across four expiries and 16 participation observations through the source/host path. This is a captured-sample wiring check, not native SQL or current live acceptance.

Local native PostgreSQL setup failed because this execution environment cannot switch to the required unprivileged user. The native suite has not been executed and must run in the prepared GitHub CI environment. GitHub push remains unperformed after the earlier automatic approval rejection; the local shadow-binding changes do not authorize deployment or sends.
