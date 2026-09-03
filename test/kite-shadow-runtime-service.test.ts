import test from "node:test";
import assert from "node:assert/strict";
import { readKiteShadowServiceConfig } from "../kite-shadow-runtime-service.js";

test("disabled shadow service is inert without registry", () => {
  const cfg = readKiteShadowServiceConfig({ KITE_RUNTIME_SHADOW_ENABLED: "false" });
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.registryEntries, []);
});

test("enabled shadow service fails closed without registry", () => {
  assert.throws(() => readKiteShadowServiceConfig({ KITE_RUNTIME_SHADOW_ENABLED: "true", KITE_API_KEY: "k" }), /REGISTRY_JSON_REQUIRED/);
});

test("enabled shadow service parses explicit locked registry", () => {
  const cfg = readKiteShadowServiceConfig({
    KITE_RUNTIME_SHADOW_ENABLED: "true",
    KITE_API_KEY: "k",
    KITE_SHADOW_REGISTRY_JSON: JSON.stringify([{ instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" }]),
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.apiKey, "k");
  assert.equal(cfg.registryEntries.length, 1);
});

test("exact H1 service becomes the single WebSocket owner when enabled", () => {
  const cfg = readKiteShadowServiceConfig({
    KITE_RUNTIME_SHADOW_ENABLED: "true",
    KITE_H1_EXACT_SHADOW_ENABLED: "true",
    KITE_API_KEY: "k",
  });
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.registryEntries, []);
});
