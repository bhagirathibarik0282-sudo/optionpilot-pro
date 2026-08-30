import { evaluateForwardShadowTest, type ForwardShadowInput } from "./forward-shadow-test-harness.js";
import { createShadowTradeEvidence, recordShadowTradeEvent, type ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";

export interface ShadowEntryIntegrationInput {
  gate: ForwardShadowInput;
  tradeId: string;
  ts: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  entryPremium: number;
  entryQty: number;
  initialTrailingSl?: number | null;
}

export interface ShadowLifecycleEventInput {
  ts: string;
  event: "TSL_UPDATE" | "PARTIAL_EXIT" | "RUNNER_EXIT" | "BLOCKED";
  premium: number;
  quantity?: number;
  trailingSl?: number | null;
}

export function beginForwardShadowEvidence(input: ShadowEntryIntegrationInput): ShadowTradeEvidence | null {
  const gate = evaluateForwardShadowTest(input.gate);
  if (gate.status !== "READY" || gate.brokerOrderAllowed !== false || !gate.recordDecision) return null;
  return createShadowTradeEvidence({
    tradeId: input.tradeId,
    ts: input.ts,
    index: input.index,
    entryPremium: input.entryPremium,
    entryQty: input.entryQty,
    initialTrailingSl: input.initialTrailingSl,
  });
}

export function applyForwardShadowEvidenceEvent(
  state: ShadowTradeEvidence,
  event: ShadowLifecycleEventInput,
): ShadowTradeEvidence | null {
  if (!state || state.brokerOrderAllowed !== false) return null;
  return recordShadowTradeEvent(state, event);
}
