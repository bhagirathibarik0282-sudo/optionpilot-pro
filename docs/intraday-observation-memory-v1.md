# Persisted intraday observation memory

This research side channel links prior recorded close context, notable sampled events and exact same-contract CE/PE responses. It has no candidate, verdict, Telegram or execution authority.

## Chain checklist

- Reuse existing full-PCR provenance correction, PDH/PDL crossing and wall-migration transforms.
- Preserve the prior expected trading date separately from the last available recorded date; missing days never become yesterday. Previous references require exact recorded 15:30 rows and the same expiry/strike.
- Group all known facts at the same symbol/expiry/strike/minute into one immutable event. Freeze its CE/PE pair and market, chain and exact-time three-index context.
- Track routine OI/premium notable changes on the current recorded ATM pair per expiry. PDH/PDL crossings cover all fresh CORE strikes; this is not all strikes of the exchange chain.
- Use the existing descriptive >=75th-percentile change rule with at least eight EARLIER exact 3-minute comparable changes. No future outcomes enter event selection. OI changes at migrating wall identities are not treated as same-strike additions.
- Store +3/+15/+30-minute responses only at the exact timestamp and fixed expiry/strike. Stale, missing, snapshot-mismatched and outside-session targets get explicit MISSING status. Immature targets remain pending. Do not use nearest quotes or next-day observations as intraday gains.
- Use existing H1 recorder completion as the recurring clock; no new market-data calls or interval timer. First cycle/restart reads the current session; subsequent reads begin at the prior cursor and reuse an in-memory normalized cache for that day.
- The existing 15:35 CAS scheduled cycle finalizes that day's intraday responses and receipt, including a delayed last recorder cycle. It adds no timer.
- One startup catch-up processes the latest available closed recorded session; the latest older unfinished session can also be completed. Historical derived events are labeled RECOVERED_HISTORICAL. One per-session receipt prevents repeated full-day catch-up after completion. Quiet sessions can have receipts without events.
- Reuse app_state_log with separate event/response/receipt kinds. Advisory transactions seal each identity; a concurrent losing event writer must read the persisted winner before computing responses. No new database/table/service. Day-scoped summaries persist across cache resets; no deletion is introduced.
- GET /api/research/intraday-memory and /view are read-only. Existing mobile DATA tools link to Saved intraday memory. Readers expose up to 1000 events per selection and their saved responses; storage is not limited by this display cap. The view renders 40 cards initially.

## Limits and evidence

Events are observed 3-minute intervals, not exact tick crossing times. Stars are a UI convention, not a calibrated probability. Full PCR provenance is checked; CORE OI is a subset and cannot stand in for full CE/PE OI totals. IV and futures contract continuity remain independently unverified. FII/DII context is not added to this module. No causality, profit, MFE/MAE or exit simulation is claimed.

Offline 8 October recordings reproduced 470 grouped events and 1410 response slots: 1111 qualified, 299 missing. Serialized event/response payloads were approximately 3.1 MB for that particular partial recording day; PostgreSQL storage overhead is additional, and another day may differ. This is compact event storage, not a second raw snapshot archive. Raw-data retention and Railway overnight shutdown remain separate pending work.

Validation: fail-closed fresh-quote/identity tests, exact horizon and session-boundary tests, no-lookahead and sparse-gap tests, full-PCR provenance tests, API mutation rejection, existing recorder/dashboard/CAS regressions, and isolated PostgreSQL concurrency/rollback tests. Runtime acceptance requires stored source-derived counts and responses, health, dashboard HTTP/link checks and restart persistence; merge alone does not prove live next-session operation.
