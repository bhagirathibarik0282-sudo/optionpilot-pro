# Recorder → event-wise context ladder (draft integration contract)

**Status (2026-10-24):** The read-only adapter, a Recorder **Open Event Context Ladder** click handler, Hono GET route and compact HTML view are all on draft PR #799. **It is not merged or deployed, and real historical sector/constituent time-series coverage and on-device/browser acceptance remain unverified.** No new database, upstream fetch, broker call, timer, selector, candidate, Telegram, seller or order authority.

## Scope

The existing saved-session / exact-premium RAG / market-investigation tools remain the data authority. The adapter in \`rag-event-context-ladder.ts\` accepts **already verified** observations for **one selected event** and produces distinct Before / Event / After lanes. It does not search the archive or claim semantic/embedding-based retrieval. It does not choose market direction or generate percentage probabilities.

- Event identity: one index, IST session date/time, event kind; exact expiry + strike + CE/PE side when displaying premium. **The caller must supply `eventKnownAt`: verified acceptance/receipt timestamp within that event minute.** A bucket label alone is not a valid information-availability cutoff; events without the accepted timestamp fail closed.
- Families stay independent: Spot, Futures, Premium, PCR/OI, Heavyweight, Sector, and institutional FII/DII context.
- Each cell preserves source time, available time, observation bucket, value, source provenance and optional change %, independently verified weight % and contribution.
- Default checkpoints: -30/-15/-3/0 minutes. Forward +3/+15/+30 is **explicitly opt-in retrospective research**.
- A missing exact bucket/contract remains missing. No nearest timestamp, expiry stitching, forward-fill or same-strike-to-different-contract substitution.
- Conflicting observations of the same family/entity/metric/bucket are withheld; identical repetitions can deduplicate.
- Index constituent and sector weightage **must have a verified, dated independent source**. Do not present a tracked price-change subset as index-weight ranking. A contribution needs separately verified calculation/source.
- FII/DII: official **published daily context** only. On an intraday event, an EOD report published after that event is excluded, even when the historical chart shows the whole day. Never call cash institutional totals an intraday flow.
- Missing historical sector or heavyweight interval series means "not available for this event", **not neutral**.
- Before/Event context is restricted to observations available no later than verified `eventKnownAt`; later-arriving rows cannot contaminate an earlier event signature even during subsequent historical replay. After-event responses are not evidence available at event time; isolate them from the match signature to prevent look-ahead.
- Full-chain PCR remains separate from an ATM ±7 subset, as in existing strict PCR documentation. Do not introduce an artificial combined prediction or probability score.

## Important acceptance boundary

The current Recorder button passes an exact recorded date/index/expiry/strike/side/3m cursor to a read-only RAG snapshot route. It extracts `eventKnownAt` from the existing snapshot's verified selected premium quote. It does **not** detect a PDH/PDL, OI-wall or PCR event; it does **not** retrieve similar events from other days and has **not** passed real production H1 snapshot or browser acceptance. If the existing event source cannot prove `eventKnownAt`, keep the event unavailable rather than filling with the minute end.

## Recorder wiring and remaining future work

1. **Implemented on draft:** A guarded **Open Event Context Ladder** button uses the existing Recorder cursor, date, index, expiry, strike and side, then opens the read-only route. It is deliberately a **selected snapshot**, not a detected market event.
2. **Not yet implemented:** At a separately verified PDH/PDL, wall, PCR or spread event, add a **Compare similar recorded events** action. This must not be confused with the current selected-snapshot view.
3. Use existing multi-day event matcher to **retrieve** matching event types and direction patterns, with verified exact index/expiry/contract source checks. Retrieve *separately* for Market, Premium, PCR/OI, Sector, Heavyweights and published FII/DII, showing per-family coverage. The first implementation can use deterministic filters; semantic retrieval only after a vetted evidence boundary.
4. For each matched historical event, call an adapter that projects verified before/event/after checkpoints. Do **not** concatenate all days into one blended historical row.
5. Render a compact column ladder: Timestamp | family | exact source | before | event | after | delta | note. Show absent source as unavailable with the reason. PDH red, PDC yellow, PDL green are **level labels**, not implicit price-direction predictions.
6. Heavyweights/sectors: weight % / change % / contribution as distinct columns; sort by verified weight descending only when weights are available.
7. Surface an expandable source ledger, exact contract ID, recorded session, release-time cutoffs, historical observation cadence, and effective coverage before claiming that the research card is accurate.
8. Any PR integrating the adapter must test (a) all three indices, (b) mismatch cutoff, (c) multiple DTEs without expiry stitching, (d) missing/late constituent weights and (e) same-day EOD FII publication leakage, then run existing dashboard and RAG CI and real mobile visual acceptance.

## Prior existing repo sources

- \`rag-event-evidence.ts\`: exact-contract recorded checkpoints and source/receipt times.
- \`market-investigation.ts\`: historical event finder and observed option response; its replay projection explicitly says historical heavyweight/sector intervals are absent.
- \`canonical-fii-dii-official-context.ts\`: official institution flow is previous-session context, not intraday direction authority.
- \`docs/pcr-live-audit-2026-10-23.md\`: distinguishes complete fresh full PCR, mixed-time reported full PCR and ATM-band PCR.
- Draft PR #693: separate RAG retrieval-boundary contract (review integration rather than duplicating it).
- Draft PR #777: option-leg freshness hardening (review before relaxing any evidence gate).

## Validation command (included in GitHub PR CI)

\`\`\`bash
NODE_ENV=test node --import tsx --test test/rag-event-context-ladder.test.ts test/rag-event-context-ladder-view.test.ts test/rag-recorder-event-ladder-bridge.test.ts test/rag-recorded-spread-source-audit.test.ts test/recorded-replay-view.test.ts
\`\`\`

CI fixtures exercise route identity, snapshot labelling and safety, but a passing isolated test does not prove live-market availability, actual production H1 response identity, mobile browser behavior, or fidelity of absent historical constituent data.

## Read-only query-plan diagnostic (25 Oct 2026)

The independently observed one-minute 19 Oct 10:45 NIFTY request reported
26,033.1ms for the canonical read and 5,809.6ms for markers. These durations
identify a measured bottleneck, not a verified query plan or root cause.

In an already authorized environment with its existing `DATABASE_URL`, run:

```bash
node --import tsx scripts/inspect-h1-replay-plan.ts
```

This manual diagnostic captures the marker and canonical SQL from the actual
`runH1ReplayRead` builder using an empty injected reader, then sends only those
two `EXPLAIN (FORMAT JSON, COSTS TRUE)` statements in a `BEGIN READ ONLY`
transaction. It uses a 5s statement timeout, 1s lock timeout and always rolls
back. It does **not** use `ANALYZE`, execute the archive SELECTs, expose an HTTP
endpoint, change schema/indexes, deploy, or print credentials/raw DB errors.
It is not wired into application startup or any scheduled job. Provider TLS
configuration is left to the existing connection URL, without disabling
certificate verification in this script.

Inspect the returned scan/index nodes, filter placement and estimated rows
before selecting an optimization. A created-at fence is not automatically
equivalent to a source-time filter: it can omit late-imported records. Any
proposed rewrite must preserve source time, snapshot identity, duplicates,
truth-marker semantics and late imports before performance is claimed.

**Execution status, updated 25 Oct:** the live database plan has now been
obtained through the existing `postgres-catalog-inspect` one-off service, using
its existing DB reference without revealing credentials. The first reuse-build
redeploy ran its old temporary-table test; its logs were not accepted as plan
proof. A fresh diagnostic deployment then confirmed transaction read-only mode,
returned both EXPLAIN JSON plans and printed the completion sentinel. No index
or persistent database data was changed. The main dashboard service stayed on
commit `1c8fd373` (PR #798); PR #799 remains draft/unmerged.

Actual evidence is in `docs/audits/pr799-h1-real-explain-20261025.json` and
`docs/audits/pr799-h1-catalog-20261025.json`. Both plans use the existing
kind/created-at index for `kind` only, with source symbol/date/time as residual
filters. Catalog readback found only that index and the primary-key index on
`app_state_log`. These are estimated plans, without ANALYZE; no actual rows
removed, scan runtime or speedup is established by EXPLAIN alone. The slow-query
repair remains open. The OAuth connector still does not expose direct SQL, but
the existing diagnostic runner resolves the execution-access blocker.
