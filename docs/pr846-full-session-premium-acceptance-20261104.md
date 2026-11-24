# PR846: full-session premium display and replay

Status: PARTIAL. Local implementation; not production-deployed. User explicitly authorized GitHub push on 4 Nov 2026; publication and remote CI readback are next.

## Delivered locally
- Shared `recorded-premium-session.ts` renderer in the main dashboard's existing Recorded Replay and the after-hours saved-session dashboard. No new page, timer, broker/API, SQL, credentials, scheduler or trading authority.
- Session axis is 09:15 to the repository's existing date-specific observation close. Preserve that existing session policy; this change does not redefine exchange hours.
- Default all saved expiries, CE and PE side by side per expiry, exact selected strike frozen across each series. Selected-expiry option remains available. An expiry lacking the selected strike/eligible quotes stays unavailable.
- 1/3/5/15/30/60m display groups retain the last actual sample timestamp and expose missing buckets. Full raw eligible observations remain accessible in an expandable source table. Coarse groups are sampled lines, not candles or actual interval OHLC; partial/missing groups cannot bridge gaps.
- Values, scales and PDH/PDL reference levels are derived only from eligible rows at/before the shared replay cursor. Reset/seek hides later prices and source times. Session identity metadata may list contracts available later, without exposing their later prices.
- Require TRUE option and market markers, exact snapshot identity, finite positive LTP, same-session quote and receipt freshness -5 to +30s. Conflicting duplicates and missing market receipts are excluded. Preserve source cadence 1m/3m without interpolation.
- Stored PDH/PDL guides and trailing 15m sampled high/low with sample count. No fabricated OHLC, session open or O=H.

## Validation
- 118 focused tests passed, zero failed/skipped: premium source admission, full-session bounds, replay look-ahead, fixed contracts/missing expiries, gaps/coarse groups, dashboard integration, replay controls, HTTP read-only rules, supervisor/operating window, RAG bridge and existing mobile/source projections.
- Permanent guardrail check PASS; git diff --check PASS.
- Existing real 4 Nov 11:45–12:45 CORE responses rendered locally: NIFTY 23800 produced six charts (~190ms), SENSEX 76900 six charts (~107ms; other expiry quotes unavailable), BANKNIFTY 55500 four charts (~41ms). This is one-hour source readback, not full-day coverage or mobile performance proof.
- Added full-session premium assertions to the existing 360/390px synthetic browser smoke and wired the renderer test into recorded CI. Chromium was downloaded but local launch was blocked by `socket() failed: Operation not permitted`; browser visual acceptance remains pending. Do not report screenshots or mobile acceptance as passed.

## Remaining acceptance
1. Run remote final-head CI and 360/390px browser checks after authorized publication.
2. Inspect a complete eligible source day from 09:15 through EOD; display gaps wherever recording is partial. Measure full-day payload, rendering cost and mobile usability.
3. No source interval OHLC exists in the inspected replay schema. True candles require a separately verified saved OHLC source; this implementation correctly retains sampled lines.
4. Multi-DTE PDL event/outcome and leader ranking designs remain separate, unimplemented increments.
5. Keep draft; obtain the release decision before merge/deploy. User explicitly authorized publication of code and recorded-data evidence with “Yes push” on 4 Nov 2026. This authorizes branch publication, not production merge/deployment.
