# KITE_RUNTIME_SHADOW_STARTUP_V1

Purpose: define the next safe Railway/runtime integration step after `KITE_IMMEDIATE_RUNTIME_CORE_V1` was merged.

## Required runtime contract

- Shadow/research only; productionImpact = NONE.
- No broker order authority.
- No Telegram send authority.
- No REST market-data fallback.
- Accept only registered Kite instrument tokens.
- Preserve provider timestamps and reject stale ticks.
- Reconnect must re-subscribe the exact locked instrument universe.
- Trend side must come from the existing locked trend provider; startup must not invent direction.
- Positioning remains optional and fixed-universe.
- Runtime must expose observable status for: enabled, connected, subscribed token count, last packet timestamp, stale/reconnect counters, and last decision timestamp.
- Disabled or missing Kite credentials/config must fail closed and leave the rest of the server available.

## Promotion gate

Do not promote beyond shadow mode until Railway proves:

1. process starts cleanly,
2. Kite WebSocket authenticates,
3. registered tokens subscribe successfully,
4. live packets reach `KITE_IMMEDIATE_RUNTIME_CORE_V1`,
5. stale/unregistered packets are rejected,
6. disconnect/reconnect re-subscribes correctly,
7. no broker or Telegram side effect occurs.
