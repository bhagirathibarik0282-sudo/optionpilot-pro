import { KiteImmediateTokenRegistry, type KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import { startKiteShadowRuntimeFromAuthority } from "./kite-runtime-shadow-authority-binding.js";

export type KiteShadowServiceConfig = {
  enabled: boolean;
  apiKey: string | null;
  registryEntries: KiteImmediateTokenEntry[];
};

export function readKiteShadowServiceConfig(env: NodeJS.ProcessEnv = process.env): KiteShadowServiceConfig {
  const enabled = env.KITE_RUNTIME_SHADOW_ENABLED === "true";
  const apiKey = env.KITE_API_KEY?.trim() || null;
  if (!enabled) return { enabled: false, apiKey, registryEntries: [] };
  const raw = env.KITE_SHADOW_REGISTRY_JSON?.trim() || "";
  if (!raw) throw new Error("KITE_SHADOW_REGISTRY_JSON_REQUIRED");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("KITE_SHADOW_REGISTRY_JSON_INVALID"); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("KITE_SHADOW_REGISTRY_JSON_EMPTY");
  return { enabled: true, apiKey, registryEntries: parsed as KiteImmediateTokenEntry[] };
}

export async function startKiteShadowService(env: NodeJS.ProcessEnv = process.env) {
  const cfg = readKiteShadowServiceConfig(env);
  if (!cfg.enabled) {
    const status = { version: "KITE_SHADOW_RUNTIME_SERVICE_V1", enabled: false, started: false, reason: "DISABLED", productionImpact: "NONE" as const };
    console.log(JSON.stringify(status));
    return status;
  }

  const registry = new KiteImmediateTokenRegistry(cfg.registryEntries);
  const binding = await startKiteShadowRuntimeFromAuthority({
    enabled: true,
    apiKey: cfg.apiKey,
    registry,
    core: {
      cluster: { windowMs: 2_000, minDistinctMetrics: 2 },
      maxTickAgeMs: 5_000,
      trendFor: () => ({ side: "NONE", valid: false }),
      onDecision: async (decision) => {
        console.log(JSON.stringify({ type: "KITE_SHADOW_DECISION", productionImpact: "NONE", decision }));
      },
    },
    reconnectDelayMs: 1_000,
    reconnectMaxAttempts: 10,
  });

  const status = {
    version: "KITE_SHADOW_RUNTIME_SERVICE_V1",
    enabled: true,
    started: binding.started,
    reason: binding.reason,
    subscribedTokenCount: registry.tokens().length,
    productionImpact: "NONE" as const,
  };
  console.log(JSON.stringify(status));
  return status;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startKiteShadowService().catch((err) => {
    console.error(JSON.stringify({ version: "KITE_SHADOW_RUNTIME_SERVICE_V1", ok: false, error: err instanceof Error ? err.message : String(err), productionImpact: "NONE" }));
    process.exitCode = 2;
  });
}
