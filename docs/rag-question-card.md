# RAG question and evidence card

Status: **PARTIAL** — implemented and locally checked; this UI has not been released or visually verified in a real browser.

The DATA Market Book now includes a collapsed navy/gold **RAG evidence** card directly below its heading. The same card has a standalone mobile page at `/api/research/rag-event-evidence/view`, linked from the existing DATA tools. It uses the existing read-only exact-event backend released in #670.

## User flow

1. Type a question with index, session date, expiry, strike, CE/PE and event time, then choose **ପ୍ରଶ୍ନରୁ selection ଭରନ୍ତୁ**. The parser fills visible editable fields; missing/ambiguous fields are listed, and stale previous values are cleared.
2. Check/fill the exact fields and choose **Evidence ଖୋଜନ୍ତୁ**. Fields can also be entered directly without a question. The example button fills the verified 13 October NIFTY event; it never triggers a request automatically.
3. The card shows the exact identity, Odia event answer, reconciled PDH/PDL, pre-event/at-event CE/PE and market context. Future historical outcomes appear only after explicitly selecting the checkbox. Cutoff is an optional IST datetime. Source hashes, receipt/quote times and full-PCR provenance are expandable. Historical data are explicitly dated and never presented as current live quotes.

Example: `NIFTY 22300 PE date 2026-10-13 expiry 2026-10-13 time 09:36ରେ କଣ ହେଲା?`

English and Odia date/expiry/time labels, Odia numerals, ISO or DD/MM/YYYY dates and explicit AM/PM times are recognized. `BANK NIFTY`, `CALL` and `PUT` normalize to exact canonical fields. This is bounded structured field extraction, not semantic similarity, a language model, or arbitrary question understanding. Generic questions such as “What happened today NIFTY?” require the missing fields; expiry, strike and event time are never inferred.

## Interaction and data safety

- No load-time request, polling, new recorder, database write, broker/model call, or trading authority. Only a manual GET to the #670 endpoint is made.
- The RAG selection is explicitly independent of the Market Book's existing chart selection. No shared recorder/refresh state is modified.
- Editing the question clears old contract fields, cutoff and outcome choice. Extraction resets cutoff/outcomes. Changing any selection clears the result, aborts the previous fetch and invalidates late responses. Only one request is active; a 45-second abort timeout prevents indefinite UI loading.
- API rejection, missing contract/reference, absent crossing, cutoff blocking and network failure remain visible. Nothing fills missing values with zero or borrows a nearby contract/time.
- All source text is escaped before HTML rendering. There is no unescaped generated HTML or raw JSON dump in the card.
- Responsive two-column controls, minimum 44px actions, readable text, scrollable exact-value tables, labelled controls and a live status region preserve mobile use.

## Validation and release

The test suite covers English/Odia extraction, ambiguity, source escaping, no automatic request, exact selection/cutoff parameters, stale-response suppression, missing fields, errors, standalone route and Market Book integration. Existing dashboard/model/reading and backend reader tests are included in the dedicated RAG CI workflow. Serialized DOM checks are not a substitute for real-browser visual inspection; a browser binary was unavailable locally.

Merge/release and production UI acceptance remain pending. After approval, verify both entry points, example selection, query readback, missing-field handling and mobile layout against the real app.
