import type { CanonicalMarketDnaHistoricalFusion } from "./canonical-market-dna-historical-fusion.ts";

export const CANONICAL_INTELLIGENCE_DASHBOARD_V1 = "CANONICAL_INTELLIGENCE_DASHBOARD_V1" as const;

export interface CanonicalIntelligenceDashboardModel {
  version: typeof CANONICAL_INTELLIGENCE_DASHBOARD_V1;
  ready: boolean;
  source: "MARKET_DNA_CONTEXT";
  regime: string | null;
  rotationState: string | null;
  divergenceState: string | null;
  participationBreadthPct: number | null;
  largeCapConcentrationSpreadPct: number | null;
  sizeRotationSpreadPct: number | null;
  weightedConstituentBreadthReady: boolean;
  weightedConstituentBreadthPct: number | null;
  latestHistoricalTradeDate: string | null;
  historicalObservationFloor: number;
  historicalWindowReady: CanonicalMarketDnaHistoricalFusion["historicalWindowReady"];
  exactSevenCoverage: boolean;
  archiveBeyond320Ready: boolean;
  tenYearWindowReady: boolean;
  contextOnly: true;
  readOnly: true;
  duplicateVoteForbidden: true;
  grantsDirectionalSupport: false;
  affectsVerdictDirectly: false;
  affectsCandidateDirectly: false;
  affectsTelegramDirectly: false;
  affectsExecution: false;
  blockers: string[];
  raw: CanonicalMarketDnaHistoricalFusion;
}

export function buildCanonicalIntelligenceDashboardModel(
  fusion: CanonicalMarketDnaHistoricalFusion,
): CanonicalIntelligenceDashboardModel {
  const blockers = [...fusion.blockers];
  if (!fusion.ready || !fusion.live || !fusion.historical) blockers.push("CANONICAL_MARKET_DNA_CONTEXT_NOT_READY");
  if (fusion.grantsDirectionalSupport || fusion.affectsVerdictDirectly || fusion.affectsCandidateDirectly || fusion.affectsTelegramDirectly || fusion.affectsExecution) {
    blockers.push("CANONICAL_MARKET_DNA_AUTHORITY_TAMPERED");
  }
  const ready = blockers.length === 0 && fusion.ready && !!fusion.live && !!fusion.historical;
  return {
    version: CANONICAL_INTELLIGENCE_DASHBOARD_V1,
    ready,
    source: "MARKET_DNA_CONTEXT",
    regime: ready ? fusion.live!.regime : null,
    rotationState: ready ? fusion.live!.rotationState : null,
    divergenceState: ready ? fusion.live!.divergenceState : null,
    participationBreadthPct: ready ? fusion.live!.participationBreadthPct : null,
    largeCapConcentrationSpreadPct: ready ? fusion.live!.largeCapConcentrationSpreadPct : null,
    sizeRotationSpreadPct: ready ? fusion.live!.sizeRotationSpreadPct : null,
    weightedConstituentBreadthReady: ready ? fusion.live!.weightedConstituentBreadthReady : false,
    weightedConstituentBreadthPct: ready ? fusion.live!.weightedConstituentBreadthPct : null,
    latestHistoricalTradeDate: ready ? fusion.latestHistoricalTradeDate : null,
    historicalObservationFloor: ready ? fusion.historicalObservationFloor : 0,
    historicalWindowReady: ready
      ? fusion.historicalWindowReady
      : { d20: false, d60: false, d120: false, d252: false, d756: false, d1260: false, d2520: false },
    exactSevenCoverage: ready ? fusion.historical!.exactSevenCoverage : false,
    archiveBeyond320Ready: ready ? fusion.historical!.archiveBeyond320Ready : false,
    tenYearWindowReady: ready ? fusion.historical!.tenYearWindowReady : false,
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    blockers: [...new Set(blockers)],
    raw: fusion,
  };
}
