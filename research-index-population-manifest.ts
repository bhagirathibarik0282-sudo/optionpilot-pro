import type { ResearchIndexCode } from "./research-index-types.js";

export const RESEARCH_INDEX_POPULATION_FILES: Record<ResearchIndexCode, string> = {
  NIFTY50: "NIFTY50.csv",
  NIFTY100: "NIFTY100.csv",
  NIFTY200: "NIFTY200.csv",
  NIFTY500: "NIFTY500.csv",
  NEXT50: "NEXT50.csv",
  MIDCAP150: "MIDCAP150.csv",
  SMALLCAP250: "SMALLCAP250.csv",
};

export const RESEARCH_INDEX_POPULATION_ORDER: ResearchIndexCode[] = [
  "NIFTY50",
  "NIFTY100",
  "NIFTY200",
  "NIFTY500",
  "NEXT50",
  "MIDCAP150",
  "SMALLCAP250",
];

export const researchIndexPopulationPolicy = {
  mode: "RESEARCH_MODE",
  productionImpact: "NONE",
  minimumObservationsForFullReadiness: 253,
  expectedFiles: RESEARCH_INDEX_POPULATION_FILES,
  sourceRequirement: "Official NSE Indices Historical Index Data CSV export",
  flow: [
    "READ_7_CSV_FILES",
    "PARSE_VALIDATE",
    "UPSERT_RAW_DAILY",
    "REBUILD_RETURNS_AND_RS",
    "RUN_READINESS_AUDIT",
  ],
} as const;
