import assert from "node:assert/strict";
import test from "node:test";
import { runCanonicalLiveTenFamilyMissionChain } from "../canonical-live-ten-family-mission-chain.js";
import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";
import type { CanonicalLiveFamilySignalEnvelope } from "../canonical-live-family-signal-registry.js";
import { selectExecutionCandidate } from "../execution-candidate-selector.js";

const now = Date.now();
const hash = "manifest-ten";
const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE", "FUTURES_CONFIRMATION", "OPTION_PREMIUMS", "OI_POSITIONING", "MULTI_DTE",
  "VOLATILITY", "HEAVYWEIGHTS", "SECTOR_BREADTH", "RESPONSE_LADDER", "LIQUIDITY_EXECUTABILITY",
];

function envelope(family: CanonicalMarketFamily): CanonicalLiveFamilySignalEnvelope {
  return {
    provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
    symbol: "NIFTY",
    observedAtMs: now - 1_000,
    signal: {
      family, stance: "BUYER_SUPPORT", strength: 80, deterministic: true, evidenceReady: true,
      sourceId: `engine-${family}`, sourceManifestHash: hash,
      sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT", grantsDirectionalSupport: true, devilFlags: [],
    },
  };
}

function missionInput() {
  const snapshot = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: "snapshot-ten", symbol: "NIFTY", asOfMs: now - 1_000, minuteClosed: true,
    connectionId: "kite-live", instrumentMasterVersion: "master-v1",
    components: families.map((family, index) => ({
      family, status: "VERIFIED" as const, exchangeTimestampMs: now - 1_000,
      receivedAtMs: now - 900, processedAtMs: now - 800, ingestSeq: index + 1,
      provenance: "KITE_WS" as const, source: `verified-${family}`, payload: {}, devilFlags: [],
    })),
    freshnessBudgetsMs: Object.fromEntries(families.map((family) => [family, 60_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  });
  const candidate = {
    symbol: "NIFTY" as const, side: "CE" as const, strike: 23400, expiryDate: "2026-09-15",
    dte: 1, moneyness: "ATM" as const, premiumLtp: 150, capitalFit: true, liquidityOk: true,
    spreadOk: true, premiumResponseConfirmed: true, deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true, multiExpiryConflictAbsent: true, currentOrNearExpiryUsable: true,
    higherDteUsable: false,
  };
  return {
    provenance: "LIVE_CANONICAL_MISSION_ORCHESTRATOR_V1" as const,
    decisionId: "decision-ten", nowMs: now, telegramHorizon: "INTRADAY" as const,
    source: {
      version: "CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1" as const, ready: true,
      sourceManifestHash: hash, snapshot, snapshotReadyForStrictFiltering: true,
      constituentTickCount: 50, blockers: [], readOnly: true as const, shadowOnly: true as const,
      readsLiveConstituentTicks: true as const, forwardsDownstream: false as const,
      affectsDirection: false as const, affectsVerdict: false as const, affectsExecution: false as const,
      affectsTelegram: false as const, grantsCandidateAuthority: false as const,
      wiredIntoServer: false as const, failClosed: true as const,
    },
    evaluations: [{ candidate, selector: selectExecutionCandidate(candidate) }],
  };
}

function input() {
  const coreFamilies: CanonicalMarketFamily[] = ["OPTION_PREMIUMS", "MULTI_DTE", "LIQUIDITY_EXECUTABILITY"];
  const directionalFamilies = families.filter((family) => !coreFamilies.includes(family));
  return {
    core: {
      version: "H1_EXACT_CORE_FAMILY_SIGNAL_ADAPTER_V1" as const, ready: true,
      envelopes: coreFamilies.map(envelope), blockers: [], suppliedStrengthsPreserved: true as const,
      inferredStrengthsUsed: false as const, candidateSelected: false as const, sendsTelegram: false as const,
      createsOrders: false as const, affectsExecution: false as const, failClosed: true as const,
    },
    directional: {
      version: "H1_REMAINING_FAMILY_DIRECTIONAL_ATTESTOR_V1" as const, ready: true,
      envelopes: directionalFamilies.map(envelope), blockers: [], requiredFamilyCount: 7 as const,
      verifiedFamilyCount: 7, contextOnlyEvidencePromoted: false as const,
      optionSideDirectionInferred: false as const, scoresComputed: false as const,
      candidateSelected: false as const, sendsTelegram: false as const, createsOrders: false as const,
      affectsExecution: false as const, failClosed: true as const,
    },
    missionInput: missionInput(),
    sourceManifestHash: hash,
  };
}

test("collects exact 3 plus 7 and runs the sole canonical mission", () => {
  const out = runCanonicalLiveTenFamilyMissionChain(input());
  assert.equal(out.ready, true);
  assert.equal(out.familyCount, 10);
  assert.equal(out.collection?.ready, true);
  assert.equal(out.mission?.stage, "READY_FOR_TELEGRAM_TRANSPORT");
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("partial family groups never reach mission", () => {
  const value = input();
  value.directional.envelopes = value.directional.envelopes.slice(0, 6);
  const out = runCanonicalLiveTenFamilyMissionChain(value);
  assert.equal(out.ready, false);
  assert.equal(out.stage, "DIRECTIONAL_7");
  assert.equal(out.mission, null);
});

test("mixed manifest and mixed symbol fail at registry boundary", () => {
  const manifestMismatch = input();
  manifestMismatch.directional.envelopes[0].signal.sourceManifestHash = "wrong";
  const first = runCanonicalLiveTenFamilyMissionChain(manifestMismatch);
  assert.equal(first.ready, false);
  assert.equal(first.stage, "REGISTRY_10");

  const symbolMismatch = input();
  symbolMismatch.directional.envelopes[0].symbol = "SENSEX";
  const second = runCanonicalLiveTenFamilyMissionChain(symbolMismatch);
  assert.equal(second.ready, false);
  assert.equal(second.stage, "REGISTRY_10");
});
