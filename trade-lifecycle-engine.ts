// Research-only lifecycle state machine for an exact selected option candidate.
// No live Telegram, verdict, execution, DB write, or wall-clock authority.

export type TradeLifecycleState =
  | "WATCH"
  | "ENTRY_READY"
  | "ACTIVE"
  | "HOLD"
  | "PROTECT"
  | "PARTIAL_BOOK"
  | "TRAIL"
  | "EXIT"
  | "DATA_UNAVAILABLE";

export type TradeLifecycleEvent =
  | "CANDIDATE_VALID"
  | "ENTRY_CONDITIONS_READY"
  | "ENTRY_ACTIVATED"
  | "THESIS_HOLDING"
  | "PROFIT_PROTECTION_REQUIRED"
  | "PARTIAL_BOOK_TRIGGERED"
  | "TRAIL_TRIGGERED"
  | "EXIT_TRIGGERED"
  | "DATA_LOST";

export interface TradeLifecycleInput {
  currentState: TradeLifecycleState;
  event: TradeLifecycleEvent;
  dataFresh: boolean;
  contractValid: boolean;
  sameCandidate: boolean;
  sameStyle: boolean;
  exitConditionConfirmed: boolean;
  partialBookConditionConfirmed: boolean;
  trailConditionConfirmed: boolean;
  protectConditionConfirmed: boolean;
  entryConditionConfirmed: boolean;
  entryActivatedConfirmed: boolean;
  thesisHoldingConfirmed: boolean;
}

export interface TradeLifecycleResult {
  version: "TRADE_LIFECYCLE_ENGINE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  previousState: TradeLifecycleState;
  nextState: TradeLifecycleState;
  changed: boolean;
  reasons: string[];
  devilFlags: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

const terminalStates = new Set<TradeLifecycleState>(["EXIT"]);

function result(input: TradeLifecycleInput, nextState: TradeLifecycleState, reasons: string[], devilFlags: string[] = []): TradeLifecycleResult {
  return {
    version: "TRADE_LIFECYCLE_ENGINE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    previousState: input.currentState,
    nextState,
    changed: input.currentState !== nextState,
    reasons,
    devilFlags,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

/**
 * Deterministic state machine only. It never invents a transition.
 * Safety priorities:
 * 1) missing/stale/invalid candidate => DATA_UNAVAILABLE
 * 2) EXIT is absorbing
 * 3) candidate/style mutation is blocked (no SCALP -> SWING rescue)
 * 4) EXIT may occur from any active lifecycle state when explicitly confirmed
 * 5) partial/protect/trail require their own explicit upstream conditions
 */
export function advanceTradeLifecycle(input: TradeLifecycleInput): TradeLifecycleResult {
  if (!input.dataFresh || !input.contractValid) {
    return result(input, "DATA_UNAVAILABLE", [!input.dataFresh ? "DATA_NOT_FRESH" : "CONTRACT_NOT_VALID"], ["NO_FRESH_LIFECYCLE_GUIDANCE"]);
  }

  if (!input.sameCandidate || !input.sameStyle) {
    return result(input, input.currentState, ["CANDIDATE_OR_STYLE_MUTATION_BLOCKED"], ["NO_SCALP_TO_SWING_MUTATION", "NO_CONTRACT_IDENTITY_MUTATION"]);
  }

  if (terminalStates.has(input.currentState)) {
    return result(input, "EXIT", ["EXIT_IS_TERMINAL"]);
  }

  if (input.event === "DATA_LOST") {
    return result(input, "DATA_UNAVAILABLE", ["UPSTREAM_DATA_LOST"], ["NO_FRESH_LIFECYCLE_GUIDANCE"]);
  }

  if (input.event === "EXIT_TRIGGERED") {
    if (input.exitConditionConfirmed) return result(input, "EXIT", ["EXIT_CONDITION_CONFIRMED"]);
    return result(input, input.currentState, ["EXIT_EVENT_WITHOUT_CONFIRMATION"], ["UNCONFIRMED_EXIT_BLOCKED"]);
  }

  switch (input.currentState) {
    case "DATA_UNAVAILABLE":
      if (input.event === "CANDIDATE_VALID") return result(input, "WATCH", ["FRESH_VALID_CANDIDATE_RESTORED"]);
      return result(input, "DATA_UNAVAILABLE", ["WAITING_FOR_VALID_FRESH_CANDIDATE"]);

    case "WATCH":
      if (input.event === "ENTRY_CONDITIONS_READY" && input.entryConditionConfirmed) {
        return result(input, "ENTRY_READY", ["ENTRY_CONDITIONS_CONFIRMED"]);
      }
      return result(input, "WATCH", ["ENTRY_NOT_CONFIRMED"]);

    case "ENTRY_READY":
      if (input.event === "ENTRY_ACTIVATED" && input.entryActivatedConfirmed) {
        return result(input, "ACTIVE", ["ENTRY_ACTIVATION_CONFIRMED"]);
      }
      return result(input, "ENTRY_READY", ["WAITING_FOR_ENTRY_ACTIVATION"]);

    case "ACTIVE":
      if (input.event === "THESIS_HOLDING" && input.thesisHoldingConfirmed) {
        return result(input, "HOLD", ["THESIS_HOLDING_CONFIRMED"]);
      }
      return result(input, "ACTIVE", ["ACTIVE_WAITING_FOR_HOLD_OR_EXIT_EVIDENCE"]);

    case "HOLD":
      if (input.event === "PROFIT_PROTECTION_REQUIRED" && input.protectConditionConfirmed) {
        return result(input, "PROTECT", ["PROFIT_PROTECTION_CONDITION_CONFIRMED"]);
      }
      if (input.event === "PARTIAL_BOOK_TRIGGERED" && input.partialBookConditionConfirmed) {
        return result(input, "PARTIAL_BOOK", ["PARTIAL_BOOK_CONDITION_CONFIRMED"]);
      }
      return result(input, "HOLD", ["HOLD_STATE_MAINTAINED"]);

    case "PROTECT":
      if (input.event === "PARTIAL_BOOK_TRIGGERED" && input.partialBookConditionConfirmed) {
        return result(input, "PARTIAL_BOOK", ["PARTIAL_BOOK_CONDITION_CONFIRMED"]);
      }
      if (input.event === "TRAIL_TRIGGERED" && input.trailConditionConfirmed) {
        return result(input, "TRAIL", ["TRAIL_CONDITION_CONFIRMED"]);
      }
      return result(input, "PROTECT", ["PROTECTION_STATE_MAINTAINED"]);

    case "PARTIAL_BOOK":
      if (input.event === "TRAIL_TRIGGERED" && input.trailConditionConfirmed) {
        return result(input, "TRAIL", ["TRAIL_CONDITION_CONFIRMED_AFTER_PARTIAL_BOOK"]);
      }
      return result(input, "PARTIAL_BOOK", ["WAITING_FOR_TRAIL_OR_EXIT"]);

    case "TRAIL":
      return result(input, "TRAIL", ["TRAIL_MAINTAINED_UNTIL_EXIT"]);

    case "EXIT":
      return result(input, "EXIT", ["EXIT_IS_TERMINAL"]);
  }
}
