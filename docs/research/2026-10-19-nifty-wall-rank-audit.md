# 19 Oct 2026 NIFTY — PR766 continuation: read-only wall/ATM/Spot evidence audit

Source: [historical evidence workflow run 39426909056](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/39426909056), artifact `oct19-nifty-recorded-1m-event-evidence`, SHA-256 `dcf40d3b2c300d227eaeb10cede3a435511e8f8b337d606aecfb6e311e8f67f2`. The temporary investigation PR #767 was **closed unmerged**. This report does not change production code or create any fresh evidence.

## Evidence counts — recorded NIFTY 19 Oct expiry

- 358 / 376 recorded 1m market+selected-expiry-chain minutes qualified, 18 missing / nonqualifying. The market-vs-chain calculation version differs in 358 qualified buckets; do not silently assert identical source cycles.
- Recorded events: 59 ATM-reference changes; 9 CE top-OI wall strike changes; 7 PE top-OI wall strike changes; 2 PCR 1.0 crosses. The 16 wall records occur in 15 unique minutes.
- Only 6 / 16 wall changes have old/new fixed-strike comparable adjacent-minute OI differences, with three old-decrease/new-increase cases; **none prove transfer**.
- Only one of 16 wall events overlaps a recorded ATM change in that same minute: the PE wall at 12:04.
- Quick return-to-prior-strike instances within 1–3 minutes: CE 12:32→12:33, 12:33→12:34, 14:23→14:25, 14:25→14:26; PE 13:22→13:23, 13:23→13:24. These overlap and are not independent trials.

## Post-event Spot observations (descriptive, no controls)

| Wall | Event rows | +5m endpoint n | Median +5m Spot pts | +15m endpoint n | Median +15m Spot pts |
|---|---:|---:|---:|---:|---:|
| CE | 9 | 8 | +1.98 | 7 | -11.40 |
| PE | 7 | 6 | -1.85 | 4 | -4.47 |
| Combined | 16 | 14 | 0.00 | 11 | -11.40 |

Some late-session Spot values repeat across many minutes. Without source-time freshness proof, do **not** treat those repeats as true zero movement. These observations are clustered, same-day and in-sample; **not** performance, a trading edge, or a Spot-only baseline. The artifact includes event-only rows, so complete 3/5/15-minute persistence and comparable non-event Spot control minutes **cannot be verified from this artifact alone**.

## Fixed same-Delta-at-start contracts

At 10:33, the archived ±0.25 matched pair is **NIFTY 19 Oct CE23200 / PE22950**. Keep these contracts locked. Raw CE−PE spread at 10:33/11:33/12:33/13:33/14:33: **−0.40 / −21.25 / −58.60 / −106.30 / −95.05** rupees. It is directional, not Delta-neutral: signed DeltaCE − DeltaPE starts about +0.447. Never splice rolling ATM contracts, and do not call these five hourly checkpoints a predictive backtest.

## Next executable research gate — do not promote until verified

1. Reread **all original 1-minute market, selected-expiry chain, and fixed-option rows** through existing bounded read-only H1 replay, preserving separate source provenance and quote-freshness checks. No new broker/provider requests or DB writes.
2. Compute 3/5/15-minute wall **persistence** only with a qualified **continuous 1-minute chain** through the full horizon. A missing minute is `UNVERIFIABLE`, not persistence.
3. Compare outcomes with quality-matched same-day **non-wall Spot-only control minute samples**; report time-of-day and preceding-Spot-movement strata, sample sizes, overlap, and exclusion reasons. No causal, win-rate, or dealer-positioning claims.
4. For t >= 10:33 compute fixed CE23200−PE22950 price spread changes and first-order archived-Delta-adjusted Spot residual at **exact qualifying endpoints** only. Withhold whenever price, same-contract identity, source, or timestamps fail.
5. Audit late repeated Spot values against independently recorded quote times. Keep partial PCR/Delta OI proxy distinct from independently proven full-chain PCR/DEX/GEX.

Safety: Evidence/research only. **No selector, verdict, Telegram, DB schema/recorder, broker, orders, buyer/seller execution or deployment modifications**. Do not merge a future runtime study until latest-head CI, Devil Check, and actual output validation succeed.
