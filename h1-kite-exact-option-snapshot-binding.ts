import { aggregateH1LiveExactSnapshot, type H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import { mapKiteFullPacketToH1ExactDepth } from "./h1-kite-exact-depth-adapter.js";
import {
  mapKiteFullPacketToH1ExactPriceGreek,
  type H1ExactUnderlyingObservation,
  type H1KiteGreekModelPolicy,
} from "./h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export interface H1KiteExactOptionSnapshotBindingInput {
  packet: KiteDecodedPacket;
  registry: KiteImmediateTokenRegistry;
  underlying: H1ExactUnderlyingObservation;
  receivedAt: string;
  nowIso: string;
  orderQuantity: number;
  greekPolicy: H1KiteGreekModelPolicy;
  maxSnapshotAgeMs?: number;
  maxCrossSourceSkewMs?: number;
}

/**
 * Creates one same-contract exact H1 bundle from raw Kite evidence. Each child
 * adapter and the aggregator independently fail closed; no missing value is
 * inferred or replaced.
 */
export function bindKiteOptionPacketToH1ExactSnapshot(
  input: H1KiteExactOptionSnapshotBindingInput,
): H1ExactSnapshotBundle {
  const priceGreek = mapKiteFullPacketToH1ExactPriceGreek(
    input.packet,
    input.registry,
    input.underlying,
    input.receivedAt,
    input.greekPolicy,
  );
  const depth = mapKiteFullPacketToH1ExactDepth(
    input.packet,
    input.registry,
    input.receivedAt,
    input.orderQuantity,
  );
  return aggregateH1LiveExactSnapshot(
    priceGreek,
    depth,
    input.nowIso,
    input.maxSnapshotAgeMs ?? 5_000,
    input.maxCrossSourceSkewMs ?? 2_000,
  );
}
