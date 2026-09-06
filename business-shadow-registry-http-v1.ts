import {
  buildBusinessShadowFromH1Registry,
  type BusinessShadowRegistryAdapterInput,
} from "./business-shadow-registry-adapter-v1.js";

export const BUSINESS_SHADOW_REGISTRY_HTTP_V1 = "BUSINESS_SHADOW_REGISTRY_HTTP_V1" as const;

function safety() {
  return {
    readOnly: true as const,
    databaseWrites: false as const,
    telegramWrites: false as const,
    candidateAuthority: false as const,
    starAuthority: false as const,
    executionAuthority: false as const,
    createsOrders: false as const,
  };
}

export function businessShadowRegistryRuntimeStatus() {
  return {
    ok: true,
    version: BUSINESS_SHADOW_REGISTRY_HTTP_V1,
    mode: "READ_ONLY_BUSINESS_SHADOW_REGISTRY_V1" as const,
    productionImpact: "NONE" as const,
    ready: true,
    sourceBinding: "H1_LIVE_SELECTOR_REGISTRY_EXACT_ONLY" as const,
    officialCandidateInference: false,
    safety: safety(),
  };
}

export function evaluateBusinessShadowRegistryHttp(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      version: BUSINESS_SHADOW_REGISTRY_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_SHADOW_REGISTRY_V1" as const,
      productionImpact: "NONE" as const,
      result: null,
      reason: "BUSINESS_SHADOW_REGISTRY_BODY_REQUIRED",
      safety: safety(),
    };
  }

  try {
    const result = buildBusinessShadowFromH1Registry(body as BusinessShadowRegistryAdapterInput);
    return {
      ok: result.ready,
      version: BUSINESS_SHADOW_REGISTRY_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_SHADOW_REGISTRY_V1" as const,
      productionImpact: "NONE" as const,
      result,
      ...(result.ready ? {} : { reason: result.blockers[0] ?? "BUSINESS_SHADOW_REGISTRY_NOT_READY" }),
      safety: safety(),
    };
  } catch {
    return {
      ok: false,
      version: BUSINESS_SHADOW_REGISTRY_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_SHADOW_REGISTRY_V1" as const,
      productionImpact: "NONE" as const,
      result: null,
      reason: "BUSINESS_SHADOW_REGISTRY_EVALUATION_FAILED",
      safety: safety(),
    };
  }
}
