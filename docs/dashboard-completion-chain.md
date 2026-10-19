# Dashboard completion chain — 2026-10-18

Scope: dashboard only; Telegram integration paused. Reuse existing chapters,
sources and candidate authority. Keep progress reports short and run focused
checks. Merge/config/production actions require the applicable user authorization.

| Order | Work | Evidence / remaining acceptance |
| --- | --- | --- |
| 1 | Production recorded Full PCR | COMPLETE. #720 merged as c7a5c48930c0794bbf5925004d00a1c0e976882f; Railway deployment SUCCESS. Production RAG readback reproduces PCR below. |
| 2 | Recorded wall provenance | COMPLETE for the inspected case. #721 merged as ddd51e7e3f7764c17068ae05040b917689322371; production deployment SUCCESS and RAG readback verified. Source labels and quote times exposed; no full-chain wall claim. |
| 3 | Chapter-specific alignment | Closed-market checks complete: 13 chapter navigation routes opened; all six agreement categories exercised, including NIFTY→SENSEX expiry/strike changes and explicit incomplete futures evidence. 45 focused checks passed. This does not certify every recorded row or live-market behavior. |
| 4 | Paired premium ladder / exact-contract watch | IMPLEMENTED locally, pending review/release. Existing Layout selector gains a paired CE/PE current-page view. Lock watch persists exact index/expiry/strike/side, constrains existing requests and filters, blocks identity changes until Unlock/Reset, and never substitutes for missing data. |
| 5 | Mobile and live acceptance | PENDING. Browser checks covered premium selection, expiry, Ask RAG and 09:21→09:24 recorded replay. Actual mobile layout and market-open freshness remain unverified. |

## Wall evidence readback

Read-only existing `/api/research/h1-replay`, NIFTY, 2026-10-16,
15:27–15:30 IST, FULL scope, compact format. SHA-256 of the received payload:
`78c112c58eab04b6782f7d7cc5a6b0b217958eba7ccc30ca049373e3b48bf2f6`.
Wall adapter was evaluated locally against that payload and subsequently verified through the deployed #721 RAG endpoint.
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

## Exact-contract watch / paired ladder acceptance

No additional endpoint, source, chapter, subscription, timer or trading authority.
The watch freezes identity, not price: existing freshness checks, cursor and
source selection remain active. An absent exact contract stays unavailable.
Changing date or switching Live/Recorded retains the lock; Unlock keeps the
current filters, while Reset clears them and the lock. Reload restores only a
validated exact identity from the existing local preference store.

Ladder pairs exact index + expiry + strike within the current displayed page.
Each side retains its own price, reaction, state and source time. A filtered side
is labelled Side filtered; an unloaded sibling is labelled Not loaded on this
page. Different side timestamps are explicit. Page limits remain 12 contracts;
this does not certify complete paired or exchange-wide coverage.

Validation: complete existing Business Dashboard CI command: 263 pass / 0 fail /
0 skip; guardrails and diff checks pass. Tests exercise serialized view events,
lock restore, bounded exact live requests, disconnected/missing data, identity
change rejection, replay cutoff, date changes, release/reset, malformed stored
locks, independent side times and cross-expiry/index separation. Browser visual
acceptance for these new controls and market-open live acceptance remain pending.

## Fresh-entry defect found from the user's mobile screenshot

Earlier navigation checks used an already-loaded October 16 session and did not
certify the cold-start path. On Sunday October 18, startup instead selected the
empty current date. Chapter 6 independently defaulted to its Live OI workspace,
showing Waiting and unavailable strikes while saved records remained elsewhere.

Correction prepared locally: startup chooses the latest valid saved date no
later than today in IST. Chapter 6 defaults to recorded mode with the latest
recorded option cursor when the session is historical or the regular observation
window is closed, unless the user has explicitly selected a mode. Disconnected
Live shows one Open saved records action and hides its empty live-card workspace.
Recorded and Live remain explicitly separate. No fallback invents live prices,
Max Pain or full-chain completeness. Existing recorder, cursor and timers reused.

Validation: actual serialized startup callback tested for Sunday, market-open
same-day availability, missing current session and IST midnight. Serialized OI
view/controller tests verify populated recorded entry, latest cursor, explicit
Live preservation and saved-record recovery. Complete dashboard CI: 266 pass,
0 fail, 0 skip; guardrails and diff checks pass. This correction is pending
review/release; no post-release visual acceptance is claimed yet.


## Index dashboard completion pass — 19 October evening

Commodities are PAUSED at user request. Existing commodity placeholders are unchanged.
Dashboard only; no Telegram or seller execution changes.

Implemented in this pass:
- Command card lists all 13 existing numbered chapters. Opening a hidden chapter
  through a shortcut restores its navigation entry; premium shortcuts do likewise.
