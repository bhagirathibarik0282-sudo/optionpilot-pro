import assert from "node:assert/strict";
import { OptionBuyingRuntimeRiskRegistry } from "../option-buying-runtime-risk-registry.js";

const now = 1_000_000;
const registry = new OptionBuyingRuntimeRiskRegistry(60_000, () => now);
const state = { dynamicDailyLoss: 1200, realisedLossToday: 200, openRisk: 100, estimatedExistingCosts: 50 };

assert.equal(registry.read("NIFTY"), null, "missing state must fail closed");
assert.equal(registry.set("nifty", state, now), true);
assert.deepEqual(registry.read("NIFTY"), state, "fresh state must be readable and symbol-normalized");

const stale = new OptionBuyingRuntimeRiskRegistry(60_000, () => now);
stale.set("NIFTY", state, now - 60_001);
assert.equal(stale.read("NIFTY"), null, "stale risk state must fail closed");

registry.clear("NIFTY");
assert.equal(registry.read("NIFTY"), null, "cleared state must not survive");

console.log("option buying runtime risk registry devil tests passed");
