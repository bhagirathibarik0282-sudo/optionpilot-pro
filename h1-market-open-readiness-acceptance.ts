import type { H1RegularMarketWindowContext } from "./h1-regular-market-window-context.js";

export const H1_MARKET_OPEN_READINESS_ACCEPTANCE_VERSION = "H1_MARKET_OPEN_READINESS_ACCEPTANCE_V1" as const;

export type H1MarketOpenReadinessAcceptanceState = "PASS" | "BLOCKED" | "OUTSIDE_REGULAR_WINDOW";

export interface H1MarketOpenReadinessAcceptanceInput {
  marketWindowContext: H1RegularMarketWindowContext;
  connected: boolean;
  socketState: "READY" | "CONNECTING" | "RECONNECTING" | "OPEN" | "CLOSED" | "ERROR" | "UNAVAILABLE";
  readOnlyConsumerReadySymbolCount: number;
  readOnlyDirectionReadySymbolCount: number;
  readOnlyShadowInputReadySymbolCount: number;
}

export interface H1MarketOpenReadinessAcceptance {
  version: typeof H1_MARKET_OPEN_READINESS_ACCEPTANCE_VERSION;
  state: H1MarketOpenReadinessAcceptanceState;
  blockers: string[];
  readySymbolCount: number;
  directionReadySymbolCount: number;
  shadowInputReadySymbolCount: number;
  claimsMarketOpen: false;
  holidayCalendarVerified: false;
  productionImpact: "NONE";
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

export function evaluateH1MarketOpenReadinessAcceptance(
  status: H1MarketOpenReadinessAcceptanceInput,
): H1MarketOpenReadinessAcceptance {
  const blockers: string[] = [];
  const within = status.marketWindowContext.regularMarketWindowState === "WITHIN_REGULAR_MARKET_WINDOW";

  if (!within) {
    return {
      version: H1_MARKET_OPEN_READINESS_ACCEPTANCE_VERSION,
      state: "OUTSIDE_REGULAR_WINDOW",
      blockers: ["OUTSIDE_REGULAR_MARKET_WINDOW"],
      readySymbolCount: status.readOnlyConsumerReadySymbolCount,
      directionReadySymbolCount: status.readOnlyDirectionReadySymbolCount,
      shadowInputReadySymbolCount: status.readOnlyShadowInputReadySymbolCount,
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

  if (!status.connected || status.socketState !== "OPEN") blockers.push("LIVE_SOCKET_NOT_OPEN");
  if (status.readOnlyConsumerReadySymbolCount < 1) blockers.push("NO_CONSUMER_READY_SYMBOL");
  if (status.readOnlyDirectionReadySymbolCount < 1) blockers.push("NO_DIRECTION_READY_SYMBOL");
  if (status.readOnlyShadowInputReadySymbolCount < 1) blockers.push("NO_SHADOW_INPUT_READY_SYMBOL");

  return {
    version: H1_MARKET_OPEN_READINESS_ACCEPTANCE_VERSION,
    state: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers,
    readySymbolCount: status.readOnlyConsumerReadySymbolCount,
    directionReadySymbolCount: status.readOnlyDirectionReadySymbolCount,
    shadowInputReadySymbolCount: status.readOnlyShadowInputReadySymbolCount,
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
