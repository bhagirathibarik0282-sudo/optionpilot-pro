# Dashboard improvement sequence

Scope: screenshot review of the recorded NIFTY/SENSEX/BANKNIFTY reference
screen on 28 October 2026. This is a view-layer audit, not proof that all
underlying recordings are complete. Do not infer ingestion failure from an
unavailable field or a selected historical cursor.

## First implementation batch

1. **Selected-index identity — implemented.** Selecting a reference index
   synchronizes the actual recorded research source. Events and memory carry
   source-index metadata and the screen rejects mismatched contract rows.
   Unknown/missing source identity yields an explicit empty state, never the
   previous index's evidence. No additional broker/API calls are introduced.
2. **Expiry availability — implemented.** Listed expiry placeholders no longer
   count as usable coverage. Report admitted displayed prices and unique
   same-strike CE/PE pairs separately. CE-only/PE-only filtering is explicit;
   full-chain inventory completeness and source-time alignment are not claimed.
3. **Withheld headline explanation — implemented.** Keep existing TRUE-only
   headline gates. Show the latest recorded bucket and validation reason when
   the price is withheld; do not fill it from another endpoint or an unverified
   table. This explains the SENSEX blank header without weakening data gates.
4. **Selected futures identity — implemented.** Look up the selected index's
   futures row by identity and column labels instead of reading a fixed row.
   Filter fallback level rows to the selected index. Label window/day changes
   explicitly and replace decorative parameter checkmarks with navigation arrows.

## Next batches, in order

5. One explicit replay cursor and per-section source clocks; reject unsupported
   claims of simultaneous observations. Preserve missing exact endpoints.
6. Recorder completeness from bounded source-backed counts: first/last stored
   minute, expected/observed buckets and gaps. Separate partial user selections
   from collection gaps; define expected calendar/session bounds first.
7. Missing-data reason taxonomy from actual source states. Do not guess expired
   contracts, provider failures or unavailable authorization from a dash alone.
8. Mobile reading mode with readable type, per-section horizontal scrolling,
   usable controls and visual QA on phone-sized viewports. Retain the desktop
   reference layout as an option rather than scaling it down by default.
9. Source-backed heavyweight/sector availability and quote-only fallback when
   verified constituent weights are absent. Never invent contribution weights.
10. Visible FII/DII publication date, stored date and collection status; cash and
    derivatives remain separate. Preserve the independent 20:30 IST cron job.
11. Event deduplication, exact contracts, explicit before/after response windows
    and honest controls. A navigation button must not masquerade as a filter.
12. Historical matching and synchronized charts only from sufficient verified
    recordings. Show match dates/sample counts and unavailable evidence; do not
    fabricate win rates, correlations, confidence scores or missing observations.

## Release and cost constraints

Existing recorded data and existing shared streams are the first source.
Do not add per-refresh AI calls, new polling loops or duplicate broker requests.
The app's production branch is separate from main. This dashboard batch must
not restart the recorder during market hours. Merge/review can happen then;
production release follows the existing after-hours release procedure and
must be followed by real runtime/selection verification.

Maintain tests for index switching, source mismatches, empty/partial inventory,
duplicate legs, CE/PE-only views, unavailable headline evidence and wrong-index
futures rows. Broker credentials are not needed for these view-level checks.
