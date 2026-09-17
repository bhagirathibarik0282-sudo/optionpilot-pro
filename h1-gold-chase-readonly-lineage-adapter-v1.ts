import type { KiteH1ExactDualPathResult } from "./kite-h1-exact-dual-path-core.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import {
  H1GoldChaseExactLineagePublisher,
  type H1GoldChaseExactLineagePublisherInput,
  type H1GoldChaseExactLineagePublisherResult,
} from "./h1-gold-chase-exact-lineage-publisher-v1.js";
import { H1GoldChaseExactLineageResolver } from "./h1-gold-chase-exact-lineage-resolver-v1.js";
import type { H1GoldChaseExactServiceLineageResolver } from "./h1-gold-chase-exact-service-shadow-hook-v1.js";

export const H1_GOLD_CHASE_READONLY_LINEAGE_ADAPTER_V1 =
  "H1_GOLD_CHASE_READONLY_LINEAGE_ADAPTER_V1" as const;

export interface H1GoldChaseReadOnlyLineageRequest {
  packet: LiveGateEvidencePacket;
  dualPath: KiteH1ExactDualPathResult;
  observedAt: string;
}

export type H1GoldChaseApprovedProducer = (
  request: H1GoldChaseReadOnlyLineageRequest,
) => H1GoldChaseExactLineagePublisherInput | null | Promise<H1GoldChaseExactLineagePublisherInput | null>;

export interface H1GoldChaseReadOnlyLineageAdapterResult {
  version: typeof H1_GOLD_CHASE_READONLY_LINEAGE_ADAPTER_V1;
  state: "PUBLISHED" | "BLOCKED";
  ready: boolean;
  publication: H1GoldChaseExactLineagePublisherResult | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "READ_ONLY_APPROVED_PRODUCER_TO_SAME_PACKET_ONE_SHOT_LINEAGE_NO_INFERENCE";
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "READ_ONLY_APPROVED_PRODUCER_TO_SAME_PACKET_ONE_SHOT_LINEAGE_NO_INFERENCE" as const,
});

function result(
  state: "PUBLISHED" | "BLOCKED",
  publication: H1GoldChaseExactLineagePublisherResult | null,
  blockers: string[],
): H1GoldChaseReadOnlyLineageAdapterResult {
  return {
    version: H1_GOLD_CHASE_READONLY_LINEAGE_ADAPTER_V1,
    state,
    ready: state === "PUBLISHED",
    publication,
    blockers: [...new Set(blockers.filter(Boolean))],
    ...SAFETY,
  };
}

/**
 * Same-process read-only seam between approved producers and the exact hook.
 * The provider must return the original packet object; copied or reconstructed
 * packets are rejected. This adapter never builds, aliases or infers evidence.
 */
export class H1GoldChaseReadOnlyLineageAdapter {
  private readonly resolverStore: H1GoldChaseExactLineageResolver;
  private readonly publisher: Pick<H1GoldChaseExactLineagePublisher, "publish">;

  constructor(
    private readonly producer: H1GoldChaseApprovedProducer,
    resolver = new H1GoldChaseExactLineageResolver("h1-exact-shadow-live-service"),
    publisher?: Pick<H1GoldChaseExactLineagePublisher, "publish">,
  ) {
    this.resolverStore = resolver;
    this.publisher = publisher ?? new H1GoldChaseExactLineagePublisher(resolver);
  }

  resolver(): H1GoldChaseExactServiceLineageResolver {
    return this.resolverStore.resolver();
  }

  async publish(request: H1GoldChaseReadOnlyLineageRequest): Promise<H1GoldChaseReadOnlyLineageAdapterResult> {
    if (!request?.packet || !request?.dualPath || !request?.observedAt) {
      return result("BLOCKED", null, ["EXACT_LINEAGE_REQUEST_REQUIRED"]);
    }
    let input: H1GoldChaseExactLineagePublisherInput | null;
    try {
      input = await this.producer(request);
    } catch {
      return result("BLOCKED", null, ["APPROVED_LINEAGE_PRODUCER_EXCEPTION"]);
    }
    if (!input) return result("BLOCKED", null, ["APPROVED_LINEAGE_PRODUCER_NOT_READY"]);
    if (input.packet !== request.packet) {
      return result("BLOCKED", null, ["PRODUCER_PACKET_NOT_SAME_INGEST_OBJECT"]);
    }
    if (input.packet.identity?.observedAt !== request.packet.identity?.observedAt) {
      return result("BLOCKED", null, ["PRODUCER_PACKET_TIMESTAMP_MISMATCH"]);
    }
    let publication: H1GoldChaseExactLineagePublisherResult;
    try {
      publication = this.publisher.publish(input);
    } catch {
      return result("BLOCKED", null, ["LINEAGE_PUBLICATION_EXCEPTION"]);
    }
    return publication.ready
      ? result("PUBLISHED", publication, [])
      : result("BLOCKED", publication, publication.blockers);
  }
}
