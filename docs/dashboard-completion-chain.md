# Dashboard completion chain — 2026-10-18

Scope: dashboard only; Telegram integration paused. Reuse existing chapters,
sources and candidate authority. Keep progress reports short and run focused
checks. Merge/config/production actions require the applicable user authorization.

| Order | Work | Evidence / remaining acceptance |
| --- | --- | --- |
| 1 | Production recorded Full PCR | COMPLETE. #720 merged as c7a5c48930c0794bbf5925004d00a1c0e976882f; Railway deployment SUCCESS. Production RAG readback reproduces PCR below. |
| 2 | Recorded wall provenance | IMPLEMENTED, pending review/release. Exact canonical loaded-strike OI maxima corroborate normalized storage values; source labels and quote times exposed. No full-chain wall claim. |
| 3 | Chapter-specific alignment | NEXT. Audit existing index/expiry/time/source agreement and chapter-specific fields. Reuse existing controls. Automated fixtures are separate from browser/market acceptance. |
| 4 | Paired premium ladder / exact-contract watch | PENDING. Existing filters and OI ladder are not a frozen paired premium watch. Follow premium-dashboard-reuse-audit.md. |
| 5 | Mobile and live acceptance | PENDING. Browser checks covered premium selection, expiry, Ask RAG and 09:21→09:24 recorded replay. Actual mobile layout and market-open freshness remain unverified. |

## Wall evidence readback

Read-only existing `/api/research/h1-replay`, NIFTY, 2026-10-16,
15:27–15:30 IST, FULL scope, compact format. SHA-256 of the received payload:
`78c112c58eab04b6782f7d7cc5a6b0b217958eba7ccc30ca049373e3b48bf2f6`.
Wall adapter evaluated locally against that payload; wall repair is not deployed.
PCR was additionally verified through the deployed RAG endpoint after #720.

Exact expiry: 2026-10-19. Each side contains 21 loaded strikes.

| IST bucket | Full PCR | CE OI-max strike / OI | PE OI-max strike / OI | Both top quote times IST |
| --- | --- | --- | --- | --- |
| 15:27 | 1.3204508867690437 | 23500 / 12868830 | 23000 / 13625105 | 15:27:16 |
| 15:30 | 1.3157613110806716 | 23500 / 12564110 | 23000 / 13029900 | 15:30:16 |

The storage writer computes maxima from each expiry's loaded CE/PE rows.
The chain version is STORAGE_V3_PHASE1 while the canonical/market marker uses
H1_RUNTIME_BRIDGE_V1, so the existing general chain version gate remains intact.
The RAG-only repair corroborates exact expiry, side, strike, OI and quote time
against the matching canonical snapshot. Conflicting aliases/duplicates, invalid
OI, tied maxima, mismatched stored values and post-cutoff quotes stay unavailable.
Loaded-strike maxima do not certify full-chain coverage or freshness, wall
migration, same-strike OI transfer, market direction or an execution candidate.

Validation: existing RAG CI command, 186 pass / 0 fail / 2 existing skips;
permanent guardrails and diff checks pass. Tests include serialized source-label
rendering/escaping, wrong expiry/side, duplicate/conflicting aliases, missing OI,
same-day timestamps, tied maxima and receipt/cutoff exclusion.
