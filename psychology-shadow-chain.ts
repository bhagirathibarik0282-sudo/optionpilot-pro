import { classifyPremiumBehaviour, type PremiumBehaviourEvidence } from "./premium-behaviour-engine.ts";
import { classifyBuyerSellerBehaviour, type BuyerSellerEvidence } from "./buyer-seller-behaviour-engine.ts";
import { advanceTradeLifecycle, type TradeLifecycleInput } from "./trade-lifecycle-engine.ts";
import { classifyBehaviourRisk, type BehaviourRiskEvidence } from "./behaviour-risk-engine.ts";
import { evaluateMessageTrigger, type MessageTriggerInput } from "./message-trigger-engine.ts";
import { evaluateLivePsychologyCoach, type CandidateIdentity } from "./live-psychology-coach-contract.ts";

export interface PsychologyShadowChainInput {
  candidate: CandidateIdentity;
  premiumEvidence: PremiumBehaviourEvidence;
  buyerSellerEvidence: BuyerSellerEvidence;
  lifecycleInput: TradeLifecycleInput;
  behaviourRiskEvidence: BehaviourRiskEvidence;
  triggerInput: Omit<MessageTriggerInput, "candidateKey" | "lifecycle" | "dataFresh" | "currentFingerprint">;
}

export interface PsychologyShadowChainResult {
  version: "PSYCHOLOGY_SHADOW_CHAIN_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  candidateKey: string;
  currentFingerprint: string;
  premium: ReturnType<typeof classifyPremiumBehaviour>;
  buyerSeller: ReturnType<typeof classifyBuyerSellerBehaviour>;
  lifecycle: ReturnType<typeof advanceTradeLifecycle>;
  behaviourRisk: ReturnType<typeof classifyBehaviourRisk>;
  trigger: ReturnType<typeof evaluateMessageTrigger>;
  coach: ReturnType<typeof evaluateLivePsychologyCoach>;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

export function buildPsychologyCandidateKey(candidate: CandidateIdentity): string {
  return [
    candidate.style,
    candidate.symbol.trim().toUpperCase(),
    candidate.side,
    String(candidate.strike),
    candidate.expiryDate.trim(),
    candidate.candidateId.trim(),
  ].join(":");
}

function buildPsychologyFingerprint(
  candidateKey: string,
  lifecycle: ReturnType<typeof advanceTradeLifecycle>,
  premium: ReturnType<typeof classifyPremiumBehaviour>,
  buyerSeller: ReturnType<typeof classifyBuyerSellerBehaviour>,
  behaviourRisk: ReturnType<typeof classifyBehaviourRisk>,
  allFresh: boolean,
): string {
  const risks = [...behaviourRisk.risks].sort().join(",") || "NONE";
  return [
    candidateKey,
    allFresh ? "DATA_FRESH" : "DATA_UNAVAILABLE",
    lifecycle.nextState,
    premium.state,
    buyerSeller.state,
    risks,
  ].join(":");
}

/**
 * Research-only composition layer. Each deterministic engine remains authoritative for its own state;
 * Message Trigger Engine alone decides whether a message is eligible; coach/Haiku cannot override it.
 * Candidate scope and message fingerprint are constructed internally so callers cannot spoof them.
 */
export function runPsychologyShadowChain(input: PsychologyShadowChainInput): PsychologyShadowChainResult {
  const premium = classifyPremiumBehaviour(input.premiumEvidence);
  const buyerSeller = classifyBuyerSellerBehaviour(input.buyerSellerEvidence);
  const lifecycle = advanceTradeLifecycle(input.lifecycleInput);
  const behaviourRisk = classifyBehaviourRisk(input.behaviourRiskEvidence);

  const candidateKey = buildPsychologyCandidateKey(input.candidate);
  const allFresh =
    lifecycle.dataAvailable &&
    premium.state !== "DATA_UNAVAILABLE" &&
    buyerSeller.state !== "DATA_UNAVAILABLE" &&
    !behaviourRisk.risks.includes("DATA_UNAVAILABLE");
  const currentFingerprint = buildPsychologyFingerprint(candidateKey, lifecycle, premium, buyerSeller, behaviourRisk, allFresh);

  const trigger = evaluateMessageTrigger({
    ...input.triggerInput,
    candidateKey,
    lifecycle: lifecycle.nextState,
    dataFresh: allFresh,
    lifecycleChanged: lifecycle.changed,
    currentFingerprint,
  });

  const coach = evaluateLivePsychologyCoach({
    candidate: input.candidate,
    premiumBehaviour: premium.state,
    buyerSellerState: buyerSeller.state,
    lifecycle: lifecycle.nextState,
    risks: behaviourRisk.risks,
    dataFresh: allFresh,
    meaningfulChange: trigger.shouldSpeak,
    consecutiveConfirmations: input.triggerInput.consecutiveConfirmations,
    triggerShouldSpeak: trigger.shouldSpeak,
    triggerReason: trigger.reason,
  });

  if (coach.shouldSpeak !== trigger.shouldSpeak) {
    throw new Error("psychology coach must not override message trigger decision");
  }

  return {
    version: "PSYCHOLOGY_SHADOW_CHAIN_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    candidateKey,
    currentFingerprint,
    premium,
    buyerSeller,
    lifecycle,
    behaviourRisk,
    trigger,
    coach,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
