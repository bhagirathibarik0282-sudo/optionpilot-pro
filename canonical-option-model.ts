export interface CanonicalOptionInput {
  spot: number;
  strike: number;
  timeYears: number;
  riskFreeRate: number;
  dividendYield: number;
  volatility: number;
  optionType: "CE" | "PE";
}

export interface CanonicalGreeks {
  price: number;
  delta: number;
  gamma: number;
  vegaPerVolPoint: number;
  thetaPerDay: number;
}

function finitePositive(v: number): boolean { return Number.isFinite(v) && v > 0; }
function normPdf(x: number): number { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
function normCdf(x: number): number { return 0.5 * (1 + erf(x / Math.SQRT2)); }

/** Canonical research reference only; not wired to verdict/execution. */
export function canonicalBlackScholes(input: CanonicalOptionInput): CanonicalGreeks {
  const { spot:S, strike:K, timeYears:T, riskFreeRate:r, dividendYield:q, volatility:sigma, optionType } = input;
  if (![S,K,T,r,q,sigma].every(Number.isFinite) || !finitePositive(S) || !finitePositive(K) || !finitePositive(T) || !finitePositive(sigma)) {
    throw new Error("invalid canonical option-model input");
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discR = Math.exp(-r * T);
  const discQ = Math.exp(-q * T);
  const pdf = normPdf(d1);

  const callPrice = S * discQ * normCdf(d1) - K * discR * normCdf(d2);
  const putPrice = K * discR * normCdf(-d2) - S * discQ * normCdf(-d1);
  const callDelta = discQ * normCdf(d1);
  const putDelta = discQ * (normCdf(d1) - 1);
  const gamma = discQ * pdf / (S * sigma * sqrtT);
  const vegaPerVolPoint = (S * discQ * pdf * sqrtT) / 100;
  const callThetaYear = -(S * discQ * pdf * sigma) / (2 * sqrtT) - r * K * discR * normCdf(d2) + q * S * discQ * normCdf(d1);
  const putThetaYear = -(S * discQ * pdf * sigma) / (2 * sqrtT) + r * K * discR * normCdf(-d2) - q * S * discQ * normCdf(-d1);

  return {
    price: optionType === "CE" ? callPrice : putPrice,
    delta: optionType === "CE" ? callDelta : putDelta,
    gamma,
    vegaPerVolPoint,
    thetaPerDay: (optionType === "CE" ? callThetaYear : putThetaYear) / 365,
  };
}

export const CANONICAL_OPTION_MODEL_VERSION = "BS_CONTINUOUS_YIELD_ACT365_V1" as const;
