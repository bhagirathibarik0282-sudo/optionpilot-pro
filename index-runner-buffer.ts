import { quantumInspiredAugment, tightenOnlyLimit } from "./quantum-inspired-core.js";

export type RunnerIndex = "NIFTY" | "SENSEX" | "BANKNIFTY";

export interface IndexRunnerBufferInput {
  index: RunnerIndex;
  currentPremium: number;
  premiumAtr: number;
  realisedVolatilityPct: number;
  relativeSpreadPct: number;
  dte: number;
  iv: number;
  recentWhipsawRate: number;
  structuralBuffer: number;
  maxAllowedBuffer: number;
  quantumFeatures: number[];
}

export interface IndexRunnerBufferResult {
  version: "INDEX_RUNNER_BUFFER_V1";
  index: RunnerIndex;
  bufferPoints: number | null;
  volatilityBuffer: number | null;
  microstructureBuffer: number | null;
  dteBuffer: number | null;
  whipsawBuffer: number | null;
  quantumUncertainty: number | null;
  valid: boolean;
  reasonCodes: string[];
}

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;
const finiteNonNegative = (v: number) => Number.isFinite(v) && v >= 0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const indexProfile: Record<RunnerIndex, { atrMult: number; spreadMult: number; whipsawMult: number; dteMult: number }> = {
  NIFTY: { atrMult: 1.0, spreadMult: 0.70, whipsawMult: 0.85, dteMult: 0.55 },
  SENSEX: { atrMult: 1.15, spreadMult: 0.90, whipsawMult: 1.05, dteMult: 0.60 },
  BANKNIFTY: { atrMult: 1.20, spreadMult: 0.85, whipsawMult: 1.00, dteMult: 0.80 },
};

export function calculateIndexRunnerBuffer(input: IndexRunnerBufferInput): IndexRunnerBufferResult {
  const reasons: string[] = [];
  if (!indexProfile[input?.index]) reasons.push("UNSUPPORTED_INDEX");
  if (!finitePositive(input?.currentPremium) || !finitePositive(input?.premiumAtr)) reasons.push("INVALID_PREMIUM_STATE");
  if (!finiteNonNegative(input?.realisedVolatilityPct) || !finiteNonNegative(input?.relativeSpreadPct)) reasons.push("INVALID_VOLATILITY_OR_SPREAD");
  if (!Number.isFinite(input?.dte) || input.dte < 0) reasons.push("INVALID_DTE");
  if (!finiteNonNegative(input?.iv) || !finiteNonNegative(input?.recentWhipsawRate)) reasons.push("INVALID_IV_OR_WHIPSAW");
  if (!finitePositive(input?.structuralBuffer) || !finitePositive(input?.maxAllowedBuffer) || input.structuralBuffer > input.maxAllowedBuffer) reasons.push("INVALID_BUFFER_LIMITS");
  if (!Array.isArray(input?.quantumFeatures) || input.quantumFeatures.length < 2) reasons.push("INVALID_QUANTUM_FEATURES");

  if (reasons.length) return { version: "INDEX_RUNNER_BUFFER_V1", index: input?.index, bufferPoints: null, volatilityBuffer: null, microstructureBuffer: null, dteBuffer: null, whipsawBuffer: null, quantumUncertainty: null, valid: false, reasonCodes: reasons };

  const p = indexProfile[input.index];
  const volatilityBuffer = input.premiumAtr * p.atrMult * (1 + clamp(input.realisedVolatilityPct / 100, 0, 1.5) * 0.35);
  const microstructureBuffer = input.currentPremium * (input.relativeSpreadPct / 100) * p.spreadMult;
  const dteBuffer = input.premiumAtr * p.dteMult * clamp(input.dte / 30, 0, 1);
  const whipsawBuffer = input.premiumAtr * p.whipsawMult * clamp(input.recentWhipsawRate, 0, 1);

  const classical = Math.max(input.structuralBuffer, volatilityBuffer + microstructureBuffer + dteBuffer + whipsawBuffer);
  const quantum = quantumInspiredAugment({ label: `${input.index}_RUNNER_BUFFER`, values: input.quantumFeatures, classicalScore: classical });
  if (!quantum.valid || quantum.uncertainty === null) return { version: "INDEX_RUNNER_BUFFER_V1", index: input.index, bufferPoints: null, volatilityBuffer, microstructureBuffer, dteBuffer, whipsawBuffer, quantumUncertainty: null, valid: false, reasonCodes: ["QUANTUM_COMPANION_UNAVAILABLE"] };

  // Higher uncertainty may justify more anti-whipsaw room, but never beyond deterministic maxAllowedBuffer.
  // Quantum logic cannot widen beyond that hard deterministic ceiling.
  const uncertaintyExpansion = classical * (1 + 0.20 * quantum.uncertainty);
  const bufferPoints = tightenOnlyLimit(input.maxAllowedBuffer, uncertaintyExpansion);

  return {
    version: "INDEX_RUNNER_BUFFER_V1",
    index: input.index,
    bufferPoints,
    volatilityBuffer,
    microstructureBuffer,
    dteBuffer,
    whipsawBuffer,
    quantumUncertainty: quantum.uncertainty,
    valid: true,
    reasonCodes: ["INDEX_SPECIFIC_DYNAMIC_BUFFER_READY"]
  };
}
