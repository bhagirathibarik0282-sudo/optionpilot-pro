import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Sweet Spot live wire reuses Kite tick stream without polling or orders", () => {
  const observer = fs.readFileSync("sweet-spot-live-observer-v1.ts", "utf8");
  const transport = fs.readFileSync("kite-websocket-transport.ts", "utf8");
  const chain = fs.readFileSync("h1-dynamic-readonly-live-chain.ts", "utf8");
  assert.match(transport, /registerKiteTickObserver/);
  assert.match(transport, /fanoutTicks\(ticks, receivedAt\)/);
  assert.match(chain, /installSweetSpotLiveObserver\(readiness\.registry\.entries\(\)\)/);
  assert.doesNotMatch(observer, /setInterval|setTimeout/);
  assert.match(observer, /required=\["SPOT","CE_PREMIUM","PE_PREMIUM"\]/);
  assert.match(observer, /CONFLICTS_TREND/);
  assert.match(observer, /symbol === "BANKNIFTY"\) return false/);
  assert.match(observer, /createsOrders:false/);
  assert.match(observer, /noTimeframeBoundary:true/);
});

test("Sweet Spot alert remains WATCH and canonical selector stays final authority", () => {
  const formatter = fs.readFileSync("immediate-expansion-telegram-runtime.ts", "utf8");
  assert.match(formatter, /OPTIONPILOT SWEET SPOT ALERT/);
  assert.match(formatter, /WATCH/);
  assert.match(formatter, /canonical selector/i);
  assert.match(formatter, /affectsExecution: false/);
});
