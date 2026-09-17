import {
  collectBusinessForwardOutcomeFromH1Registry,
  type BusinessForwardLiveOutcomeCollectorInput,
  type BusinessForwardLiveOutcomeCollectorResult,
  type LiveForwardWindow,
} from "./business-forward-live-outcome-collector-v1.js";
import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";
import {
  bridgeH1GoldChaseFromLiveOutcome,
  type H1GoldChaseLiveOutcomeBridgeResult,
} from "./h1-gold-chase-live-outcome-bridge-v1.js";
import {
  persistH1GoldChaseCalibrationSample,
  type H1GoldChasePersistenceResult,
} from "./h1-gold-chase-calibration-persistence-v1.js";
import type { H1GoldChaseObservationInput } from "./h1-gold-chase-observation-v1.js";
import {
  H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1,
  type H1GoldChaseResearchBootstrapResult,
} from "./h1-gold-chase-research-bootstrap-v1.js";

export const H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1 = "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1" as const;

const WINDOWS: readonly LiveForwardWindow[] = [
  "T_PLUS_3M",
  "T_PLUS_6M",
  "T_PLUS_15M",
  "T_PLUS_30M",
] as const;

const TARGET_MS: Record<LiveForwardWindow, number> = {
  T_PLUS_3M: 3 * 60_000,
  T_PLUS_6M: 6 * 60_000,
  T_PLUS_15M: 15 * 60_000,
  T_PLUS_30M: 30 * 60_000,
};

export type H1GoldChaseShadowRuntimeEventState =
  | "REGISTERED"
  | "WAITING_WINDOW"
  | "WAITING_EVIDENCE"
  | "WINDOW_CAPTURED"
  | "PERSIST_PENDING"
  | "DURABLE_SAMPLE"
  | "DROPPED_FAIL_CLOSED"
  | "REJECTED";

export interface H1GoldChaseShadowRuntimeEvent {
  version: typeof H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1;
  state: H1GoldChaseShadowRuntimeEventState;
  sessionKey: string | null;
  candidateKey: string | null;
  decisionId: string | null;
  window: LiveForwardWindow | null;
  blockers: string[];
  persistenceState: H1GoldChasePersistenceResult["state"] | null;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY";
}

