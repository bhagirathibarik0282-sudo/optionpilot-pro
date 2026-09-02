import { OptionBuyingRuntimeRiskRegistry } from "./option-buying-runtime-risk-registry.js";

// Process-wide fail-closed live risk-state source for option-buying runtime checks.
// Producers must explicitly refresh each symbol; stale/missing state is rejected by the registry.
export const OPTION_BUYING_RUNTIME_RISK_REGISTRY = new OptionBuyingRuntimeRiskRegistry(60_000);
