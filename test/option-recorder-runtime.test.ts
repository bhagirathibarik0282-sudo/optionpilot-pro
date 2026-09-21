import test from "node:test";
import assert from "node:assert/strict";
import { processRecorderPayload, selectRecorderPremium, buildTelegramText, type RecorderIngestPayload } from "../option-recorder-runtime.js";
import { buildRecorderContractKey } from "../option-recorder-shadow.js";
import { callHaikuProvider, resolveHaikuProvider } from "../haiku-provider.js";

const ts = "2026-08-28T10:00:00.000Z";

function payload(): RecorderIngestPayload {
  return {
    market: { snapshotId: "snap-1", symbol: "NIFTY", exchangeTimestamp: ts, backendTimestamp: ts, spot: 25000, future: 25020, futureOi: 100000, futureVolume: 50000, vwap: 24980, pdh: 25100, pdl: 24800 },
    options: [
      { snapshotId: "snap-1", symbol: "NIFTY", expiry: "2026-09-03", strike: 25000, side: "CE", contractKey: buildRecorderContractKey("NIFTY", "2026-09-03", 25000, "CE"), exchangeTimestamp: ts, backendTimestamp: ts, ltp: 120, bid: 119, ask: 121, volume: 100000, oi: 200000, oiChange: 5000, iv: 14, delta: 0.5, gamma: 0.001, vega: 8, theta: -12, intrinsic: 0, extrinsic: 120 },
      { snapshotId: "snap-1", symbol: "NIFTY", expiry: "2026-09-03", strike: 25000, side: "PE", contractKey: buildRecorderContractKey("NIFTY", "2026-09-03", 25000, "PE"), exchangeTimestamp: ts, backendTimestamp: ts, ltp: 110, bid: 109, ask: 111, volume: 90000, oi: 180000, oiChange: 4000, iv: 15, delta: -0.5, gamma: 0.001, vega: 8, theta: -11, intrinsic: 0, extrinsic: 110 }
    ],
    verdicts: [
      { mode: "SCALP", state: "TRADEABLE", direction: "CE", quality: "HIGH", evidence: ["aligned"], conflicts: [] },
      { mode: "TRADER", state: "WATCH", direction: "NONE", quality: "MEDIUM", evidence: [], conflicts: [] },
      { mode: "SWING", state: "NO_TRADE", direction: "NONE", quality: "LOW", evidence: [], conflicts: [] }
    ]
  };
}

test("selects only validated premium matching strategy direction", () => {
  const p = payload();
  const selected = selectRecorderPremium(p, p.verdicts[0]);
  assert.equal(selected?.side, "CE");
  assert.equal(selected?.strike, 25000);
});

test("keeps SCALP TRADER SWING independent", () => {
  const state = processRecorderPayload(payload());
  assert.ok(state.selectedPremiums.SCALP);
  assert.equal(state.selectedPremiums.TRADER, undefined);
  assert.equal(state.selectedPremiums.SWING, undefined);
});

test("routes NIFTY only to NIFTY premium destination", () => {
  assert.equal(processRecorderPayload(payload()).telegramDestination, "NIFTY_PREMIUM");
});

test("fingerprint is deterministic for unchanged state", () => {
  assert.equal(processRecorderPayload(payload()).fingerprint, processRecorderPayload(payload()).fingerprint);
});

test("telegram text stays concise and includes all three modes", () => {
  const p = payload();
  const text = buildTelegramText(p, processRecorderPayload(p), null);
  assert.match(text, /SCALP:/);
  assert.match(text, /TRADER:/);
  assert.match(text, /SWING:/);
});


test("keeps Anthropic as default Haiku provider for backward compatibility", () => {
  const config = resolveHaikuProvider({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "m" });
  assert.equal(config.provider, "ANTHROPIC");
  assert.equal(config.configured, true);
  assert.equal(config.endpoint, "https://api.anthropic.com/v1/messages");
});

test("OpenRouter stays fail-closed until an explicit model is configured", () => {
  const config = resolveHaikuProvider({
    OPTION_RECORDER_AI_PROVIDER: "OPENROUTER",
    OPENROUTER_API_KEY: "or-key",
  });
  assert.equal(config.provider, "OPENROUTER");
  assert.equal(config.configured, false);
  assert.equal(config.reason, "OPENROUTER_MODEL_REQUIRED");
});

test("OpenRouter uses bearer auth and Anthropic-compatible messages endpoint", async () => {
  const config = resolveHaikuProvider({
    OPTION_RECORDER_AI_PROVIDER: "OPENROUTER",
    OPENROUTER_API_KEY: "or-key",
    OPENROUTER_MODEL: "anthropic/example-model",
  });
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await callHaikuProvider(config, { x: 1 }, 512, fakeFetch);
  assert.equal(result, "ok");
  assert.equal(seenUrl, "https://openrouter.ai/api/v1/messages");
  assert.equal((seenInit?.headers as Record<string, string>).authorization, "Bearer or-key");
  const parsed = JSON.parse(String(seenInit?.body));
  assert.equal(parsed.model, "anthropic/example-model");
  assert.equal(parsed.max_tokens, 512);
});
