import type { KiteExecutionShadowResult } from "./kite-execution-shadow-v1.js";
import type { RealExecutionReadinessResult } from "./real-execution-readiness-v1.js";

export const E2E_SHADOW_PROOF_V1 = "E2E_SHADOW_PROOF_V1" as const;

export interface E2EShadowProofInput {
  symbol: "NIFTY" | "SENSEX";
  observedAt: string;
  liveRegistrySelectCount: number;
  canonicalCandidateKey: string | null;
  telegramCandidateKey: string | null;
  dashboardCandidateKey: string | null;
  shadow: KiteExecutionShadowResult | null;
  readiness: RealExecutionReadinessResult | null;
}

export function buildE2EShadowProof(input:E2EShadowProofInput) {
  const blockers:string[]=[];
  if (!Number.isFinite(Date.parse(input?.observedAt))) blockers.push("VALID_LIVE_OBSERVED_AT_REQUIRED");
  if (!Number.isInteger(input?.liveRegistrySelectCount) || input.liveRegistrySelectCount < 1) blockers.push("ORGANIC_LIVE_SELECT_REQUIRED");
  if (!input?.canonicalCandidateKey) blockers.push("CANONICAL_CANDIDATE_REQUIRED");
  if (input?.canonicalCandidateKey !== input?.telegramCandidateKey) blockers.push("TELEGRAM_CANDIDATE_MISMATCH");
  if (input?.canonicalCandidateKey !== input?.dashboardCandidateKey) blockers.push("DASHBOARD_CANDIDATE_MISMATCH");
  if (input?.shadow?.decision !== "SHADOW_READY" || input?.shadow?.candidateKey !== input?.canonicalCandidateKey) blockers.push("KITE_SHADOW_NOT_SAME_CANDIDATE");
  if (input?.readiness?.candidateKey !== input?.canonicalCandidateKey) blockers.push("READINESS_NOT_SAME_CANDIDATE");
  if (input?.readiness?.liveExecutionEnabled !== false || input?.readiness?.placesOrder !== false || input?.readiness?.brokerCallMade !== false) blockers.push("LIVE_EXECUTION_BOUNDARY_UNSAFE");
  return {
    version:E2E_SHADOW_PROOF_V1,
    proven:blockers.length===0,
    state:blockers.length===0?"E2E_SHADOW_PROVEN":"PENDING_LIVE_EVIDENCE" as "E2E_SHADOW_PROVEN"|"PENDING_LIVE_EVIDENCE",
    symbol:input?.symbol ?? null,observedAt:input?.observedAt ?? null,candidateKey:input?.canonicalCandidateKey ?? null,
    blockers:[...new Set(blockers)],requiresOrganicLiveSelect:true,readOnly:true,placesOrder:false,brokerCallMade:false,
    liveExecutionEnabled:false,affectsTelegram:false,affectsCandidateAuthority:false,failClosed:true,
  };
}
