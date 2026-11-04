# Recorded premium movement ≥ ₹60 — implementation and acceptance

Date: 2026-11-04. Status: **research draft, NOT production-deployed**.

## Source and strict evidence boundaries
- Reads existing /api/research/recorded-dashboard/dates and /api/research/recorded-dashboard/replay GET-only archive routes.
- Recorded replay CORE scope includes only already-saved ATM ±7 option strikes. The UI must never describe this as full-chain/all-strike coverage.
- Scans NIFTY, SENSEX, BANKNIFTY monthly **research** on request, one index-day sequentially. Buttons: current IST week (Monday to current day) or all dates returned by archive inventory. The index selector supports selected index or explicit all three.
- A move is observed from two **different timestamps** of the same date + symbol + expiry + strike + CE/PE, each with finite positive saved LTP. Requires truthful recorded marker, one exact market snapshot ID, valid quote/receipt timestamps, quote age -5 to +30 seconds, same IST session, and no conflicting duplicate quote.
- For a fixed contract/date, reports at most one maximum upward (later LTP − earlier LTP ≥₹60) and one maximum downward (earlier LTP − later LTP ≥₹60) sampled move. Also record **first observed threshold timestamp**, actual endpoints, prices, observation count, largest sampled gap. First observed ≥₹60 time is NOT the unobserved crossing time.
- Missing market receipt, stale quotes, duplicate conflicts, gaps, different strikes, different expiries, or different sessions must not be stitched, imputed, or labeled as verified hits. A missing 60-point hit is not proof that no movement occurred outside covered strikes/minutes.
- RAG Evidence actions use only an exact saved contract and an eligible recorded 09:15–15:30 minute; after-window source samples remain visible without a dead evidence action. No trade/Telegram/selector promotion.
- UI gives scan progress, 50-row pagination, CE/PE filter, rise/fall filter, cancel, and explicit failure status. A failed day's read stops rather than silently skipping missing data.

## Verified continuous-integration evidence
- Commit 9592655dc3732366ebc2d107107f30c2743de690: recorded/replay CI **49 passed, 0 failed, 0 skipped** including new scanner, one-click all-recorded and optional three-index tests.
- Same commit: Permanent Guardrails CI and PR800 Mobile Data First UI CI **success**.
- The browser simulator initially had blank select default values; scanner reported actual synthetic hits but the filter hid them. Fixed simulator to reproduce browser defaults, verified rerun passes. Synthetic fixture hits are **NOT market discoveries**.
- Any later commit requires fresh final-head CI before acceptance.

## Required before production merge / customer-facing completion
- [x] Pure scanner tests: rise/fall, strict identity, quote age, conflicting duplicates, gaps, invalid threshold.
- [x] Recorded dashboard tests: one click, result evidence action, cancel, source index isolation.
- [x] All-three-index sequential same-dashboard test, without new database, broker requests or schedulers.
- [x] Initial three CI workflows pass on 9592655.
- [ ] Re-run and verify all final-head CI after this documentation commit.
- [ ] Actual production GET readback: date inventory, one current-week NIFTY, SENSEX and BANKNIFTY sample, verify exact market/option source timestamps against returned hit and check missing/partial records.
- [ ] Browser acceptance on the deployed/previewed **new finder panel** at 360px and 390px (general mobile workflow pass alone is insufficient).
- [ ] Performance under real archive volume and 2-active-read off-hours cap; bound query cost before any all-day/all-three-index broad scan in production.
- [ ] Make an explicit release/rollback decision; do not automatically merge while these remain open.

## Non-goals
No execution authority, alerting, strategy P&L, 90-point swing test, all-strike historical scan, new persisted data, or invented 1-minute prices. Other scheduled market work remains unchanged.
