# Premium chapter reuse audit — 2026-10-18

Scope: dashboard only. Status: PARTIAL; source inspection and automated checks are distinct from live-market acceptance.

| Need | Existing implementation | Gap / action |
| --- | --- | --- |
| Index, expiry and DTE selection | `premium-workspace-view.ts`: index, expiry chips, DTE buckets; `market-book-view.ts`: independent CE/PE expiry settings | Reuse controls. Show exact expiry dates and calendar DTE on chips. |
| CE/PE strike selection | Separate fixed strike filters; explicit strike overrides the ATM range | Preserve filters. Make a selected but unloaded strike visible instead of a blank dropdown. |
| Strike range | 3/5/7 total strikes around each loaded expiry's nearest observed ATM | Label as ATM ±1/±2/±3, up to 3/5/7 strikes. These are not ±3/±5/±7. Wider ranges require separate consideration of existing live bounds. |
| Compact display | Existing cards/table toggle, optional OI/IV/liquidity/context layers | Reuse. Do not create another premium chapter. |
| Premium ladder | Existing premium filters/table; separate OI/wall studio ladder | A paired CE/PE premium ladder and its exact-contract watch lock are separate from the OI ladder; do not claim the full planned ladder is complete. |
| Fixed contract continuity | Contract model keys include index, expiry, strike and side; chart and Ask RAG retain identity | Fixed strike filters can apply to several selected expiries. They are not a separately frozen one-contract watch. |
| Recorded dates and replay | Saved session picker, FULL replay load, saved-bucket cursor/playback, source rows | Reuse; inventory must respect the same cursor. |
| RAG, multi-DTE, same-DTE | Recorded Ask RAG; expiry comparisons; PRs #716/#717 historical API and view | Reuse, with context matching still incomplete. |
| Available series and coverage | Previously global expiry/strike lists; live inventory bounded to existing capacity | Add metadata grouped by index + exact expiry, with CE/PE identity counts and fixed-strike presence. Counts do not certify fresh quotes or exchange-wide completeness. |
| Weekly/monthly classification | No verified series-type field found in inspected live inventory or normalized recorded contract rows | Keep UNVERIFIED. Do not infer from weekday or label all four expiries weekly. BANKNIFTY's monthly observation policy is not proof of an individual contract's series type. |

## This change

One pure identity inventory function is shared by the recorded model and existing live premium cache reader. It deduplicates exact side/strike identities within index/expiry and computes calendar DTE from the selected session date. It reads no prices and creates no new data source, database, subscription, timer or candidate authority.

Live inventory metadata precedes quote pagination, so a page of 12 quotes does not masquerade as all available series. Existing capacity and omitted-expiry reporting remain in place. Recorded metadata uses only rows supplied up to the replay cursor. Both are labelled as loaded identities, not fresh-quote coverage. The table is inside the existing collapsed Watch filters, under closed series details.

Fixed strike availability means the identity is loaded, not that it has a fresh price. A missing fixed strike stays selected, is labelled not loaded, and does not fall back to ATM. Index changes retain the existing intentional reset. A strike can still be selected across several expiries; a separately frozen exact-contract watch remains future work.

## Devil Check

- Independent indices/expiries; CE and PE pins checked separately.
- Duplicate identities counted once; missing side stays zero.
- Invalid calendar dates rejected; valid PostgreSQL Date expiry accepted.
- Metadata stable across live quote pagination and price staleness.
- Replay cursor does not reveal an expiry only recorded later.
- Missing fixed strike is visible and does not become a different premium.
- Serialized browser functions include their shared helper.
- Reuse existing live/recorded separation, expiry capacity and read-only authority guards.

No new IV/OI/PCR/wall or max-pain matching is claimed. No Telegram integration or execution changes are included. This branch is not deployed.
