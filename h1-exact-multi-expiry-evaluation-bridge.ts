import {
  evaluateLiveThetaIvAndMultiExpiry,
  type LiveOptionBurdenSnapshot,
  type ThetaIvMultiExpiryPolicy,
  type ThetaIvMultiExpiryResult,
} from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import {
  resolveH1ExactMultiExpiryPeers,
  type H1ExactMultiExpiryPeerResolverPolicy,
  type H1ExactMultiExpiryPeerResolverResult,
  type H1ExactPeerObservation,
} from "./h1-exact-multi-expiry-peer-resolver.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1ExactMultiExpiryEvaluationBridgeResult {
  version: "H1_EXACT_MULTI_EXPIRY_EVALUATION_BRIDGE_V1";
  ready: boolean;
  peerResolution: H1ExactMultiExpiryPeerResolverResult;
  evaluation: ThetaIvMultiExpiryResult | null;
  blockers: string[];
  productionImpact: "NONE";
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function blocked(
  peerResolution: H1ExactMultiExpiryPeerResolverResult,
  blockers: string[],
): H1ExactMultiExpiryEvaluationBridgeResult {
  return {
    version: "H1_EXACT_MULTI_EXPIRY_EVALUATION_BRIDGE_V1",
    ready: false,
    peerResolution,
    evaluation: null,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}

export function evaluateH1ExactMultiExpiryBridge(
  targetInstrumentToken: number,
  current: LiveOptionBurdenSnapshot,
  registryEntries: KiteImmediateTokenEntry[],
  observations: H1ExactPeerObservation[],
  nowIso: string,
  resolverPolicy: H1ExactMultiExpiryPeerResolverPolicy,
  evaluatorPolicy: ThetaIvMultiExpiryPolicy,
): H1ExactMultiExpiryEvaluationBridgeResult {
  const peerResolution = resolveH1ExactMultiExpiryPeers(
    targetInstrumentToken,
    registryEntries,
    observations,
    nowIso,
    resolverPolicy,
  );

  if (!peerResolution.ready) {
    return blocked(peerResolution, ["EXACT_PEER_RESOLUTION_NOT_READY", ...peerResolution.blockers]);
  }

  const target = registryEntries.find((entry) => entry.instrumentToken === targetInstrumentToken);
  const identityVerified = !!target && target.role === "OPTION" &&
    target.symbol === current?.symbol &&
    target.optionSide === current?.side &&
    target.expiry === current?.expiryDate &&
    Number(target.strike) === Number(current?.strike);

  if (!identityVerified) {
    return blocked(peerResolution, ["CURRENT_TARGET_IDENTITY_MISMATCH"]);
  }

  const evaluation = evaluateLiveThetaIvAndMultiExpiry(
    current,
    peerResolution.peers,
    nowIso,
    evaluatorPolicy,
  );

  const passed = evaluation.thetaIvBurdenAcceptable &&
    evaluation.multiExpiryConflictAbsent &&
    evaluation.reasonCodes.length === 1 &&
    evaluation.reasonCodes[0] === "THETA_IV_AND_MULTI_EXPIRY_GATES_PASSED";

  return {
    version: "H1_EXACT_MULTI_EXPIRY_EVALUATION_BRIDGE_V1",
    ready: passed,
    peerResolution,
    evaluation,
    blockers: passed ? [] : [...new Set(evaluation.reasonCodes)],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
