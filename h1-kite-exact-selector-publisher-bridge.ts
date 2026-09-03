import {
  bindKiteOptionPacketToH1ExactSnapshot,
  type H1KiteExactOptionSnapshotBindingInput,
} from "./h1-kite-exact-option-snapshot-binding.js";
import type { H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import {
  bindH1LiveExactSnapshotsToPublisher,
  type H1LiveSnapshotPublisherBindingInput,
  type H1LiveSnapshotPublisherBindingResult,
} from "./h1-live-snapshot-publisher-binding.js";
import { publishH1LiveGateEvidence } from "./h1-live-selector-registry.js";

export interface H1KiteExactSelectorPublisherBridgeInput {
  snapshot: H1KiteExactOptionSnapshotBindingInput;
  publisher: Omit<H1LiveSnapshotPublisherBindingInput, "previous" | "current" | "nowIso">;
}

export interface H1KiteExactSelectorPublisherBridgeResult {
  version: "H1_KITE_EXACT_SELECTOR_PUBLISHER_BRIDGE_V1";
  ready: boolean;
  snapshot: H1ExactSnapshotBundle;
  publisher: H1LiveSnapshotPublisherBindingResult | null;
  publication: { accepted: boolean; reason: string } | null;
  blockers: string[];
  failClosed: true;
  semantics: "FORWARD_SAME_CONTRACT_EXACT_SNAPSHOTS_TO_SELECTOR_REGISTRY";
}

const VERSION = "H1_KITE_EXACT_SELECTOR_PUBLISHER_BRIDGE_V1" as const;
const SEMANTICS = "FORWARD_SAME_CONTRACT_EXACT_SNAPSHOTS_TO_SELECTOR_REGISTRY" as const;

function contractKey(snapshot: H1ExactSnapshotBundle): string | null {
  const id = snapshot.identity;
  return id ? `${id.symbol}|${id.expiryDate}|${id.strike}|${id.side}|${id.dte}` : null;
}

function result(
  snapshot: H1ExactSnapshotBundle,
  publisher: H1LiveSnapshotPublisherBindingResult | null,
  publication: { accepted: boolean; reason: string } | null,
  blockers: string[],
): H1KiteExactSelectorPublisherBridgeResult {
  return {
    version: VERSION,
    ready: blockers.length === 0 && publication?.accepted === true,
    snapshot,
    publisher,
    publication,
    blockers,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

/**
 * Holds only the latest ready exact snapshot per contract. A later exact packet
 * must move time forward before it can become the current publisher snapshot.
 * Nothing is published until the existing publisher binding is itself ready.
 */
export class H1KiteExactSelectorPublisherBridge {
  private readonly latestByContract = new Map<string, H1ExactSnapshotBundle>();

  ingest(input: H1KiteExactSelectorPublisherBridgeInput): H1KiteExactSelectorPublisherBridgeResult {
    const snapshot = bindKiteOptionPacketToH1ExactSnapshot(input.snapshot);
    const key = contractKey(snapshot);

    if (!snapshot.ready || !key || !snapshot.observedAt) {
      return result(snapshot, null, null, snapshot.blockers.map((x) => `SNAPSHOT_${x}`));
    }

    const previous = this.latestByContract.get(key);
    if (!previous) {
      this.latestByContract.set(key, snapshot);
      return result(snapshot, null, null, ["PREVIOUS_EXACT_SNAPSHOT_UNAVAILABLE"]);
    }

    const previousMs = Date.parse(previous.observedAt!);
    const currentMs = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs) || currentMs <= previousMs) {
      return result(snapshot, null, null, ["NON_FORWARD_EXACT_SNAPSHOT_CHRONOLOGY"]);
    }

    const publisher = bindH1LiveExactSnapshotsToPublisher({
      previous,
      current: snapshot,
      ...input.publisher,
      nowIso: input.snapshot.nowIso,
    });

    // A valid forward exact observation becomes the next baseline even when
    // policy evidence blocks this publication attempt.
    this.latestByContract.set(key, snapshot);

    if (!publisher.ready || !publisher.producer?.packet) {
      return result(snapshot, publisher, null, publisher.blockers.map((x) => `PUBLISHER_${x}`));
    }

    const publication = publishH1LiveGateEvidence(publisher.producer.packet);
    if (!publication.accepted) {
      return result(snapshot, publisher, publication, [`REGISTRY_${publication.reason}`]);
    }

    return result(snapshot, publisher, publication, []);
  }

  clear(): void {
    this.latestByContract.clear();
  }

  getTrackedContractCount(): number {
    return this.latestByContract.size;
  }
}
