import type { ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";

export type ImmediateClusterStage = "RAW" | "PERSISTING" | "SYNCHRONIZED";

export type ImmediateClusterClockConfig = {
  windowMs: number;
  minSupportingFamilies: number;
  minEvents: number;
};

export type ImmediateClusterTimedEvent = ImmediateVerifiedEvent & { relativeMs: number };

export type ImmediateClusterClockResult = {
  version: "IMMEDIATE_EXPANSION_CLUSTER_CLOCK_V1";
  stage: ImmediateClusterStage;
  t0: string | null;
  latestAt: string | null;
  events: ImmediateClusterTimedEvent[];
  supportingFamilies: string[];
  conflictingFamilies: string[];
  volatilityOnlyFamilies: string[];
  conflictPresent: boolean;
  clusterReady: boolean;
  productionImpact: "NONE";
};

function validConfig(config: ImmediateClusterClockConfig): boolean {
  return Number.isFinite(config.windowMs) && config.windowMs > 0
    && Number.isInteger(config.minSupportingFamilies) && config.minSupportingFamilies >= 1
    && Number.isInteger(config.minEvents) && config.minEvents >= 1;
}

function validEvent(event: ImmediateVerifiedEvent): boolean {
  return !!event?.id && !!event.fact?.trim() && Number.isFinite(Date.parse(event.occurredAt));
}

export class ImmediateExpansionClusterClock {
  private readonly eventsBySymbol = new Map<string, ImmediateVerifiedEvent[]>();

  constructor(private readonly config: ImmediateClusterClockConfig) {
    if (!validConfig(config)) throw new Error("INVALID_IMMEDIATE_CLUSTER_CONFIG");
  }

  observe(symbolRaw: string, event: ImmediateVerifiedEvent): ImmediateClusterClockResult {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol || !validEvent(event)) throw new Error("INVALID_IMMEDIATE_CLUSTER_EVENT");

    const current = this.eventsBySymbol.get(symbol) ?? [];
    if (event.abnormalImmediateChange && event.fresh) current.push(event);
    current.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

    const latestMs = current.length ? Date.parse(current[current.length - 1].occurredAt) : Date.parse(event.occurredAt);
    const retained = current.filter((x) => latestMs - Date.parse(x.occurredAt) <= this.config.windowMs);
    this.eventsBySymbol.set(symbol, retained);

    if (!retained.length) return this.empty();

    const t0Ms = Date.parse(retained[0].occurredAt);
    const supporting = retained.filter((x) => x.alignment === "FAVOURS_TREND");
    const conflicting = retained.filter((x) => x.alignment === "CONFLICTS_TREND");
    const volatilityOnly = retained.filter((x) => x.alignment === "VOLATILITY_ONLY");
    const supportingFamilies = [...new Set(supporting.map((x) => x.family))];
    const conflictingFamilies = [...new Set(conflicting.map((x) => x.family))];
    const volatilityOnlyFamilies = [...new Set(volatilityOnly.map((x) => x.family))];
    const conflictPresent = conflicting.length > 0;
    const clusterReady = !conflictPresent
      && retained.length >= this.config.minEvents
      && supportingFamilies.length >= this.config.minSupportingFamilies;

    let stage: ImmediateClusterStage = "RAW";
    if (clusterReady) stage = "SYNCHRONIZED";
    else if (retained.length > 1) stage = "PERSISTING";

    return {
      version: "IMMEDIATE_EXPANSION_CLUSTER_CLOCK_V1",
      stage,
      t0: retained[0].occurredAt,
      latestAt: retained[retained.length - 1].occurredAt,
      events: retained.map((x) => ({ ...x, relativeMs: Date.parse(x.occurredAt) - t0Ms })),
      supportingFamilies,
      conflictingFamilies,
      volatilityOnlyFamilies,
      conflictPresent,
      clusterReady,
      productionImpact: "NONE",
    };
  }

  snapshot(symbolRaw: string): ImmediateClusterClockResult {
    const symbol = symbolRaw.trim().toUpperCase();
    const rows = this.eventsBySymbol.get(symbol) ?? [];
    if (!rows.length) return this.empty();
    return this.observe(symbol, { ...rows[rows.length - 1], abnormalImmediateChange: false, fresh: false });
  }

  private empty(): ImmediateClusterClockResult {
    return {
      version: "IMMEDIATE_EXPANSION_CLUSTER_CLOCK_V1",
      stage: "RAW",
      t0: null,
      latestAt: null,
      events: [],
      supportingFamilies: [],
      conflictingFamilies: [],
      volatilityOnlyFamilies: [],
      conflictPresent: false,
      clusterReady: false,
      productionImpact: "NONE",
    };
  }
}
