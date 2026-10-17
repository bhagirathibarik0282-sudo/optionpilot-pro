# Scrolling: production root-cause audit — 2026-10-17

Status: PARTIAL. The cause was inspected in the actual production browser after
two earlier bounded presentation fixes failed to remove the scrolling symptom.
This is structural layout work, not another prose-only patch.

## Observed production baseline

Browser viewport: 1363 × 936 CSS px. These are desktop measurements, not mobile
proof. Every one of the 13 chapters still displayed an unrelated global
`statistical-overview` section outside `market-book`: 431 px tall, containing
Spot, full PCR, exact premium and exact OI statistics. Prior changes scoped to
chapter content did not reach this sibling section.

| Chapter | Page height | Main chapter top |
| --- | ---: | ---: |
| Overview | 3064 | 1135 |
| Spot + pivots | 2399 | 1070 |
| Premium comparison | 2749 | 1135 |
| Four expiries | 1879 | 964 |
| Futures | 2659 | 1070 |
| OI + walls | 3919 | 1135 |
| Notable changes | 3515 | 964 |
| Premium behaviour | 2433 | Independent workspace |
| Sectors + stocks | 2596 | 1070 |
| Spot + full PCR | 3044 | 1135 |
| FII / DII | 2942 | 964 |
| India VIX | 2298 | 1070 |
| Combined context | 2657 | 1135 |

Other observed causes: large repeated hero/ticker, several separate closed tool
panels before chapter navigation, full three-index placeholder dashboards even
without a recording, and four cash-window cards (1D/3D/5D/20D) rendered at once.
Each cash-window card was 432 px tall at the measured desktop size.

## Structural repair

- Global statistics, session/raw/source panels are inside one closed Advanced
  tools drawer. They no longer extend the default chapter page.
- Live feed controls, ticker, RAG, session/expiry settings, data health and replay
  are inside one closed Tools drawer. Live quote delivery is not paused by this.
- Display/source settings are collapsed. The large hero is replaced by a short
  workspace/feed heading; the duplicate global ticker is optional.
- Completely empty recorded chapters show one concise state, keeping any actual
  prices, OI or stored levels when available. No missing value becomes zero.
- FII/DII shows one selected cash-window card, with a selector for every existing
  window. No cash data or dates are changed.
- Chapter changes return to the workspace start. Existing live expiry/strike
  shortcut opens the containing Tools drawer before revealing its controls.

Validation: exact Business Dashboard V1 workflow 193/193 PASS; generated HTML
ancestry check confirms optional nodes are inside their closed drawers and main
chapter content is outside Tools; no duplicate IDs; embedded scripts parse;
permanent guardrails and diff check PASS. Data, calculations, network requests,
recorder, storage, candidate, Telegram and broker/configuration are unchanged.

New-layout runtime height and desktop/mobile appearance remain NOT_PROVEN until
an approved merge/deployment. Before/after height claims must use an actual
browser measurement; no reduction percentage or mobile success is claimed here.
