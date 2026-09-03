import { evaluateLivePremiumDeltaGamma, type LiveOptionContractSnapshot, type LivePremiumDeltaGammaPolicy } from "./h1-live-premium-delta-gamma-evaluator.js";
import { evaluateLiveThetaIvAndMultiExpiry, type LiveOptionBurdenSnapshot, type MultiExpiryPeerSnapshot, type ThetaIvMultiExpiryPolicy } from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import { evaluateLiveCapitalLiquidityDteGates, type LiveCapitalLiquidityDteEvidence, type LiveCapitalLiquidityDtePolicy } from "./h1-live-capital-liquidity-dte-gates.js";
import type { LiveGateEvidencePacket, LiveCandidateIdentityEvidence, LiveBooleanGateEvidence } from "./h1-live-gate-evidence-assembler.js";

export interface H1LivePublisherPacketProducerInput {
  identity: LiveCandidateIdentityEvidence;
  previousPremiumSnapshot: LiveOptionContractSnapshot;
  currentPremiumSnapshot: LiveOptionContractSnapshot;
  premiumPolicy: LivePremiumDeltaGammaPolicy;
  burdenSnapshot: LiveOptionBurdenSnapshot;
  multiExpiryPeers: MultiExpiryPeerSnapshot[];
  burdenPolicy: ThetaIvMultiExpiryPolicy;
  capitalLiquidityDteEvidence: LiveCapitalLiquidityDteEvidence;
  capitalLiquidityDtePolicy: LiveCapitalLiquidityDtePolicy;
  nowIso: string;
}

export interface H1LivePublisherPacketProducerResult {
  version: "H1_LIVE_PUBLISHER_PACKET_PRODUCER_V1";
  ready: boolean;
  packet: LiveGateEvidencePacket | null;
  blockers: string[];
  failClosed: true;
  semantics: "RAW_LIVE_EXACT_INPUTS_BOUND_TO_ONE_CONTRACT_NO_RESULT_REUSE";
}

function samePremiumIdentity(identity: LiveCandidateIdentityEvidence, snapshot: LiveOptionContractSnapshot): boolean {
  return snapshot.source === "LIVE_RUNTIME_EXACT" &&
    snapshot.symbol.trim().toUpperCase() === identity.symbol &&
    snapshot.expiry === identity.expiryDate &&
    snapshot.strike === identity.strike &&
    snapshot.side === identity.side;
}

function sameBurdenIdentity(identity: LiveCandidateIdentityEvidence, snapshot: LiveOptionBurdenSnapshot): boolean {
  return snapshot.source === "LIVE_RUNTIME_EXACT" &&
    snapshot.symbol === identity.symbol &&
    snapshot.expiryDate === identity.expiryDate &&
    snapshot.strike === identity.strike &&
    snapshot.side === identity.side &&
    snapshot.dte === identity.dte &&
    snapshot.premiumLtp === identity.premiumLtp;
}

function sameCapitalIdentity(identity: LiveCandidateIdentityEvidence, evidence: LiveCapitalLiquidityDteEvidence): boolean {
  return evidence.provenance === "LIVE_RUNTIME_EXACT" &&
    evidence.symbol === identity.symbol &&
    evidence.dte === identity.dte &&
    evidence.premiumLtp === identity.premiumLtp;
}

function gate(value: boolean, observedAt: string, source: string): LiveBooleanGateEvidence {
  return { value, observedAt, source, provenance: "LIVE_RUNTIME_EXACT" };
}

