import type { BusinessExactEconomicsResult } from "./business-exact-economics-v1.js";
import {
  attachExactEconomicsToForwardJournal,
  type BusinessForwardEconomicsProof,
} from "./business-forward-economics-proof-v1.js";
import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";
import { computeBusinessForwardKpis, type BusinessForwardKpiResult } from "./business-forward-kpi-v1.js";

export const BUSINESS_FORWARD_PROOF_HTTP_V1 = "BUSINESS_FORWARD_PROOF_HTTP_V1" as const;

export interface BusinessForwardProofHttpInput {
  journal: BusinessForwardJournalRecord;
  economics?: BusinessExactEconomicsResult[];
}

export interface BusinessForwardProofHttpResult {
  ok: boolean;
  version: typeof BUSINESS_FORWARD_PROOF_HTTP_V1;
  mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1";
  productionImpact: "NONE";
  economicsProof: BusinessForwardEconomicsProof | null;
  kpis: BusinessForwardKpiResult | null;
  reason?: string;
  safety: {
    readOnly: true;
    databaseWrites: false;
    telegramWrites: false;
    candidateAuthority: false;
    starAuthority: false;
    executionAuthority: false;
    createsOrders: false;
  };
}

function safety(): BusinessForwardProofHttpResult["safety"] {
  return {
    readOnly: true,
    databaseWrites: false,
    telegramWrites: false,
    candidateAuthority: false,
    starAuthority: false,
    executionAuthority: false,
    createsOrders: false,
  };
}

export function businessForwardProofRuntimeStatus() {
  return {
    ok: true,
    version: BUSINESS_FORWARD_PROOF_HTTP_V1,
    mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1" as const,
    productionImpact: "NONE" as const,
    ready: true,
    requiredFlow: "T0_JOURNAL -> OPTIONAL_EXACT_ECONOMICS -> FORWARD_OUTCOMES -> KPI" as const,
    kpis: ["MFE", "MAE", "TERMINAL_RETURN", "BEST_ELIGIBLE", "SELECTED_RANK", "RANK_PERCENTILE", "SELECTION_REGRET"] as const,
    safety: safety(),
  };
}

/**
 * One-call read-only proof surface for tomorrow's forward-test review.
 * It never persists or feeds post-T0 evidence back into candidate authority.
 */
export function evaluateBusinessForwardProofHttp(body: unknown): BusinessForwardProofHttpResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      version: BUSINESS_FORWARD_PROOF_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1",
      productionImpact: "NONE",
      economicsProof: null,
      kpis: null,
      reason: "BUSINESS_FORWARD_PROOF_BODY_REQUIRED",
      safety: safety(),
    };
  }

  const input = body as BusinessForwardProofHttpInput;
  if (!input.journal || input.journal.version !== "BUSINESS_FORWARD_JOURNAL_V1") {
    return {
      ok: false,
      version: BUSINESS_FORWARD_PROOF_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1",
      productionImpact: "NONE",
      economicsProof: null,
      kpis: null,
      reason: "VALID_FORWARD_JOURNAL_REQUIRED",
      safety: safety(),
    };
  }

  let economicsProof: BusinessForwardEconomicsProof | null = null;
  if (Array.isArray(input.economics) && input.economics.length > 0) {
    economicsProof = attachExactEconomicsToForwardJournal(input.journal, input.economics);
    if (!economicsProof.ready) {
      return {
        ok: false,
        version: BUSINESS_FORWARD_PROOF_HTTP_V1,
        mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1",
        productionImpact: "NONE",
        economicsProof,
        kpis: null,
        reason: economicsProof.blockers[0] ?? "EXACT_ECONOMICS_PROOF_NOT_READY",
        safety: safety(),
      };
    }
  }

  const kpis = computeBusinessForwardKpis(input.journal);
  if (!kpis.ready) {
    return {
      ok: false,
      version: BUSINESS_FORWARD_PROOF_HTTP_V1,
      mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1",
      productionImpact: "NONE",
      economicsProof,
      kpis,
      reason: kpis.blockers[0] ?? "FORWARD_KPI_NOT_READY",
      safety: safety(),
    };
  }

  return {
    ok: true,
    version: BUSINESS_FORWARD_PROOF_HTTP_V1,
    mode: "READ_ONLY_BUSINESS_FORWARD_PROOF_V1",
    productionImpact: "NONE",
    economicsProof,
    kpis,
    safety: safety(),
  };
}
