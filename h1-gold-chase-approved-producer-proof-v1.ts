import { dbInsert, dbLoadRecent } from "./db.js";
import type { H1GoldChaseReadOnlyLineageAdapterResult } from "./h1-gold-chase-readonly-lineage-adapter-v1.js";

export const H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_V1 =
  "H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_V1" as const;
export const H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_PERSIST_KIND =
  "H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_V1" as const;

export interface H1GoldChaseApprovedProducerProof {
  version: typeof H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_V1;
  state: "PUBLISHED" | "BLOCKED";
  ready: boolean;
  observedAt: string;
  candidateKey: string | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "DURABLE_READ_ONLY_PROOF_OF_APPROVED_SAME_PROCESS_LINEAGE_PUBLICATION";
}

export function buildH1GoldChaseApprovedProducerProof(
  adapter: H1GoldChaseReadOnlyLineageAdapterResult,
  observedAt: string,
): H1GoldChaseApprovedProducerProof {
  const publication = adapter?.publication;
  const candidateKey = publication?.bootstrap?.candidateKey?.trim() || null;
  const validTime = Number.isFinite(Date.parse(observedAt));
  const ready = Boolean(validTime && adapter?.ready === true && adapter.state === "PUBLISHED" && candidateKey);
  const blockers = ready
    ? []
    : [...new Set([
      ...(!validTime ? ["VALID_PROOF_TIMESTAMP_REQUIRED"] : []),
      ...(!adapter?.ready ? (adapter?.blockers ?? ["APPROVED_PRODUCER_PUBLICATION_REQUIRED"]) : []),
      ...(!candidateKey ? ["PUBLISHED_CANDIDATE_KEY_REQUIRED"] : []),
    ])];
  return {
    version: H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_V1,
    state: ready ? "PUBLISHED" : "BLOCKED",
    ready,
    observedAt,
    candidateKey,
    blockers,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "DURABLE_READ_ONLY_PROOF_OF_APPROVED_SAME_PROCESS_LINEAGE_PUBLICATION",
  };
}

export async function persistH1GoldChaseApprovedProducerProof(
  value: H1GoldChaseApprovedProducerProof,
): Promise<void> {
  await dbInsert(H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_PERSIST_KIND, value);
}

export async function loadLatestH1GoldChaseApprovedProducerProof(): Promise<H1GoldChaseApprovedProducerProof | null> {
  const rows = await dbLoadRecent<H1GoldChaseApprovedProducerProof>(
    H1_GOLD_CHASE_APPROVED_PRODUCER_PROOF_PERSIST_KIND,
    1,
  );
  return rows.at(-1) ?? null;
}
