import { acceptH1ExactPeerObservation, type H1ExactPeerObservationBoundaryResult } from "./h1-exact-peer-observation-boundary.js";
import {
  classifyH1ExactPeerDirectionalState,
  type H1ExactPeerDirectionalStatePolicy,
  type H1ExpectedPremiumDirection,
  type H1ExactPeerDirectionalStateResult,
} from "./h1-exact-peer-directional-state-classifier.js";
import {
  resolveH1ExactMultiExpiryPeers,
  type H1ExactMultiExpiryPeerResolverResult,
  type H1ExactPeerObservation,
} from "./h1-exact-multi-expiry-peer-resolver.js";
import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";

export interface H1ExactPeerRuntimeStoreConfig {
  registryEntries: KiteImmediateTokenEntry[];
  classifierPolicy: H1ExactPeerDirectionalStatePolicy;
  maxObservationAgeMs: number;
  requiredPeerCount: number;
  expectedDirectionFor: (entry: KiteImmediateTokenEntry) => H1ExpectedPremiumDirection;
}

export interface H1ExactPeerRuntimeStoreResult {
  version: "H1_EXACT_PEER_RUNTIME_STORE_V1";
  ready: boolean;
  classifier: H1ExactPeerDirectionalStateResult | null;
  boundary: H1ExactPeerObservationBoundaryResult | null;
  resolver: H1ExactMultiExpiryPeerResolverResult | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

function exactSnapshot(bundle: H1ExactSnapshotBundle) {
  const id = bundle?.identity;
  const pg = bundle?.priceGreek;
  if (!bundle?.ready || !id || !pg || !bundle.observedAt) return null;
  return {
    symbol: id.symbol,
    expiry: id.expiryDate,
    strike: id.strike,
    side: id.side,
    observedAt: bundle.observedAt,
    ltp: pg.ltp,
    delta: pg.delta,
    gamma: pg.gamma,
    source: "LIVE_RUNTIME_EXACT" as const,
  };
}

export class H1ExactPeerRuntimeStore {
  private readonly observationsByToken = new Map<number, H1ExactPeerObservation>();
  private readonly entriesByToken = new Map<number, KiteImmediateTokenEntry>();

  constructor(private readonly config: H1ExactPeerRuntimeStoreConfig) {
    for (const entry of config.registryEntries ?? []) {
      if (Number.isInteger(entry?.instrumentToken) && entry.instrumentToken > 0 && !this.entriesByToken.has(entry.instrumentToken)) {
        this.entriesByToken.set(entry.instrumentToken, entry);
      }
    }
  }

  ingestAndResolve(
    targetInstrumentToken: number,
    previous: H1ExactSnapshotBundle,
    current: H1ExactSnapshotBundle,
    nowIso: string,
  ): H1ExactPeerRuntimeStoreResult {
    const entry = this.entriesByToken.get(targetInstrumentToken);
    if (!entry || entry.role !== "OPTION") return this.result(false, null, null, null, ["TARGET_OPTION_IDENTITY_UNVERIFIED"]);

    const previousExact = exactSnapshot(previous);
    const currentExact = exactSnapshot(current);
    if (!previousExact || !currentExact) return this.result(false, null, null, null, ["EXACT_SNAPSHOT_PAIR_NOT_READY"]);
    if (currentExact.symbol !== entry.symbol || currentExact.expiry !== entry.expiry || currentExact.strike !== entry.strike || currentExact.side !== entry.optionSide) {
      return this.result(false, null, null, null, ["TARGET_TOKEN_SNAPSHOT_IDENTITY_MISMATCH"]);
    }

    let expectedDirection: H1ExpectedPremiumDirection;
    try {
      expectedDirection = this.config.expectedDirectionFor(entry);
    } catch {
      return this.result(false, null, null, null, ["EXPECTED_PREMIUM_DIRECTION_RESOLUTION_FAILED"]);
    }

    const classifier = classifyH1ExactPeerDirectionalState(previousExact, currentExact, expectedDirection, this.config.classifierPolicy);
    if (!classifier.ready || !classifier.directionalState) {
      return this.result(false, classifier, null, null, classifier.blockers.map((x) => `CLASSIFIER_${x}`));
    }

    const boundary = acceptH1ExactPeerObservation({
      instrumentToken: targetInstrumentToken,
      dte: current.identity!.dte,
      observedAt: current.observedAt!,
      directionalState: classifier.directionalState,
      provenance: "LIVE_RUNTIME_EXACT",
    }, this.config.registryEntries);
    if (!boundary.accepted || !boundary.observation) {
      return this.result(false, classifier, boundary, null, boundary.blockers.map((x) => `BOUNDARY_${x}`));
    }

    this.observationsByToken.set(targetInstrumentToken, boundary.observation);

    const target = entry;
    const candidates: H1ExactPeerObservation[] = [];
    for (const [token, observation] of this.observationsByToken) {
      if (token === targetInstrumentToken) continue;
      const peerEntry = this.entriesByToken.get(token);
      if (!peerEntry || peerEntry.role !== "OPTION") continue;
      if (peerEntry.symbol !== target.symbol || peerEntry.optionSide !== target.optionSide || peerEntry.expiry === target.expiry) continue;
      candidates.push(observation);
    }

    const resolver = resolveH1ExactMultiExpiryPeers(
      targetInstrumentToken,
      this.config.registryEntries,
      candidates,
      nowIso,
      { maxObservationAgeMs: this.config.maxObservationAgeMs, requiredPeerCount: this.config.requiredPeerCount },
    );
    return resolver.ready
      ? this.result(true, classifier, boundary, resolver, [])
      : this.result(false, classifier, boundary, resolver, resolver.blockers.map((x) => `RESOLVER_${x}`));
  }

  clear(): void { this.observationsByToken.clear(); }
  getObservationCount(): number { return this.observationsByToken.size; }

  private result(
    ready: boolean,
    classifier: H1ExactPeerDirectionalStateResult | null,
    boundary: H1ExactPeerObservationBoundaryResult | null,
    resolver: H1ExactMultiExpiryPeerResolverResult | null,
    blockers: string[],
  ): H1ExactPeerRuntimeStoreResult {
    return {
      version: "H1_EXACT_PEER_RUNTIME_STORE_V1",
      ready,
      classifier,
      boundary,
      resolver,
      blockers: [...new Set(blockers)],
      productionImpact: "NONE",
      affectsVerdict: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      failClosed: true,
    };
  }
}
