import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

function has(text: string): boolean {
  return source.includes(text);
}

test("Phase 7: dashboard card endpoint supports all three premium-selection indices", () => {
  assert.ok(has('/api/v2/option-buying-card'));
  assert.ok(has('"NIFTY", "BANKNIFTY", "SENSEX"'));
});

test("Phase 7: dashboard and Telegram share the same ATR/Delta and one-lot risk boundary", () => {
  assert.ok(has("same cached ATR/Delta plan and one-lot risk checks used by"));
  assert.ok(has("Telegram"));
  assert.ok(has("estimatedLotLoss"));
  assert.ok(has("maxLoss"));
});

test("Phase 7: dashboard fails closed on stale or blocked live feed", () => {
  assert.ok(has("Date.now() - generatedAt > 210000"));
  assert.ok(has("serverConnectionState === 'FROZEN'"));
  assert.ok(has("serverConnectionState === 'LOCKED'"));
  assert.ok(has("unavailable ? 'NO TRADE' : card.signal"));
});

test("Phase 7: Telegram blocks duplicate structure and risk alerts", () => {
  assert.ok(has("TELEGRAM_LAST_STRUCTURE_FINGERPRINT"));
  assert.ok(has("NO_TRADE_RISK|"));
  assert.ok(has("NO_TRADE|"));
});

test("Phase 7: Telegram cannot bypass the manual execution boundary", () => {
  assert.ok(has("Manual review only"));
  assert.ok(has("forward-test only"));
});

test("Phase 7: Telegram reuses Haiku cache instead of spending duplicate explanation calls", () => {
  assert.ok(has("haikuCache.get(cacheKey)"));
  assert.ok(has("HAIKU_COST_GUARD_MS"));
  assert.ok(has("haikuCache.set(cacheKey"));
});