export interface H1GoldChaseShadowRuntimeTickResult {
  version: typeof H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1;
  observedAt: string;
  activeSessionCount: number;
  events: H1GoldChaseShadowRuntimeEvent[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  schedulesSampling: true;
  fixedWindowSequence: readonly LiveForwardWindow[];
  failClosed: true;
  semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY";
}

type Session = {
  sessionKey: string;
  candidateKey: string;
  decisionId: string;
  observationInput: H1GoldChaseObservationInput;
  journal: BusinessForwardJournalRecord;
  nextWindowIndex: number;
  complete: boolean;
};

type OutcomeCollector = (input: BusinessForwardLiveOutcomeCollectorInput) => BusinessForwardLiveOutcomeCollectorResult;
type Bridge = (input: { observationInput: H1GoldChaseObservationInput; liveOutcome: BusinessForwardLiveOutcomeCollectorResult }) => H1GoldChaseLiveOutcomeBridgeResult;
type Persist = (observationInput: H1GoldChaseObservationInput, journal: BusinessForwardJournalRecord) => Promise<H1GoldChasePersistenceResult>;

export interface H1GoldChaseShadowRuntimeCollectorDeps {
  collectOutcome?: OutcomeCollector;
  bridge?: Bridge;
  persist?: Persist;
  maxRegistryAgeMs?: number;
  maxWindowLateMs?: number;
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function event(
  state: H1GoldChaseShadowRuntimeEventState,
  session: Partial<Session> | null,
  window: LiveForwardWindow | null,
  blockers: string[] = [],
  persistenceState: H1GoldChasePersistenceResult["state"] | null = null,
): H1GoldChaseShadowRuntimeEvent {
  return {
    version: H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1,
    state,
    sessionKey: session?.sessionKey ?? null,
    candidateKey: session?.candidateKey ?? null,
    decisionId: session?.decisionId ?? null,
    window,
    blockers: unique(blockers),
    persistenceState,
    ...SAFETY,
  };
}

function validBootstrap(input: H1GoldChaseResearchBootstrapResult): string[] {
  const blockers: string[] = [];
  if (!input || input.version !== H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1) blockers.push("VALID_RESEARCH_BOOTSTRAP_REQUIRED");
  if (input?.state !== "READY_FOR_FORWARD_COLLECTION" || input?.ready !== true) blockers.push("READY_FORWARD_BOOTSTRAP_REQUIRED");
  if (!input?.candidateKey?.trim() || !input?.decisionId?.trim()) blockers.push("IMMUTABLE_BOOTSTRAP_IDENTITY_REQUIRED");
  if (!input?.observationInput || !input?.journal) blockers.push("BOOTSTRAP_T0_PAYLOAD_REQUIRED");
  if (input?.strictGoldRequired !== false || input?.chasePolicyDefined !== false || input?.outcomeClassificationPolicyDefined !== false || input?.sampleSufficiencyPolicyDefined !== false) {
    blockers.push("BOOTSTRAP_POLICY_OR_STRICT_GOLD_AUTHORITY_NOT_ALLOWED");
  }
  if (
    input?.productionImpact !== "NONE" ||
    input?.affectsGoldEligibility !== false ||
    input?.affectsSelector !== false ||
    input?.affectsTelegram !== false ||
    input?.affectsExecution !== false ||
    input?.grantsPromotionAuthority !== false ||
    input?.createsOrders !== false ||
    input?.failClosed !== true
  ) {
    blockers.push("UNSAFE_BOOTSTRAP_AUTHORITY");
  }
  if (input?.journal?.anchor?.selectedCandidateKey !== input?.candidateKey) blockers.push("FROZEN_SELECTED_CANDIDATE_MISMATCH");
  if (input?.journal?.anchor?.decisionId !== input?.decisionId) blockers.push("FROZEN_DECISION_ID_MISMATCH");
  return unique(blockers);
}

function sessionKeyOf(input: H1GoldChaseResearchBootstrapResult): string {
  return `${input.decisionId}|${input.candidateKey}`;
}

export class H1GoldChaseShadowRuntimeCollector {
  private readonly sessions = new Map<string, Session>();
  private readonly collectOutcome: OutcomeCollector;
  private readonly bridge: Bridge;
  private readonly persist: Persist;
  private readonly maxRegistryAgeMs: number;
  private readonly maxWindowLateMs: number;

  constructor(deps: H1GoldChaseShadowRuntimeCollectorDeps = {}) {
    this.collectOutcome = deps.collectOutcome ?? collectBusinessForwardOutcomeFromH1Registry;
    this.bridge = deps.bridge ?? bridgeH1GoldChaseFromLiveOutcome;
    this.persist = deps.persist ?? persistH1GoldChaseCalibrationSample;
    this.maxRegistryAgeMs = Number.isFinite(deps.maxRegistryAgeMs) && Number(deps.maxRegistryAgeMs) > 0
      ? Number(deps.maxRegistryAgeMs)
      : 90_000;
    this.maxWindowLateMs = Number.isFinite(deps.maxWindowLateMs) && Number(deps.maxWindowLateMs) >= 0
      ? Number(deps.maxWindowLateMs)
      : 120_000;
  }

  register(input: H1GoldChaseResearchBootstrapResult): H1GoldChaseShadowRuntimeEvent {
    const blockers = validBootstrap(input);
    if (blockers.length > 0) return event("REJECTED", null, null, blockers);

    const sessionKey = sessionKeyOf(input);
    const existing = this.sessions.get(sessionKey);
    if (existing) return event("REGISTERED", existing, null, ["EXACT_BOOTSTRAP_ALREADY_REGISTERED"]);

    const session: Session = {
      sessionKey,
      candidateKey: input.candidateKey!,
      decisionId: input.decisionId!,
      observationInput: input.observationInput!,
      journal: input.journal!,
      nextWindowIndex: 0,
      complete: false,
    };
    this.sessions.set(sessionKey, session);
    return event("REGISTERED", session, null);
  }

