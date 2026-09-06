import type { BusinessHorizon, BusinessHorizonInput } from "./business-buyer-seller-layer.js";
import type { CanonicalLiveShadowSnapshotSourceResult } from "./canonical-live-shadow-snapshot-source.js";
import type { CanonicalMarketFamily } from "./canonical-one-roof-market-snapshot.js";

export interface CanonicalBusinessEvidenceInputAdapterResult {
  version: "CANONICAL_BUSINESS_EVIDENCE_INPUT_ADAPTER_V1";
  ready: boolean;
  sourceManifestHash: string | null;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" | null;
  horizons: BusinessHorizonInput[];
  verifiedFamilies: CanonicalMarketFamily[];
  blockedFamilies: CanonicalMarketFamily[];
  blockers: string[];
  readOnly: true;
  presentationInputOnly: true;
  scoresComputed: false;
  candidateSelected: false;
  telegramSent: false;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
  failClosed: true;
}

const HORIZONS: BusinessHorizon[] = ["INTRADAY", "MULTIDAY", "EXPIRY"];

function out(
  ready: boolean,
  sourceManifestHash: string | null,
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" | null,
  horizons: BusinessHorizonInput[],
  verifiedFamilies: CanonicalMarketFamily[],
  blockedFamilies: CanonicalMarketFamily[],
  blockers: string[],
): CanonicalBusinessEvidenceInputAdapterResult {
  return {
    version: "CANONICAL_BUSINESS_EVIDENCE_INPUT_ADAPTER_V1",
    ready,
    sourceManifestHash: ready ? sourceManifestHash : null,
    symbol: ready ? symbol : null,
    horizons: ready ? horizons : [],
    verifiedFamilies: ready ? verifiedFamilies : [],
    blockedFamilies: ready ? blockedFamilies : [],
    blockers: [...new Set(blockers)],
    readOnly: true,
    presentationInputOnly: true,
    scoresComputed: false,
    candidateSelected: false,
    telegramSent: false,
    createsOrders: false,
    affectsExecution: false,
    aiMayOverride: false,
    failClosed: true,
  };
}

export function buildCanonicalBusinessEvidenceInputs(
  source: CanonicalLiveShadowSnapshotSourceResult,
): CanonicalBusinessEvidenceInputAdapterResult {
  if (!source?.ready || !source.sourceManifestHash || !source.snapshot) {
    return out(false, null, null, [], [], [], ["CANONICAL_BUSINESS_EVIDENCE_SOURCE_NOT_READY"]);
  }
  if (
    source.readOnly !== true
    || source.shadowOnly !== true
    || source.forwardsDownstream !== false
    || source.affectsDirection !== false
    || source.affectsVerdict !== false
    || source.affectsExecution !== false
    || source.affectsTelegram !== false
    || source.grantsCandidateAuthority !== false
    || source.wiredIntoServer !== false
    || source.failClosed !== true
  ) {
    return out(false, null, null, [], [], [], ["CANONICAL_BUSINESS_EVIDENCE_AUTHORITY_BOUNDARY_INVALID"]);
  }

  const snapshot = source.snapshot;
  if (
    snapshot.failClosed !== true
    || snapshot.createsOrders !== false
    || snapshot.affectsExecution !== false
    || snapshot.aiMayOverride !== false
  ) {
    return out(false, null, null, [], [], [], ["CANONICAL_BUSINESS_EVIDENCE_SNAPSHOT_SAFETY_INVALID"]);
  }

  const verifiedFamilies = snapshot.components.filter((x) => x.status === "VERIFIED").map((x) => x.family);
  const blockedFamilies = snapshot.components.filter((x) => x.status !== "VERIFIED").map((x) => x.family);
  const evidenceReady = snapshot.readyForStrictFiltering === true
    && snapshot.newEntryGate === "ALLOW_NEW_ENTRIES"
    && snapshot.qualityState === "VERIFIED";

  const reasons = [
    `snapshot:${snapshot.snapshotId}`,
    `quality:${snapshot.qualityState}`,
    `verifiedFamilies:${verifiedFamilies.length}`,
    `blockedFamilies:${blockedFamilies.length}`,
  ];
  const devilFlags = evidenceReady ? [] : [...snapshot.internalBlockers];
  const horizons = HORIZONS.map((horizon): BusinessHorizonInput => ({
    horizon,
    buyerScore: null,
    sellerScore: null,
    evidenceReady,
    devilFlags,
    reasons,
  }));

  return out(true, source.sourceManifestHash, snapshot.symbol, horizons, verifiedFamilies, blockedFamilies, []);
}
