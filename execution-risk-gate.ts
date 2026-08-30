// Live-execution safety foundation.
// This module has no broker/network side effects. It only decides whether an order may proceed.

export type ExecutionRiskDecision = "ALLOW" | "BLOCK";

export interface ExecutionCapitalPolicy {
  maxCapitalPerTrade: number;
}

export interface ExecutionCapitalInput {
  symbol: string;
  plannedCapital: number;
  policy: ExecutionCapitalPolicy;
}

export interface ExecutionCapitalGateResult {
  version: "EXECUTION_CAPITAL_GATE_V1";
  decision: ExecutionRiskDecision;
  reasonCodes: string[];
  symbol: string | null;
  plannedCapital: number | null;
  maxCapitalPerTrade: number | null;
  failClosed: true;
}

export interface ExecutionLossPolicy {
  maxLossPerTrade: number;
}

export interface ExecutionLossInput {
  symbol: string;
  projectedMaxLoss: number;
  policy: ExecutionLossPolicy;
}

export interface ExecutionLossGateResult {
  version: "EXECUTION_LOSS_GATE_V1";
  decision: ExecutionRiskDecision;
  reasonCodes: string[];
  symbol: string | null;
  projectedMaxLoss: number | null;
  maxLossPerTrade: number | null;
  failClosed: true;
}

export interface ExecutionDailyLossPolicy {
  maxDailyLoss: number;
}

export interface ExecutionDailyLossInput {
  symbol: string;
  realizedLossToday: number;
  openRisk: number;
  newTradeProjectedLoss: number;
  policy: ExecutionDailyLossPolicy;
}

export interface ExecutionDailyLossGateResult {
  version: "EXECUTION_DAILY_LOSS_GATE_V1";
  decision: ExecutionRiskDecision;
  reasonCodes: string[];
  symbol: string | null;
  realizedLossToday: number | null;
  openRisk: number | null;
  newTradeProjectedLoss: number | null;
  projectedDailyLossExposure: number | null;
  maxDailyLoss: number | null;
  failClosed: true;
}

export interface ExecutionTradeCountPolicy {
  maxTradesPerDay: number;
}

export interface ExecutionTradeCountInput {
  symbol: string;
  tradesExecutedToday: number;
  policy: ExecutionTradeCountPolicy;
}