export function produceH1LivePublisherPacket(input: H1LivePublisherPacketProducerInput): H1LivePublisherPacketProducerResult {
  const blockers: string[] = [];
  const identity = input?.identity;

  if (!identity || identity.provenance !== "LIVE_RUNTIME_EXACT") blockers.push("INVALID_IDENTITY_PROVENANCE");
  if (identity && (!samePremiumIdentity(identity, input.previousPremiumSnapshot) || !samePremiumIdentity(identity, input.currentPremiumSnapshot))) {
    blockers.push("PREMIUM_CONTRACT_IDENTITY_MISMATCH");
  }
  if (identity && !sameBurdenIdentity(identity, input.burdenSnapshot)) blockers.push("BURDEN_CONTRACT_IDENTITY_MISMATCH");
  if (identity && !sameCapitalIdentity(identity, input.capitalLiquidityDteEvidence)) blockers.push("CAPITAL_LIQUIDITY_DTE_IDENTITY_MISMATCH");

  if (blockers.length > 0) {
    return { version: "H1_LIVE_PUBLISHER_PACKET_PRODUCER_V1", ready: false, packet: null, blockers, failClosed: true, semantics: "RAW_LIVE_EXACT_INPUTS_BOUND_TO_ONE_CONTRACT_NO_RESULT_REUSE" };
  }

  const premium = evaluateLivePremiumDeltaGamma(input.previousPremiumSnapshot, input.currentPremiumSnapshot, input.premiumPolicy);
  if (premium.premiumResponseConfirmed == null || premium.deltaGammaResponseConfirmed == null) {
    blockers.push(...premium.reasonCodes.map((x) => `PREMIUM_EVALUATOR_${x}`));
  }

  const burden = evaluateLiveThetaIvAndMultiExpiry(input.burdenSnapshot, input.multiExpiryPeers, input.nowIso, input.burdenPolicy);
  const burdenInvalid = burden.reasonCodes.some((x) =>
    x.startsWith("INVALID_") || x.startsWith("NON_EXACT_") || x.startsWith("FUTURE_") || x.startsWith("STALE_") || x === "INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS"
  );
  if (burdenInvalid) blockers.push(...burden.reasonCodes.map((x) => `BURDEN_EVALUATOR_${x}`));

  const capital = evaluateLiveCapitalLiquidityDteGates(input.capitalLiquidityDteEvidence, input.capitalLiquidityDtePolicy);
  const capitalInvalid = capital.reasonCodes.some((x) => x === "INVALID_PROVENANCE" || x.startsWith("INVALID_"));
  if (capitalInvalid) blockers.push(...capital.reasonCodes.map((x) => `CAPITAL_EVALUATOR_${x}`));

  if (blockers.length > 0) {
    return { version: "H1_LIVE_PUBLISHER_PACKET_PRODUCER_V1", ready: false, packet: null, blockers, failClosed: true, semantics: "RAW_LIVE_EXACT_INPUTS_BOUND_TO_ONE_CONTRACT_NO_RESULT_REUSE" };
  }

  const premiumObservedAt = input.currentPremiumSnapshot.observedAt;
  const burdenObservedAt = input.burdenSnapshot.observedAt;
  const capitalObservedAt = input.capitalLiquidityDteEvidence.occurredAt;

  const gates: LiveGateEvidencePacket["gates"] = {
    capitalFit: gate(capital.capitalFit, capitalObservedAt, capital.version),
    liquidityOk: gate(capital.liquidityOk, capitalObservedAt, capital.version),
    spreadOk: gate(capital.spreadOk, capitalObservedAt, capital.version),
    premiumResponseConfirmed: gate(premium.premiumResponseConfirmed!, premiumObservedAt, premium.version),
    deltaGammaResponseConfirmed: gate(premium.deltaGammaResponseConfirmed!, premiumObservedAt, premium.version),
    thetaIvBurdenAcceptable: gate(burden.thetaIvBurdenAcceptable, burdenObservedAt, burden.version),
    multiExpiryConflictAbsent: gate(burden.multiExpiryConflictAbsent, burdenObservedAt, burden.version),
  };

  if (identity.symbol === "BANKNIFTY") {
    gates.higherDteUsable = gate(capital.higherDteUsable, capitalObservedAt, capital.version);
  } else {
    gates.currentOrNearExpiryUsable = gate(capital.currentOrNearExpiryUsable, capitalObservedAt, capital.version);
    if (identity.dte >= 5 && identity.dte <= 7) {
      gates.fallbackDteApproved = gate(capital.fallbackDteApproved, capitalObservedAt, capital.version);
    }
  }

  return {
    version: "H1_LIVE_PUBLISHER_PACKET_PRODUCER_V1",
    ready: true,
    packet: { identity, gates },
    blockers: [],
    failClosed: true,
    semantics: "RAW_LIVE_EXACT_INPUTS_BOUND_TO_ONE_CONTRACT_NO_RESULT_REUSE",
  };
}
