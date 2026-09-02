import { resolveOptionBuyingRiskAuthority } from "./option-buying-risk-authority.js";

export interface OptionBuyingRuntimeRiskState {
  dynamicDailyLoss: number;
  realisedLossToday: number;
  openRisk: number;
  estimatedExistingCosts: number;
}

export interface OptionBuyingRuntimeRiskProvider {
  read(symbol: string): OptionBuyingRuntimeRiskState | null | Promise<OptionBuyingRuntimeRiskState | null>;
}

export interface OptionBuyingRuntimeRiskDecision {
  version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1";
  symbol: string | null;
  allowRiskEvaluation: boolean;
  maxLossForNewTrade: number;
  reasonCodes: string[];
  failClosed: true;
}

function normalizeSymbol(symbol: string): string | null {
  return typeof symbol === "string" && symbol.trim() ? symbol.trim().toUpperCase() : null;
}

export async function resolveRuntimeOptionBuyingRisk(
  symbolInput: string,
  provider: OptionBuyingRuntimeRiskProvider,
): Promise<OptionBuyingRuntimeRiskDecision> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return {
      version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1",
      symbol: null,
      allowRiskEvaluation: false,
      maxLossForNewTrade: 0,
      reasonCodes: ["INVALID_SYMBOL"],
      failClosed: true,
    };
  }

  let state: OptionBuyingRuntimeRiskState | null = null;
  try {
    state = await provider?.read(symbol);
  } catch {
    return {
      version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1",
      symbol,
      allowRiskEvaluation: false,
      maxLossForNewTrade: 0,
      reasonCodes: ["RISK_STATE_PROVIDER_ERROR"],
      failClosed: true,
    };
  }

  if (!state) {
    return {
      version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1",
      symbol,
      allowRiskEvaluation: false,
      maxLossForNewTrade: 0,
      reasonCodes: ["RISK_STATE_UNAVAILABLE"],
      failClosed: true,
    };
  }

  const authority = resolveOptionBuyingRiskAuthority(state);
  if (!authority.valid || authority.maxLossForNewTrade <= 0) {
    return {
      version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1",
      symbol,
      allowRiskEvaluation: false,
      maxLossForNewTrade: 0,
      reasonCodes: authority.reasonCodes,
      failClosed: true,
    };
  }

  return {
    version: "OPTION_BUYING_RUNTIME_RISK_BRIDGE_V1",
    symbol,
    allowRiskEvaluation: true,
    maxLossForNewTrade: authority.maxLossForNewTrade,
    reasonCodes: ["LIVE_DYNAMIC_RISK_AUTHORITY_READY"],
    failClosed: true,
  };
}
