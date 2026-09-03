export type LagStage =
  | "HEAVYWEIGHT"
  | "SECTOR"
  | "BANKNIFTY"
  | "NIFTY"
  | "VIX"
  | "PREMIUM"
  | "WALL";

export type LagDirection = "UP" | "DOWN" | "MIXED" | "UNKNOWN";

export interface LagStageEvent {
  stage: LagStage;
  firstQualifiedAt: string | null;
  direction: LagDirection;
  source?: string | null;
}

export interface LagTransitionInput {
  tradeDate: string;
  events: LagStageEvent[];
}

export interface LagStageMeasurement {
  stage: LagStage;
  firstQualifiedAt: string | null;
  lagFromT0Minutes: number | null;
  direction: LagDirection;
  source: string | null;
  present: boolean;
}

export interface LagTransitionSnapshot {
  tradeDate: string;
  t0Stage: "HEAVYWEIGHT";
  t0At: string | null;
  measurements: LagStageMeasurement[];
  orderedStages: LagStage[];
  missingStages: LagStage[];
  sequenceIntegrity: "PASS" | "PARTIAL" | "DIVERGENT" | "UNAVAILABLE";
  directionalIntegrity: "ALIGNED" | "MIXED" | "UNKNOWN";
  reasons: string[];
  ruleVersion: "LAG_TRANSITION_RESEARCH_V1";
  semantics: "RESEARCH_REPLAY_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

export interface LagTransitionAggregate {
  sampleDays: number;
  usableDays: number;
  medianLagMinutesByStage: Partial<Record<LagStage, number>>;
  p75LagMinutesByStage: Partial<Record<LagStage, number>>;
  sequencePassRatePct: number | null;
  directionalAlignmentRatePct: number | null;
  ruleVersion: "LAG_TRANSITION_RESEARCH_V1";
  semantics: "MULTI_DAY_RESEARCH_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
}

const STAGE_ORDER: LagStage[] = ["HEAVYWEIGHT", "SECTOR", "BANKNIFTY", "NIFTY", "VIX", "PREMIUM", "WALL"];

function epochMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round1(sorted[lo]);
  const weight = idx - lo;
  return round1(sorted[lo] * (1 - weight) + sorted[hi] * weight);
}

export function measureLagTransition(input: LagTransitionInput): LagTransitionSnapshot {
  const byStage = new Map<LagStage, LagStageEvent>();
  for (const event of input.events) {
    if (!byStage.has(event.stage)) byStage.set(event.stage, event);
  }

  const t0 = byStage.get("HEAVYWEIGHT") ?? null;
  const t0Ms = epochMs(t0?.firstQualifiedAt ?? null);
  const reasons: string[] = [];
  const measurements: LagStageMeasurement[] = STAGE_ORDER.map((stage) => {
    const event = byStage.get(stage) ?? null;
    const eventMs = epochMs(event?.firstQualifiedAt ?? null);
    const lag = t0Ms != null && eventMs != null ? round1((eventMs - t0Ms) / 60000) : null;
    return {
      stage,
      firstQualifiedAt: event?.firstQualifiedAt ?? null,
      lagFromT0Minutes: lag,
      direction: event?.direction ?? "UNKNOWN",
      source: event?.source ?? null,
      present: eventMs != null,
    };
  });

  const missingStages = measurements.filter((x) => !x.present).map((x) => x.stage);
  const orderedStages = measurements
    .filter((x) => x.present)
    .sort((a, b) => (epochMs(a.firstQualifiedAt) ?? 0) - (epochMs(b.firstQualifiedAt) ?? 0))
    .map((x) => x.stage);

  let sequenceIntegrity: LagTransitionSnapshot["sequenceIntegrity"] = "UNAVAILABLE";
  if (t0Ms == null) {
    reasons.push("HEAVYWEIGHT_T0_UNAVAILABLE");
  } else {
    const present = measurements.filter((x) => x.present);
    const negativeLag = present.some((x) => x.lagFromT0Minutes != null && x.lagFromT0Minutes < 0);
    const canonicalPresentOrder = STAGE_ORDER.filter((stage) => byStage.has(stage) && epochMs(byStage.get(stage)?.firstQualifiedAt ?? null) != null);
    const orderMatches = canonicalPresentOrder.every((stage, i) => orderedStages[i] === stage);
    if (negativeLag || !orderMatches) {
      sequenceIntegrity = "DIVERGENT";
      reasons.push("OBSERVED_STAGE_ORDER_DIVERGES_FROM_HYPOTHESIS");
    } else if (missingStages.length > 0) {
      sequenceIntegrity = "PARTIAL";
      reasons.push("ONE_OR_MORE_STAGES_MISSING");
    } else {
      sequenceIntegrity = "PASS";
      reasons.push("OBSERVED_STAGE_ORDER_MATCHES_HYPOTHESIS");
    }
  }

  const directions = measurements
    .filter((x) => x.present && x.direction !== "UNKNOWN")
    .map((x) => x.direction)
    .filter((x) => x !== "MIXED");
  let directionalIntegrity: LagTransitionSnapshot["directionalIntegrity"] = "UNKNOWN";
  if (directions.length) {
    directionalIntegrity = directions.every((d) => d === directions[0]) ? "ALIGNED" : "MIXED";
  }

  return {
    tradeDate: input.tradeDate,
    t0Stage: "HEAVYWEIGHT",
    t0At: t0?.firstQualifiedAt ?? null,
    measurements,
    orderedStages,
    missingStages,
    sequenceIntegrity,
    directionalIntegrity,
    reasons,
    ruleVersion: "LAG_TRANSITION_RESEARCH_V1",
    semantics: "RESEARCH_REPLAY_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}

export function aggregateLagTransitions(days: LagTransitionSnapshot[]): LagTransitionAggregate {
  const usable = days.filter((d) => d.t0At != null);
  const medians: Partial<Record<LagStage, number>> = {};
  const p75: Partial<Record<LagStage, number>> = {};

  for (const stage of STAGE_ORDER) {
    const values = usable
      .map((d) => d.measurements.find((m) => m.stage === stage)?.lagFromT0Minutes ?? null)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
    const median = percentile(values, 0.5);
    const q75 = percentile(values, 0.75);
    if (median != null) medians[stage] = median;
    if (q75 != null) p75[stage] = q75;
  }

  const passDays = usable.filter((d) => d.sequenceIntegrity === "PASS").length;
  const alignedDays = usable.filter((d) => d.directionalIntegrity === "ALIGNED").length;

  return {
    sampleDays: days.length,
    usableDays: usable.length,
    medianLagMinutesByStage: medians,
    p75LagMinutesByStage: p75,
    sequencePassRatePct: usable.length ? round1((passDays / usable.length) * 100) : null,
    directionalAlignmentRatePct: usable.length ? round1((alignedDays / usable.length) * 100) : null,
    ruleVersion: "LAG_TRANSITION_RESEARCH_V1",
    semantics: "MULTI_DAY_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
  };
}
