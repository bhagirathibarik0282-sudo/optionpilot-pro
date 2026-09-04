import test from "node:test";
import assert from "node:assert/strict";
import { prepareH1LiveExactMarketWiring } from "../h1-live-exact-market-wiring-readiness.js";
import { preflightH1LiveSelectionIntoExactRegistry } from "../h1-live-selection-exact-registry-preflight.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { H1LiveContractSelectionResult } from "../h1-live-contract-selection.js";

function selection(): H1LiveContractSelectionResult {
  return {
    version: "H1_LIVE_CONTRACT_SELECTION_V1",
    ready: true,
    blockers: [],
    source: "KITE_MASTER_PLUS_REST_SPOT_SELECTION_ONLY",
    productionImpact: "NONE",
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    activatesShadow: false,
    infersTokens: false,
    failClosed: true,
    rows: [{
      symbol: "NIFTY",
      spot: 25031,
      expiry: "2026-09-08",
      strike: 25050,
      ceInstrumentToken: 3,
      peInstrumentToken: 4,
      ceTradingsymbol: "NIFTY08CE",
      peTradingsymbol: "NIFTY08PE",
      peerPairs: [
        { expiry: "2026-09-15", strike: 25000, ceInstrumentToken: 5, peInstrumentToken: 6, ceTradingsymbol: "NIFTY15CE", peTradingsymbol: "NIFTY15PE" },
        { expiry: "2026-09-22", strike: 25050, ceInstrumentToken: 7, peInstrumentToken: 8, ceTradingsymbol: "NIFTY22CE", peTradingsymbol: "NIFTY22PE" },
      ],
    }],
  };
}

function baseRegistry(includeSpot = true) {
  const entries: any[] = [
    { instrumentToken: 3, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY08CE", expiry: "2026-09-08", strike: 25050, optionSide: "CE" },
    { instrumentToken: 50, symbol: "NIFTY", role: "FUTURE", instrumentLabel: "NIFTY-FUT" },
    { instrumentToken: 51, symbol: "NIFTY", role: "OPTION", instrumentLabel: "UNRELATED", expiry: "2026-10-01", strike: 26000, optionSide: "CE" },
  ];
  if (includeSpot) entries.unshift({ instrumentToken: 99, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50", optionSide: null });
  return new KiteImmediateTokenRegistry(entries);
}

test("builds only exact live WS subscription registry from PR241 output", () => {
  const s = selection();
  const p = preflightH1LiveSelectionIntoExactRegistry(baseRegistry(), s);
  assert.equal(p.ready, true);

  const out = prepareH1LiveExactMarketWiring(s, p);
  assert.equal(out.ready, true);
  assert.equal(out.mode, "full");
  assert.equal(out.startsSocket, false);
  assert.equal(out.selectedSymbolCount, 1);
  assert.equal(out.selectedOptionTokenCount, 6);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.infersTokens, false);
  assert.deepEqual(out.instrumentTokens.sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 99]);
  assert.equal(out.registry!.get(50), null);
  assert.equal(out.registry!.get(51), null);
});

test("fails closed when selected symbol has no exact SPOT token", () => {
  const s = selection();
  const p = preflightH1LiveSelectionIntoExactRegistry(baseRegistry(false), s);
  assert.equal(p.ready, true);
  const out = prepareH1LiveExactMarketWiring(s, p);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["EXACT_ONE_SPOT_REQUIRED:NIFTY:0"]);
  assert.equal(out.registry, null);
  assert.deepEqual(out.instrumentTokens, []);
});

test("fails closed when PR241 preflight is not ready", () => {
  const s = selection();
  const p = preflightH1LiveSelectionIntoExactRegistry(baseRegistry(), s);
  p.ready = false;
  p.registry = null;
  p.blockers = ["UPSTREAM_BLOCKED"];
  const out = prepareH1LiveExactMarketWiring(s, p);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["EXACT_REGISTRY_PREFLIGHT_NOT_READY", "UPSTREAM_BLOCKED"]);
});

test("fails closed if an exact selected option identity is missing or changed", () => {
  const s = selection();
  const p = preflightH1LiveSelectionIntoExactRegistry(baseRegistry(), s);
  assert.equal(p.ready, true);
  const badEntries = p.registry!.entries().map((entry) => entry.instrumentToken === 6
    ? { ...entry, strike: 25100 }
    : entry);
  p.registry = new KiteImmediateTokenRegistry(badEntries);

  const out = prepareH1LiveExactMarketWiring(s, p);
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["EXACT_SELECTED_OPTION_IDENTITY_MISSING:NIFTY:6"]);
});
