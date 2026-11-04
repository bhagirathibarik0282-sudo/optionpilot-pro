# Front dashboard PCR source projection

Status: PARTIAL. Source projection fixed and locally tested; deployment and
new-head browser acceptance remain pending.

The user's screenshot shows the existing recorded research source tables. Those
tables and the compact front page are different projections. The source tables
can contain archived values while the front page is in LIVE mode. Archived
values must not silently become current live observations.

Three concrete projection defects were identified:

1. The front page's CE/PE totals come from `os-wall-ladder`, which only rendered
   `current` fresh totals. Validated reported CE/PE totals were omitted.
2. The front PCR table retained a `Fresh Full PCR` heading in recorded mode.
   In live mode its primary numeric column could be blank while the usable
   reported observation was relegated to a secondary context column.
3. The compact page ignored an already-admitted `.os-pcr-recorded` fallback in
   the source card. The archived number could be visible in Sources but absent
   from the front. The existing source selector was also buried in Settings.

The front table now shows one primary Full OI PCR and a separate explicit source:
FRESH SNAPSHOT, REPORTED / MIXED SOURCE TIMES, EARLIER PACKETS with source date,
RECORDED with its saved clock, or UNAVAILABLE. Recorded mode uses the heading
Recorded Full PCR. Source and value disappear together when revoked. The
collector's freshness eligibility, comparisons, arrows and trade authority do
not change.

Reported CE/PE totals now reach the existing source table and compact projection,
with their reported/mixed-time label retained. Delta and wall evidence still
require their existing fresh provenance; they are not inferred from reported
totals. Real zero PE OI remains visible. No totals are reconstructed from a PCR.

Live and Saved buttons on the front toolbar call the existing `os-source`
selector. They do not issue a new broker request or load arbitrary sessions.
If a saved date is not loaded, the existing Open Data action is still required.
The seven source tables, chapter filters, default Fit page and Read chapter
behaviour are retained.

Validation:
- Three initial regressions failed before the implementation: reported total
  projection, recorded heading and front source selection.
- 187 related sampler, display, identity, recovery, audit and historical parity
  tests pass, zero failures/skips.
- Additional tests cover source-card saved fallback, revocation, empty numbers
  never claiming fresh eligibility and zero PE OI.
- Existing Chromium mobile smoke updated to assert source switching, primary
  reported values and explicit earlier-packet labels at all existing viewports.
- Permanent guardrail checker and whitespace checks pass.

This patch does not create missing PDH/PDL, history or other broker fields.
It fixes the omission/mislabeling of observations already admitted by the source.
