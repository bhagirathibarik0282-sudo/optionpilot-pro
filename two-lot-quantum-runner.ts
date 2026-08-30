import { quantumInspiredAugment } from "./quantum-inspired-core.js";
import { calculateIndexRunnerBuffer, type IndexRunnerBufferInput } from "./index-runner-buffer.js";

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
  scaleOutClassicalScore: number;
  runnerClassicalScore: number;
  scaleOutMinScore: number;
  runnerExitMaxScore: number;
  structuralSlCandidate: number;
  runnerBuffer: IndexRunnerBufferInput;
}

export interface TwoLotRunnerDecision {
  action: "HOLD_TWO" | "REQUEST_PARTIAL_EXIT" | "WAIT_PARTIAL_FILL" | "RUNNER_HOLD" | "REQUEST_RUNNER_EXIT" | "CLOSED" | "BLOCK";
  requestedExitQty: number;
  nextTrailingSl: number;
  runnerBufferPoints: number | null;
  quantumScaleOutScore: number | null;
  quantumRunnerScore: number | null;
  failClosed: boolean;
  reason: string;
  placesOrder: false;
}

const finitePositive = (n: number) => Number.isFinite(n) && n > 0;
const finite = (n: number) => Number.isFinite(n);

export function evaluateTwoLotQuantumRunner(input: TwoLotRunnerInput): TwoLotRunnerDecision {
  const twoLotQty = input.lotSize * 2;
  const base = (
    action: TwoLotRunnerDecision["action"],
    reason: string,
    requestedExitQty = 0,
    nextTrailingSl = input.currentTrailingSl,
    bufferPoints: number | null = null,
    scale: number | null = null,
    runner: number | null = null,
    failClosed = false,
  ): TwoLotRunnerDecision => ({
    action,
    reason,
    requestedExitQty,
    nextTrailingSl,
    runnerBufferPoints: bufferPoints,
    quantumScaleOutScore: scale,
    quantumRunnerScore: runner,
    failClosed,
    placesOrder: false,
  });

  if (![input.entryPrice, input.currentPremium, input.currentTrailingSl, input.structuralSlCandidate].every(finitePositive)) return base("BLOCK", "INVALID_PRICE_STATE", 0, input.currentTrailingSl, null, null, null, true);
  if (![input.scaleOutClassicalScore, input.runnerClassicalScore, input.scaleOutMinScore, input.runnerExitMaxScore].every(finite)) return base("BLOCK", "INVALID_SCORE_STATE", 0, input.currentTrailingSl, null, null, null, true);
  if (!Number.isInteger(input.lotSize) || input.lotSize <= 0) return base("BLOCK", "INVALID_LOT_SIZE", 0, input.currentTrailingSl, null, null, null, true);
  if (!Number.isInteger(input.filledEntryQty) || !Number.isInteger(input.confirmedExitQty) || input.filledEntryQty < 0 || input.confirmedExitQty < 0 || input.confirmedExitQty > input.filledEntryQty) return base("BLOCK", "INVALID_FILL_STATE", 0, input.currentTrailingSl, null, null, null, true);
  if (input.filledEntryQty !== twoLotQty) return base("BLOCK", "TWO_LOT_ENTRY_NOT_CONFIRMED", 0, input.currentTrailingSl, null, null, null, true);
  if (!input.runnerBuffer || input.runnerBuffer.currentPremium !== input.currentPremium) return base("BLOCK", "RUNNER_BUFFER_STATE_MISMATCH", 0, input.currentTrailingSl, null, null, null, true);

  const scale = quantumInspiredAugment({ label: "TWO_LOT_SCALE_OUT", values: input.scaleOutFeatures, classicalScore: input.scaleOutClassicalScore });
  const runner = quantumInspiredAugment({ label: "ONE_LOT_RUNNER", values: input.runnerFeatures, classicalScore: input.runnerClassicalScore });
  if (!scale.valid || !runner.valid || scale.adjustedScore === null || runner.adjustedScore === null) return base("BLOCK", "QUANTUM_INPUT_UNAVAILABLE", 0, input.currentTrailingSl, null, null, null, true);

  const buffer = calculateIndexRunnerBuffer(input.runnerBuffer);
  if (!buffer.valid || buffer.bufferPoints === null) return base("BLOCK", "INDEX_RUNNER_BUFFER_UNAVAILABLE", 0, input.currentTrailingSl, null, scale.adjustedScore, runner.adjustedScore, true);

  // Long-option runner: anti-whipsaw stop sits no tighter than current premium minus
  // the index-specific dynamic buffer. Structural invalidation may keep it looser.
  // Existing TSL can only stay unchanged or tighten; it can never widen.
  const bufferedCandidate = Math.max(0.01, input.currentPremium - buffer.bufferPoints);
  const boundedStructuralCandidate = Math.min(input.structuralSlCandidate, bufferedCandidate, input.currentPremium);
  const nextTrailingSl = Math.max(input.currentTrailingSl, boundedStructuralCandidate);

  if (input.stage === "CLOSED") return base("CLOSED", "TRADE_ALREADY_CLOSED", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);

  if (input.stage === "PARTIAL_EXIT_PENDING") {
    if (input.confirmedExitQty < input.lotSize) return base("WAIT_PARTIAL_FILL", "PARTIAL_EXIT_NOT_CONFIRMED", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
    if (input.confirmedExitQty > input.lotSize) return base("BLOCK", "PARTIAL_EXIT_OVERFILL", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore, true);
    return base("RUNNER_HOLD", "PARTIAL_EXIT_CONFIRMED_RUNNER_ACTIVE", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "TWO_LOTS_ACTIVE") {
    if (input.confirmedExitQty !== 0) return base("BLOCK", "UNEXPECTED_EXIT_QTY_BEFORE_SCALE_OUT", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore, true);
    if (scale.adjustedScore >= input.scaleOutMinScore) return base("REQUEST_PARTIAL_EXIT", "DYNAMIC_SCALE_OUT_QUALITY_REACHED", input.lotSize, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
    return base("HOLD_TWO", "SCALE_OUT_QUALITY_NOT_REACHED", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "ONE_LOT_RUNNER") {
    if (input.confirmedExitQty !== input.lotSize) return base("BLOCK", "RUNNER_REQUIRES_CONFIRMED_ONE_LOT_EXIT", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore, true);
    if (input.currentPremium <= nextTrailingSl) return base("REQUEST_RUNNER_EXIT", "DYNAMIC_TRAILING_SL_HIT", input.lotSize, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
    if (runner.adjustedScore <= input.runnerExitMaxScore) return base("REQUEST_RUNNER_EXIT", "RUNNER_QUALITY_DETERIORATED", input.lotSize, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
    return base("RUNNER_HOLD", "RUNNER_QUALITY_HEALTHY", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);
  }

  if (input.stage === "EXIT_PENDING") return base("WAIT_PARTIAL_FILL", "FINAL_EXIT_AWAITING_CONFIRMATION", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore);

  return base("BLOCK", "UNKNOWN_STAGE", 0, nextTrailingSl, buffer.bufferPoints, scale.adjustedScore, runner.adjustedScore, true);
}
