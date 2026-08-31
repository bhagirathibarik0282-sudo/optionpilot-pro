import {
  persistShadowReplayThroughAdapter,
  type ShadowReplayPersistenceAdapterInput,
  type ShadowReplayPersistenceAdapterResult,
} from "./shadow-replay-persistence-adapter.js";
import {
  createPostgresShadowReplayDurableStore,
  type ShadowReplayDbQuery,
} from "./shadow-replay-postgres-store.js";
import { dbQuerySafe } from "./db.js";

export interface ShadowReplayPostgresPersistenceResult extends ShadowReplayPersistenceAdapterResult {
  compositionVersion: "SHADOW_REPLAY_POSTGRES_PERSISTENCE_V1";
  durableBackend: "POSTGRES";
}

function blocked(
  reasonCodes: string[],
  stableReplayKey: string | null = null,
): ShadowReplayPostgresPersistenceResult {
  return {
    compositionVersion: "SHADOW_REPLAY_POSTGRES_PERSISTENCE_V1",
    durableBackend: "POSTGRES",
    version: "SHADOW_REPLAY_PERSISTENCE_ADAPTER_V1",
    decision: "BLOCK",
    persistenceConfirmed: false,
    reusableAfterRestart: false,
    stableReplayKey,
    semanticReadBackConfirmed: false,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function persistShadowReplayToPostgres(
  input: ShadowReplayPersistenceAdapterInput,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowReplayPostgresPersistenceResult> {
  if (typeof query !== "function") {
    return blocked(["INVALID_POSTGRES_QUERY_ADAPTER"], input?.stableReplayKey ?? null);
  }

  if (
    input?.authorizesOrder !== false ||
    input?.brokerOrderAllowed !== false ||
    input?.placesOrder !== false ||
    input?.shadowOnly !== true ||
    input?.failClosed !== true
  ) {
    return blocked(["ORDER_OR_SHADOW_INVARIANT_VIOLATED"], input?.stableReplayKey ?? null);
  }

  try {
    const store = createPostgresShadowReplayDurableStore(query);
    const result = await persistShadowReplayThroughAdapter(input, store);

    return {
      ...result,
      compositionVersion: "SHADOW_REPLAY_POSTGRES_PERSISTENCE_V1",
      durableBackend: "POSTGRES",
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return blocked(["POSTGRES_PERSISTENCE_COMPOSITION_FAILED"], input?.stableReplayKey ?? null);
  }
}
