# DATA annex: read-only restructure

Audited main: `0f9d9849e76dfe2a7adf87cdec0e86c5e71a3fd1` (PR #620).

| Disposition | Existing source / change |
| --- | --- |
| REUSE | business-dashboard-v1-view.ts, replay and recorded-date APIs, memory session cache, OI journal, premium PDH/PDL and wall migration transforms, full-chain PCR, Kite stock/sector snapshots, EOD descriptive session summary |
| PATCH | Three primary modes; exact interval display; automatic previous recordings; collapsible raw evidence; mobile layout and data-change colours; dashboard CI focused tests |
| NEW | Pure presentation composition helper and focused tests; no persisted state or authority |

INTRADAY uses Current, exact 3m, exact 15m, and exact 09:15 sampled From Open references. Missing endpoints stay unavailable. PDH/PDL crossings retain their observed intervals; first-outside observations are labelled separately. No interpolation, nearest-point substitution, or new significance thresholds.

SWING excludes the running session. One-, three- and five-session changes use completed recorded session endpoints with six previous sessions loaded through existing replay APIs/cache. Missing exact contract endpoints do not move the baseline to a different day or identity. Contract key is symbol + expiry + strike + option type. PCR and walls stay expiry-specific. Futures cross-day comparisons are withheld because replay does not expose futures contract identity.

MEMORY connects the latest earlier recorded session to the selected session, even when today's recording is unavailable. Unchanged endpoints are labelled as endpoint equality, not continuous persistence. EOD notable premium/wall events reuse recorded transforms. The existing EOD endpoint supplies descriptive session values only; its `spotClose` is displayed as a sampled last observation with `lastObserved`. Neither its fallback open nor ranked research transitions enter this UI.

Heavyweight/sector breadth reports returned quote subsets vs previous close with response timestamps. It explicitly remains a separate snapshot: exchange freshness and historical alignment are unavailable. There are no breadth swing comparisons.

Recording cadence, APIs, auth, database, selector, Business Card, Telegram and execution paths are unchanged. The main dashboard's annex wiring remains unchanged.

Validation: 18 local dashboard/composition/refresh tests pass; production dashboard proof tests pass (3); all existing Devil Gate run steps pass, including npm test. The full regression suite's runtime wiring scripts generate temporary server/Telegram edits; these were discarded, and are not part of this change.

Limitation: browser screenshot/layout validation could not run in this environment. Playwright's browser executable was absent and its browser download returned a truncated archive. Mobile layout needs visual owner review before merge/deploy. DOM/script execution and navigation are covered by the refresh tests, but do not establish visual layout.

Owner explicitly approved branch publication and draft PR creation on 2026-10-08. Publication uses the connected GitHub API because this environment lacks CLI push credentials. GitHub-hosted CI results are tracked on the draft PR. Merge/deploy require separate owner approval. No merge, production config change, or deployment was performed.
