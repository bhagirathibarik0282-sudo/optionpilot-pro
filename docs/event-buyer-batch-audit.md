# Event Intelligence V1 offline batch audit

No broker requests, production DB connections, orders or automatic jobs. Run from the draft checkout with Node 22 and installed dependencies:

```sh
node --import tsx scripts/event-buyer-batch-audit.ts manifest.json new-report.json
```

Manifest example (paths are local copies, not claims that these files exist):

```json
{"sessions":[{"date":"2026-11-24","symbol":"NIFTY","expiries":["2026-11-26","2026-12-03"],"recordedFile":"replay.json","memoryFile":"memory.json"}]}
```

Use actual read-only H1 replay JSON with request identity and normalized market/options/chain rows, and the saved intraday-memory JSON with storage timestamp availability. The new availability field is not deployed in production; legacy memory must remain blocked until a qualified export exists. Expiries must be explicitly preselected, never chosen by outcome. A complete market-minute grid is not proof of complete contract coverage. Report retains per-candidate reasons and exact sampled entry/exit/SL/TSL. Independent event outcomes can overlap: no portfolio P&L, PF, DD or real trade claims. Existing buyer net payoff module requires verified bid/ask and applicable cost inputs. No input source is modified. No actual session execution is claimed by fixture CI.

## Timing comparison (research only)

The default dashboard hypothesis is unchanged. The offline batch additionally evaluates four policies on the same admitted event and fixed expiry/strike:

- FIRST_KNOWN_SAMPLE: first exact minute strictly after saved-event availability; no breakout requirement.
- EVENT_PLUS_3 and EVENT_PLUS_5: exact event-relative checkpoint; never enter if already known too late.
- FIRST_BREAK_WITHIN_5: earliest exact eligible minute exceeding the event buyer premium, no later than event +5m.

All retain the original event direction/PCR gates, structural stop, post-sample trail, and 15-minute holding limit. Delayed policies require continuous eligible paired samples with the weak premium below its unchanged PDL; a gap is UNVERIFIED, not a skipped minute. Entry after 15:00 IST is blocked. Report timingResults and timingComparison show per-policy coverage, mean sampled R, and a matched closed subset; this subset has selection bias and is not a portfolio or a valid performance ranking by itself. Net P&L, fills, PF and drawdown remain withheld. First-known timing is not an executable event-time fill. No production wiring or deployment.

## Preferred participation context
Optional manifest fields: participationFile (saved background quote history response for exact date), cashFile (verified stored daily cash-history response). Missing/unreadable sidecars remain unavailable. BANKNIFTY prioritizes HDFC/ICICI/PSU Bank, then Axis/Kotak/SBI; NIFTY/SENSEX prioritize HDFC/Reliance/IT/Smallcap100/Midcap100. Each displayed instrument appears once; the two overlapping teams are not independent votes. Event checkpoints use the most recent saved quote receipt at or before the checkpoint (max 3 minutes), quotes at most 30 seconds old at receipt, with no future substitution. Cash aggregates 1/3/5 prior available stored dates only; publication timestamps are unknown and cash is retrospective context, not an entry gate. No inferred official weights, contribution, or trade-rule changes.
