import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketComponent, type CanonicalOneRoofMarketSnapshotInput } from "./canonical-one-roof-market-snapshot.js";
import { buildCanonicalConstituentLiveComponent, type CanonicalConstituentTick } from "./canonical-constituent-live-component.js";
import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.js";

export interface CanonicalShadowSnapshotAssemblerInput extends Omit<CanonicalOneRoofMarketSnapshotInput, "components"> {
  baseComponents: CanonicalMarketComponent[];
  constituentRegistry: CanonicalConstituentTokenEntry[];
  constituentTicks: CanonicalConstituentTick[];
  constituentFreshnessMs: number;
}

/**
 * Shadow-only assembler. It does not calculate direction or choose candidates.
 * It injects only the two constituent-backed canonical families and delegates all
 * strict readiness/freshness/backpressure decisions to the canonical V2 envelope.
 */
export function buildCanonicalShadowSnapshot(input: CanonicalShadowSnapshotAssemblerInput) {
  const base = input.baseComponents.filter((component) => component.family !== "HEAVYWEIGHTS" && component.family !== "SECTOR_BREADTH");
  const heavyweightComponent = buildCanonicalConstituentLiveComponent({
    parentSymbol: input.symbol,
    role: "HEAVYWEIGHT",
    asOfMs: input.asOfMs,
    registry: input.constituentRegistry,
    ticks: input.constituentTicks,
    maxTickAgeMs: input.constituentFreshnessMs,
  });
  const sectorBreadthComponent = buildCanonicalConstituentLiveComponent({
    parentSymbol: input.symbol,
    role: "SECTOR_CONSTITUENT",
    asOfMs: input.asOfMs,
    registry: input.constituentRegistry,
    ticks: input.constituentTicks,
    maxTickAgeMs: input.constituentFreshnessMs,
  });

  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    asOfMs: input.asOfMs,
    minuteClosed: input.minuteClosed,
    connectionId: input.connectionId,
    instrumentMasterVersion: input.instrumentMasterVersion,
    components: [...base, heavyweightComponent, sectorBreadthComponent],
    freshnessBudgetsMs: input.freshnessBudgetsMs,
    ingestTelemetry: input.ingestTelemetry,
  });
}
