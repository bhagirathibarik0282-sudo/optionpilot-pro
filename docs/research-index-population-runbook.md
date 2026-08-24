# Research Index Historical Population Runbook

Status: RESEARCH MODE ONLY  
Production impact: NONE  
Scope: Broad Market / Size Research Intelligence

## Official source
Use only NSE Indices public Historical Index Data export for long-history backfill.
Reference page: https://www.niftyindices.com/reports/historical-data

For daily maintenance, use the public Daily Snapshot CSV from the NSE Indices Daily Reports page.
Reference page: https://www.niftyindices.com/reports/daily-reports

Do not scrape undocumented private endpoints for long-history backfills.

## Required seven indices
Download historical OHLC CSV for these exact index families:

1. NIFTY 50
2. NIFTY 100
3. NIFTY 200
4. NIFTY 500
5. NIFTY NEXT 50
6. NIFTY MIDCAP 150
7. NIFTY SMALL CAP 250

Use the longest reliable common date range available across the seven indices. Do not invent missing earlier history for an index that began later.

## Rename files exactly
Place the files in `research-data/` using these names:

- `NIFTY50.csv`
- `NIFTY100.csv`
- `NIFTY200.csv`
- `NIFTY500.csv`
- `NEXT50.csv`
- `MIDCAP150.csv`
- `SMALLCAP250.csv`

## Step 1 — Preflight
Run:

```bash
npm run research:preflight
```

Preflight must verify:
- all seven files exist
- at least 253 usable observations per file
- OHLC rows parse correctly
- no skipped/corrupt rows for a clean first load
- first/last dates are visible
- latest dates are aligned across all seven files

If preflight returns `ready=false`, STOP. Do not populate the database until blockers are resolved.

## Step 2 — Populate
After preflight passes, run:

```bash
npm run research:populate
```

The population script performs:
1. read seven CSV files
2. parse and normalize
3. validate OHLC/data integrity
4. upsert raw daily records
5. rebuild returns and NIFTY50-relative-strength metrics
6. run readiness audit

## Step 3 — Readiness
Research Laboratory must not be marked READY unless all of the following are true:
- 7/7 history coverage
- 7/7 metrics coverage
- at least 253 observations per index for 252D calculations
- latest trade dates aligned
- no invalid core data
- no unresolved database write failures

Runtime endpoint after server hook is mounted:

`GET /api/research/broad-market-size/readiness`

## Step 4 — Dashboard
Only after readiness passes should the Research Laboratory render the populated Broad Market / Size layer as usable research evidence.

The layer remains:
- `RESEARCH_MODE`
- `productionImpact: NONE`
- not part of final trading verdict
- not part of Telegram execution cards

## Daily maintenance
For routine daily updates, use the official Daily Snapshot loader rather than re-importing the full historical CSV set.

Daily flow:

Official Daily Snapshot -> seven-index audited loader -> DB -> metrics rebuild -> readiness/health refresh.

## Stop / rollback rules
STOP the load if any of these occur:
- wrong index CSV
- impossible OHLC
- missing core NIFTY50 or NIFTY500
- latest-date mismatch
- DB write failures
- fewer than 253 observations for full-readiness claims
- parser reports unexpected skipped rows

Do not fill missing values with zero. Do not interpolate missing trading sessions. Do not average conflicting source values. Keep raw imported history separate from derived metrics.

## Operational sequence

`DOWNLOAD -> RENAME -> research-data/ -> PRECHECK -> POPULATE -> METRICS -> READINESS -> DASHBOARD`

This runbook is the frozen operational path for the first Broad Market / Size historical population pass.
