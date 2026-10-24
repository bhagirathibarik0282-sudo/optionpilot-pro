# 19 Oct 2026 — real archive verification vs Recorder/RAG gate

## What was inspected

A prior user-uploaded file, `premium-spread.json` (SHA-256 of the original 111,490-byte file: `e4d25e6fec27d82891ab4853f98d1273d73999f66844d90d61dbc165a47f690d`). This file **is not committed into this PR**.

Its own source contract is `READ_ONLY_PREMIUM_SPREAD_COMPARISON_V1`, `EXISTING_H1_FIXED_CONTRACT_JOURNEY`, `EXACT_1M_NO_INTERPOLATION`. Scope: **NIFTY, 2026-10-19, expiry 2026-10-19, 22900 CE versus 23150 PE**. It contains 376 minute-bucket rows and 235 `TRUE_ELIGIBLE_BOTH`, 122 `TRUE_DIAGNOSTIC`, 11 `UNMARKED`, 7 `MISSING` and one `INVALID_QUOTE`. These are the archive's source-defined statuses; they are not model-derived trading labels.

Independently checking original minute identities, exact quote times within each minute, strict research validation flags, and nonzero finite CE/PE values produced **51 exact 3-minute before/at/after triplets** with all three points `TRUE_ELIGIBLE_BOTH`. A separate 1-minute gap-sign change was recorded at **10:43** in this archive, so the 10:42/10:45 comparison does **not** prove the crossover first happened exactly at 10:45.

## One source-backed exact 3-minute sample (IST)

| Exact bucket | CE 22900 LTP | PE 23150 LTP | CE minus PE | CE quote timestamp (UTC) | PE quote timestamp (UTC) |
| --- | ---: | ---: | ---: | --- | --- |
| 10:42 | 144.20 | 153.85 | -9.65 | 05:12:01 | 05:12:01 |
| 10:45 | 156.00 | 137.10 | +18.90 | 05:15:01 | 05:15:00 |
| 10:48 | 152.60 | 142.90 | +9.70 | 05:18:00 | 05:18:01 |

Measured 10:42 → 10:45: CE **+11.80** (+8.1831%), PE **−16.75** (−10.8872%), spread **+28.55** points. 10:45 → 10:48: CE **−3.40**, PE **+5.80**, spread **−9.20** points. These are descriptive retrospective recorded prices only. These 3-minute snapshots are sampled from a 1-minute export and do not prove 3-minute H1 replay availability.

## Critical gate — why this is NOT full RAG acceptance

The file **lacks the archived market snapshot receipt timestamp**, exact normalized H1 snapshot ID for every selected quote, market truth join, spot/futures/full-chain-PCR fields, and time-aligned heavyweight/sector or published FII/DII records. The file's `ceQuoteTime`/`peQuoteTime` **are quote timestamps, not backend receipt timestamps**. Source status `TRUE_ELIGIBLE_BOTH` in the 1m spread route does **not** imply the different 3m RAG route will have a qualified event receipt in the same bucket.

Therefore the new `auditRecordedSpreadForRag` program deliberately returns `bridgeReady:false` for this export, even for a measured triplet; it does not convert the 1m spread to a RAG replay object. **No missing market field is constructed or interpolated.**

## The honest remaining end-to-end gate

1. Call the existing production `/api/research/rag-event-evidence` **read-only** endpoint once for an actual selected date/index/expiry/strike/side/time. Record only bounded success/failure and canonical source/receipt identities. **Do not log raw market response bodies, secrets or entire session payloads.**
2. Confirm the returned `mode`, `source`, `identity`, `event.availableAt`, original `beforeAndAt` and optional `outcomes` against the exact RAG gate; test event-time row `quoteAt` and `receiptAt` satisfy the event knowledge cutoff.
3. Browser-test the new Recorder button and page in a draft/isolated environment. The live production environment does not contain PR #799.
4. Then review full GitHub checks, intended market-hour read load and source coverage. A successful fixture CI or a 1m spread audit alone must **never** be called live end-to-end acceptance.

### Source accessibility

The service is reported online by Railway, but a historical GET from this chat environment was inaccessible due to network/DNS/tool reachability. This is **not evidence of archive failure**. No live values, DB writes or deployments were attempted by this research validation.
