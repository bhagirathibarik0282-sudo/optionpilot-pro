# Chapter-focused content — 2026-10-17

The shared live strip and four-parameter reading guides repeated unrelated
Spot/PCR/VIX or premium cards across specialist chapters. The presentation now
uses each chapter's subject instead of filling every chapter with market context.

| Chapter | Primary live context |
| --- | --- |
| Overview | Three-index market overview |
| Spot + pivots | Spot, previous close and day change |
| Premium comparison | Selected exact CE/PE price and OI |
| Four expiries | No generic single-expiry strip; own recorded expiry cards retained |
| Futures | Futures price, OI, volume and basis |
| OI + walls | Exact option OI, full PCR, call/put walls |
| Notable changes | No current-value strip above recorded events |
| Premium behaviour | Existing independent premium workspace only |
| Sectors + stocks | Stocks/sectors breadth and quote details only |
| Spot + full PCR | Three-index spot/PCR comparison |
| FII / DII | EOD cash only; generic live strip and index-overview cards removed |
| India VIX | VIX only; unrelated recorded premium-context card removed |
| Combined context | Cross-parameter comparison remains appropriate here |

Reading-guide facts follow the same chapter subjects instead of requiring four
metrics. Scope labels no longer display option expiry/strike for non-option
chapters, and irrelevant settings are hidden. Live expiry/strike controls appear
only for chapters using those contracts. Spot/futures source drawers no longer
include the shared unrelated CE/PE context.

No source, calculation, live cache, freshness/identity/PCR guard, recorder,
storage, candidate, Telegram, broker or configuration changes. Removed strips do
not convert recorded charts/events/EOD cash into live data; existing source labels
remain. Optional premium PCR/VIX context remains available through its own layer.

Validation: Business Dashboard V1 workflow command 191/191 PASS, including
chapter-content exclusions, navigation/shell visibility, source immutability,
independent controls and all existing live freshness/identity/PCR checks. Embedded
scripts parse. Guardrails and diff checks PASS. Actual new desktop/mobile visual
proof and deployment are NOT_PROVEN; status PARTIAL.
