import assert from "node:assert/strict";
import test from "node:test";
import type { LiveGateEvidencePacket, LiveGateName } from "../h1-live-gate-evidence-assembler.js";
import type { H1CanonicalLiveBusinessRuntimeCoordinatorResult } from "../h1-canonical-live-business-runtime-coordinator.js";
import type { H1GoldLiveRuntimeBridgeResult } from "../h1-gold-live-runtime-bridge-v1.js";
import type { H1GoldChaseResearchBootstrapResult } from "../h1-gold-chase-research-bootstrap-v1.js";
import {
  auditH1GoldChaseRuntimeAttachment,
  H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1,
} from "../h1-gold-chase-runtime-attachment-gate-v1.js";

const OBSERVED_AT = "2026-09-17T03:45:00.000Z";
const CANDIDATE_KEY = "NIFTY|2026-09-22|24000|CE";
const DECISION_ID = "bootstrap|snapshot|candidate";

function packet(): LiveGateEvidencePacket {
  const names: LiveGateName[] = ["capitalFit", "liquidityOk", "spreadOk", "currentOrNearExpiryUsable", "fallbackDteApproved"];
  return {
    identity: {
      symbol: "NIFTY", side: "CE", strike: 24000, expiryDate: "2026-09-22", dte: 5,
      moneyness: "ATM", premiumLtp: 110, observedAt: OBSERVED_AT,
      source: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: Object.fromEntries(names.map((name) => [name, {
      value: true, observedAt: OBSERVED_AT, source: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1", provenance: "LIVE_RUNTIME_EXACT",
    }])) as LiveGateEvidencePacket["gates"],
    ppdSupport: {
      version: "H1_LIVE_PPD_SUPPORT_V1",
      provenance: "LIVE_RUNTIME_EXACT",
      source: "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION",
      observedAt: OBSERVED_AT,
      symbol: "NIFTY",
      expiryDate: "2026-09-22",
      strike: 24000,
      candidateSide: "CE",
      allRequiredWindowsReady: true,
      candidateConfirmed: true,
      windows: ([3, 6, 15] as const).map((windowMinutes) => ({
        windowMinutes,
        usable: true,
        from: "2026-09-17T03:30:00.000Z",
        to: OBSERVED_AT,
        controllingSide: "CE" as const,
        pairState: "CE_CONTROLLED_EXPANSION" as const,
        rawPpdPp: 2,
        candidateOrientedPpdPp: 2,
        candidateControlledExpansion: true,
        reason: null,
      })),
      reasonCodes: ["PPD_3M_6M_15M_CANDIDATE_CONTROL_CONFIRMED"],
      supportingOnly: true,
      standaloneTrigger: false,
      productionImpact: "SELECTOR_SUPPORTING_EVIDENCE",
    },
  };
}

function canonicalRuntime(): H1CanonicalLiveBusinessRuntimeCoordinatorResult {
  return {
    version: "H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1",
    ready: true,
    stage: "READY_FOR_TELEGRAM_TRANSPORT",
    core: {} as H1CanonicalLiveBusinessRuntimeCoordinatorResult["core"],
    producer: {} as H1CanonicalLiveBusinessRuntimeCoordinatorResult["producer"],
    attestor: {} as H1CanonicalLiveBusinessRuntimeCoordinatorResult["attestor"],
    missionChain: {} as H1CanonicalLiveBusinessRuntimeCoordinatorResult["missionChain"],
    blockers: [], sendsTelegram: false, createsOrders: false, affectsExecution: false, failClosed: true,
  };
}

function goldBridge(): H1GoldLiveRuntimeBridgeResult {
  return {
    version: "H1_GOLD_LIVE_RUNTIME_BRIDGE_V1", ready: true, symbol: "NIFTY", side: "CE", observedAt: OBSERVED_AT,
    dataIntegrity: {} as H1GoldLiveRuntimeBridgeResult["dataIntegrity"],
    spotStructure: {} as H1GoldLiveRuntimeBridgeResult["spotStructure"],
    targetFuturesPositioning: {} as H1GoldLiveRuntimeBridgeResult["targetFuturesPositioning"],
    leaderPositioning: {} as H1GoldLiveRuntimeBridgeResult["leaderPositioning"],
    chainRepositioning: {} as H1GoldLiveRuntimeBridgeResult["chainRepositioning"],
    blockers: [], mappedCoreFamilyCount: 4, productionImpact: "NONE", affectsSelector: false,
    affectsTelegram: false, affectsExecution: false, grantsPromotionAuthority: false,
    candidateSelected: false, createsOrders: false, failClosed: true,
    semantics: "TYPED_CANONICAL_AND_ATTESTED_RUNTIME_BRIDGE_NO_ALIAS_NO_THRESHOLD_NO_INFERENCE",
  };
}

function bootstrap(): H1GoldChaseResearchBootstrapResult {
  return {
    version: "H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1", state: "READY_FOR_FORWARD_COLLECTION", ready: true,
    candidateKey: CANDIDATE_KEY, decisionId: DECISION_ID,
    adapted: {
      canonicalRootValid: true,
      families: { dataIntegrity: "PASS", premiumPair: "PASS", executionQuality: "PASS" },
    } as unknown as H1GoldChaseResearchBootstrapResult["adapted"],
    shadowCandidate: { state: "GOLDEN_SHADOW_CANDIDATE" } as unknown as H1GoldChaseResearchBootstrapResult["shadowCandidate"],
    observation: { state: "OBSERVABLE", readyForForwardCalibration: true } as unknown as H1GoldChaseResearchBootstrapResult["observation"],
    observationInput: {} as H1GoldChaseResearchBootstrapResult["observationInput"],
    journal: { anchor: { selectedCandidateKey: CANDIDATE_KEY, decisionId: DECISION_ID } } as H1GoldChaseResearchBootstrapResult["journal"],
    strictGoldRequired: false, chasePolicyDefined: false, outcomeClassificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false, productionImpact: "NONE", affectsGoldEligibility: false,
    affectsSelector: false, affectsTelegram: false, affectsExecution: false, grantsPromotionAuthority: false,
    createsOrders: false, failClosed: true,
  } as H1GoldChaseResearchBootstrapResult;
}

function input() {
  return {
    registryProcessIdentity: "h1-exact-shadow-live-service",
    collectorProcessIdentity: "h1-exact-shadow-live-service",
    packet: packet(), canonicalRuntime: canonicalRuntime(), goldBridge: goldBridge(), bootstrap: bootstrap(),
  };
}

test("permits only a complete approved bootstrap lineage inside the registry-owning process", () => {
  const out = auditH1GoldChaseRuntimeAttachment(input());
  assert.equal(out.version, H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1);
  assert.equal(out.state, "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT");
  assert.equal(out.ready, true);
  assert.equal(out.candidateKey, CANDIDATE_KEY);
  assert.equal(out.startsRuntime, false);
  assert.equal(out.schedulesSampling, false);
  assert.equal(out.persistsSamples, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("blocks a standalone collector process because the exact selector registry is process-local", () => {
  const value = input();
  value.collectorProcessIdentity = "standalone-gold-collector";
  const out = auditH1GoldChaseRuntimeAttachment(value);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("PROCESS_LOCAL_SELECTOR_REGISTRY_NOT_SHARED"));
});

test("blocks current startup frontier when canonical runtime or approved Gold bridge is absent", () => {
  const value = input();
  value.canonicalRuntime = null as unknown as H1CanonicalLiveBusinessRuntimeCoordinatorResult;
  value.goldBridge = null as unknown as H1GoldLiveRuntimeBridgeResult;
  const out = auditH1GoldChaseRuntimeAttachment(value);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("CANONICAL_LIVE_RUNTIME_NOT_READY"));
  assert.ok(out.blockers.includes("APPROVED_GOLD_LIVE_BRIDGE_NOT_READY"));
});

test("blocks missing controlled-expansion PPD instead of treating raw premium response as Gold evidence", () => {
  const value = input();
  delete value.packet.ppdSupport;
  const out = auditH1GoldChaseRuntimeAttachment(value);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("APPROVED_PREMIUM_PAIR_EVIDENCE_REQUIRED"));
});

test("blocks timestamp or frozen candidate identity drift across the attachment lineage", () => {
  const value = input();
  value.goldBridge.observedAt = "2026-09-17T03:46:00.000Z";
  value.bootstrap.candidateKey = "NIFTY|2026-09-22|24100|CE";
  const out = auditH1GoldChaseRuntimeAttachment(value);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("GOLD_BRIDGE_IDENTITY_OR_TIMESTAMP_MISMATCH"));
  assert.ok(out.blockers.includes("BOOTSTRAP_FROZEN_IDENTITY_MISMATCH"));
});

test("blocks any bootstrap that claims selector, Telegram, execution or promotion authority", () => {
  const value = input();
  value.bootstrap.affectsTelegram = true as false;
  const out = auditH1GoldChaseRuntimeAttachment(value);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("SAFE_RESEARCH_BOOTSTRAP_NOT_READY"));
});
