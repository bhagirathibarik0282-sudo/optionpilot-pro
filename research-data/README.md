# Research Data Folder

This folder is for the first Broad Market / Size historical population pass.

## Official source
Use NSE Indices public Historical Index Data export only:
https://www.niftyindices.com/reports/historical-data

Download one OHLC CSV per index for the longest reliable common date range available.

## Required files
Rename and place exactly these seven files here:

- `NIFTY50.csv`
- `NIFTY100.csv`
- `NIFTY200.csv`
- `NIFTY500.csv`
- `NEXT50.csv`
- `MIDCAP150.csv`
- `SMALLCAP250.csv`

Index mapping:

- NIFTY50.csv -> NIFTY 50
- NIFTY100.csv -> NIFTY 100
- NIFTY200.csv -> NIFTY 200
- NIFTY500.csv -> NIFTY 500
- NEXT50.csv -> NIFTY NEXT 50
- MIDCAP150.csv -> NIFTY MIDCAP 150
- SMALLCAP250.csv -> NIFTY SMALL CAP 250

## Safe execution order

1. `npm run research:preflight`
2. Fix every blocker until `ready=true`
3. `npm run research:populate`
4. Check `/api/research/broad-market-size/readiness` after the server hook is mounted

Do not commit the downloaded CSV datasets to GitHub unless explicitly intended. They are runtime/research inputs, not source code.

Do not substitute third-party history for this first baseline without a separate validation decision.
