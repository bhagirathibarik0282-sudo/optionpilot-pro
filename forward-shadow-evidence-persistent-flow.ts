import { beginForwardShadowEvidence, applyForwardShadowEvidenceEvent, type ShadowEntryIntegrationInput, type ShadowLifecycleEventInput } from "./forward-shadow-evidence-integration.js";
import { persistShadowTradeEvidence, loadRecentShadowTradeEvidence } from "./shadow-evidence-persistence.js";
import type { ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";

export interface PersistentShadowFlowResult {
  evidence: ShadowTradeEvidence | null;
  persisted: boolean;
  brokerOrderAllowed: false;
  reason: string;
}

export async function beginPersistentForwardShadowEvidence(
  input: ShadowEntryIntegrationInput,
): Promise<PersistentShadowFlowResult> {
  const evidence = beginForwardShadowEvidence(input);
  if (!evidence) return { evidence: null, persisted: false, brokerOrderAllowed: false, reason: "SHADOW_ENTRY_BLOCKED" };
  const persisted = await persistShadowTradeEvidence(evidence, input.ts);
  return { evidence, persisted, brokerOrderAllowed: false, reason: persisted ? "SHADOW_ENTRY_RECORDED_AND_PERSISTED" : "SHADOW_ENTRY_RECORDED_PERSISTENCE_UNCONFIRMED" };
}

export async function applyPersistentForwardShadowEvidenceEvent(
  state: ShadowTradeEvidence,
  event: ShadowLifecycleEventInput,
): Promise<PersistentShadowFlowResult> {
  const evidence = applyForwardShadowEvidenceEvent(state, event);
  if (!evidence) return { evidence: null, persisted: false, brokerOrderAllowed: false, reason: "SHADOW_EVENT_REJECTED" };
  const persisted = await persistShadowTradeEvidence(evidence, event.ts);
  return { evidence, persisted, brokerOrderAllowed: false, reason: persisted ? "SHADOW_EVENT_RECORDED_AND_PERSISTED" : "SHADOW_EVENT_RECORDED_PERSISTENCE_UNCONFIRMED" };
}

export async function recoverLatestShadowTradeEvidence(tradeId: string, limit = 250): Promise<ShadowTradeEvidence | null> {
  if (!tradeId?.trim()) return null;
  const rows = await loadRecentShadowTradeEvidence(limit);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].tradeId === tradeId) return rows[i].evidence;
  }
  return null;
}
