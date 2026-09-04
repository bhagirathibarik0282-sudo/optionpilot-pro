export const H1_MARKET_OPEN_ACCEPTANCE_CAPTURE_VERSION = "H1_MARKET_OPEN_ACCEPTANCE_CAPTURE_V1" as const;

export interface H1MarketOpenAcceptanceCaptureInput {
  asOfDate: string | null;
  connected: boolean;
  socketState: string;
  rawEvidenceExpectedTokenCount: number;
  rawEvidenceFreshTokenCount: number;
  rawEvidenceMissingTokenCount: number;
  rawEvidenceStaleTokenCount: number;
  readOnlyConsumerReadySymbolCount: number;
  readOnlyDirectionReadySymbolCount: number;
  readOnlyShadowInputReadySymbolCount: number;
  marketWindowContext: {
    regularMarketWindowState: string;
    holidayCalendarVerified: false;
    claimsMarketOpen: false;
  };
  marketOpenReadinessAcceptance: {
    state: string;
    blockers: string[];
    claimsMarketOpen: false;
    holidayCalendarVerified: false;
    productionImpact: "NONE";
    forwardsDownstream: false;
    affectsVerdict: false;
    affectsExecution: false;
    affectsTelegram: false;
    failClosed: true;
  };
}

export interface H1MarketOpenAcceptanceCapture {
  version: typeof H1_MARKET_OPEN_ACCEPTANCE_CAPTURE_VERSION;
  observedAt: string;
  asOfDate: string | null;
  marketWindowState: string;
  connected: boolean;
  socketState: string;
  evidence: {
    expectedTokenCount: number;
    freshTokenCount: number;
    missingTokenCount: number;
    staleTokenCount: number;
  };
  readiness: {
    consumerReadySymbolCount: number;
    directionReadySymbolCount: number;
    shadowInputReadySymbolCount: number;
  };
  acceptance: {
    state: string;
    blockers: string[];
  };
  claimsMarketOpen: false;
  holidayCalendarVerified: false;
  productionImpact: "NONE";
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

export function buildH1MarketOpenAcceptanceCapture(
  status: H1MarketOpenAcceptanceCaptureInput,
  now = new Date(),
): H1MarketOpenAcceptanceCapture {
  return {
    version: H1_MARKET_OPEN_ACCEPTANCE_CAPTURE_VERSION,
    observedAt: now.toISOString(),
    asOfDate: status.asOfDate,
    marketWindowState: status.marketWindowContext.regularMarketWindowState,
    connected: status.connected,
    socketState: status.socketState,
    evidence: {
      expectedTokenCount: status.rawEvidenceExpectedTokenCount,
      freshTokenCount: status.rawEvidenceFreshTokenCount,
      missingTokenCount: status.rawEvidenceMissingTokenCount,
      staleTokenCount: status.rawEvidenceStaleTokenCount,
    },
    readiness: {
      consumerReadySymbolCount: status.readOnlyConsumerReadySymbolCount,
      directionReadySymbolCount: status.readOnlyDirectionReadySymbolCount,
      shadowInputReadySymbolCount: status.readOnlyShadowInputReadySymbolCount,
    },
    acceptance: {
      state: status.marketOpenReadinessAcceptance.state,
      blockers: [...status.marketOpenReadinessAcceptance.blockers],
    },
    claimsMarketOpen: false,
    holidayCalendarVerified: false,
    productionImpact: "NONE",
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}
