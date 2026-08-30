export type QuantumInspiredRole = "ANALYTICAL_COMPANION" | "SAFETY_TIGHTENER_ONLY";

export interface QuantumInspiredInput {
  label: string;
  values: number[];
  weights?: number[];
  classicalScore?: number | null;
}

export interface QuantumInspiredResult {
  version: "QUANTUM_INSPIRED_CORE_V1";
  role: QuantumInspiredRole;
  kernelCoherence: number | null;
  normalizedEntropy: number | null;
  amplitudeConcentration: number | null;
  uncertainty: number | null;
  adjustedScore: number | null;
  valid: boolean;
  reasonCodes: string[];
}

function finite(v: number): boolean {
  return Number.isFinite(v);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  if (!finite(norm) || norm <= 0) return [];
  return values.map((v) => v / norm);
}

export function quantumInspiredAugment(input: QuantumInspiredInput): QuantumInspiredResult {
  const reasons: string[] = [];
  if (!input?.label?.trim()) reasons.push("LABEL_REQUIRED");
  if (!Array.isArray(input?.values) || input.values.length < 2 || input.values.some((v) => !finite(v))) {
    reasons.push("VALID_NUMERIC_VECTOR_REQUIRED");
  }
  if (input.weights && (input.weights.length !== input.values.length || input.weights.some((w) => !finite(w) || w < 0))) {
    reasons.push("INVALID_WEIGHTS");
  }
  if (input.classicalScore !== null && input.classicalScore !== undefined && !finite(input.classicalScore)) {
    reasons.push("INVALID_CLASSICAL_SCORE");
  }

  if (reasons.length) {
    return {
      version: "QUANTUM_INSPIRED_CORE_V1",
      role: "ANALYTICAL_COMPANION",
      kernelCoherence: null,
      normalizedEntropy: null,
      amplitudeConcentration: null,
      uncertainty: null,
      adjustedScore: null,
      valid: false,
      reasonCodes: reasons,
    };
  }

  const weighted = input.weights
    ? input.values.map((v, i) => v * input.weights![i])
    : [...input.values];
  const state = normalize(weighted);
  if (!state.length) {
    return {
      version: "QUANTUM_INSPIRED_CORE_V1",
      role: "ANALYTICAL_COMPANION",
      kernelCoherence: null,
      normalizedEntropy: null,
      amplitudeConcentration: null,
      uncertainty: null,
      adjustedScore: null,
      valid: false,
      reasonCodes: ["ZERO_NORM_VECTOR"],
    };
  }

  const probabilities = state.map((x) => x * x);
  const maxP = Math.max(...probabilities);
  const entropy = -probabilities.reduce((sum, p) => p > 0 ? sum + p * Math.log(p) : sum, 0);
  const maxEntropy = Math.log(probabilities.length);
  const normalizedEntropy = maxEntropy > 0 ? clamp01(entropy / maxEntropy) : 0;

  const meanAbs = state.reduce((s, x) => s + Math.abs(x), 0) / state.length;
  const variance = state.reduce((s, x) => s + (Math.abs(x) - meanAbs) ** 2, 0) / state.length;
  const kernelCoherence = clamp01(Math.exp(-variance * state.length));
  const amplitudeConcentration = clamp01(maxP);
  const uncertainty = clamp01((normalizedEntropy + (1 - kernelCoherence)) / 2);

  const adjustedScore = input.classicalScore === null || input.classicalScore === undefined
    ? null
    : input.classicalScore * (1 - 0.25 * uncertainty);

  return {
    version: "QUANTUM_INSPIRED_CORE_V1",
    role: "ANALYTICAL_COMPANION",
    kernelCoherence,
    normalizedEntropy,
    amplitudeConcentration,
    uncertainty,
    adjustedScore,
    valid: true,
    reasonCodes: ["QUANTUM_INSPIRED_AUGMENTATION_READY"],
  };
}

/**
 * Hard safety invariant: quantum-inspired logic may only keep or tighten a
 * deterministic limit. It must never increase risk, widen stops, raise size,
 * bypass stale-data blocks, override kill switches, or authorize execution.
 */
export function tightenOnlyLimit(deterministicLimit: number, proposedLimit: number): number {
  if (!finite(deterministicLimit) || deterministicLimit < 0) return 0;
  if (!finite(proposedLimit) || proposedLimit < 0) return 0;
  return Math.min(deterministicLimit, proposedLimit);
}
