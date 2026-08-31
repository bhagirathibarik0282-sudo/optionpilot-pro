export type KiteImmediateRuntimeBlocker =
  | "KITE_API_KEY_MISSING"
  | "KITE_SESSION_INACTIVE"
  | "KITE_ACCESS_TOKEN_MISSING"
  | "WEBSOCKET_RUNTIME_UNAVAILABLE"
  | "INSTRUMENT_REGISTRY_EMPTY"
  | "REQUIRED_SYMBOL_COVERAGE_MISSING"
  | "TOKEN_LIMIT_EXCEEDED";

export type KiteImmediateRuntimeBlockerAuditInput = {
  apiKeyPresent: boolean;
  sessionActive: boolean;
  accessTokenPresent: boolean;
  websocketRuntimeAvailable: boolean;
  registryTokenCount: number;
  coveredSymbols: string[];
  requiredSymbols?: string[];
};

export type KiteImmediateRuntimeBlockerAuditResult = {
  version: "KITE_IMMEDIATE_RUNTIME_BLOCKER_AUDIT_V1";
  blockers: KiteImmediateRuntimeBlocker[];
  safeToStartWebSocket: boolean;
  productionImpact: "NONE";
};

export function auditKiteImmediateRuntimeBlockers(
  input: KiteImmediateRuntimeBlockerAuditInput,
): KiteImmediateRuntimeBlockerAuditResult {
  const blockers: KiteImmediateRuntimeBlocker[] = [];
  const required = input.requiredSymbols ?? ["NIFTY", "BANKNIFTY", "SENSEX"];
  const covered = new Set((input.coveredSymbols || []).map((x) => x.trim().toUpperCase()).filter(Boolean));

  if (!input.apiKeyPresent) blockers.push("KITE_API_KEY_MISSING");
  if (!input.sessionActive) blockers.push("KITE_SESSION_INACTIVE");
  if (!input.accessTokenPresent) blockers.push("KITE_ACCESS_TOKEN_MISSING");
  if (!input.websocketRuntimeAvailable) blockers.push("WEBSOCKET_RUNTIME_UNAVAILABLE");
  if (!Number.isInteger(input.registryTokenCount) || input.registryTokenCount <= 0) blockers.push("INSTRUMENT_REGISTRY_EMPTY");
  if (input.registryTokenCount > 3000) blockers.push("TOKEN_LIMIT_EXCEEDED");
  if (required.some((symbol) => !covered.has(symbol))) blockers.push("REQUIRED_SYMBOL_COVERAGE_MISSING");

  return {
    version: "KITE_IMMEDIATE_RUNTIME_BLOCKER_AUDIT_V1",
    blockers,
    safeToStartWebSocket: blockers.length === 0,
    productionImpact: "NONE",
  };
}
