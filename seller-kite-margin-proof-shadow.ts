/** Caller-declared margin structure only; does not authenticate Kite provenance. Never calls broker endpoints. */
export interface SellerBasketLegProof {
  instrumentToken: number;
  exchange: string;
  tradingSymbol: string;
  expiry: string;
  strike: number;
  optionType: 'CE' | 'PE';
  transactionType: 'BUY' | 'SELL';
  quantity: number;
}
export interface SellerBasketMarginProof {
  source: 'KITE_BASKET_MARGIN_RESPONSE';
  requestId: string;
  responseId: string;
  snapshotId: string;
  requestedAtMs: number;
  receivedAtMs: number;
  asOfMs: number;
  maxAgeMs: number;
  shortLeg: SellerBasketLegProof;
  longLeg: SellerBasketLegProof;
  marginRequired: number;
}
type ResearchBoundary = {
  researchOnly: true;
  createsOrders: false;
  affectsExecution: false;
  structureOnly: true;
  brokerProvenanceVerified: false;
};
/** `verified` means structural validation only, never broker authentication. */
export type SellerBasketMarginCheck = ResearchBoundary & (
  {verified: false; blockers: string[]} |
  {verified: true; marginRequired: number}
);
const SAFE: ResearchBoundary = {
  researchOnly: true, createsOrders: false, affectsExecution: false,
  structureOnly: true, brokerProvenanceVerified: false,
};
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const validExpiry = (x: unknown): boolean => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const date = new Date(x + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === x;
};
const validLeg = (x: unknown): x is SellerBasketLegProof => {
  if (!record(x)) return false;
  return Number.isSafeInteger(x.instrumentToken) && (x.instrumentToken as number) > 0 &&
    nonempty(x.exchange) && nonempty(x.tradingSymbol) && validExpiry(x.expiry) &&
    Number.isFinite(x.strike) && (x.strike as number) > 0 &&
    (x.optionType === 'CE' || x.optionType === 'PE') &&
    (x.transactionType === 'BUY' || x.transactionType === 'SELL') &&
    Number.isSafeInteger(x.quantity) && (x.quantity as number) > 0;
};
export function validateSellerBasketMarginProof(value: unknown): SellerBasketMarginCheck {
  // Runtime JSON is untrusted even when a TypeScript caller declares an interface.
  const input = record(value) ? value as unknown as SellerBasketMarginProof : null;
  const blockers: string[] = [];
  if (!input || input.source !== 'KITE_BASKET_MARGIN_RESPONSE' ||
      !nonempty(input.requestId) || !nonempty(input.responseId) || !nonempty(input.snapshotId)) {
    blockers.push('MARGIN_RESPONSE_PROVENANCE_MISSING');
  }
  if (!input || ![input.requestedAtMs, input.receivedAtMs, input.asOfMs, input.maxAgeMs].every(Number.isFinite) ||
      input.maxAgeMs <= 0 || input.requestedAtMs <= 0 || input.requestedAtMs > input.receivedAtMs ||
      input.receivedAtMs > input.asOfMs || input.asOfMs - input.receivedAtMs > input.maxAgeMs) {
    blockers.push('MARGIN_RESPONSE_TIMESTAMP_INVALID');
  }
  if (!input || !validLeg(input.shortLeg) || !validLeg(input.longLeg)) {
    blockers.push('MARGIN_LEG_IDENTITY_INVALID');
  } else {
    const short = input.shortLeg, long = input.longLeg;
    if (short.transactionType !== 'SELL' || long.transactionType !== 'BUY' ||
        short.instrumentToken === long.instrumentToken ||
        short.tradingSymbol.trim().toUpperCase() === long.tradingSymbol.trim().toUpperCase() ||
        short.exchange !== long.exchange || short.expiry !== long.expiry ||
        short.optionType !== long.optionType || short.quantity !== long.quantity ||
        (short.optionType === 'CE' && long.strike <= short.strike) ||
        (short.optionType === 'PE' && long.strike >= short.strike)) {
      blockers.push('MARGIN_BASKET_PAIR_MISMATCH');
    }
  }
  if (!input || !Number.isFinite(input.marginRequired) || input.marginRequired <= 0) {
    blockers.push('MARGIN_AMOUNT_INVALID');
  }
  if (blockers.length) return {verified: false, blockers, ...SAFE};
  return {verified: true, marginRequired: input!.marginRequired, ...SAFE};
}
