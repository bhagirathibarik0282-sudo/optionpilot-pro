# Read-only exact-event RAG adapter

Status: **PARTIAL** — local implementation and tests; production runtime **NOT_PROVEN**.

The existing `/api/offline-research/rag/query` searches an in-memory historical Greeks feature index. It does not consume the audited premium-event archive. This change adds an exact-contract research reader at `GET /api/research/rag-event-evidence`, mounted on the existing research router. It reuses `runH1ReplayHttp` and the existing PostgreSQL source; it does not import the offline ZIP, create a database, persist another archive, start a recorder, or change candidate/Telegram/order authority.

## Proposed request (not deployed)

```text
/api/research/rag-event-evidence?symbol=NIFTY&date=2026-10-13&expiry=2026-10-13&strike=22300&side=PE&time=09:36
```

Exact symbol/date/expiry/strike/side and regular 3-minute event time are required. Add `includeOutcomes=true` to request separate +3/+6/+15/+30 checkpoints; outcomes are absent by default. `asOf=2026-10-13T09:39:59` uses IST; explicit ISO offsets or Z are also accepted. The calendar is the existing reviewed 2026 calendar; unsupported years fail closed. Event time must be at least 09:18, with an exact previous 3-minute quote.

## Evidence gates

- At most two existing replay calls per request: current event ±30 minutes (only through the event by default, clipped by cutoff/session) and the exact previous session 09:15–15:30 for range reconciliation. There are no broker requests or database writes.
- Current and previous source request identities must match. Every option quote must match its same-index/same-bucket TRUE market snapshot ID, have positive finite LTP, same IST quote date, and recomputed quote age between -5 and 30 seconds versus backend receipt. The -5-second timestamp skew tolerance is disclosed.
- A backend receipt and the individual quote timestamp must both be at/before the as-of cutoff. Unknown/missing/ambiguous records fail closed. Exact index/expiry/strike/side identity is checked; replay rows do not expose instrument tokens.
- Previous-session fresh reported H/L are reconciled to the exact fresh 15:30 terminal range. Stored current quote PDH/PDL are not used as the crossing authority. This is retrospective reference reconciliation, not proof of which reference the live app had loaded then.
- Actual level crossing requires the adjacent exact 3-minute same-contract pair. Missing checkpoints remain null. There is no nearest bucket/strike/expiry substitution or interpolation.
- Full PCR uses the existing canonical/normalized provenance resolver. An unsupported full-PCR provenance stays missing; band PCR cannot substitute. VIX, wall labels and futures are recorded context, with exchange freshness and futures contract continuity unverified.
- Responses include source snapshot IDs, receipt and quote timestamps, replay continuity and a SHA256 of selected normalized evidence. This digest is explicitly distinct from a hash of raw HTTP response bytes.
- The answer is a deterministic Odia template grounded in the selected event. There is no embedding or LLM service, natural-language semantic search, calibrated probability, causal explanation or trading authority.

## Verification

```bash
NODE_ENV=test node --import tsx --test test/rag-event-evidence.test.ts test/intraday-observation-memory.test.ts test/h1-replay-http.test.ts test/h1-fixed-contract-journey-http.test.ts test/research-router-auth.test.ts
```

The actual-source test can be enabled with `RAG_RAW_FIXTURES` pointing at the previously saved raw replay directory. The full local run passed 41 tests with that test enabled. `rag-event-evidence-offline-proof.json` records a separate 12-case local parity check across 8/9/12/13 October and all three indices: 11 exact event/reference matches plus one expected no-crossing block (8 October BANKNIFTY 54900 CE at 09:18). That is not a live/production acceptance receipt. Existing Greeks RAG and saved intraday-memory routes retain their contracts.

## Runtime acceptance still required

After an explicitly approved release, verify HTTP readback of the known NIFTY event, exact as-of exclusion at 09:36:00, limited outcomes at 09:39:59, next-expiry identity, missing-reference blocking, and unchanged recorder/trading routes. No environment/config change is required by this adapter. No production release was performed in this checkpoint.
