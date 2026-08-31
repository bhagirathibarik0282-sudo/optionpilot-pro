import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { KiteShadowRuntimeSupervisor, type KiteShadowRuntimeSupervisorConfig } from "./kite-runtime-shadow-supervisor.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";

export type KiteShadowAuthorityBindingResult = {
  version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_V1";
  enabled: boolean;
  started: boolean;
  reason: "DISABLED" | "API_KEY_MISSING" | "AUTHORITY_UNAVAILABLE" | "STARTED";
  supervisor: KiteShadowRuntimeSupervisor | null;
  productionImpact: "NONE";
};

export async function startKiteShadowRuntimeFromAuthority(input: {
  enabled: boolean;
  apiKey?: string | null;
  registry: KiteImmediateTokenRegistry;
  core: KiteShadowRuntimeSupervisorConfig["core"];
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
}): Promise<KiteShadowAuthorityBindingResult> {
  if (!input.enabled) {
    return { version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_V1", enabled: false, started: false, reason: "DISABLED", supervisor: null, productionImpact: "NONE" };
  }
  const apiKey = input.apiKey?.trim() || "";
  if (!apiKey) {
    return { version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_V1", enabled: true, started: false, reason: "API_KEY_MISSING", supervisor: null, productionImpact: "NONE" };
  }
  const authority = await resolveKiteAuthoritySession();
  if (!authority.session) {
    return { version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_V1", enabled: true, started: false, reason: "AUTHORITY_UNAVAILABLE", supervisor: null, productionImpact: "NONE" };
  }
  const supervisor = new KiteShadowRuntimeSupervisor({
    enabled: true,
    apiKey,
    accessToken: authority.session.accessToken,
    registry: input.registry,
    core: input.core,
    reconnectDelayMs: input.reconnectDelayMs,
    reconnectMaxAttempts: input.reconnectMaxAttempts,
  });
  supervisor.start();
  return { version: "KITE_RUNTIME_SHADOW_AUTHORITY_BINDING_V1", enabled: true, started: true, reason: "STARTED", supervisor, productionImpact: "NONE" };
}
