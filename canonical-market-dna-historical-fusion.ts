import type { MarketDnaContext } from "./canonical-market-dna-context.ts";
import {
  CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1,
  type MarketDnaHistoricalMemory,
} from "./canonical-market-dna-historical-memory.ts";

export const CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1 = "CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1" as const;

export interface CanonicalMarketDnaHistoricalFusion {
  version: typeof CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1;
  ready: boolean;
  live: MarketDnaContext | null;
  historical: MarketDnaHistoricalMemory | null;
  latestHistoricalTradeDate: string | null;
  historicalObservationFloor: number;
  historicalWindowReady: {
    d20: boolean;
    d60: boolean;
    d120: boolean;
    d252: boolean;
    d756: boolean;
    d1260: boolean;
    d2520: boolean;
  };
  contextOnly: true;
  readOnly: true;
  duplicateVoteForbidden: true;
  grantsDirectionalSupport: false;
  affectsVerdictDirectly: false;
  affectsCandidateDirectly: false;
  affectsTelegramDirectly: false;
  affectsExecution: false;
  repairsMissingEvidence: false;
  failClosed: true;
  blockers: string[];
}

function empty(blockers: string[]): CanonicalMarketDnaHistoricalFusion {
  return {
    version: CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1,
    ready: false,
    live: null,
    historical: null,
    latestHistoricalTradeDate: null,
    historicalObservationFloor: 0,
    historicalWindowReady: { d20: false, d60: false, d120: false, d252: false, d756: false, d1260: false, d2520: false },
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    repairsMissingEvidence: false,
    failClosed: true,
    blockers: [...new Set(blockers)],
  };
}

export function fuseMarketDnaWithHistoricalMemory(
  live: MarketDnaContext,
  historical: MarketDnaHistoricalMemory,
): CanonicalMarketDnaHistoricalFusion {
  const blockers: string[] = [];
  if (!live.ready || live.blockers.length) blockers.push("MARKET_DNA_LIVE_NOT_READY");
  if (live.grantsDirectionalSupport || live.affectsVerdictDirectly || live.affectsCandidateDirectly || live.affectsTelegramDirectly || live.affectsExecution || live.repairsMissingEvidence) {
    blockers.push("MARKET_DNA_LIVE_AUTHORITY_TAMPERED");
  }
  if (historical.version !== CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1 || !historical.ready || historical.blockers.length) {
    blockers.push("MARKET_DNA_HISTORICAL_NOT_READY");
  }
  if (!historical.contextOnly || !historical.readOnly || !historical.duplicateVoteForbidden || historical.affectsDirection || historical.affectsVerdict || historical.affectsCandidate || historical.affectsTelegram || historical.affectsExecution || historical.mutatesData) {
    blockers.push("MARKET_DNA_HISTORICAL_AUTHORITY_TAMPERED");
  }
  if (!historical.exactSevenCoverage || !historical.alignedLatestDate || !historical.archiveBeyond320Ready) blockers.push("MARKET_DNA_HISTORICAL_COVERAGE_NOT_READY");
  if (blockers.length) return empty(blockers);

  const floor = historical.minimumObservations;
  return {
    version: CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1,
    ready: true,
    live,
    historical,
    latestHistoricalTradeDate: historical.latestTradeDate,
    historicalObservationFloor: floor,
    historicalWindowReady: {
      d20: floor > 20,
      d60: floor > 60,
      d120: floor > 120,
      d252: floor > 252,
      d756: floor > 756,
      d1260: floor > 1260,
      d2520: historical.tenYearWindowReady,
    },
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    repairsMissingEvidence: false,
    failClosed: true,
    blockers: [],
  };
}
