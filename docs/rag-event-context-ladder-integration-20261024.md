# Recorder → event-wise context ladder (draft integration contract)

**Status:** isolated read-only adapter and tests in a draft branch. **Not wired into the dashboard, not a deployed feature, and not tested against real historical sector/constituent feeds.** No new database, upstream fetch, broker call, timer, selector, candidate, Telegram, seller or order authority.

## Scope

The existing saved-session / exact-premium RAG / market-investigation tools remain the data authority. The adapter in \`rag-event-context-ladder.ts\` accepts **already verified** observations for **one selected event** and produces distinct Before / Event / After lanes. It does not search the archive or claim semantic/embedding-based retrieval. It does not choose market direction or generate percentage probabilities.

- Event identity: one index, IST session date/time, event kind; exact expiry + strike + CE/PE side when displaying premium.
- Families stay independent: Spot, Futures, Premium, PCR/OI, Heavyweight, Sector, and institutional FII/DII context.
- Each cell preserves source time, available time, observation bucket, value, source provenance and optional change %, independently verified weight % and contribution.
- Default checkpoints: -30/-15/-3/0 minutes. Forward +3/+15/+30 is **explicitly opt-in retrospective research**.
- A missing exact bucket/contract remains missing. No nearest timestamp, expiry stitching, forward-fill or same-strike-to-different-contract substitution.
- Conflicting observations of the same family/entity/metric/bucket are withheld; identical repetitions can deduplicate.
- Index constituent and sector weightage **must have a verified, dated independent source**. Do not present a tracked price-change subset as index-weight ranking. A contribution needs separately verified calculation/source.
- FII/DII: official **published daily context** only. On an intraday event, an EOD report published after that event is excluded, even when the historical chart shows the whole day. Never call cash institutional totals an intraday flow.
- Missing historical sector or heavyweight interval series means "not available for this event", **not neutral**.
- After-event responses are not evidence available at event time; isolate them from the match signature to prevent look-ahead.
- Full-chain PCR remains separate from an ATM ±7 subset, as in existing strict PCR documentation. Do not introduce an artificial combined prediction or probability score.

## Suggested existing dashboard wiring (future, not included here)

1. In Recorder: use existing **Open recorded day** navigation; do not add another recorder process. The same recorded cursor/date/index should be available to the event selection.
2. At the selected PDH/PDL, wall, PCR or spread event, add a **Compare similar recorded events** action.
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

## Validation command (not yet executed against repository CI)

\`\`\`bash
NODE_ENV=test node --import tsx --test test/rag-event-context-ladder.test.ts
\`\`\`

The pure adapter runs without database or broker setup, but a successful isolated test does not prove live-market availability, existing RAG route integration, or the fidelity of absent historical constituent data.
