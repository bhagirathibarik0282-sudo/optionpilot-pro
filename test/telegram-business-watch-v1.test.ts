import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("business watch is observation-only and exposes measured CE/PE watch fields", () => {
  const s = fs.readFileSync("scripts/wire-telegram-business-watch-v1.mjs", "utf8");
  assert.match(s, /TELEGRAM_BUSINESS_WATCH/);
  assert.match(s, /WATCH ONLY — no BUY\/SELL order/);
  assert.match(s, /createsOrders:false/);
  assert.match(s, /futureChange/);
  assert.match(s, /cePremiumChangePct/);
  assert.match(s, /pePremiumChangePct/);
  assert.match(s, /ceOiChangePct/);
  assert.match(s, /peOiChangePct/);
  assert.match(s, /pcrChange/);
  assert.match(s, /candidateOrientedPpdPp/);
  assert.match(s, /spreadPct/);
  assert.match(s, /delta/);
});

test("BANKNIFTY never becomes a business watch side", () => {
  const s = fs.readFileSync("scripts/wire-telegram-business-watch-v1.mjs", "utf8");
  assert.match(s, /symbol === "BANKNIFTY" \? null/);
});
