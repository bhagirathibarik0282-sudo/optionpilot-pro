# Fixed DATA process checklist — 2026-10-08

Scope: read-only data and UI composition. No candidate, score, threshold, new database or memory engine. No changes to recorder cadence, Kite auth, trading/Telegram/execution paths. Owner approval before merge/deploy.

Baseline: production main da06bfd4d371291ae18b49dc32964b83c8cc0dc5. PR 624 remains an unmerged read-only source correction and reading-card proposal. CI verifies code behavior; it does not certify profitability or human interpretation.

## Ordered gates

| Order | Gate | Completion evidence | Status |
| --- | --- | --- | --- |
| 1 | Lock source definitions and defects | Trace raw/archive, normalized row and UI meaning using matched index/time | Audited; defects established |
| 2 | Correct PCR read-only composition | Match archived full-chain PCR to exact index/expiry/time; legacy band value never promoted; unavailable stays unavailable | Implemented; focused tests pass, not deployed |
| 3 | Separate time meanings | Recording, last-trade, quote-packet and response times labelled distinctly; unknown provenance stays unknown | Implemented; focused tests pass, not deployed |
| 4 | Expose coverage | Missing wall/expiry/depth/quote coverage explicit; missing event evidence never interpreted as no event | Implemented; focused tests pass, not deployed |
| 5 | Verify comparison identity | Exact option identity and sampled endpoints; futures expiry continuity unknown; previous-day sampled endpoint labels retained | Existing UI tests pass; production end-to-end validation pending |
| 6 | Explain measured facts | Simple Odia, contradictory observations and unknowns; no causal/eligibility/scoring claims | PR 624 draft; source corrections and measured explanations implemented |
| 7 | Validate human interpretation | Time-stamped paper thesis, invalidation, observed response and friction; later-session validation; no profitability claim without evidence | Not established |
| 8 | Verify and obtain approval | Focused meaningful tests, Devil Gate, dashboard CI, rendered mobile verification, exact deployed source checks | 30 focused tests and all local Devil Gate steps pass (570 full regression tests); remote CI and mobile visual verification pending; no merge/deploy in this turn |

Do not expand parameters while source meaning is unresolved. No automatic declaration of high probability or profitable selection. Missing data must not be inferred. Price/OI/PCR/walls are related evidence, not independent votes.

## Verified limited-window findings

Window: 2026-10-08 11:00–11:12 IST; not a full-day or profitability audit.
- NIFTY/SENSEX/BANKNIFTY each returned 5/5 expected recording buckets, marker truth TRUE. This establishes recording availability, not per-contract exchange freshness.
- SENSEX/BANKNIFTY wall fields were absent in this window. NIFTY wall coverage varied by expiry.
- Full-PCR fields were populated only for current expiry, not all recorded expiries.
- Market exchange_timestamp was absent in the inspected normalized rows.
- At 11:12 IST: NIFTY normalized full_chain_oi_pcr 0.7043991607961823 matched canonical market.gapScore.fullChainPcr; SENSEX normalized 1.0192478350622671 vs canonical full-chain 0.8492744397628156; BANKNIFTY normalized 1.1151530795681874 vs canonical full-chain 0.9001981944037143.
- SENSEX/BANKNIFTY row calculation_version H1_RUNTIME_BRIDGE_V1: h1-runtime-bridge.ts maps raw.pcr, server.ts assigns that from ATM-band oiPcr, h1-recorder-adapter.ts writes it to fullChainOiPcr for current expiry. NIFTY's inspected current-expiry row was STORAGE_V3_PHASE1 and matched full-chain archive. The defect is source-path dependent, not a universal failure of every PCR row.
- Several server option paths prefer last_trade_time over timestamp for quoteTimestamp. Kite distinguishes last-trade time from quote-packet exchange time. An old last trade does not by itself establish stale quote-packet/depth data.
- Normalized futures expiry identity and replay executable depth are unavailable. Stock/sector APIs expose response time and previous-close percentages, not synchronized recorded interval attribution.

## Evidence locations

- h1-recorder-adapter.ts / h1-runtime-bridge.ts / storage-v3-adapter.ts
- server.ts: fetchOptionChainStats, option timestamp mapping, stock/sector GET routes
- h1-replay-http.ts / business-dashboard-v1-view.ts
- /api/research/h1-replay?symbol={NIFTY|SENSEX|BANKNIFTY}&date=2026-10-08&from=11:00&to=11:14&scope=CORE&format=compact
- https://kite.trade/docs/connect/v3/market-quotes/
- https://www.optionseducation.org/optionsoverview/options-pricing
- https://www.optionseducation.org/news/open-interest-why-it-matters
- https://www.optionseducation.org/news/understanding-the-bid-and-ask-prices-for-options

No recorded data or production configuration was modified by this audit.

## REUSE / PATCH / NEW

| Treatment | Item | Boundary |
| --- | --- | --- |
| REUSE | Replay canonical archive, normalized market/options/chain, existing memory and EOD summary | Existing GET endpoints and recordings |
| PATCH | Full PCR composition for known H1_RUNTIME_BRIDGE_V1 rows | Exact symbol, recording timestamp, current-expiry date, version and TRUE truth; unique archive only; no band fallback |
| PATCH | Recording/source-time wording and selected-expiry PCR/wall coverage | Unknown packet freshness remains unknown; counts are loaded-row coverage |
| NEW | Focused provenance tests and this ordered audit record | No engine, database, scoring, candidate or execution authority |

## Verification of implemented composition

Read-only production sample at 2026-10-08 11:12 IST, then transformed locally:
- NIFTY current-expiry Full PCR remains 0.7043991607961823.
- SENSEX current-expiry Full PCR resolves from exact archive to 0.8492744397628156.
- BANKNIFTY current-expiry Full PCR resolves from exact archive to 0.9001981944037143.
- Other sampled expiry Full PCR remains unavailable; no cross-expiry fill.
- Array and compact formats, equivalent ISO timestamps, wrong identity/time/version/truth, duplicate/missing archive, malformed/negative values, zero and current/prior-session deltas tested.
- Tests generated runtime wiring changes; these were restored. No backend/recorder/Telegram changes included.

## Human paper-validation sequence (not yet completed)

For each observation, record the exact contract and both timestamps, measured changes, missing sources, your interpretation, what would disprove it, and later recorded behavior. Keep bid/ask spread and executable-price uncertainty alongside the outcome. Separate expiries and DTE; do not pool different identities. An unavailable source cannot become a confirmation. Later observations cannot be used to rewrite the original interpretation. This audit makes no win-rate or profitability claim.

Next gate: remote dashboard CI and rendered mobile verification, followed by owner approval before merge/deploy. After an approved deployment, re-check exact deployed source and a bounded recorded sample; do not call the process complete before that evidence exists.
