import test from "node:test";
import assert from "node:assert/strict";

// Contract-level guard: the bridge is historical-only and must not export any live verdict API.
test("H1 intelligence bridge stays historical-only by contract", async () => {
  const mod = await import("../h1-intelligence-bridge.js");
  assert.equal(typeof mod.persistH1IntelligenceSnapshot, "function");
  assert.equal("buildVerdict" in mod, false);
  assert.equal("sendTelegram" in mod, false);
  assert.equal("executeTrade" in mod, false);
});
