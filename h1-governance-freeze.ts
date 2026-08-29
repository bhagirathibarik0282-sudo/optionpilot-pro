export type H1ModuleStatus = "FROZEN_RESEARCH_ONLY" | "PENDING_MANUAL_WIRING" | "DEFERRED";

export interface H1VersionRegistry {
  schemaVersion: "H1_SCHEMA_V1";
  recorderVersion: "H1_RECORDER_V1";
  derivedVersion: "H1_DERIVED_V1";
  historyRouterVersion: "H1_HISTORY_ROUTER_V1";
  marketStoryVersion: "H1_MARKET_STORY_THESIS_V1";
  replayGuardVersion: "H1_REPLAY_GUARD_V1";
  bulkPreflightVersion: "H1_BULK_PREFLIGHT_V1";
  outcomeAttributionVersion: "H1_OUTCOME_ATTRIBUTION_V1";
  postImportVersion: "H1_POST_IMPORT_V1";
  oosVersion: "H1_OOS_CALIBRATION_V1";
}

export interface H1GovernanceSnapshot {
  registry: H1VersionRegistry;
  researchOnly: true;
  productionWeightingAllowed: false;
  probabilityClaimAllowed: false;
  liveVerdictAuthority: false;
  telegramAuthority: false;
  executionAuthority: false;
  requiresExplicitPromotionApproval: true;
  statusByArea: Record<string, H1ModuleStatus>;
  promotionBlockers: string[];
  rollbackRule: string;
}

export const H1_VERSION_REGISTRY: H1VersionRegistry = {
  schemaVersion: "H1_SCHEMA_V1",
  recorderVersion: "H1_RECORDER_V1",
  derivedVersion: "H1_DERIVED_V1",
  historyRouterVersion: "H1_HISTORY_ROUTER_V1",
  marketStoryVersion: "H1_MARKET_STORY_THESIS_V1",
  replayGuardVersion: "H1_REPLAY_GUARD_V1",
  bulkPreflightVersion: "H1_BULK_PREFLIGHT_V1",
  outcomeAttributionVersion: "H1_OUTCOME_ATTRIBUTION_V1",
  postImportVersion: "H1_POST_IMPORT_V1",
  oosVersion: "H1_OOS_CALIBRATION_V1",
};

export function buildH1GovernanceSnapshot(): H1GovernanceSnapshot {
  return {
    registry: H1_VERSION_REGISTRY,
    researchOnly: true,
    productionWeightingAllowed: false,
    probabilityClaimAllowed: false,
    liveVerdictAuthority: false,
    telegramAuthority: false,
    executionAuthority: false,
    requiresExplicitPromotionApproval: true,
    statusByArea: {
      recorderAdapter: "FROZEN_RESEARCH_ONLY",
      derivedHistory: "FROZEN_RESEARCH_ONLY",
      candidateQuality: "FROZEN_RESEARCH_ONLY",
      executionLifecycle: "FROZEN_RESEARCH_ONLY",
      historyRouter: "FROZEN_RESEARCH_ONLY",
      marketStory: "FROZEN_RESEARCH_ONLY",
      replayGuard: "FROZEN_RESEARCH_ONLY",
      bulkPreflight: "FROZEN_RESEARCH_ONLY",
      outcomeAttribution: "FROZEN_RESEARCH_ONLY",
      postImportIntegrity: "FROZEN_RESEARCH_ONLY",
      oosCalibrationGuard: "FROZEN_RESEARCH_ONLY",
      serverRuntimeHook: "PENDING_MANUAL_WIRING",
      derivedSchemaInitHook: "PENDING_MANUAL_WIRING",
      productionWeighting: "DEFERRED",
      probabilityCalibration: "DEFERRED",
    },
    promotionBlockers: [
      "MANUAL_SERVER_HOOK_NOT_WIRED",
      "DERIVED_SCHEMA_INIT_NOT_WIRED",
      "TEST_SUITE_NOT_EXECUTED_IN_TARGET_RUNTIME",
      "ONE_DAY_PILOT_NOT_PASSED",
      "FIVE_DAY_PILOT_NOT_PASSED",
      "SIXTY_DAY_IMPORT_NOT_PASSED",
      "POST_IMPORT_INTEGRITY_NOT_PASSED",
      "OOS_VALIDATION_NOT_PASSED",
      "EXPLICIT_PRODUCTION_PROMOTION_APPROVAL_MISSING",
    ],
    rollbackRule:
      "Any runtime, integrity, replay, OOS, or data-quality failure keeps H1 research-only; disable hooks/remove promotion before changing live verdict, Telegram, or execution behavior.",
  };
}
