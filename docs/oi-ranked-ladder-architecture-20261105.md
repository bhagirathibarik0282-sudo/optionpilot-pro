# OI ranked CE/PE ladder — architecture and acceptance

Status: implementation ready for review. This feature has not been merged/deployed by this work item.

## User-facing structure
- CE on the left, strike in the center, PE on the right. Default ATM +/-7, selectable +/-3 and +/-5, no pagination inside the selected band.
- Total OI, positive window addition and negative window shedding have independent per-expiry/per-side competition ranks. Ties share a rank (1,1,3). Top-five chips cover the eligible source universe before viewport filtering; tapping a chip centers that strike. Center ATM restores the spot-based viewport.
- Each cell combines snapshot premium, OI, signed OI change and percentage, premium change and percentage, rank change and available premium PDH/PDL state. Source times and levels expand on demand. Source OI units are explicit; no unverified lots/quantity conversion.
- One existing comparison window for each workspace: 1/3/5/6/15/30m and From 09:15 in the OI workspace, or 1/3/5/15/30m/From 09:15 in the after-hours archive panel. Existing 6m view is retained.
- Live ladder is placed immediately below its comparison controls, before supporting wall/research cards. The archive has a direct OI jump link and places OI before full-session premium charts.
- Sticky ladder headings and bounded vertical scrolling, responsive three-column cells, no horizontal document overflow intended. Addition/shedding have color plus text labels. No fabricated probabilities or directional scores.
- Ladder selection remains in the OI workspace, removing its previous automatic jump to another premium panel. Existing explicit navigation remains available.

## Shared architecture
Existing live feed -> existing qualified OI snapshot projection -> pure rank model -> shared ladder renderer.
Existing recorded session and shared cursor -> exact snapshot/receipt adapter -> the same rank model and renderer.

`oi-ranked-ladder.ts` contains:
1. `recordedOiRankFrame`: admits exact symbol/date/expiry/strike/side/time rows with TRUE markers, unique saved identity, matching market snapshot and quote receipt freshness -5 to +30s. Receipt time, rather than the beginning of the minute bucket, controls premium freshness.
2. `deriveOiRankedLadder`: deterministic per-side rankings, exact lookback, immutable inputs, safe nonnegative integer OI, independent price qualification, token/session boundaries, stable-universe rank movement and explicit missing baseline handling. Sorting is O(n log n); rank lookups use maps.
3. `renderOiRankedLadder`: one display for live OI workspace, its recorded replay and after-hours recorded dashboard. No provider calls, persistence or candidate authority.

4. `paintOiRankedLadder`: preserves the viewed strike/relative offset when row heights change, pixel scroll when they do not, and expanded source details across heartbeats, centers ATM or an explicitly selected strike only on viewport changes, and never scrolls the whole dashboard.

## Source boundaries
- The existing bounded UI repaint timer also revokes the ranked view after 4 seconds without payload delivery; it introduces no network polling or trading scheduler.
- Live OI comes from the existing qualified full-expiry snapshot; no extra subscription, REST polling or broker requests. Snapshot premium has its own last-trade timestamp; it is not relabeled as the latest tick. Existing independently qualified tick-OI pulse remains separately labeled.
- Recorded ranking covers admitted returned archive contracts only, not a guaranteed complete exchange chain. Stored OI does not expose its actual publication timestamp, so the panel says saved snapshot OI / publication time unavailable; LTP freshness does not establish OI freshness.
- Live PDH/PDL is unavailable in this OI source and is explicitly withheld. Recorded levels are stored values, not newly inferred levels.
- Absolute OI additions/shedding determine rank; percentage change is context. A zero baseline has no percentage. OI cannot identify whether buyers or writers initiated positions.
- Rank movement is withheld when the eligible universe or token identity changes. Each expiry, side and index remains separate. No simultaneous multi-expiry freshness/alignment claim is introduced.
- From Open requires the actual 09:15 snapshot. Live keeps a bounded opening-snapshot map separately from its existing 35-minute history. Mid-session connections do not synthesize an opening baseline; disconnect/runtime changes clear it. Conflicting opening cycles revoke that baseline.
- Shared replay cursor prevents future price/level lookup. Missing context withholds that value rather than erasing otherwise valid OI observations.

## Validation
157 focused local tests passed; permanent guardrails and whitespace checks passed. Includes ranking arithmetic/ties/zero OI, missing baseline, side separation, stale price versus stale OI, token/expiry/runtime boundaries, opening retention/reset, changed-universe ranks, source escaping, receipt-clock freshness, source adapters, no extra reads on UI controls, replay look-ahead and existing premium/mobile projections.

Bounded real recorded readback: 4 Nov 2026, 12:24 to 12:27 IST, selected nearest expiry on each index:

| Index | Expiry | Eligible CE / exact 3m pairs | Eligible PE / exact 3m pairs |
|---|---|---:|---:|
| NIFTY | 9 Nov | 15 / 14 | 15 / 14 |
| SENSEX | 5 Nov | 15 / 14 | 15 / 14 |
| BANKNIFTY | 23 Nov | 12 / 12 | 11 / 11 |

Each admitted current endpoint retained a valid premium after checking its actual market receipt. This is a bounded archived sample, not a live-market result, full-day outcome test or proof of exchange OI publication freshness. Render timings were approximately 7–37ms on this machine for these samples; real mobile performance is a separate acceptance item.

A new isolated synthetic browser CI exercises live and recorded ladders at 360px, 390px and 1280px: focus/range changes, top-strike centering, ATM reset, disconnect revocation, shared replay reset, source labels and document overflow; screenshots are retained as CI artifacts. Browser results are pending until observed.

## Release scope
No storage migration, new server endpoint, credentials, Telegram, candidate ranking, execution or operating-window change. Existing market runtime remains under its current schedule. Ranking alone does not promote a candidate or create a trading action. Final-head CI/browser verification and live runtime acceptance are required before claiming this feature works in the live market.

## PCR / Premium / All display extension

The shared ladder now has OI, PCR, Premium and All display buttons. All is the initial selection. Each workspace keeps its selected display through heartbeats and comparison/range changes, using local DOM state without extra network reads. CE and PE remain on either side of the strike.

Full-expiry PCR uses the existing qualified live snapshot or a unique exact-cursor archived chain with approved full-chain provenance and matching snapshot identity when supplied (the normalized archive does not expose that optional field). Strike PCR is PE OI / CE OI for the same expiry, strike and cursor; missing sides and zero CE OI withhold the ratio. Its change requires both eligible comparison endpoints and unchanged live token identities. PCR uses gold and numeric arrows without assigning a bullish/bearish meaning.

Premium, OI change and OI rank movement have independent arrows. Premium change uses green/red, PDH is green and PDL red, and the visible range note is yellow. Exact touches are labeled AT PDH / AT PDL; invalid or reversed levels and unavailable live premium levels remain unavailable. Existing source restrictions and live freshness expiry still apply.

Validation for this extension: 68 focused tests and permanent guardrails pass locally. The browser acceptance script now checks all display buttons, display persistence across heartbeats, source labels, range notes and visibility at 360/390/1280px. Browser release checks must pass before deployment.
