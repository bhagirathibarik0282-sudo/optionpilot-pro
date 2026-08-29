// Research-only SCALP / SWING candidate selector foundation.
// No Telegram sending, live verdict authority, execution authority, DB writes, or wall-clock access.

export type CandidateTradeStyle = "SCALP" | "SWING";
export type CandidateSide = "CE" | "PE";
export type CandidateSelectionStatus = "READY" | "WATCH" | "BLOCKED" | "DATA_UNAVAILABLE";

export interface CandidateContractIdentity {
  symbol: string;
  side: CandidateSide;
  strike: number;
  expiryDate: string;
  dte: number;
}

export interface SharedCandidateEvidence {
  truthFresh: boolean | null;
  contractValid: boolean | null;
  liquidityOk: boolean | null;
  directionalParticipationConfirmed: boolean | null;
  premiumDirectionConfirmed: boolean | null;
  positioningConfirmed: boolean | null;
  breakFailureConfirmed: boolean | null;
}

export interface ScalpCandidateEvidence {
  currentOrNearExpiryUsable: boolean | null;
  fastPremiumResponseConfirmed: boolean | null;
  deltaGammaResponseConfirmed: boolean | null;
  shortHorizonProbabilityReady: boolean | null;
  scalpRiskReady: boolean | null;
  higherDteConflictAbsent: boolean | null;
}

export interface SwingCandidateEvidence {
  higherDteContractUsable: boolean | null;
  thetaIvBurdenAcceptable: boolean | null;
  multiExpiryAligned: boolean | null;
  higherTimeframeRegimeStable: boolean | null;
  longerHorizonProbabilityReady: boolean | null;
  swingRiskReady: boolean | null;
  nearExpiryNoiseNotDrivingThesis: boolean | null;
}

export interface CandidateStyleSelectionInput {
  style: CandidateTradeStyle;
  contract: CandidateContractIdentity | null;
  shared: SharedCandidateEvidence;
  scalp?: ScalpCandidateEvidence | null;
  swing?: SwingCandidateEvidence | null;
}

