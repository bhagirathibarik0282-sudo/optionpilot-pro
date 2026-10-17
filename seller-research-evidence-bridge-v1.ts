import { evaluateSellerVertical, type SellerVerticalQuote, type SellerVerticalResult } from './seller-vertical-economics-shadow.js';

/** Read-only presentation/RAG evidence adapter. Never selects a trade or sends an order. */
export interface SellerResearchEvidence {
  source: 'RECORDED' | 'LIVE';
  snapshotId: string;
  shortContractId: string;
  longContractId: string;
  shortExpiry: string;
  longExpiry: string;
  shortQuoteSnapshotId: string;
  longQuoteSnapshotId: string;
  shortQuoteContractId: string;
  longQuoteContractId: string;
  /** Verified upstream broker quote feed, not replay LTP. */
  quoteSource: 'BROKER_BID_ASK';
  /** Margin quote tied to the same contract pair and snapshot. */
  marginSnapshotId: string;
  marginSource: 'BROKER_MARGIN';
  maxLegSkewMs: number;
  quote: SellerVerticalQuote;
}
export type SellerResearchCard =
  | { status: 'BLOCKED'; blockers: string[]; role: 'OPTION_SELLER'; researchOnly: true; affectsExecution: false; createsOrders: false }
  | { status: 'RESEARCH_ONLY'; role: 'OPTION_SELLER'; snapshotId: string; source: 'RECORDED' | 'LIVE'; economics: Extract<SellerVerticalResult, { ready: true }>; researchOnly: true; affectsExecution: false; createsOrders: false };

const SAFE = {role: 'OPTION_SELLER' as const, researchOnly: true as const, affectsExecution: false as const, createsOrders: false as const};
export function buildSellerResearchCard(input: SellerResearchEvidence): SellerResearchCard {
  if (!input || !input.quote || !['RECORDED', 'LIVE'].includes(input.source) ||
      !input.snapshotId?.trim() || !input.shortContractId?.trim() ||
      !input.longContractId?.trim() || input.shortContractId === input.longContractId ||
      input.shortExpiry !== input.longExpiry || input.shortExpiry !== input.quote.expiry ||
      input.quoteSource !== 'BROKER_BID_ASK' || input.marginSource !== 'BROKER_MARGIN' ||
      input.shortQuoteSnapshotId !== input.snapshotId || input.longQuoteSnapshotId !== input.snapshotId ||
      input.marginSnapshotId !== input.snapshotId ||
      input.shortQuoteContractId !== input.shortContractId || input.longQuoteContractId !== input.longContractId) {
    return {status: 'BLOCKED', blockers: ['UNVERIFIED_PAIR_OR_PROVENANCE'], ...SAFE};
  }
  if (!Number.isFinite(input.maxLegSkewMs) || input.maxLegSkewMs < 0 ||
      Math.abs(input.quote.shortObservedAtMs - input.quote.longObservedAtMs) > input.maxLegSkewMs) {
    return {status: 'BLOCKED', blockers: ['UNSYNCHRONIZED_LEG_QUOTES'], ...SAFE};
  }
  const economics = evaluateSellerVertical(input.quote);
  if (!economics.ready) return {status: 'BLOCKED', blockers: economics.blockers, ...SAFE};
  return {status: 'RESEARCH_ONLY', snapshotId: input.snapshotId, source: input.source, economics, ...SAFE};
}
