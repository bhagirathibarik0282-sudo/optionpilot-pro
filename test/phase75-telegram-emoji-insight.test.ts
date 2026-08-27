import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase74CanonicalStatus, renderPhase74TelegramStatus } from "../telegram-live-status-v2.js";

function render(verdict: string): string {
  const status = buildPhase74CanonicalStatus({
    symbol: "NIFTY",
    observedAt: "2026-08-28T04:00:00.000Z",
    metrics: { freshnessStatus: "FRESH" },
    validation: { valid: true },
    rule: { verdict, score: 2, maxScore: 10 },
  });
  return renderPhase74TelegramStatus(status, "Display test", "DETERMINISTIC_FALLBACK");
}

test("Phase75 uses turtle for sideways", () => {
  assert.match(render("SIDEWAYS"), /🐢 SIDEWAYS/);
});

test("Phase75 uses eye for ready to watch", () => {
  assert.match(render("READY TO WATCH"), /👁️ READY TO WATCH/);
});

test("Phase75 uses transition and conflict symbols", () => {
  assert.match(render("TRANSITION"), /🔄 TRANSITION/);
  assert.match(render("CONFLICTING"), /⚔️ CONFLICTING/);
});

test("Phase75 appends deterministic Trading Insight footer", () => {
  const a = render("SIDEWAYS");
  const b = render("SIDEWAYS");
  assert.match(a, /📚 Trading Insight:/);
  assert.equal(a, b);
});

test("Phase75 insight is display-only and does not alter canonical verdict", () => {
  const status = buildPhase74CanonicalStatus({
    symbol: "BANKNIFTY",
    observedAt: "2026-08-28T04:00:00.000Z",
    metrics: { freshnessStatus: "FRESH" },
    validation: { valid: true },
    rule: { verdict: "SIDEWAYS", score: 3, maxScore: 10 },
  });
  renderPhase74TelegramStatus(status, "Display test", "DETERMINISTIC_FALLBACK");
  assert.equal(status.verdict, "SIDEWAYS");
  assert.equal(status.score, 3);
}
