# CAS closing memory deployment

Problem: the existing read-only CAS proxy rolls ATM per timestamp and does not persist fixed-contract closing responses. This addition derives one immutable compact research memory per index/day/version from existing recorder rows, retaining exact frozen CE/PE expiry/strike identity, endpoint quote evidence, DTE averages and matched three-index closing spot-return correlations.

- Automatic same-process capture: 15:35 IST, trading days only. Existing 2026 holiday calendar is reused; another year requires calendar review.
- Startup recovery: at most 60 already closed recorded index sessions, newest first, skipping persisted identities. HTTP startup is not blocked. Failed captures use at most two extra attempts during the evening window.
- Storage: existing PostgreSQL `app_state_log`, kind `CAS_CLOSING_FIXED_CONTRACT_MEMORY_V1`. No new database, table, service, broker requests or orders. Advisory transaction lock + post-lock lookup prevents duplicates under concurrent processes. Successful persisted results are immutable.
- Readers: `/api/research/cas-closing-memory` and `/api/research/cas-closing-memory/view`. Existing DATA navigation includes `06 CAS memory`. GET routes never capture or write.
- Qualified window: TRUE market data, at least two baseline (15:00–15:15 end exclusive) and closing samples, exact 15:15 and 15:30 endpoints, positive spot values.
- Qualified pair: freeze 15:15 recorded ATM strike per expiry; require both CE and PE at both exact endpoints, TRUE truth, positive prices, known 0–60 second quote ages and timestamps, exact market/option snapshot identity, and DTE matching the expiry date. Never substitute the new ATM, forward-fill or use a partial window in means.
- Returns on fresh fixed endpoints can remain visible with `PARTIAL` baseline, explicitly excluded from all averages. Saved historical recoveries are labeled `RECOVERED_HISTORICAL`. Current closing captures are derived recorded research, never a live execution feed.
- No change to the existing numeric/auction CAS definition: actual indicative-close, auction imbalance and cash-auction volume remain unavailable. The module does not use PCR as a causal predictor; existing band PCR is not promoted to full PCR. IV is recorded context, not independently verified. Futures expiry continuity is not proved.
- Summary API displays up to 1500 saved index sessions. This is a read limit; the collector does not delete historical compact memories. Existing EOD retention targets do not include this log kind.
- This closing research tracker does not implement the wider intraday notable-event T+3/15/30 processor or the Railway overnight shutdown plan.

Validation: targeted fail-closed and route tests; isolated PostgreSQL CI test with ten concurrent writers, immutable readback, rollback and retry; existing full `npm test`; comparison against all available recorder closing windows. Deployment acceptance requires health, PostgreSQL-backed readback, expected counts/returns, and scheduler status after deployment, not just a merge.

Rollback: revert this change or deploy the prior known-good build. Existing research memories remain isolated by version and never enter verdict, Telegram or execution authority.
