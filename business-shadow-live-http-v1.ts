import {
  buildBusinessShadowLiveBridge,
  type BusinessShadowLiveBridgeInput,
} from "./business-shadow-live-bridge-v1.js";

export const BUSINESS_SHADOW_LIVE_HTTP_V1 = "BUSINESS_SHADOW_LIVE_HTTP_V1" as const;

export interface BusinessShadowLiveHttpResult {
  ok: boolean;
  mode: "READ_ONLY_BUSINESS_SHADOW_LIVE_V1";
  productionImpact: "NONE";
  result: ReturnType<typeof buildBusinessShadowLiveBridge> | null;
  reason?: string;
  safety: {
    readOnly: true;
    databaseWrites: false;
    telegramWrites: false;
    executionAuthority: false;
    candidateAuthority: false;
    starAuthority: false;
    createsOrders: false;
  };
}

function safety(): BusinessShadowLiveHttpResult["safety"] {
  return {
    readOnly: true,
    databaseWrites: false,
    telegramWrites: false,
    executionAuthority: false,
    candidateAuthority: false,
    starAuthority: false,
    createsOrders: false,
  };
}

export function businessShadowLiveRuntimeStatus() {
  return {
    ok: true,
    version: BUSINESS_SHADOW_LIVE_HTTP_V1,
    mode: "READ_ONLY_BUSINESS_SHADOW_LIVE_V1" as const,
    productionImpact: "NONE" as const,
    ready: true,
    sourceBinding: "CALLER_SUPPLIED_VERIFIED_CANONICAL_SNAPSHOT_AND_SHADOW_INPUTS" as const,
    forwardWindows: ["T0", "T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"] as const,
    safety: safety(),
  };
}

/**
 * Read-only diagnostic boundary.
 * No persistence, no Telegram, no selector authority, no star authority, no execution.
 */
export function evaluateBusinessShadowLiveHttp(body: unknown): BusinessShadowLiveHttpResult {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      mode: "READ_ONLY_BUSINESS_SHADOW_LIVE_V1",
      productionImpact: "NONE",
      result: null,
      reason: "BUSINESS_SHADOW_LIVE_BODY_REQUIRED",
      safety: safety(),
    };
  }

  try {
    const result = buildBusinessShadowLiveBridge(body as BusinessShadowLiveBridgeInput);
    return {
      ok: result.ready,
      mode: "READ_ONLY_BUSINESS_SHADOW_LIVE_V1",
      productionImpact: "NONE",
      result,
      ...(result.ready ? {} : { reason: result.blockers[0] ?? "BUSINESS_SHADOW_LIVE_NOT_READY" }),
      safety: safety(),
    };
  } catch {
    return {
      ok: false,
      mode: "READ_ONLY_BUSINESS_SHADOW_LIVE_V1",
      productionImpact: "NONE",
      result: null,
      reason: "BUSINESS_SHADOW_LIVE_EVALUATION_FAILED",
      safety: safety(),
    };
  }
}
