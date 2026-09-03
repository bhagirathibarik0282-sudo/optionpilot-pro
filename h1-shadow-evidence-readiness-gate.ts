import type { KiteH1ExactShadowPacketBridgeStatus } from "./kite-h1-exact-shadow-packet-bridge.js";
import type { KiteH1ExactShadowSupervisorStatus } from "./kite-h1-exact-shadow-supervisor.js";

export interface H1ShadowEvidenceReadinessPolicy {
  minProcessedPackets: number;
  minExactReadyPackets: number;
  maxRejectRatio: number;
  maxRuntimeExceptions: number;
  maxEvidenceAgeMs: number;
}

export interface H1ShadowEvidenceReadinessResult {
  version: "H1_SHADOW_EVIDENCE_READINESS_GATE_V1";
  readyForNextShadowStage: boolean;
  blockers: string[];
  processedPackets: number;
  exactReadyPackets: number;
  rejectedPackets: number;
  runtimeExceptions: number;
  newestExactReadyTimestamp: string | null;
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function validIso(value: string | null | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validPolicy(p: H1ShadowEvidenceReadinessPolicy): boolean {
  return Number.isInteger(p.minProcessedPackets) && p.minProcessedPackets > 0 &&
    Number.isInteger(p.minExactReadyPackets) && p.minExactReadyPackets > 0 &&
    Number.isFinite(p.maxRejectRatio) && p.maxRejectRatio >= 0 && p.maxRejectRatio <= 1 &&
    Number.isInteger(p.maxRuntimeExceptions) && p.maxRuntimeExceptions >= 0 &&
    Number.isFinite(p.maxEvidenceAgeMs) && p.maxEvidenceAgeMs > 0;
}

/**
 * Pure research-shadow readiness gate. It never starts transport, publishes a
 * candidate, sends Telegram, changes a verdict, or grants execution/promotion
 * authority. It only answers whether already-observed shadow evidence is strong
 * enough to justify building/testing the next shadow-only stage.
 */
export function evaluateH1ShadowEvidenceReadiness(
  bridge: KiteH1ExactShadowPacketBridgeStatus | null,
  supervisor: KiteH1ExactShadowSupervisorStatus | null,
  nowIso: string,
  policy: H1ShadowEvidenceReadinessPolicy,
): H1ShadowEvidenceReadinessResult {
  const blockers: string[] = [];
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || !validPolicy(policy)) blockers.push("INVALID_READINESS_POLICY_OR_NOW");
  if (!bridge && !supervisor) blockers.push("MISSING_SHADOW_EVIDENCE_STATUS");

  const processedPackets = Math.max(bridge?.packetCount ?? 0, supervisor?.processedPacketCount ?? 0);
  const exactReadyPackets = bridge?.exactReadyCount ?? 0;
  const rejectedPackets = Math.max(bridge?.rejectedCount ?? 0, supervisor?.dualPathBlockedCount ?? 0);
  const runtimeExceptions = supervisor?.runtimeExceptionCount ?? 0;

  if (bridge) {
    if (bridge.productionImpact !== "NONE" || bridge.affectsTelegram || bridge.affectsVerdict || bridge.affectsExecution || bridge.opensTransport || !bridge.failClosed) {
      blockers.push("BRIDGE_AUTHORITY_CONTRACT_VIOLATION");
    }
  }
  if (supervisor) {
    if (supervisor.productionImpact !== "NONE" || supervisor.affectsTelegram || supervisor.affectsVerdict || supervisor.affectsExecution) {
      blockers.push("SUPERVISOR_AUTHORITY_CONTRACT_VIOLATION");
    }
  }

  if (processedPackets < policy.minProcessedPackets) blockers.push("INSUFFICIENT_PROCESSED_SHADOW_PACKETS");
  if (exactReadyPackets < policy.minExactReadyPackets) blockers.push("INSUFFICIENT_EXACT_READY_SHADOW_PACKETS");
  if (processedPackets > 0 && rejectedPackets / processedPackets > policy.maxRejectRatio) blockers.push("SHADOW_REJECT_RATIO_TOO_HIGH");
  if (runtimeExceptions > policy.maxRuntimeExceptions) blockers.push("SHADOW_RUNTIME_EXCEPTIONS_TOO_HIGH");

  const candidates = [bridge?.lastExactReadyTimestamp, supervisor?.lastExactReadyTimestamp].filter(validIso);
  const newestExactReadyTimestamp = candidates.length > 0
    ? candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    : null;

  if (!newestExactReadyTimestamp) {
    blockers.push("MISSING_EXACT_READY_TIMESTAMP");
  } else if (Number.isFinite(now)) {
    const evidenceTs = Date.parse(newestExactReadyTimestamp);
    const age = now - evidenceTs;
    if (age < 0) blockers.push("FUTURE_SHADOW_EVIDENCE");
    if (age > policy.maxEvidenceAgeMs) blockers.push("STALE_SHADOW_EVIDENCE");
  }

  return {
    version: "H1_SHADOW_EVIDENCE_READINESS_GATE_V1",
    readyForNextShadowStage: blockers.length === 0,
    blockers: [...new Set(blockers)],
    processedPackets,
    exactReadyPackets,
    rejectedPackets,
    runtimeExceptions,
    newestExactReadyTimestamp,
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
