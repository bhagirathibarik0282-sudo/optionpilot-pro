import {
  beginPersistentForwardShadowEvidence,
  applyPersistentForwardShadowEvidenceEvent,
  recoverLatestShadowTradeEvidence,
  type PersistentShadowFlowResult,
} from "./forward-shadow-evidence-persistent-flow.js";
import type { ShadowEntryIntegrationInput, ShadowLifecycleEventInput } from "./forward-shadow-evidence-integration.js";
import type { ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";

export interface LiveShadowRuntimeSnapshot {
  version: "LIVE_SHADOW_RUNTIME_V1";
  tradeId: string;
  active: boolean;
  persisted: boolean;
  evidence: ShadowTradeEvidence | null;
  brokerOrderAllowed: false;
  reason: string;
}

export class LiveShadowRuntime {
  private readonly active = new Map<string, ShadowTradeEvidence>();

  async begin(input: ShadowEntryIntegrationInput): Promise<LiveShadowRuntimeSnapshot> {
    if (!input.tradeId?.trim() || this.active.has(input.tradeId)) {
      return this.snapshot(input.tradeId, null, false, "RUNTIME_DUPLICATE_OR_INVALID_TRADE_ID");
    }

    const result = await beginPersistentForwardShadowEvidence(input);
    if (!result.evidence) return this.fromFlow(input.tradeId, result, false);

    this.active.set(input.tradeId, result.evidence);
    return this.fromFlow(input.tradeId, result, true);
  }

  async apply(tradeId: string, event: ShadowLifecycleEventInput): Promise<LiveShadowRuntimeSnapshot> {
    if (!tradeId?.trim()) return this.snapshot(tradeId, null, false, "RUNTIME_INVALID_TRADE_ID");

    let state = this.active.get(tradeId) ?? null;
    if (!state) {
      state = await recoverLatestShadowTradeEvidence(tradeId);
      if (!state) return this.snapshot(tradeId, null, false, "RUNTIME_TRADE_NOT_FOUND");
      if (!state.closed) this.active.set(tradeId, state);
    }

    if (state.closed) {
      this.active.delete(tradeId);
      return this.snapshot(tradeId, state, true, "RUNTIME_TRADE_ALREADY_CLOSED");
    }

    const result = await applyPersistentForwardShadowEvidenceEvent(state, event);
    if (!result.evidence) return this.fromFlow(tradeId, result, true);

    if (result.evidence.closed) this.active.delete(tradeId);
    else this.active.set(tradeId, result.evidence);

    return this.fromFlow(tradeId, result, !result.evidence.closed);
  }

  async recover(tradeId: string): Promise<LiveShadowRuntimeSnapshot> {
    if (!tradeId?.trim()) return this.snapshot(tradeId, null, false, "RUNTIME_INVALID_TRADE_ID");
    const evidence = await recoverLatestShadowTradeEvidence(tradeId);
    if (!evidence) return this.snapshot(tradeId, null, false, "RUNTIME_RECOVERY_NOT_FOUND");
    if (!evidence.closed) this.active.set(tradeId, evidence);
    return this.snapshot(tradeId, evidence, !evidence.closed, evidence.closed ? "RUNTIME_RECOVERED_CLOSED" : "RUNTIME_RECOVERED_ACTIVE");
  }

  getActive(tradeId: string): ShadowTradeEvidence | null {
    return this.active.get(tradeId) ?? null;
  }

  private fromFlow(tradeId: string, result: PersistentShadowFlowResult, active: boolean): LiveShadowRuntimeSnapshot {
    return this.snapshot(tradeId, result.evidence, active, result.reason, result.persisted);
  }

  private snapshot(
    tradeId: string,
    evidence: ShadowTradeEvidence | null,
    active: boolean,
    reason: string,
    persisted = false,
  ): LiveShadowRuntimeSnapshot {
    return {
      version: "LIVE_SHADOW_RUNTIME_V1",
      tradeId,
      active,
      persisted,
      evidence,
      brokerOrderAllowed: false,
      reason,
    };
  }
}
