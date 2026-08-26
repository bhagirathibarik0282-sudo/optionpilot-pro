import { sourceTruthShadowEnabled } from "./source-truth-db.js";
import { minuteBucketUtcIso } from "./storage-v3-writer.js";
import {
  buildPhase46ChainMetricTruth,
  persistChainMetricTruth,
  type Phase46UniverseMetadata,
} from "./chain-metric-truth.js";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type RuntimeMetadata = Phase46UniverseMetadata & {
  expiry?: string | null;
  atmCeLtp?: number | null;
  atmPeLtp?: number | null;
};

/**
 * Shadow-only companion persistence from values already fetched by the live
 * snapshot. It performs no broker request and does not mutate the snapshot.
 */
export async function persistPhase46ChainTruthFromExistingSnapshot(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
  market: Record<string, any> | null | undefined,
): Promise<number> {
  if (!sourceTruthShadowEnabled() || !market) return 0;
  const metadata = market.phase46ChainTruth as RuntimeMetadata | null | undefined;
  if (!metadata?.expiry || !metadata.quoteReceivedAt) return 0;

  const timestamp = typeof market.timestamp === "string" && Number.isFinite(new Date(market.timestamp).getTime())
    ? market.timestamp : metadata.quoteReceivedAt;
  const atmCe = finite(metadata.atmCeLtp);
  const atmPe = finite(metadata.atmPeLtp);
  const atmStraddle = atmCe !== null && atmPe !== null ? atmCe + atmPe : null;

  const rows = buildPhase46ChainMetricTruth({
    symbol,
    minuteBucket: minuteBucketUtcIso(timestamp),
    expiry: metadata.expiry,
    metadata,
    atmStraddle,
    band7OiPcr: finite(market.pcr),
    band7VolumePcr: finite(market.volumePcr),
    fullChainOiPcr: finite(market.gapScore?.fullChainPcr),
    maxPain: finite(market.maxPain),
  });
  return persistChainMetricTruth(rows);
}

export const PHASE46_RUNTIME_PERSISTENCE_SAFETY = Object.freeze({
  brokerRequestAdded: false,
  snapshotMutation: false,
  shadowOnly: true,
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
});
