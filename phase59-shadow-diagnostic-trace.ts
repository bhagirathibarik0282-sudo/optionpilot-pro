export const PHASE59_SHADOW_DIAGNOSTIC_VERSION = "PHASE59_SHADOW_DIAGNOSTIC_TRACE_V1" as const;

type TraceEvent = {
  at: string;
  stage: string;
  symbol?: string | null;
  detail?: string | null;
};

const counters = {
  ruleEngineInvoked: 0,
  snapshotReceived: 0,
  snapshotMissingOrInvalidTimestamp: 0,
  validationPassed: 0,
  validationFailed: 0,
  finiteScoreProduced: 0,
  dataUnavailableVerdict: 0,
  persistAttempted: 0,
  persistSucceeded: 0,
  persistReturnedNull: 0,
  persistFailed: 0,
};

const validationFailureReasons = new Map<string, number>();
const recentEvents: TraceEvent[] = [];
const MAX_EVENTS = 40;

function event(stage: string, symbol?: string | null, detail?: string | null) {
  recentEvents.push({ at: new Date().toISOString(), stage, symbol: symbol ?? null, detail: detail ?? null });
  if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
}

function extractValidationReason(validation: unknown): string {
  if (!validation || typeof validation !== "object") return "VALIDATION_OBJECT_MISSING";
  const v = validation as Record<string, unknown>;
  for (const key of ["reason", "failureReason", "message", "error"]) {
    if (typeof v[key] === "string" && v[key]) return String(v[key]);
  }
  for (const key of ["blockers", "reasons", "errors", "issues"]) {
    if (Array.isArray(v[key]) && (v[key] as unknown[]).length) {
      return (v[key] as unknown[]).map(String).join(" | ").slice(0, 500);
    }
  }
  const failedBooleanKeys = Object.entries(v)
    .filter(([k, value]) => k !== "overallValid" && value === false)
    .map(([k]) => k);
  return failedBooleanKeys.length ? `FAILED:${failedBooleanKeys.join(",")}` : "VALIDATION_FAILED_UNSPECIFIED";
}

export function phase59TraceRuleBoundary(symbol: string, market: unknown, validation: unknown): string | null {
  counters.ruleEngineInvoked += 1;
  const m = market && typeof market === "object" ? market as Record<string, unknown> : null;
  const timestamp = typeof m?.timestamp === "string" && Number.isFinite(Date.parse(m.timestamp)) ? m.timestamp : null;
  if (timestamp) counters.snapshotReceived += 1;
  else counters.snapshotMissingOrInvalidTimestamp += 1;

  const overallValid = !!(validation && typeof validation === "object" && (validation as Record<string, unknown>).overallValid === true);
  if (overallValid) {
    counters.validationPassed += 1;
    event("VALIDATION_PASSED", symbol, timestamp);
  } else {
    counters.validationFailed += 1;
    const reason = extractValidationReason(validation);
    validationFailureReasons.set(reason, (validationFailureReasons.get(reason) ?? 0) + 1);
    event("VALIDATION_FAILED", symbol, reason);
  }
  return timestamp;
}

export function phase59TraceRuleResult(symbol: string, result: unknown) {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (typeof r.score === "number" && Number.isFinite(r.score)) counters.finiteScoreProduced += 1;
  if (r.verdict === "DATA UNAVAILABLE") counters.dataUnavailableVerdict += 1;
  event("RULE_RESULT", symbol, `verdict=${String(r.verdict ?? "null")};score=${String(r.score ?? "null")}`);
}

export function phase59TracePersistAttempt(symbol: string) {
  counters.persistAttempted += 1;
  event("PERSIST_ATTEMPT", symbol);
}

export function phase59TracePersistResult(symbol: string, observationId: string | null) {
  if (observationId) {
    counters.persistSucceeded += 1;
    event("PERSIST_SUCCESS", symbol, observationId.slice(0, 16));
  } else {
    counters.persistReturnedNull += 1;
    event("PERSIST_RETURNED_NULL", symbol);
  }
}

export function phase59TracePersistError(symbol: string, err: unknown) {
  counters.persistFailed += 1;
  event("PERSIST_ERROR", symbol, err instanceof Error ? err.message : String(err));
}

export function getPhase59ShadowDiagnosticTrace() {
  return {
    version: PHASE59_SHADOW_DIAGNOSTIC_VERSION,
    architectureRole: "RESEARCH_SHADOW_DIAGNOSTIC_ONLY",
    productionImpact: "NONE",
    counterSemantics: {
      snapshotReceived: "Market snapshot with a valid timestamp reached the server Rule Engine boundary; this is not a raw broker-tick counter.",
      persistSucceeded: "persistKnownThenScoreObservation returned a stable observation id.",
      persistReturnedNull: "Persistence returned null; inspect flag/input/schema/DB path rather than assuming a DB exception.",
    },
    counters: { ...counters },
    validationFailureReasons: Object.fromEntries(validationFailureReasons.entries()),
    recentEvents: recentEvents.slice(),
    automaticFixAllowed: false,
    affectsProductionScore: false,
    affectsVerdict: false,
    affectsTelegramTradeDecision: false,
    affectsExecution: false,
  };
}
