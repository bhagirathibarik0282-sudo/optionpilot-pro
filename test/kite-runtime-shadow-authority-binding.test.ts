import test from "node:test";
import assert from "node:assert/strict";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import { startKiteShadowRuntimeFromAuthority } from "../kite-runtime-shadow-authority-binding.js";

const registry = new KiteImmediateTokenRegistry([{ instrumentToken: 1, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" }]);
const core = { cluster: { windowMs: 1000, minimumDistinctMetrics: 2 }, trendFor: () => ({ side: "NONE" as const, valid: false }) };

test("disabled binding is inert and fail-closed", async () => {
  const result = await startKiteShadowRuntimeFromAuthority({ enabled: false, apiKey: "k", registry, core });
  assert.equal(result.started, false);
  assert.equal(result.reason, "DISABLED");
  assert.equal(result.supervisor, null);
  assert.equal(result.productionImpact, "NONE");
});

test("missing API key blocks before authority resolution", async () => {
  const result = await startKiteShadowRuntimeFromAuthority({ enabled: true, registry, core });
  assert.equal(result.started, false);
  assert.equal(result.reason, "API_KEY_MISSING");
  assert.equal(result.supervisor, null);
});
