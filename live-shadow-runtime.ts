import {
  beginPersistentForwardShadowEvidence,
  applyPersistentForwardShadowEvidenceEvent,
  recoverLatestShadowTradeEvidence,
  type PersistentShadowFlowResult,
} from "./forward-shadow-evidence-persistent-flow.js";
import type { ShadowEntryIntegrationInput, ShadowLifecycleEventInput } from "./forward-shadow-evidence-integration.js";
import type { ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";
import {
  bindLiveTickToShadowTrade,
  validateShadowContractIdentity,
  type ShadowContractIdentity,
  type LiveShadowMarketTick,
} from "./live-shadow-market-binding.js";

export interface LiveShadowRuntimeSnapshot {
  version: "LIVE_SHADOW_RUNTIME_V2";
  tradeId: string;
  active: boolean;
  persisted: boolean;
  exactContractBound: boolean;
  identity: ShadowContractIdentity | null;
  evidence: ShadowTradeEvidence | null;
  brokerOrderAllowed: false;
  reason: string;
}

export interface LiveShadowRuntimeBeginInput extends ShadowEntryIntegrationInput {
  contract: ShadowContractIdentity;
}

export class LiveShadowRuntime {
  private readonly active = new Map<string, ShadowTradeEvidence>();
  private readonly identities = new Map<string, ShadowContractIdentity>();

  async begin(input: LiveShadowRuntimeBeginInput): Promise<LiveShadowRuntimeSnapshot> {
    if (!input.tradeId?.trim() || this.active.has(input.tradeId) || this.identities.has(input.tradeId)) {
      return this.snapshot(input.tradeId, null, false, "RUNTIME_DUPLICATE_OR_INVALID_TRADE_ID");
    }
    if (!validateShadowContractIdentity(input.contract) || input.contract.index !== input.index) {
      return this.snapshot(input.tradeId, null, false, "RUNTIME_INVALID_OR_MISMATCHED_CONTRACT");
    }

    const { contract: _contract, ...entry } = input;
    const result = await beginPersistentForwardShadowEvidence(entry);
    if (!result.evidence) return this.fromFlow(input.tradeId, result, false);

    this.active.set(input.tradeId, result.evidence);
    this.identities.set(input.tradeId, input.contract);
    return this.fromFlow(input.tradeId, result, true, input.contract);
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
      this.identities.delete(tradeId);
      return this.snapshot(tradeId, state, false, "RUNTIME_TRADE_ALREADY_CLOSED");
    }

    const result = await applyPersistentForwardShadowEvidenceEvent(state, event);
    if (!result.evidence) return this.fromFlow(tradeId, result, true, this.identities.get(tradeId) ?? null);

    if (result.evidence.closed) {
      this.active.delete(tradeId);
      this.identities.delete(tradeId);
    } else {
      this.active.set(tradeId, result.evidence);
    }

    return this.fromFlow(tradeId, result, !result.evidence.closed, this.identities.get(tradeId) ?? null);
  }

  async applyMarketTick(
    tradeId: string,
    tick: LiveShadowMarketTick,
    event: Omit<ShadowLifecycleEventInput, "ts" | "premium">,
  ): Promise<LiveShadowRuntimeSnapshot> {
    const state = this.active.get(tradeId) ?? null;
    const identity = this.identities.get(tradeId) ?? null;
    if (!state || !identity) return this.snapshot(tradeId, state, !!state, "RUNTIME_CONTRACT_BINDING_NOT_FOUND", false, identity);

    const bound = bindLiveTickToShadowTrade(state, identity, tick);
    if (!bound) return this.snapshot(tradeId, state, true, "RUNTIME_LIVE_TICK_CONTRACT_MISMATCH", false, identity);

    return this.apply(tradeId, { ...event, ts: bound.ts, premium: bound.premium });
  }

  async recover(tradeId: string, contract?: ShadowContractIdentity): Promise<LiveShadowRuntimeSnapshot> {
    if (!tradeId?.trim()) return this.snapshot(tradeId, null, false, "RUNTIME_INVALID_TRADE_ID");
    const evidence = await recoverLatestShadowTradeEvidence(tradeId);
    if (!evidence) return this.snapshot(tradeId, null, false, "RUNTIME_RECOVERY_NOT_FOUND");
    if (contract) {
      if (!validateShadowContractIdentity(contract) || contract.index !== evidence.index) {
        return this.snapshot(tradeId, evidence, false, "RUNTIME_RECOVERY_CONTRACT_MISMATCH");
      }
      this.identities.set(tradeId, contract);
    }
    if (!evidence.closed) this.active.set(tradeId, evidence);
    return this.snapshot(
      tradeId,
      evidence,
      !evidence.closed,
      evidence.closed ? "RUNTIME_RECOVERED_CLOSED" : "RUNTIME_RECOVERED_ACTIVE",
      false,
      contract ?? this.identities.get(tradeId) ?? null,
    );
  }

  getActive(tradeId: string): ShadowTradeEvidence | null {
    return this.active.get(tradeId) ?? null;
  }

  getContract(tradeId: string): ShadowContractIdentity | null {
    return this.identities.get(tradeId) ?? null;
  }

  private fromFlow(
    tradeId: string,
    result: PersistentShadowFlowResult,
    active: boolean,
    identity: ShadowContractIdentity | null = null,
  ): LiveShadowRuntimeSnapshot {
    return this.snapshot(tradeId, result.evidence, active, result.reason, result.persisted, identity);
  }

  private snapshot(
    tradeId: string,
    evidence: ShadowTradeEvidence | null,
    active: boolean,
    reason: string,
    persisted = false,
    identity: ShadowContractIdentity | null = null,
  ): LiveShadowRuntimeSnapshot {
    return {
      version: "LIVE_SHADOW_RUNTIME_V2",
      tradeId,
      active,
      persisted,
      exactContractBound: identity !== null,
      identity,
      evidence,
      brokerOrderAllowed: false,
      reason,
    };
  }
}
