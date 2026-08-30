import { quantumInspiredAugment } from "./quantum-inspired-core.js";

export type TwoLotStage = "TWO_LOTS_ACTIVE" | "PARTIAL_EXIT_PENDING" | "ONE_LOT_RUNNER" | "EXIT_PENDING" | "CLOSED";

export interface TwoLotRunnerInput {
  entryPrice: number;
  currentPremium: number;
  currentTrailingSl: number;
  lotSize: number;
  filledEntryQty: number;
  confirmedExitQty: number;
  stage: TwoLotStage;
  scaleOutFeatures: number[];
  runnerFeatures: number[];
  scaleOutMinScore: number;
  runnerExitMaxScore: number;
  structuralSlCandidate: number;
}

export interface TwoLotRunnerDecision {
  action: "HOLD_TWO" | "REQUEST_PARTIAL_EXIT" | "WAIT_PARTIAL_FILL" | "RUNNER_HOLD" | "REQUEST_RUNNER_EXIT" | "CLOSED" | "BLOCK";
  requestedExitQty: number;
  nextTrailingSl: number;
  quantumScaleOutScore: number | null;
  quantumRunnerScore: number | null;
  failClosed: boolean;
  reason: string;
  placesOrder: false;
}

const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

export function evaluateTwoLotQuantumRunner(input: TwoLotRunnerInput): TwoLotRunnerDecision {
  const twoLotQty = input.lotSize * 2;
  const base = (action: TwoLotRunnerDecision["action"], reason: string, requestedExitQty = 0, nextTrailingSl = input.currentTrailingSl, scale: number | null = null, runner: number | null = null, failClosed = false): TwoLotRunnerDecision => ({
    action, reason, requestedExitQty, nextTrailingSl, quantumScaleOutScore: scale, quantumRunnerScore: runner, failClosed, placesOrder: false,
  });

  if (![input.entryPrice, input.currentPremium, input.currentTrailingSl, input.structuralSlCandidate].every(finitePositive)) return base("BLOCK", "INVALID_PRICE_STATE", 0, input.currentTrailingSl, null, null, true);
  if (!Number.isInteger(input.lotSize) || input.lotSize <= 0) return base("BLOCK", "INVALID_LOT_SIZE", 0, input.currentTrailingSl, null, null, true);
  if (!Number.isInteger(input.filledEntryQty) || !Number.isInteger(input.confirmedExitQty) || input.filledEntryQty < 0 || input.confirmedExitQty < 0 || input.confirmedExitQty > input.filledEntryQty) return base("BLOCK", "INVALID_FILL_STATE", 0, input.currentTrailingSl, null, null, true);
  if (input.filledEntryQty !== twoLotQty) return base("BLOCK", "TWO_LOT_ENTRY_NOT_CONFIRMED", 0, input.currentTrailingSl, null, null, true);
  if (input.currentTrailingSl >= input.entryPrice && input.stage === "TWO_LOTS_ACTIVE") {
    // Allowed, but do not synthesize a wider stop.
  }

  const scale = quantumInspiredAugment(input.scaleOutFeatures);
  const runner = quantumInspiredAugment(input.runnerFeatures);
  if (!scale.ok || !runner.ok) return base("BLOCK", "QUANTUM_INPUT_UNAVAILABLE", 0, input.currentTrailingSl, null, null, true);

  const nextTrailingSl = Math.max(input.currentTrailingSl, Math.min(input.structuralSlCandidate, input.currentPremium));

  if (input.stage === "CLOSED") return base("CLOSED", "TRADE_ALREADY_CLOSED", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);

  if (input.stage === "PARTIAL_EXIT_PENDING") {
    if (input.confirmedExitQty < input.lotSize) return base("WAIT_PARTIAL_FILL", "PARTIAL_EXIT_NOT_CONFIRMED", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
    return base("RUNNER_HOLD", "PARTIAL_EXIT_CONFIRMED_RUNNER_ACTIVE", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "TWO_LOTS_ACTIVE") {
    if (input.confirmedExitQty !== 0) return base("BLOCK", "UNEXPECTED_EXIT_QTY_BEFORE_SCALE_OUT", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore, true);
    if (scale.adjustedScore >= input.scaleOutMinScore) return base("REQUEST_PARTIAL_EXIT", "DYNAMIC_SCALE_OUT_QUALITY_REACHED", input.lotSize, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
    return base("HOLD_TWO", "SCALE_OUT_QUALITY_NOT_REACHED", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "ONE_LOT_RUNNER") {
    if (input.confirmedExitQty !== input.lotSize) return base("BLOCK", "RUNNER_REQUIRES_CONFIRMED_ONE_LOT_EXIT", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore, true);
    if (input.currentPremium <= nextTrailingSl) return base("REQUEST_RUNNER_EXIT", "DYNAMIC_TRAILING_SL_HIT", input.lotSize, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
    if (runner.adjustedScore <= input.runnerExitMaxScore) return base("REQUEST_RUNNER_EXIT", "RUNNER_QUALITY_DETERIORATED", input.lotSize, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
    return base("RUNNER_HOLD", "RUNNER_QUALITY_HEALTHY", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "EXIT_PENDING") return base("WAIT_PARTIAL_FILL", "FINAL_EXIT_AWAITING_CONFIRMATION", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore);

  return base("BLOCK", "UNKNOWN_STAGE", 0, nextTrailingSl, scale.adjustedScore, runner.adjustedScore, true);
}