- Separate Show / hide controls for the three-index summary, ATM CE/PE expiry pairs
  and the chapter index. ATM starts collapsed to reduce initial mobile scrolling.
- Explicit Open recorded ladder action, with a market-closed explanation instead of
  an unexplained waiting table. A login failure remains a distinct state.
- Existing Sectors + stocks chapter exposes the live participation panel, including
  separate top-five gainers and losers for stocks and sector proxies. Price,
  percentage and source time are shown. Rank is by change percentage over the
  tracked subset; stale, duplicate and invalid-price quotes cannot rank.
- Existing one-stop regressions are now included in dashboard CI. Test VM setup
  supports the transpiler's function-name helper; static assertions read the source
  rather than depending on transpiler quote/whitespace formatting.

Reused existing features, not newly implemented or newly certified:

| Feature | Existing implementation | Acceptance limit |
| --- | --- | --- |
| Three-index spot / futures / PCR | Shared Kite stream and exact-expiry PCR sampler | Open-session coverage still unverified after #755 |
| CE/PE side-by-side, individual view, four expiry dates | Premium workspace / ATM expiry pairs | Only subscribed, verified contracts; omitted expiries stay explicit |
| PDH/PDL, FIB, O=H, break time and recovery | Exact-contract premium layers and observed events | Missing dated references remain unavailable |
| 3/5/7/15-strike layouts, live / recorded, replay | Existing premium controls and stored snapshots | No history is fabricated to fill gaps |
| Multi-day, exact-contract watch, RAG | Existing recorded/research tools | Limited to available recorded evidence |
| Mobile Show/Hide and numbered navigation | Existing workspace plus this pass | Real-browser acceptance recorded separately |

Source-dependent work is NOT declared complete:
- Verified constituent/sector weights and index-point contribution are not present
  in the shared quote source. Percentage ranking must not be called weight ranking.
- Exact premium-following-futures claims need matching contract identity, synchronized
  endpoint observations and a defined comparison window. Recorded futures continuity
  is explicitly unverified today; same-day percent changes do not establish this.
- Market-open live freshness, full OI coverage, wall migration and all-expiry events
  still require source evidence. After-hours HTTP 200 does not certify these.
- A final expiry time/countdown must use verified exchange/session identity; a plain
  expiry date must not be represented as an independently verified remaining time.


## Actual One Shot live card — 19 October evening

The earlier #757/#758 release improved the old command card but did not ship
this design. This implementation REPLACES the old top-level command-table panel
with the approved One Shot visual hierarchy, gradients, three-index radar,
Spot / PCR pulse, VIX panel and prominent multi-expiry CE/PE ladder.
The original evidence table moves under 10 · Sources / tools.

| Category | Actual source / behavior |
| --- | --- |
| 01 Radar | Existing shared Kite spot/future quotes; current-session recorded PDH/PDL and broker previous close; no invented reference levels |
| 02 Pulse | Actual received spot/PCR samples only; 1/3/15/60m view; independently labelled axes; actual recorded first-15m sampled H/L when available |
| 03 Premiums | Existing exact-expiry ATM pairs, CE/PE toggles, PDH/PDC/PDL/FIB controls, observed break rows; calendar DTE is not an expiry-time countdown |
| 04 Futures response | Exact live future identity and premium expiry/strike/side; endpoints aligned within 5s, sampled baseline within 15s; reports co-movement, not causal/exact following |
| 05 OI / walls | Existing strict full-PCR validator, band ratio, CE/PE OI totals and same-expiry baseline deltas, wall strikes/OI and fresh futures OI |
| 06 / 07 Ranks | Fresh, unique quote-token subset; price and % vs own previous close; separate top-five gainers/losers; no unverified weights/contribution |
| 08 VIX / agreement | Fresh VIX and day return; actual freshness/coverage counts; existing strict synchronized PCR-change classification |
| 09 Memory / events | Observed spot-level crossings with source time and same-side three-index badge only within 5s; recovery revokes active badge; existing recorded/multiday/RAG actions |
| 10 Tools | Existing 13 numbered chapters and verified-value evidence table; detailed provenance stays expandable |

No extra provider calls, EventSource, timers, database storage, Telegram, trading
or commodity work. All new rendering uses the existing context event. Display
history is bounded to 48 series × 600 real samples, sampled no more often than
10s per source series; session/runtime/expiry changes and stale sources revoke
incompatible history. Opening rank panels paints the latest snapshot; collapsed
rank DOM stays idle. Reading decoration excludes this explicitly styled live
subtree to avoid per-tick font measurements or automatic table reshaping.

Outstanding source limits remain visible: missing prior-session futures identity/
levels, broker IV and official weights cannot be fabricated. Browser-local pulse
history starts on connection; saved replay remains explicitly recorded. After-hours
release acceptance cannot certify market-open full-chain coverage or all live events.