  activeSessionCount(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }

  private async persistComplete(session: Session): Promise<H1GoldChaseShadowRuntimeEvent> {
    const persisted = await this.persist(session.observationInput, session.journal);
    if (persisted.state === "PERSISTED" || persisted.state === "EXACT_DUPLICATE") {
      this.sessions.delete(session.sessionKey);
      return event("DURABLE_SAMPLE", session, "T_PLUS_30M", [], persisted.state);
    }
    if (persisted.state === "DB_UNAVAILABLE" || persisted.state === "DB_ERROR") {
      return event("PERSIST_PENDING", session, "T_PLUS_30M", persisted.blockers, persisted.state);
    }
    this.sessions.delete(session.sessionKey);
    return event("DROPPED_FAIL_CLOSED", session, "T_PLUS_30M", ["DURABLE_PERSISTENCE_REJECTED", ...persisted.blockers], persisted.state);
  }

  async tick(nowIso: string): Promise<H1GoldChaseShadowRuntimeTickResult> {
    const nowMs = Date.parse(nowIso);
    const events: H1GoldChaseShadowRuntimeEvent[] = [];
    if (!Number.isFinite(nowMs)) {
      return {
        version: H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1,
        observedAt: nowIso,
        activeSessionCount: this.sessions.size,
        events: [event("REJECTED", null, null, ["VALID_TICK_TIMESTAMP_REQUIRED"])],
        ...SAFETY,
        schedulesSampling: true,
        fixedWindowSequence: WINDOWS,
      };
    }

    for (const session of [...this.sessions.values()]) {
      if (session.complete) {
        events.push(await this.persistComplete(session));
        continue;
      }

      const window = WINDOWS[session.nextWindowIndex];
      if (!window) {
        session.complete = true;
        events.push(await this.persistComplete(session));
        continue;
      }

      const expectedAtMs = session.journal.anchor.observedAtMs + TARGET_MS[window];
      if (nowMs < expectedAtMs) {
        events.push(event("WAITING_WINDOW", session, window));
        continue;
      }
      if (nowMs > expectedAtMs + this.maxWindowLateMs) {
        this.sessions.delete(session.sessionKey);
        events.push(event("DROPPED_FAIL_CLOSED", session, window, ["FORWARD_WINDOW_MISSED"]));
        continue;
      }

      const live = this.collectOutcome({
        journal: session.journal,
        nowIso,
        window,
        maxRegistryAgeMs: this.maxRegistryAgeMs,
        maxWindowLateMs: this.maxWindowLateMs,
      });

      if (!live.ready || !live.record) {
        if (live.blockers.includes("FORWARD_WINDOW_CAPTURE_TOO_LATE")) {
          this.sessions.delete(session.sessionKey);
          events.push(event("DROPPED_FAIL_CLOSED", session, window, ["FORWARD_WINDOW_MISSED", ...live.blockers]));
        } else {
          events.push(event("WAITING_EVIDENCE", session, window, live.blockers));
        }
        continue;
      }

      const bridged = this.bridge({ observationInput: session.observationInput, liveOutcome: live });
      if (bridged.state === "BLOCKED" || !bridged.journal) {
        this.sessions.delete(session.sessionKey);
        events.push(event("DROPPED_FAIL_CLOSED", session, window, ["CHASE_BRIDGE_REJECTED", ...bridged.blockers]));
        continue;
      }

      session.journal = bridged.journal;
      session.nextWindowIndex += 1;
      if (bridged.state === "COMPLETE_SAMPLE" && bridged.completeSampleReady) {
        session.complete = true;
        events.push(await this.persistComplete(session));
      } else {
        events.push(event("WINDOW_CAPTURED", session, window));
      }
    }

    return {
      version: H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1,
      observedAt: nowIso,
      activeSessionCount: this.sessions.size,
      events,
      ...SAFETY,
      schedulesSampling: true,
      fixedWindowSequence: WINDOWS,
    };
  }
}