export interface CandidateStyleSelectionResult {
  version: "CANDIDATE_STYLE_SELECTOR_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  style: CandidateTradeStyle;
  side: CandidateSide | null;
  status: CandidateSelectionStatus;
  candidateKey: string | null;
  reasons: string[];
  devilFlags: string[];
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validContract(contract: CandidateContractIdentity | null): boolean {
  return !!contract &&
    contract.symbol.trim().length > 0 &&
    (contract.side === "CE" || contract.side === "PE") &&
    isFinitePositive(contract.strike) &&
    contract.expiryDate.trim().length > 0 &&
    Number.isInteger(contract.dte) &&
    contract.dte >= 0;
}

function missing(name: string, value: boolean | null | undefined, reasons: string[]): boolean {
  if (value == null) {
    reasons.push(`MISSING_${name}`);
    return true;
  }
  return false;
}

function candidateKey(style: CandidateTradeStyle, contract: CandidateContractIdentity): string {
  return `${style}:${contract.symbol}:${contract.side}:${contract.strike}:${contract.expiryDate}:DTE${contract.dte}`;
}

function baseResult(
  input: CandidateStyleSelectionInput,
  status: CandidateSelectionStatus,
  reasons: string[],
  devilFlags: string[],
): CandidateStyleSelectionResult {
  const contract = validContract(input.contract) ? input.contract! : null;
  return {
    version: "CANDIDATE_STYLE_SELECTOR_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    style: input.style,
    side: contract?.side ?? null,
    status,
    candidateKey: contract && status === "READY" ? candidateKey(input.style, contract) : null,
    reasons,
    devilFlags,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

export function selectCandidateStyle(input: CandidateStyleSelectionInput): CandidateStyleSelectionResult {
  const reasons: string[] = [];
  const devilFlags: string[] = [];

  if (!validContract(input.contract)) {
    return baseResult(input, "DATA_UNAVAILABLE", ["INVALID_OR_MISSING_CONTRACT_IDENTITY"], devilFlags);
  }

  const shared = input.shared;
  const sharedMissing = [
    missing("TRUTH_FRESH", shared.truthFresh, reasons),
    missing("CONTRACT_VALID", shared.contractValid, reasons),
    missing("LIQUIDITY_OK", shared.liquidityOk, reasons),
    missing("DIRECTIONAL_PARTICIPATION", shared.directionalParticipationConfirmed, reasons),
    missing("PREMIUM_DIRECTION", shared.premiumDirectionConfirmed, reasons),
  ].some(Boolean);
  if (sharedMissing) return baseResult(input, "DATA_UNAVAILABLE", reasons, devilFlags);

  if (!shared.truthFresh) return baseResult(input, "BLOCKED", ["TRUTH_NOT_FRESH"], ["STALE_OR_INVALID_DATA"]);
  if (!shared.contractValid) return baseResult(input, "BLOCKED", ["CONTRACT_NOT_VALID"], ["CONTRACT_IDENTITY_GATE_FAILED"]);
  if (!shared.liquidityOk) return baseResult(input, "BLOCKED", ["LIQUIDITY_NOT_ACCEPTABLE"], ["LIQUIDITY_GATE_FAILED"]);

  if (input.style === "SCALP") {
    const scalp = input.scalp;
    if (!scalp) return baseResult(input, "DATA_UNAVAILABLE", ["MISSING_SCALP_EVIDENCE"], devilFlags);

    const scalpMissing = [
      missing("CURRENT_OR_NEAR_EXPIRY_USABLE", scalp.currentOrNearExpiryUsable, reasons),
      missing("FAST_PREMIUM_RESPONSE", scalp.fastPremiumResponseConfirmed, reasons),
      missing("DELTA_GAMMA_RESPONSE", scalp.deltaGammaResponseConfirmed, reasons),
      missing("SHORT_HORIZON_PROBABILITY", scalp.shortHorizonProbabilityReady, reasons),
      missing("SCALP_RISK", scalp.scalpRiskReady, reasons),
      missing("HIGHER_DTE_CONFLICT_ABSENT", scalp.higherDteConflictAbsent, reasons),
    ].some(Boolean);
    if (scalpMissing) return baseResult(input, "DATA_UNAVAILABLE", reasons, devilFlags);

    if (!scalp.currentOrNearExpiryUsable) devilFlags.push("SCALP_EXPIRY_NOT_USABLE");
    if (!scalp.scalpRiskReady) devilFlags.push("SCALP_RISK_NOT_READY");
    if (!scalp.higherDteConflictAbsent) devilFlags.push("HIGHER_DTE_CONFLICT_PRESENT");
    if (devilFlags.length > 0) return baseResult(input, "BLOCKED", ["SCALP_HARD_GATE_FAILED"], devilFlags);

    const confirmations = [
      shared.directionalParticipationConfirmed,
      shared.premiumDirectionConfirmed,
      scalp.fastPremiumResponseConfirmed,
      scalp.deltaGammaResponseConfirmed,
      scalp.shortHorizonProbabilityReady,
    ];
    if (confirmations.some((v) => v !== true)) {
      return baseResult(input, "WATCH", ["SCALP_CONFIRMATION_INCOMPLETE"], devilFlags);
    }

    return baseResult(input, "READY", ["SCALP_GATES_AND_CONFIRMATIONS_READY"], devilFlags);
  }

  const swing = input.swing;
  if (!swing) return baseResult(input, "DATA_UNAVAILABLE", ["MISSING_SWING_EVIDENCE"], devilFlags);

  const swingMissing = [
    missing("HIGHER_DTE_CONTRACT_USABLE", swing.higherDteContractUsable, reasons),
    missing("THETA_IV_BURDEN_ACCEPTABLE", swing.thetaIvBurdenAcceptable, reasons),
    missing("MULTI_EXPIRY_ALIGNED", swing.multiExpiryAligned, reasons),
    missing("HIGHER_TIMEFRAME_REGIME_STABLE", swing.higherTimeframeRegimeStable, reasons),
    missing("LONGER_HORIZON_PROBABILITY", swing.longerHorizonProbabilityReady, reasons),
    missing("SWING_RISK", swing.swingRiskReady, reasons),
    missing("NEAR_EXPIRY_NOISE_NOT_DRIVING_THESIS", swing.nearExpiryNoiseNotDrivingThesis, reasons),
  ].some(Boolean);
  if (swingMissing) return baseResult(input, "DATA_UNAVAILABLE", reasons, devilFlags);

  if (!swing.higherDteContractUsable) devilFlags.push("SWING_HIGHER_DTE_CONTRACT_NOT_USABLE");
  if (!swing.thetaIvBurdenAcceptable) devilFlags.push("THETA_IV_BURDEN_UNACCEPTABLE");
  if (!swing.swingRiskReady) devilFlags.push("SWING_RISK_NOT_READY");
  if (!swing.nearExpiryNoiseNotDrivingThesis) devilFlags.push("NEAR_EXPIRY_NOISE_DRIVES_SWING_THESIS");
  if (devilFlags.length > 0) return baseResult(input, "BLOCKED", ["SWING_HARD_GATE_FAILED"], devilFlags);

  const confirmations = [
    shared.directionalParticipationConfirmed,
    shared.premiumDirectionConfirmed,
    swing.multiExpiryAligned,
    swing.higherTimeframeRegimeStable,
    swing.longerHorizonProbabilityReady,
  ];
  if (confirmations.some((v) => v !== true)) {
    return baseResult(input, "WATCH", ["SWING_CONFIRMATION_INCOMPLETE"], devilFlags);
  }

  return baseResult(input, "READY", ["SWING_GATES_AND_CONFIRMATIONS_READY"], devilFlags);
}
