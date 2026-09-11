# Runtime Telegram idempotency fix V1

Root cause observed in Railway production logs: repeated process restarts re-ran the fused Telegram runtime mutator and appended duplicate `TELEGRAM_3M_FUSED_DEDUP` declarations to `server.ts`, causing esbuild transform failure and service crash.

Fix: gate the fused runtime mutator behind the existing `OPTIONPILOT_3M_RICH_FUSED_TELEGRAM_RUNTIME_V2` marker before importing it from `wire-no-trade-reason-dedupe-v1.mjs`.

Scope: runtime wiring only. No selector, execution, broker, risk, FII/DII, or trading logic changes.
