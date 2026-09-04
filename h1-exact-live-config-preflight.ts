import { buildH1CanonicalRegistryFromKiteMaster } from "./h1-kite-master-canonical-registry-bridge.js";
import type { KiteInstrumentMasterRow } from "./kite-immediate-registry-builder.js";
import type { RecorderSymbol, OptionSide } from "./option-recorder-shadow.js";
import { readH1ExactShadowLiveConfig, type H1ExactShadowPolicy } from "./h1-exact-shadow-live-service.js";

export interface H1ExactLiveContractSelection {
  symbol: RecorderSymbol;
  expiry: string;
  strike: number;
  side: OptionSide;
  moneyness: "ATM" | "ITM1";
  orderQuantity: number;
}

export interface H1ExactLiveConfigPreflightRequest {
  selections: H1ExactLiveContractSelection[];
  policy: Omit<H1ExactShadowPolicy, "contracts">;
}

export interface H1ExactLiveConfigPreflightResult {
  version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_V1";
  ready: boolean;
  registryJson: string | null;
  policyJson: string | null;
  contractCount: number;
  registryTokenCount: number;
  blockers: string[];
  inferredTokens: false;
  source: "KITE_INSTRUMENT_MASTER_EXACT";
  productionImpact: "NONE";
  writesRailwayVariables: false;
  activatesShadow: false;
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

function fail(blockers: string[]): H1ExactLiveConfigPreflightResult {
  return {
    version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_V1",
    ready: false,
    registryJson: null,
    policyJson: null,
    contractCount: 0,
    registryTokenCount: 0,
    blockers: [...new Set(blockers)],
    inferredTokens: false,
    source: "KITE_INSTRUMENT_MASTER_EXACT",
    productionImpact: "NONE",
    writesRailwayVariables: false,
    activatesShadow: false,
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}

export function buildH1ExactLiveConfigPreflight(
  rows: KiteInstrumentMasterRow[],
  request: H1ExactLiveConfigPreflightRequest,
): H1ExactLiveConfigPreflightResult {
  if (!Array.isArray(rows) || rows.length === 0) return fail(["KITE_INSTRUMENT_MASTER_REQUIRED"]);
  if (!Array.isArray(request?.selections) || request.selections.length === 0) return fail(["EXPLICIT_CONTRACT_SELECTIONS_REQUIRED"]);

  const seen = new Set<string>();
  for (const s of request.selections) {
    const key = `${s.symbol}|${s.expiry}|${s.strike}|${s.side}`;
    if (seen.has(key)) return fail([`DUPLICATE_CONTRACT_SELECTION:${key}`]);
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.expiry) || !Number.isFinite(s.strike) || s.strike <= 0 ||
        (s.side !== "CE" && s.side !== "PE") || (s.moneyness !== "ATM" && s.moneyness !== "ITM1") ||
        !Number.isInteger(s.orderQuantity) || s.orderQuantity <= 0) {
      return fail([`INVALID_CONTRACT_SELECTION:${key}`]);
    }
  }

  const symbols = [...new Set(request.selections.map((s) => s.symbol))];
  const expiriesBySymbol: Partial<Record<RecorderSymbol, string[]>> = {};
  const strikesBySymbol: Partial<Record<RecorderSymbol, number[]>> = {};
  for (const symbol of symbols) {
    expiriesBySymbol[symbol] = [...new Set(request.selections.filter((s) => s.symbol === symbol).map((s) => s.expiry))];
    strikesBySymbol[symbol] = [...new Set(request.selections.filter((s) => s.symbol === symbol).map((s) => s.strike))];
  }

  const canonical = buildH1CanonicalRegistryFromKiteMaster(rows, {
    symbols,
    expiriesBySymbol,
    strikesBySymbol,
  });
  if (!canonical.ready) return fail(canonical.blockers);

  const optionByIdentity = new Map(
    canonical.entries
      .filter((e) => e.role === "OPTION")
      .map((e) => [`${e.symbol}|${e.expiry}|${e.strike}|${e.optionSide}`, e] as const),
  );

  const contracts = request.selections.map((s) => {
    const key = `${s.symbol}|${s.expiry}|${s.strike}|${s.side}`;
    const entry = optionByIdentity.get(key);
    if (!entry) throw new Error(`EXACT_SELECTED_CONTRACT_NOT_IN_CANONICAL_REGISTRY:${key}`);
    return { instrumentToken: entry.instrumentToken, moneyness: s.moneyness, orderQuantity: s.orderQuantity };
  });

  const policy: H1ExactShadowPolicy = { ...request.policy, contracts };
  const registryJson = JSON.stringify(canonical.entries);
  const policyJson = JSON.stringify(policy);

  try {
    readH1ExactShadowLiveConfig({
      KITE_H1_EXACT_SHADOW_ENABLED: "true",
      KITE_RUNTIME_SHADOW_ENABLED: "false",
      KITE_API_KEY: "PREFLIGHT_ONLY",
      KITE_SHADOW_REGISTRY_JSON: registryJson,
      KITE_H1_EXACT_POLICY_JSON: policyJson,
    });
  } catch (error) {
    return fail([error instanceof Error ? error.message : "EXACT_SHADOW_CONFIG_VALIDATION_FAILED"]);
  }

  return {
    version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_V1",
    ready: true,
    registryJson,
    policyJson,
    contractCount: contracts.length,
    registryTokenCount: canonical.entries.length,
    blockers: [],
    inferredTokens: false,
    source: "KITE_INSTRUMENT_MASTER_EXACT",
    productionImpact: "NONE",
    writesRailwayVariables: false,
    activatesShadow: false,
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}
