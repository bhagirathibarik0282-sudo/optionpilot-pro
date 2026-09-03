import test from "node:test";
import assert from "node:assert/strict";
import { runH1LiveSelectorPipeline } from "../h1-live-selector-pipeline.js";

const now = "2026-09-03T09:40:00.000Z";
const gate = (value: boolean) => ({ value, observedAt: "2026-09-03T09:39:30.000Z", source: "LIVE_GATE", provenance: "LIVE_RUNTIME_EXACT" as const });

function packet() {
  return {
    identity: {
      symbol: "NIFTY" as const,
      side: "CE" as const,
      strike: 24000,
      expiryDate: "2026-09-08",
      dte: 5,
      moneyness: "ATM" as const,
      premiumLtp: 125,
      observedAt: "2026-09-03T09:39:30.000Z",
      source: "LIVE_OPTION_CHAIN",
      provenance: "LIVE_RUNTIME_EXACT" as const,
    },
    gates: {
      capitalFit: gate(true), liquidityOk: gate(true), spreadOk: gate(true), premiumResponseConfirmed: gate(true),
      deltaGammaResponseConfirmed: gate(true), thetaIvBurdenAcceptable: gate(true), multiExpiryConflictAbsent: gate(true),
      currentOrNearExpiryUsable: gate(true), fallbackDteApproved: gate(true),
    },
  };
}

test("pipeline emits deterministic SELECT decision only from fully assembled exact evidence", () => {
  const result = runH1LiveSelectorPipeline({ provenance: "LIVE_RUNTIME_EXACT", nowIso: now, packets: [packet()] });
  assert.equal(result.eligibleForLiveH1Marking, true);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, "SELECT");
});

test("pipeline preserves assembler blockers without fabricating a decision", () => {
  const p = packet();
  delete (p.gates as any).premiumResponseConfirmed;
  const result = runH1LiveSelectorPipeline({ provenance: "LIVE_RUNTIME_EXACT", nowIso: now, packets: [p] });
  assert.equal(result.decisions.length, 0);
  assert.equal(result.blockedCount, 1);
  assert.match(result.rejected[0].blockers.join(","), /MISSING_GATE_premiumResponseConfirmed/);
});

test("pipeline rejects non-live provenance", () => {
  const result = runH1LiveSelectorPipeline({ provenance: "RESEARCH_SHADOW", nowIso: now, packets: [packet()] });
  assert.equal(result.eligibleForLiveH1Marking, false);
  assert.equal(result.decisions.length, 0);
});

test("selector BLOCK is preserved when exact gate is false", () => {
  const p = packet();
  p.gates.spreadOk = gate(false);
  const result = runH1LiveSelectorPipeline({ provenance: "LIVE_RUNTIME_EXACT", nowIso: now, packets: [p] });
  assert.equal(result.eligibleForLiveH1Marking, true);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, "BLOCK");
  assert.ok(result.decisions[0].reasonCodes.includes("SPREAD_GATE_FAILED"));
});
