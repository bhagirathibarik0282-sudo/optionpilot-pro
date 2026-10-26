# Research notable events — 26 October 2026

Research overview adds section 6 for the selected index and CE expiry. It reuses
the existing market-book notable-event groups and category filter: premium
PDH/PDL observations, sampled opening-range crossings, recorded PCR changes,
selected-pair OI changes and wall migrations. No new event detector, threshold,
query, broker call or database write is added.

The compact table retains previous/event times, original observation title,
exact response-contract identity, event-time spot and independently sourced PCR
context. The latest 10 retained events per category feed the latest 12 combined
rows. Displayed count and full loaded-session detected count are distinguished;
the selected endpoint comparison window is not a session-event filter.

An optional evidence drawer reuses original event details and exact subsequent
premium targets. After-event responses are explicitly retrospective research,
not event-time knowledge, causal proof or a probability. First observed outside
a level does not establish a crossing across a gap. Missing event/target quotes
remain missing; no alternate strike, expiry or nearest time fills them. No
O=H, historical similarity, RAG match or numerical probability is inferred.

Validation: 179 related local tests passed. A serialized-script fixture verifies
category filtering/persistence, an event on a nonselected strike retaining its
own response contract, missing opposite-side event premiums, missing/pending
forward targets, bounded-list disclosure and zero added requests. Patch
whitespace check passed. These are synthetic code/VM checks, not actual-archive
event validation or browser/mobile acceptance. Main remains undeployed.

Research now has six sections. Matched-history / Memory & Replay integration,
actual history validation, visual acceptance and main rollout remain unfinished.
