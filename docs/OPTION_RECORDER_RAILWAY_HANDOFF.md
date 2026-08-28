# Option Recorder Railway Handoff

The GitHub side is prepared as a separate service and does not modify the existing `server.ts` production flow.

## Railway service command

`npm run start:option-recorder`

## Keep these OFF first

- `OPTION_RECORDER_HAIKU_ENABLED=false`
- `OPTION_RECORDER_TELEGRAM_ENABLED=false`

## Required before ingest

- `OPTION_RECORDER_INGEST_TOKEN=<random secret>`

The service accepts normalized recorder envelopes at `POST /ingest` and exposes `GET /health` and `GET /status`.

## Haiku variables

Enable only after shadow ingest is verified:

- `OPTION_RECORDER_HAIKU_ENABLED=true`
- `ANTHROPIC_API_KEY=<secret>`
- `ANTHROPIC_MODEL=<exact model id selected by the user>`
- optional `ANTHROPIC_VERSION`
- optional `OPTION_RECORDER_HAIKU_MAX_TOKENS`

The model id is intentionally not hard-coded so a stale or incorrect model name is never silently used.

## Telegram variables

Enable only after routing tests are verified:

- `OPTION_RECORDER_TELEGRAM_ENABLED=true`
- `TELEGRAM_BOT_TOKEN=<secret>`
- `TELEGRAM_NIFTY_CHAT_ID=<NIFTY premium group>`
- `TELEGRAM_BANKNIFTY_CHAT_ID=<BANKNIFTY premium group>`
- `TELEGRAM_SENSEX_CHAT_ID=<SENSEX premium group>`

Routing is strict by index and unchanged fingerprints are deduplicated.

## Promotion rule

Do not treat the service as production-eligible until replay, adversarial failure tests, Haiku consistency checks, premium-selection checks and Telegram group-isolation checks all pass on real shadow data.
