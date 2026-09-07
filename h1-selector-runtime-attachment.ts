import type { H1SelectorProductionPolicyResult } from "./h1-selector-production-policy.js";
import { H1KiteExactRuntimeCoordinator, type H1KiteExactRuntimeCoordinatorConfig } from "./h1-kite-exact-runtime-coordinator.js";
import type { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";

export interface H1SelectorRuntimeAttachmentInput {
  registry: KiteImmediateTokenRegistry;
  policy: H1SelectorProductionPolicyResult;
  coordinatorConfig: Omit<H1KiteExactRuntimeCoordinatorConfig, "registry">;
}

export interface H1SelectorRuntimeAttachmentResult {
  version: "H1_SELECTOR_RUNTIME_ATTACHMENT_V1";
  ready: boolean;
  coordinator: H1KiteExactRuntimeCoordinator | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

export function attachH1SelectorRuntime(input: H1SelectorRuntimeAttachmentInput): H1SelectorRuntimeAttachmentResult {
  const blockers: string[] = [];
  if (!input?.registry) blockers.push("SELECTOR_REGISTRY_REQUIRED");
  if (!input?.policy?.ready) blockers.push(...(input?.policy?.blockers ?? ["SELECTOR_PRODUCTION_POLICY_NOT_READY"]));
  if (!input?.coordinatorConfig?.orderQuantityFor) blockers.push("ORDER_QUANTITY_RESOLVER_REQUIRED");
  if (!input?.coordinatorConfig?.greekPolicy) blockers.push("GREEK_POLICY_REQUIRED");
  if (!input?.coordinatorConfig?.publisherFor) blockers.push("PUBLISHER_CONTEXT_RESOLVER_REQUIRED");

  if (blockers.length > 0) {
    return {
      version: "H1_SELECTOR_RUNTIME_ATTACHMENT_V1",
      ready: false,
      coordinator: null,
      blockers: [...new Set(blockers)],
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }

  return {
    version: "H1_SELECTOR_RUNTIME_ATTACHMENT_V1",
    ready: true,
    coordinator: new H1KiteExactRuntimeCoordinator({ registry: input.registry, ...input.coordinatorConfig }),
    blockers: [],
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}
