/** Read-only Kite basket-margin provenance gate. Never calls broker endpoints or places orders. */
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
export type SellerBasketMarginCheck = {verified: false; blockers: string[]; researchOnly: true; createsOrders: false; affectsExecution: false} | {verified: true; marginRequired: number; researchOnly: true; createsOrders: false; affectsExecution: false};
const SAFE = {researchOnly:true as const,createsOrders:false as const,affectsExecution:false as const};
const validLeg = (x: SellerBasketLegProof | undefined): boolean => !!x && Number.isSafeInteger(x.instrumentToken) && x.instrumentToken>0 && !!x.exchange?.trim() && !!x.tradingSymbol?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(x.expiry) && Number.isFinite(x.strike) && x.strike>0 && ['CE','PE'].includes(x.optionType) && ['BUY','SELL'].includes(x.transactionType) && Number.isSafeInteger(x.quantity) && x.quantity>0;
export function validateSellerBasketMarginProof(input: SellerBasketMarginProof | null): SellerBasketMarginCheck {
  const blockers:string[]=[];
  if (!input || input.source!=='KITE_BASKET_MARGIN_RESPONSE' || !input.requestId?.trim() || !input.responseId?.trim() || !input.snapshotId?.trim()) blockers.push('MARGIN_RESPONSE_PROVENANCE_MISSING');
  if (!input || ![input.requestedAtMs,input.receivedAtMs,input.asOfMs,input.maxAgeMs].every(Number.isFinite) || input.maxAgeMs<=0 || input.requestedAtMs<=0 || input.requestedAtMs>input.receivedAtMs || input.receivedAtMs>input.asOfMs || input.asOfMs-input.receivedAtMs>input.maxAgeMs) blockers.push('MARGIN_RESPONSE_TIMESTAMP_INVALID');
  if (!input || !validLeg(input.shortLeg) || !validLeg(input.longLeg)) blockers.push('MARGIN_LEG_IDENTITY_INVALID');
  if (input?.shortLeg && input?.longLeg && (input.shortLeg.transactionType!=='SELL' || input.longLeg.transactionType!=='BUY' || input.shortLeg.instrumentToken===input.longLeg.instrumentToken || input.shortLeg.exchange!==input.longLeg.exchange || input.shortLeg.expiry!==input.longLeg.expiry || input.shortLeg.optionType!==input.longLeg.optionType || input.shortLeg.quantity!==input.longLeg.quantity || (input.shortLeg.optionType==='CE' && input.longLeg.strike<=input.shortLeg.strike) || (input.shortLeg.optionType==='PE' && input.longLeg.strike>=input.shortLeg.strike))) blockers.push('MARGIN_BASKET_PAIR_MISMATCH');
  if (!input || !Number.isFinite(input.marginRequired) || input.marginRequired<=0) blockers.push('MARGIN_AMOUNT_INVALID');
  if (blockers.length) return {verified:false,blockers,...SAFE};
  return {verified:true,marginRequired:input!.marginRequired,...SAFE};
}