export interface ExecutionTradeCountGateResult {
  version: "EXECUTION_TRADE_COUNT_GATE_V1";
  decision: ExecutionRiskDecision;
  reasonCodes: string[];
  symbol: string | null;
  tradesExecutedToday: number | null;
  maxTradesPerDay: number | null;
  failClosed: true;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function normalizedSymbol(symbol: string): string | null {
  return typeof symbol === "string" && symbol.trim().length > 0
    ? symbol.trim().toUpperCase()
    : null;
}

export function evaluateExecutionCapitalGate(
  input: ExecutionCapitalInput,
): ExecutionCapitalGateResult {
  const reasonCodes: string[] = [];
  const symbol = normalizedSymbol(input?.symbol);
  const plannedCapital = finitePositive(input?.plannedCapital) ? input.plannedCapital : null;
  const maxCapitalPerTrade = finitePositive(input?.policy?.maxCapitalPerTrade)
    ? input.policy.maxCapitalPerTrade
    : null;

  if (!symbol) reasonCodes.push("INVALID_SYMBOL");
  if (plannedCapital == null) reasonCodes.push("INVALID_PLANNED_CAPITAL");
  if (maxCapitalPerTrade == null) reasonCodes.push("INVALID_MAX_CAPITAL_PER_TRADE");

  if (reasonCodes.length === 0 && plannedCapital! > maxCapitalPerTrade!) {
    reasonCodes.push("CAPITAL_PER_TRADE_LIMIT_EXCEEDED");
  }

  return {
    version: "EXECUTION_CAPITAL_GATE_V1",
    decision: reasonCodes.length === 0 ? "ALLOW" : "BLOCK",
    reasonCodes: reasonCodes.length === 0 ? ["CAPITAL_GATE_PASSED"] : reasonCodes,
    symbol,
    plannedCapital,
    maxCapitalPerTrade,
    failClosed: true,
  };
}

export function evaluateExecutionLossGate(
  input: ExecutionLossInput,
): ExecutionLossGateResult {
  const reasonCodes: string[] = [];
  const symbol = normalizedSymbol(input?.symbol);
  const projectedMaxLoss = finitePositive(input?.projectedMaxLoss) ? input.projectedMaxLoss : null;
  const maxLossPerTrade = finitePositive(input?.policy?.maxLossPerTrade)
    ? input.policy.maxLossPerTrade
    : null;

  if (!symbol) reasonCodes.push("INVALID_SYMBOL");
  if (projectedMaxLoss == null) reasonCodes.push("INVALID_PROJECTED_MAX_LOSS");
  if (maxLossPerTrade == null) reasonCodes.push("INVALID_MAX_LOSS_PER_TRADE");

  if (reasonCodes.length === 0 && projectedMaxLoss! > maxLossPerTrade!) {
    reasonCodes.push("MAX_LOSS_PER_TRADE_LIMIT_EXCEEDED");
  }

  return {
    version: "EXECUTION_LOSS_GATE_V1",
    decision: reasonCodes.length === 0 ? "ALLOW" : "BLOCK",
    reasonCodes: reasonCodes.length === 0 ? ["LOSS_GATE_PASSED"] : reasonCodes,
    symbol,
    projectedMaxLoss,
    maxLossPerTrade,
    failClosed: true,
  };
}

export function evaluateExecutionDailyLossGate(
  input: ExecutionDailyLossInput,
): ExecutionDailyLossGateResult {
  const reasonCodes: string[] = [];
  const symbol = normalizedSymbol(input?.symbol);
  const realizedLossToday = finiteNonNegative(input?.realizedLossToday) ? input.realizedLossToday : null;
  const openRisk = finiteNonNegative(input?.openRisk) ? input.openRisk : null;
  const newTradeProjectedLoss = finitePositive(input?.newTradeProjectedLoss) ? input.newTradeProjectedLoss : null;
  const maxDailyLoss = finitePositive(input?.policy?.maxDailyLoss)
    ? input.policy.maxDailyLoss
    : null;

  if (!symbol) reasonCodes.push("INVALID_SYMBOL");
  if (realizedLossToday == null) reasonCodes.push("INVALID_REALIZED_LOSS_TODAY");
  if (openRisk == null) reasonCodes.push("INVALID_OPEN_RISK");
  if (newTradeProjectedLoss == null) reasonCodes.push("INVALID_NEW_TRADE_PROJECTED_LOSS");
  if (maxDailyLoss == null) reasonCodes.push("INVALID_MAX_DAILY_LOSS");

  const projectedDailyLossExposure = reasonCodes.length === 0
    ? realizedLossToday! + openRisk! + newTradeProjectedLoss!
    : null;

  // Daily cap is a hard stop: hitting or crossing it blocks the new order.
  if (projectedDailyLossExposure != null && projectedDailyLossExposure >= maxDailyLoss!) {
    reasonCodes.push("MAX_DAILY_LOSS_LIMIT_REACHED_OR_EXCEEDED");
  }

  return {
    version: "EXECUTION_DAILY_LOSS_GATE_V1",
    decision: reasonCodes.length === 0 ? "ALLOW" : "BLOCK",
    reasonCodes: reasonCodes.length === 0 ? ["DAILY_LOSS_GATE_PASSED"] : reasonCodes,
    symbol,
    realizedLossToday,
    openRisk,
    newTradeProjectedLoss,
    projectedDailyLossExposure,
    maxDailyLoss,
    failClosed: true,
  };
}

export function evaluateExecutionTradeCountGate(
  input: ExecutionTradeCountInput,
): ExecutionTradeCountGateResult {
  const reasonCodes: string[] = [];
  const symbol = normalizedSymbol(input?.symbol);
  const tradesExecutedToday = nonNegativeInteger(input?.tradesExecutedToday)
    ? input.tradesExecutedToday
    : null;
  const maxTradesPerDay = positiveInteger(input?.policy?.maxTradesPerDay)
    ? input.policy.maxTradesPerDay
    : null;

  if (!symbol) reasonCodes.push("INVALID_SYMBOL");
  if (tradesExecutedToday == null) reasonCodes.push("INVALID_TRADES_EXECUTED_TODAY");
  if (maxTradesPerDay == null) reasonCodes.push("INVALID_MAX_TRADES_PER_DAY");

  // Trade-count cap is a hard stop: once the configured count has been reached,
  // no additional order may be opened.
  if (reasonCodes.length === 0 && tradesExecutedToday! >= maxTradesPerDay!) {
    reasonCodes.push("MAX_TRADES_PER_DAY_REACHED_OR_EXCEEDED");
  }

  return {
    version: "EXECUTION_TRADE_COUNT_GATE_V1",
    decision: reasonCodes.length === 0 ? "ALLOW" : "BLOCK",
    reasonCodes: reasonCodes.length === 0 ? ["TRADE_COUNT_GATE_PASSED"] : reasonCodes,
    symbol,
    tradesExecutedToday,
    maxTradesPerDay,
    failClosed: true,
  };
}
