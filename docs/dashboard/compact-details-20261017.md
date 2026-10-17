# Compact chapter details — 2026-10-17

The mobile screenshot showed repeated missing-value, alignment and provenance
paragraphs above an empty Spot/PCR chart. The old Hide-notes preference covered
only explicitly tagged explanations, leaving most of that prose visible.

All 13 chapters now start with secondary details hidden, independently of a
saved global Show-notes preference. One accessible Details Show/Hide button
reveals them without re-rendering values, changing filters or requesting data.
Existing collapsed evidence drawers remain usable. Main numbers, identity,
source badges, charts and empty-data status remain visible. Recorded PCR keeps
a short missing/coverage-unverified badge instead of its long proof paragraph.

- Source/reason notes, baseline prose, duplicate delta text and supplementary
  endpoint explanations are hidden in the compact chapter/chart view.
- Data health starts in a closed Data status drawer.
- Independent chart mode/range/SH/SL/15m controls and premium chart layers start
  in closed Chart settings drawers; all control IDs and handlers remain.
- Live cards retain short quote-state/source-time, cadence or coverage stamps;
  long provenance/receipt explanations become optional. MARKET_CLOSED and
  unavailable connection state remain visible.
- Repeated premium archive/reference guidance is optional. Existing premium
  filters, numeric layers, contract state, timestamps and actions are retained.

Validation: exact Business Dashboard V1 workflow command 190/190 PASS,
including navigation and Details toggling across all 13 chapters with unchanged
values, selections and source records. Existing live stale/identity/PCR tests
pass. Embedded scripts parse. Guardrail and diff checks PASS.

Status: PARTIAL. Source and regression checks completed. Actual desktop/mobile
visual validation and production deployment of this change are NOT_PROVEN.
No data, calculations, candidate, broker, Telegram, storage or configuration changes.
