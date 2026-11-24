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
