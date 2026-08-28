# Option Recorder Railway Handoff

GitHub preparation is complete on `option-recorder-final-build`. The existing backend keeps `/api/data` private and gains a separate read-only Option Recorder export route through the existing boot-time wiring mechanism.

## Existing OptionPilot backend — manual Railway variable

Set one strong random secret:

- `OPTION_RECORDER_EXPORT_TOKEN=<strong-random-secret>`

After the backend is deployed with this branch/PR, its recorder source endpoint is:

- `/api/option-recorder/export`

The endpoint is fail-closed: no configured token = HTTP 503; wrong/missing Bearer token = HTTP 401. It exports market/option/futures evidence only and never exposes broker credentials.

## New Option Recorder Railway service

Start command:

`npm run start:option-recorder`

Required source variables:

- `OPTION_RECORDER_SOURCE_URL=https://optionpilot-pro-v2-production.up.railway.app/api/option-recorder/export`
- `OPTION_RECORDER_SOURCE_TOKEN=<same value as OPTION_RECORDER_EXPORT_TOKEN>`
- `OPTION_RECORDER_POLL_MS=60000`

Keep AI and Telegram OFF for the first shadow deployment:

- `OPTION_RECORDER_HAIKU_ENABLED=false`
- `OPTION_RECORDER_TELEGRAM_ENABLED=false`

Optional manual ingest protection:

- `OPTION_RECORDER_INGEST_TOKEN=<another strong random secret>`

## Haiku variables

Enable only after real shadow source verification:

- `OPTION_RECORDER_HAIKU_ENABLED=true`
- `ANTHROPIC_API_KEY=<secret>`
- `ANTHROPIC_MODEL=<exact current model id selected by the user>`
- optional `ANTHROPIC_VERSION`
- optional `OPTION_RECORDER_HAIKU_MAX_TOKENS`

## Telegram variables

Enable only after Haiku consistency and routing checks:

- `OPTION_RECORDER_TELEGRAM_ENABLED=true`
- `TELEGRAM_BOT_TOKEN=<secret>`
- `TELEGRAM_NIFTY_CHAT_ID=<NIFTY premium group>`
- `TELEGRAM_BANKNIFTY_CHAT_ID=<BANKNIFTY premium group>`
- `TELEGRAM_SENSEX_CHAT_ID=<SENSEX premium group>`

## Exported evidence

The protected source exports real contract expiry dates, bid/ask, volume, OI, IV/Greeks when available, per-leg quote timestamps, near/next/far futures context, PCR/volume PCR context, and multiple expiries from the already-held backend snapshot. No extra broker request is made for the recorder export.

## Promotion rule

First deploy in `SHADOW_ONLY`. Keep Haiku and Telegram disabled until `/health` and `/status` confirm successful source polling and real-data validation. Production eligibility still requires replay, adversarial failure tests, Haiku consistency, premium-selection checks and Telegram group-isolation checks on real shadow data.
