import {
  loadShadowBrokerRecoveryFacts,
  type ShadowBrokerRecoveryFactsIo,
} from "./shadow-broker-recovery-facts-persistence.js";
import type { ShadowBrokerStateRecoveryGuardInput } from "./shadow-broker-state-recovery-guard.js";
import {
  runShadowPostgresRestartRuntime,
  type ShadowPostgresRestartRuntimeEnvelope,
  type ShadowPostgresRestartRuntimeResult,
} from "./shadow-postgres-restart-runtime-adapter.js";
import type { ShadowReplayPersistenceAdapterInput } from "./shadow-replay-persistence-adapter.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";
import { dbQuerySafe } from "./db.js";

export interface ShadowDurableBrokerRestartProviderInput {
  providerVersion: "SHADOW_DURABLE_BROKER_RESTART_PROVIDER_V1";
  executionId: string;
  persistence: ShadowReplayPersistenceAdapterInput;
  nowIso?: string;
  maxBrokerFactsAgeMs?: number;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowDurableBrokerRestartProviderDeps {
  loadBrokerFacts?: (
    executionId: string,
    nowIso?: string,
    maxAgeMs?: number,
    io?: ShadowBrokerRecoveryFactsIo,
  ) => Promise<ShadowBrokerStateRecoveryGuardInput | null>;
  brokerFactsIo?: ShadowBrokerRecoveryFactsIo;
  runRuntime?: (
    envelope: ShadowPostgresRestartRuntimeEnvelope,
    query?: ShadowReplayDbQuery,
  ) => Promise<ShadowPostgresRestartRuntimeResult>;
  query?: ShadowReplayDbQuery;
}

function blocked(reasonCodes: string[]): ShadowPostgresRestartRuntimeResult {
  return {
    runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1",
    runtimeAccepted: false,
    version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1",
    durableBackend: "POSTGRES",
    decision: "HALT",
    persistenceDecision: "BLOCK",
    persistenceConfirmed: false,
    semanticReadBackConfirmed: false,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function runShadowDurableBrokerRestartProvider(
  input: ShadowDurableBrokerRestartProviderInput,
  deps: ShadowDurableBrokerRestartProviderDeps = {},
): Promise<ShadowPostgresRestartRuntimeResult> {
  if (!input || input.providerVersion !== "SHADOW_DURABLE_BROKER_RESTART_PROVIDER_V1") {
    return blocked(["INVALID_DURABLE_BROKER_PROVIDER_VERSION"]);
  }
  if (typeof input.executionId !== "string" || !input.executionId.trim()) {
    return blocked(["INVALID_DURABLE_BROKER_EXECUTION_ID"]);
  }
  if (!input.persistence) return blocked(["MISSING_DURABLE_REPLAY_PERSISTENCE_INPUT"]);
  if (
    input.authorizesOrder !== false ||
    input.brokerOrderAllowed !== false ||
    input.placesOrder !== false ||
    input.shadowOnly !== true ||
    input.failClosed !== true
  ) {
    return blocked(["DURABLE_BROKER_PROVIDER_ORDER_OR_SHADOW_INVARIANT_VIOLATED"]);
  }

  const loadFacts = deps.loadBrokerFacts ?? loadShadowBrokerRecoveryFacts;
  const runRuntime = deps.runRuntime ?? runShadowPostgresRestartRuntime;
  const query = deps.query ?? dbQuerySafe;
  if (typeof loadFacts !== "function" || typeof runRuntime !== "function" || typeof query !== "function") {
    return blocked(["INVALID_DURABLE_BROKER_PROVIDER_DEPENDENCY"]);
  }

  try {
    const brokerRecovery = await loadFacts(
      input.executionId.trim(),
      input.nowIso,
      input.maxBrokerFactsAgeMs,
      deps.brokerFactsIo,
    );
    if (!brokerRecovery) return blocked(["DURABLE_BROKER_RECOVERY_FACTS_UNAVAILABLE"]);
    if (brokerRecovery.stateFactsFresh !== true) {
      return blocked(["DURABLE_BROKER_RECOVERY_FACTS_STALE"]);
    }
    if (
      brokerRecovery.authorizesOrder !== false ||
      brokerRecovery.brokerOrderAllowed !== false ||
      brokerRecovery.placesOrder !== false ||
      brokerRecovery.shadowOnly !== true ||
      brokerRecovery.failClosed !== true ||
      brokerRecovery.exactContractBound !== true
    ) {
      return blocked(["DURABLE_BROKER_RECOVERY_FACTS_INVARIANT_VIOLATED"]);
    }

    return await runRuntime({
      runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1",
      recovery: {
        persistence: input.persistence,
        brokerRecovery,
      },
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    }, query);
  } catch {
    return blocked(["DURABLE_BROKER_PROVIDER_FAILED"]);
  }
}
