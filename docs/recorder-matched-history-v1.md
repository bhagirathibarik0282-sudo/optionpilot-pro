# Recorder history adapter — bounded first integration

Status: internal loader implemented and tested with normalized fixtures through
the real RAG snapshot builder and matching core. Not mounted on HTTP, imported
by application startup, activated on the dashboard or executed against the
actual database. No real historical probability or production acceptance claimed.

`loadRecorderMatchedHistory` uses the existing H1 recorded-date index and H1
replay reader. Its caller supplies an explicit target identity, prior date range
and declared/versioned rule. It does not accept an LLM-selected case list.

1. Validate rule, exact target, prior range and same-session outcome window before
   reading the date inventory. No default rule, sample threshold or date range.
2. Read the existing date inventory once. Select every date for that index within
   the explicit range. Reject duplicate/malformed dates and ranges exceeding
   twenty recorded sessions instead of silently truncating.
3. Read the target's exact three-minute baseline/event window once. Validate
   replay identity, complete marker continuity and all TRUE markers. Build its
   actual admitted snapshot, then validate target matching features/cutoff.
4. Read prior sessions sequentially, with no retry, from event-minus-three minutes
   through the chosen outcome horizon. Require the same source/identity/marker
   checks. Enumerate all recorded exact-side contracts at the event minute with
   the target's calendar DTE. Refuse more than 64 contracts per session instead
   of choosing a subset. Pass each contract through the existing snapshot builder.
5. Stop at the first failed source session and return unavailable. Never convert
   a failed read into a successful partial probability pool. Only after all
   selected reads succeed, invoke the existing deterministic matching core.

Audits include selected/loaded/failed dates, read counts, enumerated contracts and
sessions with no observed same-DTE contract. An empty observed contract pool is
not counted as a zero-return outcome. This inventory is **recorded rows in a
bounded range**, not proof of full exchange inventory or all historical sessions.
Exact-sample missing/conflicting features or outcomes remain blocked by the core.

The implemented features do not use retrospective prior-session PDH/PDL, so the
adapter explicitly marks that optional reference as not requested and performs
no prior full-session reference query. It does not pretend that the prior read
succeeded. Future support for PDH/PDL/O=H/PCR/walls needs separate qualification.

No new DB, write, index, schema, source, background job, broker call, Telegram or
execution change. Database execution retains existing reader behavior; real
query load, latency and source coverage have not been measured for this adapter.

Validation: eight loader tests plus eleven core tests passed. Loader tests use
normalized fixtures and the real snapshot admission path, covering identity,
bounded query scope, source failure, date inventory, all-contract enumeration,
missing outcomes and no outcome-based replacement. This is not an actual-DB
proof. Next step is an explicitly authorized bounded real-source run and review;
then a guarded dashboard integration with the declared rule/support criteria.
