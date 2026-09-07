import { validateH1ExactShadowPolicy, type H1ExactShadowPolicy } from "./h1-exact-shadow-live-service.js";
import { resolveH1SelectorProductionPolicy, type H1SelectorProductionPolicyResult } from "./h1-selector-production-policy.js";

export interface H1SelectorCanonicalPolicySourceResult {
  version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1";
  ready: boolean;
  exactPolicy: H1ExactShadowPolicy | null;
  selectorPolicy: H1SelectorProductionPolicyResult;
  blockers: string[];
  source: "KITE_H1_EXACT_POLICY_JSON_VALIDATED" | "NONE";
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

export function readH1SelectorCanonicalPolicySource(env: NodeJS.ProcessEnv = process.env): H1SelectorCanonicalPolicySourceResult {
  const raw = env.KITE_H1_EXACT_POLICY_JSON?.trim();
  if (!raw) {
    const selectorPolicy = resolveH1SelectorProductionPolicy();
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready: false,
      exactPolicy: null,
      selectorPolicy,
      blockers: ["KITE_H1_EXACT_POLICY_JSON_REQUIRED", ...selectorPolicy.blockers],
      source: "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }

  try {
    const exactPolicy = validateH1ExactShadowPolicy(JSON.parse(raw));
    const selectorPolicy = resolveH1SelectorProductionPolicy({
      premiumPolicy: exactPolicy.premiumPolicy,
      burdenPolicy: exactPolicy.burdenPolicy,
      capitalLiquidityDtePolicy: exactPolicy.capitalLiquidityDtePolicy,
    });
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready: selectorPolicy.ready,
      exactPolicy: selectorPolicy.ready ? exactPolicy : null,
      selectorPolicy,
      blockers: [...selectorPolicy.blockers],
      source: selectorPolicy.ready ? "KITE_H1_EXACT_POLICY_JSON_VALIDATED" : "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  } catch (error) {
    const selectorPolicy = resolveH1SelectorProductionPolicy();
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready: false,
      exactPolicy: null,
      selectorPolicy,
      blockers: [error instanceof Error ? error.message : "KITE_H1_EXACT_POLICY_JSON_INVALID"],
      source: "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }
}
