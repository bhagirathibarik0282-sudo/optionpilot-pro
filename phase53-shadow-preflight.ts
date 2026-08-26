import { dbQuerySafe } from "./db.js";
import { getPhase51ShadowReadiness } from "./phase51-shadow-readiness.js";
import { scoreObservationShadowEnabled } from "./score-observation-known-then.js";

export const PHASE53_PREFLIGHT_VERSION = "PHASE53_CONTROLLED_SHADOW_PREFLIGHT_V1" as const;

export type Phase53PreflightStatus =
  | "PREPARED_NOT_ACTIVATED"
  | "BLOCKED"
  | "ALREADY_ENABLED_REQUIRES_OPERATOR_REVIEW";

export interface Phase53DbProbe {
  databaseConfigured: boolean;
  databaseReachable: boolean;
  scoreObservationTableExists: boolean;
  error: string | null;
}

export interface Phase53PreflightReport {
  version: typeof PHASE53_PREFLIGHT_VERSION;
  architectureRole: "CONTROLLED_SHADOW_ACTIVATION_PREFLIGHT_ONLY";
  productionImpact: "NONE";
  status: Phase53PreflightStatus;
  shadowFlagEnabled: boolean;
  automaticActivationAllowed: false;
  productionReady: false;
  db: Phase53DbProbe;
  readiness: Awaited<ReturnType<typeof getPhase51ShadowReadiness>>;
  requiredActivationAction: "MANUAL_ENV_CHANGE_AND_REDEPLOY";
  activationVariable: "PHASE50_SCORE_SHADOW";
  activationValue: "true";
  rollbackVariable: "PHASE50_SCORE_SHADOW";
  rollbackValue: "false";
  monitorEndpoints: readonly ["/api/research/shadow-readiness", "/api/research/max-pain-counterfactual"];
  blockers: string[];
  activationChecklist: string[];
  rollbackChecklist: string[];
  liveEvidenceChecklist: string[];
}

export async function probePhase53Database(): Promise<Phase53DbProbe> {
  const configured = Boolean(process.env.DATABASE_URL?.trim());
  if (!configured) {
    return {
      databaseConfigured: false,
      databaseReachable: false,
      scoreObservationTableExists: false,
      error: "DATABASE_URL_NOT_CONFIGURED",
    };
  }

  const result = await dbQuerySafe<{ table_name: string | null }>(
    "SELECT to_regclass('public.score_observation_known_then')::text AS table_name",
  );
  if (!result) {
    return {
      databaseConfigured: true,
      databaseReachable: false,
      scoreObservationTableExists: false,
      error: "DATABASE_PROBE_FAILED",
    };
  }
  return {
    databaseConfigured: true,
    databaseReachable: true,
    scoreObservationTableExists: Boolean(result.rows?.[0]?.table_name),
    error: null,
  };
}

export function buildPhase53PreflightReport(
  db: Phase53DbProbe,
  readiness: Awaited<ReturnType<typeof getPhase51ShadowReadiness>>,
  shadowFlagEnabled: boolean,
): Phase53PreflightReport {
  const blockers: string[] = [];
  if (!db.databaseConfigured) blockers.push("DATABASE_URL_NOT_CONFIGURED");
  if (db.databaseConfigured && !db.databaseReachable) blockers.push("DATABASE_NOT_REACHABLE");
  // Table absence before activation is not by itself fatal because Phase 50 creates it lazily,
  // but it must be visible to the operator as a pre-activation condition.
  if (!db.scoreObservationTableExists) blockers.push("SCORE_OBSERVATION_TABLE_NOT_YET_PRESENT");

  let status: Phase53PreflightStatus;
  if (shadowFlagEnabled) status = "ALREADY_ENABLED_REQUIRES_OPERATOR_REVIEW";
  else if (blockers.some((b) => b !== "SCORE_OBSERVATION_TABLE_NOT_YET_PRESENT")) status = "BLOCKED";
  else status = "PREPARED_NOT_ACTIVATED";

  return {
    version: PHASE53_PREFLIGHT_VERSION,
    architectureRole: "CONTROLLED_SHADOW_ACTIVATION_PREFLIGHT_ONLY",
    productionImpact: "NONE",
    status,
    shadowFlagEnabled,
    automaticActivationAllowed: false,
    productionReady: false,
    db,
    readiness,
    requiredActivationAction: "MANUAL_ENV_CHANGE_AND_REDEPLOY",
    activationVariable: "PHASE50_SCORE_SHADOW",
    activationValue: "true",
    rollbackVariable: "PHASE50_SCORE_SHADOW",
    rollbackValue: "false",
    monitorEndpoints: ["/api/research/shadow-readiness", "/api/research/max-pain-counterfactual"],
    blockers,
    activationChecklist: [
      "Confirm PR remains Draft/unmerged and no production decision logic is being promoted.",
      "Confirm DATABASE_URL is reachable and PostgreSQL writes are healthy.",
      "Record current deployment/revision identifier before changing any environment variable.",
      "Set PHASE50_SCORE_SHADOW=true only as an explicit operator action.",
      "Redeploy/restart once; do not add any broker request or scoring change.",
      "Verify /api/research/shadow-readiness becomes ENABLED_NO_DATA or ENABLED_OBSERVING.",
      "Confirm production score/verdict/Telegram/execution behavior is unchanged.",
      "Start Phase 52 evidence log for the live session.",
    ],
    rollbackChecklist: [
      "Set PHASE50_SCORE_SHADOW=false.",
      "Redeploy/restart once.",
      "Verify /api/research/shadow-readiness reports DISABLED.",
      "Do not delete previously collected KNOWN_THEN rows; preserve append-only evidence.",
      "Record rollback reason and deployment identifier in the evidence log.",
    ],
    liveEvidenceChecklist: [
      "Session ID and trade date.",
      "First and last observed KNOWN_THEN timestamps.",
      "Rows by NIFTY/BANKNIFTY/SENSEX.",
      "Duplicate observation count.",
      "Max Pain known vs UNKNOWN contribution counts.",
      "Observed cadence summary without freezing a threshold.",
      "Any persistence/DB error.",
      "Proof production verdict/Telegram/execution did not change because of shadow collection.",
      "Phase 52 scenario evidence references.",
    ],
  };
}

export async function getPhase53ShadowPreflight(symbol?: string): Promise<Phase53PreflightReport> {
  const [db, readiness] = await Promise.all([
    probePhase53Database(),
    getPhase51ShadowReadiness(symbol, 5000),
  ]);
  return buildPhase53PreflightReport(db, readiness, scoreObservationShadowEnabled());
}

export const PHASE53_SAFETY = Object.freeze({
  mutatesShadowFlag: false,
  automaticActivationAllowed: false,
  productionReady: false,
  writesTradingState: false,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  addsBrokerRequest: false,
  deletesKnownThenEvidenceOnRollback: false,
});
