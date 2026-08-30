// Execution level plan for long option buys.
// No broker/network side effects. Requires an externally confirmed entry and deterministic invalidation premium.

export type ExecutionLevelDecision = "READY" | "BLOCK";

export interface ExecutionLevelPlanInput {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  entryPremium: number;
  invalidationPremium: number;
  entryTriggerConfirmed: boolean;
  structureInvalidationConfirmed: boolean;
  maxLossPerTrade: number;
  quantity: number;
  lotSize: number;
}

export interface ExecutionLevelPlanResult {
  version: "EXECUTION_LEVEL_PLAN_V1";
  decision: ExecutionLevelDecision;
  reasonCodes: string[];
  entry: number | null;
  stopLoss: number | null;
  riskPerUnit: number | null;
  projectedLoss: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  failClosed: true;
}

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function positiveInteger(v: number): boolean {
  return Number.isInteger(v) && v > 0;
}

export function buildExecutionLevelPlan(input: ExecutionLevelPlanInput): ExecutionLevelPlanResult {
  const reasonCodes: string[] = [];
  const entry = finitePositive(input?.entryPremium) ? input.entryPremium : null;
  const stopLoss = finitePositive(input?.invalidationPremium) ? input.invalidationPremium : null;
  const maxLossPerTrade = finitePositive(input?.maxLossPerTrade) ? input.maxLossPerTrade : null;
  const quantity = positiveInteger(input?.quantity) ? input.quantity : null;
  const lotSize = positiveInteger(input?.lotSize) ? input.lotSize : null;

  if (input?.entryTriggerConfirmed !== true) reasonCodes.push("ENTRY_TRIGGER_NOT_CONFIRMED");
  if (input?.structureInvalidationConfirmed !== true) reasonCodes.push("STRUCTURE_INVALIDATION_NOT_CONFIRMED");
  if (entry == null) reasonCodes.push("INVALID_ENTRY_PREMIUM");
  if (stopLoss == null) reasonCodes.push("INVALID_STOP_LOSS_PREMIUM");
  if (maxLossPerTrade == null) reasonCodes.push("INVALID_MAX_LOSS_PER_TRADE");
  if (quantity == null) reasonCodes.push("INVALID_QUANTITY");
  if (lotSize == null) reasonCodes.push("INVALID_LOT_SIZE");

  if (entry != null && stopLoss != null && stopLoss >= entry) {
    reasonCodes.push("STOP_LOSS_MUST_BE_BELOW_ENTRY_FOR_LONG_OPTION");
  }

  const riskPerUnit = reasonCodes.length === 0 ? entry! - stopLoss! : null;
  const projectedLoss = riskPerUnit != null ? riskPerUnit * quantity! * lotSize! : null;

  if (projectedLoss != null && projectedLoss > maxLossPerTrade!) {
    reasonCodes.push("PROJECTED_LOSS_EXCEEDS_MAX_LOSS_PER_TRADE");
  }

  const ready = reasonCodes.length === 0;
  return {
    version: "EXECUTION_LEVEL_PLAN_V1",
    decision: ready ? "READY" : "BLOCK",
    reasonCodes: ready ? ["EXECUTION_LEVEL_PLAN_READY"] : reasonCodes,
    entry: ready ? entry : null,
    stopLoss: ready ? stopLoss : null,
    riskPerUnit: ready ? riskPerUnit : null,
    projectedLoss: ready ? projectedLoss : null,
    t1: ready ? entry! + riskPerUnit! : null,
    t2: ready ? entry! + 1.5 * riskPerUnit! : null,
    t3: ready ? entry! + 2 * riskPerUnit! : null,
    failClosed: true,
  };
}
