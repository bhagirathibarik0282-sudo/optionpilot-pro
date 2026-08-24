import type { ResearchIndexApiSnapshot } from "./research-intelligence-api.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";

export interface ResearchDashboardIndexRow {
  indexCode: string;
  indexName: string | null;
  tradeDate: string | null;
  close: number | null;
  freshness: string | null;
  validation: string | null;
  dataQuality: string;
  return1d: number | null;
  return5d: number | null;
  return20d: number | null;
  return60d: number | null;
  return120d: number | null;
  return252d: number | null;
  rsVsNifty50_5d: number | null;
  rsVsNifty50_20d: number | null;
  rsVsNifty50_60d: number | null;
}

export interface ResearchDashboardModel {
  mode: "RESEARCH_MODE";
  title: "BROAD MARKET / SIZE RESEARCH LAB";
  generatedAt: string;
  productionImpact: "NONE";
  overallDataQuality: string;
  regime: ResearchIndexApiSnapshot["regime"];
  warnings: string[];
  rows: ResearchDashboardIndexRow[];
  raw: ResearchIndexApiSnapshot;
}

export function buildResearchDashboardModel(snapshot: ResearchIndexApiSnapshot): ResearchDashboardModel {
  const rows: ResearchDashboardIndexRow[] = RESEARCH_INDEX_CODES.map((indexCode) => {
    const latest = snapshot.latest[indexCode];
    const metrics = snapshot.metrics[indexCode];
    return {
      indexCode,
      indexName: latest?.indexName ?? null,
      tradeDate: latest?.tradeDate ?? null,
      close: latest?.close ?? null,
      freshness: latest?.freshnessStatus ?? null,
      validation: latest?.validationStatus ?? null,
      dataQuality: snapshot.health.coverage[indexCode],
      return1d: metrics?.return1d ?? null,
      return5d: metrics?.return5d ?? null,
      return20d: metrics?.return20d ?? null,
      return60d: metrics?.return60d ?? null,
      return120d: metrics?.return120d ?? null,
      return252d: metrics?.return252d ?? null,
      rsVsNifty50_5d: metrics?.rsVsNifty50_5d ?? null,
      rsVsNifty50_20d: metrics?.rsVsNifty50_20d ?? null,
      rsVsNifty50_60d: metrics?.rsVsNifty50_60d ?? null,
    };
  });

  return {
    mode: "RESEARCH_MODE",
    title: "BROAD MARKET / SIZE RESEARCH LAB",
    generatedAt: snapshot.generatedAt,
    productionImpact: "NONE",
    overallDataQuality: snapshot.health.overall,
    regime: snapshot.regime,
    warnings: [
      ...snapshot.health.warnings,
      ...snapshot.health.missing.map((x) => `${x}:MISSING`),
      ...snapshot.health.stale.map((x) => `${x}:STALE`),
      ...snapshot.health.invalid.map((x) => `${x}:INVALID`),
    ],
    rows,
    // Strict UI rule: dashboard retains the complete source snapshot.
    // Frontend may format/expand it, but backend must not hide research evidence.
    raw: snapshot,
  };
}
